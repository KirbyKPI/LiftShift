import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── Decrypt ────────────────────────────────────────────────────────────────

async function decryptApiKey(encrypted: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16))
  ).slice(0, 32)

  const [ivHex, ctHex] = encrypted.split(':')
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const ct = new Uint8Array(ctHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

// ─── Fetch all workouts from Hevy API (paginated) ──────────────────────────

interface HevyExercise {
  index: number
  title: string
  superset_id: number | null
  notes: string
  exercise_template_id: string
  sets: Array<{
    index: number
    set_type: string
    weight_kg: number | null
    reps: number | null
    distance_meters: number | null
    duration_seconds: number | null
    rpe: number | null
  }>
}

interface HevyWorkout {
  id: string
  title: string
  start_time: string
  end_time: string
  exercises: HevyExercise[]
}

async function fetchAllWorkouts(apiKey: string): Promise<HevyWorkout[]> {
  const all: HevyWorkout[] = []
  let page = 1
  const pageSize = 10

  while (true) {
    const res = await fetch(
      `https://api.hevyapp.com/v1/workouts?page=${page}&page_size=${pageSize}`,
      { headers: { 'api-key': apiKey, 'accept': 'application/json' } }
    )

    if (res.status === 401) throw new Error('API_KEY_EXPIRED')
    if (!res.ok) throw new Error(`Hevy API error: ${res.status}`)

    const data = await res.json()
    const workouts: HevyWorkout[] = data.workouts || []
    all.push(...workouts)

    if (workouts.length < pageSize || page >= (data.page_count || 1)) break
    page++

    // Rate limit: small delay between pages
    await new Promise(r => setTimeout(r, 200))
  }

  return all
}

// ─── Coach overrides ────────────────────────────────────────────────────────
//
// The coach can layer overrides on top of cached Hevy data so insights
// reflect a corrected picture without modifying the client's actual logs.
// Two kinds:
//   - exclude=true: drop these sets from analysis (e.g. wrong exercise
//     template, garbage data)
//   - override_weight_kg / override_reps: replace those fields (e.g. typo
//     where client logged 1500 lbs instead of 150 lbs)
//
// Scope:
//   - set_index = N    -> applies to that specific set in the workout
//   - set_index = null -> applies to ALL sets of that exercise in that
//                          workout (typical "exclude this exercise's
//                          session" use case)

interface CoachOverride {
  hevy_workout_id: string
  exercise_template_id: string
  set_index: number | null
  exclude: boolean
  override_weight_kg: number | null
  override_reps: number | null
}

/** Map keyed by `${workout_id}:${template_id}:${set_index ?? 'all'}`. */
type OverrideMap = Map<string, CoachOverride>

function overrideKey(workoutId: string, templateId: string, setIndex: number | 'all'): string {
  return `${workoutId}:${templateId}:${setIndex}`
}

async function fetchOverrideMap(clientId: string): Promise<OverrideMap> {
  const { data } = await supabase
    .from('training_coach_set_overrides')
    .select(
      'hevy_workout_id, exercise_template_id, set_index, exclude, override_weight_kg, override_reps',
    )
    .eq('client_id', clientId)
  const map: OverrideMap = new Map()
  for (const row of (data || []) as CoachOverride[]) {
    map.set(
      overrideKey(
        row.hevy_workout_id,
        row.exercise_template_id,
        row.set_index === null ? 'all' : row.set_index,
      ),
      row,
    )
  }
  return map
}

/** Resolve overrides for a single set. Returns:
 *   - null if the set should be excluded from analysis
 *   - { weight_kg, reps } with possibly-overridden values otherwise
 *
 * Applies set-specific override first, then falls back to whole-exercise
 * override (set_index = null). Set-specific exclude wins over whole-exercise
 * override and vice versa — both excludes drop the set. */
function applyOverrideToSet(
  workoutId: string,
  templateId: string | null | undefined,
  setIndex: number,
  rawWeightKg: number | null | undefined,
  rawReps: number | null | undefined,
  overrides: OverrideMap,
): { weight_kg: number; reps: number } | null {
  // No template_id means we can't match an override; pass through raw.
  if (!templateId) {
    return { weight_kg: rawWeightKg ?? 0, reps: rawReps ?? 0 }
  }

  const setOverride = overrides.get(overrideKey(workoutId, templateId, setIndex))
  const exerciseOverride = overrides.get(overrideKey(workoutId, templateId, 'all'))

  // Either scope can exclude.
  if (setOverride?.exclude || exerciseOverride?.exclude) return null

  // Set-specific value override beats exercise-scope value override.
  const weight =
    setOverride?.override_weight_kg ??
    exerciseOverride?.override_weight_kg ??
    rawWeightKg ??
    0
  const reps =
    setOverride?.override_reps ??
    exerciseOverride?.override_reps ??
    rawReps ??
    0
  return { weight_kg: weight, reps }
}

// ─── Transform workout to flat rows (like kpifit-assess format) ─────────────

interface WorkoutRow {
  date: string
  workout_name: string
  exercise_name: string
  weight_lbs: number
  reps: number
  set_type: string
  duration_seconds: number
  rpe: number | null
}

function workoutsToRows(workouts: HevyWorkout[], overrides: OverrideMap): WorkoutRow[] {
  const rows: WorkoutRow[] = []
  for (const w of workouts) {
    for (const ex of w.exercises) {
      for (const s of ex.sets) {
        const ov = applyOverrideToSet(
          w.id,
          ex.exercise_template_id,
          s.index ?? 0,
          s.weight_kg,
          s.reps,
          overrides,
        )
        if (!ov) continue // excluded
        rows.push({
          date: w.start_time,
          workout_name: w.title || 'Workout',
          exercise_name: ex.title,
          weight_lbs: ov.weight_kg ? Math.round(ov.weight_kg * 2.20462 * 100) / 100 : 0,
          reps: ov.reps,
          set_type: s.set_type || 'normal',
          duration_seconds: s.duration_seconds || 0,
          rpe: s.rpe ?? null,
        })
      }
    }
  }
  return rows
}

// ─── Rich WorkoutSet mapping (for the embedded /app dashboard) ──────────────
// Shape mirrors frontend/types.ts WorkoutSet so the coach-facing dashboard
// can consume the same data pipeline the standalone /app uses.

interface CoachWorkoutSet {
  title: string
  start_time: string
  end_time: string
  description: string
  exercise_title: string
  exercise_index: number
  superset_id: string
  exercise_notes: string
  set_index: number
  set_type: string
  weight_kg: number
  reps: number
  distance_km: number
  duration_seconds: number
  rpe: number | null
  source: 'hevy'
}

function workoutsToWorkoutSets(
  workouts: HevyWorkout[],
  overrides: OverrideMap,
): CoachWorkoutSet[] {
  const sets: CoachWorkoutSet[] = []
  for (const w of workouts) {
    const exList = Array.isArray(w.exercises) ? w.exercises : []
    for (const ex of exList) {
      const exSets = Array.isArray(ex.sets) ? ex.sets : []
      for (const s of exSets) {
        const setIdx = s.index ?? 0
        const ov = applyOverrideToSet(
          w.id,
          ex.exercise_template_id,
          setIdx,
          s.weight_kg,
          s.reps,
          overrides,
        )
        if (!ov) continue // excluded
        sets.push({
          title: w.title || 'Workout',
          start_time: w.start_time,
          end_time: w.end_time || w.start_time,
          description: '',
          exercise_title: ex.title || '',
          exercise_index: ex.index ?? 0,
          superset_id:
            ex.superset_id === null || ex.superset_id === undefined
              ? ''
              : String(ex.superset_id),
          exercise_notes: ex.notes || '',
          set_index: setIdx,
          set_type: s.set_type || 'normal',
          weight_kg: ov.weight_kg,
          reps: ov.reps,
          distance_km:
            s.distance_meters != null ? s.distance_meters / 1000 : 0,
          duration_seconds: s.duration_seconds ?? 0,
          rpe: s.rpe ?? null,
          source: 'hevy',
        })
      }
    }
  }
  return sets
}

/**
 * Reconstruct rich WorkoutSets from the flattened `training_workout_cache`
 * rows. Cached rows preserve the original Hevy `exercises` JSON blob, so we
 * can rebuild the same shape live fetches produce.
 */
function cachedWorkoutsToWorkoutSets(
  cached: Array<{
    hevy_workout_id: string
    exercises: any
    workout_date: string
    workout_name: string
    duration_seconds: number
  }>,
  overrides: OverrideMap,
): CoachWorkoutSet[] {
  const sets: CoachWorkoutSet[] = []
  for (const c of cached) {
    const exercises = Array.isArray(c.exercises) ? c.exercises : []
    // Approximate start/end from workout_date (date-only) + duration.
    const startIso = c.workout_date?.includes('T')
      ? c.workout_date
      : `${c.workout_date}T00:00:00.000Z`
    const startMs = new Date(startIso).getTime()
    const endIso = Number.isFinite(startMs)
      ? new Date(startMs + (c.duration_seconds ?? 0) * 1000).toISOString()
      : startIso

    for (const ex of exercises) {
      const exSets = Array.isArray(ex.sets) ? ex.sets : []
      for (const s of exSets) {
        const setIdx = s.index ?? 0
        const ov = applyOverrideToSet(
          c.hevy_workout_id,
          ex.exercise_template_id,
          setIdx,
          s.weight_kg,
          s.reps,
          overrides,
        )
        if (!ov) continue
        sets.push({
          title: c.workout_name || 'Workout',
          start_time: startIso,
          end_time: endIso,
          description: '',
          exercise_title: ex.title || ex.exercise_name || '',
          exercise_index: ex.index ?? 0,
          superset_id:
            ex.superset_id === null || ex.superset_id === undefined
              ? ''
              : String(ex.superset_id),
          exercise_notes: ex.notes || '',
          set_index: setIdx,
          set_type: s.set_type || 'normal',
          weight_kg: ov.weight_kg,
          reps: ov.reps,
          distance_km:
            s.distance_meters != null ? s.distance_meters / 1000 : 0,
          duration_seconds: s.duration_seconds ?? 0,
          rpe: s.rpe ?? null,
          source: 'hevy',
        })
      }
    }
  }
  return sets
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { client_id, coach_token, force_refresh } = req.body || {}
  if (!client_id || !coach_token) return res.status(400).json({ error: 'client_id and coach_token required' })

  try {
    // Verify coach auth
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    // Get connection
    const { data: conn } = await supabase
      .from('training_hevy_connections')
      .select('*')
      .eq('client_id', client_id)
      .single()

    if (!conn) return res.status(404).json({ error: 'No Hevy connection for this client' })
    if (conn.connection_status === 'expired') return res.status(400).json({ error: 'API key expired, client needs to reconnect' })

    // Check cache freshness
    const { data: syncMeta } = await supabase
      .from('training_sync_metadata')
      .select('*')
      .eq('client_id', client_id)
      .single()

    const ttlMinutes = syncMeta?.sync_cache_ttl_minutes || 60
    const lastFetch = syncMeta?.last_api_fetch_at ? new Date(syncMeta.last_api_fetch_at) : null
    const cacheAge = lastFetch ? (Date.now() - lastFetch.getTime()) / 60000 : Infinity

    // Fetch coach overrides once; reuse across all conversion paths below.
    const overrides = await fetchOverrideMap(client_id)

    if (!force_refresh && cacheAge < ttlMinutes) {
      // Return cached data
      const { data: cached } = await supabase
        .from('training_workout_cache')
        .select('hevy_workout_id, exercises, workout_date, workout_name, duration_seconds')
        .eq('client_id', client_id)
        .order('workout_date', { ascending: false })

      const rows = flattenCachedRows(cached || [], overrides)
      const sets = cachedWorkoutsToWorkoutSets(cached || [], overrides)
      return res.status(200).json({
        rows,
        sets,
        source: 'cached',
        last_sync_at: syncMeta?.last_api_fetch_at,
        workouts_fetched: cached?.length || 0,
      })
    }

    // Fetch fresh data from Hevy
    const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)
    let workouts: HevyWorkout[]

    try {
      workouts = await fetchAllWorkouts(apiKey)
    } catch (err: any) {
      if (err.message === 'API_KEY_EXPIRED') {
        await supabase
          .from('training_hevy_connections')
          .update({ connection_status: 'expired', last_error: 'API key expired (401)' })
          .eq('client_id', client_id)
        return res.status(401).json({ error: 'API key expired' })
      }

      // Return stale cache on error
      await supabase
        .from('training_hevy_connections')
        .update({
          connection_status: 'error',
          last_error: err.message,
          sync_failure_count: (conn.sync_failure_count || 0) + 1,
        })
        .eq('client_id', client_id)

      const { data: stale } = await supabase
        .from('training_workout_cache')
        .select('hevy_workout_id, exercises, workout_date, workout_name, duration_seconds')
        .eq('client_id', client_id)
        .order('workout_date', { ascending: false })

      if (stale && stale.length > 0) {
        return res.status(200).json({
          rows: flattenCachedRows(stale, overrides),
          sets: cachedWorkoutsToWorkoutSets(stale, overrides),
          source: 'stale_cache',
          warning: `Sync failed: ${err.message}`,
          last_sync_at: syncMeta?.last_api_fetch_at,
        })
      }
      throw err
    }

    // Upsert workouts to cache
    const cacheRows = workouts.map(w => ({
      client_id,
      hevy_workout_id: w.id,
      workout_date: w.start_time.split('T')[0],
      workout_name: w.title || 'Workout',
      duration_seconds: w.end_time && w.start_time
        ? Math.round((new Date(w.end_time).getTime() - new Date(w.start_time).getTime()) / 1000)
        : 0,
      exercises: w.exercises,
      source: 'hevy_api',
      last_synced_at: new Date().toISOString(),
    }))

    // Batch upsert (100 at a time)
    for (let i = 0; i < cacheRows.length; i += 100) {
      await supabase
        .from('training_workout_cache')
        .upsert(cacheRows.slice(i, i + 100), { onConflict: 'client_id,hevy_workout_id' })
    }

    // Update metadata
    await supabase
      .from('training_sync_metadata')
      .upsert({
        client_id,
        last_api_fetch_at: new Date().toISOString(),
        total_workouts_synced: workouts.length,
      }, { onConflict: 'client_id' })

    // Clear error state
    await supabase
      .from('training_hevy_connections')
      .update({
        connection_status: 'active',
        last_sync_at: new Date().toISOString(),
        last_error: null,
        sync_failure_count: 0,
      })
      .eq('client_id', client_id)

    const rows = workoutsToRows(workouts, overrides)
    const sets = workoutsToWorkoutSets(workouts, overrides)
    return res.status(200).json({
      rows,
      sets,
      source: 'live',
      last_sync_at: new Date().toISOString(),
      workouts_fetched: workouts.length,
    })
  } catch (err: any) {
    console.error('Sync error:', err)
    return res.status(500).json({ error: err.message || 'Sync failed' })
  }
}

// ─── Flatten cached workout exercises into flat rows ────────────────────────

function flattenCachedRows(
  cached: Array<{
    hevy_workout_id: string
    exercises: any
    workout_date: string
    workout_name: string
    duration_seconds: number
  }>,
  overrides: OverrideMap,
): WorkoutRow[] {
  const rows: WorkoutRow[] = []
  for (const c of cached) {
    const exercises = Array.isArray(c.exercises) ? c.exercises : []
    for (const ex of exercises) {
      const sets = Array.isArray(ex.sets) ? ex.sets : []
      for (const s of sets) {
        const ov = applyOverrideToSet(
          c.hevy_workout_id,
          ex.exercise_template_id,
          s.index ?? 0,
          s.weight_kg,
          s.reps,
          overrides,
        )
        if (!ov) continue
        rows.push({
          date: c.workout_date,
          workout_name: c.workout_name || 'Workout',
          exercise_name: ex.title || ex.exercise_name || '',
          weight_lbs: ov.weight_kg ? Math.round(ov.weight_kg * 2.20462 * 100) / 100 : 0,
          reps: ov.reps,
          set_type: s.set_type || 'normal',
          duration_seconds: s.duration_seconds || 0,
          rpe: s.rpe ?? null,
        })
      }
    }
  }
  return rows
}
