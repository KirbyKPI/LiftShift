/**
 * POST /api/coach/list-routines
 * ────────────────────────────────────────────────────────────────────────────
 * Returns a compact list of the client's current Hevy routines so the coach
 * can pick which one to adjust in a recommendation.
 *
 * Kept deliberately small: just enough metadata to render a chip picker
 * (id, title, exercise count, updated_at). The full routine shape is
 * re-fetched inside generate-recommendation when it actually needs to
 * build the snapshot.
 *
 * Request:  { client_id, coach_token }
 * Response: { routines: [{id, title, exercise_count, updated_at}] }
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const config = {
  maxDuration: 30,
}

// ─── Decrypt (duplicated from sync.ts — same encryption key env var) ───────
async function decryptApiKey(encrypted: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)),
  ).slice(0, 32)

  const [ivHex, ctHex] = encrypted.split(':')
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const ct = new Uint8Array(ctHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

interface HevyRoutineLite {
  id: string
  title: string
  updated_at: string
  created_at: string
  exercises: Array<unknown>
}

async function fetchAllRoutines(apiKey: string): Promise<HevyRoutineLite[]> {
  const all: HevyRoutineLite[] = []
  let page = 1
  const pageSize = 10
  const MAX_PAGES = 20

  while (page <= MAX_PAGES) {
    const res = await fetch(
      `https://api.hevyapp.com/v1/routines?page=${page}&page_size=${pageSize}`,
      { headers: { 'api-key': apiKey, accept: 'application/json' } },
    )
    if (res.status === 401) throw new Error('API_KEY_EXPIRED')
    if (!res.ok) throw new Error(`Hevy API error: ${res.status}`)

    const data = await res.json()
    const routines: HevyRoutineLite[] = data.routines || []
    all.push(...routines)
    if (routines.length < pageSize || page >= (data.page_count || 1)) break
    page++
    await new Promise((r) => setTimeout(r, 150))
  }
  return all
}

export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { client_id, coach_token } = (req.body || {}) as {
    client_id?: string
    coach_token?: string
  }
  if (!client_id || !coach_token) {
    return res.status(400).json({ error: 'client_id and coach_token required' })
  }

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    const { data: client } = await supabase
      .from('training_clients')
      .select('coach_id')
      .eq('id', client_id)
      .single()
    if (!client) return res.status(404).json({ error: 'Client not found' })
    if (client.coach_id !== coach.id) {
      return res.status(403).json({ error: 'Client does not belong to this coach' })
    }

    const { data: conn } = await supabase
      .from('training_hevy_connections')
      .select('hevy_api_key_encrypted, connection_status')
      .eq('client_id', client_id)
      .single()
    if (!conn) return res.status(404).json({ error: 'No Hevy connection' })
    if (conn.connection_status === 'expired') {
      return res.status(400).json({ error: 'Hevy key expired' })
    }

    const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)
    const routines = await fetchAllRoutines(apiKey)

    return res.status(200).json({
      routines: routines.map((r) => ({
        id: r.id,
        title: r.title,
        exercise_count: Array.isArray(r.exercises) ? r.exercises.length : 0,
        updated_at: r.updated_at,
        created_at: r.created_at,
      })),
    })
  } catch (err: any) {
    console.error('[list-routines] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
