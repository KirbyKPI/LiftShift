import { useMemo } from 'react';
import {
  computeAllMuscleAchievements,
  computeOverallAchievement,
  lifetimeAchievement,
  getTier,
} from '../../../utils/muscle/hypertrophy';
import type { MuscleAchievementEntry, AchievementTier } from '../../../utils/muscle/hypertrophy';
import type { HeadlessMuscleId } from '../../../utils/muscle/mapping/muscleHeadless';
import { HEADLESS_MUSCLE_NAMES } from '../../../utils/muscle/mapping/muscleHeadless';
import { HEADLESS_ID_TO_DETAILED_SVG_IDS } from '../../../utils/muscle/mapping/muscleSvgMappings';
import type { NormalizedMuscleGroup } from '../../../utils/muscle/analytics';
import { getSvgIdsForGroup, MUSCLE_GROUP_ORDER } from '../../../utils/muscle/mapping/muscleGroupMappings';
import { getHeadlessIdForDetailedSvgId } from '../../../utils/muscle/mapping/muscleSvgMappings';

export interface LifetimeAchievementData {
  /** Overall weighted achievement % across all muscles */
  overallPercent: number;
  /** Overall tier */
  overallTier: AchievementTier;
  /** Per-muscle breakdown (sorted highest achievement first) */
  muscles: MuscleAchievementEntry[];
  /** Context-specific achievement (for selected muscle/group, or overall if nothing selected) */
  contextPercent: number;
  /** Context-specific tier */
  contextTier: AchievementTier;
  /** Context label (e.g., "Chest", "Legs", or "Overall") */
  contextLabel: string;
  /** Total lifetime sets across all muscles */
  totalLifetimeSets: number;
}

interface UseLifetimeAchievementParams {
  lifetimeHeadlessVolumes: ReadonlyMap<string, number>;
  weeklyHeadlessVolumes?: ReadonlyMap<string, number>;
  selectedMuscle: string | null;
  viewMode: 'muscle' | 'group' | 'headless';
}

/**
 * Computes lifetime hypertrophy achievement data for the current selection context.
 *
 * - No selection → overall weighted average
 * - Headless muscle selected → that specific muscle's achievement
 * - Group selected → weighted average of muscles in that group
 * - Detailed muscle selected → resolved to headless parent
 */
export function useLifetimeAchievement({
  lifetimeHeadlessVolumes,
  weeklyHeadlessVolumes,
  selectedMuscle,
  viewMode,
}: UseLifetimeAchievementParams): LifetimeAchievementData {
  return useMemo(() => {
    const muscles = computeAllMuscleAchievements(lifetimeHeadlessVolumes, weeklyHeadlessVolumes);
    const overallPercent = computeOverallAchievement(lifetimeHeadlessVolumes);
    const overallTier = getTier(overallPercent);

    let totalLifetimeSets = 0;
    for (const v of lifetimeHeadlessVolumes.values()) totalLifetimeSets += v;
    totalLifetimeSets = Math.round(totalLifetimeSets * 10) / 10;

    // No selection → show overall
    if (!selectedMuscle) {
      return {
        overallPercent,
        overallTier,
        muscles,
        contextPercent: overallPercent,
        contextTier: overallTier,
        contextLabel: 'Overall',
        totalLifetimeSets,
      };
    }

    // Headless muscle view → direct lookup
    if (viewMode === 'headless') {
      const entry = muscles.find((m) => m.muscleId === selectedMuscle);
      if (entry) {
        return {
          overallPercent,
          overallTier,
          muscles,
          contextPercent: entry.achievementPercent,
          contextTier: entry.tier,
          contextLabel: entry.name,
          totalLifetimeSets,
        };
      }
    }

    // Group view → average across muscles in that group
    if (viewMode === 'group') {
      const group = selectedMuscle as NormalizedMuscleGroup;
      if (MUSCLE_GROUP_ORDER.includes(group)) {
        const svgIds = getSvgIdsForGroup(group);
        const headlessIds = new Set<string>();
        for (const svgId of svgIds) {
          const h = getHeadlessIdForDetailedSvgId(svgId);
          if (h) headlessIds.add(h);
          // Also check if the svgId itself is a headless ID
          if ((HEADLESS_MUSCLE_NAMES as Record<string, string>)[svgId]) {
            headlessIds.add(svgId);
          }
        }

        if (headlessIds.size > 0) {
          let sum = 0;
          let count = 0;
          for (const hid of headlessIds) {
            const sets = lifetimeHeadlessVolumes.get(hid) ?? 0;
            sum += lifetimeAchievement(sets, hid);
            count++;
          }
          const groupPct = count > 0 ? Math.round((sum / count) * 10) / 10 : 0;
          return {
            overallPercent,
            overallTier,
            muscles,
            contextPercent: groupPct,
            contextTier: getTier(groupPct),
            contextLabel: group,
            totalLifetimeSets,
          };
        }
      }
    }

    // Detailed muscle view → resolve to headless parent
    if (viewMode === 'muscle') {
      const headlessId = getHeadlessIdForDetailedSvgId(selectedMuscle);
      if (headlessId) {
        const entry = muscles.find((m) => m.muscleId === headlessId);
        if (entry) {
          return {
            overallPercent,
            overallTier,
            muscles,
            contextPercent: entry.achievementPercent,
            contextTier: entry.tier,
            contextLabel: entry.name,
            totalLifetimeSets,
          };
        }
      }
    }

    // Fallback → overall
    return {
      overallPercent,
      overallTier,
      muscles,
      contextPercent: overallPercent,
      contextTier: overallTier,
      contextLabel: 'Overall',
      totalLifetimeSets,
    };
  }, [lifetimeHeadlessVolumes, selectedMuscle, viewMode]);
}
