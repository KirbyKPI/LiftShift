import { getMuscleParams, MUSCLE_PARAMS, type MuscleHypertrophyParams } from './muscleParams';
import type { HeadlessMuscleId } from '../mapping/muscleHeadless';
import { HEADLESS_MUSCLE_IDS, HEADLESS_MUSCLE_NAMES } from '../mapping/muscleHeadless';

// ---------------------------------------------------------------------------
// Weekly stimulus – logistic dose-response
// ---------------------------------------------------------------------------

/**
 * Estimate % of realistic possible weekly hypertrophy stimulus
 * using a per-muscle logistic dose-response model.
 *
 * Returns 0 when sets = 0. Asymptotically approaches ~95% at high volumes.
 * The curve shape is muscle-specific: large muscles need more sets to saturate.
 */
export function weeklyStimulus(sets: number, muscleId?: string): number {
  if (sets <= 0) return 0;

  const params = muscleId ? getMuscleParams(muscleId) : undefined;
  const a = params?.weeklySteepness ?? 0.30;
  const b = params?.weeklyInflection ?? 10;

  const raw = 1 / (1 + Math.exp(-a * (sets - b)));
  // Normalize so that ~25 sets/wk maps to ~95%
  const atCeiling = 1 / (1 + Math.exp(-a * (25 - b)));
  const scaled = (raw / atCeiling) * 95;

  return Math.min(99, Math.round(scaled * 10) / 10);
}

// ---------------------------------------------------------------------------
// Lifetime achievement – hyperbolic saturation with soft ceiling
// ---------------------------------------------------------------------------

/**
 * Estimate cumulative lifetime hypertrophy achievement as a % of natural
 * genetic potential, using a hyperbolic saturation model.
 *
 * Formula:  achievement = ceiling * (totalSets / (totalSets + halfLife))
 *
 * Properties:
 *   - At halfLife total sets → 50% of ceiling
 *   - Diminishing returns: early sets matter most
 *   - Never reaches ceiling (always room to grow)
 *   - Muscle-specific: large muscles need more lifetime volume
 */
export function lifetimeAchievement(totalSets: number, muscleId?: string): number {
  if (totalSets <= 0) return 0;

  const params = muscleId ? getMuscleParams(muscleId) : undefined;
  const halfLife = params?.lifetimeHalfLife ?? 3000;
  const ceiling = params?.lifetimeCeiling ?? 85;

  const raw = ceiling * (totalSets / (totalSets + halfLife));
  return Math.round(raw * 10) / 10;
}

// ---------------------------------------------------------------------------
// Tier system – & labels
// ---------------------------------------------------------------------------

export interface AchievementTier {
  readonly key: 'novice' | 'beginner' | 'intermediate' | 'advanced' | 'proficient' | 'accomplished' | 'exceptional' | 'master' | 'grandmaster' | 'legendary';
  readonly label: string;
  readonly description: string;
  readonly color: string;
  readonly bgColor: string;
}

const TIERS: readonly AchievementTier[] = [
  { key: 'novice',        label: 'Novice',        description: 'Starting your journey',           color: 'text-slate-400',  bgColor: 'bg-slate-500/15' },
  { key: 'beginner',      label: 'Beginner',      description: 'Learning the ropes',              color: 'text-slate-500',  bgColor: 'bg-slate-600/15' },
  { key: 'intermediate',  label: 'Intermediate',  description: 'Building momentum',               color: 'text-blue-400',   bgColor: 'bg-blue-500/15' },
  { key: 'advanced',      label: 'Advanced',      description: 'Visible progress showing',        color: 'text-emerald-400', bgColor: 'bg-emerald-500/15' },
  { key: 'proficient',    label: 'Proficient',    description: 'Solid gains achieved',            color: 'text-lime-400',   bgColor: 'bg-lime-500/15' },
  { key: 'accomplished',  label: 'Accomplished',  description: 'Serious muscle built',            color: 'text-amber-400',  bgColor: 'bg-amber-500/15' },
  { key: 'exceptional',   label: 'Exceptional',   description: 'Near elite status',               color: 'text-amber-600',  bgColor: 'bg-amber-600/15' },
  { key: 'master',        label: 'Master',        description: 'Elite-level development',         color: 'text-orange-400', bgColor: 'bg-orange-500/15' },
  { key: 'grandmaster',   label: 'Grandmaster',   description: 'Approaching genetic limit',       color: 'text-pink-400',   bgColor: 'bg-pink-500/15' },
  { key: 'legendary',     label: 'Legendary',     description: 'Among the most dedicated',        color: 'text-red-400',    bgColor: 'bg-red-500/15' },
];

export function getTier(achievementPercent: number): AchievementTier {
  if (achievementPercent >= 85) return TIERS[9]; // legendary
  if (achievementPercent >= 78) return TIERS[8]; // grandmaster
  if (achievementPercent >= 72) return TIERS[7]; // master
  if (achievementPercent >= 65) return TIERS[6]; // exceptional
  if (achievementPercent >= 58) return TIERS[5]; // accomplished
  if (achievementPercent >= 50) return TIERS[4]; // proficient
  if (achievementPercent >= 40) return TIERS[3]; // advanced
  if (achievementPercent >= 30) return TIERS[2]; // intermediate
  if (achievementPercent >= 20) return TIERS[1]; // beginner
  if (achievementPercent >= 10) return TIERS[0]; // novice
  return TIERS[0]; // novice (below 10%)
}

// Tier thresholds for progress calculation
const TIER_THRESHOLDS = [10, 20, 30, 40, 50, 58, 65, 72, 78, 85];

// ---------------------------------------------------------------------------
// Per-muscle achievement breakdown
// ---------------------------------------------------------------------------

export interface MuscleAchievementEntry {
  readonly muscleId: HeadlessMuscleId;
  readonly name: string;
  readonly lifetimeSets: number;
  readonly weeklySets: number;
  readonly achievementPercent: number;
  readonly tier: AchievementTier;
  readonly params: MuscleHypertrophyParams;
}

/**
 * Compute lifetime achievement for every headless muscle.
 *
 * @param lifetimeVolumes  Map from headless muscle ID → total lifetime sets
 * @param weeklyVolumes     Map from headless muscle ID → average weekly sets (optional)
 * @returns Sorted array (highest achievement first) of per-muscle entries
 */
export function computeAllMuscleAchievements(
  lifetimeVolumes: ReadonlyMap<string, number>,
  weeklyVolumes: ReadonlyMap<string, number> = new Map(),
): MuscleAchievementEntry[] {
  const entries: MuscleAchievementEntry[] = [];

  for (const id of HEADLESS_MUSCLE_IDS) {
    const sets = lifetimeVolumes.get(id) ?? 0;
    const weekly = weeklyVolumes.get(id) ?? 0;
    const params = MUSCLE_PARAMS[id];
    const pct = lifetimeAchievement(sets, id);

    entries.push({
      muscleId: id,
      name: HEADLESS_MUSCLE_NAMES[id],
      lifetimeSets: Math.round(sets * 10) / 10,
      weeklySets: Math.round(weekly * 10) / 10,
      achievementPercent: pct,
      tier: getTier(pct),
      params,
    });
  }

  return entries.sort((a, b) => b.achievementPercent - a.achievementPercent);
}

/**
 * Compute a single overall lifetime achievement %.
 * Weighted average: large muscles count 3x, medium 2x, small 1x.
 * Excludes the bottom 4 lowest-achievement muscles to avoid penalizing
 * intentional muscle neglect (e.g., skipping calves/forearms).
 */
export function computeOverallAchievement(
  lifetimeVolumes: ReadonlyMap<string, number>,
): number {
  const sizeWeight: Record<string, number> = { large: 3, medium: 2, small: 1 };
  const MUSCLES_TO_IGNORE = 4;

  // Collect all muscle achievements with their weights
  const muscleData: Array<{ pct: number; weight: number }> = [];

  for (const id of HEADLESS_MUSCLE_IDS) {
    const sets = lifetimeVolumes.get(id) ?? 0;
    const params = MUSCLE_PARAMS[id];
    const pct = lifetimeAchievement(sets, id);
    const weight = sizeWeight[params.size] ?? 1;
    muscleData.push({ pct, weight });
  }

  // Sort by achievement percentage ascending (lowest first)
  muscleData.sort((a, b) => a.pct - b.pct);

  // Exclude the bottom N muscles
  const relevantMuscles = muscleData.slice(MUSCLES_TO_IGNORE);

  if (relevantMuscles.length === 0) return 0;

  let weightedSum = 0;
  let totalWeight = 0;

  for (const { pct, weight } of relevantMuscles) {
    weightedSum += pct * weight;
    totalWeight += weight;
  }

  if (totalWeight === 0) return 0;
  return Math.round((weightedSum / totalWeight) * 10) / 10;
}
