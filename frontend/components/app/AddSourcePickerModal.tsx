import React from 'react';
import { X } from 'lucide-react';
import type { DataSourceChoice } from '../../utils/storage/dataSourceStorage';
import { assetPath } from '../../constants';
import { UNIFORM_HEADER_BUTTON_CLASS } from '../../utils/ui/uiConstants';
import { OnboardingModalShell } from '../modals/ui/OnboardingModalShell';
import PlatformDock from '../landing/ui/PlatformDock';

interface AddSourcePickerModalProps {
  onSelectSource: (source: DataSourceChoice) => void;
  onClose: () => void;
}

export const AddSourcePickerModal: React.FC<AddSourcePickerModalProps> = ({ onSelectSource, onClose }) => {
  const dockItems = [
    {
      name: 'Hevy',
      image: assetPath('/images/brands/hevy_small.webp'),
      onClick: () => onSelectSource('hevy' as DataSourceChoice),
      badge: 'Recommended',
    },
    {
      name: 'Strong',
      image: assetPath('/images/brands/Strong_small.webp'),
      onClick: () => onSelectSource('strong' as DataSourceChoice),
      badge: 'CSV',
    },
    {
      name: 'Lyfta',
      image: assetPath('/images/brands/lyfta_small.webp'),
      onClick: () => onSelectSource('lyfta' as DataSourceChoice),
      badge: 'CSV',
    },
    {
      name: 'Other',
      image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 15' fill='none'><rect x='2' y='5' width='12' height='8' fill='%232ea44f'/><path fill-rule='evenodd' clip-rule='evenodd' d='M1 1.5C1 0.671573 1.67157 0 2.5 0H10.7071L14 3.29289V13.5C14 14.3284 13.3284 15 12.5 15H2.5C1.67157 15 1 14.3284 1 13.5V1.5ZM3 5H4.2V7H3V5ZM3.4 5.4H3.8V6.6H3.4V5.4ZM5 5H6.2V5.4H5.8V7H5.4V5.4H5V5ZM7 5H7.4V5.8H8V5H8.4V7H8V6.2H7.4V7H7V5ZM9.2 5H10.4V5.4H9.6V5.8H10.2V6.2H9.6V6.6H10.4V7H9.2V5ZM11 5H12V6H11.5L12.1 7H11.6L11.1 6.1V7H10.7V5H11ZM11.1 5.4V5.7H11.5V5.4H11.1ZM2.5 11H3.5V12H2.5V11ZM4.5 9H6.5V10H5.2V11H6.5V12H4.5V9ZM7.5 9H9.5V10H8.2V10.3H9.5V12H7.5V11H8.8V10.7H7.5V9ZM10.5 9H11.3L11.8 11L12.3 9H13.1L12.2 12H11.4L10.5 9Z' fill='%23000000'/></svg>",
      onClick: () => onSelectSource('other' as DataSourceChoice),
      badge: 'CSV',
    },
  ];

  return (
    <OnboardingModalShell
      maxWidthClassName="max-w-2xl"
      header={(
        <div className="flex items-start justify-between gap-3">
          <div />
          <div className="text-center">
            <h2 className="text-2xl font-bold text-slate-200">Combine data sources</h2>
            <p className="mt-1 text-sm text-slate-400">Pick another platform to merge into your analytics.</p>
          </div>
          <button type="button" onClick={onClose} className={UNIFORM_HEADER_BUTTON_CLASS}>
            <X className="w-4 h-4" />
            <span className="hidden sm:inline">Close</span>
          </button>
        </div>
      )}
    >
      <div className="min-h-[220px] flex items-center justify-center">
        <PlatformDock items={dockItems} className="!static !translate-x-0 !left-0 !bottom-0" />
      </div>
    </OnboardingModalShell>
  );
};
