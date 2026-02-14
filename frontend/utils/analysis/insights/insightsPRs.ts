import { differenceInDays, subDays } from 'date-fns';
import { WorkoutSet } from '../../../types';
import {
  PRDetectionResult,
  createAllPRTrackers,
  sortSetsChronologically,
  detectPRsWithTrackers,
} from '../core/prCalculation';

export type RecentPR = PRDetectionResult;

export interface PRInsights {
  daysSinceLastPR: number;
  lastPRDate: Date | null;
  lastPRExercise: string | null;
  prDrought: boolean;
  recentPRs: RecentPR[];
  prFrequency: number;
  totalPRs: number;
}

export const calculatePRInsights = (data: WorkoutSet[], now: Date = new Date(0)): PRInsights => {
  const sorted = sortSetsChronologically(data);

  if (sorted.length === 0) {
    return {
      daysSinceLastPR: 0,
      lastPRDate: null,
      lastPRExercise: null,
      prDrought: false,
      recentPRs: [],
      prFrequency: 0,
      totalPRs: 0,
    };
  }

  const trackers = createAllPRTrackers();
  const prEvents = detectPRsWithTrackers(sorted, trackers);

  if (prEvents.length === 0) {
    return {
      daysSinceLastPR: 0,
      lastPRDate: null,
      lastPRExercise: null,
      prDrought: false,
      recentPRs: [],
      prFrequency: 0,
      totalPRs: 0,
    };
  }

  const lastPR = prEvents[prEvents.length - 1];
  const daysSinceLastPR = differenceInDays(now, lastPR.date);

  const recentPRs: RecentPR[] = prEvents.slice(-5).reverse();

  const thirtyDaysAgo = subDays(now, 30);
  const recentPRCount = prEvents.filter((pr) => pr.date >= thirtyDaysAgo).length;
  const prFrequency = Math.round((recentPRCount / 4) * 10) / 10;

  return {
    daysSinceLastPR,
    lastPRDate: lastPR.date,
    lastPRExercise: lastPR.exercise,
    prDrought: daysSinceLastPR > 14,
    recentPRs,
    prFrequency,
    totalPRs: prEvents.length,
  };
};
