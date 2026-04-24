/**
 * CoachClientDashboard
 * ────────────────────────────────────────────────────────────────────────────
 * Replaces the minimalist client-detail view (workout stats + recent list)
 * with the full LiftShift `<App>` dashboard — Muscle Analysis, History heatmap,
 * Flex view, Insights, Weekly Sets, Personal Records, Exercise Progress — all
 * seeded with the selected client's Hevy-synced workouts.
 *
 * Data flow:
 *   /api/hevy/sync  →  { sets: WorkoutSet[] }  (added alongside `rows`)
 *   CoachViewProvider seeds <App> with those sets, flips localStorage to a
 *   per-session in-memory shim so coach filter/pref tweaks don't persist
 *   to the client's record or the coach's own account.
 *
 * The coach still gets a slim header (back button, client name, Force Sync)
 * overlaid on top of the embedded dashboard.
 */

import React, { useEffect, useMemo, useState } from 'react'
import { HashRouter } from 'react-router'
import App from '../../App'
import { CoachViewProvider } from '../../app/coachView'
import { getSession } from '../../utils/supabase/auth'
import { supabase } from '../../utils/supabase/client'
import type { Coach, ClientWithConnection } from '../../utils/supabase/client'
import type { WorkoutSet } from '../../types'
import { CoachNotesPanel } from './CoachNotesPanel'
import { GenerateRecommendationPanel } from './GenerateRecommendationPanel'

type SyncSource = 'live' | 'cached' | 'stale_cache'

interface SyncResponse {
  rows: Array<unknown>
  sets?: WorkoutSet[]
  source?: SyncSource
  last_sync_at?: string | null
  workouts_fetched?: number
  warning?: string
  error?: string
}

interface CoachClientDashboardProps {
  clientId: string
  coach: Coach
  onBack: () => void
}

export function CoachClientDashboard({ clientId, coach, onBack }: CoachClientDashboardProps) {
  const [client, setClient] = useState<ClientWithConnection | null>(null)
  const [sets, setSets] = useState<WorkoutSet[] | null>(null)
  const [syncSource, setSyncSource] = useState<SyncSource | null>(null)
  const [lastSyncAt, setLastSyncAt] = useState<string | null>(null)
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [error, setError] = useState<string | null>(null)

  // Initial load: pull client info + first sync (server decides cached vs live).
  useEffect(() => {
    let cancelled = false

    ;(async () => {
      setLoading(true)
      setError(null)

      // Client row + connection
      const { data: c } = await supabase
        .from('training_clients')
        .select('*')
        .eq('id', clientId)
        .single()

      if (!c) {
        if (!cancelled) {
          setError('Client not found')
          setLoading(false)
        }
        return
      }

      const { data: conn } = await supabase
        .from('training_hevy_connections')
        .select('*')
        .eq('client_id', clientId)
        .single()

      if (cancelled) return
      setClient({ ...c, hevy_connection: conn || null })

      if (!conn || conn.connection_status === 'expired') {
        // No data pipeline yet — let the render branch handle it.
        setSets([])
        setLoading(false)
        return
      }

      await runSync(false, cancelled)
      if (!cancelled) setLoading(false)
    })()

    return () => {
      cancelled = true
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [clientId])

  const runSync = async (forceRefresh: boolean, cancelled = false) => {
    setSyncing(true)
    setError(null)
    try {
      const session = await getSession()
      const res = await fetch('/api/hevy/sync', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: clientId,
          coach_token: session?.access_token,
          force_refresh: forceRefresh,
        }),
      })
      const data = (await res.json()) as SyncResponse
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      if (cancelled) return
      setSets(data.sets ?? [])
      setSyncSource(data.source ?? null)
      setLastSyncAt(data.last_sync_at ?? null)
      if (data.warning) setError(data.warning)
    } catch (err: any) {
      if (!cancelled) setError(err.message || 'Sync failed')
    } finally {
      if (!cancelled) setSyncing(false)
    }
  }

  // Reconstruct Date instances that the wire format loses as ISO strings. The
  // /app pipeline fills parsedDate via `hydrateBackendWorkoutSetsWithSource`,
  // but sets fetched from /api/hevy/sync arrive without it.
  const seedSets = useMemo<WorkoutSet[]>(() => sets ?? [], [sets])

  // ─── Render states ──────────────────────────────────────────────────

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (!client) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center text-white">
        <div className="text-center">
          <p className="text-zinc-500 mb-4">{error || 'Client not found'}</p>
          <button onClick={onBack} className="text-lime-400 hover:text-lime-300">← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  const conn = client.hevy_connection

  if (!conn) {
    return (
      <NoConnectionShell clientName={client.name} onBack={onBack}>
        <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-6 text-center">
          <p className="text-zinc-400 mb-3">This client hasn't connected their Hevy account yet.</p>
          <p className="text-zinc-600 text-sm">Go back to the dashboard and use "Connect Hevy" on their card.</p>
        </div>
      </NoConnectionShell>
    )
  }

  if (conn.connection_status === 'expired') {
    return (
      <NoConnectionShell clientName={client.name} onBack={onBack}>
        <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4">
          <p className="text-red-400 text-sm">
            This client's Hevy API key has expired. They'll need to reconnect with a new key.
          </p>
        </div>
      </NoConnectionShell>
    )
  }

  // Empty sets but active connection — let the client know we're expecting
  // data once they log their first workout.
  if (seedSets.length === 0) {
    return (
      <NoConnectionShell clientName={client.name} onBack={onBack}>
        <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-6 text-center">
          <p className="text-zinc-400 mb-3">No workouts synced yet.</p>
          <button
            onClick={() => runSync(true)}
            disabled={syncing}
            className="px-4 py-2 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
          >
            {syncing ? 'Syncing…' : 'Force Sync'}
          </button>
          {error && <p className="text-red-400 text-sm mt-4">{error}</p>}
        </div>
      </NoConnectionShell>
    )
  }

  // ─── Main case: embed the full /app dashboard ───────────────────────
  // `key={clientId}` forces a fresh App tree per client so the internal
  // initial-state seeding re-runs on client switch.

  // Natural page scroll: header is sticky, notes + recommendation panels flow
  // as normal blocks above the embedded App. The App itself stays at a fixed
  // viewport height in its own block below — the coach scrolls past the
  // panels to reach it when needed. Previously a flex parent + App's
  // `h-[100dvh]` combined to make the page unscrollable when panels expanded.
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <div className="sticky top-0 z-20">
        <CoachHeader
          clientName={client.name}
          coachName={coach.display_name}
          syncSource={syncSource}
          lastSyncAt={lastSyncAt}
          syncing={syncing}
          onBack={onBack}
          onForceSync={() => runSync(true)}
        />
        {error && (
          <div className="px-6 py-2 border-b border-red-500/20 bg-red-500/95 backdrop-blur">
            <p className="text-red-400 text-sm max-w-6xl mx-auto">{error}</p>
          </div>
        )}
      </div>

      <CoachViewProvider
        clientId={clientId}
        clientName={client.name}
        seedSets={seedSets}
        syncSource={syncSource}
        lastSyncAt={lastSyncAt}
      >
        <CoachNotesPanel clientId={clientId} />
        <GenerateRecommendationPanel />

        {/* Divider — separates the coach workspace (notes, AI) from the
            embedded client dashboard below. The dashboard is the "client's
            view" — same experience they'd see in their own account. */}
        <div className="border-t border-zinc-800 bg-zinc-950/60">
          <div className="max-w-6xl mx-auto px-6 py-2 flex items-center gap-2">
            <span className="text-[11px] uppercase tracking-wide text-zinc-500">
              Client dashboard
            </span>
            <span className="text-zinc-700 text-xs">— scroll for full view</span>
          </div>
        </div>

        <div className="h-[100dvh]" key={clientId}>
          <HashRouter>
            <App />
          </HashRouter>
        </div>
      </CoachViewProvider>
    </div>
  )
}

// ─── Header shared across connection states ────────────────────────────────

function CoachHeader({
  clientName,
  coachName,
  syncSource,
  lastSyncAt,
  syncing,
  onBack,
  onForceSync,
}: {
  clientName: string
  coachName: string
  syncSource: SyncSource | null
  lastSyncAt: string | null
  syncing: boolean
  onBack: () => void
  onForceSync: () => void
}) {
  return (
    <header className="border-b border-zinc-800 px-6 py-3 bg-[#0a0a0a]/95 backdrop-blur">
      <div className="max-w-6xl mx-auto flex items-center gap-4">
        <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
          ← Back
        </button>
        <div className="flex-1 flex items-center gap-3 min-w-0">
          <h1 className="text-base font-semibold truncate">{clientName}</h1>
          {syncSource && <SyncBadge source={syncSource} />}
          {lastSyncAt && (
            <span className="text-zinc-600 text-xs hidden sm:inline">
              Synced {timeAgo(lastSyncAt)}
            </span>
          )}
        </div>
        <span className="text-zinc-600 text-xs hidden md:inline">Coach: {coachName}</span>
        <button
          onClick={onForceSync}
          disabled={syncing}
          className="px-3 py-1.5 bg-zinc-800 hover:bg-zinc-700 text-xs rounded-lg transition-colors disabled:opacity-50"
        >
          {syncing ? 'Syncing…' : 'Force Sync'}
        </button>
      </div>
    </header>
  )
}

function NoConnectionShell({
  clientName,
  onBack,
  children,
}: {
  clientName: string
  onBack: () => void
  children: React.ReactNode
}) {
  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      <header className="border-b border-zinc-800 px-6 py-3">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
            ← Back
          </button>
          <h1 className="text-base font-semibold truncate">{clientName}</h1>
        </div>
      </header>
      <main className="max-w-6xl mx-auto px-6 py-8">{children}</main>
    </div>
  )
}

function SyncBadge({ source }: { source: SyncSource }) {
  const classes =
    source === 'live'
      ? 'bg-lime-500/15 text-lime-400 border-lime-500/25'
      : source === 'cached'
        ? 'bg-blue-500/15 text-blue-400 border-blue-500/25'
        : 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
  const label =
    source === 'live' ? 'Live data' : source === 'cached' ? 'Cached' : 'Stale cache'
  return (
    <span className={`text-[10px] px-2 py-0.5 rounded-full border ${classes}`}>
      {label}
    </span>
  )
}

function timeAgo(dateStr: string): string {
  const t = new Date(dateStr).getTime()
  if (!Number.isFinite(t)) return ''
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}
