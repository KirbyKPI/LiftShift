-- KPIFit Training — Supabase tables for coach/client Hevy integration
-- These are prefixed with training_ to coexist with kpifit-assess tables

-- ─── Coaches ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_coaches (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id UUID NOT NULL UNIQUE REFERENCES auth.users(id) ON DELETE CASCADE,
  display_name TEXT NOT NULL,
  email TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE training_coaches ENABLE ROW LEVEL SECURITY;
CREATE POLICY "coaches_own" ON training_coaches
  FOR ALL USING (auth.uid() = user_id);

-- ─── Clients ────────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_clients (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES training_coaches(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT,
  notes TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_clients_coach ON training_clients(coach_id);
ALTER TABLE training_clients ENABLE ROW LEVEL SECURITY;
CREATE POLICY "clients_own_coach" ON training_clients
  FOR ALL USING (
    coach_id IN (SELECT id FROM training_coaches WHERE user_id = auth.uid())
  );

-- ─── Hevy Connections (encrypted API keys) ──────────────────────────────────
CREATE TABLE IF NOT EXISTS training_hevy_connections (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES training_clients(id) ON DELETE CASCADE,
  hevy_api_key_encrypted TEXT NOT NULL,
  hevy_username TEXT,
  connection_status TEXT NOT NULL DEFAULT 'active'
    CHECK (connection_status IN ('active', 'error', 'expired')),
  last_sync_at TIMESTAMPTZ,
  last_error TEXT,
  sync_failure_count INT NOT NULL DEFAULT 0,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_hevy_conn_client ON training_hevy_connections(client_id);
ALTER TABLE training_hevy_connections ENABLE ROW LEVEL SECURITY;
CREATE POLICY "hevy_conn_own_coach" ON training_hevy_connections
  FOR ALL USING (
    client_id IN (
      SELECT tc.id FROM training_clients tc
      JOIN training_coaches co ON tc.coach_id = co.id
      WHERE co.user_id = auth.uid()
    )
  );

-- ─── Connect Codes (shareable links for clients) ────────────────────────────
CREATE TABLE IF NOT EXISTS training_connect_codes (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  coach_id UUID NOT NULL REFERENCES training_coaches(id) ON DELETE CASCADE,
  client_id UUID REFERENCES training_clients(id) ON DELETE SET NULL,
  code TEXT NOT NULL UNIQUE,
  client_name TEXT NOT NULL,
  expires_at TIMESTAMPTZ NOT NULL DEFAULT (now() + interval '7 days'),
  used_at TIMESTAMPTZ,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE INDEX idx_training_codes_code ON training_connect_codes(code);
ALTER TABLE training_connect_codes ENABLE ROW LEVEL SECURITY;

-- Coaches can manage their own codes
CREATE POLICY "codes_own_coach" ON training_connect_codes
  FOR ALL USING (
    coach_id IN (SELECT id FROM training_coaches WHERE user_id = auth.uid())
  );

-- Anyone can read unexpired, unused codes (for the connect flow)
CREATE POLICY "codes_public_read" ON training_connect_codes
  FOR SELECT USING (used_at IS NULL AND expires_at > now());

-- ─── Workout Cache ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_workout_cache (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL REFERENCES training_clients(id) ON DELETE CASCADE,
  hevy_workout_id TEXT,
  workout_date DATE NOT NULL,
  workout_name TEXT,
  duration_seconds INT,
  exercises JSONB NOT NULL DEFAULT '[]',
  source TEXT NOT NULL DEFAULT 'hevy_api'
    CHECK (source IN ('hevy_api', 'manual_upload')),
  last_synced_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  UNIQUE(client_id, hevy_workout_id)
);

CREATE INDEX idx_training_cache_client ON training_workout_cache(client_id);
CREATE INDEX idx_training_cache_date ON training_workout_cache(client_id, workout_date DESC);
ALTER TABLE training_workout_cache ENABLE ROW LEVEL SECURITY;
CREATE POLICY "cache_own_coach" ON training_workout_cache
  FOR ALL USING (
    client_id IN (
      SELECT tc.id FROM training_clients tc
      JOIN training_coaches co ON tc.coach_id = co.id
      WHERE co.user_id = auth.uid()
    )
  );

-- ─── Sync Metadata ──────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS training_sync_metadata (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  client_id UUID NOT NULL UNIQUE REFERENCES training_clients(id) ON DELETE CASCADE,
  last_api_fetch_at TIMESTAMPTZ,
  total_workouts_synced INT NOT NULL DEFAULT 0,
  sync_cache_ttl_minutes INT NOT NULL DEFAULT 60,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

ALTER TABLE training_sync_metadata ENABLE ROW LEVEL SECURITY;
CREATE POLICY "sync_meta_own_coach" ON training_sync_metadata
  FOR ALL USING (
    client_id IN (
      SELECT tc.id FROM training_clients tc
      JOIN training_coaches co ON tc.coach_id = co.id
      WHERE co.user_id = auth.uid()
    )
  );
