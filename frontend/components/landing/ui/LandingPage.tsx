import React from 'react';
import { motion } from 'motion/react';
import type { DataSourceChoice } from '../../../utils/storage/dataSourceStorage';
import { Navigation } from '../../layout/Navigation';
import PlatformDock from './PlatformDock';
import LightRays from '../lightRays/LightRays';
import { Flame, CalendarDays, Trophy, BarChart3, Dumbbell } from 'lucide-react';
import { FANCY_FONT } from '../../../utils/ui/uiConstants';
import { assetPath } from '../../../constants';

interface LandingPageProps {
  onSelectPlatform: (source: DataSourceChoice) => void;
  onTryDemo?: () => void;
}

export const LandingPage: React.FC<LandingPageProps> = ({ onSelectPlatform, onTryDemo }) => {
  // Platform dock items
  const platformDockItems = [
    {
      name: 'Hevy',
      image: assetPath('/images/brands/hevy_small.webp'),
      onClick: () => onSelectPlatform('hevy'),
      badge: 'Recommended'
    },
    {
      name: 'Strong',
      image: assetPath('/images/brands/Strong_small.webp'),
      onClick: () => onSelectPlatform('strong'),
      badge: 'CSV'
    },
    {
      name: 'Lyfta',
      image: assetPath('/images/brands/lyfta_small.webp'),
      onClick: () => onSelectPlatform('lyfta'),
      badge: 'CSV'
    },
    {
      name: 'Other',
      image: "data:image/svg+xml;utf8,<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 15 15' fill='none'><rect x='2' y='5' width='12' height='8' fill='%232ea44f'/><path fill-rule='evenodd' clip-rule='evenodd' d='M1 1.5C1 0.671573 1.67157 0 2.5 0H10.7071L14 3.29289V13.5C14 14.3284 13.3284 15 12.5 15H2.5C1.67157 15 1 14.3284 1 13.5V1.5ZM3 5H4.2V7H3V5ZM3.4 5.4H3.8V6.6H3.4V5.4ZM5 5H6.2V5.4H5.8V7H5.4V5.4H5V5ZM7 5H7.4V5.8H8V5H8.4V7H8V6.2H7.4V7H7V5ZM9.2 5H10.4V5.4H9.6V5.8H10.2V6.2H9.6V6.6H10.4V7H9.2V5ZM11 5H12V6H11.5L12.1 7H11.6L11.1 6.1V7H10.7V5H11ZM11.1 5.4V5.7H11.5V5.4H11.1ZM2.5 11H3.5V12H2.5V11ZM4.5 9H6.5V10H5.2V11H6.5V12H4.5V9ZM7.5 9H9.5V10H8.2V10.3H9.5V12H7.5V11H8.8V10.7H7.5V9ZM10.5 9H11.3L11.8 11L12.3 9H13.1L12.2 12H11.4L10.5 9Z' fill='%23000000'/></svg>",
      badge: 'CSV',
      onClick: () => onSelectPlatform('other'),
    },
  ];

  return (
    <motion.div
      initial={{ opacity: 1 }}
      exit={{ opacity: 0 }}
      transition={{ duration: 0.3, ease: 'easeOut' }}
      className="fixed inset-0 z-50 overflow-hidden bg-slate-950 text-slate-200 font-sans"
    >
      {/* Light Rays Effect */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        <LightRays
          raysOrigin="top-center"
          raysColor="#10b981"
          raysSpeed={0.8}
          lightSpread={1.2}
          rayLength={1.5}
          followMouse={true}
          mouseInfluence={0.08}
          noiseAmount={0.05}
          distortion={0.03}
          fadeDistance={1.2}
          saturation={0.9}
        />
      </div>

      {/* Single-screen layout */}
      <section className="relative z-10 h-full flex flex-col pt-2">
        <div className="max-w-6xl mx-auto w-full">
          <Navigation variant="landing" className="px-4 sm:px-6 lg:px-8" />
        </div>

        {/* Hero Content — vertically centered in remaining space */}
        <div className="flex-1 flex items-center justify-center pb-48 sm:pb-40">
          <div className="text-center max-w-4xl mx-auto px-4 sm:px-6 lg:px-8">
            {/* Main Headline */}
            <h1 className="text-4xl sm:text-5xl lg:text-6xl font-bold tracking-tight mb-6 leading-[1.3]">
              <span className="block text-slate-300 mb-2">
                Track smarter.
              </span>
              <span className="block bg-gradient-to-r from-emerald-300 via-emerald-400 to-green-400 bg-clip-text text-transparent pb-1" style={FANCY_FONT}>
                Train harder.
              </span>
            </h1>

            {/* Feature highlights */}
            <div className="flex flex-wrap items-center justify-center gap-x-5 gap-y-2.5 text-slate-400 mb-6 text-sm">
              <FeatureTag icon={<Flame className="w-4 h-4 text-orange-400" />} text="Muscle Heatmaps" />
              <FeatureTag icon={<CalendarDays className="w-4 h-4 text-blue-400" />} text="Calendar Filtering" />
              <FeatureTag icon={<Trophy className="w-4 h-4 text-yellow-400" />} text="PR Detection" />
              <FeatureTag icon={<BarChart3 className="w-4 h-4 text-emerald-400" />} text="Volume Trends" />
              <FeatureTag icon={<Dumbbell className="w-4 h-4 text-purple-400" />} text="Exercise Deep Dives" />
            </div>

            {/* Demo CTA Button */}
            {onTryDemo && (
              <div className="mb-2">
                <button
                  onClick={onTryDemo}
                  className="group inline-flex items-center justify-center whitespace-nowrap rounded-full text-sm font-semibold h-11 px-8 bg-slate-950/75 text-emerald-300 border border-emerald-500/40 hover:border-emerald-400 hover:text-emerald-200 transition-all duration-200"
                >
                  <span>Try Demo with Sample Data</span>
                </button>
              </div>
            )}
          </div>
        </div>

        {/* Platform Dock pinned to bottom */}
        <div className="flex-shrink-0">
          <PlatformDock items={platformDockItems} />
        </div>
      </section>
    </motion.div>
  );
};

// Feature tag component
interface FeatureTagProps {
  icon: React.ReactNode;
  text: string;
}

const FeatureTag: React.FC<FeatureTagProps> = ({ icon, text }) => (
  <span className="inline-flex items-center gap-1.5 text-sm">
    {icon}
    <span>{text}</span>
  </span>
);

export default LandingPage;
