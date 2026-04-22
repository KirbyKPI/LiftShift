export { Page }

import React, { useState, useEffect, useCallback } from 'react'
import { getSession, getCoachProfile, signOut } from '../../utils/supabase/auth'
import { supabase } from '../../utils/supabase/client'
import type { Coach, TrainingClient, ClientWithConnection } from '../../utils/supabase/client'
import { navigate } from 'vike/client/router'

// ─── Sub-views ──────────────────────────────────────────────────────────────

type View = 'dashboard' | 'client-detail'

function Page() {
  const [coach, setCoach] = useState<Coach | null>(null)
  const [clients, setClients] = useState<ClientWithConnection[]>([])
  const [loading, setLoading] = useState(true)
  const [view, setView] = useState<View>('dashboard')
  const [selectedClientId, setSelectedClientId] = useState<string | null>(null)

  // ─── Auth guard ─────────────────────────────────────────────────────
  useEffect(() => {
    ;(async () => {
      const session = await getSession()
      if (!session) { navigate('/login'); return }
      const profile = await getCoachProfile()
      if (!profile) { navigate('/login'); return }
      setCoach(profile)
      setLoading(false)
    })()
  }, [])

  // ─── Load clients ───────────────────────────────────────────────────
  const loadClients = useCallback(async () => {
    if (!coach) return
    const { data: clientRows } = await supabase
      .from('training_clients')
      .select('*')
      .eq('coach_id', coach.id)
      .order('created_at', { ascending: false })

    if (!clientRows) { setClients([]); return }

    // Fetch connections for all clients
    const ids = clientRows.map(c => c.id)
    const { data: connections } = await supabase
      .from('training_hevy_connections')
      .select('*')
      .in('client_id', ids)

    // Fetch workout counts
    const { data: counts } = await supabase
      .from('training_workout_cache')
      .select('client_id')
      .in('client_id', ids)

    const countMap: Record<string, number> = {}
    counts?.forEach(r => { countMap[r.client_id] = (countMap[r.client_id] || 0) + 1 })

    const connMap = new Map((connections || []).map(c => [c.client_id, c]))
    setClients(clientRows.map(c => ({
      ...c,
      hevy_connection: connMap.get(c.id) || null,
      workout_count: countMap[c.id] || 0,
    })))
  }, [coach])

  useEffect(() => { loadClients() }, [loadClients])

  // ─── URL-based routing within /coach ────────────────────────────────
  useEffect(() => {
    const path = window.location.pathname
    const match = path.match(/^\/coach\/client\/([^/]+)/)
    if (match) {
      setSelectedClientId(match[1])
      setView('client-detail')
    }
  }, [])

  if (loading) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (view === 'client-detail' && selectedClientId) {
    return (
      <ClientDetailView
        clientId={selectedClientId}
        coach={coach!}
        onBack={() => { setView('dashboard'); setSelectedClientId(null); window.history.pushState({}, '', '/coach') }}
      />
    )
  }

  return (
    <DashboardView
      coach={coach!}
      clients={clients}
      onRefresh={loadClients}
      onSelectClient={(id) => {
        setSelectedClientId(id)
        setView('client-detail')
        window.history.pushState({}, '', `/coach/client/${id}`)
      }}
    />
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Dashboard View
// ═══════════════════════════════════════════════════════════════════════════

function DashboardView({ coach, clients, onRefresh, onSelectClient }: {
  coach: Coach
  clients: ClientWithConnection[]
  onRefresh: () => void
  onSelectClient: (id: string) => void
}) {
  const [showAddModal, setShowAddModal] = useState(false)
  const [showConnectModal, setShowConnectModal] = useState<string | null>(null)

  const handleSignOut = async () => {
    await signOut()
    navigate('/login')
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center justify-between">
          <div className="flex items-center gap-3">
            <div className="w-9 h-9 rounded-lg bg-lime-500/15 border border-lime-500/25 flex items-center justify-center">
              <span className="text-lime-400 font-bold text-sm">K</span>
            </div>
            <div>
              <div className="text-white font-semibold text-sm">KPIFit Training</div>
              <div className="text-zinc-500 text-xs">Coach Dashboard</div>
            </div>
          </div>
          <div className="flex items-center gap-4">
            <span className="text-zinc-500 text-sm">{coach.display_name}</span>
            <button onClick={handleSignOut} className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors">
              Sign Out
            </button>
          </div>
        </div>
      </header>

      {/* Main */}
      <main className="max-w-6xl mx-auto px-6 py-8">
        <div className="flex items-center justify-between mb-8">
          <div>
            <h1 className="text-2xl font-bold">Your Clients</h1>
            <p className="text-zinc-500 text-sm mt-1">{clients.length} client{clients.length !== 1 ? 's' : ''} connected</p>
          </div>
          <button
            onClick={() => setShowAddModal(true)}
            className="px-4 py-2 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors"
          >
            + Add Client
          </button>
        </div>

        {clients.length === 0 ? (
          <div className="text-center py-20 bg-zinc-900/40 rounded-2xl border border-zinc-800">
            <div className="text-4xl mb-4">👥</div>
            <h2 className="text-lg font-semibold mb-2">No clients yet</h2>
            <p className="text-zinc-500 text-sm mb-6">Add your first client to start tracking their workouts</p>
            <button
              onClick={() => setShowAddModal(true)}
              className="px-6 py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors"
            >
              Add Your First Client
            </button>
          </div>
        ) : (
          <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
            {clients.map(client => (
              <ClientCard
                key={client.id}
                client={client}
                onClick={() => onSelectClient(client.id)}
                onConnect={() => setShowConnectModal(client.id)}
              />
            ))}
          </div>
        )}
      </main>

      {/* Add Client Modal */}
      {showAddModal && (
        <AddClientModal
          coachId={coach.id}
          onClose={() => setShowAddModal(false)}
          onCreated={onRefresh}
        />
      )}

      {/* Connect Modal */}
      {showConnectModal && (
        <ConnectClientModal
          clientId={showConnectModal}
          coachId={coach.id}
          onClose={() => setShowConnectModal(null)}
          onConnected={onRefresh}
        />
      )}
    </div>
  )
}

// ─── Client Card ──────────────────────────────────────────────────────────

function ClientCard({ client, onClick, onConnect }: {
  client: ClientWithConnection
  onClick: () => void
  onConnect: () => void
}) {
  const conn = client.hevy_connection
  const statusColor = !conn ? 'zinc' : conn.connection_status === 'active' ? 'lime' : conn.connection_status === 'error' ? 'yellow' : 'red'
  const statusLabel = !conn ? 'Not connected' : conn.connection_status === 'active' ? 'Connected' : conn.connection_status === 'error' ? 'Sync error' : 'Key expired'

  const colors: Record<string, string> = {
    zinc: 'bg-zinc-500/15 text-zinc-400 border-zinc-500/25',
    lime: 'bg-lime-500/15 text-lime-400 border-lime-500/25',
    yellow: 'bg-yellow-500/15 text-yellow-400 border-yellow-500/25',
    red: 'bg-red-500/15 text-red-400 border-red-500/25',
  }

  return (
    <div
      className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-5 hover:border-zinc-700 transition-colors cursor-pointer"
      onClick={onClick}
    >
      <div className="flex items-start justify-between mb-3">
        <div>
          <h3 className="font-semibold text-white">{client.name}</h3>
          {client.email && <p className="text-zinc-500 text-xs mt-0.5">{client.email}</p>}
        </div>
        <span className={`text-xs px-2 py-0.5 rounded-full border ${colors[statusColor]}`}>
          {statusLabel}
        </span>
      </div>

      {conn && conn.connection_status === 'active' ? (
        <div className="flex items-center gap-4 text-sm text-zinc-400">
          <span>{client.workout_count || 0} workouts</span>
          {conn.last_sync_at && (
            <span className="text-zinc-600">Synced {timeAgo(conn.last_sync_at)}</span>
          )}
        </div>
      ) : (
        <button
          onClick={(e) => { e.stopPropagation(); onConnect() }}
          className="text-sm text-lime-400 hover:text-lime-300 transition-colors mt-1"
        >
          Connect Hevy →
        </button>
      )}
    </div>
  )
}

// ─── Add Client Modal ─────────────────────────────────────────────────────

function AddClientModal({ coachId, onClose, onCreated }: {
  coachId: string
  onClose: () => void
  onCreated: () => void
}) {
  const [name, setName] = useState('')
  const [email, setEmail] = useState('')
  const [saving, setSaving] = useState(false)
  const [error, setError] = useState('')

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!name.trim()) { setError('Name is required'); return }
    setSaving(true)
    const { error: err } = await supabase
      .from('training_clients')
      .insert({ coach_id: coachId, name: name.trim(), email: email.trim() || null })

    if (err) { setError(err.message); setSaving(false); return }
    onCreated()
    onClose()
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 w-full max-w-md" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-white mb-4">Add New Client</h2>
        <form onSubmit={handleSubmit} className="space-y-4">
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Client Name</label>
            <input
              type="text"
              value={name}
              onChange={e => setName(e.target.value)}
              placeholder="John Smith"
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
              autoFocus
            />
          </div>
          <div>
            <label className="block text-zinc-400 text-xs font-medium mb-1.5">Email (optional)</label>
            <input
              type="email"
              value={email}
              onChange={e => setEmail(e.target.value)}
              placeholder="john@example.com"
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
            />
          </div>
          {error && <p className="text-red-400 text-sm">{error}</p>}
          <div className="flex gap-3 pt-2">
            <button type="button" onClick={onClose} className="flex-1 py-2.5 bg-zinc-800 text-zinc-300 text-sm rounded-lg hover:bg-zinc-700 transition-colors">
              Cancel
            </button>
            <button type="submit" disabled={saving} className="flex-1 py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50">
              {saving ? 'Adding...' : 'Add Client'}
            </button>
          </div>
        </form>
      </div>
    </div>
  )
}

// ─── Connect Client Modal ─────────────────────────────────────────────────

function ConnectClientModal({ clientId, coachId, onClose, onConnected }: {
  clientId: string
  coachId: string
  onClose: () => void
  onConnected: () => void
}) {
  const [tab, setTab] = useState<'link' | 'manual'>('link')
  const [code, setCode] = useState('')
  const [codeLoading, setCodeLoading] = useState(false)
  const [apiKey, setApiKey] = useState('')
  const [manualLoading, setManualLoading] = useState(false)
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [copied, setCopied] = useState(false)

  // Get client name
  const [clientName, setClientName] = useState('')
  useEffect(() => {
    supabase.from('training_clients').select('name').eq('id', clientId).single()
      .then(({ data }) => { if (data) setClientName(data.name) })
  }, [clientId])

  const generateLink = async () => {
    setCodeLoading(true)
    setError('')
    const newCode = Math.random().toString(36).slice(2, 10).toUpperCase()
    const { error: err } = await supabase.from('training_connect_codes').insert({
      coach_id: coachId,
      client_id: clientId,
      code: newCode,
      client_name: clientName,
    })
    if (err) { setError(err.message); setCodeLoading(false); return }
    setCode(newCode)
    setCodeLoading(false)
  }

  const connectLink = code ? `${window.location.origin}/connect/${code}` : ''

  const copyLink = () => {
    navigator.clipboard.writeText(connectLink)
    setCopied(true)
    setTimeout(() => setCopied(false), 2000)
  }

  const handleManualConnect = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) { setError('API key is required'); return }
    setManualLoading(true)
    setError('')

    try {
      const session = await getSession()
      const res = await fetch('/api/hevy/connect', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'connect_direct',
          api_key: apiKey.trim(),
          client_id: clientId,
          coach_token: session?.access_token,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      setSuccess(`Connected! Found ${data.workout_count || 0} workout pages.`)
      setTimeout(() => { onConnected(); onClose() }, 1500)
    } catch (err: any) {
      setError(err.message)
    } finally {
      setManualLoading(false)
    }
  }

  return (
    <div className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4" onClick={onClose}>
      <div className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 w-full max-w-lg" onClick={e => e.stopPropagation()}>
        <h2 className="text-lg font-bold text-white mb-1">Connect Hevy</h2>
        <p className="text-zinc-500 text-sm mb-5">Link {clientName || 'client'}'s Hevy account to sync their workouts</p>

        {/* Tabs */}
        <div className="flex gap-1 bg-zinc-800 rounded-lg p-1 mb-5">
          <button
            onClick={() => setTab('link')}
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${tab === 'link' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Send Link to Client
          </button>
          <button
            onClick={() => setTab('manual')}
            className={`flex-1 py-2 text-sm rounded-md transition-colors ${tab === 'manual' ? 'bg-zinc-700 text-white' : 'text-zinc-400 hover:text-zinc-300'}`}
          >
            Enter Key Manually
          </button>
        </div>

        {tab === 'link' ? (
          <div className="space-y-4">
            <p className="text-zinc-400 text-sm">
              Generate a link to send to your client. They'll enter their Hevy API key on a guided page.
            </p>
            {!code ? (
              <button
                onClick={generateLink}
                disabled={codeLoading}
                className="w-full py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
              >
                {codeLoading ? 'Generating...' : 'Generate Connect Link'}
              </button>
            ) : (
              <div className="space-y-3">
                <div className="flex gap-2">
                  <input
                    readOnly
                    value={connectLink}
                    className="flex-1 px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm font-mono"
                  />
                  <button
                    onClick={copyLink}
                    className="px-4 py-2.5 bg-zinc-700 hover:bg-zinc-600 text-white text-sm rounded-lg transition-colors whitespace-nowrap"
                  >
                    {copied ? 'Copied!' : 'Copy'}
                  </button>
                </div>
                <p className="text-zinc-600 text-xs">This link expires in 7 days.</p>
              </div>
            )}
          </div>
        ) : (
          <form onSubmit={handleManualConnect} className="space-y-4">
            <p className="text-zinc-400 text-sm">
              Enter your client's Hevy API key directly. You can find it in Hevy → Settings → Developer → API Key.
            </p>
            <input
              type="text"
              value={apiKey}
              onChange={e => setApiKey(e.target.value)}
              placeholder="hvy_..."
              className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
            />
            <button
              type="submit"
              disabled={manualLoading}
              className="w-full py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {manualLoading ? 'Connecting...' : 'Connect'}
            </button>
          </form>
        )}

        {error && <p className="text-red-400 text-sm mt-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>}
        {success && <p className="text-lime-400 text-sm mt-3 bg-lime-500/10 border border-lime-500/20 rounded-lg px-3 py-2">{success}</p>}

        <button onClick={onClose} className="w-full mt-4 py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors">
          Close
        </button>
      </div>
    </div>
  )
}

// ═══════════════════════════════════════════════════════════════════════════
// Client Detail View
// ═══════════════════════════════════════════════════════════════════════════

function ClientDetailView({ clientId, coach, onBack }: {
  clientId: string
  coach: Coach
  onBack: () => void
}) {
  const [client, setClient] = useState<ClientWithConnection | null>(null)
  const [workouts, setWorkouts] = useState<any[]>([])
  const [loading, setLoading] = useState(true)
  const [syncing, setSyncing] = useState(false)
  const [syncSource, setSyncSource] = useState('')
  const [error, setError] = useState('')

  useEffect(() => {
    ;(async () => {
      // Load client info
      const { data: c } = await supabase
        .from('training_clients')
        .select('*')
        .eq('id', clientId)
        .single()

      if (!c) { setLoading(false); return }

      const { data: conn } = await supabase
        .from('training_hevy_connections')
        .select('*')
        .eq('client_id', clientId)
        .single()

      setClient({ ...c, hevy_connection: conn || null })

      // If connected, fetch/sync workout data
      if (conn && conn.connection_status !== 'expired') {
        await syncWorkouts(false)
      }
      setLoading(false)
    })()
  }, [clientId])

  const syncWorkouts = async (forceRefresh = false) => {
    setSyncing(true)
    setError('')
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
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Sync failed')
      setWorkouts(data.rows || [])
      setSyncSource(data.source || '')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setSyncing(false)
    }
  }

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
          <p className="text-zinc-500 mb-4">Client not found</p>
          <button onClick={onBack} className="text-lime-400 hover:text-lime-300">← Back to Dashboard</button>
        </div>
      </div>
    )
  }

  // Group workouts by date
  const workoutsByDate = workouts.reduce<Record<string, typeof workouts>>((acc, row) => {
    const d = row.date?.split('T')[0] || 'Unknown'
    ;(acc[d] = acc[d] || []).push(row)
    return acc
  }, {})

  const sortedDates = Object.keys(workoutsByDate).sort((a, b) => b.localeCompare(a))

  // Quick stats
  const totalWorkouts = new Set(workouts.map(r => `${r.date}-${r.workout_name}`)).size
  const totalSets = workouts.length
  const uniqueExercises = new Set(workouts.map(r => r.exercise_name)).size
  const maxWeight = Math.max(0, ...workouts.map(r => r.weight_lbs || 0))

  return (
    <div className="min-h-screen bg-[#0a0a0a] text-white">
      {/* Header */}
      <header className="border-b border-zinc-800 px-6 py-4">
        <div className="max-w-6xl mx-auto flex items-center gap-4">
          <button onClick={onBack} className="text-zinc-500 hover:text-zinc-300 transition-colors text-sm">
            ← Back
          </button>
          <div className="flex-1">
            <h1 className="text-lg font-bold">{client.name}</h1>
            {client.email && <p className="text-zinc-500 text-xs">{client.email}</p>}
          </div>
          {client.hevy_connection?.connection_status === 'active' && (
            <button
              onClick={() => syncWorkouts(true)}
              disabled={syncing}
              className="px-4 py-2 bg-zinc-800 hover:bg-zinc-700 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {syncing ? 'Syncing...' : 'Force Sync'}
            </button>
          )}
        </div>
      </header>

      <main className="max-w-6xl mx-auto px-6 py-8">
        {/* Connection status banner */}
        {!client.hevy_connection && (
          <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-6 mb-6 text-center">
            <p className="text-zinc-400 mb-3">This client hasn't connected their Hevy account yet.</p>
            <p className="text-zinc-600 text-sm">Go back to the dashboard and use "Connect Hevy" on their card.</p>
          </div>
        )}

        {client.hevy_connection?.connection_status === 'expired' && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
            <p className="text-red-400 text-sm">This client's Hevy API key has expired. They'll need to reconnect with a new key.</p>
          </div>
        )}

        {error && (
          <div className="bg-red-500/10 border border-red-500/20 rounded-xl p-4 mb-6">
            <p className="text-red-400 text-sm">{error}</p>
          </div>
        )}

        {syncSource && (
          <div className="flex items-center gap-2 mb-6">
            <span className={`text-xs px-2 py-0.5 rounded-full border ${
              syncSource === 'live' ? 'bg-lime-500/15 text-lime-400 border-lime-500/25' :
              syncSource === 'cached' ? 'bg-blue-500/15 text-blue-400 border-blue-500/25' :
              'bg-yellow-500/15 text-yellow-400 border-yellow-500/25'
            }`}>
              {syncSource === 'live' ? 'Live data' : syncSource === 'cached' ? 'Cached' : 'Stale cache'}
            </span>
            {syncing && <span className="text-zinc-500 text-xs">Refreshing...</span>}
          </div>
        )}

        {/* Stats Cards */}
        {workouts.length > 0 && (
          <div className="grid grid-cols-2 md:grid-cols-4 gap-4 mb-8">
            <StatCard label="Workouts" value={totalWorkouts} />
            <StatCard label="Total Sets" value={totalSets} />
            <StatCard label="Exercises" value={uniqueExercises} />
            <StatCard label="Max Weight" value={`${maxWeight} lbs`} />
          </div>
        )}

        {/* Workout History */}
        {sortedDates.length > 0 && (
          <div className="space-y-4">
            <h2 className="text-lg font-semibold mb-4">Workout History</h2>
            {sortedDates.slice(0, 20).map(date => {
              const rows = workoutsByDate[date]
              const workoutName = rows[0]?.workout_name || 'Workout'
              // Group by exercise
              const byExercise = rows.reduce<Record<string, typeof rows>>((acc, r) => {
                ;(acc[r.exercise_name] = acc[r.exercise_name] || []).push(r)
                return acc
              }, {})

              return (
                <div key={date} className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-5">
                  <div className="flex items-center justify-between mb-3">
                    <h3 className="font-semibold text-white">{workoutName}</h3>
                    <span className="text-zinc-500 text-sm">{formatDate(date)}</span>
                  </div>
                  <div className="space-y-2">
                    {Object.entries(byExercise).map(([exName, sets]) => (
                      <div key={exName} className="flex items-center justify-between text-sm">
                        <span className="text-zinc-300">{exName}</span>
                        <span className="text-zinc-500">
                          {sets.map(s => s.weight_lbs > 0 ? `${s.weight_lbs}×${s.reps}` : `${s.reps} reps`).join(', ')}
                        </span>
                      </div>
                    ))}
                  </div>
                </div>
              )
            })}
            {sortedDates.length > 20 && (
              <p className="text-zinc-600 text-sm text-center">Showing most recent 20 workouts of {sortedDates.length} total</p>
            )}
          </div>
        )}

        {workouts.length === 0 && client.hevy_connection?.connection_status === 'active' && !syncing && (
          <div className="text-center py-16 bg-zinc-900/40 rounded-2xl border border-zinc-800">
            <p className="text-zinc-500">No workout data yet. Try a force sync or wait for the client to log workouts in Hevy.</p>
          </div>
        )}
      </main>
    </div>
  )
}

// ─── Utility Components ───────────────────────────────────────────────────

function StatCard({ label, value }: { label: string; value: string | number }) {
  return (
    <div className="bg-zinc-900/60 rounded-xl border border-zinc-800 p-4">
      <div className="text-zinc-500 text-xs mb-1">{label}</div>
      <div className="text-xl font-bold text-white">{value}</div>
    </div>
  )
}

function timeAgo(dateStr: string): string {
  const diff = Date.now() - new Date(dateStr).getTime()
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  return `${days}d ago`
}

function formatDate(dateStr: string): string {
  try {
    return new Date(dateStr + 'T00:00:00').toLocaleDateString('en-US', {
      weekday: 'short', month: 'short', day: 'numeric'
    })
  } catch { return dateStr }
}
