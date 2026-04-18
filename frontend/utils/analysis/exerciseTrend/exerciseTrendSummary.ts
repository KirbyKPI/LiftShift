import { format } from 'date-fns';
import type { ExerciseHistoryEntry, PrType } from '../../../types';
import type { ExerciseSessionEntry } from '../exerciseTrend/exerciseTrendCore';
import { calculateDirectionalStrengthScore } from '../../exercise/loadProgression';

export const summarizeExerciseHistory = (
  history: ExerciseHistoryEntry[],
  options?: { separateSides?: boolean; exerciseName?: string }
): ExerciseSessionEntry[] => {
  const separateSides = options?.separateSides ?? false;
  const exerciseName = options?.exerciseName;
  const bySession = new Map<string, ExerciseSessionEntry>();

  for (const h of history) {
    const d = h.date;
    if (!d) continue;

    const ts = d.getTime();
    // If separating sides, include side in the key so L and R create different entries
    const baseKey = Number.isFinite(ts) ? String(ts) : format(d, 'yyyy-MM-dd');
    const key = separateSides && h.side ? `${baseKey}-${h.side}` : baseKey;

    let entry = bySession.get(key);
    if (!entry) {
        entry = {
          date: d,
          weight: 0,
          reps: 0,
          oneRepMax: 0,
          directionalStrengthScore: 0,
          volume: 0,
          sets: 0,
          totalReps: 0,
          maxReps: 0,
        prTypes: [],
        silverPrTypes: [],
        side: separateSides ? h.side : undefined,
      };
      bySession.set(key, entry);
    }

    entry.sets += h.side ? 0.5 : 1; // L/R sets count as 0.5 each (pair = 1 set)
    entry.volume += h.volume || 0;
    entry.totalReps += h.reps || 0;
    entry.maxReps = Math.max(entry.maxReps, h.reps || 0);

    // Aggregate PR types from all sets in this session
    if (h.prTypes && h.prTypes.length > 0) {
      const currentTypes = new Set(entry.prTypes || []);
      h.prTypes.forEach((type) => currentTypes.add(type));
      entry.prTypes = Array.from(currentTypes);
    }
    
    // Aggregate Silver PR types from all sets in this session
    if (h.silverPrTypes && h.silverPrTypes.length > 0) {
      const currentSilverTypes = new Set(entry.silverPrTypes || []);
      h.silverPrTypes.forEach((type) => currentSilverTypes.add(type));
      entry.silverPrTypes = Array.from(currentSilverTypes);
    }

    const candidateOneRepMax = h.oneRepMax || 0;
    const candidateWeight = h.weight || 0;
    const candidateReps = h.reps || 0;
    const candidateScore = exerciseName
      ? calculateDirectionalStrengthScore(exerciseName, candidateWeight, candidateReps, candidateOneRepMax)
      : candidateOneRepMax;
    const currentScore = exerciseName
      ? (Number.isFinite(entry.directionalStrengthScore)
          ? (entry.directionalStrengthScore as number)
          : calculateDirectionalStrengthScore(exerciseName, entry.weight, entry.reps, entry.oneRepMax))
      : (entry.oneRepMax || 0);

    if (candidateScore >= currentScore) {
      entry.oneRepMax = candidateOneRepMax;
      entry.weight = candidateWeight;
      entry.reps = candidateReps;
      if (exerciseName) {
        entry.directionalStrengthScore = candidateScore;
      }
    }
  }

  return Array.from(bySession.values()).sort((a, b) => b.date.getTime() - a.date.getTime());
};
