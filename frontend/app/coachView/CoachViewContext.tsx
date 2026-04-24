/**
 * CoachViewContext
 * ────────────────────────────────────────────────────────────────────────────
 * When a coach is reviewing a single client's dashboard, we seed the full
 * LiftShift `<App>` with the client's pre-fetched sets instead of letting it
 * run its normal startup data-load pipeline.
 *
 * Two responsibilities:
 *   1. Expose the seed data to App.tsx so it can skip onboarding/auto-load.
 *   2. Flip `setCoachViewActive` on/off so localStorage writes are routed to
 *      an in-memory scratch space — coach interactions (filter tweaks, prefs,
 *      body-map gender, etc.) never persist to the coach's own account or the
 *      client's record.
 *
 * Usage:
 *   <CoachViewProvider clientId={id} clientName={name} seedSets={sets}>
 *     <HashRouter>
 *       <App />
 *     </HashRouter>
 *   </CoachViewProvider>
 */

import React, { createContext, useContext, useEffect, useMemo } from 'react';
import type { WorkoutSet } from '../../types';
import { setCoachViewActive, resetCoachViewStorage } from '../../utils/storage/createStorageManager';
import { saveSetupComplete } from '../../utils/storage/dataSourceStorage';
import { saveDataSourceChoice } from '../../utils/storage/dataSourceStorage';

export interface CoachViewContextValue {
  isCoachView: true;
  clientId: string;
  clientName: string;
  seedSets: WorkoutSet[];
  /** Non-null when sync returned cached/stale data; pass through for banner. */
  syncSource?: 'live' | 'cached' | 'stale_cache' | null;
  lastSyncAt?: string | null;
}

const CoachViewContext = createContext<CoachViewContextValue | null>(null);

export const useCoachView = (): CoachViewContextValue | null =>
  useContext(CoachViewContext);

interface CoachViewProviderProps {
  clientId: string;
  clientName: string;
  seedSets: WorkoutSet[];
  syncSource?: 'live' | 'cached' | 'stale_cache' | null;
  lastSyncAt?: string | null;
  children: React.ReactNode;
}

export function CoachViewProvider({
  clientId,
  clientName,
  seedSets,
  syncSource,
  lastSyncAt,
  children,
}: CoachViewProviderProps) {
  // Flip the global storage shim BEFORE any child renders so the very first
  // pass of `useAppPreferences`/`getSetupComplete`/etc. reads from the
  // isolated store. Done with a useMemo so it runs synchronously on first
  // render (effects fire too late).
  useMemo(() => {
    resetCoachViewStorage();
    setCoachViewActive(true);
    // Pre-seed the scratch storage so App.tsx skips onboarding + data-source picker.
    saveSetupComplete(true);
    // seedSets all come from Hevy today; mark data source so the app doesn't
    // try to prompt the coach to pick a source.
    saveDataSourceChoice('hevy');
    return null;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId]);

  // On unmount (coach navigates back to dashboard), flip the shim off and
  // wipe the scratch map.
  useEffect(() => {
    return () => {
      setCoachViewActive(false);
    };
  }, []);

  const value = useMemo<CoachViewContextValue>(
    () => ({
      isCoachView: true,
      clientId,
      clientName,
      seedSets,
      syncSource: syncSource ?? null,
      lastSyncAt: lastSyncAt ?? null,
    }),
    [clientId, clientName, seedSets, syncSource, lastSyncAt],
  );

  return <CoachViewContext.Provider value={value}>{children}</CoachViewContext.Provider>;
}
