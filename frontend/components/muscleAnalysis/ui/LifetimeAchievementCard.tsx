import React, { useMemo } from 'react';
import { Sprout, GraduationCap, TrendingUp, Target, BadgeCheck, Medal, Gem, Crown, Zap } from 'lucide-react';
import type { LifetimeAchievementData } from '../hooks/useLifetimeAchievement';
import type { MuscleAchievementEntry } from '../../../utils/muscle/hypertrophy';
import type { MuscleHypertrophyParams } from '../../../utils/muscle/hypertrophy/muscleParams';
import { formatNumber } from '../../../utils/format/formatters';
import { Tooltip, useTooltip } from '../../ui/Tooltip';

interface LifetimeAchievementCardProps {
  data: LifetimeAchievementData;
  selectedMuscleId?: string | null;
  onMuscleClick?: (muscleId: string) => void;
}

/** Compact radial progress ring */
const ProgressRing: React.FC<{ percent: number; size?: number; strokeWidth?: number; color: string }> = ({
  percent,
  size = 64,
  strokeWidth = 5,
  color,
}) => {
  const radius = (size - strokeWidth) / 2;
  const circumference = 2 * Math.PI * radius;
  const offset = circumference - (percent / 100) * circumference;

  return (
    <svg width={size} height={size} className="transform -rotate-90">
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        strokeWidth={strokeWidth}
        stroke="rgba(100, 100, 100, 0.1)"
      />
      <circle
        cx={size / 2}
        cy={size / 2}
        r={radius}
        fill="none"
        stroke={color}
        strokeWidth={strokeWidth}
        strokeLinecap="round"
        strokeDasharray={circumference}
        strokeDashoffset={offset}
        className="transition-all duration-700 ease-out"
      />
    </svg>
  );
};

/** Micro progress bar for per-muscle rows */
const MicroBar: React.FC<{ percent: number; color: string }> = ({ percent, color }) => (
  <div
    className="h-2.5 w-full rounded-full overflow-hidden"
    style={{ backgroundColor: 'rgba(100, 100, 100, 0.1)' }}
  >
    <div
      className="h-full rounded-full transition-all duration-500 ease-out"
      style={{ width: `${Math.min(percent, 100)}%`, backgroundColor: color }}
    />
  </div>
);

/** Tier color → CSS color for ring / bars */
function tierColor(tierKey: string): string {
  switch (tierKey) {
    case 'novice': return '#94a3b8';       // slate-400
    case 'beginner': return '#64748b';     // slate-500  
    case 'intermediate': return '#60a5fa'; // blue-400
    case 'advanced': return '#34d399';     // emerald-400
    case 'proficient': return '#a3e635';   // lime-400
    case 'accomplished': return '#fbbf24'; // amber-400
    case 'exceptional': return '#d97706';  // amber-600 (gold)
    case 'master': return '#fb923c';       // orange-400
    case 'grandmaster': return '#f472b6';  // pink-400
    case 'legendary': return '#f87171';    // red-400
    default: return '#94a3b8';
  }
}

/** Tier icon component for each achievement level */
const TierIcon: React.FC<{ tierKey: string; className?: string }> = ({ tierKey, className }) => {
  const iconClass = className || 'w-2.5 h-2.5';
  switch (tierKey) {
    case 'novice': return <Sprout className={iconClass} />;
    case 'beginner': return <GraduationCap className={iconClass} />;
    case 'intermediate': return <TrendingUp className={iconClass} />;
    case 'advanced': return <Target className={iconClass} />;
    case 'proficient': return <BadgeCheck className={iconClass} />;
    case 'accomplished': return <Medal className={iconClass} />;
    case 'exceptional': return <Gem className={iconClass} />;
    case 'master': return <Crown className={iconClass} />;
    case 'grandmaster': return <Crown className={iconClass} />;
    case 'legendary': return <Zap className={iconClass} />;
    default: return <Sprout className={iconClass} />;
  }
};

// Tier thresholds in ascending order
const TIER_THRESHOLDS = [10, 20, 30, 40, 50, 58, 65, 72, 78, 85];

const TIER_LABELS = ['Novice', 'Beginner', 'Intermediate', 'Advanced', 'Proficient', 'Accomplished', 'Exceptional', 'Master', 'Grandmaster', 'Legendary'];

/** Calculate sets needed and next tier info for a muscle */
function getSetsToNextTier(achievementPercent: number, lifetimeSets: number, params: MuscleHypertrophyParams): { setsToNext: number; nextTierLabel: string; percentToNext: number } | null {
  // Find current tier index
  let currentTierIndex = 0;
  for (let i = 0; i < TIER_THRESHOLDS.length; i++) {
    if (achievementPercent >= TIER_THRESHOLDS[i]) {
      currentTierIndex = i;
    } else {
      break;
    }
  }
  
  // If at max tier, return null
  if (currentTierIndex >= TIER_THRESHOLDS.length - 1) {
    return null;
  }
  
  const nextTierThreshold = TIER_THRESHOLDS[currentTierIndex + 1];
  const nextTierLabel = TIER_LABELS[currentTierIndex + 1];
  const percentToNext = Math.round((nextTierThreshold - achievementPercent) * 10) / 10;
  
  // Calculate sets needed to reach target % for this muscle
  // achievement = ceiling * (sets / (sets + halfLife))
  // sets = (achievement * halfLife) / (ceiling - achievement)
  if (nextTierThreshold >= params.lifetimeCeiling) {
    return null;
  }
  
  const setsNeeded = (nextTierThreshold * params.lifetimeHalfLife) / 
                     (params.lifetimeCeiling - nextTierThreshold);
  const additionalSets = Math.max(0, Math.round(setsNeeded - lifetimeSets));
  
  return { setsToNext: additionalSets, nextTierLabel, percentToNext };
}

/** Calculate estimated time to reach next tier based on actual weekly sets */
function getTimeToNextTier(setsToNext: number, weeklySets: number): { weeks: number; label: string; shortLabel: string } | null {
  if (setsToNext <= 0) return null;
  
  // Use actual weekly sets, with a minimum of 1 set/week to avoid infinity
  const setsPerWeek = Math.max(1, weeklySets);
  const weeks = Math.ceil(setsToNext / setsPerWeek);
  
  let label: string;
  let shortLabel: string;
  
  if (weeks < 7) {
    label = `${weeks} week${weeks > 1 ? 's' : ''}`;
    shortLabel = `~${weeks}w`;
  } else if (weeks < 52) {
    const months = Math.ceil(weeks / 4.33);
    label = `${months} month${months > 1 ? 's' : ''}`;
    shortLabel = `~${months}m`;
  } else {
    const years = Math.round((weeks / 52) * 10) / 10;
    label = `${years} year${years > 1 ? 's' : ''}`;
    shortLabel = `~${years}y`;
  }
  
  return { weeks, label, shortLabel };
}

export const LifetimeAchievementCard: React.FC<LifetimeAchievementCardProps> = ({
  data,
  selectedMuscleId,
  onMuscleClick
}) => {
  const {
    contextPercent,
    contextTier,
    contextLabel,
    totalLifetimeSets,
    muscles,
  } = data;

  const { tooltip, showTooltip, hideTooltip } = useTooltip();

  const color = tierColor(contextTier.key);
  const isOverall = contextLabel === 'Overall';

  // Ensure selected muscle is visible: if expanded, show all; if collapsed, show top 5 
  // PLUS the selected muscle if it's not in top 5
  const visibleMuscles: MuscleAchievementEntry[] = useMemo(() => {
    if (!selectedMuscleId) return muscles;

    const selected = muscles.find(m => m.muscleId === selectedMuscleId);
    if (!selected) return muscles;
    return muscles;
  }, [muscles, selectedMuscleId]);

  return (
    <div className="bg-black/70 rounded-xl border border-slate-700/50 overflow-hidden h-full min-h-0 flex flex-col">
      {/* ── Header: Achievement ring + stats ────────────────────────── */}
      <div className="p-3 flex items-start gap-3 flex-shrink-0">
        <div className="relative flex-shrink-0">
          <ProgressRing percent={contextPercent} size={56} strokeWidth={5} color={color} />
          <div className="absolute inset-0 flex items-center justify-center">
            <span className="text-[13px] font-bold text-white">
              {Math.round(contextPercent)}%
            </span>
          </div>
        </div>

        <div className="min-w-0 flex-1">
          <div className="flex items-center gap-1.5">
            <span className="text-xs font-bold truncate text-white">
              {isOverall ? 'Lifetime Growth Potential' : contextLabel}
            </span>
          </div>

          <div className="flex items-center gap-1.5 mt-0.5">
            <span
              className={`inline-flex items-center gap-1 px-1.5 py-0.5 rounded text-[10px] font-bold ${contextTier.bgColor} ${contextTier.color}`}
            >
              <TierIcon tierKey={contextTier.key} />
              {contextTier.label}
            </span>
          </div>

          <p className="text-[10px] text-slate-500 mt-1 leading-tight">
            {contextTier.description}
          </p>
          
          <p className="text-[10px] text-slate-500 mt-0.5">
            {Math.round(contextPercent)}% of lifetime gains achieved
            {isOverall && totalLifetimeSets > 0 && (
              <span className="text-slate-400"> · {formatNumber(Math.round(totalLifetimeSets))} sets</span>
            )}
          </p>
        </div>
      </div>

      {/* ── Per-muscle breakdown ─────────────────────────────────────── */}
      <div className="px-3 pb-3 flex-1 min-h-0 overflow-y-auto">
        <div className="space-y-2 pr-3">
          {visibleMuscles.map((m) => {
            const isSelected = m.muscleId === selectedMuscleId;
            const tierInfo = getSetsToNextTier(m.achievementPercent, m.lifetimeSets, m.params);
            const timeToNext = tierInfo ? getTimeToNextTier(tierInfo.setsToNext, m.weeklySets) : null;
            
            let progressText: string;
            if (tierInfo && timeToNext) {
              progressText = `~est. ${timeToNext.label} to ${tierInfo.nextTierLabel} tier, based on current ${m.weeklySets.toFixed(1)} sets/wk rate (~${formatNumber(tierInfo.setsToNext)} sets needed)`;
            } else if (tierInfo) {
              progressText = `${Math.round(m.achievementPercent)}% → ~${formatNumber(tierInfo.setsToNext)} sets to ${tierInfo.nextTierLabel} tier`;
            } else {
              progressText = `${Math.round(m.achievementPercent)}% (Max tier reached)`;
            }

            const tooltipBody = tierInfo && timeToNext
              ? `You're at ${Math.round(m.achievementPercent)}% of your ${m.name} growth potential, putting you in the ${m.tier.label.toLowerCase()} tier (${m.tier.description}). You're ${tierInfo.percentToNext}% away from ${tierInfo.nextTierLabel.toLowerCase()}, which means about ${formatNumber(tierInfo.setsToNext)} more sets at your current rate of ${m.weeklySets.toFixed(1)} sets/wk, roughly ${timeToNext.label} away.`
              : tierInfo
              ? `You're at ${Math.round(m.achievementPercent)}% of your ${m.name} growth potential, putting you in the ${m.tier.label.toLowerCase()} tier (${m.tier.description}). You need about ${formatNumber(tierInfo.setsToNext)} more sets to reach ${tierInfo.nextTierLabel.toLowerCase()}.`
              : `You're at ${Math.round(m.achievementPercent)}% of your ${m.name} growth potential, putting you in the ${m.tier.label.toLowerCase()} tier (${m.tier.description}). You've maxed out this muscle group, impressive!`;

            const handleMouseEnter = (e: React.MouseEvent) => {
              showTooltip(e, {
                title: m.name,
                body: tooltipBody,
                status: 'info',
              });
            };

            return (
              <div
                key={m.muscleId}
                className="flex items-center gap-1 rounded px-1 py-0.5 -mx-1 group relative lg:cursor-pointer"
                onClick={() => {
                  if (window.innerWidth >= 1024) {
                    onMuscleClick?.(m.muscleId);
                  }
                }}
                onMouseEnter={handleMouseEnter}
                onMouseLeave={hideTooltip}
              >
                <span
                  className={`text-[10px] w-[15%] lg:w-[10%] truncate flex-shrink-0 transition-opacity ${
                    isSelected ? 'font-semibold text-white' : 'text-slate-500'
                  }`}
                >
                  {m.name}
                </span>
                <div className="w-[45%] lg:w-[65%]">
                  <MicroBar percent={m.achievementPercent} color={tierColor(m.tier.key)} />
                </div>
                <span
                  className={`text-[10px] font-semibold w-[10%] lg:w-[10%] text-right flex-shrink-0 transition-opacity ${
                    isSelected ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {Math.round(m.achievementPercent)}%
                </span>
                <span
                  className={`text-[9px] flex items-center gap-1 w-[25%] lg:w-[10%] flex-shrink-0 ${m.tier.color}`}
                  title={m.tier.description}
                >
                  <span className="truncate">{m.tier.label}</span>
                  <TierIcon tierKey={m.tier.key} />
                </span>
                {timeToNext && (
                  <span className="text-[9px] text-slate-500 w-[5%] lg:w-[5%] flex-shrink-0">
                    {timeToNext.shortLabel}
                  </span>
                )}
              </div>
            );
          })}
        </div>
      </div>
      {tooltip && <Tooltip data={tooltip} />}
    </div>
  );
};
