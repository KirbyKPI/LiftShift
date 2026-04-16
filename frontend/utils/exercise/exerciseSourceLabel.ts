const SOURCE_LABEL_RE = /\s+@(hevy|lyfta|strong|other|merged)$/i;

export const stripExerciseSourceLabel = (name: string): string => {
  return String(name ?? '').replace(SOURCE_LABEL_RE, '').trim();
};
