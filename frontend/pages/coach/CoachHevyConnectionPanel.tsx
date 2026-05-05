/**
 * Coach's personal Hevy connection — pasted-in API key for the
 * coach's own Hevy Pro account. push-recommendation.ts uses this key
 * to write routines into the coach's library, where they're then
 * assigned to clients via Hevy Coach.
 *
 * Renders as a small status chip in the dashboard header. Clicking
 * opens a modal for connect/disconnect. Also renders a prominent
 * banner via the optional `renderBanner` prop when no connection
 * exists, so first-time coaches notice it.
 */
import React, { useEffect, useState } from 'react'
import { getSession } from '../../utils/supabase/auth'

type ConnectionState =
  | { kind: 'loading' }
  | { kind: 'unconnected' }
  | { kind: 'connected'; updatedAt: string | null; status: string }
  | { kind: 'error'; message: string }

async function postConnectHevy(body: Record<string, unknown>): Promise<any> {
  const session = await getSession()
  if (!session?.access_token) throw new Error('Not signed in')
  const res = await fetch('/api/coach/connect-hevy', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({ ...body, coach_token: session.access_token }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data?.error || `HTTP ${res.status}`)
  return data
}

export function CoachHevyConnectionChip() {
  const [state, setState] = useState<ConnectionState>({ kind: 'loading' })
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = async () => {
    setState({ kind: 'loading' })
    try {
      const data = await postConnectHevy({ mode: 'status' })
      if (data.connected) {
        setState({
          kind: 'connected',
          updatedAt: data.connection?.updated_at ?? null,
          status: data.connection?.connection_status ?? 'active',
        })
      } else {
        setState({ kind: 'unconnected' })
      }
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message || 'Status check failed' })
    }
  }

  useEffect(() => {
    void refresh()
  }, [])

  const label =
    state.kind === 'loading'
      ? 'Hevy: …'
      : state.kind === 'connected'
        ? state.status === 'active'
          ? 'Hevy: Connected'
          : `Hevy: ${state.status}`
        : state.kind === 'unconnected'
          ? 'Hevy: Not connected'
          : 'Hevy: Error'

  const dotColor =
    state.kind === 'connected' && state.status === 'active'
      ? 'bg-lime-400'
      : state.kind === 'unconnected'
        ? 'bg-zinc-500'
        : state.kind === 'loading'
          ? 'bg-zinc-600 animate-pulse'
          : 'bg-amber-400'

  return (
    <>
      <button
        onClick={() => setModalOpen(true)}
        className="flex items-center gap-2 px-3 py-1.5 bg-zinc-900 hover:bg-zinc-800 border border-zinc-800 hover:border-zinc-700 rounded-lg text-xs text-zinc-300 transition-colors"
        title="Manage your Hevy Pro API key"
      >
        <span className={`w-1.5 h-1.5 rounded-full ${dotColor}`} />
        {label}
      </button>
      {modalOpen && (
        <CoachHevyConnectionModal
          state={state}
          onClose={() => setModalOpen(false)}
          onChanged={() => {
            void refresh()
          }}
        />
      )}
    </>
  )
}

/** Inline banner shown above the client list when no connection exists.
 *  Self-contained: shows its own connect modal when clicked. */
export function CoachHevyConnectionBanner() {
  const [state, setState] = useState<ConnectionState>({ kind: 'loading' })
  const [modalOpen, setModalOpen] = useState(false)

  const refresh = async () => {
    try {
      const data = await postConnectHevy({ mode: 'status' })
      if (data.connected) {
        setState({
          kind: 'connected',
          updatedAt: data.connection?.updated_at ?? null,
          status: data.connection?.connection_status ?? 'active',
        })
      } else {
        setState({ kind: 'unconnected' })
      }
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message || 'Status check failed' })
    }
  }
  useEffect(() => {
    void refresh()
  }, [])

  // Don't show the banner until we know whether they're connected, and hide
  // it entirely once they are.
  if (state.kind !== 'unconnected' && state.kind !== 'error') return null

  return (
    <>
      <div className="mb-6 rounded-xl border border-amber-500/40 bg-amber-500/10 p-4 text-sm flex items-start justify-between gap-4">
        <div>
          <div className="font-semibold text-amber-300 mb-1">
            Connect your Hevy Pro account
          </div>
          <p className="text-amber-200/80">
            Routines you Approve & Assign push into <em>your</em> Hevy library
            (organized by client folder), where you then assign them to clients
            via Hevy Coach. Paste your API key once to get started.
          </p>
        </div>
        <button
          onClick={() => setModalOpen(true)}
          className="shrink-0 px-3 py-2 bg-amber-500 hover:bg-amber-400 text-black font-semibold text-xs rounded-lg transition-colors"
        >
          Connect Hevy
        </button>
      </div>
      {modalOpen && (
        <CoachHevyConnectionModal
          state={state}
          onClose={() => setModalOpen(false)}
          onChanged={() => {
            void refresh()
          }}
        />
      )}
    </>
  )
}

function CoachHevyConnectionModal({
  state,
  onClose,
  onChanged,
}: {
  state: ConnectionState
  onClose: () => void
  onChanged: () => void
}) {
  const isConnected = state.kind === 'connected'
  const [apiKey, setApiKey] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState<string | null>(null)
  const [success, setSuccess] = useState<string | null>(null)

  const save = async (e: React.FormEvent) => {
    e.preventDefault()
    setError(null)
    setSuccess(null)
    if (!apiKey.trim()) {
      setError('Paste your Hevy Pro API key')
      return
    }
    setBusy(true)
    try {
      const data = await postConnectHevy({ mode: 'save', api_key: apiKey.trim() })
      setSuccess(
        `Connected. Hevy reports ${data.workout_count ?? 0} workout page(s) on your account.`,
      )
      setApiKey('')
      onChanged()
    } catch (err: any) {
      setError(err?.message || 'Connect failed')
    } finally {
      setBusy(false)
    }
  }

  const disconnect = async () => {
    if (!confirm('Disconnect your Hevy Pro key? Approve & Assign will stop working until you reconnect.')) {
      return
    }
    setBusy(true)
    setError(null)
    setSuccess(null)
    try {
      await postConnectHevy({ mode: 'disconnect' })
      setSuccess('Disconnected.')
      onChanged()
    } catch (err: any) {
      setError(err?.message || 'Disconnect failed')
    } finally {
      setBusy(false)
    }
  }

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-800 p-6 w-full max-w-lg"
        onClick={(e) => e.stopPropagation()}
      >
        <h2 className="text-lg font-bold text-white mb-1">Your Hevy Pro account</h2>
        <p className="text-zinc-500 text-sm mb-5">
          Used by Approve & Assign to write routines into your Hevy library.
          Each client gets their own folder (auto-created on first push).
        </p>

        {isConnected ? (
          <div className="space-y-4">
            <div className="rounded-lg border border-lime-500/30 bg-lime-500/10 px-4 py-3 text-sm">
              <div className="font-semibold text-lime-300 mb-0.5">Connected</div>
              <div className="text-lime-200/70 text-xs">
                Status: {state.status}
                {state.updatedAt
                  ? ` · Last updated ${new Date(state.updatedAt).toLocaleString()}`
                  : ''}
              </div>
            </div>
            <button
              onClick={disconnect}
              disabled={busy}
              className="w-full py-2.5 bg-zinc-800 hover:bg-red-500/20 hover:text-red-300 hover:border-red-500/30 border border-zinc-700 text-zinc-300 text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {busy ? 'Working…' : 'Disconnect'}
            </button>
            <details className="text-xs text-zinc-500">
              <summary className="cursor-pointer hover:text-zinc-300">
                Replace key (e.g. you regenerated it on Hevy)
              </summary>
              <form onSubmit={save} className="mt-3 space-y-2">
                <input
                  type="text"
                  value={apiKey}
                  onChange={(e) => setApiKey(e.target.value)}
                  placeholder="Paste new Hevy API key"
                  className="w-full px-3 py-2 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-xs font-mono placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50"
                />
                <button
                  type="submit"
                  disabled={busy}
                  className="w-full py-2 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-xs rounded-lg disabled:opacity-50"
                >
                  {busy ? 'Validating…' : 'Replace'}
                </button>
              </form>
            </details>
          </div>
        ) : (
          <form onSubmit={save} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">
                Hevy Pro API key
              </label>
              <input
                type="text"
                value={apiKey}
                onChange={(e) => setApiKey(e.target.value)}
                placeholder="paste here"
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
                autoFocus
              />
              <p className="text-zinc-600 text-xs mt-2">
                Get your key at{' '}
                <a
                  href="https://hevy.com/settings?developer"
                  target="_blank"
                  rel="noreferrer"
                  className="text-lime-400 hover:text-lime-300 underline"
                >
                  hevy.com/settings?developer
                </a>
                . Requires Hevy Pro. We encrypt and store it server-side; only
                this app's API can decrypt.
              </p>
            </div>
            <button
              type="submit"
              disabled={busy}
              className="w-full py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {busy ? 'Validating…' : 'Connect'}
            </button>
          </form>
        )}

        {error && (
          <p className="text-red-400 text-sm mt-3 bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
            {error}
          </p>
        )}
        {success && (
          <p className="text-lime-400 text-sm mt-3 bg-lime-500/10 border border-lime-500/20 rounded-lg px-3 py-2">
            {success}
          </p>
        )}

        <button
          onClick={onClose}
          className="w-full mt-4 py-2 text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
        >
          Close
        </button>
      </div>
    </div>
  )
}
