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

interface AiResultItem {
  id: string
  position: number
  exercise_title: string
  exercise_template_id: string | null
  current_json: any
  proposed_json: any
  rationale: string | null
  day_label: string | null
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
}

export function GenerateRecommendationPanel({
  externalResult,
  onNewResult,
}: GenerateRecommendationPanelProps = {}) {
  const coachView = useCoachView()
  const [expanded, setExpanded] = useState(false)
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

  return (
    <div className="border-b border-zinc-800 bg-zinc-950/60">
      <div className="max-w-6xl mx-auto px-6 py-2">
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

        {expanded && (
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

// ─── v0 result view ────────────────────────────────────────────────────────

function ResultView({ result }: { result: AiResult }) {
  // Group by day_label if any items have one (week_plan mode). Preserve the
  // original ordering by first-appearance of each label.
  const hasDayLabels = result.items.some((i) => i.day_label)
  const groups: Array<{ label: string | null; items: AiResultItem[] }> = []
  if (hasDayLabels) {
    const seen = new Map<string, AiResultItem[]>()
    const order: string[] = []
    for (const item of result.items) {
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
    groups.push({ label: null, items: result.items })
  }

  return (
    <div className="space-y-3 pt-3 border-t border-zinc-800">
      <div>
        <h3 className="text-sm font-semibold text-zinc-200 mb-1">Proposal summary</h3>
        <p className="text-sm text-zinc-400 whitespace-pre-wrap">{result.summary}</p>
      </div>

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
                <ItemRow key={item.id} item={item} />
              ))}
            </div>
          </div>
        ))}
      </div>

      <p className="text-zinc-600 text-[11px] pt-2">
        This is a v0 preview. Accept / edit / reject controls arrive in Phase 3.
      </p>
    </div>
  )
}

function ItemRow({ item }: { item: AiResultItem }) {
  const proposedSets: any[] = Array.isArray(item.proposed_json?.sets)
    ? item.proposed_json.sets
    : []
  const currentSets: any[] = Array.isArray(item.current_json?.sets)
    ? item.current_json.sets
    : []

  return (
    <div className="rounded-lg border border-zinc-800 bg-zinc-900/40 p-3">
      <div className="flex items-baseline justify-between gap-3 mb-2">
        <h4 className="text-sm font-medium text-zinc-100">
          {item.position}. {item.exercise_title}
        </h4>
        {!item.current_json && (
          <span className="text-[10px] px-1.5 py-0.5 rounded-full border border-lime-500/25 bg-lime-500/10 text-lime-400">
            NEW
          </span>
        )}
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
          <div className="text-lime-400 mb-1">Proposed</div>
          <SetList sets={proposedSets} />
        </div>
      </div>

      {item.rationale && (
        <p className="text-zinc-400 text-xs mt-3 italic border-l-2 border-zinc-700 pl-2">
          {item.rationale}
        </p>
      )}
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
