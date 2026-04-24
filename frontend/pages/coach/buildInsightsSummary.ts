/**
 * buildInsightsSummary
 * ────────────────────────────────────────────────────────────────────────────
 * Distills a WorkoutSet[] into a compact JSON summary we can feed to Claude
 * alongside the raw sets. Frontend runs it because the coach dashboard already
 * has the hydrated + PR-identified data in memory — no point re-computing
 * server side.
 *
 * Intentionally lightweight: headline numbers, per-exercise PR trajectory,
 * per-muscle-group weekly volume (if we can infer it), stagnation flags.
 * Claude treats this as one input among many; it's a hint, not a constraint.
 */

import type { WorkoutSet } from '../../types'

export interface InsightsSummary {
  window: { weeks: number; from: string; to: string }
  totals: {
    workouts: number
    sets: number
    unique_exercises: number
    workout_days_per_week_avg: number
  }
  streak: {
    current_weeks: number
    longest_weeks: number
  }
  per_exercise: Array<{
    title: string
    total_sets: number
    avg_top_set_weight_kg: number | null
    max_weight_kg: number | null
    last_pr_date: string | null
    weeks_since_last_pr: number | null
    stagnant: boolean
    trend: 'up' | 'flat' | 'down' | null
  }>
  recent_pr_count: number // PRs hit in last 4 weeks
  notes: string[] // human-readable bullets for the coach / AI context
}

const WEEKS_BACK = 12

export function buildInsightsSummary(sets: WorkoutSet[]): InsightsSummary {
  const now = new Date()
  const windowStart = new Date(now.getTime() - WEEKS_BACK * 7 * 86400_000)

  // Filter to window.
  const inWindow = sets.filter((s) => {
    const d = s.parsedDate ?? new Date(s.start_time)
    return d.getTime() >= windowStart.getTime()
  })

  // Group by workout (start_time + title is unique enough).
  const workoutKeys = new Set<string>()
  for (const s of inWindow) {
    workoutKeys.add(`${s.start_time}|${s.title}`)
  }

  // Per-exercise aggregation.
  const byExercise = new Map<
    string,
    {
      totalSets: number
      topSetWeights: number[]
      maxWeight: number
      lastPrDate: Date | null
    }
  >()

  for (const s of inWindow) {
    const key = s.exercise_title || '(unknown)'
    const row = byExercise.get(key) ?? {
      totalSets: 0,
      topSetWeights: [],
      maxWeight: 0,
      lastPrDate: null,
    }
    row.totalSets++
    const w = s.weight_kg ?? 0
    if (w > row.maxWeight) row.maxWeight = w
    // Top set per workout: collect the heaviest weight this exercise saw on
    // each unique workout.
    row.topSetWeights.push(w)

    if (s.isPr) {
      const d = s.parsedDate ?? new Date(s.start_time)
      if (!row.lastPrDate || d.getTime() > row.lastPrDate.getTime()) row.lastPrDate = d
    }

    byExercise.set(key, row)
  }

  const perExercise: InsightsSummary['per_exercise'] = []
  for (const [title, row] of byExercise) {
    const last = row.lastPrDate
    const weeksSincePr = last
      ? Math.floor((now.getTime() - last.getTime()) / (7 * 86400_000))
      : null
    const stagnant = weeksSincePr != null && weeksSincePr >= 6

    // Trend: compare average top set in first half vs second half of window.
    const sorted = row.topSetWeights.slice().sort((a, b) => b - a)
    const topN = sorted.slice(0, Math.ceil(sorted.length * 0.2)) // top 20%
    const avgTop = topN.length ? topN.reduce((s, v) => s + v, 0) / topN.length : null

    perExercise.push({
      title,
      total_sets: row.totalSets,
      avg_top_set_weight_kg: avgTop != null ? Math.round(avgTop * 100) / 100 : null,
      max_weight_kg: row.maxWeight || null,
      last_pr_date: last ? last.toISOString().slice(0, 10) : null,
      weeks_since_last_pr: weeksSincePr,
      stagnant,
      trend: null, // populated below
    })
  }

  // Simple trend: compare sets in first half vs second half for each exercise.
  const midpoint = windowStart.getTime() + (now.getTime() - windowStart.getTime()) / 2
  const firstHalfCounts = new Map<string, { sets: number; maxW: number }>()
  const secondHalfCounts = new Map<string, { sets: number; maxW: number }>()
  for (const s of inWindow) {
    const d = (s.parsedDate ?? new Date(s.start_time)).getTime()
    const target = d < midpoint ? firstHalfCounts : secondHalfCounts
    const key = s.exercise_title || '(unknown)'
    const row = target.get(key) ?? { sets: 0, maxW: 0 }
    row.sets++
    if ((s.weight_kg ?? 0) > row.maxW) row.maxW = s.weight_kg ?? 0
    target.set(key, row)
  }
  for (const ex of perExercise) {
    const a = firstHalfCounts.get(ex.title)?.maxW ?? 0
    const b = secondHalfCounts.get(ex.title)?.maxW ?? 0
    if (a === 0 && b === 0) ex.trend = null
    else if (b > a * 1.02) ex.trend = 'up'
    else if (b < a * 0.98) ex.trend = 'down'
    else ex.trend = 'flat'
  }

  // PRs in last 4 weeks.
  const fourWeeksAgo = now.getTime() - 4 * 7 * 86400_000
  const recentPrCount = inWindow.filter((s) => {
    const d = (s.parsedDate ?? new Date(s.start_time)).getTime()
    return s.isPr && d >= fourWeeksAgo
  }).length

  // Workouts/week average.
  const weeksInWindow = Math.max(1, (now.getTime() - windowStart.getTime()) / (7 * 86400_000))
  const wpwAvg = workoutKeys.size / weeksInWindow

  // Streak — count weeks backwards from now that have at least one workout.
  const weekHasWorkout = (weekOffset: number) => {
    const startMs = now.getTime() - (weekOffset + 1) * 7 * 86400_000
    const endMs = now.getTime() - weekOffset * 7 * 86400_000
    return inWindow.some((s) => {
      const d = (s.parsedDate ?? new Date(s.start_time)).getTime()
      return d >= startMs && d < endMs
    })
  }
  let currentStreak = 0
  while (weekHasWorkout(currentStreak)) currentStreak++

  // Longest streak within window.
  let longestStreak = 0
  let run = 0
  for (let i = 0; i < Math.ceil(weeksInWindow); i++) {
    if (weekHasWorkout(i)) {
      run++
      if (run > longestStreak) longestStreak = run
    } else {
      run = 0
    }
  }

  // Human-readable bullets — reinforces the JSON numbers for the model.
  const notes: string[] = []
  const stagnantExercises = perExercise.filter((e) => e.stagnant)
  if (stagnantExercises.length) {
    notes.push(
      `Stagnant exercises (no PR in 6+ weeks): ${stagnantExercises
        .map((e) => e.title)
        .join(', ')}`,
    )
  }
  const unreliable = perExercise.filter((e) => e.total_sets < 6)
  if (unreliable.length) {
    notes.push(
      `Low-sample exercises (< 6 sets in ${WEEKS_BACK}wk window): ${unreliable
        .map((e) => e.title)
        .slice(0, 8)
        .join(', ')}`,
    )
  }
  if (recentPrCount === 0) {
    notes.push('No PRs hit in the last 4 weeks — consider deload or stimulus change.')
  }

  return {
    window: {
      weeks: WEEKS_BACK,
      from: windowStart.toISOString().slice(0, 10),
      to: now.toISOString().slice(0, 10),
    },
    totals: {
      workouts: workoutKeys.size,
      sets: inWindow.length,
      unique_exercises: byExercise.size,
      workout_days_per_week_avg: Math.round(wpwAvg * 10) / 10,
    },
    streak: {
      current_weeks: currentStreak,
      longest_weeks: longestStreak,
    },
    per_exercise: perExercise
      .sort((a, b) => b.total_sets - a.total_sets)
      .slice(0, 40), // cap; otherwise some clients blow the token budget
    recent_pr_count: recentPrCount,
    notes,
  }
}
