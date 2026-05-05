/**
 * HevyTemplatePicker
 * ────────────────────────────────────────────────────────────────────────────
 * Modal that lets the coach search Hevy's full exercise template catalog
 * and pick one. Used to resolve a null exercise_template_id on a
 * recommendation item before push.
 *
 * Catalog comes from POST /api/coach/list-hevy-exercise-templates which
 * uses the coach's stored Hevy API key. The endpoint module-caches the
 * full list (~440 entries) for 6h per coach so subsequent picker opens
 * are fast.
 *
 * Usage:
 *   <HevyTemplatePicker
 *     suggestedTitle="Lateral Raise (Cable)"
 *     currentTemplateId={item.exercise_template_id}
 *     onSelect={(template) => { ...persist... }}
 *     onClose={() => setOpen(false)}
 *   />
 */
import React, { useEffect, useMemo, useState } from 'react'
import { getSession } from '../../utils/supabase/auth'

export interface HevyTemplate {
  id: string
  title: string
  primary_muscle: string
  custom: boolean
}

interface Props {
  /** Pre-fill the search box with the AI's proposed title so the coach
   *  immediately sees plausible matches. */
  suggestedTitle?: string | null
  /** Highlight this template in the list (currently-selected). */
  currentTemplateId?: string | null
  onSelect: (template: HevyTemplate) => void
  onClose: () => void
}

type LoadState =
  | { kind: 'loading' }
  | { kind: 'ready'; all: HevyTemplate[] }
  | { kind: 'error'; message: string }

export function HevyTemplatePicker({
  suggestedTitle,
  currentTemplateId,
  onSelect,
  onClose,
}: Props) {
  const [state, setState] = useState<LoadState>({ kind: 'loading' })
  const [query, setQuery] = useState<string>(suggestedTitle?.trim() || '')

  useEffect(() => {
    void (async () => {
      try {
        const session = await getSession()
        if (!session?.access_token) throw new Error('Not signed in')
        const res = await fetch('/api/coach/list-hevy-exercise-templates', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ coach_token: session.access_token }),
        })
        const data = await res.json()
        if (!res.ok) {
          throw new Error(data?.error || `HTTP ${res.status}`)
        }
        setState({ kind: 'ready', all: data.templates || [] })
      } catch (err: any) {
        setState({ kind: 'error', message: err?.message || 'Failed to load Hevy templates' })
      }
    })()
  }, [])

  // Local filter — endpoint already supports `q` but we have the full list
  // cached in state so client-side filtering is instant.
  const filtered = useMemo(() => {
    if (state.kind !== 'ready') return []
    const q = query.trim().toLowerCase()
    if (!q) return state.all.slice(0, 200)
    return state.all
      .filter((t) => t.title.toLowerCase().includes(q))
      .slice(0, 200)
  }, [state, query])

  return (
    <div
      className="fixed inset-0 bg-black/60 flex items-center justify-center z-50 px-4"
      onClick={onClose}
    >
      <div
        className="bg-zinc-900 rounded-2xl border border-zinc-800 p-5 w-full max-w-2xl max-h-[80vh] flex flex-col"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="flex items-start justify-between mb-3">
          <div>
            <h2 className="text-base font-bold text-white">Pick a Hevy template</h2>
            <p className="text-zinc-500 text-xs mt-0.5">
              {suggestedTitle
                ? `AI proposed "${suggestedTitle}". Pick the matching Hevy template.`
                : 'Pick the Hevy template that matches the exercise.'}
            </p>
          </div>
          <button
            onClick={onClose}
            className="text-zinc-500 hover:text-zinc-300 text-sm px-2 py-0.5"
          >
            ×
          </button>
        </div>

        <input
          type="text"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          placeholder="Search templates by title…"
          className="w-full px-3 py-2 mb-3 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
          autoFocus
        />

        <div className="flex-1 overflow-y-auto rounded-lg border border-zinc-800">
          {state.kind === 'loading' && (
            <div className="p-6 text-center text-zinc-500 text-sm">Loading Hevy templates…</div>
          )}
          {state.kind === 'error' && (
            <div className="p-6 text-center">
              <div className="text-red-400 text-sm mb-2">{state.message}</div>
              {state.message.toLowerCase().includes('connect') && (
                <div className="text-zinc-500 text-xs">
                  Open the Hevy chip in the dashboard header to connect your API key.
                </div>
              )}
            </div>
          )}
          {state.kind === 'ready' && filtered.length === 0 && (
            <div className="p-6 text-center text-zinc-500 text-sm">
              No templates match "{query}". Try a shorter or different word.
            </div>
          )}
          {state.kind === 'ready' && filtered.length > 0 && (
            <ul className="divide-y divide-zinc-800/70">
              {filtered.map((t) => {
                const isCurrent = t.id === currentTemplateId
                return (
                  <li key={t.id}>
                    <button
                      onClick={() => onSelect(t)}
                      className={`w-full text-left px-3 py-2 hover:bg-zinc-800 transition-colors flex items-center justify-between ${
                        isCurrent ? 'bg-lime-500/5' : ''
                      }`}
                    >
                      <div>
                        <div className="text-sm text-white">{t.title}</div>
                        <div className="text-[11px] text-zinc-500 mt-0.5">
                          {t.primary_muscle || 'unspecified muscle'}
                          {t.custom ? ' · custom' : ''}
                          {isCurrent ? ' · currently selected' : ''}
                        </div>
                      </div>
                      <span className="text-zinc-600 text-[10px] font-mono">
                        {t.id.length > 10 ? `${t.id.slice(0, 8)}…` : t.id}
                      </span>
                    </button>
                  </li>
                )
              })}
            </ul>
          )}
        </div>

        {state.kind === 'ready' && (
          <div className="text-zinc-600 text-[10px] mt-2">
            {filtered.length === state.all.length
              ? `${state.all.length} templates`
              : `${filtered.length} of ${state.all.length} templates`}
          </div>
        )}
      </div>
    </div>
  )
}
