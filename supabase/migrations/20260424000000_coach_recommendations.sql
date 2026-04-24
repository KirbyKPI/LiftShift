-- KPIFit Training — Coach-driven AI routine recommendations
-- ────────────────────────────────────────────────────────────────────────────
-- Phase 1 of the recommend/review/push flow. This migration adds three
-- tables, all prefixed `training_coach_` to stay scoped to this feature
-- within the shared Supabase project (kpifit-assess coexists in the same
-- project with its own table prefixes).
--
-- Tables:
--   training_coach_recommendations       — one row per AI generation
--   training_coach_recommendation_items  — per-exercise rows the coach reviews
--   training_coach_routine_push_audit    — what got pushed to Hevy, when, result
--
-- RLS model: all three follow the same pattern as existing training_* tables —
-- a coach can only see/modify rows tied to clients they own
-- (training_clients → training_coaches → auth.uid()).


-- ─── Recommendations (header row per AI generation) ────────────────────────
CREATE TABLE IF NOT EXISTS training_coach_recommendations (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES training_clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES training_coaches(id) ON DELETE CASCADE,

  -- Three-way scope toggle the coach picks at generation time.
  adjustment_level TEXT NOT NULL
    CHECK (adjustment_level IN ('load_only', 'load_plus_swap', 'full_authoring')),

  -- Lifecycle:
  --   draft              — row created, snapshot built, waiting on AI call
  --   awaiting_review    — AI returned, items written, coach hasn't touched yet
  --   partially_reviewed — some items actioned, others still pending
  --   approved           — every item has a non-pending action
  --   pushed             — approved set has been written to Hevy (see audit)
  --   rejected           — coach bailed on the whole thing
  --   failed             — AI call or Hevy fetch errored
  status TEXT NOT NULL DEFAULT 'draft'
    CHECK (status IN (
      'draft',
      'awaiting_review',
      'partially_reviewed',
      'approved',
      'pushed',
      'rejected',
      'failed'
    )),

  -- The full input payload sent to Claude (insights + recent sets + current
  -- routine + notes). Stored for reproducibility / debugging.
  ai_snapshot JSONB,

  -- Raw Claude response, including tool-call or structured JSON body.
  ai_response_raw JSONB,

  -- Free text for human-facing notes on this recommendation (e.g.
  -- "Initial pass for Apr-27 block"). Optional.
  coach_note TEXT,

  -- Short message surfaced in the UI if status='failed'.
  error_message TEXT,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  pushed_at TIMESTAMPTZ
);

CREATE INDEX idx_training_coach_recs_client ON training_coach_recommendations(client_id);
CREATE INDEX idx_training_coach_recs_coach ON training_coach_recommendations(coach_id);
CREATE INDEX idx_training_coach_recs_status ON training_coach_recommendations(status);

ALTER TABLE training_coach_recommendations ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_recs_own_coach" ON training_coach_recommendations
  FOR ALL USING (
    coach_id IN (SELECT id FROM training_coaches WHERE user_id = auth.uid())
  );


-- ─── Recommendation items (one row per proposed exercise slot) ─────────────
CREATE TABLE IF NOT EXISTS training_coach_recommendation_items (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES training_coach_recommendations(id) ON DELETE CASCADE,

  -- Order within the proposed routine. Kept as INT to allow insertion via
  -- midpoint renumbering without full reshuffle.
  position INT NOT NULL,

  -- Hevy's exercise_template_id if Claude picked from the known library.
  -- NULL for novel/custom slots (less likely with load_only, possible with
  -- full_authoring).
  exercise_template_id TEXT,
  exercise_title TEXT NOT NULL,

  -- Snapshot of the slot as it exists in the client's current Hevy routine
  -- (matched by exercise_template_id if possible, else fuzzy by title). NULL
  -- if this is a new slot Claude added.
  current_json JSONB,

  -- Claude's proposed slot: sets array, rest seconds, rep ranges, notes, etc.
  -- Shape mirrors Hevy's routine-exercise shape so push is a direct map.
  proposed_json JSONB NOT NULL,

  -- Claude's short justification for this specific proposal. Rendered in
  -- the review UI next to the diff.
  rationale TEXT,

  -- Coach review state for this item.
  --   pending     — not yet reviewed
  --   accept      — take proposed_json as-is
  --   edit        — coach tweaked; see coach_edited_json
  --   reject      — drop this item (don't include in push)
  --   substitute  — coach asked for an alternative; see substitution_context
  coach_action TEXT NOT NULL DEFAULT 'pending'
    CHECK (coach_action IN ('pending', 'accept', 'edit', 'reject', 'substitute')),

  -- When coach_action='edit' or 'substitute': the final version the coach
  -- approved. Supersedes proposed_json at push time.
  coach_edited_json JSONB,

  -- When coach_action='substitute': the alternative Claude suggested for
  -- this specific slot on a follow-up call, plus the rationale. The coach
  -- still has to accept/edit the substitute to lock it in.
  substitution_context JSONB,

  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_coach_rec_items_rec
  ON training_coach_recommendation_items(recommendation_id);
CREATE INDEX idx_training_coach_rec_items_action
  ON training_coach_recommendation_items(coach_action);

ALTER TABLE training_coach_recommendation_items ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_rec_items_own_coach" ON training_coach_recommendation_items
  FOR ALL USING (
    recommendation_id IN (
      SELECT r.id FROM training_coach_recommendations r
      JOIN training_coaches co ON r.coach_id = co.id
      WHERE co.user_id = auth.uid()
    )
  );


-- ─── Push audit (one row per Hevy write attempt) ───────────────────────────
CREATE TABLE IF NOT EXISTS training_coach_routine_push_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  recommendation_id UUID NOT NULL REFERENCES training_coach_recommendations(id) ON DELETE CASCADE,
  client_id UUID NOT NULL REFERENCES training_clients(id) ON DELETE CASCADE,
  coach_id UUID NOT NULL REFERENCES training_coaches(id) ON DELETE CASCADE,

  -- Hevy's identifier for the new routine we created. Policy: always
  -- POST a new dated routine (e.g. "KPI Coach — Wk of Apr 27"), never
  -- PUT over the client's existing routines. Preserves history + undo.
  hevy_routine_id TEXT,
  hevy_routine_title TEXT,

  -- What we sent and what Hevy said back. Full blobs for forensics.
  payload_sent JSONB NOT NULL,
  response_received JSONB,

  status TEXT NOT NULL
    CHECK (status IN ('success', 'failed', 'partial')),
  error_message TEXT,

  pushed_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_coach_push_rec
  ON training_coach_routine_push_audit(recommendation_id);
CREATE INDEX idx_training_coach_push_client
  ON training_coach_routine_push_audit(client_id);

ALTER TABLE training_coach_routine_push_audit ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coach_push_audit_own_coach" ON training_coach_routine_push_audit
  FOR ALL USING (
    coach_id IN (SELECT id FROM training_coaches WHERE user_id = auth.uid())
  );


-- ─── updated_at helper + triggers ──────────────────────────────────────────
-- CREATE OR REPLACE so we can safely re-run this migration; if an earlier
-- migration already defines it we don't conflict.

CREATE OR REPLACE FUNCTION public.set_updated_at()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  NEW.updated_at = now();
  RETURN NEW;
END;
$$;

CREATE TRIGGER set_updated_at_training_coach_recommendations
  BEFORE UPDATE ON training_coach_recommendations
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();

CREATE TRIGGER set_updated_at_training_coach_recommendation_items
  BEFORE UPDATE ON training_coach_recommendation_items
  FOR EACH ROW EXECUTE FUNCTION public.set_updated_at();
