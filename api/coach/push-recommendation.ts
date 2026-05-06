/**
 * POST /api/coach/push-recommendation
 * ────────────────────────────────────────────────────────────────────────────
 * Takes an approved (or awaiting-review) recommendation and pushes it as a
 * new routine to the COACH'S Hevy account, organized into a per-client
 * folder. The coach then uses Hevy Coach's "Assign Workout Program" UI to
 * deliver it to the client (which gives Hevy Coach completion tracking,
 * activity feed, etc).
 *
 * (Earlier versions pushed directly to the client's Hevy account using the
 * client's API key. That bypassed Hevy Coach entirely, leaving the coach
 * blind to whether the client adopted the routine. The current flow keeps
 * everything inside Hevy Coach's normal workflow.)
 *
 * Title format: "{Client name} — {Source routine title} — {Month Day, Year}"
 *   e.g. "Jared Fur — Upper A — May 5, 2026"
 * Folder: one per client, auto-created on first push, cached as
 *   training_clients.hevy_coach_folder_id.
 *
 * Hevy call: POST https://api.hevyapp.com/v1/routines with `{ routine: {…} }`,
 * authenticated via the coach's stored API key in
 * training_coach_hevy_connections.
 *
 * Out of scope (later phases):
 *   - week_plan mode currently pushes the first day_label group only;
 *     future phases will iterate and push N routines (one per training day)
 *     into the same per-client folder.
 *   - Promoting the pushed routine to a "Program" with auto-progression.
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
//
// Format: "{Client} — {Source routine title} — {Month Day, Year}"
// Example: "Jared Fur — Upper A — May 5, 2026"
//
// The em-dash separator (U+2014) makes the title visually distinct in the
// coach's Hevy library. Trailing date suffix from a previous push is
// stripped before re-stamping so re-pushing doesn't double up.

const MONTHS = [
  'January', 'February', 'March', 'April', 'May', 'June',
  'July', 'August', 'September', 'October', 'November', 'December',
]

// Matches " — Month D, YYYY" or " — Month DD, YYYY" at end of string.
const DATE_SUFFIX_RE = / — (?:January|February|March|April|May|June|July|August|September|October|November|December) \d{1,2}, \d{4}\s*$/

function todayLongDate(): string {
  const d = new Date()
  return `${MONTHS[d.getMonth()]} ${d.getDate()}, ${d.getFullYear()}`
}

function buildPushedTitle(
  clientName: string,
  sourceTitle: string | null | undefined,
): string {
  const base = (sourceTitle || 'KPI·FIT').replace(DATE_SUFFIX_RE, '').trim()
  return `${clientName} — ${base} — ${todayLongDate()}`
}

// ─── Per-client folder management on the coach's Hevy account ─────────────
//
// Each client gets one folder on the coach's Hevy library, named after the
// client. We cache the folder_id on training_clients.hevy_coach_folder_id
// so subsequent pushes don't re-call GET /v1/routine_folders.
//
// Order of operations on push:
//   1. If client.hevy_coach_folder_id is set, use it (fast path).
//   2. Else GET /v1/routine_folders, look for a folder titled with the
//      client's name. If found, cache and use.
//   3. Else POST /v1/routine_folders to create one, cache and use.

interface HevyFolder {
  id: number
  title: string
}

async function listAllHevyFolders(apiKey: string): Promise<HevyFolder[]> {
  const all: HevyFolder[] = []
  let page = 1
  while (page <= 20) {
    const r = await fetch(
      `https://api.hevyapp.com/v1/routine_folders?page=${page}&page_size=10`,
      { headers: { 'api-key': apiKey, accept: 'application/json' } },
    )
    if (r.status === 404 && page > 1) break // pagination exhausted
    if (!r.ok) throw new Error(`Hevy folder list failed: ${r.status}`)
    const data = await r.json()
    const folders: HevyFolder[] = (data.routine_folders || []).map((f: any) => ({
      id: Number(f.id),
      title: String(f.title || ''),
    }))
    all.push(...folders)
    if (folders.length < 10) break
    page++
  }
  return all
}

async function createHevyFolder(apiKey: string, title: string): Promise<number> {
  const r = await fetch('https://api.hevyapp.com/v1/routine_folders', {
    method: 'POST',
    headers: {
      'api-key': apiKey,
      'Content-Type': 'application/json',
      accept: 'application/json',
    },
    body: JSON.stringify({ routine_folder: { title } }),
  })
  if (!r.ok) {
    const txt = await r.text().catch(() => '')
    throw new Error(`Hevy folder create failed: ${r.status} ${txt}`)
  }
  const data = await r.json()
  // Hevy returns either { routine_folder: { id } } or { id }.
  const id = data?.routine_folder?.id ?? data?.id
  if (typeof id !== 'number') {
    throw new Error('Hevy folder create: no id in response')
  }
  return id
}

async function ensureClientFolder(
  apiKey: string,
  client: { id: string; name: string; hevy_coach_folder_id: number | null },
): Promise<number> {
  // Fast path: cached id.
  if (client.hevy_coach_folder_id != null) return client.hevy_coach_folder_id

  // Slow path: probe for existing folder by name (in case the coach already
  // created one manually), else create a new one.
  const existing = await listAllHevyFolders(apiKey)
  const match = existing.find(
    (f) => f.title.trim().toLowerCase() === client.name.trim().toLowerCase(),
  )
  const folderId = match ? match.id : await createHevyFolder(apiKey, client.name)

  // Cache for next time.
  await supabase
    .from('training_clients')
    .update({ hevy_coach_folder_id: folderId })
    .eq('id', client.id)

  return folderId
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

  // Need a template_id — Hevy requires one. Use ONLY the row's resolved
  // exercise_template_id; do NOT fall back to current_json.exercise_template_id.
  //
  // The fallback used to make sense when AI omitted template_id for slots that
  // mapped to existing exercises. But after we added server-side validation
  // that NULLs out mismatched template_ids, the fallback would resurrect the
  // original (wrong) template — pushing the wrong exercise on Hevy under a
  // different title. For substitutes especially this was unsafe: an item
  // titled "Lateral Raise (Cable)" with a nullified template_id would fall
  // back to the original "Single Arm Triceps Pushdown" template_id from the
  // current slot.
  //
  // If item.exercise_template_id is null, we return null here so the caller
  // drops the item and reports it as needing manual resolution. The coach
  // must Edit the item in the UI to pick a valid template before pushing.
  const templateId = item.exercise_template_id
  if (!templateId) {
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
      // Other exercises: snap to nearest 5-lb increment. US gyms load in
      // 5-lb plates; 1-lb resolution lands on numbers no plate combo can
      // make (e.g. "232 lbs"). Coach can always Edit a set to use 2.5-lb
      // microplates if needed.
      weight_kg: kgNative ? s?.weight_kg ?? null : snapTo5LbKg(s?.weight_kg),
      reps: s?.reps ?? null,
      distance_meters: s?.distance_meters ?? null,
      duration_seconds: s?.duration_seconds ?? null,
      custom_metric: s?.custom_metric ?? null,
      // Note: Hevy's POST /v1/routines does NOT accept `rpe` on sets.
      // It's only stored on completed workouts (GET /v1/workouts), not on
      // routine templates. Sending it triggers a validation error.
    })),
  }
}

/**
 * Snap a kg weight to the nearest 5-lb plate-math increment.
 *
 * US gyms load in 5-lb plates. The AI reasons in kg (Hevy's storage unit)
 * and often proposes values like 47.6 kg or 105.5 kg — convert to lbs and
 * those land on 105 lbs (clean) or 232.5 lbs (no plate combo). Round to
 * the nearest 5-lb multiple, then convert back to the kg value Hevy will
 * render as exactly that lb number in the client's app.
 *
 * Examples:
 *   47.627 kg (105 lbs) -> 47.627 kg (still 105 lbs)
 *   105.5 kg (232.6 lbs) -> 104.326 kg (230 lbs)
 *   46 kg (101.4 lbs)    -> 45.359 kg (100 lbs)
 *
 * If the coach wants 2.5-lb microplate precision they can Edit the set
 * by hand.
 */
function snapTo5LbKg(kg: number | null | undefined): number | null {
  if (kg == null) return null
  if (!Number.isFinite(kg)) return null
  if (kg === 0) return 0
  const lbs = Math.round((kg * 2.20462) / 5) * 5
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

    // ── Coach Hevy connection + key decrypt ──────────────────────────
    // Push lands on the COACH'S Hevy library (not the client's). The coach
    // then assigns it via Hevy Coach UI. Requires the coach to have
    // connected their Hevy Pro API key via /api/coach/connect-hevy.
    const { data: conn } = await supabase
      .from('training_coach_hevy_connections')
      .select('hevy_api_key_encrypted, connection_status')
      .eq('coach_id', coach.id)
      .single()
    if (!conn) {
      return res.status(404).json({
        error:
          'Connect your Hevy Pro account first. Open Settings → Hevy connection and paste your API key.',
        error_code: 'COACH_HEVY_NOT_CONNECTED',
      })
    }
    if (conn.connection_status === 'expired') {
      return res.status(400).json({
        error: 'Your Hevy API key was rejected. Reconnect in Settings.',
        error_code: 'COACH_HEVY_KEY_EXPIRED',
      })
    }
    const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)

    // ── Client info: name (for title + folder) and cached folder_id ──
    const { data: client, error: clientErr } = await supabase
      .from('training_clients')
      .select('id, name, hevy_coach_folder_id')
      .eq('id', rec.client_id)
      .single()
    if (clientErr || !client) {
      return res.status(404).json({ error: 'Client not found' })
    }

    // ── Folder: get-or-create on the coach's account ─────────────────
    let folderId: number
    try {
      folderId = await ensureClientFolder(apiKey, {
        id: client.id,
        name: client.name,
        hevy_coach_folder_id: client.hevy_coach_folder_id,
      })
    } catch (err: any) {
      return res.status(502).json({
        error: `Hevy folder setup failed: ${err?.message || err}`,
        error_code: 'HEVY_FOLDER_FAILED',
      })
    }

    // ── Title ──────────────────────────────────────────────────────────
    const sourceTitle: string | null =
      (rec.ai_snapshot?.current_hevy_routines?.[0]?.title as string | null) ?? null
    const title = buildPushedTitle(client.name, sourceTitle)

    // ── Push ──────────────────────────────────────────────────────────
    const payload = {
      routine: {
        title,
        folder_id: folderId,
        notes: routine_notes || `Generated by KPI·FIT Coach for ${client.name}`,
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
