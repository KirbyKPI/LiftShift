import React, { useMemo, useState, useEffect } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp, X } from 'lucide-react';
import { CHART_TOOLTIP_STYLE } from '../../../utils/ui/uiConstants';
import { getRechartsCategoricalTicks, formatAxisNumber, calculateYAxisDomain } from '../../../utils/chart/chartEnhancements';
import { QUICK_FILTER_LABELS, HEADLESS_MUSCLE_NAMES } from '../../../utils/muscle/mapping';
import type { WeeklySetsWindow } from '../../../utils/muscle/analytics';
import type { QuickFilterCategory } from '../hooks/useMuscleSelection';
import { getThemeMode } from '../../../utils/storage/localStorage';

interface CustomMuscleTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: string;
  getZone: (sets: number) => { label: string; full: string; color: string };
}

const CustomMuscleTooltip: React.FC<CustomMuscleTooltipProps> = ({ active, payload, label, getZone }) => {
  if (active && payload && payload.length) {
    const value = payload[0].value;
    const zone = getZone(value);
    
    return (
      <div
        className="p-3 rounded-lg shadow-2xl"
        style={{
          ...CHART_TOOLTIP_STYLE,
          borderStyle: 'solid',
          borderWidth: 1,
          boxShadow: '0 20px 50px -15px rgb(0 0 0 / 0.35)',
        }}
      >
        <p className="text-slate-400 text-xs mb-1 font-mono">{label}</p>
        <p className="text-xs text-slate-200">
          {formatAxisNumber(value)} sets/wk <span style={{ color: zone.color }}>· {zone.full}</span>
        </p>
      </div>
    );
  }
  return null;
};

interface MuscleAnalysisGraphPanelProps {
  selectedMuscle: string | null;
  activeQuickFilter: QuickFilterCategory | null;
  weeklySetsWindow: WeeklySetsWindow;
  weeklySetsSummary: number | null;
  volumeDelta: { direction: 'up' | 'down' | 'same'; formattedPercent: string } | null;
  trendData: Array<{ period: string; sets: number }>;
  windowedSelectionBreakdown: { totalSetsInWindow: number } | null;
  clearSelection: () => void;
}

const ZONE_CONFIG = {
  single: {
    mv: 6,
    mev: 10,
    mrv: 25,
  },
  all: {
    mv: 30,
    mev: 50,
    mrv: 80,
  }
};

const ZONE_LABELS = {
  belowMV: { short: 'Maintenance', full: 'Maintenance', color: '#64748b' },
  growth: { short: 'Growth', full: 'Growth', color: '#eab308' },
  optimal: { short: 'Maximizing', full: 'Maximizing', color: '#22c55e' },
  risk: { short: 'Specialization / Risk', full: 'Specialization / Risk', color: '#ef4444' },
};

export const MuscleAnalysisGraphPanel: React.FC<MuscleAnalysisGraphPanelProps> = React.memo(({
  selectedMuscle,
  activeQuickFilter,
  weeklySetsWindow,
  weeklySetsSummary,
  volumeDelta,
  trendData,
  windowedSelectionBreakdown,
  clearSelection,
}) => {
  const [isDarkMode, setIsDarkMode] = useState(() => {
    const mode = getThemeMode();
    return mode !== 'light';
  });

  useEffect(() => {
    const handleStorageChange = () => {
      const mode = getThemeMode();
      setIsDarkMode(mode !== 'light');
    };
    
    window.addEventListener('storage', handleStorageChange);
    return () => window.removeEventListener('storage', handleStorageChange);
  }, []);

  const title = activeQuickFilter
    ? QUICK_FILTER_LABELS[activeQuickFilter]
    : selectedMuscle
      ? ((HEADLESS_MUSCLE_NAMES as any)[selectedMuscle] ?? selectedMuscle)
      : 'All Muscles';

  const totalSetsInWindow = windowedSelectionBreakdown?.totalSetsInWindow ?? 0;
  const isAllMuscles = !selectedMuscle && !activeQuickFilter;
  const zones = isAllMuscles ? ZONE_CONFIG.all : ZONE_CONFIG.single;

  const xTicks = useMemo(() => {
    return getRechartsCategoricalTicks(trendData, (row: any) => row?.period);
  }, [trendData]);

  const displayData = useMemo(() => {
    if (!xTicks || xTicks.length === 0) return trendData;
    const tickSet = new Set(xTicks);
    return trendData.filter((row: any) => tickSet.has(row.period));
  }, [trendData, xTicks]);

  const yAxisDomain = useMemo(() => {
    const domain = calculateYAxisDomain(trendData, ['sets'], { paddingPercent: 0.1, fallbackMin: 0, fallbackMax: isAllMuscles ? 100 : 25 });
    return [0, Math.max(domain[1], isAllMuscles ? 100 : 25)] as [number, number];
  }, [trendData, isAllMuscles]);

  const getZone = (sets: number) => {
    if (sets < zones.mv) return ZONE_LABELS.belowMV;
    if (sets < zones.mev) return ZONE_LABELS.growth;
    if (sets < zones.mrv) return ZONE_LABELS.optimal;
    return ZONE_LABELS.risk;
  };

  const currentZone = weeklySetsSummary !== null ? getZone(weeklySetsSummary) : null;

  const gradientStops = useMemo(() => {
    if (!displayData.length) return [];
    
    const thresholds = [zones.mv, zones.mev, zones.mrv];
    const n = displayData.length;
    const stops: Array<{ offset: number; color: string }> = [];
    
    // Helper to get zone color
    const getZoneColor = (sets: number) => {
      if (sets < zones.mv) return ZONE_LABELS.belowMV.color;
      if (sets < zones.mev) return ZONE_LABELS.growth.color;
      if (sets < zones.mrv) return ZONE_LABELS.optimal.color;
      return ZONE_LABELS.risk.color;
    };
    
    // Add initial stop
    stops.push({ offset: 0, color: getZoneColor(displayData[0].sets) });
    
    for (let i = 0; i < n - 1; i++) {
      const y1 = displayData[i].sets;
      const y2 = displayData[i + 1].sets;
      const startOffset = i / (n - 1);
      const endOffset = (i + 1) / (n - 1);
      
      // Find where the line crosses each threshold
      const crossings: Array<{ offset: number; color: string }> = [];
      
      for (const thr of thresholds) {
        const minY = Math.min(y1, y2);
        const maxY = Math.max(y1, y2);
        
        if (minY < thr && maxY > thr) {
          // Line crosses this threshold - calculate exact x position
          const ratio = Math.abs(thr - y1) / Math.abs(y2 - y1);
          const offset = startOffset + ratio * (endOffset - startOffset);
          // Determine which zone we're entering
          const enteringZoneColor = y2 > y1 
            ? getZoneColor(thr + 0.001) // Going up
            : getZoneColor(thr - 0.001); // Going down
          crossings.push({ offset, color: enteringZoneColor });
        }
      }
      
      // Sort by position and add stops
      crossings.sort((a, b) => a.offset - b.offset);
      for (const crossing of crossings) {
        // Add two stops at the crossing point for clean color transition
        stops.push({ offset: crossing.offset, color: crossing.color });
        stops.push({ offset: crossing.offset, color: crossing.color });
      }
      
      // Add stop at the end of this segment
      stops.push({ offset: endOffset, color: getZoneColor(y2) });
    }
    
    return stops;
  }, [displayData, zones]);

  return (
    <div id="all-muscles-graph" className="bg-black/70 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col h-full min-h-0">
      <div className="bg-black/70 p-3 flex items-center justify-between flex-shrink-0">
        <div className="flex items-center gap-3 min-w-0 flex-wrap">
          <h2 className="text-sm font-bold text-white truncate">{title}</h2>
          {currentZone && (
            <span 
              className="inline-flex items-center px-2 py-0.5 rounded text-[10px] font-semibold"
              style={{ backgroundColor: `${currentZone.color}20`, color: currentZone.color }}
            >
              {currentZone.full}
            </span>
          )}
        </div>
        <div className="flex items-center gap-2">
          {(selectedMuscle || activeQuickFilter) && (
            <button onClick={clearSelection} className="p-1 hover:bg-black/60 rounded-lg transition-colors">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      </div>

      <div className="flex items-center justify-between px-3 pb-2 text-[10px]">
        <div className="flex items-center gap-1">
          <span className="text-slate-400 font-medium">Total:</span>
          <span className="text-white font-semibold">{Math.round(totalSetsInWindow)} sets</span>
        </div>
        <div className="flex items-center gap-1">
          <span className="text-slate-400 font-medium">Avg:</span>
          <span className="text-blue-400 font-semibold">{weeklySetsSummary?.toFixed(1) || '0'}/wk</span>
        </div>
        {volumeDelta && volumeDelta.direction !== 'same' && (
          <span className={`inline-flex items-center gap-0.5 px-1.5 py-0.5 rounded text-[9px] font-bold ${volumeDelta.direction === 'up' ? 'bg-emerald-500/10 text-emerald-400' : 'bg-rose-500/10 text-rose-400'}`}>
            {volumeDelta.direction === 'up' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
            {volumeDelta.formattedPercent} vs {weeklySetsWindow === '7d' ? 'wk' : weeklySetsWindow === '30d' ? 'mo' : 'yr'}
          </span>
        )}
      </div>

     <div className="flex justify-center px-12 pb-2">
  <div className="flex items-center gap-6 text-[9px] pt-1">
    
    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-sm bg-slate-500"></span>
        <span className="text-slate-400">&lt;{zones.mv}</span>
      </div>
      <span className="text-slate-500">Maintenance</span>
    </div>

    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-sm bg-yellow-500"></span>
        <span className="text-slate-400">{zones.mv}-{zones.mev}</span>
      </div>
      <span className="text-slate-500">Growth</span>
    </div>

    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-sm bg-green-500"></span>
        <span className="text-slate-400">{zones.mev}-{zones.mrv}</span>
      </div>
      <span className="text-slate-500">Maximizing</span>
    </div>

    <div className="flex flex-col">
      <div className="flex items-center gap-1">
        <span className="w-2 h-2 rounded-sm bg-red-500"></span>
        <span className="text-slate-400">&gt;{zones.mrv}</span>
      </div>
      <span className="text-slate-500">Specialization / Risk</span>
    </div>

  </div>
</div>


      <div className="flex-1 min-h-0 px-2 pb-3">
        {trendData.length > 0 ? (
          <div className="h-[180px] sm:h-full">
            <ResponsiveContainer width="100%" height="100%">
            <AreaChart data={displayData} margin={{ top: 10, right: 20, left: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="zoneGradient" x1="0" y1="0" x2="1" y2="0">
                  {gradientStops.map((stop, idx) => (
                    <stop key={idx} offset={`${stop.offset * 100}%`} stopColor={stop.color} stopOpacity={isDarkMode ? 0.2 : 0.5} />
                  ))}
                </linearGradient>
              </defs>
              <XAxis
                dataKey="period"
                tick={{ fill: '#64748b', fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
                interval={0}
                ticks={xTicks as any}
              />
              <YAxis
                stroke="#94a3b8"
                fontSize={9}
                tickLine={false}
                axisLine={false}
                domain={yAxisDomain}
                tickFormatter={(val) => formatAxisNumber(Number(val))}
                width={30}
              />
              <RechartsTooltip
                content={<CustomMuscleTooltip getZone={getZone} />}
              />
              <Area
                type="monotone"
                dataKey="sets"
                stroke="#94a3b8"
                strokeWidth={2}
                fill="url(#zoneGradient)"
              />
            </AreaChart>
            </ResponsiveContainer>
          </div>
        ) : (
          <div className="flex items-center justify-center h-full min-h-[180px] text-slate-500 text-xs">
            No data available
          </div>
        )}
      </div>
    </div>
  );
});

MuscleAnalysisGraphPanel.displayName = 'MuscleAnalysisGraphPanel';
