import React from 'react';
import { Trophy, Award, BarChart3 } from 'lucide-react';
import { ExerciseStats, PrType } from '../../../types';
import { ExerciseSessionEntry } from '../../../utils/analysis/exerciseTrend';
import { convertWeight } from '../../../utils/format/units';
import { formatNumber } from '../../../utils/format/formatters';
import { WeightUnit } from '../../../utils/storage/localStorage';
import { getLoadProgressionDirection } from '../../../utils/exercise/loadProgression';

export const StrengthProgressionValueDot = (props: any) => {
  const {
    cx,
    cy,
    payload,
    index,
    data,
    valueKey,
    unit,
    showDotWhenHidden = true,
    color = 'var(--text-muted)',
    prTypesToShow,
    labelPosition,
    selectedStats,
  } = props;

  if (!payload || cx === undefined || cy === undefined) return null;

  const value = payload[valueKey];
  if (typeof value !== 'number') return null;

  const prGold = '#d97706';
  const prSilver = '#64748b';
  const eps = 0.001;
  const isLowerWeightBetter =
    selectedStats && typeof selectedStats.name === 'string'
      ? getLoadProgressionDirection(selectedStats.name) === 'lower'
      : false;

  const isBetterValue = (candidate: number, currentBest: number): boolean => {
    if (!Number.isFinite(candidate)) return false;
    if (!Number.isFinite(currentBest)) return true;
    return isLowerWeightBetter ? candidate < currentBest : candidate > currentBest;
  };

  // Calculate global best value for this metric across all data
  let globalBestValue = Number.NaN;
  let firstGlobalBestIndex: number | null = null;
  
  // Calculate best silver value and its first index
  let bestSilverValue = Number.NaN;
  let firstSilverBestIndex: number | null = null;
  
  if (Array.isArray(data)) {
    for (let i = 0; i < data.length; i++) {
      const row = data[i];
      const v = row?.[valueKey];
      
      if (typeof v !== 'number') continue;

      // Track global best
      if (isBetterValue(v, globalBestValue)) {
        globalBestValue = v;
        firstGlobalBestIndex = i;
      }

      // Track silver best
      if (row?.isSilverPr && isBetterValue(v, bestSilverValue)) {
        bestSilverValue = v;
        firstSilverBestIndex = i;
      }
    }
  }

  const isGlobalBest = Number.isFinite(globalBestValue) && Math.abs(value - globalBestValue) <= eps;

  // Get PR types from payload
  const combinedPrTypes: PrType[] = payload.prTypes || [];
  let allPrTypes: PrType[] = combinedPrTypes;
  
  if (valueKey === 'weight' && payload.weightPrTypes) {
    allPrTypes = payload.weightPrTypes;
  } else if (valueKey === 'oneRepMax' && payload.oneRmPrTypes) {
    allPrTypes = payload.oneRmPrTypes;
  }

  let filteredPrTypes = prTypesToShow
    ? allPrTypes.filter((t: PrType) => prTypesToShow.includes(t))
    : allPrTypes;


  // Check for Gold PR
  const shouldShowPr = isGlobalBest && filteredPrTypes.length > 0;
  
 
  // Get Silver PR types
  const combinedSilverPrTypes: PrType[] = payload.silverPrTypes || [];
  let allSilverPrTypes: PrType[] = combinedSilverPrTypes;
  
  if (valueKey === 'weight' && payload.silverWeightPrTypes) {
    allSilverPrTypes = payload.silverWeightPrTypes;
  } else if (valueKey === 'oneRepMax' && payload.silverOneRmPrTypes) {
    allSilverPrTypes = payload.silverOneRmPrTypes;
  }

  let filteredSilverPrTypes = prTypesToShow
    ? allSilverPrTypes.filter((t: PrType) => prTypesToShow.includes(t))
    : allSilverPrTypes;

  // Suppress 1RM silver if weight silver exists on same session
  if (prTypesToShow?.includes('oneRm') && payload.silverWeightPrTypes?.length > 0 && payload.silverOneRmPrTypes?.length > 0) {
    filteredSilverPrTypes = filteredSilverPrTypes.filter((t: PrType) => t !== 'oneRm');
  }

  // Check for Silver PR (only if not showing gold)
  const isSilverPr = !shouldShowPr && payload.isSilverPr && filteredSilverPrTypes.length > 0;
  const isBestSilverPr =
    isSilverPr
    && index === firstSilverBestIndex
    && Number.isFinite(bestSilverValue)
    && Math.abs(value - bestSilverValue) <= eps;

  // Show label for gold PR at first best, or for silver PR at best silver
  const shouldShowLabel = shouldShowPr 
    ? index === firstGlobalBestIndex
    : isBestSilverPr;

  if (!shouldShowLabel) {
    if (!showDotWhenHidden) return null;
    const dotColor = shouldShowPr ? prGold : isSilverPr ? prSilver : color;
    return <circle cx={cx} cy={cy} r={3} fill={dotColor} stroke={dotColor} strokeWidth={1} />;
  }

  const displayValue = unit
    ? `${formatNumber(value, { maxDecimals: 1 })}${unit}`
    : Number.isInteger(value)
      ? value.toString()
      : formatNumber(value, { maxDecimals: 1 });

  // Calculate positioning
  const totalPoints = Array.isArray(data) ? data.length : 0;
  const isOnRightSide = totalPoints > 0 && (index ?? 0) >= totalPoints * 0.7;
  const isOnLeftSide = totalPoints > 0 && (index ?? 0) <= totalPoints * 0.3;
  const isNearTop = cy < 30;

  // Force position based on labelPosition prop, otherwise use smart positioning
  const forceAbove = labelPosition === 'above';
  const forceBelow = labelPosition === 'below';
  
  const labelY = forceBelow 
    ? cy + 14 
    : forceAbove 
      ? cy - 10 
      : (isNearTop ? cy + 16 : cy - 10);
  const charWidth = 5.5;
  const textWidth = displayValue.length * charWidth;

  let trophyX: number;
  if (isOnRightSide) {
    trophyX = cx - textWidth / 2 - 12;
  } else if (isOnLeftSide) {
    trophyX = cx + textWidth / 2 + 3;
  } else {
    trophyX = cx + textWidth / 2 + 3;
  }

  const trophyY = labelY - 8;

  // Select icon
  const activePrTypes = shouldShowPr ? filteredPrTypes : filteredSilverPrTypes;
  let TrophyIcon = Trophy;
  if (activePrTypes.includes('weight')) {
    TrophyIcon = Trophy;
  } else if (activePrTypes.includes('oneRm')) {
    TrophyIcon = Award;
  } else if (activePrTypes.includes('volume')) {
    TrophyIcon = BarChart3;
  }

  // Styling
  const dotColor = shouldShowPr ? prGold : prSilver;
  const iconSize = isSilverPr ? 8 : 10;
  const iconOpacity = isSilverPr ? 0.7 : 1;

  return (
    <g>
      <circle cx={cx} cy={cy} r={isSilverPr ? 2 : 3} fill={dotColor} stroke={dotColor} strokeWidth={1} opacity={iconOpacity} />
      <text x={cx} y={labelY} fill={dotColor} fontSize={isSilverPr ? 8 : 9} fontWeight={isSilverPr ? 'normal' : 'bold'} textAnchor="middle" opacity={iconOpacity}>
        {displayValue}
      </text>
      <g transform={`translate(${trophyX}, ${trophyY})`} opacity={iconOpacity}>
        <TrophyIcon width={iconSize} height={iconSize} stroke={dotColor} fill={dotColor} />
      </g>
    </g>
  );
};
