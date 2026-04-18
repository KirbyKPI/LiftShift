import { WorkoutSet, AnalysisResult } from '../../../types';
import { isWarmupSet } from '../classification';
import { analyzeSameWeight } from './masterAlgorithmSameWeight';
import { analyzeWeightIncrease } from './masterAlgorithmWeightIncrease';
import { analyzeWeightDecrease } from './masterAlgorithmWeightDecrease';
import { buildExpectedRepsRange, type UserProfileContext } from './masterAlgorithmExpectedReps';
import { extractSetMetrics } from './masterAlgorithmMetrics';
import { calculateEpley1RM, calculatePercentChange } from './masterAlgorithmMath';
import { analyzeSession } from './masterAlgorithmSession';
import { analyzeProgression } from './masterAlgorithmProgression';
import { getStatusColor, getWisdomColor } from './masterAlgorithmColors';
import type { ExerciseAsset } from '../../../utils/data/exerciseAssets';
import type { WeightUnit } from '../../../utils/storage/localStorage';
import type { TrainingLevel } from '../config/commentaryConfig';
import { getTrainingParams } from '../userProfile';
import { directionalPercentChange, getLoadProgressionDirection, toDirectionalLoadKg } from '../../exercise/loadProgression';

export { isWarmupSet } from '../classification';
export { analyzeSession } from './masterAlgorithmSession';
export { analyzeProgression } from './masterAlgorithmProgression';
export { getStatusColor, getWisdomColor } from './masterAlgorithmColors';

export interface AnalyzeSetProgressionOptions {
  exerciseName?: string;
  historicalSets?: WorkoutSet[];
  trainingLevel?: TrainingLevel;
  weightUnit?: WeightUnit;
  assetsMap?: Map<string, ExerciseAsset>;
  repProfile?: UserProfileContext['repProfile'];
  isCompound?: boolean;
}

export const analyzeSetProgression = (
  sets: WorkoutSet[],
  options?: AnalyzeSetProgressionOptions
): AnalysisResult[] => {
  const workingSets = sets.filter(s => !isWarmupSet(s));

  if (workingSets.length < 2) return [];

  let userProfile: UserProfileContext | undefined;
  
  if (options?.repProfile && options?.trainingLevel) {
    const { repProfile, trainingLevel, isCompound } = options;
    const trainingParams = getTrainingParams(trainingLevel);
    
    userProfile = {
      repProfile,
      trainingParams,
      isCompound: isCompound ?? false,
    };
  }

  const results: AnalysisResult[] = [];
  const exerciseName = options?.exerciseName ?? workingSets[0]?.exercise_title ?? '';
  const isLowerWeightBetter = getLoadProgressionDirection(exerciseName) === 'lower';
  const maxRawWeight = isLowerWeightBetter
    ? Math.max(...workingSets.map((s) => Number.isFinite(s.weight_kg) ? s.weight_kg : 0))
    : 0;

  const toComparableWeight = (rawWeightKg: number): number => {
    if (!isLowerWeightBetter) return rawWeightKg;
    const shifted = (maxRawWeight - rawWeightKg) + 0.5;
    return Math.max(0.25, shifted);
  };

  const extractComparableMetrics = (set: WorkoutSet) => {
    const base = extractSetMetrics(set);
    if (!isLowerWeightBetter) return base;
    const comparableWeight = toComparableWeight(base.weight);
    return {
      ...base,
      weight: comparableWeight,
      volume: comparableWeight * base.reps,
      oneRM: calculateEpley1RM(comparableWeight, base.reps),
    };
  };

  const priorMetrics = [extractComparableMetrics(workingSets[0])];

  for (let i = 1; i < workingSets.length; i++) {
    const prev = priorMetrics[priorMetrics.length - 1];
    const curr = extractComparableMetrics(workingSets[i]);
    const prevRawWeight = workingSets[i - 1]?.weight_kg ?? 0;
    const currRawWeight = workingSets[i]?.weight_kg ?? 0;
    const transition = `Set ${i} → ${i + 1}`;

    const rawWeightChangePct = calculatePercentChange(prevRawWeight, currRawWeight);
    const directionalWeightChangePct = directionalPercentChange(
      toDirectionalLoadKg(prevRawWeight, exerciseName),
      toDirectionalLoadKg(currRawWeight, exerciseName)
    );
    const repChangePct = calculatePercentChange(prev.reps, curr.reps);

    let result: AnalysisResult;

    if (Math.abs(rawWeightChangePct) < 1.0 || Math.abs(directionalWeightChangePct) < 1.0) {
      result = analyzeSameWeight(
        transition,
        repChangePct,
        prev.reps,
        curr.reps,
        i + 1,
        isLowerWeightBetter ? 'lower' : 'higher'
      );
    } else if (directionalWeightChangePct > 0) {
      const expected = buildExpectedRepsRange(priorMetrics, curr.weight, i + 1, userProfile);
      result = analyzeWeightIncrease(
        transition,
        directionalWeightChangePct,
        prev.weight,
        curr.weight,
        prev.reps,
        curr.reps,
        expected,
        isLowerWeightBetter ? 'lower' : 'higher'
      );
    } else {
      const expected = buildExpectedRepsRange(priorMetrics, curr.weight, i + 1, userProfile);
      result = analyzeWeightDecrease(
        transition,
        directionalWeightChangePct,
        prev.weight,
        curr.weight,
        prev.reps,
        curr.reps,
        expected,
        isLowerWeightBetter ? 'lower' : 'higher'
      );
    }

    results.push(result);
    priorMetrics.push(curr);
  }

  return results;
};
