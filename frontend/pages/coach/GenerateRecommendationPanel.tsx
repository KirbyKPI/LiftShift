/**
 * GenerateRecommendationPanel
 * ────────────────────────────────────────────────────────────────────────────
 * Phase 2 UI: an adjustment-level picker + Generate button. On click:
 *   1. Computes insights summary from the seeded WorkoutSet[] in the
 *      coach-view context.
 *   2. POST /api/coach/generate-recommendation → creates a draft row + snapshot.
 *   3. POST /api/coach/run-ai-recommendation → fires Claude, writes items.
 *   4. Renders a minimal result: summary + item list with proposed loads.
 *
 * This is deliberately a v0 result view. Phase 3 will replace the inline
 * result with a proper side-by-side diff / accept / edit / reject UI. Right
 * now the goal is just to prove the AI call produces reasonable output
 * before we invest in the review UX.
 */

import React, { useEffect, useRef, useState } from 'react'
import { getSession } from '../../utils/supabase/auth'
import { supabase } from '../../utils/supabase/client'
import { useCoachView } from '../../app/coachView'
import { buildInsightsSummary } from './buildInsightsSummary'
import { PlanBuilderForm } from './PlanBuilderForm'
import type { PlanPreferences } from './planPreferencesTypes'

const MAX_ROUTINE_SLOTS = 7

type AdjustmentLevel =
  | 'load_only'
  | 'load_plus_swap'
  | 'full_authoring'
  | 'overhaul'
  | 'week_plan'

const LEVEL_LABELS: Record<AdjustmentLevel, string> = {
  load_only: 'Load only',
  load_plus_swap: 'Load + swaps',
  full_authoring: 'Full authoring',
  overhaul: 'Overhaul',
  week_plan: 'Week plan',
}

const LEVEL_DESCRIPTIONS: Record<AdjustmentLevel, string> = {
  load_only: 'Just weight / rep / set adjustments on the existing exercises.',
  load_plus_swap: 'Load tweaks plus targeted exercise swaps where the data justifies them.',
  full_authoring: 'Claude can restructure the whole routine — exercises, order, scheme.',
  overhaul:
    'Fresh single routine built from the ground up. Good for a messy current routine or no clear program. Requires focus below.',
  week_plan:
    'Full weekly program, one routine per training day. Requires focus below.',
}

const CREATE_FROM_SCRATCH: AdjustmentLevel[] = ['overhaul', 'week_plan']

type PhaseState =
  | { kind: 'idle' }
  | { kind: 'building_snapshot' }
  | { kind: 'running_ai' }
  | { kind: 'done'; result: AiResult }
  | { kind: 'error'; message: string }

type CoachAction = 'pending' | 'accept' | 'edit' | 'reject' | 'substitute'

interface AiResultItem {
  id: string
  position: number
  exercise_title: string
  exercise_template_id: string | null
  current_json: any
  proposed_json: any
  rationale: string | null
  day_label: string | null
  coach_action?: CoachAction
  coach_edited_json?: any
  substitution_context?: {
    alternative?: {
      exercise_template_id: string | null
      exercise_title: string
      proposed: any
      rationale: string
    }
    reason?: string | null
  } | null
}

interface AiResult {
  recommendation_id: string
  summary: string
  items: AiResultItem[]
  usage: { input_tokens: number | null; output_tokens: number | null }
  model: string
}

interface RoutineOption {
  id: string
  title: string
  exercise_count: number
  updated_at: string
}

type RoutinesLoadState =
  | { kind: 'idle' }
  | { kind: 'loading' }
  | { kind: 'loaded'; routines: RoutineOption[]; total: number }
  | { kind: 'error'; message: string }

interface GenerateRecommendationPanelProps {
  /** Parent can push a previously-generated recommendation in (from the saved list). */
  externalResult?: AiResult | null
  /** Bumped when a new rec is generated so parent can refresh its saved list. */
  onNewResult?: () => void
  /** When 'embedded', hides the panel's own collapsible header — used inside CoachWorkspaceTabs. */
  mode?: 'standalone' | 'embedded'
}

export function GenerateRecommendationPanel({
  externalResult,
  onNewResult,
  mode = 'standalone',
}: GenerateRecommendationPanelProps = {}) {
  const coachView = useCoachView()
  const [expanded, setExpanded] = useState(mode === 'embedded')
  const [level, setLevel] = useState<AdjustmentLevel>('load_only')
  const [phase, setPhase] = useState<PhaseState>({ kind: 'idle' })

  // When a saved rec is loaded from the parent, swap it into the result view.
  useEffect(() => {
    if (externalResult) {
      setPhase({ kind: 'done', result: externalResult })
      setExpanded(true)
    }
  }, [externalResult])

  const [routinesState, setRoutinesState] = useState<RoutinesLoadState>({ kind: 'idle' })
  const [selectedRoutineId, setSelectedRoutineId] = useState<string | null>(null)
  const [focusPrompt, setFocusPrompt] = useState('')
  const [planPrefs, setPlanPrefs] = useState<PlanPreferences>({})

  // Smooth-scroll the result into view when a generation completes, so the
  // coach sees the proposal immediately instead of having to scroll past
  // the form. Attached to the ResultView wrapper below.
  const resultRef = useRef<HTMLDivElement | null>(null)
  useEffect(() => {
    if (phase.kind === 'done' && resultRef.current) {
      resultRef.current.scrollIntoView({ behavior: 'smooth', block: 'start' })
    }
  }, [phase.kind])

  const isCreateFromScratch = CREATE_FROM_SCRATCH.includes(level)
  const hasAnyPlanPref = Object.keys(planPrefs).some((k) => {
    const v = (planPrefs as any)[k]
    return v !== undefined && v !== null && (!Array.isArray(v) || v.length > 0)
  })

  // Lazy-load the routine list the first time the panel expands so we don't
  // pay a Hevy round-trip on every client view.
  //
  // A ref (not state) guards against double-fetch — using state in deps here
  // causes the effect to re-run when we set 'loading', the cleanup fires
  // mid-fetch, and the cancelled flag drops the successful response.
  const hasLoadedRef = useRef(false)

  useEffect(() => {
    if (!expanded || !coachView) return
    if (hasLoadedRef.current) return
    hasLoadedRef.current = true

    let cancelled = false
    setRoutinesState({ kind: 'loading' })
    ;(async () => {
      try {
        const session = await getSession()
        if (!session?.access_token) throw new Error('Not signed in')
        const res = await fetch('/api/coach/list-routines', {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({
            client_id: coachView.clientId,
            coach_token: session.access_token,
          }),
        })
        const data = await res.json()
        if (!res.ok) throw new Error(data.error || 'Failed to load routines')
        if (cancelled) return

        const all: RoutineOption[] = (data.routines || []).map((r: any) => ({
          id: r.id,
          title: r.title,
          exercise_count: r.exercise_count ?? 0,
          updated_at: r.updated_at,
        }))
        const sorted = all.slice().sort(
          (a, b) => new Date(b.updated_at).getTime() - new Date(a.updated_at).getTime(),
        )
        const visible = sorted.slice(0, MAX_ROUTINE_SLOTS)
        setRoutinesState({ kind: 'loaded', routines: visible, total: all.length })
        if (visible.length > 0) setSelectedRoutineId(visible[0].id)
      } catch (err: any) {
        if (!cancelled) {
          setRoutinesState({
            kind: 'error',
            message: err?.message || 'Failed to load routines',
          })
          // Let a manual retry try again by clearing the one-shot guard.
          hasLoadedRef.current = false
        }
      }
    })()

    return () => {
      cancelled = true
    }
  }, [expanded, coachView])

  if (!coachView) return null

  const handleGenerate = async () => {
    try {
      setPhase({ kind: 'building_snapshot' })

      const session = await getSession()
      if (!session?.access_token) throw new Error('Not signed in')

      const insights = buildInsightsSummary(coachView.seedSets)

      const genRes = await fetch('/api/coach/generate-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          client_id: coachView.clientId,
          adjustment_level: level,
          insights_summary: insights,
          coach_token: session.access_token,
          // Create-from-scratch modes don't target a specific existing routine.
          target_routine_id: isCreateFromScratch
            ? undefined
            : selectedRoutineId ?? undefined,
          focus_prompt: focusPrompt.trim() || undefined,
          plan_preferences: isCreateFromScratch && hasAnyPlanPref ? planPrefs : undefined,
        }),
      })
      const genData = await genRes.json()
      if (!genRes.ok) throw new Error(genData.error || 'Failed to build snapshot')
      if (genData.routine_fetch_error) {
        throw new Error(`Hevy routine fetch failed: ${genData.routine_fetch_error}`)
      }

      setPhase({ kind: 'running_ai' })

      const aiRes = await fetch('/api/coach/run-ai-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendation_id: genData.recommendation_id,
          coach_token: session.access_token,
        }),
      })
      const aiData = await aiRes.json()
      if (!aiRes.ok) throw new Error(aiData.error || 'AI call failed')

      setPhase({ kind: 'done', result: aiData })
      onNewResult?.()
    } catch (err: any) {
      setPhase({ kind: 'error', message: err?.message || 'Unexpected error' })
    }
  }

  const isBusy = phase.kind === 'building_snapshot' || phase.kind === 'running_ai'

  // In embedded mode, the parent owns the chrome (CoachWorkspaceTabs has the
  // tab bar). Skip our own header button and always render the body.
  const isEmbedded = mode === 'embedded'

  return (
    <div className={isEmbedded ? '' : 'border-b border-zinc-800 bg-zinc-950/60'}>
      <div className="max-w-6xl mx-auto px-6 py-2">
        {!isEmbedded && (
          <button
            onClick={() => setExpanded((e) => !e)}
            className="w-full flex items-center gap-3 text-left group"
            aria-expanded={expanded}
          >
            <span className="text-xs uppercase tracking-wide text-zinc-500 group-hover:text-zinc-300 transition-colors">
              AI recommendation
            </span>
            {!expanded && (
              <span className="text-sm text-zinc-400 flex-1">
                Generate an adjusted routine from this client's data
              </span>
            )}
            <span className="text-zinc-600 text-xs">{expanded ? '▲' : '▼'}</span>
          </button>
        )}

        {(isEmbedded || expanded) && (
          <div className="pt-3 pb-4 space-y-3">
            {/* Routine picker — only relevant when adjusting an existing routine */}
            {!isCreateFromScratch && (
            <div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">
                Routine to adjust
              </div>
              {routinesState.kind === 'loading' && (
                <div className="text-zinc-500 text-xs">Loading routines from Hevy…</div>
              )}
              {routinesState.kind === 'error' && (
                <div className="text-red-400 text-xs">
                  Failed to load routines: {routinesState.message}
                </div>
              )}
              {routinesState.kind === 'loaded' && routinesState.routines.length === 0 && (
                <div className="text-zinc-500 text-xs">
                  No routines found in this client's Hevy account.
                </div>
              )}
              {routinesState.kind === 'loaded' && routinesState.routines.length > 0 && (
                <div className="flex flex-wrap gap-2">
                  {routinesState.routines.map((r) => (
                    <button
                      key={r.id}
                      onClick={() => setSelectedRoutineId(r.id)}
                      disabled={isBusy}
                      title={`Updated ${new Date(r.updated_at).toLocaleDateString()}`}
                      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 text-left ${
                        selectedRoutineId === r.id
                          ? 'bg-lime-500/15 text-lime-400 border-lime-500/40'
                          : 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                      }`}
                    >
                      <div className="font-medium truncate max-w-[180px]">{r.title}</div>
                      <div className="text-[10px] opacity-70">{r.exercise_count} exercises</div>
                    </button>
                  ))}
                  {routinesState.total > routinesState.routines.length && (
                    <span className="text-zinc-600 text-xs self-center">
                      +{routinesState.total - routinesState.routines.length} more (not shown;
                      older)
                    </span>
                  )}
                </div>
              )}
            </div>
            )}

            {/* Level picker */}
            <div>
              <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">
                Adjustment scope
              </div>
              <div className="flex flex-wrap gap-2">
                {(Object.keys(LEVEL_LABELS) as AdjustmentLevel[]).map((key) => (
                  <button
                    key={key}
                    onClick={() => setLevel(key)}
                    disabled={isBusy}
                    className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
                      level === key
                        ? 'bg-lime-500/15 text-lime-400 border-lime-500/40'
                        : 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:border-zinc-700'
                    }`}
                  >
                    {LEVEL_LABELS[key]}
                  </button>
                ))}
              </div>
            </div>
            <p className="text-zinc-500 text-xs">{LEVEL_DESCRIPTIONS[level]}</p>

            {/* Plan-builder form — only shown for create-from-scratch modes */}
            {isCreateFromScratch && (
              <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
                <PlanBuilderForm
                  value={planPrefs}
                  onChange={setPlanPrefs}
                  disabled={isBusy}
                />
              </div>
            )}

            {/* Focus prompt — required for create-from-scratch modes unless the plan-builder form has been used */}
            <div>
              <div className="flex items-baseline justify-between mb-1.5">
                <div className="text-[11px] uppercase tracking-wide text-zinc-500">
                  {isCreateFromScratch
                    ? hasAnyPlanPref
                      ? 'Anything else? (optional)'
                      : 'Focus / constraints'
                    : 'Focus (optional)'}
                </div>
                {isCreateFromScratch && !focusPrompt.trim() && !hasAnyPlanPref && (
                  <span className="text-[10px] text-amber-400">
                    Pick options above or describe here
                  </span>
                )}
              </div>
              <textarea
                value={focusPrompt}
                onChange={(e) => setFocusPrompt(e.target.value)}
                disabled={isBusy}
                placeholder={
                  isCreateFromScratch
                    ? hasAnyPlanPref
                      ? 'Anything the form can\'t capture: injuries, equipment quirks, "avoid overhead pressing", etc.'
                      : level === 'week_plan'
                        ? 'e.g. 4-day upper/lower split, ~60 min sessions, strength-focused with moderate hypertrophy work. Avoid overhead pressing (shoulder flare-up).'
                        : 'e.g. Fresh hypertrophy routine for chest + back, 3 days/wk, 45-min sessions. No deadlifts (low-back flare-up last month).'
                    : 'Optional context for Claude: "conservative progression this block", "returning from vacation — deload", etc.'
                }
                className="w-full min-h-[96px] px-3 py-2 bg-zinc-900/60 border border-zinc-800 rounded-lg text-zinc-100 text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/40 transition-colors resize-y disabled:opacity-60"
              />
            </div>

            {/* Action */}
            <div className="flex items-center gap-3">
              <button
                onClick={handleGenerate}
                disabled={
                  isBusy ||
                  // Create-from-scratch: require either structured prefs OR free-text focus.
                  (isCreateFromScratch && !focusPrompt.trim() && !hasAnyPlanPref) ||
                  // Adjust-existing modes: require a routine selection once loaded.
                  (!isCreateFromScratch &&
                    (routinesState.kind === 'loading' ||
                      (routinesState.kind === 'loaded' &&
                        routinesState.routines.length > 0 &&
                        !selectedRoutineId)))
                }
                className="px-4 py-2 bg-lime-500 hover:bg-lime-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-semibold text-sm rounded-lg transition-colors"
              >
                {phase.kind === 'building_snapshot'
                  ? 'Building snapshot…'
                  : phase.kind === 'running_ai'
                    ? 'Calling Claude…'
                    : 'Generate recommendation'}
              </button>
              {phase.kind === 'done' && (
                <span className="text-xs text-zinc-500">
                  {phase.result.items.length} items · {phase.result.model} ·{' '}
                  {phase.result.usage.input_tokens ?? '?'} in /{' '}
                  {phase.result.usage.output_tokens ?? '?'} out
                </span>
              )}
            </div>

            {phase.kind === 'error' && (
              <div className="bg-red-500/10 border border-red-500/20 rounded-lg p-3">
                <p className="text-red-400 text-sm">{phase.message}</p>
              </div>
            )}

            {phase.kind === 'done' && (
              <div ref={resultRef} className="scroll-mt-20">
                <ResultView result={phase.result} />
              </div>
            )}
          </div>
        )}
      </div>
    </div>
  )
}

// ─── Push action — Approve & Assign to client's Hevy ──────────────────────

type PushState =
  | { kind: 'idle' }
  | { kind: 'pushing' }
  | { kind: 'pushed'; routine_id: string | null; routine_title: string; dropped: string[] }
  | { kind: 'error'; message: string }

function PushBar({ recommendationId }: { recommendationId: string }) {
  const [state, setState] = useState<PushState>({ kind: 'idle' })

  const handlePush = async () => {
    if (
      !confirm(
        "Push this routine to the client's Hevy account now?\n\n" +
          'It will be created as a new dated routine. The client will see ' +
          'it in their Hevy app immediately.',
      )
    ) {
      return
    }
    setState({ kind: 'pushing' })
    try {
      const session = await getSession()
      if (!session?.access_token) throw new Error('Not signed in')
      const res = await fetch('/api/coach/push-recommendation', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          recommendation_id: recommendationId,
          coach_token: session.access_token,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Push failed')
      setState({
        kind: 'pushed',
        routine_id: data.hevy_routine_id,
        routine_title: data.hevy_routine_title,
        dropped: data.dropped_novel || [],
      })
    } catch (err: any) {
      setState({ kind: 'error', message: err?.message || 'Push failed' })
    }
  }

  if (state.kind === 'pushed') {
    return (
      <div className="rounded-lg border border-lime-500/30 bg-lime-500/10 p-3 mt-3">
        <div className="flex items-baseline gap-2">
          <span className="text-lime-400 text-sm font-medium">✓ Pushed to Hevy</span>
          <span className="text-zinc-300 text-sm">{state.routine_title}</span>
        </div>
        {state.dropped.length > 0 && (
          <p className="text-amber-400 text-xs mt-1">
            Skipped {state.dropped.length} item(s) without an exercise template id:{' '}
            {state.dropped.join(', ')}
          </p>
        )}
        <p className="text-zinc-500 text-[11px] mt-1">
          The client now sees this routine in their Hevy app.
        </p>
      </div>
    )
  }

  return (
    <div className="flex items-center gap-3 pt-2">
      <button
        onClick={handlePush}
        disabled={state.kind === 'pushing'}
        className="px-4 py-2 bg-emerald-500 hover:bg-emerald-400 disabled:bg-zinc-800 disabled:text-zinc-500 text-black font-semibold text-sm rounded-lg transition-colors"
        title="Create as a new dated routine on the client's Hevy account"
      >
        {state.kind === 'pushing' ? 'Pushing to Hevy…' : '✓ Approve & Assign to Hevy'}
      </button>
      {state.kind === 'error' && (
        <span className="text-red-400 text-xs">{state.message}</span>
      )}
    </div>
  )
}

// ─── v0 result view ────────────────────────────────────────────────────────

function ResultView({ result }: { result: AiResult }) {
  // Local state mirrors the per-item coach_action / coach_edited_json /
  // substitution_context — so updates render instantly without a refetch.
  // We seed from result.items, then write through to Supabase on each action.
  const [items, setItems] = useState<AiResultItem[]>(() =>
    result.items.map((i) => ({
      ...i,
      coach_action: (i.coach_action ?? 'pending') as CoachAction,
    })),
  )

  // Re-seed when a new result lands (e.g. coach loaded a saved one).
  useEffect(() => {
    setItems(
      result.items.map((i) => ({
        ...i,
        coach_action: (i.coach_action ?? 'pending') as CoachAction,
      })),
    )
  }, [result.recommendation_id])

  const updateItem = (id: string, patch: Partial<AiResultItem>) => {
    setItems((prev) => prev.map((i) => (i.id === id ? { ...i, ...patch } : i)))
  }

  // ── Bulk: accept all pending ────────────────────────────────────────
  const pendingCount = items.filter((i) => (i.coach_action ?? 'pending') === 'pending').length
  const acceptAll = async () => {
    const pendingIds = items
      .filter((i) => (i.coach_action ?? 'pending') === 'pending')
      .map((i) => i.id)
    if (pendingIds.length === 0) return
    const { error } = await supabase
      .from('training_coach_recommendation_items')
      .update({ coach_action: 'accept' })
      .in('id', pendingIds)
    if (error) {
      alert(`Failed to accept all: ${error.message}`)
      return
    }
    setItems((prev) =>
      prev.map((i) =>
        pendingIds.includes(i.id) ? { ...i, coach_action: 'accept' as CoachAction } : i,
      ),
    )
  }

  // Group by day_label (week_plan mode).
  const hasDayLabels = items.some((i) => i.day_label)
  const groups: Array<{ label: string | null; items: AiResultItem[] }> = []
  if (hasDayLabels) {
    const seen = new Map<string, AiResultItem[]>()
    const order: string[] = []
    for (const item of items) {
      const key = item.day_label ?? '(unlabeled)'
      if (!seen.has(key)) {
        seen.set(key, [])
        order.push(key)
      }
      seen.get(key)!.push(item)
    }
    for (const label of order) {
      groups.push({ label, items: seen.get(label)! })
    }
  } else {
    groups.push({ label: null, items })
  }

  // Counts for summary chip
  const counts = items.reduce(
    (acc, i) => {
      const a = (i.coach_action ?? 'pending') as CoachAction
      acc[a] = (acc[a] ?? 0) + 1
      return acc
    },
    {} as Record<CoachAction, number>,
  )

  return (
    <div className="space-y-3 pt-3 border-t border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Proposal summary</h3>
        <p className="text-sm text-zinc-400 whitespace-pre-wrap">{result.summary}</p>
      </div>

      {/* Bulk action bar */}
      <div className="flex flex-wrap items-center gap-3 pt-1">
        <button
          onClick={acceptAll}
          disabled={pendingCount === 0}
          className="px-3 py-1.5 bg-lime-500/15 hover:bg-lime-500/25 disabled:bg-zinc-800 disabled:text-zinc-600 text-lime-400 border border-lime-500/40 disabled:border-zinc-800 text-xs font-medium rounded-lg transition-colors"
          title="Mark every pending item as accepted"
        >
          ✓ Accept all pending ({pendingCount})
        </button>
        <span className="text-zinc-600 text-[11px]">
          {counts.accept || 0} accepted · {counts.edit || 0} edited · {counts.substitute || 0}{' '}
          substituted · {counts.reject || 0} rejected · {counts.pending || 0} pending
        </span>
      </div>

      <PushBar recommendationId={result.recommendation_id} />

      <div className="space-y-4">
        {groups.map((group, gi) => (
          <div key={group.label ?? `group-${gi}`}>
            {group.label ? (
              <h3 className="text-sm font-semibold text-lime-400 mb-2">{group.label}</h3>
            ) : (
              <h3 className="text-sm font-semibold text-zinc-200 mb-2">Proposed slots</h3>
            )}
            <div className="space-y-2">
              {group.items.map((item) => (
                <ItemRow key={item.id} item={item} onUpdate={updateItem} />
              ))}
            </div>
          </div>
        ))}
      </div>
    </div>
  )
}

// ─── Item row with per-item action controls ──────────────────────────────

function ItemRow({
  item,
  onUpdate,
}: {
  item: AiResultItem
  onUpdate: (id: string, patch: Partial<AiResultItem>) => void
}) {
  const [editing, setEditing] = useState(false)
  const [substituting, setSubstituting] = useState<
    | { kind: 'idle' }
    | { kind: 'asking' }
    | { kind: 'pending'; reason: string }
    | { kind: 'loading' }
    | { kind: 'error'; message: string }
  >({ kind: 'idle' })

  const action: CoachAction = item.coach_action ?? 'pending'
  // The "effective" proposed shown in the right column reflects edits/subs.
  const effectiveProposed =
    (action === 'edit' || action === 'substitute') && item.coach_edited_json
      ? item.coach_edited_json
      : item.proposed_json

  const proposedSets: any[] = Array.isArray(effectiveProposed?.sets)
    ? effectiveProposed.sets
    : []
  const currentSets: any[] = Array.isArray(item.current_json?.sets)
    ? item.current_json.sets
    : []

  const persist = async (patch: {
    coach_action: CoachAction
    coach_edited_json?: any
  }) => {
    const { error } = await supabase
      .from('training_coach_recommendation_items')
      .update(patch)
      .eq('id', item.id)
    if (error) {
      alert(`Update failed: ${error.message}`)
      return false
    }
    onUpdate(item.id, patch as Partial<AiResultItem>)
    return true
  }

  const onAccept = () => {
    void persist({ coach_action: 'accept', coach_edited_json: null })
  }
  const onReject = () => {
    void persist({ coach_action: 'reject', coach_edited_json: null })
  }
  const onResetPending = () => {
    void persist({ coach_action: 'pending', coach_edited_json: null })
  }
  const onSaveEdit = (next: any) => {
    void (async () => {
      const ok = await persist({ coach_action: 'edit', coach_edited_json: next })
      if (ok) setEditing(false)
    })()
  }
  const onAcceptSubstitute = () => {
    const alt = item.substitution_context?.alternative
    if (!alt) return
    // Substitute writes the alternative into coach_edited_json so push uses it.
    // Update the displayed exercise_title locally too so the UI reflects the swap.
    void (async () => {
      const ok = await persist({ coach_action: 'substitute', coach_edited_json: alt.proposed })
      if (ok) {
        onUpdate(item.id, {
          exercise_title: alt.exercise_title,
          exercise_template_id: alt.exercise_template_id,
        })
      }
    })()
  }

  const requestSubstitute = async (reason: string) => {
    setSubstituting({ kind: 'loading' })
    try {
      const session = await getSession()
      if (!session?.access_token) throw new Error('Not signed in')
      const res = await fetch('/api/coach/substitute-item', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          item_id: item.id,
          coach_token: session.access_token,
          reason,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Substitute failed')
      onUpdate(item.id, {
        substitution_context: {
          alternative: data.alternative,
          reason,
        },
      })
      setSubstituting({ kind: 'idle' })
    } catch (err: any) {
      setSubstituting({ kind: 'error', message: err?.message || 'Substitute failed' })
    }
  }

  // ── Visual state ──────────────────────────────────────────────────
  const cardClass =
    action === 'reject'
      ? 'rounded-lg border border-zinc-800 bg-zinc-950/40 p-3 opacity-50'
      : action === 'accept'
        ? 'rounded-lg border border-lime-500/30 bg-zinc-900/40 p-3'
        : action === 'edit'
          ? 'rounded-lg border border-amber-500/40 bg-zinc-900/40 p-3'
          : action === 'substitute'
            ? 'rounded-lg border border-blue-500/40 bg-zinc-900/40 p-3'
            : 'rounded-lg border border-zinc-800 bg-zinc-900/40 p-3'

  return (
    <div className={cardClass}>
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h4
          className={`text-sm font-medium ${
            action === 'reject' ? 'line-through text-zinc-500' : 'text-zinc-100'
          }`}
        >
          {item.position}. {item.exercise_title}
        </h4>
        <div className="flex items-center gap-2">
          {!item.current_json && action !== 'reject' && (
            <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-lime-500/25 bg-lime-500/10 text-lime-400">
              NEW
            </span>
          )}
          <ActionStatusBadge action={action} />
        </div>
      </div>

      <div className="grid grid-cols-1 md:grid-cols-2 gap-3 text-xs">
        <div>
          <div className="text-zinc-500 mb-1">Current</div>
          {currentSets.length ? (
            <SetList sets={currentSets} />
          ) : (
            <div className="text-zinc-600 italic">— not in current routine —</div>
          )}
        </div>
        <div>
          <div
            className={
              action === 'edit' || action === 'substitute' ? 'text-amber-400 mb-1' : 'text-lime-400 mb-1'
            }
          >
            {action === 'edit' ? 'Edited' : action === 'substitute' ? 'Substitute' : 'Proposed'}
          </div>
          {editing ? (
            <SetEditor initial={effectiveProposed} onCancel={() => setEditing(false)} onSave={onSaveEdit} />
          ) : (
            <SetList sets={proposedSets} />
          )}
        </div>
      </div>

      {item.rationale && !editing && (
        <p className="text-zinc-400 text-xs mt-3 italic border-l-2 border-zinc-700 pl-2">
          {item.rationale}
        </p>
      )}

      {/* Substitute UI */}
      {substituting.kind !== 'idle' && (
        <div className="mt-3 rounded border border-blue-500/30 bg-blue-500/5 p-2">
          {substituting.kind === 'asking' && (
            <SubstitutePromptForm
              onCancel={() => setSubstituting({ kind: 'idle' })}
              onSubmit={(reason) => void requestSubstitute(reason)}
            />
          )}
          {substituting.kind === 'loading' && (
            <p className="text-zinc-400 text-xs py-2">Asking Claude for an alternative…</p>
          )}
          {substituting.kind === 'error' && (
            <div className="space-y-1">
              <p className="text-red-400 text-xs">{substituting.message}</p>
              <button
                onClick={() => setSubstituting({ kind: 'asking' })}
                className="text-zinc-400 hover:text-zinc-200 text-xs underline"
              >
                Try again
              </button>
            </div>
          )}
        </div>
      )}

      {item.substitution_context?.alternative && action !== 'substitute' && (
        <SubstitutePreview
          alternative={item.substitution_context.alternative}
          onAccept={onAcceptSubstitute}
          onTryAgain={() =>
            setSubstituting({
              kind: 'asking',
            })
          }
          onDismiss={() =>
            onUpdate(item.id, {
              substitution_context: null,
            })
          }
        />
      )}

      {/* Action bar */}
      {!editing && (
        <div className="mt-3 flex flex-wrap gap-2">
          <ActionButton
            onClick={onAccept}
            active={action === 'accept'}
            label="Accept"
            tone="lime"
          />
          <ActionButton
            onClick={() => setEditing(true)}
            active={action === 'edit'}
            label="Edit"
            tone="amber"
          />
          <ActionButton
            onClick={() => setSubstituting({ kind: 'asking' })}
            active={action === 'substitute'}
            label="Substitute"
            tone="blue"
          />
          <ActionButton
            onClick={onReject}
            active={action === 'reject'}
            label="Reject"
            tone="red"
          />
          {action !== 'pending' && (
            <button
              onClick={onResetPending}
              className="text-zinc-500 hover:text-zinc-300 text-[11px] px-2 py-1 transition-colors ml-auto"
              title="Reset this item to pending"
            >
              ↺ Reset
            </button>
          )}
        </div>
      )}
    </div>
  )
}

// ─── Action UI bits ───────────────────────────────────────────────────────

function ActionButton({
  onClick,
  active,
  label,
  tone,
}: {
  onClick: () => void
  active: boolean
  label: string
  tone: 'lime' | 'amber' | 'blue' | 'red'
}) {
  const toneClasses: Record<typeof tone, { active: string; idle: string }> = {
    lime: {
      active: 'bg-lime-500/20 text-lime-300 border-lime-500/50',
      idle: 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-lime-500/40 hover:text-lime-400',
    },
    amber: {
      active: 'bg-amber-500/20 text-amber-300 border-amber-500/50',
      idle: 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-amber-500/40 hover:text-amber-400',
    },
    blue: {
      active: 'bg-blue-500/20 text-blue-300 border-blue-500/50',
      idle: 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-blue-500/40 hover:text-blue-400',
    },
    red: {
      active: 'bg-red-500/20 text-red-300 border-red-500/50',
      idle: 'bg-zinc-900 text-zinc-400 border-zinc-800 hover:border-red-500/40 hover:text-red-400',
    },
  }
  return (
    <button
      onClick={onClick}
      className={`px-3 py-1 text-[11px] font-medium rounded border transition-colors ${
        active ? toneClasses[tone].active : toneClasses[tone].idle
      }`}
    >
      {label}
    </button>
  )
}

function ActionStatusBadge({ action }: { action: CoachAction }) {
  if (action === 'pending') return null
  const labels: Record<CoachAction, { text: string; cls: string }> = {
    pending: { text: 'PENDING', cls: 'border-zinc-700 text-zinc-500' },
    accept: { text: '✓ ACCEPTED', cls: 'border-lime-500/40 text-lime-400' },
    edit: { text: '✎ EDITED', cls: 'border-amber-500/40 text-amber-400' },
    reject: { text: '✕ REJECTED', cls: 'border-red-500/40 text-red-400' },
    substitute: { text: '↔ SUBSTITUTED', cls: 'border-blue-500/40 text-blue-400' },
  }
  const { text, cls } = labels[action]
  return (
    <span className={`text-[10px] px-1.5 py-0.5 rounded-full border ${cls}`}>{text}</span>
  )
}

// ─── Inline set editor ────────────────────────────────────────────────────

function SetEditor({
  initial,
  onCancel,
  onSave,
}: {
  initial: any
  onCancel: () => void
  onSave: (next: any) => void
}) {
  const initSets: any[] = Array.isArray(initial?.sets) ? initial.sets : []
  const [sets, setSets] = useState<any[]>(() => initSets.map((s) => ({ ...s })))

  const updateSet = (i: number, patch: any) => {
    setSets((prev) => prev.map((s, idx) => (idx === i ? { ...s, ...patch } : s)))
  }
  const addSet = () => {
    const last = sets[sets.length - 1] || { type: 'normal' }
    setSets((prev) => [...prev, { ...last }])
  }
  const removeSet = (i: number) => {
    setSets((prev) => prev.filter((_, idx) => idx !== i))
  }

  const save = () => {
    onSave({ ...initial, sets })
  }

  // Coach inputs in lbs (US-defaulted), but the underlying storage and Hevy
  // payload stays in kg. Convert in/out so the inputs feel natural while
  // weight_kg remains the source of truth.
  const lbsDisplay = (kg: number | null | undefined): string =>
    kg == null ? '' : String(Math.round(kg * 2.20462 * 10) / 10)
  const parseLbsToKg = (raw: string): number | null => {
    if (raw === '' || raw == null) return null
    const lbs = Number(raw)
    if (!Number.isFinite(lbs)) return null
    return Math.round((lbs / 2.20462) * 1000) / 1000
  }

  return (
    <div className="space-y-1.5">
      <table className="w-full text-[11px] font-mono">
        <thead>
          <tr className="text-zinc-500">
            <th className="text-left font-normal">#</th>
            <th className="text-left font-normal">Type</th>
            <th className="text-left font-normal">Wt (lbs)</th>
            <th className="text-left font-normal">Reps</th>
            <th className="text-left font-normal">RPE</th>
            <th></th>
          </tr>
        </thead>
        <tbody>
          {sets.map((s, i) => (
            <tr key={i}>
              <td className="text-zinc-500 pr-1">{i + 1}</td>
              <td>
                <select
                  value={s.type || 'normal'}
                  onChange={(e) => updateSet(i, { type: e.target.value })}
                  className="bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-100"
                >
                  <option value="warmup">W</option>
                  <option value="normal">N</option>
                  <option value="failure">F</option>
                  <option value="dropset">D</option>
                </select>
              </td>
              <td>
                <input
                  type="number"
                  step="0.5"
                  value={lbsDisplay(s.weight_kg)}
                  onChange={(e) =>
                    updateSet(i, { weight_kg: parseLbsToKg(e.target.value) })
                  }
                  className="w-16 bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-100"
                />
              </td>
              <td>
                <input
                  type="number"
                  value={s.reps ?? ''}
                  onChange={(e) =>
                    updateSet(i, { reps: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className="w-12 bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-100"
                />
              </td>
              <td>
                <input
                  type="number"
                  step="0.5"
                  value={s.rpe ?? ''}
                  onChange={(e) =>
                    updateSet(i, { rpe: e.target.value === '' ? null : Number(e.target.value) })
                  }
                  className="w-12 bg-zinc-800 border border-zinc-700 rounded px-1 text-zinc-100"
                />
              </td>
              <td>
                <button
                  onClick={() => removeSet(i)}
                  className="text-zinc-500 hover:text-red-400 text-xs px-1"
                  title="Remove set"
                >
                  ×
                </button>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="flex gap-2 pt-1">
        <button
          onClick={addSet}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 hover:border-zinc-600 rounded px-2 py-0.5"
        >
          + add set
        </button>
        <div className="ml-auto flex gap-1">
          <button
            onClick={onCancel}
            className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-0.5"
          >
            Cancel
          </button>
          <button
            onClick={save}
            className="text-[11px] bg-amber-500/15 hover:bg-amber-500/25 text-amber-300 border border-amber-500/40 rounded px-2 py-0.5"
          >
            Save edit
          </button>
        </div>
      </div>
    </div>
  )
}

// ─── Substitute UI ────────────────────────────────────────────────────────

function SubstitutePromptForm({
  onCancel,
  onSubmit,
}: {
  onCancel: () => void
  onSubmit: (reason: string) => void
}) {
  const [reason, setReason] = useState('')
  return (
    <div className="space-y-2">
      <p className="text-zinc-400 text-xs">
        Why do you want to swap this exercise? (optional — Claude will pick a sensible
        alternative either way)
      </p>
      <textarea
        value={reason}
        onChange={(e) => setReason(e.target.value)}
        placeholder="e.g. equipment unavailable, redundant with another slot, knee flare-up…"
        className="w-full min-h-[60px] px-2 py-1.5 bg-zinc-900 border border-zinc-800 rounded text-zinc-100 text-xs"
      />
      <div className="flex gap-2 justify-end">
        <button
          onClick={onCancel}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 px-2 py-0.5"
        >
          Cancel
        </button>
        <button
          onClick={() => onSubmit(reason)}
          className="text-[11px] bg-blue-500/15 hover:bg-blue-500/25 text-blue-300 border border-blue-500/40 rounded px-2 py-0.5"
        >
          Get suggestion
        </button>
      </div>
    </div>
  )
}

function SubstitutePreview({
  alternative,
  onAccept,
  onTryAgain,
  onDismiss,
}: {
  alternative: {
    exercise_template_id: string | null
    exercise_title: string
    proposed: any
    rationale: string
  }
  onAccept: () => void
  onTryAgain: () => void
  onDismiss: () => void
}) {
  const sets: any[] = Array.isArray(alternative.proposed?.sets) ? alternative.proposed.sets : []
  return (
    <div className="mt-3 rounded border border-blue-500/30 bg-blue-500/5 p-3">
      <div className="flex items-baseline justify-between gap-2 mb-1">
        <h5 className="text-blue-300 text-sm font-medium">
          ↔ Suggested swap: {alternative.exercise_title}
        </h5>
      </div>
      <SetList sets={sets} />
      <p className="text-zinc-400 text-xs mt-2 italic border-l-2 border-blue-500/30 pl-2">
        {alternative.rationale}
      </p>
      <div className="flex gap-2 mt-2">
        <button
          onClick={onAccept}
          className="text-[11px] bg-blue-500/20 hover:bg-blue-500/30 text-blue-200 border border-blue-500/50 rounded px-2 py-0.5"
        >
          Accept this swap
        </button>
        <button
          onClick={onTryAgain}
          className="text-[11px] text-zinc-400 hover:text-zinc-200 border border-zinc-800 rounded px-2 py-0.5"
        >
          Try a different one
        </button>
        <button
          onClick={onDismiss}
          className="text-[11px] text-zinc-500 hover:text-zinc-300 px-2 py-0.5"
        >
          Dismiss
        </button>
      </div>
    </div>
  )
}

function SetList({ sets }: { sets: any[] }) {
  return (
    <ul className="space-y-0.5">
      {sets.map((s, i) => {
        const w = s.weight_kg
        const r = s.reps
        const rpe = s.rpe
        const parts: string[] = []
        if (w != null) parts.push(`${kgToLbs(w)} lbs`)
        if (r != null) parts.push(`×${r}`)
        if (rpe != null) parts.push(`@${rpe}`)
        if (!parts.length && s.duration_seconds) parts.push(`${s.duration_seconds}s`)
        const label = parts.join(' ') || '(no prescription)'
        return (
          <li key={i} className="text-zinc-300 font-mono">
            {s.type === 'warmup' ? 'W' : s.type === 'failure' ? 'F' : s.type === 'dropset' ? 'D' : i + 1}{' '}
            {label}
          </li>
        )
      })}
    </ul>
  )
}

function kgToLbs(kg: number): number {
  return Math.round(kg * 2.20462 * 10) / 10
}
