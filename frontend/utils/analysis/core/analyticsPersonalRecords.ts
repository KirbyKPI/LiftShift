import type { PrType, WorkoutSet } from '../../../types';
import { getDateKey, type TimePeriod, sortByTimestamp } from '../../date/dateUtils';
import { isWarmupSet } from '../classification/setClassification';
import {
  PRTracker,
  createWeightTracker,
  createOneRmTracker,
  createVolumeTracker,
  roundTo,
} from './prCalculation';

const sortByParsedDate = (sets: WorkoutSet[], ascending: boolean): WorkoutSet[] => {
  const sign = ascending ? 1 : -1;
  return [...sets]
    .map((s, i) => ({ s, i }))
    .sort((a, b) => {
      const timeA = a.s.parsedDate?.getTime() ?? 0;
      const timeB = b.s.parsedDate?.getTime() ?? 0;
      const dt = timeA - timeB;
      if (dt !== 0) return dt * sign;

      const siA = a.s.set_index ?? 0;
      const siB = b.s.set_index ?? 0;
      const dsi = siA - siB;
      if (dsi !== 0) return dsi * sign;

      return (a.i - b.i) * sign;
    })
    .map((x) => x.s);
};

const calculateOneRepMax = (weight: number, reps: number): number => {
  if (reps <= 0 || weight <= 0) return 0;
  return roundTo(weight * (1 + reps / 30), 2);
};

export interface PRTypeFlags {
  isWeightPr: boolean;
  isOneRmPr: boolean;
  isVolumePr: boolean;
}

export const identifyPersonalRecords = (data: WorkoutSet[]): WorkoutSet[] => {
  const sorted = sortByParsedDate(data, true);
  const trackers: PRTracker[] = [
    createWeightTracker(),
    createOneRmTracker(),
    createVolumeTracker(),
  ];
  const prTypesMap = new Map<WorkoutSet, PrType[]>();

  for (const set of sorted) {
    if (isWarmupSet(set)) {
      prTypesMap.set(set, []);
      continue;
    }
    
    const exercise = set.exercise_title;
    const weight = set.weight_kg || 0;
    const reps = set.reps || 0;
    
    const prTypes: PrType[] = [];

    for (const tracker of trackers) {
      const currentValue = tracker.calculateValue(weight, reps);
      const previousBest = tracker.getPreviousBest(exercise);

      if (currentValue > 0 && currentValue > previousBest) {
        prTypes.push(tracker.type);
        tracker.setBest(exercise, currentValue);
      }
    }

    prTypesMap.set(set, prTypes);
  }

  return sortByParsedDate(sorted, false).map((set) => {
    const prTypes = prTypesMap.get(set) ?? [];
    return {
      ...set,
      isPr: prTypes.length > 0,
      prTypes,
    };
  });
};

export const getPrTypeFlags = (prTypes?: PrType[]): PRTypeFlags => {
  return {
    isWeightPr: prTypes?.includes('weight') ?? false,
    isOneRmPr: prTypes?.includes('oneRm') ?? false,
    isVolumePr: prTypes?.includes('volume') ?? false,
  };
};

export interface PRTimeEntry {
  count: number;
  timestamp: number;
  dateFormatted: string;
}

export const getPrsOverTime = (
  data: WorkoutSet[],
  mode: 'daily' | 'weekly' | 'monthly' = 'monthly'
): PRTimeEntry[] => {
  const period: TimePeriod = mode === 'monthly' ? 'monthly' : (mode === 'weekly' ? 'weekly' : 'daily');
  const grouped = new Map<string, PRTimeEntry>();

  for (const set of data) {
    if (!set.parsedDate || !set.isPr) continue;
    if (isWarmupSet(set)) continue;

    const { key, timestamp, label } = getDateKey(set.parsedDate, period);

    let entry = grouped.get(key);
    if (!entry) {
      entry = { count: 0, timestamp, dateFormatted: label };
      grouped.set(key, entry);
    }
    entry.count += 1;
  }

  return sortByTimestamp(Array.from(grouped.values()));
};
