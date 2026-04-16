import React from 'react';
import { BodyMap, BodyMapGender } from '../../bodyMap/BodyMap';
import { HEADLESS_MUSCLE_NAMES, MUSCLE_IDS } from '../../../utils/muscle/mapping';
import type { TooltipState } from './HistoryTooltipPortal';

interface HistorySessionBodyMapProps {
  headlessVolumes: Map<string, number>;
  headlessMaxVolume: number;
  bodyMapGender: BodyMapGender;
  setTooltip: (state: TooltipState | null) => void;
}

const formatSets = (value: number): string => {
  const rounded = Math.round(value * 100) / 100;
  if (Number.isInteger(rounded)) return String(rounded);
  return rounded.toFixed(2).replace(/\.00$/, '').replace(/(\.\d)0$/, '$1');
};

export const getMuscleSetsListData = (headlessVolumes: Map<string, number>) => {
  const muscleList: { id: string; name: string; sets: number }[] = [];
  MUSCLE_IDS.forEach((muscleId) => {
    const sets = headlessVolumes.get(muscleId) || 0;
    if (sets > 0) {
      muscleList.push({
        id: muscleId,
        name: HEADLESS_MUSCLE_NAMES[muscleId as keyof typeof HEADLESS_MUSCLE_NAMES] || muscleId,
        sets,
      });
    }
  });
  return muscleList.sort((a, b) => b.sets - a.sets);
};

export const MuscleSetsList: React.FC<{ headlessVolumes: Map<string, number> }> = ({ headlessVolumes }) => {
  const sortedMuscles = React.useMemo(() => getMuscleSetsListData(headlessVolumes), [headlessVolumes]);

  if (sortedMuscles.length === 0) return null;

  return (
    <div className="flex flex-wrap gap-x-2 mt-15 gap-y-0.5 text-[12px] sm:text-sm">
      {sortedMuscles.map((muscle) => (
        <span key={muscle.id} className="text-slate-600 dark:text-slate-400">
          <span className="capitalize">{muscle.name}</span>
          <span className="text-slate-500 dark:text-slate-500">: </span>
          <span>{formatSets(muscle.sets)}</span>
          <span className="text-slate-500 dark:text-slate-500"> {Math.abs(muscle.sets - 1) < 0.000001 ? 'set' : 'sets'}</span>
        </span>
      ))}
    </div>
  );
};

export const HistorySessionBodyMap: React.FC<HistorySessionBodyMapProps> = ({
  headlessVolumes,
  headlessMaxVolume,
  bodyMapGender,
  setTooltip,
}) => (
  <BodyMap
    onPartClick={() => { }}
    selectedPart={null}
    muscleVolumes={headlessVolumes}
    maxVolume={headlessMaxVolume}
    compact
    compactFill
    interactive
    gender={bodyMapGender}
    viewMode="headless"
    stroke={{ width: 3, color: '#484a68', opacity: 0.8 }}
    onPartHover={(muscleId, ev) => {
      if (!muscleId || !ev) {
        setTooltip(null);
        return;
      }
      const hoveredEl = (ev.target as Element | null)?.closest('g[id]');
      const rect = hoveredEl?.getBoundingClientRect();
      if (!rect) return;
      const label = (HEADLESS_MUSCLE_NAMES as any)[muscleId] || muscleId;
      const sets = headlessVolumes.get(muscleId) || 0;
      const setsText = formatSets(sets);
      setTooltip({ rect, title: label, body: `${setsText} sets`, status: 'info' });
    }}
  />
);
