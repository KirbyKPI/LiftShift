export type LoadProgressionDirection = 'higher' | 'lower';

const LOWER_WEIGHT_REP_TIEBREAKER = 0.1;

const LOWER_IS_HARDER_PATTERNS: readonly RegExp[] = [
  /\bassisted\b/i,
  /\bassist(?:ed|ance)?\b/i,
  /\bcounter\s*-?\s*weight\b/i,
  /\bgravitron\b/i,
];

const hasDirectionSignal = (name: string): boolean => /assist|counter|gravitron/i.test(name);

export const isLowerWeightBetterExerciseName = (exerciseName: string): boolean => {
  const name = String(exerciseName ?? '').trim();
  if (!name) return false;
  if (!hasDirectionSignal(name)) return false;
  return LOWER_IS_HARDER_PATTERNS.some((pattern) => pattern.test(name));
};

export const getLoadProgressionDirection = (exerciseName: string): LoadProgressionDirection => {
  return isLowerWeightBetterExerciseName(exerciseName) ? 'lower' : 'higher';
};

export const toDirectionalLoadKg = (weightKg: number, exerciseName: string): number => {
  const safeWeight = Number.isFinite(weightKg) ? weightKg : 0;
  return getLoadProgressionDirection(exerciseName) === 'lower' ? -safeWeight : safeWeight;
};

export const getDirectionalWeightDeltaKg = (
  exerciseName: string,
  previousWeightKg: number,
  currentWeightKg: number
): number => {
  return toDirectionalLoadKg(currentWeightKg, exerciseName) - toDirectionalLoadKg(previousWeightKg, exerciseName);
};

const calculateEpleyOneRepMax = (weight: number, reps: number): number => {
  if (reps <= 0 || weight <= 0) return 0;
  return weight * (1 + reps / 30);
};

export const calculateDirectionalStrengthScore = (
  exerciseName: string,
  weightKg: number,
  reps: number,
  oneRepMax?: number
): number => {
  if (getLoadProgressionDirection(exerciseName) === 'lower') {
    const safeReps = Number.isFinite(reps) ? Math.max(0, reps) : 0;
    return toDirectionalLoadKg(weightKg, exerciseName) + safeReps * LOWER_WEIGHT_REP_TIEBREAKER;
  }

  if (Number.isFinite(oneRepMax) && (oneRepMax as number) > 0) {
    return oneRepMax as number;
  }

  return calculateEpleyOneRepMax(weightKg, reps);
};

export const calculateDirectionalEpleyScore = (
  exerciseName: string,
  weightKg: number,
  reps: number
): number => {
  const oneRepMax = calculateEpleyOneRepMax(weightKg, reps);
  if (oneRepMax <= 0) return 0;
  return getLoadProgressionDirection(exerciseName) === 'lower' ? -oneRepMax : oneRepMax;
};

export const calculateDirectionalVolumeScore = (
  exerciseName: string,
  weightKg: number,
  reps: number
): number => {
  if (weightKg <= 0 || reps <= 0) return 0;
  return toDirectionalLoadKg(weightKg, exerciseName) * reps;
};

export const directionalPercentChange = (previousDirectionalValue: number, currentDirectionalValue: number): number => {
  const baseline = Math.abs(previousDirectionalValue);
  if (!Number.isFinite(previousDirectionalValue) || !Number.isFinite(currentDirectionalValue) || baseline <= 0.0001) {
    return 0;
  }
  return Number((((currentDirectionalValue - previousDirectionalValue) / baseline) * 100).toFixed(1));
};
