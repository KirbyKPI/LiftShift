import { trackEvent } from '../../utils/integrations/analytics';
import { computationCache } from '../../utils/storage/computationCache';
import {
  clearBodyMapGender,
  clearCSVData,
  clearDateMode,
  clearPreferencesConfirmed,
  clearThemeMode,
  clearWeightUnit,
} from '../../utils/storage/localStorage';
import {
  clearDataSourceChoice,
  clearHevyAuthToken,
  clearHevyRefreshToken,
  clearHevyProApiKey,
  clearLastCsvPlatform,
  clearLastLoginMethod,
  clearLyfataApiKey,
  clearSetupComplete,
} from '../../utils/storage/dataSourceStorage';

export const clearCacheAndRestart = (): void => {
  trackEvent('cache_clear', {});
  clearCSVData();
  clearHevyAuthToken();
  // clears stored auth expiry as well
  clearHevyRefreshToken();
  clearHevyProApiKey();
  // Keep credentials for auto-relogin unless user explicitly logs out
  clearLyfataApiKey();
  clearDataSourceChoice();
  clearLastCsvPlatform();
  clearLastLoginMethod();
  clearSetupComplete();
  clearWeightUnit();
  clearBodyMapGender();
  clearPreferencesConfirmed();
  clearThemeMode();
  clearDateMode();
  computationCache.clear();
  window.location.reload();
};
