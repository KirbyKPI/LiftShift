/**
 * CoachNotesPanel
 * ────────────────────────────────────────────────────────────────────────────
 * Collapsible markdown textarea attached to a coach's client. Reads/writes
 * `training_clients.notes` (TEXT). Auto-saves on blur and on ⌘↩.
 *
 * This is the "client notes / goals" input the coach fills in so Claude has
 * context beyond raw workout data — e.g. goals, injuries, preferences, "out
 * of town Apr 28–May 4". The field is shared with the existing `notes`
 * column on training_clients; no schema change.
 */

import React, { useEffect, useRef, useState } from 'react'
import { supabase } from '../../utils/supabase/client'

interface CoachNotesPanelProps {
  clientId: string
}

type SaveState = 'idle' | 'dirty' | 'saving' | 'saved' | 'error'

export function CoachNotesPanel({ clientId }: CoachNotesPanelProps) {
  const [expanded, setExpanded] = useState(false)
  const [notes, setNotes] = useState<string>('')
  const [loadState, setLoadState] = useState<'loading' | 'loaded' | 'error'>('loading')
  const [saveState, setSaveState] = useState<SaveState>('idle')
  const [error, setError] = useState<string | null>(null)

  // Ref to the latest value so the save handler reads fresh text even when
  // invoked from a stale blur closure.
  const notesRef = useRef(notes)
  notesRef.current = notes

  // Initial load.
  useEffect(() => {
    let cancelled = false
    ;(async () => {
      setLoadState('loading')
      const { data, error: err } = await supabase
        .from('training_clients')
        .select('notes')
        .eq('id', clientId)
        .single()

      if (cancelled) return
      if (err) {
        setError(err.message)
        setLoadState('error')
        return
      }
      setNotes(data?.notes ?? '')
      setLoadState('loaded')
      setSaveState('idle')
    })()
    return () => {
      cancelled = true
    }
  }, [clientId])

  const save = async () => {
    if (saveState === 'saving') return
    setSaveState('saving')
    setError(null)
    const value = notesRef.current
    const { error: err } = await supabase
      .from('training_clients')
      .update({ notes: value })
      .eq('id', clientId)
    if (err) {
      setError(err.message)
      setSaveState('error')
      return
    }
    setSaveState('saved')
    // Fade the saved indicator after a bit so the UI doesn't feel stuck.
    setTimeout(() => {
      setSaveState((s) => (s === 'saved' ? 'idle' : s))
    }, 1500)
  }

  const handleKeyDown = (e: React.KeyboardEvent<HTMLTextAreaElement>) => {
    // ⌘↩ / Ctrl↩ — explicit save (no blur needed).
    if ((e.metaKey || e.ctrlKey) && e.key === 'Enter') {
      e.preventDefault()
      void save()
    }
  }

  // Compact preview when collapsed: first non-empty line, or placeholder.
  const preview = (() => {
    const first = notes
      .split('\n')
      .map((l) => l.trim())
      .find((l) => l.length > 0)
    if (first) return first.length > 80 ? `${first.slice(0, 77)}…` : first
    return 'No coach notes yet — add goals, injuries, preferences, etc.'
  })()

  const saveLabel =
    saveState === 'saving'
      ? 'Saving…'
      : saveState === 'saved'
        ? 'Saved'
        : saveState === 'dirty'
          ? 'Unsaved'
          : saveState === 'error'
            ? 'Error'
            : ''

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60">
      <div className="max-w-6xl mx-auto px-6 py-2">
        <button
          onClick={() => setExpanded((e) => !e)}
          className="w-full flex items-center gap-3 text-left group"
          aria-expanded={expanded}
        >
          <span className="text-xs uppercase tracking-wide text-zinc-500 group-hover:text-zinc-300 transition-colors">
            Coach notes
          </span>
          {!expanded && (
            <span className="text-sm text-zinc-400 truncate flex-1">{preview}</span>
          )}
          {saveLabel && (
            <span
              className={`text-[11px] ${
                saveState === 'error'
                  ? 'text-red-400'
                  : saveState === 'saved'
                    ? 'text-lime-400'
                    : 'text-zinc-500'
              }`}
            >
              {saveLabel}
            </span>
          )}
          <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
        </button>

        {expanded && (
          <div className="pt-2 pb-3">
            {loadState === 'loading' ? (
              <div className="text-zinc-500 text-sm py-4">Loading notes…</div>
            ) : loadState === 'error' ? (
              <div className="text-red-400 text-sm py-4">
                Failed to load notes{error ? `: ${error}` : ''}
              </div>
            ) : (
              <>
                <textarea
                  value={notes}
                  onChange={(e) => {
                    setNotes(e.target.value)
                    setSaveState('dirty')
                  }}
                  onBlur={() => {
                    if (saveState === 'dirty') void save()
                  }}
                  onKeyDown={handleKeyDown}
                  placeholder="Goals, injuries, preferences, schedule constraints, etc.&#10;Markdown supported. ⌘↩ to save."
                  className="w-full min-h-[160px] px-3 py-2.5 bg-zinc-900/60 border border-zinc-800 rounded-lg text-zinc-100 text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/40 transition-colors resize-y"
                />
                {error && saveState === 'error' && (
                  <p className="text-red-400 text-xs mt-1">{error}</p>
                )}
                <p className="text-zinc-600 text-[11px] mt-1">
                  Auto-saves on blur. Used as context when generating AI routine recommendations.
                </p>
              </>
            )}
          </div>
        )}
      </div>
    </div>
  )
}
