/**
 * DataQualityPanel
 * ────────────────────────────────────────────────────────────────────────────
 * Coach-only override layer for cleaning up garbage in client-logged data
 * without touching Hevy itself.
 *
 * Two operations:
 *   - EXCLUDE a whole exercise's sets from a single session (e.g. client
 *     used the wrong template; weights are nonsense for this exercise).
 *   - EDIT individual set values (weight + reps) when a typo is the issue
 *     (e.g. logged 1500 lbs instead of 150 lbs).
 *
 * Storage: training_coach_set_overrides — a thin overlay sourced by
 * /api/hevy/sync when it builds WorkoutSet[]. The Hevy cache itself is
 * read-only here. After save, the parent re-runs sync so the embedded
 * dashboard recomputes alerts / PRs / plateaus with the fix applied.
 */
import React, { useEffect, useMemo, useState } from 'react'
import { supabase } from '../../utils/supabase/client'

interface DataQualityPanelProps {
  clientId: string
  /** Force-resync the dashboard data after an override is saved so the
   *  alerts / PRs / strength chart reflect the fix immediately. */
  onAppliedOverride: () => void
}

// ─── Cached-workout shape we read directly from Supabase ───────────────────

interface CachedWorkout {
  hevy_workout_id: string
  workout_date: string
  workout_name: string
  exercises: any
}

interface FlatSet {
  hevy_workout_id: string
  workout_date: string
  workout_name: string
  exercise_template_id: string | null
  exercise_title: string
  set_index: number
  weight_kg: number | null
  reps: number | null
  set_type: string
}

interface ExerciseGroup {
  exercise_template_id: string
  display_title: string
  sessions: SessionGroup[]
}

interface SessionGroup {
  hevy_workout_id: string
  workout_date: string
  workout_name: string
  sets: FlatSet[]
}

// ─── Override row shape (DB) ───────────────────────────────────────────────

interface OverrideRow {
  id?: string
  client_id: string
  hevy_workout_id: string
  exercise_template_id: string
  set_index: number | null
  exclude: boolean
  override_weight_kg: number | null
  override_reps: number | null
  reason: string | null
}

function overrideKey(workoutId: string, templateId: string, setIndex: number | null): string {
  return `${workoutId}:${templateId}:${setIndex === null ? 'all' : setIndex}`
}

// ─── Component ─────────────────────────────────────────────────────────────

export function DataQualityPanel({ clientId, onAppliedOverride }: DataQualityPanelProps) {
  const [loading, setLoading] = useState(true)
  const [error, setError] = useState<string | null>(null)
  const [groups, setGroups] = useState<ExerciseGroup[]>([])
  const [overrides, setOverrides] = useState<Map<string, OverrideRow>>(new Map())
  const [filter, setFilter] = useState<string>('')
  const [expanded, setExpanded] = useState<Set<string>>(new Set())

  // Initial load: cached workouts + existing overrides.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      setLoading(true)
      setError(null)
      try {
        const [{ data: rows, error: rowsErr }, { data: ovs, error: ovErr }] = await Promise.all([
          supabase
            .from('training_workout_cache')
            .select('hevy_workout_id, workout_date, workout_name, exercises')
            .eq('client_id', clientId)
            .order('workout_date', { ascending: false }),
          supabase
            .from('training_coach_set_overrides')
            .select('*')
            .eq('client_id', clientId),
        ])
        if (cancelled) return
        if (rowsErr) throw rowsErr
        if (ovErr) throw ovErr

        const flat = flattenWorkouts((rows || []) as CachedWorkout[])
        setGroups(groupByExercise(flat))

        const map = new Map<string, OverrideRow>()
        for (const o of (ovs || []) as OverrideRow[]) {
          map.set(overrideKey(o.hevy_workout_id, o.exercise_template_id, o.set_index), o)
        }
        setOverrides(map)
      } catch (err: any) {
        if (cancelled) return
        setError(err?.message || 'Failed to load data')
      } finally {
        if (!cancelled) setLoading(false)
      }
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const upsertOverride = async (row: OverrideRow): Promise<boolean> => {
    const { data, error: err } = await supabase
      .from('training_coach_set_overrides')
      .upsert(row, {
        onConflict: 'client_id,hevy_workout_id,exercise_template_id,set_index',
      })
      .select()
      .single()
    if (err) {
      alert(`Save failed: ${err.message}`)
      return false
    }
    setOverrides((prev) => {
      const next = new Map(prev)
      next.set(overrideKey(row.hevy_workout_id, row.exercise_template_id, row.set_index), data as OverrideRow)
      return next
    })
    onAppliedOverride()
    return true
  }

  const deleteOverride = async (row: OverrideRow): Promise<boolean> => {
    // Postgrest treats `.eq('col', null)` as IS NULL only via `.is()`, so we
    // branch by whether set_index is null or a real number.
    const base = supabase
      .from('training_coach_set_overrides')
      .delete()
      .eq('client_id', row.client_id)
      .eq('hevy_workout_id', row.hevy_workout_id)
      .eq('exercise_template_id', row.exercise_template_id)
    const { error: err } =
      row.set_index === null
        ? await base.is('set_index', null)
        : await base.eq('set_index', row.set_index)
    if (err) {
      alert(`Delete failed: ${err.message}`)
      return false
    }
    setOverrides((prev) => {
      const next = new Map(prev)
      next.delete(overrideKey(row.hevy_workout_id, row.exercise_template_id, row.set_index))
      return next
    })
    onAppliedOverride()
    return true
  }

  const filteredGroups = useMemo(() => {
    if (!filter.trim()) return groups
    const needle = filter.trim().toLowerCase()
    return groups.filter((g) => g.display_title.toLowerCase().includes(needle))
  }, [groups, filter])

  const toggleExpand = (templateId: string) => {
    setExpanded((prev) => {
      const next = new Set(prev)
      if (next.has(templateId)) next.delete(templateId)
      else next.add(templateId)
      return next
    })
  }

  return (
    <div className="max-w-6xl mx-auto px-6 py-5">
      <div className="mb-4">
        <h2 className="text-base font-bold text-white mb-1">Data Quality</h2>
        <p className="text-zinc-500 text-xs">
          Exclude bogus sessions or fix typos in client logs. Hevy data
          isn't modified — only how alerts / PRs / strength charts read it.
          After saving, the dashboard re-syncs automatically.
        </p>
      </div>

      <input
        type="text"
        value={filter}
        onChange={(e) => setFilter(e.target.value)}
        placeholder="Filter exercises…"
        className="w-full px-3 py-2 mb-4 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50"
      />

      {loading && (
        <div className="text-center text-zinc-500 text-sm py-8">Loading client data…</div>
      )}
      {error && (
        <div className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
          {error}
        </div>
      )}

      {!loading && !error && filteredGroups.length === 0 && (
        <div className="text-center text-zinc-500 text-sm py-8">
          No exercises found. Try a different filter or sync more workouts.
        </div>
      )}

      {!loading && !error && filteredGroups.length > 0 && (
        <ul className="space-y-2">
          {filteredGroups.map((group) => (
            <ExerciseRow
              key={group.exercise_template_id}
              group={group}
              expanded={expanded.has(group.exercise_template_id)}
              onToggle={() => toggleExpand(group.exercise_template_id)}
              clientId={clientId}
              overrides={overrides}
              upsertOverride={upsertOverride}
              deleteOverride={deleteOverride}
            />
          ))}
        </ul>
      )}
    </div>
  )
}

// ─── Exercise row (collapsible) ────────────────────────────────────────────

function ExerciseRow({
  group,
  expanded,
  onToggle,
  clientId,
  overrides,
  upsertOverride,
  deleteOverride,
}: {
  group: ExerciseGroup
  expanded: boolean
  onToggle: () => void
  clientId: string
  overrides: Map<string, OverrideRow>
  upsertOverride: (row: OverrideRow) => Promise<boolean>
  deleteOverride: (row: OverrideRow) => Promise<boolean>
}) {
  // Show a small badge with the count of overrides for this exercise so the
  // coach can scan past clean exercises.
  const overrideCount = group.sessions.reduce((acc, s) => {
    let n = 0
    for (const set of s.sets) {
      if (overrides.has(overrideKey(s.hevy_workout_id, group.exercise_template_id, set.set_index))) n++
    }
    if (overrides.has(overrideKey(s.hevy_workout_id, group.exercise_template_id, null))) n++
    return acc + n
  }, 0)

  return (
    <li className="rounded-lg border border-zinc-800 bg-zinc-900/40">
      <button
        onClick={onToggle}
        className="w-full flex items-center justify-between gap-3 px-3 py-2 hover:bg-zinc-800/40 transition-colors text-left"
      >
        <div className="flex items-center gap-2">
          <span className="text-zinc-500 text-xs">{expanded ? '▾' : '▸'}</span>
          <span className="text-sm text-white">{group.display_title}</span>
          {overrideCount > 0 && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-amber-500/40 bg-amber-500/10 text-amber-300">
              {overrideCount} override{overrideCount === 1 ? '' : 's'}
            </span>
          )}
        </div>
        <span className="text-zinc-500 text-[11px]">
          {group.sessions.length} session{group.sessions.length === 1 ? '' : 's'}
        </span>
      </button>

      {expanded && (
        <ul className="border-t border-zinc-800/70 divide-y divide-zinc-800/70">
          {group.sessions.slice(0, 12).map((session) => (
            <SessionRow
              key={session.hevy_workout_id}
              session={session}
              templateId={group.exercise_template_id}
              clientId={clientId}
              overrides={overrides}
              upsertOverride={upsertOverride}
              deleteOverride={deleteOverride}
            />
          ))}
          {group.sessions.length > 12 && (
            <li className="px-4 py-2 text-zinc-500 text-[11px]">
              +{group.sessions.length - 12} older session(s) hidden
            </li>
          )}
        </ul>
      )}
    </li>
  )
}

// ─── Session row (whole exercise in one workout) ──────────────────────────

function SessionRow({
  session,
  templateId,
  clientId,
  overrides,
  upsertOverride,
  deleteOverride,
}: {
  session: SessionGroup
  templateId: string
  clientId: string
  overrides: Map<string, OverrideRow>
  upsertOverride: (row: OverrideRow) => Promise<boolean>
  deleteOverride: (row: OverrideRow) => Promise<boolean>
}) {
  // Whole-exercise exclude lives at set_index = null.
  const exerciseOv = overrides.get(overrideKey(session.hevy_workout_id, templateId, null))
  const isExcluded = !!exerciseOv?.exclude
  const [showReason, setShowReason] = useState(false)
  const [reason, setReason] = useState<string>(exerciseOv?.reason || '')
  const [busy, setBusy] = useState(false)

  const onExclude = async () => {
    setBusy(true)
    const ok = await upsertOverride({
      client_id: clientId,
      hevy_workout_id: session.hevy_workout_id,
      exercise_template_id: templateId,
      set_index: null,
      exclude: true,
      override_weight_kg: null,
      override_reps: null,
      reason: reason || null,
    })
    setBusy(false)
    if (ok) setShowReason(false)
  }

  const onUnexclude = async () => {
    if (!exerciseOv) return
    setBusy(true)
    await deleteOverride(exerciseOv)
    setBusy(false)
  }

  const dateStr = formatDate(session.workout_date)

  return (
    <li className={`px-4 py-3 ${isExcluded ? 'bg-zinc-950/60 opacity-60' : ''}`}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <div className="text-zinc-300 text-xs font-medium">
          {dateStr} · {session.workout_name}
        </div>
        <div className="flex items-center gap-2">
          {isExcluded ? (
            <button
              onClick={onUnexclude}
              disabled={busy}
              className="text-[11px] px-2 py-1 bg-zinc-800 hover:bg-zinc-700 border border-zinc-700 rounded text-zinc-300 transition-colors disabled:opacity-50"
            >
              Restore
            </button>
          ) : (
            <button
              onClick={() => setShowReason((v) => !v)}
              disabled={busy}
              className="text-[11px] px-2 py-1 bg-zinc-900 hover:bg-amber-500/15 hover:text-amber-300 hover:border-amber-500/40 border border-zinc-800 rounded text-zinc-400 transition-colors disabled:opacity-50"
              title="Exclude every set from this exercise in this workout"
            >
              Exclude session
            </button>
          )}
        </div>
      </div>

      {!isExcluded && showReason && (
        <div className="mb-2 flex gap-2">
          <input
            type="text"
            value={reason}
            onChange={(e) => setReason(e.target.value)}
            placeholder="Optional reason (e.g. wrong exercise template)"
            className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-white text-[11px] placeholder:text-zinc-600 focus:outline-none focus:border-amber-500/50"
            autoFocus
          />
          <button
            onClick={onExclude}
            disabled={busy}
            className="text-[11px] px-2 py-1 bg-amber-500 hover:bg-amber-400 text-black font-semibold rounded disabled:opacity-50"
          >
            {busy ? 'Saving…' : 'Confirm exclude'}
          </button>
        </div>
      )}

      {isExcluded && exerciseOv?.reason && (
        <p className="text-amber-200/70 text-[11px] mb-2 italic">"{exerciseOv.reason}"</p>
      )}

      <ul className="space-y-1 font-mono text-[11px]">
        {session.sets.map((s) => (
          <SetRow
            key={s.set_index}
            set={s}
            disabled={isExcluded}
            templateId={templateId}
            clientId={clientId}
            overrides={overrides}
            upsertOverride={upsertOverride}
            deleteOverride={deleteOverride}
          />
        ))}
      </ul>
    </li>
  )
}

// ─── Single set row (inline edit) ──────────────────────────────────────────

function SetRow({
  set,
  disabled,
  templateId,
  clientId,
  overrides,
  upsertOverride,
  deleteOverride,
}: {
  set: FlatSet
  disabled: boolean
  templateId: string
  clientId: string
  overrides: Map<string, OverrideRow>
  upsertOverride: (row: OverrideRow) => Promise<boolean>
  deleteOverride: (row: OverrideRow) => Promise<boolean>
}) {
  const setOv = overrides.get(overrideKey(set.hevy_workout_id, templateId, set.set_index))
  const effectiveKg = setOv?.override_weight_kg ?? set.weight_kg ?? 0
  const effectiveReps = setOv?.override_reps ?? set.reps ?? 0
  const isOverridden = !!setOv && !setOv.exclude && (setOv.override_weight_kg !== null || setOv.override_reps !== null)

  const [editing, setEditing] = useState(false)
  const [lbsInput, setLbsInput] = useState<string>(kgToLbsString(effectiveKg))
  const [repsInput, setRepsInput] = useState<string>(String(effectiveReps))
  const [busy, setBusy] = useState(false)

  // Re-seed inputs if the underlying override changes (e.g. coach hits Reset).
  useEffect(() => {
    setLbsInput(kgToLbsString(effectiveKg))
    setRepsInput(String(effectiveReps))
  }, [effectiveKg, effectiveReps])

  const onSave = async () => {
    setBusy(true)
    const newKg = lbsInputToKg(lbsInput)
    const newReps = Number(repsInput)
    if (!Number.isFinite(newReps)) {
      alert('Reps must be a number.')
      setBusy(false)
      return
    }
    // Only persist as overrides values that actually differ from raw, so we
    // don't pollute the table with no-op rows.
    const sameKg = approxEq(newKg, set.weight_kg ?? 0)
    const sameReps = newReps === (set.reps ?? 0)
    if (sameKg && sameReps) {
      // Coach edited then reverted — if there's an existing override, drop it.
      if (setOv) await deleteOverride(setOv)
      setBusy(false)
      setEditing(false)
      return
    }
    const ok = await upsertOverride({
      client_id: clientId,
      hevy_workout_id: set.hevy_workout_id,
      exercise_template_id: templateId,
      set_index: set.set_index,
      exclude: false,
      override_weight_kg: sameKg ? null : newKg,
      override_reps: sameReps ? null : newReps,
      reason: setOv?.reason ?? null,
    })
    setBusy(false)
    if (ok) setEditing(false)
  }

  const onResetSet = async () => {
    if (!setOv) return
    setBusy(true)
    await deleteOverride(setOv)
    setBusy(false)
  }

  if (editing) {
    return (
      <li className="flex items-center gap-2">
        <span className="text-zinc-500 w-4">{set.set_index + 1}</span>
        <input
          type="number"
          step="5"
          value={lbsInput}
          onChange={(e) => setLbsInput(e.target.value)}
          className="w-20 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100"
        />
        <span className="text-zinc-500">lbs ×</span>
        <input
          type="number"
          value={repsInput}
          onChange={(e) => setRepsInput(e.target.value)}
          className="w-14 bg-zinc-800 border border-zinc-700 rounded px-1.5 py-0.5 text-zinc-100"
        />
        <button
          onClick={onSave}
          disabled={busy}
          className="ml-auto text-[10px] px-2 py-0.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold rounded disabled:opacity-50"
        >
          {busy ? '…' : 'Save'}
        </button>
        <button
          onClick={() => setEditing(false)}
          className="text-[10px] px-2 py-0.5 text-zinc-500 hover:text-zinc-300"
        >
          Cancel
        </button>
      </li>
    )
  }

  return (
    <li className="flex items-center gap-2">
      <span className="text-zinc-500 w-4">{set.set_index + 1}</span>
      <span className={isOverridden ? 'text-amber-300' : 'text-zinc-300'}>
        {Math.round(effectiveKg * 2.20462)} lbs × {effectiveReps}
      </span>
      {isOverridden && (
        <span className="text-[10px] text-zinc-500">
          (was {Math.round((set.weight_kg ?? 0) * 2.20462)} × {set.reps ?? 0})
        </span>
      )}
      <span className="text-zinc-700">·</span>
      <span className="text-zinc-600 text-[10px] uppercase">{set.set_type}</span>
      <span className="ml-auto flex gap-2">
        {!disabled && (
          <button
            onClick={() => setEditing(true)}
            className="text-[10px] text-zinc-500 hover:text-zinc-300"
            title="Override this set's weight or reps"
          >
            Edit
          </button>
        )}
        {isOverridden && (
          <button
            onClick={onResetSet}
            disabled={busy}
            className="text-[10px] text-zinc-500 hover:text-zinc-300 disabled:opacity-50"
            title="Drop this set's override and use the raw Hevy value"
          >
            Reset
          </button>
        )}
      </span>
    </li>
  )
}

// ─── Helpers ───────────────────────────────────────────────────────────────

function flattenWorkouts(rows: CachedWorkout[]): FlatSet[] {
  const flat: FlatSet[] = []
  for (const w of rows) {
    const exs = Array.isArray(w.exercises) ? w.exercises : []
    for (const ex of exs) {
      const sets = Array.isArray(ex?.sets) ? ex.sets : []
      for (const s of sets) {
        flat.push({
          hevy_workout_id: w.hevy_workout_id,
          workout_date: w.workout_date,
          workout_name: w.workout_name,
          exercise_template_id: ex?.exercise_template_id ?? null,
          exercise_title: ex?.title || ex?.exercise_name || '',
          set_index: s?.index ?? 0,
          weight_kg: s?.weight_kg ?? null,
          reps: s?.reps ?? null,
          set_type: s?.set_type || 'normal',
        })
      }
    }
  }
  return flat
}

function groupByExercise(flat: FlatSet[]): ExerciseGroup[] {
  // Group: template_id -> session_id -> sets
  const byTemplate = new Map<
    string,
    { display_title: string; sessions: Map<string, FlatSet[]> }
  >()

  for (const s of flat) {
    if (!s.exercise_template_id) continue // skip un-templated rows; can't override
    let bucket = byTemplate.get(s.exercise_template_id)
    if (!bucket) {
      bucket = { display_title: s.exercise_title, sessions: new Map() }
      byTemplate.set(s.exercise_template_id, bucket)
    }
    if (!bucket.display_title && s.exercise_title) bucket.display_title = s.exercise_title
    let sess = bucket.sessions.get(s.hevy_workout_id)
    if (!sess) {
      sess = []
      bucket.sessions.set(s.hevy_workout_id, sess)
    }
    sess.push(s)
  }

  // Build sorted output: groups by latest session date desc, sessions within
  // each group also desc.
  const groups: ExerciseGroup[] = []
  for (const [template_id, bucket] of byTemplate.entries()) {
    const sessions: SessionGroup[] = Array.from(bucket.sessions.entries())
      .map(([workout_id, sets]) => ({
        hevy_workout_id: workout_id,
        workout_date: sets[0].workout_date,
        workout_name: sets[0].workout_name,
        sets: sets.sort((a, b) => a.set_index - b.set_index),
      }))
      .sort((a, b) => b.workout_date.localeCompare(a.workout_date))
    groups.push({
      exercise_template_id: template_id,
      display_title: bucket.display_title || '(unnamed)',
      sessions,
    })
  }

  // Sort exercises by most-recent session date desc.
  groups.sort((a, b) => {
    const ad = a.sessions[0]?.workout_date || ''
    const bd = b.sessions[0]?.workout_date || ''
    return bd.localeCompare(ad)
  })

  return groups
}

function kgToLbsString(kg: number): string {
  if (!kg) return '0'
  return String(Math.round(kg * 2.20462))
}

function lbsInputToKg(lbsStr: string): number {
  const lbs = Number(lbsStr)
  if (!Number.isFinite(lbs)) return 0
  return Math.round((lbs / 2.20462) * 1000) / 1000
}

function approxEq(a: number, b: number): boolean {
  return Math.abs(a - b) < 0.01
}

function formatDate(iso: string): string {
  const d = new Date(iso.includes('T') ? iso : `${iso}T00:00:00.000Z`)
  if (Number.isNaN(d.getTime())) return iso
  return d.toLocaleDateString(undefined, { month: 'short', day: 'numeric', year: 'numeric' })
}
