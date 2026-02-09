import { WorkoutSet } from '../../types';
import {
  hevyBackendGetAccount,
  hevyBackendGetSets,
  hevyBackendGetSetsWithProApiKey,
  hevyBackendLogin,
} from '../../utils/api/hevyBackend';
import { identifyPersonalRecords } from '../../utils/analysis/core';
import {
  clearHevyAuthToken,
  clearHevyProApiKey,
  saveHevyAuthToken,
  saveLastLoginMethod,
  saveSetupComplete,
} from '../../utils/storage/dataSourceStorage';
import {
  clearHevyCredentials,
  getHevyPassword,
  saveHevyPassword,
  saveHevyUsernameOrEmail,
} from '../../utils/storage/hevyCredentialsStorage';
import { hydrateBackendWorkoutSets } from '../auth/hydrateBackendWorkoutSets';
import { getHevyErrorMessage } from '../ui/appErrorMessages';
import { trackEvent } from '../../utils/integrations/analytics';
import type { StartupAutoLoadParams } from './startupAutoLoadTypes';


interface TokenTrackConfig {
  successMethod: string;
  errorMethod: string;
}

export const loadHevyFromProKey = (deps: StartupAutoLoadParams, apiKey: string): void => {
  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  hevyBackendGetSetsWithProApiKey<WorkoutSet>(apiKey)
    .then((resp) => {
      const sets = resp.sets ?? [];

      // Instant processing
      const hydrated = hydrateBackendWorkoutSets(sets);
      if (hydrated.length === 0 || hydrated.every((s) => !s.parsedDate)) {
        clearHevyProApiKey();
        saveSetupComplete(false);
        deps.setHevyLoginError('Hevy data could not be parsed. Please try syncing again.');
        deps.setOnboarding({ intent: 'initial', step: 'platform' });
        return;
      }

      const enriched = identifyPersonalRecords(hydrated);
      deps.setParsedData(enriched);
      deps.setHevyLoginError(null);
      deps.setCsvImportError(null);
    })
    .catch((err) => {
      clearHevyProApiKey();
      saveSetupComplete(false);
      deps.setHevyLoginError(getHevyErrorMessage(err));
      deps.setOnboarding({ intent: 'initial', step: 'platform' });
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};

export const loadHevyFromToken = (
  deps: StartupAutoLoadParams,
  token: string,
  trackConfig?: TokenTrackConfig
): void => {
  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  hevyBackendGetAccount(token)
    .then(({ username }) => {
      return hevyBackendGetSets<WorkoutSet>(token, username);
    })
    .then((resp) => {
      if (trackConfig) {
        trackEvent('hevy_sync_success', { method: trackConfig.successMethod, workouts: resp.meta?.workouts });
      }
      const sets = resp.sets ?? [];

      // Instant processing
      const hydrated = hydrateBackendWorkoutSets(sets);
      if (hydrated.length === 0 || hydrated.every((s) => !s.parsedDate)) {
        clearHevyAuthToken();
        saveSetupComplete(false);
        deps.setHevyLoginError('Hevy data could not be parsed. Please try syncing again.');
        deps.setOnboarding({ intent: 'initial', step: 'platform' });
        return;
      }

      const enriched = identifyPersonalRecords(hydrated);
      deps.setParsedData(enriched);
      deps.setHevyLoginError(null);
      deps.setCsvImportError(null);
    })
    .catch((err) => {
      if (trackConfig) {
        trackEvent('hevy_sync_error', { method: trackConfig.errorMethod });
      }
      clearHevyAuthToken();
      saveSetupComplete(false);
      deps.setHevyLoginError(getHevyErrorMessage(err));
      deps.setOnboarding({ intent: 'initial', step: 'platform' });
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};

export const loadHevyFromCredentials = async (
  deps: StartupAutoLoadParams,
  username: string
): Promise<boolean> => {
  const password = await getHevyPassword();
  if (!password) {
    return false;
  }

  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  try {
    const loginResp = await hevyBackendLogin(username, password);

    if (!loginResp.auth_token) {
      throw new Error('Missing auth token');
    }

    saveHevyAuthToken(loginResp.auth_token);
    saveHevyUsernameOrEmail(username);
    await saveHevyPassword(password).catch(() => {});
    saveLastLoginMethod('hevy', 'credentials', username);

    const { username: accountUsername } = await hevyBackendGetAccount(loginResp.auth_token);
    const resp = await hevyBackendGetSets<WorkoutSet>(loginResp.auth_token, accountUsername);

    trackEvent('hevy_sync_success', { method: 'auto_credentials_reload', workouts: resp.meta?.workouts });

    const sets = resp.sets ?? [];
    const hydrated = hydrateBackendWorkoutSets(sets);

    if (hydrated.length === 0 || hydrated.every((s) => !s.parsedDate)) {
      clearHevyAuthToken();
      clearHevyCredentials();
      saveSetupComplete(false);
      deps.setHevyLoginError('Hevy data could not be parsed. Please try syncing again.');
      deps.setOnboarding({ intent: 'initial', step: 'platform' });
      deps.finishProgress(startedAt);
      return false;
    }

    const enriched = identifyPersonalRecords(hydrated);
    deps.setParsedData(enriched);
    deps.setHevyLoginError(null);
    deps.setCsvImportError(null);
    deps.finishProgress(startedAt);
    return true;
  } catch (err) {
    trackEvent('hevy_sync_error', { method: 'auto_credentials_reload' });
    clearHevyAuthToken();
    clearHevyCredentials();
    saveSetupComplete(false);
    deps.setHevyLoginError(getHevyErrorMessage(err));
    deps.setOnboarding({ intent: 'initial', step: 'platform' });
    deps.finishProgress(startedAt);
    return false;
  }
};
