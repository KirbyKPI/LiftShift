/**
 * POST /api/coach/generate-recommendation
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 1 — builds the AI-input snapshot for a client, writes a row to
 * `training_coach_recommendations` with status='draft', returns the
 * recommendation id + the snapshot (so the caller can sanity-check the
 * payload before we add the actual Claude call in Phase 2).
 *
 * Request body:
 *   {
 *     client_id: string,
 *     adjustment_level: 'load_only' | 'load_plus_swap' | 'full_authoring',
 *     insights_summary: any,     // frontend-computed; opaque to backend
 *     coach_token: string,       // Supabase access token
 *     coach_note?: string        // optional human note on this gen
 *   }
 *
 * Response:
 *   { recommendation_id, snapshot, status: 'draft' }
 *
 * Server-side responsibilities:
 *   1. Verify the coach_token and that the coach owns this client.
 *   2. Pull client record + notes from Supabase.
 *   3. Pull recent cached sets (last 12 weeks).
 *   4. Decrypt the client's Hevy API key and fetch their current routines.
 *   5. Stitch everything into a single snapshot JSON.
 *   6. Persist the snapshot + return.
 *
 * Out of scope (Phase 2+):
 *   - Calling Anthropic.
 *   - Generating recommendation_items (Phase 2 writes those from the AI
 *     response).
 *   - Any Hevy write endpoints (Phase 4).
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── Decrypt (copied from api/hevy/sync.ts — same encryption key) ──────────
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

// ─── Hevy routines fetch ───────────────────────────────────────────────────

interface HevyRoutineExercise {
  index: number
  title: string
  rest_seconds: number | null
  notes: string | null
  exercise_template_id: string
  superset_id: number | null
  sets: Array<{
    index: number
    type: string
    weight_kg: number | null
    reps: number | null
    distance_meters: number | null
    duration_seconds: number | null
    rpe: number | null
    custom_metric: unknown
  }>
}

interface HevyRoutine {
  id: string
  title: string
  folder_id: number | null
  updated_at: string
  created_at: string
  exercises: HevyRoutineExercise[]
}

async function fetchAllRoutines(apiKey: string): Promise<HevyRoutine[]> {
  const all: HevyRoutine[] = []
  let page = 1
  const pageSize = 10

  // Hard cap pages so a weirdly-populated account can't run us out of time.
  const MAX_PAGES = 20

  while (page <= MAX_PAGES) {
    const res = await fetch(
      `https://api.hevyapp.com/v1/routines?page=${page}&page_size=${pageSize}`,
      { headers: { 'api-key': apiKey, accept: 'application/json' } },
    )
    if (res.status === 401) throw new Error('API_KEY_EXPIRED')
    if (!res.ok) throw new Error(`Hevy API error fetching routines: ${res.status}`)

    const data = await res.json()
    const routines: HevyRoutine[] = data.routines || []
    all.push(...routines)

    if (routines.length < pageSize || page >= (data.page_count || 1)) break
    page++
    await new Promise((r) => setTimeout(r, 150))
  }

  return all
}

// ─── Snapshot shape ────────────────────────────────────────────────────────

type AdjustmentLevel =
  | 'load_only'
  | 'load_plus_swap'
  | 'full_authoring'
  | 'overhaul'
  | 'week_plan'

interface Snapshot {
  version: 1
  generated_at: string
  adjustment_level: AdjustmentLevel
  client: {
    id: string
    name: string
    email: string | null
    notes: string | null
  }
  insights_summary: unknown // Frontend-provided; opaque here.
  current_hevy_routines: HevyRoutine[]
  recent_workout_sets: RecentSetSummary[]
  hevy_workout_notes: HevyWorkoutNote[]
}

interface RecentSetSummary {
  workout_date: string
  workout_name: string
  exercise_title: string
  exercise_template_id: string | null
  set_index: number
  set_type: string
  weight_kg: number | null
  reps: number | null
  rpe: number | null
  duration_seconds: number | null
}

interface HevyWorkoutNote {
  workout_date: string
  workout_name: string
  workout_description: string | null
  per_exercise_notes: Array<{
    exercise_title: string
    notes: string
  }>
}

// ─── Pull recent cached sets ───────────────────────────────────────────────

async function fetchRecentSetSummaries(
  clientId: string,
  weeksBack: number,
): Promise<RecentSetSummary[]> {
  const sinceIso = new Date(Date.now() - weeksBack * 7 * 86400_000)
    .toISOString()
    .slice(0, 10)

  const { data: cached } = await supabase
    .from('training_workout_cache')
    .select('exercises, workout_date, workout_name, duration_seconds')
    .eq('client_id', clientId)
    .gte('workout_date', sinceIso)
    .order('workout_date', { ascending: false })

  const summaries: RecentSetSummary[] = []
  for (const c of cached || []) {
    const exercises: any[] = Array.isArray(c.exercises) ? c.exercises : []
    for (const ex of exercises) {
      const sets: any[] = Array.isArray(ex.sets) ? ex.sets : []
      for (const s of sets) {
        summaries.push({
          workout_date: c.workout_date,
          workout_name: c.workout_name || 'Workout',
          exercise_title: ex.title || ex.exercise_name || '',
          exercise_template_id: ex.exercise_template_id ?? null,
          set_index: s.index ?? 0,
          set_type: s.set_type || 'normal',
          weight_kg: s.weight_kg ?? null,
          reps: s.reps ?? null,
          rpe: s.rpe ?? null,
          duration_seconds: s.duration_seconds ?? null,
        })
      }
    }
  }
  return summaries
}

// ─── Pull Hevy-side notes (per-workout description + per-exercise notes) ───

async function fetchHevyWorkoutNotes(
  clientId: string,
  weeksBack: number,
): Promise<HevyWorkoutNote[]> {
  const sinceIso = new Date(Date.now() - weeksBack * 7 * 86400_000)
    .toISOString()
    .slice(0, 10)

  const { data: cached } = await supabase
    .from('training_workout_cache')
    .select('workout_date, workout_name, exercises')
    .eq('client_id', clientId)
    .gte('workout_date', sinceIso)
    .order('workout_date', { ascending: false })

  const notes: HevyWorkoutNote[] = []
  for (const c of cached || []) {
    const exercises: any[] = Array.isArray(c.exercises) ? c.exercises : []

    const perExercise: HevyWorkoutNote['per_exercise_notes'] = []
    for (const ex of exercises) {
      if (typeof ex?.notes === 'string' && ex.notes.trim()) {
        perExercise.push({
          exercise_title: ex.title || '',
          notes: ex.notes.trim(),
        })
      }
    }

    // `description` isn't currently stored on the cache row. If/when we
    // start persisting it we can pick it up here without a schema change
    // on the API side.
    const workoutDescription = null

    if (workoutDescription || perExercise.length > 0) {
      notes.push({
        workout_date: c.workout_date,
        workout_name: c.workout_name || 'Workout',
        workout_description: workoutDescription,
        per_exercise_notes: perExercise,
      })
    }
  }
  return notes
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const {
    client_id,
    adjustment_level,
    insights_summary,
    coach_token,
    coach_note,
    target_routine_id,
    focus_prompt,
    plan_preferences,
  } = (req.body || {}) as {
    client_id?: string
    adjustment_level?: AdjustmentLevel
    insights_summary?: unknown
    coach_token?: string
    coach_note?: string
    target_routine_id?: string
    focus_prompt?: string
    plan_preferences?: Record<string, unknown>
  }

  if (!client_id || !coach_token || !adjustment_level) {
    return res.status(400).json({
      error: 'client_id, coach_token, and adjustment_level required',
    })
  }

  const validLevels: AdjustmentLevel[] = [
    'load_only',
    'load_plus_swap',
    'full_authoring',
    'overhaul',
    'week_plan',
  ]
  if (!validLevels.includes(adjustment_level)) {
    return res.status(400).json({ error: `adjustment_level must be one of ${validLevels.join(', ')}` })
  }

  // overhaul and week_plan need SOME coach intent — either structured
  // plan_preferences, a focus_prompt, or ideally both. Reject if completely
  // empty so Claude isn't guessing.
  const hasStructuredPrefs =
    plan_preferences &&
    typeof plan_preferences === 'object' &&
    Object.keys(plan_preferences).length > 0
  if (
    (adjustment_level === 'overhaul' || adjustment_level === 'week_plan') &&
    !hasStructuredPrefs &&
    (!focus_prompt || !focus_prompt.trim())
  ) {
    return res.status(400).json({
      error: `${adjustment_level} requires plan_preferences or focus_prompt describing the coach's intent`,
    })
  }

  try {
    // Auth: coach must be signed in and own the client.
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id, display_name')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile for this user' })

    const { data: client } = await supabase
      .from('training_clients')
      .select('id, name, email, notes, coach_id')
      .eq('id', client_id)
      .single()
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (client.coach_id !== coach.id) {
      return res.status(403).json({ error: 'Client does not belong to this coach' })
    }

    // Fetch current Hevy routines for this client. Best-effort — if Hevy
    // auth fails we still write the row so the coach can see the failure
    // surface in the UI.
    let currentRoutines: HevyRoutine[] = []
    let routineFetchError: string | null = null
    try {
      const { data: conn } = await supabase
        .from('training_hevy_connections')
        .select('hevy_api_key_encrypted, connection_status')
        .eq('client_id', client_id)
        .single()

      if (!conn) {
        routineFetchError = 'No Hevy connection for this client'
      } else if (conn.connection_status === 'expired') {
        routineFetchError = 'Client Hevy API key expired'
      } else {
        const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)
        currentRoutines = await fetchAllRoutines(apiKey)
      }
    } catch (err: any) {
      routineFetchError = err?.message || 'Unknown Hevy error'
    }

    // Context bundles for the AI (backfill-safe defaults).
    const recent_workout_sets = await fetchRecentSetSummaries(client_id, 12)
    const hevy_workout_notes = await fetchHevyWorkoutNotes(client_id, 12)

    // If the coach picked a specific routine to target, narrow the snapshot
    // to just that one so Claude can't mix exercises from other routines
    // into the proposal. Include the others as a compact summary for context.
    let targetRoutines = currentRoutines
    let otherRoutinesSummary: Array<{ id: string; title: string; exercise_count: number }> = []
    let targetRoutineNotFound = false

    if (target_routine_id) {
      const match = currentRoutines.find((r) => r.id === target_routine_id)
      if (match) {
        targetRoutines = [match]
        otherRoutinesSummary = currentRoutines
          .filter((r) => r.id !== target_routine_id)
          .map((r) => ({
            id: r.id,
            title: r.title,
            exercise_count: Array.isArray(r.exercises) ? r.exercises.length : 0,
          }))
      } else {
        // Target wasn't found in the fetched list (maybe just deleted in Hevy).
        // Fall back to all routines + mark for the coach to see.
        targetRoutineNotFound = true
      }
    }

    const snapshot: Snapshot = {
      version: 1,
      generated_at: new Date().toISOString(),
      adjustment_level,
      client: {
        id: client.id,
        name: client.name,
        email: client.email ?? null,
        notes: client.notes ?? null,
      },
      insights_summary: insights_summary ?? null,
      current_hevy_routines: targetRoutines,
      recent_workout_sets,
      hevy_workout_notes,
      // Non-typed extras — persisted verbatim in ai_snapshot, visible to the
      // AI through the raw JSON dump.
      ...(otherRoutinesSummary.length > 0 && {
        other_routines_summary: otherRoutinesSummary,
      }),
      ...(target_routine_id && {
        target_routine_id,
        target_routine_not_found: targetRoutineNotFound,
      }),
    } as Snapshot & Record<string, unknown>

    // For overhaul/week_plan we don't treat "no routine fetched" as a failure —
    // the whole point is that there may not be one to start from.
    const isCreateFromScratch =
      adjustment_level === 'overhaul' || adjustment_level === 'week_plan'
    const effectiveStatus =
      routineFetchError && !isCreateFromScratch ? 'failed' : 'draft'

    const { data: inserted, error: insertErr } = await supabase
      .from('training_coach_recommendations')
      .insert({
        client_id: client.id,
        coach_id: coach.id,
        adjustment_level,
        status: effectiveStatus,
        error_message: isCreateFromScratch ? null : routineFetchError,
        ai_snapshot: snapshot,
        coach_note: coach_note ?? null,
        focus_prompt: focus_prompt?.trim() || null,
        plan_preferences: hasStructuredPrefs ? plan_preferences : null,
      })
      .select('id, status, created_at')
      .single()

    if (insertErr || !inserted) {
      return res.status(500).json({ error: insertErr?.message || 'Insert failed' })
    }

    return res.status(200).json({
      recommendation_id: inserted.id,
      status: inserted.status,
      created_at: inserted.created_at,
      snapshot,
      routine_fetch_error: routineFetchError,
    })
  } catch (err: any) {
    console.error('[generate-recommendation] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
