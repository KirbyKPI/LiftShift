import { WeightUnit } from '../../utils/storage/localStorage';
import type { DataSourceChoice } from '../../utils/storage/dataSourceStorage';
import { addCombinedDataSource, saveLastCsvPlatform, saveLastLoginMethod, saveSetupComplete } from '../../utils/storage/dataSourceStorage';
import { getHevyUsernameOrEmail } from '../../utils/storage/hevyCredentialsStorage';
import { saveCSVData } from '../../utils/storage/localStorage';
import { identifyPersonalRecords } from '../../utils/analysis/core';
import { getErrorMessage } from '../../app/ui';
import { parseWorkoutCSVAsyncWithUnit, ParseWorkoutCsvResult } from '../../utils/csv/csvParser';
import { trackEvent } from '../../utils/integrations/analytics';
import type { AppAuthHandlersDeps } from './appAuthTypes';


export const runCsvImport = (
  deps: AppAuthHandlersDeps,
  file: File,
  platform: DataSourceChoice,
  unitOverride?: WeightUnit
): void => {
  trackEvent('csv_import_start', { platform, unit: unitOverride ?? deps.weightUnit });
  deps.setLoadingKind('csv');
  deps.setIsAnalyzing(true);
  const startedAt = deps.startProgress();

  const reader = new FileReader();

  reader.onload = (e) => {
    const text = e.target?.result;
    if (typeof text === 'string') {
      deps.setCsvImportError(null);

      const unit = unitOverride ?? deps.weightUnit;
      parseWorkoutCSVAsyncWithUnit(text, { unit })
        .then((result: ParseWorkoutCsvResult) => {
          const enriched = identifyPersonalRecords(result.sets);
          const sourced = enriched.map((s) => ({ ...s, source: platform }));
          trackEvent('csv_import_success', {
            platform,
            unit,
            sets: result.sets?.length,
            enriched_sets: sourced?.length,
          });

          deps.setParsedData(sourced);
          saveCSVData(text);
          saveLastCsvPlatform(platform);
          saveLastLoginMethod(
            platform,
            'csv',
            platform === 'hevy' ? (getHevyUsernameOrEmail() ?? undefined) : undefined
          );
          deps.setDataSource(platform);
          addCombinedDataSource(platform);
          saveSetupComplete(true);
          deps.setOnboarding(null);
        })
        .catch((err) => {
          trackEvent('csv_import_error', { platform });
          deps.setCsvImportError(getErrorMessage(err));
        })
        .finally(() => {
          deps.setSelectedMonth('all');
          deps.setSelectedDay(null);
          deps.finishProgress(startedAt);
        });
    }
  };

  reader.onerror = () => {
    deps.setCsvImportError('Failed to read file');
    deps.finishProgress(startedAt);
  };

  reader.readAsText(file);
};
