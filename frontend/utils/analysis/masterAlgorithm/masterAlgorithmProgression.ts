import { WorkoutSet, SetWisdom } from '../../../types';
import { isWarmupSet } from '../classification';
import { MIN_HYPERTROPHY_REPS } from './masterAlgorithmConstants';
import type { WeightUnit } from '../../storage/localStorage';
import type { ExerciseProgressionProfile } from '../userProfile';
import { convertWeight } from '../../format/units';
import { getSuggestedWeightForTarget } from '../userProfile';
import { pickDeterministic } from '../common/messageVariations';

const fmt = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  return Number.isInteger(rounded) ? `${rounded}` : `${rounded}`;
};

const roundReps = (value: number): number => Math.max(3, Math.round(value));

const PROMOTE_MESSAGES = [
  'Ceiling hit, ready to progress',
  'Ready to level up',
  'Time to add weight',
  'You have outgrown this load',
  'Strong performance, progress awaits',
  'Crushed the ceiling, move up',
  'Load maxed out, add weight',
  'At your limit, push forward',
  'Ceiling reached, ready for more',
  'Ready to advance',
  'Time to increase the challenge',
  'You have earned a weight increase',
  'Performance ceiling hit',
  'Ready for heavier load',
  'Push to the next level',
] as const;

const PROMOTE_TOOLTIPS = [
  'Next session: Use ~{upDisplay}, aim for {targetReps}+ reps across all sets, then move up again',
  'Progress: Try ~{upDisplay}, get {targetReps}+ reps on all sets, then add more weight',
  'Advance: Use ~{upDisplay} for {targetReps}+ reps on each set, then increase weight',
  'Level up: Switch to ~{upDisplay}, hit {targetReps}+ reps on all sets, then add weight',
  'Add weight: Go to ~{upDisplay}, aim for {targetReps}+ reps consistently, then progress',
  'Push forward: Try ~{upDisplay} for {targetReps}+ reps on each set, then increase load',
  'Next step: Use ~{upDisplay}, lock in {targetReps}+ reps per set, then add weight',
  'Ready: Try ~{upDisplay}, hit {targetReps}+ reps on all sets, then go heavier',
  'Advance: Pick ~{upDisplay}, get {targetReps}+ reps every set, then add load',
  'Move up: Use ~{upDisplay}, achieve {targetReps}+ reps across sets, then increase',
] as const;

const DEMOTE_HEAVY_MESSAGES = [
  'Load is limiting you',
  'Weight too heavy',
  'Too heavy for progress',
  'Load exceeding capacity',
  'Weight holding you back',
  'Heavier is not working',
  'Drop weight to progress',
  'Load needs to come down',
  'Too heavy to grow',
  'Weight blocks progress',
  'Heavy is not helping',
  'Load needs reduction',
] as const;

const DEMOTE_HEAVY_TOOLTIPS = [
  'Next: Use ~{downDisplay}, aim for {rebuildTarget}+ reps across all sets, then rebuild',
  'Drop down: Try ~{downDisplay}, get {rebuildTarget}+ reps on all sets before adding weight',
  'Lighter load: Use ~{downDisplay} and target {rebuildTarget}+ reps on each set',
  'Scale back: Go to ~{downDisplay}, hit {rebuildTarget}+ reps consistently, then progress',
  'Reduce weight: Try ~{downDisplay} for {rebuildTarget}+ reps on each set, then increase',
  'Step down: Use ~{downDisplay}, achieve {rebuildTarget}+ reps per set before adding load',
  'Come down: Pick ~{downDisplay}, lock in {rebuildTarget}+ reps on all sets, then advance',
  'Lighter: Use ~{downDisplay}, get {rebuildTarget}+ reps across sets before progressing',
] as const;

const DEMOTE_INCONSISTENT_MESSAGES = [
  'Load control is inconsistent',
  'Reps are all over the place',
  'Output varies too much',
  'Sets need to stabilize',
  'Consistency is the issue',
  'Reps need to even out',
  'Work on uniform output',
  'Sets are uneven',
  'Need steady performance',
  'Output needs to converge',
  'Variable performance',
  'Reps are too scattered',
] as const;

const DEMOTE_INCONSISTENT_TOOLTIPS = [
  'Next: Use ~{preferredWeight}, aim for {targetReps}+ reps across all sets, then progress',
  'Stabilize: Try ~{preferredWeight}, get {targetReps}+ reps on each set, then add weight',
  'Even out: Use ~{preferredWeight} and target {targetReps}+ reps on every set',
  'Consistency: Go to ~{preferredWeight}, hit {targetReps}+ reps on all sets before advancing',
  'Uniform output: Try ~{preferredWeight} for {targetReps}+ reps on each set, then increase',
  'Steady: Use ~{preferredWeight}, achieve {targetReps}+ reps per set before adding load',
  'Even performance: Pick ~{preferredWeight}, lock in {targetReps}+ reps on all sets, then progress',
  'Converge: Use ~{preferredWeight}, get {targetReps}+ reps across sets before moving up',
] as const;

export interface AnalyzeProgressionOptions {
  typicalWeightJump?: number;
  weightUnit?: WeightUnit;
  isCompound?: boolean;
  progressionProfile?: ExerciseProgressionProfile | null;
}

export const analyzeProgression = (
  allSetsForExercise: WorkoutSet[],
  _targetReps = 10,
  options?: AnalyzeProgressionOptions
): SetWisdom | null => {
  const workingSets = allSetsForExercise.filter(s => !isWarmupSet(s) && s.reps > 0 && s.weight_kg > 0);
  if (workingSets.length < 2) return null;

  const weightUnit = options?.weightUnit ?? 'kg';
  const profile = options?.progressionProfile;
  if (!profile || profile.availableWeights.length === 0) return null;

  const sets = workingSets.map((s) => ({ reps: s.reps, weight: convertWeight(s.weight_kg, weightUnit) }));
  const reps = sets.map((s) => s.reps);
  const weights = sets.map((s) => s.weight);
  const maxWeight = Math.max(...weights);
  const topWeightSets = sets.filter((s) => s.weight >= maxWeight * 0.95);
  if (topWeightSets.length === 0) return null;

  const topWeightReps = topWeightSets.map((s) => s.reps);
  const minReps = Math.min(...reps);
  const maxReps = Math.max(...reps);
  const spread = maxReps - minReps;
  const avgReps = Math.round(reps.reduce((a, b) => a + b, 0) / reps.length);

  const targetReps = roundReps(profile.repTarget);
  const ceilingReps = roundReps(profile.repCeiling);
  const topWeightDisplay = `${fmt(maxWeight)}${weightUnit}`;

  const suggestedDownWeight = getSuggestedWeightForTarget(profile, maxWeight, 'down');
  const suggestedUpWeight = getSuggestedWeightForTarget(profile, maxWeight, 'up');
  const downDisplay = `${fmt(suggestedDownWeight)}${weightUnit}`;
  const upDisplay = `${fmt(suggestedUpWeight)}${weightUnit}`;

  const seedBase = `progression-${maxWeight}-${reps.join('-')}`;

  // Strong promote only when top load is repeated and both sets are at/above ceiling
  const topRepeated = topWeightReps.length >= 2;
  const topAllAtCeiling = topWeightReps.every((r) => r >= ceilingReps);
  if (topRepeated && topAllAtCeiling) {
    const message = pickDeterministic(`${seedBase}|promote`, PROMOTE_MESSAGES as readonly string[]) as string;
    let tooltip = pickDeterministic(`${seedBase}|promote-tip`, PROMOTE_TOOLTIPS as readonly string[]) as string;
    tooltip = tooltip
      .replace('{upDisplay}', upDisplay)
      .replace('{targetReps}', String(targetReps));
    return {
      type: 'promote',
      message,
      tooltip,
    };
  }

  // Too heavy if output collapses below hypertrophy floor
  if (minReps < MIN_HYPERTROPHY_REPS) {
    const rebuildTarget = Math.max(MIN_HYPERTROPHY_REPS, targetReps);
    const message = pickDeterministic(`${seedBase}|demote-heavy`, DEMOTE_HEAVY_MESSAGES as readonly string[]) as string;
    let tooltip = pickDeterministic(`${seedBase}|demote-heavy-tip`, DEMOTE_HEAVY_TOOLTIPS as readonly string[]) as string;
    tooltip = tooltip
      .replace('{downDisplay}', downDisplay)
      .replace('{rebuildTarget}', String(rebuildTarget));
    return {
      type: 'demote',
      message,
      tooltip,
    };
  }

  // Inconsistency branch: keep/choose weight based on average-target fit
  if (spread >= 2) {
    // If current top weight is above target output, settle one step down
    const preferredWeight = avgReps < targetReps ? downDisplay : topWeightDisplay;
    const message = pickDeterministic(`${seedBase}|demote-inconsistent`, DEMOTE_INCONSISTENT_MESSAGES as readonly string[]) as string;
    let tooltip = pickDeterministic(`${seedBase}|demote-inconsistent-tip`, DEMOTE_INCONSISTENT_TOOLTIPS as readonly string[]) as string;
    tooltip = tooltip
      .replace('{preferredWeight}', preferredWeight)
      .replace('{targetReps}', String(targetReps));
    return {
      type: 'demote',
      message,
      tooltip,
    };
  }

  return null;
};
