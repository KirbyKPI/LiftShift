import { WorkoutSet } from '../../types';
import {
  hevyBackendGetAccount,
  hevyBackendGetSets,
  hevyBackendGetSetsWithProApiKey,
  hevyBackendLogin,
  hevyBackendRefreshToken,
} from '../../utils/api/hevyBackend';
import { identifyPersonalRecords } from '../../utils/analysis/core';
import {
  clearHevyAuthToken,
  clearHevyRefreshToken,
  clearHevyProApiKey,
  getHevyRefreshToken,
  getHevyAuthExpiresAt,
  saveHevyAuthToken,
  saveHevyAuthExpiresAt,
  saveHevyRefreshToken,
  saveLastLoginMethod,
  saveSetupComplete,
} from '../../utils/storage/dataSourceStorage';
import {
  getHevyPassword,
  getHevyUsernameOrEmail,
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

  const fetchSetsWithToken = (accessToken: string) =>
    hevyBackendGetAccount(accessToken)
      .then(({ username }) => hevyBackendGetSets<WorkoutSet>(accessToken, username));

  const shouldRefreshToken = (): boolean => {
    const expiresAt = getHevyAuthExpiresAt();
    if (!expiresAt) return false;
    const expiresMs = Date.parse(expiresAt);
    if (!Number.isFinite(expiresMs)) return false;
    const refreshSkewMs = 2 * 60 * 1000;
    return Date.now() + refreshSkewMs >= expiresMs;
  };

  const attemptCredentialFallback = () => {
    const username = getHevyUsernameOrEmail();
    const password = getHevyPassword();
    if (!username || !password) return Promise.reject(new Error('Missing saved credentials'));
    return loadHevyFromCredentials(deps, username, password).then((success) => {
      if (!success) throw new Error('Credential login failed');
    });
  };

  const refreshToken = getHevyRefreshToken();
  const fetchWithToken = () => fetchSetsWithToken(token);
  const refreshThenFetch = (tokenToRefresh: string) =>
    hevyBackendRefreshToken(tokenToRefresh)
      .then((refreshed) => {
        if (!refreshed.auth_token) throw new Error('Missing auth token');
        saveHevyAuthToken(refreshed.auth_token);
        if (refreshed.refresh_token) saveHevyRefreshToken(refreshed.refresh_token);
        saveHevyAuthExpiresAt(refreshed.expires_at ?? null);
        return fetchSetsWithToken(refreshed.auth_token);
      });

  const initialPromise = shouldRefreshToken() && refreshToken
    ? refreshThenFetch(refreshToken)
    : fetchWithToken();

  initialPromise
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
      const status = (err as any)?.statusCode;
      if (status === 401 && refreshToken) {
        return refreshThenFetch(refreshToken)
          .then((resp) => {
            const sets = resp.sets ?? [];
            const hydrated = hydrateBackendWorkoutSets(sets);
            if (hydrated.length === 0 || hydrated.every((s) => !s.parsedDate)) {
              clearHevyAuthToken();
              clearHevyRefreshToken();
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
          .catch(() => attemptCredentialFallback())
          .catch((refreshErr) => {
            clearHevyAuthToken();
            clearHevyRefreshToken();
            saveSetupComplete(false);
            deps.setHevyLoginError(getHevyErrorMessage(refreshErr));
            deps.setOnboarding({ intent: 'initial', step: 'platform' });
          });
      }
      attemptCredentialFallback()
        .catch(() => {
          clearHevyAuthToken();
          clearHevyRefreshToken();
          saveSetupComplete(false);
          deps.setHevyLoginError(getHevyErrorMessage(err));
          deps.setOnboarding({ intent: 'initial', step: 'platform' });
        });
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};

export const loadHevyFromCredentials = async (
  deps: StartupAutoLoadParams,
  username: string,
  password: string
): Promise<boolean> => {
  // Validate password before attempting login
  if (!password || password.trim().length === 0) {
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
    if (loginResp.refresh_token) saveHevyRefreshToken(loginResp.refresh_token);
    saveHevyAuthExpiresAt(loginResp.expires_at ?? null);
    saveHevyUsernameOrEmail(username);
    saveHevyPassword(password);
    saveLastLoginMethod('hevy', 'credentials', username);

    const { username: accountUsername } = await hevyBackendGetAccount(loginResp.auth_token);
    const resp = await hevyBackendGetSets<WorkoutSet>(loginResp.auth_token, accountUsername);

    trackEvent('hevy_sync_success', { method: 'auto_credentials_reload', workouts: resp.meta?.workouts });

    const sets = resp.sets ?? [];
    const hydrated = hydrateBackendWorkoutSets(sets);

    if (hydrated.length === 0 || hydrated.every((s) => !s.parsedDate)) {
      clearHevyAuthToken();
      clearHevyRefreshToken();
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
    clearHevyRefreshToken();
    saveSetupComplete(false);
    deps.setHevyLoginError(getHevyErrorMessage(err));
    deps.setOnboarding({ intent: 'initial', step: 'platform' });
    deps.finishProgress(startedAt);
    return false;
  }
};
