import { useMemo } from 'react';
import { differenceInCalendarDays } from 'date-fns';
import type { WorkoutSet } from '../../../types';
import { computeWeeklySetsSummary, computeWeeklySetsDelta } from '../utils/weeklySetsMetrics';
import type { WeeklySetsWindow } from '../../../utils/muscle/analytics';
import { computeDailyMuscleVolumes, computeDailySvgMuscleVolumes, computeWindowedExerciseBreakdown } from '../../../utils/muscle/volume';
import { HEADLESS_ID_TO_DETAILED_SVG_IDS, MUSCLE_GROUP_ORDER } from '../../../utils/muscle/mapping';
import { isWarmupSet } from '../../../utils/analysis/classification';
import type { NormalizedMuscleGroup } from '../../../utils/muscle/analytics';
import type { ExerciseAsset } from '../../../utils/data/exerciseAssets';
import { computationCache } from '../../../utils/storage/computationCache';
import { muscleCacheKeys } from '../../../utils/storage/cacheKeys';

interface UseMuscleTrendDataParams {
  data: WorkoutSet[];
  assetsMap: Map<string, ExerciseAsset> | null;
  windowStart: Date | null;
  effectiveNow: Date;
  allTimeWindowStart: Date | null;
  weeklySetsWindow: WeeklySetsWindow;
  viewMode: 'muscle' | 'group' | 'headless';
  selectedSubjectKeys: string[];
  groupWeeklyRatesBySubject: Map<string, number> | null;
  headlessRatesMap: Map<string, number>;
  muscleVolume: Map<string, { sets: number }>;
  windowedGroupVolumes: Map<NormalizedMuscleGroup, number>;
  muscleVolumes: Map<string, number>;
  filterCacheKey: string;
}

export const useMuscleTrendData = ({
  data,
  assetsMap,
  windowStart,
  effectiveNow,
  allTimeWindowStart,
  weeklySetsWindow,
  viewMode,
  selectedSubjectKeys,
  groupWeeklyRatesBySubject,
  headlessRatesMap,
  muscleVolume,
  windowedGroupVolumes,
  muscleVolumes,
  filterCacheKey,
}: UseMuscleTrendDataParams) => {
  const weeklySetsSummary = useMemo(() => {
    if (viewMode === 'headless') {
      if (selectedSubjectKeys.length > 0) {
        let sum = 0;
        for (const k of selectedSubjectKeys) sum += headlessRatesMap.get(k) ?? 0;
        return Math.round(sum * 10) / 10;
      }

      let sum = 0;
      for (const v of headlessRatesMap.values()) sum += v;
      return Math.round(sum * 10) / 10;
    }

    return computeWeeklySetsSummary({
      assetsMap,
      windowStart,
      selectedSubjectKeys,
      viewMode,
      data,
      effectiveNow,
      groupWeeklyRatesBySubject,
    });
  }, [assetsMap, windowStart, selectedSubjectKeys, viewMode, data, effectiveNow, groupWeeklyRatesBySubject, headlessRatesMap]);

  const weeklySetsDelta = useMemo(() => {
    return computeWeeklySetsDelta({
      assetsMap,
      windowStart,
      weeklySetsWindow,
      selectedSubjectKeys,
      viewMode,
      data,
      effectiveNow,
      allTimeWindowStart,
    });
  }, [assetsMap, windowStart, weeklySetsWindow, selectedSubjectKeys, viewMode, data, effectiveNow, allTimeWindowStart]);

  const trendData = useMemo(() => {
    if (!assetsMap || data.length === 0 || !windowStart) return [];

    // Create a hash of selected keys for cache key
    const selectedKeysHash = selectedSubjectKeys.sort().join(',') || 'all';
    const cacheKey = muscleCacheKeys.trendData(filterCacheKey, weeklySetsWindow, viewMode, selectedKeysHash);

    return computationCache.getOrCompute(
      cacheKey,
      data,
      () => {
        const isGroupMode = viewMode === 'group';
        const isHeadlessMode = viewMode === 'headless';

        // Get daily volumes (same calculation as dashboard)
        const dailyVolumes = isGroupMode
          ? computeDailyMuscleVolumes(data, assetsMap, true)
          : computeDailySvgMuscleVolumes(data, assetsMap);

        // Filter to window and calculate cumulative averages
        const windowedDaily = dailyVolumes.filter(d => d.date >= windowStart && d.date <= effectiveNow);
        if (windowedDaily.length === 0) return [];

        const keys = selectedSubjectKeys;

        // Helper to get sum for a day based on view mode and selection
        const getDaySum = (day: { muscles: ReadonlyMap<string, number> }) => {
          if (isHeadlessMode) {
            // For headless mode, aggregate detailed SVG parts to headless muscles using MAX
            const headlessTotals = new Map<string, number>();
            for (const [k, v] of day.muscles.entries()) {
              // Find which headless muscle this SVG id belongs to
              for (const [headlessId, detailedIds] of Object.entries(HEADLESS_ID_TO_DETAILED_SVG_IDS)) {
                if ((detailedIds as readonly string[]).includes(k)) {
                  const current = headlessTotals.get(headlessId) ?? 0;
                  if (v > current) headlessTotals.set(headlessId, v);
                  break;
                }
              }
            }
            
            if (keys.length > 0) {
              let sum = 0;
              for (const k of keys) sum += headlessTotals.get(k) ?? 0;
              return sum;
            }
            
            let sum = 0;
            for (const v of headlessTotals.values()) sum += v;
            return sum;
          }
          
          if (keys.length > 0) {
            let sum = 0;
            for (const k of keys) sum += (day.muscles.get(k) ?? 0) as number;
            return sum;
          }
          
          let sum = 0;
          for (const v of day.muscles.values()) sum += v;
          return sum;
        };

        // Build data points showing cumulative average weekly rate at each training day
        const result: Array<{ period: string; timestamp: number; sets: number }> = [];
        let cumulativeTotal = 0;
        
        for (const day of windowedDaily) {
          cumulativeTotal += getDaySum(day);
          const daysSinceStart = Math.max(1, differenceInCalendarDays(day.date, windowStart) + 1);
          const weeks = Math.max(1, daysSinceStart / 7);
          const avgWeeklyRate = Math.round((cumulativeTotal / weeks) * 10) / 10;
          
          result.push({
            period: day.date.toLocaleDateString('en-US', { month: 'short', day: 'numeric' }),
            timestamp: day.date.getTime(),
            sets: avgWeeklyRate,
          });
        }

        return result;
      },
      { ttl: 10 * 60 * 1000 }
    );
  }, [assetsMap, data, windowStart, effectiveNow, weeklySetsWindow, viewMode, selectedSubjectKeys, filterCacheKey]);

  const windowedSelectionBreakdown = useMemo(() => {
    if (!assetsMap || !windowStart) return null;

    const selectedKeysHash = selectedSubjectKeys.sort().join(',') || 'all';
    const cacheKey = muscleCacheKeys.exerciseBreakdown(
      filterCacheKey,
      windowStart.getTime(),
      viewMode,
      selectedKeysHash
    );

    return computationCache.getOrCompute(
      cacheKey,
      data,
      () => {
        const grouping = viewMode === 'group' ? 'groups' : 'muscles';

        const selectedForBreakdown =
          viewMode === 'headless'
            ? selectedSubjectKeys.flatMap((h) => (HEADLESS_ID_TO_DETAILED_SVG_IDS as any)[h] ?? [])
            : selectedSubjectKeys;

        return computeWindowedExerciseBreakdown({
          data,
          assetsMap,
          start: windowStart,
          end: effectiveNow,
          grouping,
          selectedSubjects: selectedForBreakdown,
        });
      },
      { ttl: 10 * 60 * 1000 }
    );
  }, [assetsMap, windowStart, effectiveNow, viewMode, selectedSubjectKeys, data, filterCacheKey]);

  const contributingExercises = useMemo(() => {
    if (!windowedSelectionBreakdown) return [];
    const exercises: Array<{ name: string; sets: number; primarySets: number; secondarySets: number }> = [];
    windowedSelectionBreakdown.exercises.forEach((exData, name) => {
      exercises.push({ name, ...exData });
    });
    return exercises.sort((a, b) => b.sets - a.sets);
  }, [windowedSelectionBreakdown]);

  const totalSets = useMemo(() => {
    return data.reduce((acc, s) => (isWarmupSet(s) ? acc : acc + 1), 0);
  }, [data]);

  const musclesWorked = useMemo(() => {
    if (viewMode === 'muscle') {
      let count = 0;
      muscleVolume.forEach((entry) => { if (entry.sets > 0) count++; });
      return count;
    }

    if (viewMode === 'headless') {
      let count = 0;
      for (const v of muscleVolumes.values()) {
        if ((v ?? 0) > 0) count += 1;
      }
      return count;
    }

    let count = 0;
    for (const g of MUSCLE_GROUP_ORDER) {
      if ((windowedGroupVolumes.get(g) ?? 0) > 0) count += 1;
    }
    return count;
  }, [viewMode, windowedGroupVolumes, muscleVolumes, muscleVolume]);

  return {
    weeklySetsSummary,
    weeklySetsDelta,
    trendData,
    windowedSelectionBreakdown,
    contributingExercises,
    totalSets,
    musclesWorked,
  };
};
