import type { AnalysisResult } from '../../../types';
import { roundTo } from '../../format/formatters';
import { resolveSetCommentary } from '../setCommentary/setCommentaryLibrary';
import { calculatePercentChange } from './masterAlgorithmMath';
import { buildStructured, line } from './masterAlgorithmTooltips';
import { createAnalysisResult } from './masterAlgorithmResults';
import type { ExpectedRepsRange } from './masterAlgorithmTypes';
import type { LoadProgressionDirection } from '../../exercise/loadProgression';

export const analyzeWeightDecrease = (
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

  if (currReps >= expected.min) {
    const commentary = resolveSetCommentary(
      isLowerWeightBetter ? 'supportIncrease_met' : 'weightDecrease_met',
      seedBase,
      templateVars,
      { whyCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const trendLabel = isLowerWeightBetter ? `+${pctAbs}% support` : `${pctAbs}% weight`;
    const primaryReason = isLowerWeightBetter
      ? 'Support increase restored expected output'
      : 'Weight reduction restored expected output';
    const thirdReason = isLowerWeightBetter
      ? 'Adjustment size matched current fatigue and support needs'
      : 'Adjustment size matched current set fatigue';
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
        'down',
        [
          line(whyLines[0] ?? primaryReason, 'gray'),
          line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
          line(whyLines[1] ?? thirdReason, 'gray')
        ]),
      loadDirection
    );
  }

  if (currReps >= expectedTarget - 3) {
    const commentary = resolveSetCommentary(
      isLowerWeightBetter ? 'supportIncrease_slightlyBelow' : 'weightDecrease_slightlyBelow',
      seedBase,
      templateVars,
      { whyCount: 2 }
    );
    const whyLines = commentary.whyLines;
    const trendLabel = isLowerWeightBetter ? `+${pctAbs}% support` : `${pctAbs}% weight`;
    const primaryReason = isLowerWeightBetter
      ? 'You recovered some output, but still need a bit more support'
      : 'You recovered some output, but are still below target';
    const thirdReason = isLowerWeightBetter
      ? 'Current fatigue still needs a slightly bigger support reset'
      : 'Current fatigue still needs a slightly deeper reset';
    return createAnalysisResult(
      transition,
      'info',
      weightChangePct,
      volChangePct,
      currReps,
      expectedLabel,
      commentary.shortMessage,
      commentary.tooltip,
      buildStructured(
        trendLabel,
        'down',
        [
          line(whyLines[0] ?? primaryReason, 'gray'),
          line(`Expected: ${expectedLabel} reps, actual: ${currReps} reps`, 'gray'),
          line(whyLines[1] ?? thirdReason, 'gray'),
        ]
      ),
      loadDirection
    );
  }

  const commentary = resolveSetCommentary(
    isLowerWeightBetter ? 'supportIncrease_significantlyBelow' : 'weightDecrease_significantlyBelow',
    seedBase,
    templateVars,
    { whyCount: 2, improveCount: 2 }
  );
  const whyLines = commentary.whyLines;
  const improveLines = commentary.improveLines;
  const trendLabel = isLowerWeightBetter ? `+${pctAbs}% support` : `${pctAbs}% weight`;
  const primaryReason = isLowerWeightBetter
    ? 'Even after adding support, output is still far below target'
    : 'Even after reducing weight, output is still far below target';
  const thirdReason = isLowerWeightBetter
    ? 'This set likely reflects high in-session fatigue and support demand'
    : 'This set likely reflects high in-session fatigue right now';
  const improveOne = isLowerWeightBetter
    ? 'Increase support further for the next attempt'
    : 'Reduce weight further for the next attempt';
  const improveTwo = isLowerWeightBetter
    ? 'Restore rep quality first, then reduce support gradually'
    : 'Restore rep quality first, then build weight back gradually';
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
      'down',
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
