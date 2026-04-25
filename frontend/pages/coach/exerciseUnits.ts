/**
 * exerciseUnits
 * ────────────────────────────────────────────────────────────────────────────
 * Some exercises are loaded with implements that come in kg increments
 * (kettlebells: 8/12/16/20/24/28/32 kg, plate-loaded farmers handles, etc.)
 * For those, forcing a whole-pound prescription leads to weird values like
 * "35 lbs" instead of "16 kg". This helper centralises the title-based
 * detection so the display, edit form, and push pipeline all agree.
 *
 * Heuristic intentionally narrow — "Bulgarian Split Squat" alone is
 * ambiguous (could be DB, BB, smith, machine). Only flag exercises whose
 * title explicitly indicates kettlebells or carries that are conventionally
 * KB/loaded by handle.
 */

const KG_NATIVE_PATTERN =
  /\b(kettlebell|kettlebells|kb|farmer'?s?\s*walk|farmer'?s?\s*carry|farmer\s*walk)\b/i

export type WeightUnitPreference = 'lbs' | 'kg'

export function isKgNativeExercise(title: string | null | undefined): boolean {
  if (!title) return false
  return KG_NATIVE_PATTERN.test(title)
}

/** Resolve the display unit for an exercise — kg for kettlebell-loaded
 *  movements, lbs everywhere else (US default). */
export function unitForExercise(title: string | null | undefined): WeightUnitPreference {
  return isKgNativeExercise(title) ? 'kg' : 'lbs'
}

/** Format a kg weight in the unit appropriate for this exercise. */
export function displayWeight(
  kg: number | null | undefined,
  exerciseTitle: string | null | undefined,
): string {
  if (kg == null) return ''
  const unit = unitForExercise(exerciseTitle)
  if (unit === 'kg') {
    // Kettlebells come in whole-kg increments; round to one decimal in
    // case the snapshot has fractional kg from prior conversion shenanigans.
    const rounded = Math.round(kg * 10) / 10
    // Strip trailing .0 for cleanliness (16 kg, not 16.0 kg).
    return `${rounded % 1 === 0 ? rounded.toFixed(0) : rounded} kg`
  }
  return `${Math.round(kg * 2.20462)} lbs`
}
