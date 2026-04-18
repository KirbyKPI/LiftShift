import type { AnalysisResult, TooltipLine } from '../../../types';
import { roundTo } from '../../format/formatters';
import { resolveSetCommentary } from '../setCommentary/setCommentaryLibrary';
import { DROP_THRESHOLD_MILD, DROP_THRESHOLD_MODERATE } from './masterAlgorithmConstants';
import { buildStructured, line } from './masterAlgorithmTooltips';
import { createAnalysisResult } from './masterAlgorithmResults';
import type { LoadProgressionDirection } from '../../exercise/loadProgression';

export const analyzeSameWeight = (
  transition: string,
  repDropPct: number,
  prevReps: number,
  currReps: number,
  setNumber: number,
  loadDirection: LoadProgressionDirection = 'higher'
): AnalysisResult => {
  const repDiff = currReps - prevReps;
  const isAfterFirstWorkingSet = setNumber === 2;
  const seedBase = `${transition}|${prevReps}|${currReps}`;

  if (repDiff > 0) {
    const commentary = resolveSetCommentary('sameWeight_repsIncreased', seedBase, { diff: repDiff }, { whyCount: 2 });
    const whyLines = commentary.whyLines;
    return createAnalysisResult(
      transition,
      'success',
      0,
      repDropPct,
      currReps,
      `${prevReps}`,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(`+${repDiff} reps`, 'up', [
        line(whyLines[0] ?? `Reps increased by ${repDiff} at the same load`, 'gray'),
        line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'),
        line(whyLines[1] ?? 'Set pacing and rest likely improved on this transition', 'gray'),
      ]),
      loadDirection
    );
  }

  if (repDiff === 0) {
    const commentary = resolveSetCommentary('sameWeight_repsSame', seedBase, { reps: currReps }, { whyCount: 2 });
    const whyLines = commentary.whyLines;
    return createAnalysisResult(
      transition,
      'success',
      0,
      0,
      currReps,
      `${prevReps}`,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured('= reps', 'same', [
        line(whyLines[0] ?? `Reps held steady at ${currReps}`, 'gray'),
        line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'),
        line(whyLines[1] ?? 'Pacing and rest are consistent between these sets', 'gray'),
      ]),
      loadDirection
    );
  }

  const dropAbs = Math.abs(repDiff);
  const dropPctAbs = Math.abs(repDropPct);

  if (dropPctAbs <= DROP_THRESHOLD_MILD) {
    const commentary = resolveSetCommentary(
      'sameWeight_dropMild',
      seedBase,
      { dropAbs, dropPct: roundTo(dropPctAbs, 0) },
      { whyCount: 2 }
    );
    const whyLines = commentary.whyLines;
    return createAnalysisResult(
      transition,
      'info',
      0,
      repDropPct,
      currReps,
      `${prevReps}`,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(`-${dropAbs} reps`, 'down', [
        line(whyLines[0] ?? `Reps dropped by ${dropAbs}, which is within normal fatigue`, 'gray'),
        line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'),
        line(whyLines[1] ?? 'This pattern is common as fatigue accumulates across sets', 'gray'),
      ]),
      loadDirection
    );
  }

  if (dropPctAbs <= DROP_THRESHOLD_MODERATE) {
    const commentary = resolveSetCommentary(
      'sameWeight_dropModerate',
      seedBase,
      { dropAbs, dropPct: roundTo(dropPctAbs, 0) },
      { whyCount: isAfterFirstWorkingSet ? 1 : 2, improveCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const improveLines = commentary.improveLines;

    const why: TooltipLine[] = isAfterFirstWorkingSet
      ? [line(whyLines[0], 'gray'), line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray')]
      : [line(whyLines[0], 'gray'), line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'), line(whyLines[1], 'gray')];

    return createAnalysisResult(
      transition,
      'warning',
      0,
      repDropPct,
      currReps,
      `${prevReps}`,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(
        `-${dropAbs} reps`,
        'down',
        why,
        [
          line(improveLines[0] ?? 'Extend rest slightly before the next hard set', 'gray'),
          line(improveLines[1] ?? 'Aim to keep rep loss tighter on the next set', 'gray'),
        ]
      ),
      loadDirection
    );
  }

  const commentary = resolveSetCommentary(
    'sameWeight_dropSevere',
    seedBase,
    { dropAbs, dropPct: roundTo(dropPctAbs, 0) },
    { whyCount: 2, improveCount: 2 }
  );
  const whyLines = commentary.whyLines;
  const improveLines = commentary.improveLines;

  const why: TooltipLine[] = isAfterFirstWorkingSet
    ? [line(whyLines[0], 'gray'), line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'), line(whyLines[1], 'gray')]
    : [line(whyLines[0], 'gray'), line(`Expected: ${prevReps} reps, actual: ${currReps} reps`, 'gray'), line(whyLines[1], 'gray')];

  return createAnalysisResult(
    transition,
    'danger',
    0,
    repDropPct,
    currReps,
    `${prevReps}`,
    commentary.shortMessage,
    commentary.tooltip,
    buildStructured(
      `-${dropAbs} reps`,
      'down',
      why,
      [
        line(improveLines[0] ?? 'Reduce load or increase rest to restore output', 'gray'),
        line(improveLines[1] ?? 'Prioritize rep quality over grinding through breakdown', 'gray'),
      ]
    ),
    loadDirection
  );
};
