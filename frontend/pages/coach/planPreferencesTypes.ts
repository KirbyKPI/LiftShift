/**
 * Plan-builder preferences shape
 * ────────────────────────────────────────────────────────────────────────────
 * Structured inputs mirroring the Tonal Coach onboarding UX (goal, days,
 * session length, split, equipment). Used alongside a free-text
 * focus_prompt for things a form can't capture (injuries, equipment
 * quirks, specific exercise preferences).
 *
 * Persisted as JSONB on training_coach_recommendations.plan_preferences.
 * Application enforces shape; DB doesn't, so this can evolve without
 * migrations.
 */

export type Goal =
  | 'build_muscle'
  | 'get_stronger'
  | 'lose_fat'
  | 'general_fitness'
  | 'sport_specific'

export type Split =
  | 'ppl' // push / pull / legs
  | 'upper_lower'
  | 'full_body'
  | 'body_part' // bro split
  | 'custom'

export type Equipment =
  | 'full_gym'
  | 'home_gym' // barbell + rack + DBs
  | 'dumbbells_only'
  | 'bodyweight'
  | 'cable_machine' // Tonal / FUNCTIONAL trainer
  | 'other'

export interface PlanPreferences {
  goal?: Goal
  days_per_week?: number // 2..7
  session_minutes?: number // 20..120
  split?: Split
  equipment?: Equipment[]
}

export const GOAL_LABELS: Record<Goal, string> = {
  build_muscle: 'Build muscle',
  get_stronger: 'Get stronger',
  lose_fat: 'Lose fat / recomp',
  general_fitness: 'General fitness',
  sport_specific: 'Sport-specific',
}

export const SPLIT_LABELS: Record<Split, string> = {
  ppl: 'Push / Pull / Legs',
  upper_lower: 'Upper / Lower',
  full_body: 'Full body',
  body_part: 'Body-part (bro) split',
  custom: 'Custom (coach-defined)',
}

export const EQUIPMENT_LABELS: Record<Equipment, string> = {
  full_gym: 'Full gym',
  home_gym: 'Home gym (barbell + rack)',
  dumbbells_only: 'Dumbbells only',
  bodyweight: 'Bodyweight',
  cable_machine: 'Cable machine / Tonal',
  other: 'Other (see focus)',
}

export const DAYS_OPTIONS = [2, 3, 4, 5, 6] as const
export const SESSION_MINUTES_OPTIONS = [30, 45, 60, 75, 90] as const
