/**
 * SavedRecommendationsPanel
 * ────────────────────────────────────────────────────────────────────────────
 * Lists past recommendations for the current client so the coach can:
 *   - reload one into the Result view to reference or discuss
 *   - rename it (edit coach_note inline)
 *   - delete it (cascade removes items + push_audit via ON DELETE CASCADE)
 *
 * All via direct Supabase queries — RLS limits the coach to their own rows.
 * Parent passes an `onLoad(recommendation)` callback so loading flows into
 * the same ResultView the fresh generate flow uses.
 */

import React, { useCallback, useEffect, useState } from 'react'
import { supabase } from '../../utils/supabase/client'

export interface SavedRecommendationListItem {
  id: string
  adjustment_level: string
  status: string
  coach_note: string | null
  focus_prompt: string | null
  created_at: string
  pushed_at: string | null
  error_message: string | null
  item_count: number
}

interface LoadedRecommendation {
  id: string
  summary: string
  items: Array<{
    id: string
    position: number
    exercise_title: string
    exercise_template_id: string | null
    current_json: any
    proposed_json: any
    rationale: string | null
    day_label: string | null
  }>
  adjustment_level: string
  status: string
  coach_note: string | null
}

interface SavedRecommendationsPanelProps {
  clientId: string
  onLoad: (rec: LoadedRecommendation) => void
  /** Parent increments this to signal a new rec landed and we should refetch. */
  refreshKey: number
}

export function SavedRecommendationsPanel({
  clientId,
  onLoad,
  refreshKey,
}: SavedRecommendationsPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [list, setList] = useState<SavedRecommendationListItem[] | null>(null)
  const [error, setError] = useState<string | null>(null)
  const [busy, setBusy] = useState<string | null>(null)
  const [editingId, setEditingId] = useState<string | null>(null)
  const [editNoteDraft, setEditNoteDraft] = useState('')

  const load = useCallback(async () => {
    setError(null)
    // Fetch rec rows + count via a single aggregate query.
    const { data, error: err } = await supabase
      .from('training_coach_recommendations')
      .select(
        'id, adjustment_level, status, coach_note, focus_prompt, created_at, pushed_at, error_message, training_coach_recommendation_items(count)',
      )
      .eq('client_id', clientId)
      .order('created_at', { ascending: false })

    if (err) {
      setError(err.message)
      setList([])
      return
    }

    const rows: SavedRecommendationListItem[] = (data || []).map((r: any) => ({
      id: r.id,
      adjustment_level: r.adjustment_level,
      status: r.status,
      coach_note: r.coach_note,
      focus_prompt: r.focus_prompt,
      created_at: r.created_at,
      pushed_at: r.pushed_at,
      error_message: r.error_message,
      item_count:
        Array.isArray(r.training_coach_recommendation_items) &&
        r.training_coach_recommendation_items.length > 0
          ? r.training_coach_recommendation_items[0]?.count ?? 0
          : 0,
    }))
    setList(rows)
  }, [clientId])

  useEffect(() => {
    if (!expanded) return
    void load()
  }, [expanded, load, refreshKey])

  const handleLoad = async (id: string) => {
    setBusy(id)
    setError(null)
    try {
      const [{ data: rec, error: rErr }, { data: items, error: iErr }] = await Promise.all([
        supabase
          .from('training_coach_recommendations')
          .select('id, adjustment_level, status, coach_note, ai_response_raw')
          .eq('id', id)
          .single(),
        supabase
          .from('training_coach_recommendation_items')
          .select('*')
          .eq('recommendation_id', id)
          .order('position', { ascending: true }),
      ])
      if (rErr) throw rErr
      if (iErr) throw iErr
      if (!rec) throw new Error('Recommendation not found')

      // Pull the summary from ai_response_raw (Claude's tool_use input). It's
      // the only place we persist the narrative; item rows don't carry it.
      const summary = extractSummary(rec.ai_response_raw)

      onLoad({
        id: rec.id,
        summary,
        adjustment_level: rec.adjustment_level,
        status: rec.status,
        coach_note: rec.coach_note,
        items: (items || []) as LoadedRecommendation['items'],
      })
    } catch (err: any) {
      setError(err?.message || 'Failed to load')
    } finally {
      setBusy(null)
    }
  }

  const handleDelete = async (id: string) => {
    if (!confirm('Delete this recommendation? This cannot be undone.')) return
    setBusy(id)
    const { error: err } = await supabase
      .from('training_coach_recommendations')
      .delete()
      .eq('id', id)
    if (err) {
      setError(err.message)
    } else {
      setList((prev) => prev?.filter((r) => r.id !== id) ?? null)
    }
    setBusy(null)
  }

  const startEditNote = (row: SavedRecommendationListItem) => {
    setEditingId(row.id)
    setEditNoteDraft(row.coach_note ?? '')
  }

  const saveEditNote = async (id: string) => {
    const { error: err } = await supabase
      .from('training_coach_recommendations')
      .update({ coach_note: editNoteDraft.trim() || null })
      .eq('id', id)
    if (err) {
      setError(err.message)
      return
    }
    setList((prev) =>
      prev?.map((r) => (r.id === id ? { ...r, coach_note: editNoteDraft.trim() || null } : r)) ??
      null,
    )
    setEditingId(null)
    setEditNoteDraft('')
  }

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60">
      <div className="max-w-6xl mx-auto px-6 py-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-3 text-left group"
          aria-expanded={expanded}
        >
          <span className="text-xs uppercase tracking-wide text-zinc-500 group-hover:text-zinc-300 transition-colors">
            Saved recommendations
          </span>
          {!expanded && list && (
            <span className="text-sm text-zinc-400 flex-1">
              {list.length === 0
                ? 'No saved recommendations yet'
                : `${list.length} saved — click to manage`}
            </span>
          )}
          <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div className="pt-3 pb-3 space-y-2">
            {list === null && <div className="text-zinc-500 text-sm py-2">Loading…</div>}
            {error && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-2">
                <p className="text-red-400 text-xs">{error}</p>
              </div>
            )}
            {list && list.length === 0 && (
              <div className="text-zinc-500 text-sm py-2">
                No recommendations saved yet. Generate one above to get started.
              </div>
            )}
            {list &&
              list.map((row) => {
                const isEditing = editingId === row.id
                return (
                  <div
                    key={row.id}
                    className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3"
                  >
                    <div className="flex items-start justify-between gap-3">
                      <div className="flex-1 min-w-0">
                        {isEditing ? (
                          <div className="flex items-center gap-2">
                            <input
                              value={editNoteDraft}
                              onChange={(e) => setEditNoteDraft(e.target.value)}
                              onKeyDown={(e) => {
                                if (e.key === 'Enter') {
                                  e.preventDefault()
                                  void saveEditNote(row.id)
                                } else if (e.key === 'Escape') {
                                  setEditingId(null)
                                }
                              }}
                              autoFocus
                              placeholder="Name this recommendation…"
                              className="flex-1 px-2 py-1 bg-zinc-800 border border-zinc-700 rounded text-zinc-100 text-sm"
                            />
                            <button
                              onClick={() => void saveEditNote(row.id)}
                              className="text-xs text-lime-400 hover:text-lime-300"
                            >
                              Save
                            </button>
                            <button
                              onClick={() => setEditingId(null)}
                              className="text-xs text-zinc-500 hover:text-zinc-300"
                            >
                              Cancel
                            </button>
                          </div>
                        ) : (
                          <div className="flex items-center gap-2 flex-wrap">
                            <span className="text-sm text-zinc-100 font-medium">
                              {row.coach_note ||
                                `${prettyLevel(row.adjustment_level)} recommendation`}
                            </span>
                            <button
                              onClick={() => startEditNote(row)}
                              title="Rename"
                              className="text-zinc-600 hover:text-zinc-400 text-xs"
                            >
                              ✎
                            </button>
                          </div>
                        )}
                        <div className="mt-0.5 flex items-center gap-2 text-[11px] text-zinc-500 flex-wrap">
                          <span>{timeAgo(row.created_at)}</span>
                          <span>·</span>
                          <StatusPill status={row.status} />
                          <span>·</span>
                          <span>{row.item_count} items</span>
                          <span>·</span>
                          <span>{prettyLevel(row.adjustment_level)}</span>
                          {row.focus_prompt && (
                            <>
                              <span>·</span>
                              <span
                                className="truncate max-w-[280px]"
                                title={row.focus_prompt}
                              >
                                Focus: {row.focus_prompt}
                              </span>
                            </>
                          )}
                        </div>
                        {row.error_message && (
                          <p className="text-red-400 text-[11px] mt-1">{row.error_message}</p>
                        )}
                      </div>
                      <div className="flex gap-2 shrink-0">
                        {row.status !== 'failed' && row.item_count > 0 && (
                          <button
                            onClick={() => void handleLoad(row.id)}
                            disabled={busy === row.id}
                            className="px-2.5 py-1 bg-zinc-800 hover:bg-zinc-700 text-xs rounded-md transition-colors disabled:opacity-50"
                          >
                            {busy === row.id ? '…' : 'Load'}
                          </button>
                        )}
                        <button
                          onClick={() => void handleDelete(row.id)}
                          disabled={busy === row.id}
                          className="px-2.5 py-1 bg-zinc-800 hover:bg-red-500/20 hover:text-red-400 text-xs rounded-md transition-colors disabled:opacity-50"
                        >
                          Delete
                        </button>
                      </div>
                    </div>
                  </div>
                )
              })}
          </div>
        )}
      </div>
    </div>
  )
}

function extractSummary(raw: any): string {
  if (!raw || typeof raw !== 'object') return ''
  // Claude's messages.create response: content array with tool_use blocks.
  const content = raw.content
  if (!Array.isArray(content)) return ''
  for (const block of content) {
    if (block?.type === 'tool_use' && block?.input?.summary) {
      return String(block.input.summary)
    }
  }
  return ''
}

function prettyLevel(level: string): string {
  return level.replace(/_/g, ' ')
}

function timeAgo(iso: string): string {
  const t = new Date(iso).getTime()
  if (!Number.isFinite(t)) return iso
  const diff = Date.now() - t
  const mins = Math.floor(diff / 60000)
  if (mins < 1) return 'just now'
  if (mins < 60) return `${mins}m ago`
  const hrs = Math.floor(mins / 60)
  if (hrs < 24) return `${hrs}h ago`
  const days = Math.floor(hrs / 24)
  if (days < 30) return `${days}d ago`
  return new Date(iso).toLocaleDateString()
}

function StatusPill({ status }: { status: string }) {
  const classes =
    status === 'awaiting_review'
      ? 'text-zinc-400 border-zinc-700'
      : status === 'approved'
        ? 'text-lime-400 border-lime-500/40'
        : status === 'pushed'
          ? 'text-blue-400 border-blue-500/40'
          : status === 'failed'
            ? 'text-red-400 border-red-500/40'
            : 'text-zinc-500 border-zinc-800'
  return (
    <span className={`inline-block px-1.5 py-0 rounded-full border ${classes}`}>{status}</span>
  )
}
