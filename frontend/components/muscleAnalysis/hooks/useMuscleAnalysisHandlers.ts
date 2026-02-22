import React, { useCallback, useMemo, useState } from 'react';
import {
  getHeadlessIdForDetailedSvgId,
  HEADLESS_MUSCLE_NAMES,
} from '../../../utils/muscle/mapping';
import { weeklyStimulusFromThresholds, getVolumeThresholds, getVolumeZone } from '../../../utils/muscle/hypertrophy';
import type { TooltipData } from '../../ui/Tooltip';
import type { WeeklySetsWindow } from '../../../utils/muscle/analytics';
import type { TrainingLevel } from '../../../utils/muscle/hypertrophy/muscleParams';

interface UseMuscleAnalysisHandlersParams {
  selectedMuscle: string | null;
  setSelectedMuscle: React.Dispatch<React.SetStateAction<string | null>>;
  selectedSvgIdForUrlRef: React.MutableRefObject<string | null>;
  clearSelectionUrl: () => void;
  updateSelectionUrl: (payload: { svgId: string; window: WeeklySetsWindow }) => void;
  weeklySetsWindow: WeeklySetsWindow;
  headlessRatesMap: Map<string, number>;
  setHoverTooltip: (value: TooltipData | null) => void;
  trainingLevel: TrainingLevel;
}

export const useMuscleAnalysisHandlers = ({
  selectedMuscle,
  setSelectedMuscle,
  selectedSvgIdForUrlRef,
  clearSelectionUrl,
  updateSelectionUrl,
  weeklySetsWindow,
  headlessRatesMap,
  setHoverTooltip,
  trainingLevel,
}: UseMuscleAnalysisHandlersParams) => {
  const [hoveredMuscle, setHoveredMuscle] = useState<string | null>(null);

  const volumeThresholds = useMemo(() => getVolumeThresholds(trainingLevel), [trainingLevel]);

  const handleMuscleClick = useCallback((muscleId: string) => {
    const isMobile = typeof window !== 'undefined' && window.innerWidth < 1024;
    
    setSelectedMuscle((prev) => {
      const next = prev === muscleId ? null : muscleId;
      if (!next) {
        selectedSvgIdForUrlRef.current = null;
        clearSelectionUrl();
      } else {
        selectedSvgIdForUrlRef.current = muscleId;
        updateSelectionUrl({ svgId: muscleId, window: weeklySetsWindow });
        // Scroll to detail panel on mobile after selection
        if (isMobile) {
          setTimeout(() => {
            const detailPanel = document.querySelector('[data-muscle-detail-panel]');
            detailPanel?.scrollIntoView({ behavior: 'smooth', block: 'start' });
          }, 50);
        }
      }
      return next;
    });
  }, [clearSelectionUrl, updateSelectionUrl, weeklySetsWindow, setSelectedMuscle, selectedSvgIdForUrlRef]);

  const handleMuscleHover = useCallback((muscleId: string | null, e?: MouseEvent) => {
    setHoveredMuscle(muscleId);
    if (!muscleId || !e) {
      setHoverTooltip(null);
      return;
    }

    const target = e.target as Element | null;
    const groupEl = target?.closest?.('g[id]') as Element | null;
    const rect = groupEl?.getBoundingClientRect?.() as DOMRect | undefined;
    if (!rect) {
      setHoverTooltip(null);
      return;
    }

    const rate = headlessRatesMap.get(muscleId) || 0;
    const zone = getVolumeZone(rate, volumeThresholds);
    const stimulus = weeklyStimulusFromThresholds(rate, volumeThresholds);
    const bodyText = `${rate.toFixed(1)} sets/wk — ${zone.label}\n${stimulus}% of possible gains\n${zone.explanation}`;

    setHoverTooltip({
      rect,
      title: (HEADLESS_MUSCLE_NAMES as any)[muscleId] ?? muscleId,
      body: bodyText,
      status: rate > 0 ? 'success' : 'default',
    });
  }, [headlessRatesMap, setHoverTooltip, volumeThresholds]);

  const selectedBodyMapIds = useMemo(() => {
    if (!selectedMuscle) return undefined;
    return [selectedMuscle];
  }, [selectedMuscle]);

  const hoveredBodyMapIds = useMemo(() => {
    if (!hoveredMuscle) return undefined;
    return [hoveredMuscle];
  }, [hoveredMuscle]);

  return {
    hoveredMuscle,
    handleMuscleClick,
    handleMuscleHover,
    selectedBodyMapIds,
    hoveredBodyMapIds,
  };
};
