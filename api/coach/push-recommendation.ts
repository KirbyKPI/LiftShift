/**
 * POST /api/coach/push-recommendation
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 4a — takes an approved (or awaiting-review) recommendation and pushes
 * it as a new dated routine to the client's Hevy account using their stored
 * API key.
 *
 * Title convention: keep the source routine's existing name (or fallback to
 *   "KPI·FIT") and append the current date as " MM.DD.YY". A trailing
 *   date suffix from a prior push is stripped first so we don't double-stamp.
 *
 * Hevy push: POST https://api.hevyapp.com/v1/routines with `{ routine: {…} }`.
 * The created routine appears on the client's Hevy account as a new
 * standalone routine — they can start it from the app immediately.
 *
 * Out of scope (later phases):
 *   - Per-item accept/edit/reject UI (we currently push every item that
 *     doesn't have coach_action='reject')
 *   - week_plan mode, which produces multiple routines (one per day) —
 *     v1 pushes the first day_label group only; future phases will iterate
 *     and push N routines.
 *   - Promoting the pushed routine to a "Program" with auto-progression
 *     (Phase 4b/4c)
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const config = { maxDuration: 60 }

// ─── Decrypt (mirrors api/hevy/sync.ts; same encryption key) ───────────────
async function decryptApiKey(encrypted: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)),
  ).slice(0, 32)
  const [ivHex, ctHex] = encrypted.split(':')
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const ct = new Uint8Array(ctHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

// ─── Title helpers ─────────────────────────────────────────────────────────

const DATE_SUFFIX_RE = /\s+\d{2}\.\d{2}\.\d{2}\s*$/

function todayMmDdYy(): string {
  const d = new Date()
  const mm = String(d.getMonth() + 1).padStart(2, '0')
  const dd = String(d.getDate()).padStart(2, '0')
  const yy = String(d.getFullYear() % 100).padStart(2, '0')
  return `${mm}.${dd}.${yy}`
}

function buildPushedTitle(sourceTitle: string | null | undefined): string {
  const base = (sourceTitle || 'KPI·FIT').replace(DATE_SUFFIX_RE, '').trim()
  return `${base} ${todayMmDdYy()}`
}

// ─── Hevy payload construction ─────────────────────────────────────────────

interface ItemRow {
  position: number
  exercise_template_id: string | null
  exercise_title: string
  current_json: any
  proposed_json: any
  coach_action: 'pending' | 'accept' | 'edit' | 'reject' | 'substitute'
  coach_edited_json: any
  day_label: string | null
}

interface HevyExerciseInput {
  exercise_template_id: string
  superset_id: number | null
  rest_seconds: number | null
  notes: string
  sets: Array<{
    type: string
    weight_kg: number | null
    reps: number | null
    distance_meters: number | null
    duration_seconds: number | null
    custom_metric: number | null
    rpe: number | null
  }>
}

/** Pick the final json the coach approved — coach_edited_json wins when
 *  edit/substitute, otherwise proposed_json. */
function effectiveExerciseJson(item: ItemRow): any {
  if ((item.coach_action === 'edit' || item.coach_action === 'substitute') && item.coach_edited_json) {
    return item.coach_edited_json
  }
  return item.proposed_json
}

// Kettlebell-loaded exercises live in kg increments; everything else lives
// in lbs (US default for our coach base). Mirrored client-side in
// frontend/pages/coach/exerciseUnits.ts.
const KG_NATIVE_PATTERN =
  /\b(kettlebell|kettlebells|kb|farmer'?s?\s*walk|farmer'?s?\s*carry|farmer\s*walk)\b/i

function isKgNativeExercise(title: string | null | undefined): boolean {
  if (!title) return false
  return KG_NATIVE_PATTERN.test(title)
}

function toHevyExercise(item: ItemRow): HevyExerciseInput | null {
  const ex = effectiveExerciseJson(item)
  if (!ex) return null

  // Need a template_id — Hevy requires one. Fall back to current slot's id.
  const templateId =
    item.exercise_template_id ||
    item.current_json?.exercise_template_id ||
    ex?.exercise_template_id
  if (!templateId) {
    // Caller filters these out — represents a novel slot that we can't push
    // without resolving template_id. For Phase 4a we drop them and surface
    // a warning in the response.
    return null
  }

  const kgNative = isKgNativeExercise(item.exercise_title)
  const sets = Array.isArray(ex?.sets) ? ex.sets : []
  return {
    exercise_template_id: templateId,
    superset_id:
      ex?.superset_id === undefined || ex?.superset_id === null
        ? null
        : Number(ex.superset_id) || null,
    rest_seconds: ex?.rest_seconds ?? null,
    notes: typeof ex?.notes === 'string' ? ex.notes : '',
    sets: sets.map((s: any) => ({
      type: s?.type || 'normal',
      // Kettlebell-loaded exercises: keep the kg as-is (16/20/24 etc).
      // Other exercises: snap to nearest whole-pound equivalent so Hevy
      // displays clean values for clients on lbs preference.
      weight_kg: kgNative ? s?.weight_kg ?? null : snapToWholePoundKg(s?.weight_kg),
      reps: s?.reps ?? null,
      distance_meters: s?.distance_meters ?? null,
      duration_seconds: s?.duration_seconds ?? null,
      custom_metric: s?.custom_metric ?? null,
      rpe: s?.rpe ?? null,
    })),
  }
}

/**
 * Snap a kg weight to the nearest whole-pound equivalent.
 *
 * Claude often proposes weights like 47.6 kg because that's what it sees in
 * the client's logs (Hevy stores 105 lbs as 47.627 kg internally). Pushing
 * 47.6 kg back would have Hevy display 104.9 lbs — slightly off. Round-trip
 * through whole pounds so the prescription is clean: 47.6 kg → 105 lbs →
 * 47.627 kg, which Hevy renders as exactly 105 lbs in the client's app.
 */
function snapToWholePoundKg(kg: number | null | undefined): number | null {
  if (kg == null) return null
  if (!Number.isFinite(kg)) return null
  if (kg === 0) return 0
  const lbs = Math.round(kg * 2.20462)
  return Math.round((lbs / 2.20462) * 1000) / 1000
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { recommendation_id, coach_token, routine_notes } = (req.body || {}) as {
    recommendation_id?: string
    coach_token?: string
    routine_notes?: string
  }

  if (!recommendation_id || !coach_token) {
    return res.status(400).json({ error: 'recommendation_id and coach_token required' })
  }

  try {
    // ── Auth ────────────────────────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    // ── Recommendation ─────────────────────────────────────────────────
    const { data: rec, error: recErr } = await supabase
      .from('training_coach_recommendations')
      .select(
        'id, client_id, coach_id, status, ai_snapshot, adjustment_level',
      )
      .eq('id', recommendation_id)
      .single()
    if (recErr || !rec) return res.status(404).json({ error: 'Recommendation not found' })
    if (rec.coach_id !== coach.id) {
      return res.status(403).json({ error: 'Not your recommendation' })
    }
    if (rec.status === 'pushed') {
      return res.status(409).json({ error: 'Already pushed; create a new recommendation' })
    }

    // ── Items (filter out rejected) ────────────────────────────────────
    const { data: rawItems, error: itemsErr } = await supabase
      .from('training_coach_recommendation_items')
      .select(
        'position, exercise_template_id, exercise_title, current_json, proposed_json, coach_action, coach_edited_json, day_label',
      )
      .eq('recommendation_id', rec.id)
      .order('position', { ascending: true })

    if (itemsErr) return res.status(500).json({ error: itemsErr.message })

    const items = (rawItems || []) as ItemRow[]
    const accepted = items.filter((i) => i.coach_action !== 'reject')
    if (accepted.length === 0) {
      return res.status(400).json({ error: 'No items to push (all rejected or empty)' })
    }

    // For week_plan, pick the first day_label group. v1 pushes single
    // routine; multi-day support is a follow-up.
    let pushSet = accepted
    if (rec.adjustment_level === 'week_plan') {
      const firstDay = accepted.find((i) => i.day_label)?.day_label || null
      pushSet = firstDay
        ? accepted.filter((i) => i.day_label === firstDay)
        : accepted
    }

    // Convert items to Hevy exercise blocks; drop any without a template_id.
    const hevyExercises: HevyExerciseInput[] = []
    const droppedNovel: string[] = []
    for (const item of pushSet) {
      const ex = toHevyExercise(item)
      if (ex) hevyExercises.push(ex)
      else droppedNovel.push(item.exercise_title)
    }
    if (hevyExercises.length === 0) {
      return res.status(400).json({
        error: 'No pushable items — every approved exercise is missing a template_id',
        dropped_novel: droppedNovel,
      })
    }

    // ── Title ──────────────────────────────────────────────────────────
    const sourceTitle: string | null =
      (rec.ai_snapshot?.current_hevy_routines?.[0]?.title as string | null) ?? null
    const title = buildPushedTitle(sourceTitle)

    // ── Hevy connection + key decrypt ─────────────────────────────────
    const { data: conn } = await supabase
      .from('training_hevy_connections')
      .select('hevy_api_key_encrypted, connection_status')
      .eq('client_id', rec.client_id)
      .single()
    if (!conn) return res.status(404).json({ error: 'No Hevy connection for client' })
    if (conn.connection_status === 'expired') {
      return res.status(400).json({ error: 'Client Hevy API key expired' })
    }
    const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)

    // ── Push ──────────────────────────────────────────────────────────
    const payload = {
      routine: {
        title,
        folder_id: null,
        notes: routine_notes || `Generated by KPI·FIT Coach`,
        exercises: hevyExercises,
      },
    }

    let hevyResponse: any
    let hevyStatus: number
    try {
      const res2 = await fetch('https://api.hevyapp.com/v1/routines', {
        method: 'POST',
        headers: {
          'api-key': apiKey,
          'Content-Type': 'application/json',
          accept: 'application/json',
        },
        body: JSON.stringify(payload),
      })
      hevyStatus = res2.status
      hevyResponse = await res2.json().catch(() => ({}))
    } catch (err: any) {
      // Network error — write a failed audit row so it's visible.
      await supabase.from('training_coach_routine_push_audit').insert({
        recommendation_id: rec.id,
        client_id: rec.client_id,
        coach_id: coach.id,
        hevy_routine_id: null,
        hevy_routine_title: title,
        payload_sent: payload,
        response_received: { error: err?.message || String(err) },
        status: 'failed',
        error_message: err?.message || 'Hevy push network error',
      })
      return res.status(502).json({ error: err?.message || 'Hevy push failed' })
    }

    if (hevyStatus < 200 || hevyStatus >= 300) {
      const msg = hevyResponse?.error || `Hevy returned ${hevyStatus}`
      await supabase.from('training_coach_routine_push_audit').insert({
        recommendation_id: rec.id,
        client_id: rec.client_id,
        coach_id: coach.id,
        hevy_routine_id: null,
        hevy_routine_title: title,
        payload_sent: payload,
        response_received: hevyResponse,
        status: 'failed',
        error_message: msg,
      })
      return res.status(502).json({ error: msg, hevy_response: hevyResponse })
    }

    // Hevy returns the created routine. Shape:
    //   { routine: [ { id, title, folder_id, ... } ] } or single object.
    const hevyRoutineId =
      hevyResponse?.routine?.id ||
      hevyResponse?.id ||
      hevyResponse?.routine?.[0]?.id ||
      null

    const isPartial = droppedNovel.length > 0
    const auditStatus: 'success' | 'partial' = isPartial ? 'partial' : 'success'

    await supabase.from('training_coach_routine_push_audit').insert({
      recommendation_id: rec.id,
      client_id: rec.client_id,
      coach_id: coach.id,
      hevy_routine_id: hevyRoutineId,
      hevy_routine_title: title,
      payload_sent: payload,
      response_received: hevyResponse,
      status: auditStatus,
      error_message: isPartial
        ? `Dropped ${droppedNovel.length} item(s) without template_id: ${droppedNovel.join(', ')}`
        : null,
    })

    await supabase
      .from('training_coach_recommendations')
      .update({ status: 'pushed', pushed_at: new Date().toISOString() })
      .eq('id', rec.id)

    return res.status(200).json({
      hevy_routine_id: hevyRoutineId,
      hevy_routine_title: title,
      pushed_exercises: hevyExercises.length,
      dropped_novel: droppedNovel,
      status: auditStatus,
    })
  } catch (err: any) {
    console.error('[push-recommendation] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
