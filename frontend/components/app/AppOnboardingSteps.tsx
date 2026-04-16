import React from 'react';
import type { BodyMapGender } from '../bodyMap/BodyMap';
import type { WeightUnit } from '../../utils/storage/localStorage';
import type { OnboardingFlow } from '../../app/onboarding/types';
import { LandingPage } from '../landing/ui/LandingPage';
import { getPreferencesConfirmed } from '../../utils/storage/localStorage';
import { OnboardingPreferencesStep } from './OnboardingPreferencesStep';
import { OnboardingDemoStep } from './OnboardingDemoStep';
import { HevyLoginStep, LyftaLoginStep } from './OnboardingLoginSteps';
import { OnboardingCsvStep } from './OnboardingCsvStep';
import { AddSourcePickerModal } from './AddSourcePickerModal';

const chooseNextStep = (
  intent: OnboardingFlow['intent'],
  source: 'strong' | 'hevy' | 'lyfta' | 'other',
  preferencesConfirmed: boolean
): OnboardingFlow => {
  if (source === 'strong') {
    return {
      intent,
      step: preferencesConfirmed ? 'strong_csv' : 'strong_prefs',
      platform: 'strong',
      backStep: 'strong_prefs',
    };
  }
  if (source === 'lyfta') {
    return {
      intent,
      step: preferencesConfirmed ? 'lyfta_login' : 'lyfta_prefs',
      platform: 'lyfta',
      backStep: intent === 'update' && preferencesConfirmed ? 'add_source_platform' : undefined,
    };
  }
  if (source === 'other') {
    return {
      intent,
      step: preferencesConfirmed ? 'other_csv' : 'other_prefs',
      platform: 'other',
      backStep: 'other_prefs',
    };
  }
  return {
    intent,
    step: preferencesConfirmed ? 'hevy_login' : 'hevy_prefs',
    platform: 'hevy',
    backStep: intent === 'update' && preferencesConfirmed ? 'add_source_platform' : undefined,
  };
};

interface AppOnboardingStepsProps {
  onboarding: OnboardingFlow;
  dataSource: 'strong' | 'hevy' | 'lyfta' | 'other' | null;
  bodyMapGender: BodyMapGender;
  weightUnit: WeightUnit;
  isAnalyzing: boolean;
  csvImportError: string | null;
  hevyLoginError: string | null;
  lyfatLoginError: string | null;
  onSetOnboarding: (next: OnboardingFlow | null) => void;
  onSetBodyMapGender: (g: BodyMapGender) => void;
  onSetWeightUnit: (u: WeightUnit) => void;
  onSetCsvImportError: (msg: string | null) => void;
  onSetHevyLoginError: (msg: string | null) => void;
  onSetLyfatLoginError: (msg: string | null) => void;
  onClearCacheAndRestart: () => void;
  onProcessFile: (file: File, platform: 'strong' | 'hevy' | 'lyfta' | 'other', unitOverride?: WeightUnit) => void;
  onHevyLogin: (emailOrUsername: string, password: string) => void;
  onHevyApiKeyLogin: (apiKey: string) => void;
  onHevySyncSaved: () => void;
  onLyfatLogin: (apiKey: string) => void;
  onLyfatSyncSaved: () => void;
}

export const AppOnboardingSteps: React.FC<AppOnboardingStepsProps> = ({
  onboarding,
  bodyMapGender,
  weightUnit,
  isAnalyzing,
  csvImportError,
  hevyLoginError,
  lyfatLoginError,
  onSetOnboarding,
  onSetBodyMapGender,
  onSetWeightUnit,
  onSetCsvImportError,
  onSetHevyLoginError,
  onSetLyfatLoginError,
  onClearCacheAndRestart,
  onProcessFile,
  onHevyLogin,
  onHevyApiKeyLogin,
  onHevySyncSaved,
  onLyfatLogin,
  onLyfatSyncSaved,
}) => {
  const closeForUpdate = onboarding.intent === 'update' ? () => onSetOnboarding(null) : undefined;

  const handleSelectPlatform = (source: 'strong' | 'hevy' | 'lyfta' | 'other') => {
    onSetCsvImportError(null);
    onSetHevyLoginError(null);
    onSetLyfatLoginError(null);
    const skipPrefs = onboarding.intent === 'update' && getPreferencesConfirmed();
    onSetOnboarding(chooseNextStep(onboarding.intent, source, skipPrefs));
  };

  if (onboarding.step === 'platform') {
    return (
      <LandingPage
        onSelectPlatform={handleSelectPlatform}
        onTryDemo={() => {
          onSetCsvImportError(null);
          onSetHevyLoginError(null);
          onSetLyfatLoginError(null);
          onSetOnboarding({ intent: 'initial', step: 'demo_prefs', platform: 'other' });
        }}
      />
    );
  }

  if (onboarding.step === 'add_source_platform') {
    return (
      <AddSourcePickerModal
        onSelectSource={handleSelectPlatform}
        onClose={() => onSetOnboarding(null)}
      />
    );
  }

  if (onboarding.step === 'demo_prefs') {
    return (
      <OnboardingDemoStep
        intent={onboarding.intent}
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onSetCsvImportError={onSetCsvImportError}
        onProcessFile={onProcessFile}
        onClose={closeForUpdate}
      />
    );
  }

  if (onboarding.step === 'hevy_prefs') {
    return (
      <OnboardingPreferencesStep
        intent={onboarding.intent}
        platform="hevy"
        nextStep="hevy_login"
        backStep="platform"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onClose={closeForUpdate}
      />
    );
  }

  if (onboarding.step === 'lyfta_prefs') {
    return (
      <OnboardingPreferencesStep
        intent={onboarding.intent}
        platform="lyfta"
        nextStep="lyfta_login"
        backStep="platform"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onClose={closeForUpdate}
      />
    );
  }

  if (onboarding.step === 'strong_prefs') {
    return (
      <OnboardingPreferencesStep
        intent={onboarding.intent}
        platform="strong"
        nextStep="strong_csv"
        nextBackStep="strong_prefs"
        backStep="platform"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onClose={closeForUpdate}
      />
    );
  }

  if (onboarding.step === 'other_prefs') {
    return (
      <OnboardingPreferencesStep
        intent={onboarding.intent}
        platform="other"
        nextStep="other_csv"
        nextBackStep="other_prefs"
        backStep="platform"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onClose={closeForUpdate}
      />
    );
  }

  if (onboarding.step === 'hevy_login') {
    return (
      <HevyLoginStep
        intent={onboarding.intent}
        hevyLoginError={hevyLoginError}
        isAnalyzing={isAnalyzing}
        onHevyLogin={onHevyLogin}
        onHevyApiKeyLogin={onHevyApiKeyLogin}
        onHevySyncSaved={onHevySyncSaved}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onSetOnboarding={onSetOnboarding}
        backToCombinePicker={onboarding.backStep === 'add_source_platform'}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  if (onboarding.step === 'lyfta_login') {
    return (
      <LyftaLoginStep
        intent={onboarding.intent}
        lyfatLoginError={lyfatLoginError}
        isAnalyzing={isAnalyzing}
        onLyfatLogin={onLyfatLogin}
        onLyfatSyncSaved={onLyfatSyncSaved}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onSetOnboarding={onSetOnboarding}
        backToCombinePicker={onboarding.backStep === 'add_source_platform'}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  if (onboarding.step === 'strong_csv') {
    return (
      <OnboardingCsvStep
        intent={onboarding.intent}
        platform="strong"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        csvImportError={csvImportError}
        backStep={onboarding.backStep ?? 'strong_prefs'}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onSetCsvImportError={onSetCsvImportError}
        onProcessFile={onProcessFile}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onClose={closeForUpdate}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  if (onboarding.step === 'other_csv') {
    return (
      <OnboardingCsvStep
        intent={onboarding.intent}
        platform="other"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        csvImportError={csvImportError}
        backStep={onboarding.backStep ?? 'other_prefs'}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onSetCsvImportError={onSetCsvImportError}
        onProcessFile={onProcessFile}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onClose={closeForUpdate}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  if (onboarding.step === 'lyfta_csv') {
    return (
      <OnboardingCsvStep
        intent={onboarding.intent}
        platform="lyfta"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        csvImportError={csvImportError}
        backStep={onboarding.backStep ?? 'lyfta_prefs'}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onSetCsvImportError={onSetCsvImportError}
        onProcessFile={onProcessFile}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onClose={closeForUpdate}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  if (onboarding.step === 'hevy_csv') {
    return (
      <OnboardingCsvStep
        intent={onboarding.intent}
        platform="hevy"
        bodyMapGender={bodyMapGender}
        weightUnit={weightUnit}
        isAnalyzing={isAnalyzing}
        csvImportError={csvImportError}
        backStep={onboarding.backStep ?? 'hevy_login'}
        onSetOnboarding={onSetOnboarding}
        onSetBodyMapGender={onSetBodyMapGender}
        onSetWeightUnit={onSetWeightUnit}
        onSetCsvImportError={onSetCsvImportError}
        onProcessFile={onProcessFile}
        onClearCacheAndRestart={onClearCacheAndRestart}
        onClose={closeForUpdate}
        withPreferences={true}
        onOpenAddSourcePicker={onboarding.backStep === 'add_source_platform' ? undefined : () => onSetOnboarding({ intent: 'update', step: 'add_source_platform' })}
      />
    );
  }

  return null;
};
