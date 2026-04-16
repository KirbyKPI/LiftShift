import type { ExerciseAsset } from '../data/exerciseAssets';
import {
  createFingerprintMatcher,
  type MatchResult,
} from './exerciseFingerprint';
import { stripExerciseSourceLabel } from './exerciseSourceLabel';

export interface ExerciseAssetLookup {
  resolveName: (rawName: string) => MatchResult;
  getAsset: (rawName: string) => ExerciseAsset | undefined;
}

// Cache for fingerprint matcher
let matcherCache: ReturnType<typeof createFingerprintMatcher> | null = null;
let matcherRef: Map<string, ExerciseAsset> | null = null;

// Cache for lowercase lookups
let lowerCache: Map<string, ExerciseAsset> | null = null;
let lowerRef: Map<string, ExerciseAsset> | null = null;

const getLowerMap = (assetsMap: Map<string, ExerciseAsset>): Map<string, ExerciseAsset> => {
  if (lowerRef === assetsMap && lowerCache) return lowerCache;
  const m = new Map<string, ExerciseAsset>();
  assetsMap.forEach((v, k) => m.set(k.toLowerCase(), v));
  lowerCache = m;
  lowerRef = assetsMap;
  return m;
};

const getMatcher = (assetsMap: Map<string, ExerciseAsset>) => {
  if (matcherRef === assetsMap && matcherCache) return matcherCache;
  matcherCache = createFingerprintMatcher(Array.from(assetsMap.keys()));
  matcherRef = assetsMap;
  return matcherCache;
};

export const createExerciseAssetLookup = (assetsMap: Map<string, ExerciseAsset>): ExerciseAssetLookup => {
  const lower = getLowerMap(assetsMap);
  const matcher = getMatcher(assetsMap);

  const resolveName = (rawName: string): MatchResult => matcher.match(stripExerciseSourceLabel(rawName));

  const getAsset = (rawName: string): ExerciseAsset | undefined => {
    const normalizedName = stripExerciseSourceLabel(rawName);
    // Fast path: exact match
    if (assetsMap.has(normalizedName)) {
      return assetsMap.get(normalizedName);
    }
    
    // Fast path: case-insensitive match
    const lowerAsset = lower.get(normalizedName.toLowerCase());
    if (lowerAsset) {
      return lowerAsset;
    }
    
    // Use fingerprint matcher for fuzzy matching
    const resolved = matcher.match(normalizedName);
    if (resolved.method !== 'none' && resolved.name) {
      return assetsMap.get(resolved.name) ?? lower.get(resolved.name.toLowerCase());
    }
    
    return undefined;
  };

  return { resolveName, getAsset };
};
