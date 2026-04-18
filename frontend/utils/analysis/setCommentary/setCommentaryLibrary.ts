import { pickDeterministic, pickDeterministicIndex } from '../common/messageVariations';
import {
  SAME_WEIGHT_REPS_INCREASED,
  SAME_WEIGHT_REPS_SAME,
  SAME_WEIGHT_DROP_MILD,
  SAME_WEIGHT_DROP_MODERATE,
  SAME_WEIGHT_DROP_SEVERE,
} from './setCommentarySameWeight';
import {
  WEIGHT_INCREASE_EXCEEDED,
  WEIGHT_INCREASE_MET,
  WEIGHT_INCREASE_SLIGHTLY_BELOW,
  WEIGHT_INCREASE_SIGNIFICANTLY_BELOW,
} from './setCommentaryIncrease';
import {
  WEIGHT_DECREASE_MET,
  WEIGHT_DECREASE_SLIGHTLY_BELOW,
  WEIGHT_DECREASE_SIGNIFICANTLY_BELOW,
} from './setCommentaryDecrease';
import {
  SUPPORT_DECREASE_EXCEEDED,
  SUPPORT_DECREASE_MET,
  SUPPORT_DECREASE_SLIGHTLY_BELOW,
  SUPPORT_DECREASE_SIGNIFICANTLY_BELOW,
  SUPPORT_INCREASE_MET,
  SUPPORT_INCREASE_SLIGHTLY_BELOW,
  SUPPORT_INCREASE_SIGNIFICANTLY_BELOW,
} from './setCommentarySupport';
import {
  PROMOTE_INCREASE_WEIGHT,
  DEMOTE_TOO_HEAVY,
  DEMOTE_INCONSISTENT,
} from './setCommentaryPromoteDemote';

export interface SetCommentaryOptions {
  shortMessages: readonly string[];
  tooltips: readonly string[];
  whyLines?: readonly string[];
  improveLines?: readonly string[];
}

export type SetScenario =
  | 'sameWeight_repsIncreased'
  | 'sameWeight_repsSame'
  | 'sameWeight_dropMild'
  | 'sameWeight_dropModerate'
  | 'sameWeight_dropSevere'
  | 'weightIncrease_exceeded'
  | 'weightIncrease_met'
  | 'weightIncrease_slightlyBelow'
  | 'weightIncrease_significantlyBelow'
  | 'supportDecrease_exceeded'
  | 'supportDecrease_met'
  | 'supportDecrease_slightlyBelow'
  | 'supportDecrease_significantlyBelow'
  | 'weightDecrease_met'
  | 'weightDecrease_slightlyBelow'
  | 'weightDecrease_significantlyBelow'
  | 'supportIncrease_met'
  | 'supportIncrease_slightlyBelow'
  | 'supportIncrease_significantlyBelow';

export interface ResolvedSetCommentary {
  shortMessage: string;
  tooltip: string;
  whyLines: string[];
  improveLines: string[];
}

const scenarioOptions: Record<SetScenario, SetCommentaryOptions> = {
  sameWeight_repsIncreased: SAME_WEIGHT_REPS_INCREASED,
  sameWeight_repsSame: SAME_WEIGHT_REPS_SAME,
  sameWeight_dropMild: SAME_WEIGHT_DROP_MILD,
  sameWeight_dropModerate: SAME_WEIGHT_DROP_MODERATE,
  sameWeight_dropSevere: SAME_WEIGHT_DROP_SEVERE,
  weightIncrease_exceeded: WEIGHT_INCREASE_EXCEEDED,
  weightIncrease_met: WEIGHT_INCREASE_MET,
  weightIncrease_slightlyBelow: WEIGHT_INCREASE_SLIGHTLY_BELOW,
  weightIncrease_significantlyBelow: WEIGHT_INCREASE_SIGNIFICANTLY_BELOW,
  supportDecrease_exceeded: SUPPORT_DECREASE_EXCEEDED,
  supportDecrease_met: SUPPORT_DECREASE_MET,
  supportDecrease_slightlyBelow: SUPPORT_DECREASE_SLIGHTLY_BELOW,
  supportDecrease_significantlyBelow: SUPPORT_DECREASE_SIGNIFICANTLY_BELOW,
  weightDecrease_met: WEIGHT_DECREASE_MET,
  weightDecrease_slightlyBelow: WEIGHT_DECREASE_SLIGHTLY_BELOW,
  weightDecrease_significantlyBelow: WEIGHT_DECREASE_SIGNIFICANTLY_BELOW,
  supportIncrease_met: SUPPORT_INCREASE_MET,
  supportIncrease_slightlyBelow: SUPPORT_INCREASE_SLIGHTLY_BELOW,
  supportIncrease_significantlyBelow: SUPPORT_INCREASE_SIGNIFICANTLY_BELOW,
};

const interpolateText = (text: string, templateVars?: Record<string, string | number>): string => {
  if (!templateVars) return text;
  let result = text;
  for (const [key, value] of Object.entries(templateVars)) {
    result = result.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return result;
};

const interpolateOptions = (
  options: SetCommentaryOptions,
  templateVars?: Record<string, string | number>
): SetCommentaryOptions => ({
  shortMessages: options.shortMessages.map((m) => interpolateText(m, templateVars)),
  tooltips: options.tooltips.map((m) => interpolateText(m, templateVars)),
  whyLines: options.whyLines?.map((m) => interpolateText(m, templateVars)),
  improveLines: options.improveLines?.map((m) => interpolateText(m, templateVars)),
});

const pickLines = (seed: string, lines: readonly string[] | undefined, count: number): string[] => {
  if (!lines || lines.length === 0 || count <= 0) return [];
  if (lines.length <= count) return [...lines];

  const startIdx = pickDeterministicIndex(seed, lines.length);
  const selected: string[] = [];
  for (let i = 0; i < lines.length && selected.length < count; i++) {
    const candidate = lines[(startIdx + i) % lines.length];
    if (!selected.includes(candidate)) selected.push(candidate);
  }
  return selected;
};

export const getSetCommentary = (
  scenario: SetScenario,
  seedBase: string,
  templateVars?: Record<string, string | number>
): SetCommentaryOptions => {
  void seedBase;
  return interpolateOptions(scenarioOptions[scenario], templateVars);
};

export const resolveSetCommentary = (
  scenario: SetScenario,
  seedBase: string,
  templateVars?: Record<string, string | number>,
  options?: { whyCount?: number; improveCount?: number }
): ResolvedSetCommentary => {
  const scenarioCommentary = getSetCommentary(scenario, seedBase, templateVars);
  const whyCount = options?.whyCount ?? 2;
  const improveCount = options?.improveCount ?? 2;

  return {
    shortMessage: pickDeterministic(`${seedBase}|short`, scenarioCommentary.shortMessages),
    tooltip: pickDeterministic(`${seedBase}|tooltip`, scenarioCommentary.tooltips),
    whyLines: pickLines(`${seedBase}|why`, scenarioCommentary.whyLines, whyCount),
    improveLines: pickLines(`${seedBase}|improve`, scenarioCommentary.improveLines, improveCount),
  };
};

export const getPromoteMessage = (seedBase: string, templateVars: Record<string, string | number>): string => {
  let message = pickDeterministic(`${seedBase}|promote`, PROMOTE_INCREASE_WEIGHT);
  for (const [key, value] of Object.entries(templateVars)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return message;
};

export const getDemoteTooHeavyMessage = (seedBase: string, templateVars: Record<string, string | number>): string => {
  let message = pickDeterministic(`${seedBase}|demote_heavy`, DEMOTE_TOO_HEAVY);
  for (const [key, value] of Object.entries(templateVars)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return message;
};

export const getDemoteInconsistentMessage = (seedBase: string, templateVars: Record<string, string | number>): string => {
  let message = pickDeterministic(`${seedBase}|demote_inconsistent`, DEMOTE_INCONSISTENT);
  for (const [key, value] of Object.entries(templateVars)) {
    message = message.replace(new RegExp(`\\{${key}\\}`, 'g'), String(value));
  }
  return message;
};
