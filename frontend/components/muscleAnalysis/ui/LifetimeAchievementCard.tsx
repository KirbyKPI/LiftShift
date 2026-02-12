import React, { useMemo } from 'react';
import { Sprout, GraduationCap, TrendingUp, Target, BadgeCheck, Medal, Gem, Crown, Zap } from 'lucide-react';
import type { LifetimeAchievementData } from '../hooks/useLifetimeAchievement';
import type { MuscleAchievementEntry } from '../../../utils/muscle/hypertrophy';
import { formatNumber } from '../../../utils/format/formatters';

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
        stroke="rgba(51, 65, 85, 0.45)"
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
    style={{ backgroundColor: 'rgba(51, 65, 85, 0.35)' }}
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
    <div className="bg-black/70 rounded-xl border border-slate-700/50 overflow-hidden h-full min-h-0">
      {/* ── Header: Achievement ring + stats ────────────────────────── */}
      <div className="p-3 flex items-start gap-3">
        <div className="relative flex-shrink-0">
          <ProgressRing percent={contextPercent} size={56} strokeWidth={4} color={color} />
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
      <div className="px-3 pb-3 h-full min-h-0">
        <div className="space-y-2 overflow-y-auto h-full min-h-0 max-h-[40vh] lg:max-h-none pr-3">
          {visibleMuscles.map((m) => {
            const isSelected = m.muscleId === selectedMuscleId;
            return (
              <div
                key={m.muscleId}
                className="flex items-center gap-2 cursor-pointer rounded px-1 py-0.5 -mx-1"
                onClick={() => onMuscleClick?.(m.muscleId)}
              >
                <span
                  className={`text-[10px] w-16 truncate flex-shrink-0 transition-opacity ${
                    isSelected ? 'font-semibold text-white' : 'text-slate-500'
                  }`}
                >
                  {m.name}
                </span>
                <div className="flex-1 min-w-0">
                  <MicroBar percent={m.achievementPercent} color={tierColor(m.tier.key)} />
                </div>
                <span
                  className={`text-[10px] font-semibold w-8 text-right flex-shrink-0 transition-opacity ${
                    isSelected ? 'text-white' : 'text-slate-500'
                  }`}
                >
                  {Math.round(m.achievementPercent)}%
                </span>
                <span
                  className={`text-[9px] flex items-center justify-end gap-1 w-24 flex-shrink-0 ${m.tier.color}`}
                  title={m.tier.description}
                >
                  <span>{m.tier.label}</span>
                  <TierIcon tierKey={m.tier.key} />
                </span>
              </div>
            );
          })}
        </div>
      </div>
    </div>
  );
};
