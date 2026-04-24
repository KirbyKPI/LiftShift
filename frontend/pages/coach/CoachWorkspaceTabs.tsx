/**
 * CoachWorkspaceTabs
 * ────────────────────────────────────────────────────────────────────────────
 * Compact, single-row tab bar that consolidates the three coach panels (Notes,
 * AI Recommendation, Saved Recommendations) into one strip. Click a tab to
 * open its content below; click the active tab again or the × to close.
 *
 * Trade-off vs. the previous "three stacked collapsibles":
 *   + One row of chrome instead of three when nothing's open (~⅓ the height).
 *   + Mutually exclusive — no accidental "Notes + AI both expanded" stacking.
 *   - Only one section visible at a time. The notes preview is shown inline
 *     in the toolbar so the most-scanned info stays visible regardless.
 */

import React, { useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase/client'
import { CoachNotesPanel, useCoachNotesPreview } from './CoachNotesPanel'
import { GenerateRecommendationPanel } from './GenerateRecommendationPanel'
import { SavedRecommendationsPanel } from './SavedRecommendationsPanel'

type Tab = 'notes' | 'ai' | 'saved'

interface CoachWorkspaceTabsProps {
  clientId: string
}

export function CoachWorkspaceTabs({ clientId }: CoachWorkspaceTabsProps) {
  const [active, setActive] = useState<Tab | null>(null)
  const [refreshKey, setRefreshKey] = useState(0)
  const [externalResult, setExternalResult] = useState<any>(null)
  // Lets the coach reclaim ~50px of viewport when they're working in the
  // dashboard below and don't need the workspace surfaces. Persists per
  // client in sessionStorage so it survives tab switches but doesn't leak
  // across browser sessions.
  const [minimized, setMinimized] = useState<boolean>(() => {
    try {
      return sessionStorage.getItem(`coachToolbarMin:${clientId}`) === '1'
    } catch {
      return false
    }
  })
  useEffect(() => {
    try {
      sessionStorage.setItem(`coachToolbarMin:${clientId}`, minimized ? '1' : '0')
    } catch {
      // sessionStorage may not be available; fall through silently.
    }
  }, [clientId, minimized])

  const notesPreview = useCoachNotesPreview(clientId)
  const savedCount = useSavedCount(clientId, refreshKey)

  const toggle = (tab: Tab) => {
    setActive((current) => (current === tab ? null : tab))
    // When the user clicks a tab, scroll it into view smoothly so the content
    // below the toolbar isn't pushed offscreen on a small viewport.
    requestAnimationFrame(() => {
      const el = document.getElementById('coach-workspace-content')
      if (el) el.scrollIntoView({ behavior: 'smooth', block: 'nearest' })
    })
  }

  const handleLoadSaved = (rec: {
    id: string
    summary: string
    items: any[]
    adjustment_level: string
    status: string
    coach_note: string | null
  }) => {
    setExternalResult({
      recommendation_id: rec.id,
      summary: rec.summary,
      items: rec.items,
      usage: { input_tokens: null, output_tokens: null },
      model: '(loaded from save)',
    })
    // Switch to the AI tab so the loaded result is visible.
    setActive('ai')
  }

  // Sticky beneath the coach header so the toolbar is always reachable,
  // even when working in the embedded dashboard far below.
  const toolbarSticky =
    'sticky top-[44px] z-10 border-b border-zinc-800 bg-zinc-950/95 backdrop-blur'

  // Minimized state — single tiny pill that expands to the full bar on click.
  if (minimized) {
    return (
      <div className={toolbarSticky}>
        <div className="max-w-6xl mx-auto px-6 py-1 flex items-center gap-2">
          <button
            onClick={() => setMinimized(false)}
            className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 rounded border border-zinc-800 hover:border-zinc-700"
            title="Show coach tools"
          >
            ▼ Coach tools
          </button>
          {savedCount != null && savedCount > 0 && (
            <span className="text-[10px] text-zinc-600">
              {savedCount} saved
            </span>
          )}
        </div>
      </div>
    )
  }

  return (
    <>
      {/* Toolbar — always visible, single row, sticky below the header */}
      <div className={toolbarSticky}>
        <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-2 flex-wrap">
          <TabChip
            label="Notes"
            sublabel={notesPreview || 'add context'}
            active={active === 'notes'}
            onClick={() => toggle('notes')}
          />
          <TabChip
            label="✨ AI"
            sublabel="generate routine"
            active={active === 'ai'}
            onClick={() => toggle('ai')}
          />
          <TabChip
            label="Saved"
            sublabel={
              savedCount === null
                ? '…'
                : savedCount === 0
                  ? 'none yet'
                  : `${savedCount} recommendation${savedCount === 1 ? '' : 's'}`
            }
            active={active === 'saved'}
            onClick={() => toggle('saved')}
          />
          <div className="ml-auto flex items-center gap-2">
            {active && (
              <button
                onClick={() => setActive(null)}
                className="text-zinc-500 hover:text-zinc-300 text-sm px-2 py-1 transition-colors"
                title="Close active section"
              >
                ✕ Close
              </button>
            )}
            <button
              onClick={() => {
                setActive(null)
                setMinimized(true)
              }}
              className="text-[11px] text-zinc-500 hover:text-zinc-300 transition-colors px-2 py-0.5 rounded border border-zinc-800 hover:border-zinc-700"
              title="Hide coach tools to see more dashboard"
            >
              ▲ Hide
            </button>
          </div>
        </div>
      </div>

      {/* Active panel content */}
      {active && (
        <div
          id="coach-workspace-content"
          className="border-b border-zinc-800 bg-zinc-950/40"
        >
          {active === 'notes' && (
            <CoachNotesPanel clientId={clientId} mode="embedded" />
          )}
          {active === 'ai' && (
            <GenerateRecommendationPanel
              mode="embedded"
              externalResult={externalResult}
              onNewResult={() => setRefreshKey((k) => k + 1)}
            />
          )}
          {active === 'saved' && (
            <SavedRecommendationsPanel
              clientId={clientId}
              mode="embedded"
              refreshKey={refreshKey}
              onLoad={handleLoadSaved}
            />
          )}
        </div>
      )}
    </>
  )
}

// ─── Bits ─────────────────────────────────────────────────────────────────

function TabChip({
  label,
  sublabel,
  active,
  onClick,
}: {
  label: string
  sublabel: string
  active: boolean
  onClick: () => void
}) {
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1.5 rounded-lg border text-left transition-colors ${
        active
          ? 'bg-lime-500/15 text-lime-400 border-lime-500/40'
          : 'bg-zinc-900/60 text-zinc-300 border-zinc-800 hover:border-zinc-700'
      }`}
    >
      <div className="text-xs font-semibold uppercase tracking-wide leading-tight">
        {label}
      </div>
      <div
        className={`text-[10px] truncate max-w-[200px] ${
          active ? 'text-lime-400/70' : 'text-zinc-500'
        }`}
      >
        {sublabel}
      </div>
    </button>
  )
}

/** Count of saved recommendations for this client. Re-fetches when the
 *  caller bumps refreshKey (e.g. after a new generate). */
function useSavedCount(clientId: string, refreshKey: number): number | null {
  const [count, setCount] = useState<number | null>(null)
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      const { count: c } = await supabase
        .from('training_coach_recommendations')
        .select('id', { count: 'exact', head: true })
        .eq('client_id', clientId)
      if (cancelled) return
      setCount(c ?? 0)
    })()
    return () => {
      cancelled = true
    }
  }, [clientId, refreshKey])
  return count
}
