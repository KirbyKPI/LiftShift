import { analyzeExerciseTrendCore } from '../../../utils/analysis/exerciseTrend';
import { pickDeterministic } from '../../../utils/analysis/common';
import { convertWeight, getStandardWeightIncrementKg } from '../../../utils/format/units';
import type { WeightUnit } from '../../../utils/storage/localStorage';
import type { TrendCopy } from './exerciseTrendUiCopyNew';

export const getStagnantCopy = (
  seedBase: string,
  core: ReturnType<typeof analyzeExerciseTrendCore>,
  weightUnit: WeightUnit,
  sessionsAtPlateau: number
): TrendCopy => {
  const hasStaticPlateau = Boolean(core.plateau);
  const isLowerWeightBetter = core.loadProgressionDirection === 'lower';

  const title = pickDeterministic(
    `${seedBase}|title`,
    hasStaticPlateau
      ? [
          'Stuck in neutral',
          'Holding steady',
          'Plateau city',
          'Flatlined',
          'Time for a shakeup',
          'Comfort zone detected',
          'Same song, same verse',
          'Cruise control',
          'Pattern locked',
          'Stability era',
        ]
      : [
          'Plateauing',
          'Holding steady',
          'No lift-off yet',
          'Trend is flat',
          'Time for a nudge',
          'Stability phase',
          'Same output lately',
          'Progress paused',
          'Momentum stalled',
          'Not moving much',
        ]
  );

  const description = (() => {
    if (!hasStaticPlateau) {
      return pickDeterministic(`${seedBase}|desc`, [
        isLowerWeightBetter
          ? "Support load hasn't improved lately. Time for a small, deliberate nudge toward less assistance."
          : "Your recent sessions aren't improving yet. This is a normal phase, time for a small, deliberate push.",
        isLowerWeightBetter
          ? 'The trend is flat on assisted loading. Keep form strict and reduce support in tiny steps.'
          : 'The trend is basically flat lately. Keep technique consistent and add one small progression lever.',
        isLowerWeightBetter
          ? 'No clear loading progress. Recover well, then try one smaller-assistance step.'
          : 'No clear progress (or just a tiny dip). Treat this as feedback: recover well and progress slowly.',
        isLowerWeightBetter
          ? "You're repeating similar support levels. Choose a micro-goal and make one step harder next session."
          : "You're repeating similar performance. That's fine, now choose a micro-goal and beat it next session.",
        isLowerWeightBetter
          ? `Assistance has been steady for ${sessionsAtPlateau}+ sessions. A small nudge usually breaks it.`
          : `Output has been steady for ${sessionsAtPlateau}+ sessions. A small nudge (reps, load, rest) usually breaks it.`,
      ] as const);
    }

    const minReps = core.plateau?.minReps ?? 0;
    const maxReps = core.plateau?.maxReps ?? 0;
    const w = core.plateau?.weight ?? 0;
    const plateauWeight = convertWeight(w, weightUnit);
    return pickDeterministic(`${seedBase}|desc`, [
      `You've been hovering between ${minReps}-${maxReps} reps for ${sessionsAtPlateau}+ sessions. Time to shake things up!`,
      `Stuck at ${minReps}-${maxReps} reps for ${sessionsAtPlateau}+ sessions. Your muscles need a new challenge.`,
      isLowerWeightBetter
        ? `Assistance is static at ${plateauWeight}${weightUnit} while reps vary. Let's break this pattern!`
        : `Load is static at ${plateauWeight}${weightUnit} while reps vary. Let's break this pattern!`,
      `Both load (${plateauWeight}${weightUnit}) and reps (${minReps}-${maxReps}) are consistent. Your comfort zone is showing.`,
      `Same old: ${minReps}-${maxReps} reps. Progress is taking a coffee break.`,
      isLowerWeightBetter
        ? `Support level is stable at ${plateauWeight}${weightUnit}. Time to introduce a harder stimulus!`
        : `Strength is stable at ${plateauWeight}${weightUnit}. Time to introduce a new stimulus!`,
      `Consistent pattern: ${plateauWeight}${weightUnit} × ${minReps}-${maxReps}. Great control, now chase growth.`,
      'This looks like a true plateau: consistent output, limited change. Perfect moment for a small, strategic push.',
    ] as const);
  })();

  const subtext = (() => {
    if (!hasStaticPlateau) {
      return pickDeterministic(
        `${seedBase}|sub`,
        core.isBodyweightLike
          ? [
              'Pick one lever: +1 rep total, +1 set, or slightly shorter rest. Keep the movement the same.',
              'Set a micro-goal: beat last time by +1 rep somewhere, then repeat until it sticks.',
              'Keep form identical and chase a tiny rep increase. Consistency turns into progress fast.',
              'If recovery is poor, take one easy session. If recovery is good, push one set a bit harder.',
            ]
          : [
              isLowerWeightBetter
                ? "Pick one lever: +1 rep somewhere, or a small assistance reduction next session. Don't change everything at once."
                : "Pick one lever: +1 rep somewhere, or a small load bump next session. Don't change everything at once.",
              isLowerWeightBetter
                ? 'Lock technique and chase a micro-win: +1 rep total or slightly less assistance when reps are stable.'
                : 'Lock your technique and chase a micro-win: +1 rep total or a small load increase when reps are stable.',
              isLowerWeightBetter
                ? 'If this feels easy, reduce assistance. If it feels grindy, recover and repeat this support level cleanly.'
                : 'If this feels easy, progress. If it feels grindy, recover and repeat the same load cleanly once more.',
              isLowerWeightBetter
                ? 'Small changes work: slightly more reps, slightly less assistance, or slightly more rest, choose one.'
                : 'Small changes work: slightly more reps, slightly more load, or slightly more rest, choose one.',
            ]
      );
    }

    const minReps = core.plateau?.minReps ?? 0;
    const maxReps = core.plateau?.maxReps ?? 0;
    const w = core.plateau?.weight ?? 0;
    const plateauWeight = convertWeight(w, weightUnit);
    const suggestedNext = isLowerWeightBetter
      ? convertWeight(Math.max(0, w - getStandardWeightIncrementKg(weightUnit)), weightUnit)
      : convertWeight(w + getStandardWeightIncrementKg(weightUnit), weightUnit);

    return pickDeterministic(`${seedBase}|sub`, [
      `Pick ${maxReps} reps and chase ${maxReps + 1} on ALL sets. No playing favorites with the first set only.`,
      'Next session: add 1 rep to your first set, then make the others match. Quality over speed.',
      isLowerWeightBetter
        ? `Standardize at ${maxReps} reps. Master it, then reduce assistance to ~${suggestedNext}${weightUnit}.`
        : `Standardize at ${maxReps} reps. Master it across all sets, then level up to ${suggestedNext}${weightUnit}.`,
      isLowerWeightBetter
        ? `Try ~${suggestedNext}${weightUnit} support next session. If form gets ugly, repeat ${plateauWeight}${weightUnit} and add a rep.`
        : `Try ${suggestedNext}${weightUnit} next session. If form gets ugly, repeat ${plateauWeight}${weightUnit} and add a rep.`,
      'Get fancy: pause reps, slow eccentrics (3-4 seconds), or slightly shorter rests.',
      isLowerWeightBetter
        ? `Double progression: repeat ${plateauWeight}${weightUnit} support, add 1-2 reps, then reduce assistance.`
        : `Double progression: repeat ${plateauWeight}${weightUnit} and add 1-2 reps across sets, then increase the weight.`,
      isLowerWeightBetter
        ? `Stay at ${plateauWeight}${weightUnit} support and earn a bigger rep buffer. Then move to ~${suggestedNext}${weightUnit}.`
        : `Stay at ${plateauWeight}${weightUnit} and earn a bigger rep buffer. Then jump to ${suggestedNext}${weightUnit} with confidence.`,
      'Add one variable: +1 rep, +1 set, or +5-10% rest reduction. Tiny change, big signal.',
    ] as const);
  })();

  return { title, description, subtext };
};
