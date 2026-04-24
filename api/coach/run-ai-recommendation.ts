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

// ─── Prompt building ───────────────────────────────────────────────────────

type AdjustmentLevel = 'load_only' | 'load_plus_swap' | 'full_authoring'

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
`.trim(),
}

const SYSTEM_PROMPT = `
You are an experienced strength and hypertrophy coach reviewing a client's
recent training data to propose adjustments for their next training block.

You will be given a JSON snapshot with:
- The client's profile and coach-written notes (goals, injuries, preferences)
- Computed dashboard insights (muscle coverage, stagnation flags, PR trajectory)
- Recent workout sets (last 12 weeks)
- Their current Hevy routine(s)
- Per-workout and per-exercise notes the client wrote themselves in Hevy

Your job is to propose a specific, actionable update to their routine and
submit it via the propose_routine_adjustment tool. Coaching principles:

- PROGRESS LOADS INCREMENTALLY. Top-end working-set jumps of >5% on compounds
  or >10% on isolations usually fail. When in doubt, add a rep before adding
  weight.
- RESPECT ADHERENCE. If the client hasn't been hitting a target consistently,
  don't push it harder — back off, change the stimulus, or address the root.
- FIX OBVIOUS IMBALANCES first. If an antagonist is under-stimulated relative
  to its agonist (e.g. rows vs presses), close that gap before piling more
  volume on the dominant pattern.
- NEVER PRESCRIBE RPE > 9 ON A COMPOUND unless the client's history shows
  they tolerate it and hit their targets reliably.
- BE HONEST about uncertainty. If the data doesn't support a specific change,
  say so in the rationale rather than inventing a reason.

Call the propose_routine_adjustment tool exactly once with your full proposal.
Do not produce any prose outside the tool call — the coach will review in a
diff UI that reads the tool_use input.
`.trim()

function buildUserMessage(snapshot: any, adjustmentLevel: AdjustmentLevel): string {
  return [
    SCOPE_GUIDANCE[adjustmentLevel],
    '',
    '---',
    '',
    'CLIENT SNAPSHOT:',
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
  ].join('\n')
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

  if (item.matched_current_slot_position != null) {
    const byPosition = exercises.find((ex) => (ex.index ?? -1) + 1 === item.matched_current_slot_position)
    if (byPosition) return byPosition
  }

  if (item.exercise_template_id) {
    const byTemplate = exercises.find((ex) => ex.exercise_template_id === item.exercise_template_id)
    if (byTemplate) return byTemplate
  }

  const titleLc = (item.exercise_title || '').toLowerCase()
  const byTitle = exercises.find((ex) => (ex.title || '').toLowerCase() === titleLc)
  return byTitle ?? null
}

async function updateRecommendationFailed(id: string, msg: string): Promise<void> {
  await supabase
    .from('training_coach_recommendations')
    .update({ status: 'failed', error_message: msg })
    .eq('id', id)
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
      .select('id, client_id, coach_id, adjustment_level, status, ai_snapshot')
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
    const userMessage = buildUserMessage(rec.ai_snapshot, rec.adjustment_level as AdjustmentLevel)

    let aiResponse: Anthropic.Messages.Message
    try {
      aiResponse = await anthropic.messages.create({
        model: model || DEFAULT_MODEL,
        max_tokens: 8000,
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
      await updateRecommendationFailed(rec.id, msg)
      return res.status(502).json({ error: msg, raw: aiResponse })
    }

    const parsed = toolBlock.input as ToolInput
    if (!parsed?.items || !Array.isArray(parsed.items) || parsed.items.length === 0) {
      const msg = 'Claude returned no items in its proposal.'
      await updateRecommendationFailed(rec.id, msg)
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
