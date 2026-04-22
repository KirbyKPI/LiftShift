import { createClient } from '@supabase/supabase-js'

const supabaseUrl = import.meta.env.VITE_SUPABASE_URL || ''
const supabaseAnonKey = import.meta.env.VITE_SUPABASE_ANON_KEY || ''

export const supabase = createClient(supabaseUrl, supabaseAnonKey)

// ─── Types ──────────────────────────────────────────────────────────────────

export interface Coach {
  id: string
  user_id: string
  display_name: string
  email: string
  created_at: string
}

export interface TrainingClient {
  id: string
  coach_id: string
  name: string
  email: string | null
  notes: string | null
  created_at: string
  updated_at: string
}

export interface TrainingHevyConnection {
  id: string
  client_id: string
  hevy_username: string | null
  connection_status: 'active' | 'error' | 'expired'
  last_sync_at: string | null
  last_error: string | null
  sync_failure_count: number
  created_at: string
  updated_at: string
}

export interface TrainingConnectCode {
  id: string
  coach_id: string
  client_id: string | null
  code: string
  client_name: string
  expires_at: string
  used_at: string | null
  created_at: string
}

export interface TrainingWorkoutLog {
  id: string
  client_id: string
  hevy_workout_id: string
  workout_date: string
  workout_name: string
  duration_seconds: number
  exercises: any
  source: 'hevy_api' | 'manual_upload'
  last_synced_at: string
}

// ─── Client with connection info (joined query) ─────────────────────────────

export interface ClientWithConnection extends TrainingClient {
  hevy_connection: TrainingHevyConnection | null
  workout_count?: number
}
