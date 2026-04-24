/**
 * PlanBuilderForm
 * ────────────────────────────────────────────────────────────────────────────
 * Tonal-style structured inputs for overhaul / week_plan modes. Mirrors the
 * tonal.kpifit.com onboarding: goal, days/wk, session length, split,
 * equipment — then a free-text "Anything else?" textarea for things a form
 * can't capture.
 *
 * Writes straight to a PlanPreferences object the parent keeps in state.
 */

import React from 'react'
import {
  type PlanPreferences,
  type Goal,
  type Split,
  type Equipment,
  GOAL_LABELS,
  SPLIT_LABELS,
  EQUIPMENT_LABELS,
  DAYS_OPTIONS,
  SESSION_MINUTES_OPTIONS,
} from './planPreferencesTypes'

interface PlanBuilderFormProps {
  value: PlanPreferences
  onChange: (next: PlanPreferences) => void
  disabled?: boolean
}

export function PlanBuilderForm({ value, onChange, disabled }: PlanBuilderFormProps) {
  const set = <K extends keyof PlanPreferences>(key: K, v: PlanPreferences[K]) => {
    onChange({ ...value, [key]: v })
  }

  const toggleEquipment = (eq: Equipment) => {
    const current = value.equipment ?? []
    const next = current.includes(eq) ? current.filter((x) => x !== eq) : [...current, eq]
    onChange({ ...value, equipment: next })
  }

  return (
    <div className="space-y-3">
      {/* Goal */}
      <Field label="Goal">
        <ChipRow>
          {(Object.keys(GOAL_LABELS) as Goal[]).map((g) => (
            <Chip
              key={g}
              active={value.goal === g}
              disabled={disabled}
              onClick={() => set('goal', value.goal === g ? undefined : g)}
            >
              {GOAL_LABELS[g]}
            </Chip>
          ))}
        </ChipRow>
      </Field>

      {/* Days/wk */}
      <Field label="Days per week">
        <ChipRow>
          {DAYS_OPTIONS.map((d) => (
            <Chip
              key={d}
              active={value.days_per_week === d}
              disabled={disabled}
              onClick={() => set('days_per_week', value.days_per_week === d ? undefined : d)}
            >
              {d}
            </Chip>
          ))}
        </ChipRow>
      </Field>

      {/* Session length */}
      <Field label="Session length">
        <ChipRow>
          {SESSION_MINUTES_OPTIONS.map((m) => (
            <Chip
              key={m}
              active={value.session_minutes === m}
              disabled={disabled}
              onClick={() => set('session_minutes', value.session_minutes === m ? undefined : m)}
            >
              {m} min
            </Chip>
          ))}
        </ChipRow>
      </Field>

      {/* Split */}
      <Field label="Training split">
        <ChipRow>
          {(Object.keys(SPLIT_LABELS) as Split[]).map((s) => (
            <Chip
              key={s}
              active={value.split === s}
              disabled={disabled}
              onClick={() => set('split', value.split === s ? undefined : s)}
            >
              {SPLIT_LABELS[s]}
            </Chip>
          ))}
        </ChipRow>
      </Field>

      {/* Equipment (multi-select) */}
      <Field label="Equipment (pick any)">
        <ChipRow>
          {(Object.keys(EQUIPMENT_LABELS) as Equipment[]).map((e) => (
            <Chip
              key={e}
              active={(value.equipment ?? []).includes(e)}
              disabled={disabled}
              onClick={() => toggleEquipment(e)}
            >
              {EQUIPMENT_LABELS[e]}
            </Chip>
          ))}
        </ChipRow>
      </Field>
    </div>
  )
}

// ─── Local UI primitives ───────────────────────────────────────────────────

function Field({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div>
      <div className="text-[11px] uppercase tracking-wide text-zinc-500 mb-1.5">{label}</div>
      {children}
    </div>
  )
}

function ChipRow({ children }: { children: React.ReactNode }) {
  return <div className="flex flex-wrap gap-2">{children}</div>
}

function Chip({
  active,
  disabled,
  onClick,
  children,
}: {
  active: boolean
  disabled?: boolean
  onClick: () => void
  children: React.ReactNode
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      className={`px-3 py-1.5 text-xs rounded-lg border transition-colors disabled:opacity-50 ${
        active
          ? 'bg-lime-500/15 text-lime-400 border-lime-500/40'
          : 'bg-zinc-900/60 text-zinc-400 border-zinc-800 hover:border-zinc-700'
      }`}
    >
      {children}
    </button>
  )
}
