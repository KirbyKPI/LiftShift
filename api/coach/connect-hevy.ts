/**
 * POST /api/coach/connect-hevy
 * ────────────────────────────────────────────────────────────────────────────
 * Coach pastes their personal Hevy Pro API key here. We validate it against
 * the Hevy public API, encrypt it, and store it in
 * training_coach_hevy_connections so push-recommendation.ts can use it to
 * push routines into the coach's own Hevy library.
 *
 * Workflow:
 *   1. Coach hits Hevy Pro -> Settings -> Developer -> generates an API key
 *   2. Coach pastes it into the Settings panel in this app
 *   3. We POST it here, validate via /v1/workouts, encrypt, store
 *   4. push-recommendation.ts later reads + decrypts on Approve & Assign
 *
 * Modes:
 *   - mode='save'    : validate + store (default)
 *   - mode='test'    : validate only, no storage
 *   - mode='status'  : return whether a connection exists for this coach
 *   - mode='disconnect': delete the row
 *
 * Why coach-side vs client-side: pushing to a client's Hevy account dumps
 * the routine into their library — they have to manually adopt it. Pushing
 * to the coach's account drops it in the coach's Hevy library, where they
 * can use Hevy Coach's "Assign Workout Program" UI to deliver it to the
 * client + get tracking + completion notifications.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

// ─── AES-256-CBC (mirrors api/hevy/connect.ts) ─────────────────────────────

async function encryptApiKey(plaintext: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)),
  ).slice(0, 32)
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encoded = new TextEncoder().encode(plaintext)
  const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoded)
  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('')
  const ctHex = Array.from(new Uint8Array(ct)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${ivHex}:${ctHex}`
}

async function validateHevyKey(
  apiKey: string,
): Promise<{ valid: boolean; workout_count?: number; error?: string }> {
  try {
    const res = await fetch('https://api.hevyapp.com/v1/workouts?page=1&page_size=1', {
      headers: { 'api-key': apiKey, accept: 'application/json' },
    })
    if (res.status === 401) return { valid: false, error: 'API key rejected (401)' }
    if (!res.ok) return { valid: false, error: `Hevy returned ${res.status}` }
    const data = await res.json()
    return { valid: true, workout_count: data.page_count ?? 0 }
  } catch (e: any) {
    return { valid: false, error: e?.message || 'Network error reaching Hevy' }
  }
}

// ─── Handler ───────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { mode = 'save', api_key, coach_token } = (req.body || {}) as {
    mode?: 'save' | 'test' | 'status' | 'disconnect'
    api_key?: string
    coach_token?: string
  }

  if (!coach_token) return res.status(400).json({ error: 'coach_token required' })

  try {
    // ── Auth ──────────────────────────────────────────────────────────
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    // ── Status ────────────────────────────────────────────────────────
    if (mode === 'status') {
      const { data: conn } = await supabase
        .from('training_coach_hevy_connections')
        .select('connection_status, last_used_at, last_error, created_at, updated_at')
        .eq('coach_id', coach.id)
        .maybeSingle()
      return res.status(200).json({ connected: !!conn, connection: conn ?? null })
    }

    // ── Disconnect ────────────────────────────────────────────────────
    if (mode === 'disconnect') {
      await supabase
        .from('training_coach_hevy_connections')
        .delete()
        .eq('coach_id', coach.id)
      return res.status(200).json({ success: true })
    }

    if (!api_key || typeof api_key !== 'string' || api_key.trim().length === 0) {
      return res.status(400).json({ error: 'api_key required' })
    }

    // ── Test only ─────────────────────────────────────────────────────
    if (mode === 'test') {
      const validation = await validateHevyKey(api_key.trim())
      return res.status(validation.valid ? 200 : 400).json(validation)
    }

    // ── Save (default): validate + upsert ─────────────────────────────
    const validation = await validateHevyKey(api_key.trim())
    if (!validation.valid) {
      return res.status(400).json({
        error: validation.error || 'Invalid Hevy API key',
      })
    }

    const encrypted = await encryptApiKey(api_key.trim())
    const { error: upsertErr } = await supabase
      .from('training_coach_hevy_connections')
      .upsert(
        {
          coach_id: coach.id,
          hevy_api_key_encrypted: encrypted,
          connection_status: 'active',
          last_error: null,
          updated_at: new Date().toISOString(),
        },
        { onConflict: 'coach_id' },
      )
    if (upsertErr) return res.status(500).json({ error: upsertErr.message })

    return res.status(200).json({
      success: true,
      workout_count: validation.workout_count,
    })
  } catch (err: any) {
    console.error('[connect-hevy] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
