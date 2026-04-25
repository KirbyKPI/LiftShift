/**
 * POST /api/coach/run-ai-recommendation
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 2 — takes a draft recommendation (produced by
 * /api/coach/generate-recommendation), feeds its snapshot to Claude, and
 * writes the AI's per-exercise proposals into training_coach_recommendation_items.
 *
 * Request body:
 *   {
 *     recommendation_id: string,
 *     coach_token: string,
 *     model?: string           // override; defaults to claude-opus-4-6
 *   }
 *
 * Response (success):
 *   {
 *     recommendation_id,
 *     status: 'awaiting_review',
 *     summary: string,
 *     items: Array<RecommendationItemRow>,
 *     usage: { input_tokens, output_tokens }
 *   }
 *
 * Response (failure): recommendation row is updated to status='failed' with
 * an error_message; endpoint returns 5xx + the same error_message.
 *
 * Tool-use is used to force structured output so we don't have to parse
 * freeform JSON out of Markdown.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

const DEFAULT_MODEL = 'claude-opus-4-6'
const MAX_OUTPUT_TOKENS = 16000

// Opus on large clients (1k+ sets, multiple routines) can run well past
// Vercel's 10s default. Bump to 5 min — safe ceiling for this call.
// Only takes effect on Pro plans; Hobby is capped at 60s.
export const config = {
  maxDuration: 300,
}

// ─── Prompt building ───────────────────────────────────────────────────────

type AdjustmentLevel =
  | 'load_only'
  | 'load_plus_swap'
  | 'full_authoring'
  | 'overhaul'
  | 'week_plan'

const SCOPE_GUIDANCE: Record<AdjustmentLevel, string> = {
  load_only: `
ADJUSTMENT SCOPE: **Load progression only.**

- Keep every exercise in the client's current routine exactly as-is (same
  exercise_template_id, same order).
- You may only adjust: set count, rep targets, weight prescriptions, RPE
  targets, rest intervals, and per-exercise notes.
- Do NOT add new exercises, remove existing ones, or swap one exercise for
  another. If an exercise is clearly not working, flag that in the rationale
  — but still return the same slot.
- Each proposed item's exercise_template_id MUST exactly match the current
  routine's slot at that position.
- Leave day_label null on every item.
`.trim(),
  load_plus_swap: `
ADJUSTMENT SCOPE: **Load progression + targeted exercise swaps.**

- You may adjust loads/reps/sets as in load_only mode.
- You may also swap individual exercises when the data justifies it
  (stagnation, imbalance correction, fatigue/variety, client injury notes).
  When you swap, set matched_current_slot_position to the position of the
  exercise you're replacing, and explain the swap in the rationale.
- Do NOT restructure the whole routine, change day count, or add/remove
  more than ~30% of slots.
- Prefer exercise_template_ids that appear in the snapshot's recent_workout_sets
  or current_hevy_routines so we know Hevy has them in its library.
  For novel swaps, set exercise_template_id to null and we'll resolve it later.
- Leave day_label null on every item.
`.trim(),
  full_authoring: `
ADJUSTMENT SCOPE: **Full program authoring.**

- You may restructure the routine however the client's data justifies:
  change exercise selection, order, set/rep schemes, add/remove days,
  re-group supersets, anything.
- Prefer exercise_template_ids that appear in the snapshot. For novel
  exercises not in the snapshot, set exercise_template_id to null and
  include a clear exercise_title — we'll resolve template IDs on push.
- Respect any client notes re: injuries, equipment, time availability.
- Be principled: state your rationale for each slot so the coach can
  evaluate whether your reasoning matches their intent.
- Leave day_label null on every item (single routine).
`.trim(),
  overhaul: `
ADJUSTMENT SCOPE: **Overhaul — build a single fresh routine.**

- The coach has asked for a fresh start. Ignore the structural bones of
  any current Hevy routine; build what the client actually needs.
- The coach's focus_prompt (see below) is the north star. Read it carefully
  — it may specify the split type, session length, equipment, or goals.
- Use recent_workout_sets and insights_summary to inform exercise selection
  (what the client has actually been doing, what's working, what's stagnant)
  but don't feel bound by the existing routine's exercise list.
- If the client has minimal history, lean on the focus_prompt + conservative
  defaults (moderate rep ranges, moderate loads relative to their observed
  top sets, clear progression plan).
- Output: ONE routine. All items share the same day_label (or null).
`.trim(),
  week_plan: `
ADJUSTMENT SCOPE: **Weekly program — multiple routines, one per training day.**

- Produce a full week of training. Each day is its own routine.
- MANDATORY: set day_label on every item to group items into days.
  Use labels like "Day 1 - Upper" / "Day 2 - Lower" / "Day 3 - Pull"
  — short, descriptive, consistent within the week.
- Items across days should still have unique positions (1, 2, 3... across
  the whole plan); position determines order WITHIN a day via item order.
- Read focus_prompt for split type and days-per-week. If unspecified,
  infer from the client's insights_summary (workout_days_per_week_avg).
- Balance volume across the week; don't double-up fatigued muscles on
  back-to-back days unless the split explicitly calls for it.
- summary should describe the week's structure and training intent.
`.trim(),
}

const SYSTEM_PROMPT = `
You are an experienced strength and hypertrophy coach reviewing a client's
recent training data to propose adjustments for their next training block.

You will be given a JSON snapshot with:
- The client's profile and coach-written notes (goals, injuries, preferences)
- A precomputed insights_summary, including:
    * dashboard_insights — rolling 7d/30d/365d deltas, current streak, PR
      drought (days since last PR), overall trend (improving/maintaining/declining)
    * plateaus — exercises flagged as stagnant by the dashboard's analyzer,
      each with a per-exercise suggestion the coach is already seeing on
      screen (e.g. "Pick 8 reps and chase 9 on ALL sets"). Treat these
      suggestions as authoritative starting points — they reflect the same
      dashboard tips the coach trusts.
    * improving_exercises — exercises trending positively (overload status)
- Recent workout sets (last 12 weeks of actuals)
- Their current Hevy routine(s)
- Per-workout and per-exercise notes the client wrote in Hevy

Your job is to propose a specific, actionable update to the routine and
submit it via the propose_routine_adjustment tool. Coaching principles:

- LEAN ON THE DASHBOARD. If insights_summary.plateaus contains a suggestion
  for an exercise you're adjusting, your proposal should be consistent with
  that suggestion (or explicitly disagree with it in the rationale, citing
  the data point that overrides it).
- PROGRESS LOADS INCREMENTALLY. Top-end working-set jumps of >5% on compounds
  or >10% on isolations usually fail. When in doubt, add a rep before adding
  weight.
- RESPECT ADHERENCE. If rolling_7d shows fewer workouts than rolling_30d
  average, don't pile on volume. PR drought + declining overall_trend means
  hold or deload, not push.
- FIX OBVIOUS IMBALANCES first. If an antagonist is under-stimulated relative
  to its agonist (e.g. rows vs presses), close that gap before piling more
  volume on the dominant pattern.
- NEVER PRESCRIBE RPE > 9 ON A COMPOUND unless the client's history shows
  they tolerate it and hit their targets reliably.
- BE HONEST about uncertainty. If the data doesn't support a specific change,
  say so in the rationale rather than inventing a reason. When you cite a
  dashboard plateau suggestion in your rationale, name it explicitly so the
  coach can verify ("dashboard suggested 'Pick 8 reps and chase 9' — applying
  here").

Call the propose_routine_adjustment tool exactly once with your full proposal.
Do not produce any prose outside the tool call — the coach will review in a
diff UI that reads the tool_use input.
`.trim()

/**
 * Pick the single routine the coach is adjusting. Heuristic: most recently
 * updated in Hevy. Clients often have multiple routines (different training
 * days, old experiments, a "warmup" skeleton) and if we give Claude all of
 * them it has to pick one to adjust — sometimes it refuses rather than guess.
 * Explicit is better.
 */
function pickPrimaryRoutine(snapshot: any): { primary: any | null; others: any[] } {
  const routines: any[] = Array.isArray(snapshot?.current_hevy_routines)
    ? snapshot.current_hevy_routines
    : []
  if (routines.length === 0) return { primary: null, others: [] }
  if (routines.length === 1) return { primary: routines[0], others: [] }

  const sorted = [...routines].sort((a, b) => {
    const au = new Date(a?.updated_at || 0).getTime()
    const bu = new Date(b?.updated_at || 0).getTime()
    return bu - au
  })
  return { primary: sorted[0], others: sorted.slice(1) }
}

function formatPlanPreferences(prefs: Record<string, unknown> | null): string {
  if (!prefs || typeof prefs !== 'object') return ''
  const lines: string[] = []
  if (prefs.goal) lines.push(`- Goal: ${String(prefs.goal).replace(/_/g, ' ')}`)
  if (prefs.days_per_week) lines.push(`- Days per week: ${prefs.days_per_week}`)
  if (prefs.session_minutes)
    lines.push(`- Session length: ${prefs.session_minutes} minutes`)
  if (prefs.split) lines.push(`- Split: ${String(prefs.split).replace(/_/g, ' ')}`)
  if (Array.isArray(prefs.equipment) && prefs.equipment.length) {
    lines.push(`- Equipment available: ${prefs.equipment.join(', ')}`)
  }
  if (!lines.length) return ''
  return ['STRUCTURED PLAN PREFERENCES (coach-set):', ...lines, ''].join('\n')
}

function buildUserMessage(
  snapshot: any,
  adjustmentLevel: AdjustmentLevel,
  focusPrompt: string | null,
  planPreferences: Record<string, unknown> | null,
): string {
  const isCreateFromScratch = adjustmentLevel === 'overhaul' || adjustmentLevel === 'week_plan'

  // Snapshot may already be narrowed to a coach-picked routine (via
  // target_routine_id on generate-recommendation). If so, current_hevy_routines
  // will have exactly one entry and other_routines_summary carries context.
  // Otherwise fall back to picking the most recent as primary.
  const { primary, others } = pickPrimaryRoutine(snapshot)
  const coachPicked = !!snapshot?.target_routine_id

  const primaryBanner = primary
    ? `
PRIMARY ROUTINE FOR THIS ADJUSTMENT: "${primary.title}" (id: ${primary.id})
— Updated in Hevy at ${primary.updated_at}
— Has ${Array.isArray(primary.exercises) ? primary.exercises.length : 0} exercises
${coachPicked ? '— Coach explicitly selected this routine as the target.' : '— Auto-picked (most recently updated).'}

Your proposal should adjust THIS routine, not the others. The other routines
are included below as context only (so you can see the broader program) —
do NOT include their exercises in your proposal.
`.trim()
    : `
THIS CLIENT HAS NO HEVY ROUTINES YET.

For load_only mode you cannot propose load changes without a current
routine. Return an empty items array and explain in summary.

For load_plus_swap or full_authoring: you may propose a brand-new routine
based on their recent workout patterns.
`.trim()

  // Prefer the summary from generate-recommendation (set when coach picked a
  // specific routine). Fall back to the others-from-primary-pick helper.
  const otherFromSnapshot: Array<{ id: string; title: string; exercise_count: number }> =
    Array.isArray(snapshot?.other_routines_summary) ? snapshot.other_routines_summary : []

  const otherList = otherFromSnapshot.length
    ? otherFromSnapshot
        .map(
          (r, i) => `${i + 1}. "${r.title}" (id: ${r.id}, ${r.exercise_count} exercises)`,
        )
        .join('\n')
    : others.length
      ? others
          .map(
            (r, i) =>
              `${i + 1}. "${r.title}" (id: ${r.id}, ${
                Array.isArray(r.exercises) ? r.exercises.length : 0
              } exercises, updated ${r.updated_at})`,
          )
          .join('\n')
      : '(none)'

  const trimmedSnapshot = {
    ...snapshot,
    current_hevy_routines: primary ? [primary] : [],
  }

  const prefsBlock = formatPlanPreferences(planPreferences)

  const focusBlock =
    focusPrompt && focusPrompt.trim()
      ? [
          'COACH FOCUS / CONSTRAINTS (read carefully — this is the coach\'s intent):',
          focusPrompt.trim(),
          '',
        ].join('\n')
      : isCreateFromScratch && !prefsBlock
        ? 'COACH FOCUS / CONSTRAINTS: (none provided — the coach did not narrow further)'
        : ''

  const coachIntent = [prefsBlock, focusBlock].filter(Boolean).join('\n')

  // For overhaul/week_plan modes, current-routine context is secondary —
  // lead with the focus prompt instead.
  const sections = isCreateFromScratch
    ? [
        SCOPE_GUIDANCE[adjustmentLevel],
        '',
        coachIntent,
        '---',
        '',
        'CLIENT CONTEXT:',
        primary
          ? `The client has an existing routine "${primary.title}" with ${
              Array.isArray(primary.exercises) ? primary.exercises.length : 0
            } exercises — use it as reference but you are NOT bound by it.`
          : 'The client has no current Hevy routine. Build from history + focus alone.',
        '',
        'OTHER ROUTINES (reference only):',
        otherList,
        '',
        '---',
        '',
        'SNAPSHOT:',
        '```json',
        JSON.stringify(trimmedSnapshot, null, 2),
        '```',
      ]
    : [
        SCOPE_GUIDANCE[adjustmentLevel],
        '',
        coachIntent,
        primaryBanner,
        '',
        'OTHER ROUTINES (context only):',
        otherList,
        '',
        '---',
        '',
        'CLIENT SNAPSHOT:',
        '```json',
        JSON.stringify(trimmedSnapshot, null, 2),
        '```',
      ]

  return sections.join('\n')
}

// ─── Tool schema — forces structured output ────────────────────────────────

const PROPOSE_TOOL = {
  name: 'propose_routine_adjustment',
  description:
    'Submit the proposed routine adjustment for the coach to review. ' +
    'Call exactly once with the complete proposal.',
  input_schema: {
    type: 'object' as const,
    properties: {
      summary: {
        type: 'string',
        description:
          'Short (1-3 sentence) overview of what changed and why. Rendered at the top of the review UI.',
      },
      items: {
        type: 'array',
        description: 'One entry per exercise slot in the proposed routine, in order.',
        items: {
          type: 'object',
          properties: {
            position: {
              type: 'integer',
              description: 'Order within the proposed routine, starting at 1.',
            },
            exercise_template_id: {
              type: ['string', 'null'],
              description:
                "Hevy exercise_template_id. Required when the exercise exists in the snapshot; null only for novel full_authoring slots.",
            },
            exercise_title: {
              type: 'string',
              description: 'Human-readable exercise name (e.g. "Barbell Bench Press").',
            },
            matched_current_slot_position: {
              type: ['integer', 'null'],
              description:
                "When this item replaces or modifies an existing slot in current_hevy_routines, the position of that original slot. Null if this is a newly added slot.",
            },
            is_new_slot: {
              type: 'boolean',
              description: 'True if this slot is newly added (not present in the current routine).',
            },
            proposed: {
              type: 'object',
              description: "Hevy-shaped exercise block. Mirrors POST /v1/routines exercise item.",
              properties: {
                rest_seconds: { type: ['integer', 'null'] },
                notes: { type: ['string', 'null'] },
                superset_id: { type: ['integer', 'null'] },
                sets: {
                  type: 'array',
                  items: {
                    type: 'object',
                    properties: {
                      type: {
                        type: 'string',
                        enum: ['warmup', 'normal', 'failure', 'dropset'],
                      },
                      weight_kg: { type: ['number', 'null'] },
                      reps: { type: ['integer', 'null'] },
                      rpe: { type: ['number', 'null'] },
                      duration_seconds: { type: ['integer', 'null'] },
                      distance_meters: { type: ['number', 'null'] },
                    },
                    required: ['type'],
                  },
                },
              },
              required: ['sets'],
            },
            rationale: {
              type: 'string',
              description:
                'Short justification for THIS specific slot. Rendered inline with the diff. Be honest — cite the data point that drove the change.',
            },
            day_label: {
              type: ['string', 'null'],
              description:
                'For week_plan mode, the training day this item belongs to (e.g. "Day 1 - Upper"). For single-routine modes (load_only, load_plus_swap, full_authoring, overhaul), leave null.',
            },
          },
          required: ['position', 'exercise_title', 'is_new_slot', 'proposed', 'rationale'],
        },
      },
    },
    required: ['summary', 'items'],
  },
} as const

// ─── Helpers ───────────────────────────────────────────────────────────────

type ToolInput = {
  summary: string
  items: Array<{
    position: number
    exercise_template_id: string | null
    exercise_title: string
    matched_current_slot_position: number | null
    is_new_slot: boolean
    proposed: any
    rationale: string
    day_label: string | null
  }>
}

/**
 * Walk the current snapshot's routines and try to find the "slot" this
 * proposed item came from, so the review UI can show a before/after diff.
 * Uses matched_current_slot_position when Claude provided it, falls back
 * to template-id match, then fuzzy title match.
 */
function findCurrentSlot(snapshot: any, item: ToolInput['items'][number]): any | null {
  const routines = Array.isArray(snapshot?.current_hevy_routines)
    ? snapshot.current_hevy_routines
    : []
  if (routines.length === 0) return null

  // Flatten all exercises across routines. If there's >1 routine we'd want
  // better matching; for v1 we just take the first one.
  const primary = routines[0]
  const exercises: any[] = Array.isArray(primary?.exercises) ? primary.exercises : []

  // 1) exercise_template_id is unique and authoritative — try it first.
  //    Claude reliably echoes the snapshot's template_ids when not adding
  //    novel slots, so this catches the common case cleanly.
  if (item.exercise_template_id) {
    const byTemplate = exercises.find((ex) => ex.exercise_template_id === item.exercise_template_id)
    if (byTemplate) return byTemplate
  }

  // 2) Fuzzy title match for renamed slots.
  const titleLc = (item.exercise_title || '').toLowerCase()
  if (titleLc) {
    const byTitle = exercises.find((ex) => (ex.title || '').toLowerCase() === titleLc)
    if (byTitle) return byTitle
  }

  // 3) Position-based match as a last resort. Tool schema doesn't pin down
  //    0-indexed vs 1-indexed and Claude has been observed to use either,
  //    which produced an off-by-one bug where every item showed the
  //    *previous* slot's data. Try both interpretations and prefer the one
  //    whose template_id matches the proposal — if neither does, return
  //    the 1-indexed match (more common interpretation) but only if the
  //    proposal didn't supply a template_id (which would have matched above).
  if (item.matched_current_slot_position != null) {
    const oneIndexed = exercises.find(
      (ex) => (ex.index ?? -1) + 1 === item.matched_current_slot_position,
    )
    const zeroIndexed = exercises.find((ex) => ex.index === item.matched_current_slot_position)
    if (oneIndexed) return oneIndexed
    if (zeroIndexed) return zeroIndexed
  }

  return null
}

async function updateRecommendationFailed(
  id: string,
  msg: string,
  raw?: unknown,
): Promise<void> {
  const update: Record<string, unknown> = { status: 'failed', error_message: msg }
  if (raw !== undefined) update.ai_response_raw = raw as object
  await supabase.from('training_coach_recommendations').update(update).eq('id', id)
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { recommendation_id, coach_token, model } = (req.body || {}) as {
    recommendation_id?: string
    coach_token?: string
    model?: string
  }

  if (!recommendation_id || !coach_token) {
    return res.status(400).json({ error: 'recommendation_id and coach_token required' })
  }

  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })
  }

  try {
    // Auth: coach must be signed in.
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    // Load the draft recommendation and confirm it's owned by this coach.
    const { data: rec, error: recErr } = await supabase
      .from('training_coach_recommendations')
      .select(
        'id, client_id, coach_id, adjustment_level, status, ai_snapshot, focus_prompt, plan_preferences',
      )
      .eq('id', recommendation_id)
      .single()

    if (recErr || !rec) return res.status(404).json({ error: 'Recommendation not found' })
    if (rec.coach_id !== coach.id) return res.status(403).json({ error: 'Not your recommendation' })

    if (rec.status === 'pushed') {
      return res.status(409).json({ error: 'Already pushed; create a new recommendation' })
    }
    if (rec.status !== 'draft' && rec.status !== 'failed') {
      return res
        .status(409)
        .json({ error: `Recommendation is in status='${rec.status}'; only draft/failed can be (re)run` })
    }
    if (!rec.ai_snapshot) {
      return res
        .status(400)
        .json({ error: 'Recommendation has no snapshot — call generate-recommendation first' })
    }

    // Wipe any existing items so re-running after a failure doesn't stack.
    await supabase
      .from('training_coach_recommendation_items')
      .delete()
      .eq('recommendation_id', rec.id)

    // Call Claude with tool-use.
    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const userMessage = buildUserMessage(
      rec.ai_snapshot,
      rec.adjustment_level as AdjustmentLevel,
      (rec.focus_prompt as string | null) ?? null,
      (rec.plan_preferences as Record<string, unknown> | null) ?? null,
    )

    let aiResponse: Anthropic.Messages.Message
    try {
      aiResponse = await anthropic.messages.create({
        model: model || DEFAULT_MODEL,
        max_tokens: MAX_OUTPUT_TOKENS,
        system: SYSTEM_PROMPT,
        tools: [PROPOSE_TOOL as unknown as Anthropic.Messages.Tool],
        tool_choice: { type: 'tool', name: PROPOSE_TOOL.name },
        messages: [{ role: 'user', content: userMessage }],
      })
    } catch (err: any) {
      const msg = err?.message || 'Claude API error'
      await updateRecommendationFailed(rec.id, msg)
      return res.status(502).json({ error: msg })
    }

    // Find the tool_use block.
    const toolBlock = aiResponse.content.find(
      (c) => c.type === 'tool_use' && c.name === PROPOSE_TOOL.name,
    ) as Anthropic.Messages.ToolUseBlock | undefined

    if (!toolBlock) {
      const msg =
        'Claude did not call propose_routine_adjustment. ' +
        `stop_reason=${aiResponse.stop_reason}`
      await updateRecommendationFailed(rec.id, msg, aiResponse)
      return res.status(502).json({ error: msg, raw: aiResponse })
    }

    const parsed = toolBlock.input as ToolInput
    if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      const stop = aiResponse.stop_reason
      const msg =
        stop === 'max_tokens'
          ? 'Claude hit max_tokens before finishing its proposal. Bump MAX_OUTPUT_TOKENS and retry.'
          : `Claude returned no items in its proposal (stop_reason=${stop}). ` +
            `Summary: ${parsed?.summary || '(none)'}.`
      await updateRecommendationFailed(rec.id, msg, aiResponse)
      return res.status(502).json({ error: msg, raw: aiResponse })
    }

    // Persist raw response for forensics.
    await supabase
      .from('training_coach_recommendations')
      .update({
        ai_response_raw: aiResponse as unknown as object,
        status: 'awaiting_review',
        error_message: null,
      })
      .eq('id', rec.id)

    // Build the item rows. Match each proposal back to the client's current
    // routine so the review UI can diff current vs proposed.
    const itemRows = parsed.items.map((item) => {
      const currentSlot = findCurrentSlot(rec.ai_snapshot, item)
      return {
        recommendation_id: rec.id,
        position: item.position,
        exercise_template_id: item.exercise_template_id ?? currentSlot?.exercise_template_id ?? null,
        exercise_title: item.exercise_title,
        current_json: currentSlot ?? null,
        proposed_json: item.proposed,
        rationale: item.rationale,
        coach_action: 'pending' as const,
        day_label: item.day_label ?? null,
      }
    })

    const { data: insertedItems, error: itemErr } = await supabase
      .from('training_coach_recommendation_items')
      .insert(itemRows)
      .select('*')
      .order('position')

    if (itemErr) {
      await updateRecommendationFailed(rec.id, `Failed to save items: ${itemErr.message}`)
      return res.status(500).json({ error: itemErr.message })
    }

    return res.status(200).json({
      recommendation_id: rec.id,
      status: 'awaiting_review',
      summary: parsed.summary,
      items: insertedItems,
      usage: {
        input_tokens: aiResponse.usage?.input_tokens ?? null,
        output_tokens: aiResponse.usage?.output_tokens ?? null,
      },
      model: aiResponse.model,
    })
  } catch (err: any) {
    console.error('[run-ai-recommendation] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
