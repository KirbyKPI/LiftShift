import type { SetCommentaryOptions } from './setCommentaryLibrary';

export const SUPPORT_DECREASE_EXCEEDED: SetCommentaryOptions = {
  shortMessages: [
    'Exceeded on Less Assist',
    'Support Can Drop Again',
    'Handled Harder Setting',
    'Outperformed on Lower Support',
    'Ahead of Plan',
    'Crushed the Harder Step',
  ] as const,
  tooltips: [
    '{currReps} reps with {pct}% less support',
    'Exceeded target after reducing support',
    'You outperformed expected reps at this support',
    'Strong output with less assistance',
    '{currReps} reps (target {expectedLabel}) with less support',
  ] as const,
  whyLines: [
    'You handled the harder support level cleanly',
    'Assistance can likely come down again soon',
    'Output stayed high after reducing support',
    'Current support looks easier than your capacity',
  ] as const,
  improveLines: [
    'Reduce support one more step next session',
    'Keep reps clean and trim assistance again',
    'Use this as your baseline for harder settings',
  ] as const,
};

export const SUPPORT_DECREASE_MET: SetCommentaryOptions = {
  shortMessages: [
    'Target Met on Less Assist',
    'Right Support Reduction',
    'On Plan',
    'Solid Harder Step',
    'Good Progression',
    'Support Drop Worked',
  ] as const,
  tooltips: [
    '{currReps} reps with {pct}% less support',
    'You hit target at the harder support level',
    'Support reduction matched your current capacity',
    'On-target output after lowering assistance',
    '{currReps} reps (target {expectedLabel}) with less support',
  ] as const,
  whyLines: [
    'Support reduction and reps are well matched',
    'You held output at a harder setting',
    'Progression pace looks appropriate here',
    'Recovery supported this harder step',
  ] as const,
  improveLines: [
    'Hold this support until reps feel consistent',
    'Aim for one extra rep before the next reduction',
    'Keep form quality high at this setting',
  ] as const,
};

export const SUPPORT_DECREASE_SLIGHTLY_BELOW: SetCommentaryOptions = {
  shortMessages: [
    'Close on Harder Support',
    'Almost There',
    'Slightly Under Target',
    'Near Goal',
    'Just Short',
    'Needs a Bit More',
  ] as const,
  tooltips: [
    '{currReps} reps (target {expectedLabel}) with less support',
    'Close, but slightly below target after reducing support',
    'Almost matched expected output at this harder setting',
    'Small gap after lowering assistance',
  ] as const,
  whyLines: [
    'You are close to owning this support level',
    'A little more recovery may close the gap',
    'Harder support is nearly sustainable already',
    'Output dipped slightly at the new setting',
  ] as const,
  improveLines: [
    'Keep this support and try to recover one more rep',
    'Take a bit more rest before this set',
    'Stay here until target reps are repeatable',
  ] as const,
};

export const SUPPORT_DECREASE_SIGNIFICANTLY_BELOW: SetCommentaryOptions = {
  shortMessages: [
    'Support Dropped Too Fast',
    'Too Aggressive',
    'Not Ready for This Step',
    'Big Miss on Harder Setting',
    'Needs a Step Back',
    'Overreached',
  ] as const,
  tooltips: [
    '{currReps} reps (target {expectedLabel}) with less support',
    'Support reduction was too aggressive for now',
    'Large rep gap after lowering assistance',
    'This harder setting is ahead of current capacity',
  ] as const,
  whyLines: [
    'Support came down faster than output can sustain',
    'Current capacity is below this harder setting',
    'Fatigue likely amplified the drop in reps',
    'You need a smaller support step for now',
  ] as const,
  improveLines: [
    'Use a smaller support reduction next time',
    'Rebuild quality reps before lowering support again',
    'Keep assistance slightly higher until stable',
  ] as const,
};

export const SUPPORT_INCREASE_MET: SetCommentaryOptions = {
  shortMessages: [
    'Good Support Reset',
    'Right Adjustment',
    'Recovered Well',
    'Back on Track',
    'Smart Assistance Increase',
    'Output Restored',
  ] as const,
  tooltips: [
    '{currReps} reps after adding {pct}% support',
    'Support increase restored expected output',
    'You recovered reps with a smarter support level',
    'Good reset for this session',
    '{currReps} reps (target {expectedLabel}) after adding support',
  ] as const,
  whyLines: [
    'Extra support matched current fatigue level',
    'Output recovered with this adjustment',
    'You made a good in-session reset',
    'This support level is more sustainable today',
  ] as const,
  improveLines: [
    'Use this setting to rebuild consistency',
    'Reduce support again only after reps stabilize',
    'Keep quality reps as the main target',
  ] as const,
};

export const SUPPORT_INCREASE_SLIGHTLY_BELOW: SetCommentaryOptions = {
  shortMessages: [
    'Partial Reset',
    'Still Slightly Under',
    'Needs a Bit More Support',
    'Close Recovery',
    'Almost Stabilized',
    'Not Fully Recovered',
  ] as const,
  tooltips: [
    '{currReps} reps after adding support (target {expectedLabel})',
    'Support increase helped, but target is still not met',
    'Recovery is partial at this support level',
    'Output is improving but still below plan',
  ] as const,
  whyLines: [
    'Fatigue is still limiting full recovery',
    'Support increase was helpful but modest',
    'You may need slightly more assistance this set',
    'Output is trending back but not all the way yet',
  ] as const,
  improveLines: [
    'Add a small amount of support or more rest',
    'Keep this setting and try to recover one more rep',
    'Prioritize clean reps before reducing support again',
  ] as const,
};

export const SUPPORT_INCREASE_SIGNIFICANTLY_BELOW: SetCommentaryOptions = {
  shortMessages: [
    'Deep Fatigue',
    'Needs More Support',
    'Reset Not Enough',
    'Still Too Demanding',
    'Big Recovery Gap',
    'Too Much Today',
  ] as const,
  tooltips: [
    '{currReps} reps after adding support (target {expectedLabel})',
    'Even with more support, output is still far below target',
    'Current fatigue requires a deeper reset',
    'Support increase was not enough to restore quality reps',
  ] as const,
  whyLines: [
    'Session fatigue is still very high',
    'Output has not recovered to a productive range yet',
    'You likely need more support and longer rest',
    'Current demand remains above today\'s capacity',
  ] as const,
  improveLines: [
    'Increase support further for the next attempt',
    'Take longer rest before repeating a hard set',
    'Rebuild rep quality first, then reduce support gradually',
  ] as const,
};
