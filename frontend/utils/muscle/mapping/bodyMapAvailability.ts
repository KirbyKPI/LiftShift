import type { BodyMapGender, BodyMapVariant } from '../../../components/bodyMap/BodyMap';

export interface MuscleFallbackMap {
  [muscleId: string]: string;
}

export const BODYMAP_MUSCLE_FALLBACKS: MuscleFallbackMap = {
  adductors: 'glutes',
  abductors: 'glutes',
  neck: 'traps',
};

export const BODYMAP_MUSCLE_AVAILABILITY: Record<BodyMapVariant, Record<BodyMapGender, string[]>> = {
  demo: {
    male: [
      'traps', 'neck', 'shoulders', 'chest', 'biceps', 'forearms',
      'abdominals', 'obliques', 'adductors', 'abductors', 'quads', 'calves',
      'lats', 'triceps', 'lowerback', 'glutes', 'hamstrings',
    ],
    female: [
      'traps', 'neck', 'shoulders', 'chest', 'biceps', 'forearms',
      'abdominals', 'obliques', 'adductors', 'abductors', 'quads', 'calves',
      'lats', 'triceps', 'lowerback', 'glutes', 'hamstrings',
    ],
  },
  original: {
    male: [
      'traps', 'shoulders', 'chest', 'biceps', 'forearms',
      'abdominals', 'obliques', 'quads', 'calves',
      'lats', 'triceps', 'lowerback', 'glutes', 'hamstrings',
    ],
    female: [
      'traps', 'shoulders', 'chest', 'biceps', 'forearms',
      'abdominals', 'obliques', 'quads', 'calves',
    ],
  },
};

export function getAvailableMuscles(variant: BodyMapVariant, gender: BodyMapGender): string[] {
  return BODYMAP_MUSCLE_AVAILABILITY[variant]?.[gender] ?? [];
}

export function getMuscleWithFallback(
  muscleId: string,
  variant: BodyMapVariant,
  gender: BodyMapGender
): string {
  const available = getAvailableMuscles(variant, gender);
  
  if (available.includes(muscleId)) {
    return muscleId;
  }
  
  const fallback = BODYMAP_MUSCLE_FALLBACKS[muscleId];
  if (fallback && available.includes(fallback)) {
    return fallback;
  }
  
  return muscleId;
}
