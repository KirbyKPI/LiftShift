/**
 * POST /api/coach/substitute-item
 * ────────────────────────────────────────────────────────────────────────────
 * Per-item secondary AI call. The coach has decided one slot in the
 * recommendation isn't right (wrong exercise for the goal, equipment they
 * don't have, fatigue/redundancy with another slot, etc.) and wants Claude
 * to propose ONE alternative for just that slot.
 *
 * Request:
 *   {
 *     item_id: string,
 *     coach_token: string,
 *     reason?: string         // optional free-text the coach types in
 *   }
 *
 * Response:
 *   {
 *     alternative: {
 *       exercise_template_id: string | null,
 *       exercise_title: string,
 *       proposed: {            // Hevy-shaped exercise block
 *         sets, rest_seconds, notes, ...
 *       },
 *       rationale: string
 *     },
 *     usage: { input_tokens, output_tokens },
 *     model: string
 *   }
 *
 * Storage: writes the alternative into substitution_context on the item.
 * Coach can then click Accept on the alternative, which sets coach_action='substitute'
 * and copies the alternative into coach_edited_json (push uses that).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'
import Anthropic from '@anthropic-ai/sdk'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const config = { maxDuration: 120 }

const DEFAULT_MODEL = 'claude-opus-4-6'

const SYSTEM_PROMPT = `
You are a strength coach. The coach is reviewing your routine proposal and
wants to substitute ONE specific exercise slot for an alternative. They've
explained why. Your job: propose a single replacement exercise that:

- Trains the same primary movement pattern / muscle group, OR addresses the
  coach's stated reason (e.g. equipment swap, injury accommodation).
- Uses the same prescription philosophy as the original (similar rep range,
  similar loading scheme, same rest interval).
- Picks an exercise_template_id that appears in the client's snapshot
  (recent_workout_sets or current_hevy_routines) when possible — those are
  exercises the client has equipment access to and Hevy has cataloged. If
  no good match exists, set exercise_template_id to null and pick a clear
  exercise_title; the coach will resolve.

Call the propose_substitute tool exactly once with your suggestion. Do not
write prose outside the tool call.
`.trim()

const PROPOSE_TOOL = {
  name: 'propose_substitute',
  description: 'Submit a single alternative exercise for the slot the coach wants to swap.',
  input_schema: {
    type: 'object' as const,
    properties: {
      exercise_template_id: {
        type: ['string', 'null'],
        description:
          'Hevy exercise_template_id. Prefer one from the snapshot. Null only if proposing a novel exercise not in the snapshot.',
      },
      exercise_title: { type: 'string' },
      proposed: {
        type: 'object',
        description: 'Hevy-shaped exercise block — same shape as propose_routine_adjustment.proposed.',
        properties: {
          rest_seconds: { type: ['integer', 'null'] },
          notes: { type: ['string', 'null'] },
          superset_id: { type: ['integer', 'null'] },
          sets: {
            type: 'array',
            items: {
              type: 'object',
              properties: {
                type: { type: 'string', enum: ['warmup', 'normal', 'failure', 'dropset'] },
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
          "Why this specific alternative addresses the coach's reason. Cite the data or the swap logic.",
      },
    },
    required: ['exercise_template_id', 'exercise_title', 'proposed', 'rationale'],
  },
} as const

function buildUserMessage(
  snapshot: any,
  originalSlot: { exercise_title: string; exercise_template_id: string | null; proposed_json: any },
  reason: string | null,
): string {
  return [
    `The coach is replacing ONE slot in the routine and wants a single alternative.`,
    '',
    `ORIGINAL SLOT (the one to replace):`,
    `Exercise: ${originalSlot.exercise_title}`,
    originalSlot.exercise_template_id ? `Template id: ${originalSlot.exercise_template_id}` : '',
    `Original proposal:`,
    '```json',
    JSON.stringify(originalSlot.proposed_json, null, 2),
    '```',
    '',
    reason && reason.trim()
      ? `COACH'S REASON FOR SUBSTITUTING:\n${reason.trim()}`
      : `COACH'S REASON: (not specified — pick a sensible swap based on the data)`,
    '',
    '---',
    '',
    `CLIENT SNAPSHOT (for context):`,
    '```json',
    JSON.stringify(snapshot, null, 2),
    '```',
  ]
    .filter(Boolean)
    .join('\n')
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { item_id, coach_token, reason } = (req.body || {}) as {
    item_id?: string
    coach_token?: string
    reason?: string
  }

  if (!item_id || !coach_token) {
    return res.status(400).json({ error: 'item_id and coach_token required' })
  }
  if (!process.env.ANTHROPIC_API_KEY) {
    return res.status(500).json({ error: 'ANTHROPIC_API_KEY not configured on server' })
  }

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    const { data: item, error: itemErr } = await supabase
      .from('training_coach_recommendation_items')
      .select(
        'id, recommendation_id, exercise_title, exercise_template_id, proposed_json',
      )
      .eq('id', item_id)
      .single()
    if (itemErr || !item) return res.status(404).json({ error: 'Item not found' })

    const { data: rec } = await supabase
      .from('training_coach_recommendations')
      .select('id, coach_id, ai_snapshot')
      .eq('id', item.recommendation_id)
      .single()
    if (!rec) return res.status(404).json({ error: 'Parent recommendation not found' })
    if (rec.coach_id !== coach.id) return res.status(403).json({ error: 'Not your recommendation' })

    const anthropic = new Anthropic({ apiKey: process.env.ANTHROPIC_API_KEY! })
    const userMessage = buildUserMessage(
      rec.ai_snapshot,
      {
        exercise_title: item.exercise_title,
        exercise_template_id: item.exercise_template_id,
        proposed_json: item.proposed_json,
      },
      reason ?? null,
    )

    const aiResponse = await anthropic.messages.create({
      model: DEFAULT_MODEL,
      max_tokens: 4000,
      system: SYSTEM_PROMPT,
      tools: [PROPOSE_TOOL as unknown as Anthropic.Messages.Tool],
      tool_choice: { type: 'tool', name: PROPOSE_TOOL.name },
      messages: [{ role: 'user', content: userMessage }],
    })

    const toolBlock = aiResponse.content.find(
      (c) => c.type === 'tool_use' && c.name === PROPOSE_TOOL.name,
    ) as Anthropic.Messages.ToolUseBlock | undefined

    if (!toolBlock) {
      return res
        .status(502)
        .json({ error: 'Claude did not return a substitute', stop_reason: aiResponse.stop_reason })
    }

    const alternative = toolBlock.input as {
      exercise_template_id: string | null
      exercise_title: string
      proposed: any
      rationale: string
    }

    // Stash the alternative on the item so the UI can render it without
    // re-querying. Doesn't change coach_action yet — the coach still has
    // to accept the substitute.
    await supabase
      .from('training_coach_recommendation_items')
      .update({
        substitution_context: {
          alternative,
          reason: reason ?? null,
          generated_at: new Date().toISOString(),
        },
      })
      .eq('id', item_id)

    return res.status(200).json({
      alternative,
      usage: {
        input_tokens: aiResponse.usage?.input_tokens ?? null,
        output_tokens: aiResponse.usage?.output_tokens ?? null,
      },
      model: aiResponse.model,
    })
  } catch (err: any) {
    console.error('[substitute-item] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
