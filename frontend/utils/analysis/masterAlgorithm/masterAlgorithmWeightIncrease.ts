import type { AnalysisResult } from '../../../types';
import { roundTo } from '../../format/formatters';
import { resolveSetCommentary } from '../setCommentary/setCommentaryLibrary';
import { FATIGUE_BUFFER } from './masterAlgorithmConstants';
import { calculatePercentChange } from './masterAlgorithmMath';
import { buildStructured, line } from './masterAlgorithmTooltips';
import { createAnalysisResult } from './masterAlgorithmResults';
import type { ExpectedRepsRange } from './masterAlgorithmTypes';
import type { LoadProgressionDirection } from '../../exercise/loadProgression';

export const analyzeWeightIncrease = (
  transition: string,
  weightChangePct: number,
  prevWeight: number,
  currWeight: number,
  prevReps: number,
  currReps: number,
  expected: ExpectedRepsRange,
  loadDirection: LoadProgressionDirection = 'higher'
): AnalysisResult => {
  const isLowerWeightBetter = loadDirection === 'lower';
  const expectedLabel = expected.label;
  const expectedTarget = Math.round(expected.center);

  const prevVol = prevWeight * prevReps;
  const currVol = currWeight * currReps;
  const volChangePct = calculatePercentChange(prevVol, currVol);
  const pct = roundTo(weightChangePct, 0);
  const pctAbs = Math.abs(pct);
  const seedBase = `${transition}|${weightChangePct}|${currReps}|${expectedLabel}`;
  const templateVars = {
    pct: pctAbs,
    currReps,
    expectedLabel,
    reps: currReps,
    target: expectedLabel,
    weight: pctAbs,
  };

  if (currReps > expected.max) {
    const commentary = resolveSetCommentary(
      isLowerWeightBetter ? 'supportDecrease_exceeded' : 'weightIncrease_exceeded',
      seedBase,
      templateVars,
      { whyCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const trendLabel = isLowerWeightBetter ? `${pctAbs}% less support` : `+${pctAbs}% weight`;
    const primaryReason = isLowerWeightBetter
      ? 'You beat expected output after reducing support'
      : 'You beat expected output at this heavier weight';
    const thirdReason = isLowerWeightBetter
      ? 'This suggests clear headroom for lower assistance'
      : 'This suggests headroom at this weight today';
    return createAnalysisResult(
      transition,
      'success',
      weightChangePct,
      volChangePct,
      currReps,
      expectedLabel,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(
        trendLabel,
        'up',
        [
          line(whyLines[0] ?? primaryReason, 'gray'),
          line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
          line(whyLines[1] ?? thirdReason, 'gray'),
        ]),
      loadDirection
    );
  }

  if (currReps >= (expected.center - FATIGUE_BUFFER) || (currReps >= expected.min && currReps <= expected.max)) {
    const commentary = resolveSetCommentary(
      isLowerWeightBetter ? 'supportDecrease_met' : 'weightIncrease_met',
      seedBase,
      templateVars,
      { whyCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const trendLabel = isLowerWeightBetter ? `${pctAbs}% less support` : `+${pctAbs}% weight`;
    const primaryReason = isLowerWeightBetter
      ? 'You met expected output at lower support'
      : 'You met the expected output at the higher weight';
    const thirdReason = isLowerWeightBetter
      ? 'Progression and recovery are aligned for this harder setting'
      : 'Progression and recovery are aligned for this set';
    return createAnalysisResult(
      transition,
      'success',
      weightChangePct,
      volChangePct,
      currReps,
      expectedLabel,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(
        trendLabel,
        'up',
        [
          line(whyLines[0] ?? primaryReason, 'gray'),
          line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
          line(whyLines[1] ?? thirdReason, 'gray'),
        ]),
      loadDirection
    );
  }

  if (currReps >= expectedTarget - 3) {
    const commentary = resolveSetCommentary(
      isLowerWeightBetter ? 'supportDecrease_slightlyBelow' : 'weightIncrease_slightlyBelow',
      seedBase,
      templateVars,
      { whyCount: 2, improveCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const improveLines = commentary.improveLines;
    const trendLabel = isLowerWeightBetter ? `${pctAbs}% less support` : `+${pctAbs}% weight`;
    const primaryReason = isLowerWeightBetter
      ? 'You are close, but output dipped at this lower support'
      : 'You are close, but current output is under target';
    const thirdReason = isLowerWeightBetter
      ? 'A small recovery adjustment can stabilize this harder setting'
      : 'A small rest or pacing adjustment can close this gap';
    const improveOne = isLowerWeightBetter
      ? 'Add more rest before this set or use a smaller support drop'
      : 'Add more rest before this set';
    const improveTwo = isLowerWeightBetter
      ? 'Hold support steady and recover reps before reducing again'
      : 'Keep weight steady and recover reps on the next attempt';
    return createAnalysisResult(
      transition,
      'warning',
      weightChangePct,
      volChangePct,
      currReps,
      expectedLabel,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(
        trendLabel,
        'up',
        [
          line(whyLines[0] ?? primaryReason, 'gray'),
          line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
          line(whyLines[1] ?? thirdReason, 'gray'),
        ],
        [
          line(improveLines[0] ?? improveOne, 'gray'),
          line(improveLines[1] ?? improveTwo, 'gray'),
        ]
      ),
      loadDirection
    );
  }

  const commentary = resolveSetCommentary(
    isLowerWeightBetter ? 'supportDecrease_significantlyBelow' : 'weightIncrease_significantlyBelow',
    seedBase,
    templateVars,
    { whyCount: 2, improveCount: 2 }
  );
  const whyLines = commentary.whyLines;
  const improveLines = commentary.improveLines;
  const trendLabel = isLowerWeightBetter ? `${pctAbs}% less support` : `+${pctAbs}% weight`;
  const primaryReason = isLowerWeightBetter
    ? 'Support reduction is currently ahead of your usable capacity'
    : 'Weight jump is currently above your usable capacity';
  const thirdReason = isLowerWeightBetter
    ? 'The assistance drop likely outpaced current in-session capacity'
    : 'The jump likely outpaced your current in-session capacity';
  const improveOne = isLowerWeightBetter
    ? 'Use a smaller support reduction for the next progression'
    : 'Reduce increment size for the next progression';
  const improveTwo = isLowerWeightBetter
    ? 'Rebuild quality reps at slightly higher support first'
    : 'Rebuild quality reps at a slightly lower weight first';
  return createAnalysisResult(
    transition,
    'danger',
    weightChangePct,
    volChangePct,
    currReps,
    expectedLabel,
    commentary.shortMessage,
    commentary.tooltip,
    buildStructured(
      trendLabel,
      'up',
      [
        line(whyLines[0] ?? primaryReason, 'gray'),
        line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
        line(whyLines[1] ?? thirdReason, 'gray'),
      ],
      [
        line(improveLines[0] ?? improveOne, 'gray'),
        line(improveLines[1] ?? improveTwo, 'gray'),
      ]
    ),
    loadDirection
  );
};
