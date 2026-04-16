import React, { useMemo } from 'react';
import { Area, AreaChart, ResponsiveContainer, Tooltip as RechartsTooltip, XAxis, YAxis } from 'recharts';
import { TrendingDown, TrendingUp, X, Triangle } from 'lucide-react';
import { CHART_TOOLTIP_STYLE } from '../../../utils/ui/uiConstants';
import { getRechartsCategoricalTicks, formatAxisNumber, calculateYAxisDomain } from '../../../utils/chart/chartEnhancements';
import { HEADLESS_MUSCLE_NAMES } from '../../../utils/muscle/mapping';
import type { WeeklySetsWindow } from '../../../utils/muscle/analytics';
import { getVolumeZoneColor, getVolumeZone } from '../../../utils/muscle/hypertrophy/muscleParams';
import { weeklyStimulusFromThresholds } from '../../../utils/muscle/hypertrophy/hypertrophyCalculations';
import { useIsMobile } from '../../insights/useIsMobile';

const usePillSizing = (count: number) => useMemo(() => 
  Array.from({ length: count }).map(() => {
    const flexGrow = Math.floor(Math.random() * 3) + 1;
    return {
      flexGrow,
      marginLeft: flexGrow > 1 ? '1px' : '2px',
    };
  }),
  [count]
);

interface CustomMuscleTooltipProps {
  active?: boolean;
  payload?: any[];
  label?: any;
  volumeThresholds: { mv: number; mev: number; mrv: number; maxv: number };
}

const CustomMuscleTooltip: React.FC<CustomMuscleTooltipProps> = ({ active, payload, label, volumeThresholds }) => {
  if (active && payload && payload.length) {
    const value = payload[0].value;
    const zone = getVolumeZone(value, volumeThresholds);
    const stimulus = calculateStimulusPercent(value, volumeThresholds);

    const ts = payload?.[0]?.payload?.timestamp;
    const labelText = Number.isFinite(ts)
      ? new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric', year: '2-digit' })
      : (typeof label === 'string' ? label : String(label ?? ''));
     
    return (
      <div
        className="p-3 rounded-lg shadow-2xl max-w-[220px]"
        style={{
          ...CHART_TOOLTIP_STYLE,
          borderStyle: 'solid',
          borderWidth: 1,
          boxShadow: '0 20px 50px -15px rgb(0 0 0 / 0.35)',
        }}
      >
        <p className="text-slate-400 text-xs mb-1 font-mono">{labelText}</p>
        <p className="text-xs text-slate-200 mb-1">
          {formatAxisNumber(value)} sets/wk
        </p>
        <p className="text-[10px] mb-2 text-white">
          {stimulus}% of wkly possible gains
        </p>
        <div className="text-[10px] text-slate-400 leading-relaxed">
          {zone.explanation}
        </div>
      </div>
    );
  }
  return null;
};

interface MuscleAnalysisGraphPanelProps {
  selectedMuscle: string | null;
  weeklySetsWindow: WeeklySetsWindow;
  weeklySetsSummary: number | null;
  legendMaxSets: number;
  volumeThresholds: { mv: number; mev: number; mrv: number; maxv: number };
  volumeDelta: { direction: 'up' | 'down' | 'same'; formattedPercent: string } | null;
  trendData: Array<{ period: string; timestamp: number; sets: number }>;
  legendTrendData: Array<{ period: string; timestamp: number; sets: number }>;
  windowedSelectionBreakdown: { totalSetsInWindow: number } | null;
  clearSelection: () => void;
}

const LEGEND_MAX_DISPLAY = 41; // Set a reasonable max for legend display - can be adjusted based on typical max volumes

// Zone labels now imported from shared utility in muscleParams.ts

/** Progress bar for weekly possible gains */
const PossibleGainsBar: React.FC<{ percent: number; thresholds: { mv: number; mev: number; mrv: number; maxv: number }; legendMax: number }> = ({ percent, thresholds, legendMax }) => {
  const isMobile = useIsMobile(768);
  const TOTAL_PILLS = isMobile ? 25 : 50;
  const pillData = usePillSizing(TOTAL_PILLS);
  const totalFlex = pillData.reduce((sum, p) => sum + p.flexGrow, 0);
  const filledFlex = (percent / 100) * totalFlex;
  
  let accumulatedFlex = 0;
  
  return (
    <div className="relative flex items-center text-[9px]">
      {Array.from({ length: TOTAL_PILLS }).map((_, idx) => {
        const position = (idx / (TOTAL_PILLS - 1)) * legendMax;
        // Use maxv for color calculation to keep colors in green spectrum
        // Don't extend color range beyond maxv even if legendMax is larger
        const color = getVolumeZoneColor(position, thresholds, thresholds.maxv);
        const { flexGrow, marginLeft } = pillData[idx];
        
        const pillStart = accumulatedFlex;
        const pillEnd = accumulatedFlex + flexGrow;
        const fillPercent = Math.max(0, Math.min(100, ((filledFlex - pillStart) / flexGrow) * 100));
        accumulatedFlex += flexGrow;
        
        return (
          <div
            key={idx}
            className="h-4 rounded-sm relative overflow-hidden transition-all duration-300"
            style={{
              flexGrow,
              marginLeft: idx === 0 ? 0 : marginLeft,
              backgroundColor: 'rgba(100, 100, 100, 0.15)',
            }}
          >
            {fillPercent > 0 && (
              <div
                className="absolute top-0 left-0 h-full rounded-sm"
                style={{
                  width: `${fillPercent}%`,
                  backgroundColor: color,
                }}
              />
            )}
          </div>
        );
      })}
      <span 
        className="absolute inset-0 flex items-center justify-center text-[8px] font-bold"
        style={{ color: '#fff', textShadow: '0 0 1px #000, 0 0 1px #000, 0 0 1px #000' }}
      >
        {percent}% possible gains
      </span>
    </div>
  );
};

// Calculate percentage of weekly possible gains
const calculateStimulusPercent = (
  sets: number,
  thresholds: { mv: number; mev: number; mrv: number; maxv: number }
): number => weeklyStimulusFromThresholds(sets, thresholds);

// Use shared getVolumeZone from muscleParams for single source of truth

// Get color based on sets using shared function
function getZoneColor(sets: number, thresholds: { mv: number; mev: number; mrv: number; maxv: number }, maxSets?: number): string {
  const zones = thresholds;
  const effectiveSets = sets;
  return getVolumeZoneColor(effectiveSets, zones, maxSets);
}

export const MuscleAnalysisGraphPanel: React.FC<MuscleAnalysisGraphPanelProps> = React.memo(({
  selectedMuscle,
  weeklySetsWindow,
  weeklySetsSummary,
  legendMaxSets,
  volumeThresholds,
  volumeDelta,
  trendData,
  legendTrendData,
  windowedSelectionBreakdown,
  clearSelection,
}) => {
  const title = selectedMuscle
    ? ((HEADLESS_MUSCLE_NAMES as any)[selectedMuscle] ?? selectedMuscle)
    : 'All Muscles';

  const totalSetsInWindow = windowedSelectionBreakdown?.totalSetsInWindow ?? 0;
  const zones = { 
    ...volumeThresholds,
    maxDisplay: LEGEND_MAX_DISPLAY 
  };

  const xTicks = useMemo(() => {
    return getRechartsCategoricalTicks(trendData, (row: any) => row?.timestamp);
  }, [trendData]);

  const displayData = useMemo(() => {
    // getRechartsCategoricalTicks() returns undefined when no downsampling is needed.
    if (!xTicks) return trendData;
    if (xTicks.length === 0) return [];
    const tickSet = new Set(xTicks.map((t) => Number(t)).filter((t) => Number.isFinite(t)));
    return trendData.filter((row: any) => tickSet.has(Number(row.timestamp)));
  }, [trendData, xTicks]);

  const yAxisDomain = useMemo(() => {
    const maxFromData = Math.max(...trendData.map(d => d.sets), weeklySetsSummary ?? 0, 10);
    const domain = calculateYAxisDomain(trendData, ['sets'], { paddingPercent: 0.1, fallbackMin: 0, fallbackMax: maxFromData });
    return [0, Math.max(domain[1], 10)] as [number, number];
  }, [trendData, weeklySetsSummary]);

  const currentZone = weeklySetsSummary !== null ? getVolumeZone(weeklySetsSummary, volumeThresholds) : null;
  const currentColor = weeklySetsSummary !== null ? getZoneColor(weeklySetsSummary, volumeThresholds) : null;
  
  // Calculate weekly possible gains (stimulus percentage)
  const stimulusPercent = weeklySetsSummary !== null
    ? weeklyStimulusFromThresholds(weeklySetsSummary, volumeThresholds)
    : null;

  // Legend is ALWAYS based on FILTER (not selected muscle) - use maxSets from headlessRatesMap
  const showOverdrive = legendMaxSets > zones.maxv;
  
  // Legend always scales to filter data max
  const legendMax = Math.max(legendMaxSets, zones.maxv);

  // Arrow shows the selected muscle's value
  const arrowValue = weeklySetsSummary ?? 0;
  
  // Calculate arrow position on legend
  const arrowPosition = useMemo(() => {
    if (arrowValue === 0) return null;
    const percent = Math.min(100, Math.max(0, (arrowValue / legendMax) * 100));
    return percent;
  }, [arrowValue, legendMax]);

  const gradientStops = useMemo(() => {
    if (!displayData.length) return [];
     
    const n = displayData.length;
    const stops: Array<{ offset: number; color: string }> = [];
     
    // Add initial stop
    stops.push({ offset: 0, color: getZoneColor(displayData[0].sets, volumeThresholds, legendMax) });
     
    for (let i = 0; i < n - 1; i++) {
      const y2 = displayData[i + 1].sets;
      const endOffset = (i + 1) / (n - 1);
      
      // Add stop at the end of this segment with interpolated color
      stops.push({ offset: endOffset, color: getZoneColor(y2, volumeThresholds, legendMax) });
    }
     
    return stops;
  }, [displayData, legendMax, volumeThresholds]);

  const legendColors = useMemo(() => {
    const atMv = getVolumeZoneColor(zones.mv, zones, legendMax);
    const atMev = getVolumeZoneColor(zones.mev, zones, legendMax);
    const atMrv = getVolumeZoneColor(zones.mrv, zones, legendMax);
    const atMaxv = getVolumeZoneColor(zones.maxv, zones, legendMax);
    const atMaxvPlus10 = getVolumeZoneColor(zones.maxv + 10, zones, legendMax);
    const atMaxDisplay = getVolumeZoneColor(legendMax, zones, legendMax);
    
    const getContrastColor = (bgColor: string) => {
      const hex = bgColor.replace('#', '');
      const r = parseInt(hex.slice(0, 2), 16);
      const g = parseInt(hex.slice(2, 4), 16);
      const b = parseInt(hex.slice(4, 6), 16);
      const luminance = (0.299 * r + 0.587 * g + 0.114 * b) / 255;
      return luminance > 0.5 ? '#1e293b' : '#f8fafc';
    };
    
    return {
      atMv,
      atMev,
      atMrv,
      atMaxv,
      atMaxvPlus10,
      atMaxDisplay,
      showOverdrive,
      textAtMv: getContrastColor(atMv),
      textAtMev: getContrastColor(atMev),
      textAtMrv: getContrastColor(atMrv),
      textAtMaxv: getContrastColor(atMaxv),
      textAtMaxDisplay: getContrastColor(atMaxvPlus10),
    };
  }, [zones, legendMax, showOverdrive]);

  const isMobileLegend = useIsMobile(768);
  const TOTAL_PILLS = isMobileLegend ? 25 : 50;
  const legendPillSizing = usePillSizing(TOTAL_PILLS);

  const pillData = useMemo(() => {
    const pills: Array<{ filledColor: string; flexGrow: number; marginLeft: string; fillPercent: number }> = [];
    const totalFlex = legendPillSizing.reduce((sum, p) => sum + p.flexGrow, 0);
    const filledFlex = arrowPosition !== null ? (arrowPosition / 100) * totalFlex : -1;
    
    let accumulatedFlex = 0;
    
    for (let i = 0; i < TOTAL_PILLS; i++) {
      const position = (i / (TOTAL_PILLS - 1)) * legendMax;
      const color = getVolumeZoneColor(position, zones, legendMax);
      const { flexGrow, marginLeft } = legendPillSizing[i];
      
      const pillStart = accumulatedFlex;
      const pillEnd = accumulatedFlex + flexGrow;
      let fillPercent = 100;
      
      if (filledFlex >= 0) {
        if (pillStart >= filledFlex) {
          fillPercent = 0;
        } else if (pillEnd > filledFlex) {
          fillPercent = ((filledFlex - pillStart) / flexGrow) * 100;
        }
      }
      
      accumulatedFlex += flexGrow;
      
      pills.push({ 
        filledColor: color,
        flexGrow,
        marginLeft: i === 0 ? '0' : marginLeft,
        fillPercent,
      });
    }
    
    return pills;
  }, [legendMax, zones, arrowPosition, legendPillSizing, TOTAL_PILLS]);

  return (
    <div id="all-muscles-graph" className="bg-black/70 rounded-xl border border-slate-700/50 overflow-hidden flex flex-col h-full min-h-0">
      <div className="bg-black/70 p-3 flex items-center justify-between flex-shrink-0 gap-2">
        <div className="flex items-center gap-2 min-w-0">
          <h2 className="text-sm font-bold text-white truncate">{title}</h2>
          <span className="text-[10px] text-slate-400 whitespace-nowrap">
             {volumeDelta && volumeDelta.direction !== 'same' && (
                  <span className={`flex items-center gap-0.5 ${volumeDelta.direction === 'up' ? 'text-emerald-400' : 'text-rose-400'}`}>
                    {volumeDelta.direction === 'up' ? <TrendingUp className="w-2.5 h-2.5" /> : <TrendingDown className="w-2.5 h-2.5" />}
                    {volumeDelta.formattedPercent} vs {weeklySetsWindow === '7d' ? 'prv wk' : weeklySetsWindow === '30d' ? 'prv mo' : 'prv yr'}
                  </span>
                )}
          </span>
        </div>
        <div className="flex items-center gap-2">
          {selectedMuscle && (
            <button onClick={clearSelection} className="p-1 hover:bg-black/60 rounded-lg transition-colors cursor-pointer">
              <X className="w-4 h-4 text-slate-400" />
            </button>
          )}
        </div>
      </div>

     

      {/* Legend with gradient bar and arrow pointer */}
      <div className="flex flex-col items-center px-4 pb-2">
        <div className="relative w-full max-w-md">
          {/* Arrow with info tooltip */}
          {arrowPosition !== null && (
            <div 
              className="absolute -top-2 transform -translate-x-1/2 transition-all duration-300 z-10 flex flex-col items-center"
              style={{ left: `${arrowPosition}%` }}
            >
              <div className="flex items-center gap-1  rounded px-2 py-1 text-[9px] whitespace-nowrap">
                <span className="text-white font-semibold">avg {arrowValue.toFixed(1)} sets/wk</span>
               
              </div>
              <Triangle 
                className="w-3 h-3 fill-white text-white -mt-1" 
                style={{ transform: 'rotate(180deg)' }}
              />
            </div>
          )}
          
          {/* Pill-style volume zone visualization */}
          <div className="relative flex items-center text-[9px] pt-6">
            {pillData.map((pill, idx) => (
              <div
                key={idx}
                className="h-4 rounded-sm relative overflow-hidden"
                style={{
                  flexGrow: pill.flexGrow,
                  marginLeft: pill.marginLeft,
                  backgroundColor: 'rgba(100, 100, 100, 0.15)',
                }}
              >
                {pill.fillPercent > 0 && (
                  <div
                    className="absolute top-0 left-0 h-full rounded-sm"
                    style={{
                      width: `${pill.fillPercent}%`,
                      backgroundColor: pill.filledColor,
                    }}
                  />
                )}
              </div>
            ))}
          </div>
        </div>
        
        {stimulusPercent !== null && (
          <div className="relative w-full max-w-md mt-2">
            <PossibleGainsBar percent={stimulusPercent} thresholds={volumeThresholds} legendMax={legendMax} />
          </div>
        )}
      </div>

      <div className="flex-1 min-h-0 px-2 pb-3">
        {trendData.length > 0 ? (
          <div className="h-[180px] sm:h-full">
            <ResponsiveContainer width="100%" height="100%">
              <AreaChart data={displayData} margin={{ top: 10, right: 20, left: 5, bottom: 0 }}>
              <defs>
                <linearGradient id="zoneGradient" x1="0" y1="0" x2="1" y2="0">
                  {gradientStops.map((stop, idx) => (
                    <stop key={idx} offset={`${stop.offset * 100}%`} stopColor={stop.color} stopOpacity={1} />
                  ))}
                </linearGradient>
                <linearGradient id="zoneAreaTopFadeMask" x1="0" y1="0" x2="0" y2="1">
                    <stop offset="0%" stopColor="#ffffff" stopOpacity={1} />
                    <stop offset="40%" stopColor="#ffffff" stopOpacity={0.6} />
                    <stop offset="60%" stopColor="#ffffff" stopOpacity={0.4} />
                    <stop offset="80%" stopColor="#ffffff" stopOpacity={0.2} />
                    <stop offset="100%" stopColor="#ffffff" stopOpacity={0} />
                </linearGradient>
                <mask id="zoneAreaTopFadeMaskDef" maskUnits="objectBoundingBox" maskContentUnits="objectBoundingBox">
                  <rect x="0" y="0" width="1" height="1" fill="url(#zoneAreaTopFadeMask)" />
                </mask>
              </defs>
              <XAxis
                dataKey="timestamp"
                type="number"
                scale="time"
                domain={['dataMin', 'dataMax'] as any}
                tick={{ fill: '#64748b', fontSize: 9 }}
                tickLine={false}
                axisLine={{ stroke: '#334155' }}
                interval={0}
                ticks={xTicks as any}
                tickFormatter={(value) => {
                  const ts = Number(value);
                  if (!Number.isFinite(ts)) return '';
                  return new Date(ts).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
                }}
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
                content={<CustomMuscleTooltip volumeThresholds={volumeThresholds} />}
              />
              <Area
                type="monotone"
                dataKey="sets"
                stroke="none"
                fill="url(#zoneGradient)"
                mask="url(#zoneAreaTopFadeMaskDef)"
                isAnimationActive={false}
              />
              <Area
                type="monotone"
                dataKey="sets"
                stroke="#175c0f"
                strokeWidth={0.5}
                fill="none"
                isAnimationActive={false}
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
