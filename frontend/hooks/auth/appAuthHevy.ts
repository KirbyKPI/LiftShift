import { WorkoutSet } from '../../types';
import {
  getHevyAuthToken,
  getHevyRefreshToken,
  saveHevyAuthToken,
  saveHevyAuthExpiresAt,
  saveHevyRefreshToken,
  clearHevyRefreshToken,
  clearHevyAuthToken,
  getHevyProApiKey,
  saveHevyProApiKey,
  clearHevyProApiKey,
  saveLastLoginMethod,
  saveSetupComplete,
} from '../../utils/storage/dataSourceStorage';
import {
  getHevyPassword,
  getHevyUsernameOrEmail,
  saveHevyPassword,
  saveHevyUsernameOrEmail,
} from '../../utils/storage/hevyCredentialsStorage';
import {
  hevyBackendGetAccount,
  hevyBackendGetSets,
  hevyBackendGetSetsWithProApiKey,
  hevyBackendLogin,
  hevyBackendRefresh,
  hevyBackendValidateProApiKey,
} from '../../utils/api/hevyBackend';
import { identifyPersonalRecords } from '../../utils/analysis/core';
import { hydrateBackendWorkoutSets } from '../../app/auth';
import { getHevyErrorMessage } from '../../app/ui';
import { trackEvent } from '../../utils/integrations/analytics';
import type { AppAuthHandlersDeps } from './appAuthTypes';

export const runHevySyncSaved = (deps: AppAuthHandlersDeps): void => {
  const savedProKey = getHevyProApiKey();
  if (savedProKey) {
    deps.setHevyLoginError(null);
    deps.setLoadingKind('hevy');
    deps.setIsAnalyzing(true);
    const startedAt = deps.startProgress();

    hevyBackendGetSetsWithProApiKey<WorkoutSet>(savedProKey)
      .then((resp) => {
        const sets = resp.sets ?? [];
        const hydrated = hydrateBackendWorkoutSets(sets);
        const enriched = identifyPersonalRecords(hydrated);

        deps.setParsedData(enriched);
        saveLastLoginMethod('hevy', 'apiKey', getHevyUsernameOrEmail() ?? undefined);
        deps.setDataSource('hevy');
        saveSetupComplete(true);
        deps.setOnboarding(null);
      })
      .catch((err) => {
        clearHevyProApiKey();
        deps.setHevyLoginError(getHevyErrorMessage(err));
      })
      .finally(() => {
        deps.finishProgress(startedAt);
      });
    return;
  }

  const token = getHevyAuthToken();
  if (!token) return;

  if (deps.isAnalyzing) return;

  deps.setHevyLoginError(null);
  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  const savedUsername = getHevyUsernameOrEmail();
  const savedPassword = getHevyPassword();
  const savedRefreshToken = getHevyRefreshToken();

  const fetchSetsWithToken = (accessToken: string) =>
    hevyBackendGetAccount(accessToken)
      .then(({ username }) => hevyBackendGetSets<WorkoutSet>(accessToken, username));

  const attemptCredentialFallback = () => {
    if (!savedUsername || !savedPassword) return Promise.reject(new Error('Missing saved credentials'));
    return hevyBackendLogin(savedUsername, savedPassword)
      .then((r) => {
        if (!r.auth_token) throw new Error('Missing auth token');
        saveHevyAuthToken(r.auth_token);
        saveHevyAuthExpiresAt(r.expires_at ?? null);
        if (r.refresh_token) saveHevyRefreshToken(r.refresh_token);
        else clearHevyRefreshToken();
        return fetchSetsWithToken(r.auth_token);
      });
  };

  const attemptRefreshFallback = () => {
    if (!savedRefreshToken) return Promise.reject(new Error('Missing saved refresh token'));
    return hevyBackendRefresh(token, savedRefreshToken)
      .then((r) => {
        if (!r.auth_token) throw new Error('Missing auth token');
        saveHevyAuthToken(r.auth_token);
        saveHevyAuthExpiresAt(r.expires_at ?? null);
        if (r.refresh_token) saveHevyRefreshToken(r.refresh_token);
        return fetchSetsWithToken(r.auth_token);
      });
  };

  const initialPromise = fetchSetsWithToken(token);

  initialPromise
    .then((resp) => {
      const sets = resp.sets ?? [];
      const hydrated = hydrateBackendWorkoutSets(sets);
      const enriched = identifyPersonalRecords(hydrated);

      deps.setParsedData(enriched);
      saveLastLoginMethod('hevy', 'credentials', getHevyUsernameOrEmail() ?? undefined);
      deps.setDataSource('hevy');
      saveSetupComplete(true);
      deps.setOnboarding(null);
    })
    .catch((err) => {
      const status = (err as any)?.statusCode;
      if (status && status !== 401) {
        deps.setHevyLoginError(getHevyErrorMessage(err));
        return Promise.resolve();
      }
      return attemptRefreshFallback()
        .catch(() => attemptCredentialFallback())
        .catch(() => {
          clearHevyAuthToken();
          deps.setHevyLoginError(getHevyErrorMessage(err));
        });
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};

export const runHevyApiKeyLogin = (deps: AppAuthHandlersDeps, apiKey: string): void => {
  const trimmed = apiKey.trim();
  if (!trimmed) {
    deps.setHevyLoginError('Missing API key.');
    return;
  }

  trackEvent('hevy_sync_start', { method: 'pro_api_key' });

  deps.setHevyLoginError(null);
  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  hevyBackendValidateProApiKey(trimmed)
    .then((valid) => {
      if (!valid) throw new Error('Invalid API key. Please check your Hevy Pro API key and try again.');
      saveHevyProApiKey(trimmed);
      saveLastLoginMethod('hevy', 'apiKey', getHevyUsernameOrEmail() ?? undefined);

      return hevyBackendGetSetsWithProApiKey<WorkoutSet>(trimmed);
    })
    .then((resp) => {
      const sets = resp.sets ?? [];
      const hydrated = hydrateBackendWorkoutSets(sets);
      const enriched = identifyPersonalRecords(hydrated);

      deps.setParsedData(enriched);
      deps.setDataSource('hevy');
      saveSetupComplete(true);
      deps.setOnboarding(null);
    })
    .catch((err) => {
      trackEvent('hevy_sync_error', { method: 'pro_api_key' });
      clearHevyProApiKey();
      deps.setHevyLoginError(getHevyErrorMessage(err));
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};

export const runHevyLogin = (deps: AppAuthHandlersDeps, emailOrUsername: string, password: string): void => {
  trackEvent('hevy_sync_start', { method: 'credentials' });
  deps.setHevyLoginError(null);
  deps.setLoadingKind('hevy');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  hevyBackendLogin(emailOrUsername, password)
    .then((r) => {
      if (!r.auth_token) throw new Error('Missing auth token');
      saveHevyAuthToken(r.auth_token);
      saveHevyAuthExpiresAt(r.expires_at ?? null);
      if (r.refresh_token) saveHevyRefreshToken(r.refresh_token);
      else clearHevyRefreshToken();
      const trimmed = emailOrUsername.trim();
      saveHevyUsernameOrEmail(trimmed);
      saveLastLoginMethod('hevy', 'credentials', trimmed);
      saveHevyPassword(password);
      return hevyBackendGetAccount(r.auth_token).then(({ username }) => ({ token: r.auth_token, username }));
    })
    .then(({ token, username }) => {
      return hevyBackendGetSets<WorkoutSet>(token, username);
    })
    .then((resp) => {
      const sets = resp.sets ?? [];
      const hydrated = hydrateBackendWorkoutSets(sets);
      const enriched = identifyPersonalRecords(hydrated);

      deps.setParsedData(enriched);
      deps.setDataSource('hevy');
      saveSetupComplete(true);
      deps.setOnboarding(null);
    })
    .catch((err) => {
      trackEvent('hevy_sync_error', { method: 'credentials' });
      deps.setHevyLoginError(getHevyErrorMessage(err));
    })
    .finally(() => {
      deps.finishProgress(startedAt);
    });
};
