import type { PrType, WorkoutSet } from '../../../types';
import { isWarmupSet } from '../classification/setClassification';

export const roundTo = (value: number, decimals: number): number => {
  const factor = Math.pow(10, decimals);
  return Math.round(value * factor) / factor;
};

export const calculateOneRepMax = (weight: number, reps: number): number => {
  if (reps <= 0 || weight <= 0) return 0;
  return roundTo(weight * (1 + reps / 30), 2);
};

export interface PRTracker {
  type: PrType;
  getPreviousBest: (exercise: string) => number;
  setBest: (exercise: string, value: number) => void;
  calculateValue: (weight: number, reps: number) => number;
  getImprovement: (previous: number, current: number) => number;
}

export const createWeightTracker = (): PRTracker => {
  const map = new Map<string, number>();
  return {
    type: 'weight',
    getPreviousBest: (exercise: string) => map.get(exercise) ?? 0,
    setBest: (exercise: string, value: number) => map.set(exercise, value),
    calculateValue: (weight: number) => weight,
    getImprovement: (previous: number, current: number) => current - previous,
  };
};

export const createOneRmTracker = (): PRTracker => {
  const map = new Map<string, number>();
  return {
    type: 'oneRm',
    getPreviousBest: (exercise: string) => map.get(exercise) ?? 0,
    setBest: (exercise: string, value: number) => map.set(exercise, value),
    calculateValue: (weight: number, reps: number) => calculateOneRepMax(weight, reps),
    getImprovement: (previous: number, current: number) => roundTo(current - previous, 2),
  };
};

export const createVolumeTracker = (): PRTracker => {
  const map = new Map<string, number>();
  return {
    type: 'volume',
    getPreviousBest: (exercise: string) => map.get(exercise) ?? 0,
    setBest: (exercise: string, value: number) => map.set(exercise, value),
    calculateValue: (weight: number, reps: number) => weight * reps,
    getImprovement: (previous: number, current: number) => current - previous,
  };
};

export interface PRDetectionResult {
  exercise: string;
  weight: number;
  reps: number;
  date: Date;
  previousBest: number;
  improvement: number;
  type: PrType;
}

export const detectPRsWithTrackers = (
  sortedSets: WorkoutSet[],
  trackers: PRTracker[]
): PRDetectionResult[] => {
  const prEvents: PRDetectionResult[] = [];

  for (const set of sortedSets) {
    if (isWarmupSet(set)) continue;
    
    const exercise = set.exercise_title || 'Unknown';
    const weight = set.weight_kg || 0;
    const reps = set.reps || 0;

    for (const tracker of trackers) {
      const currentValue = tracker.calculateValue(weight, reps);
      const previousBest = tracker.getPreviousBest(exercise);

      if (currentValue > 0 && currentValue > previousBest) {
        prEvents.push({
          exercise,
          weight,
          reps,
          date: set.parsedDate!,
          previousBest,
          improvement: tracker.getImprovement(previousBest, currentValue),
          type: tracker.type,
        });
        tracker.setBest(exercise, currentValue);
      }
    }
  }

  return prEvents;
};

export const sortSetsChronologically = (sets: WorkoutSet[]): WorkoutSet[] => {
  return [...sets]
    .filter((s) => s.parsedDate && !isWarmupSet(s) && (s.weight_kg || 0) > 0)
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const dt = (a.s.parsedDate!.getTime() || 0) - (b.s.parsedDate!.getTime() || 0);
      if (dt !== 0) return dt;
      return a.i - b.i;
    })
    .map(({ s }) => s);
};

export const createAllPRTrackers = (): PRTracker[] => [
  createWeightTracker(),
  createOneRmTracker(),
  createVolumeTracker(),
];
