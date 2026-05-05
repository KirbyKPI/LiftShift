/**
 * POST /api/coach/list-hevy-exercise-templates
 * ────────────────────────────────────────────────────────────────────────────
 * Returns Hevy's full exercise template catalog (all pages, flattened),
 * fetched using the COACH's stored Hevy Pro API key from
 * training_coach_hevy_connections.
 *
 * Used by the HevyTemplatePicker UI so the coach can resolve a null
 * exercise_template_id on a recommendation item — picking the right Hevy
 * template before pushing.
 *
 * Request:  { coach_token, q? }
 *   - q (optional): substring filter applied server-side (case-insensitive,
 *     matches against title). Returned list is filtered + sorted by title.
 * Response: { templates: [{id, title, primary_muscle, custom}], cached: bool }
 *
 * The catalog is large (~440 stock + custom templates) so we module-cache the
 * raw fetch for 6 hours per coach to avoid hammering Hevy on every keystroke.
 * Filter happens after the cache lookup.
 */

import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!,
)

export const config = { maxDuration: 30 }

// ─── Decrypt (mirrors push-recommendation.ts; same env var) ────────────────
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

// ─── Module cache ──────────────────────────────────────────────────────────
// Vercel functions can be reused across invocations within a warm container.
// Cache by coach_id since each coach has their own custom templates.
interface CachedCatalog {
  fetchedAt: number
  templates: TemplateRow[]
}
const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6h
const catalogCache = new Map<string, CachedCatalog>()

interface TemplateRow {
  id: string
  title: string
  primary_muscle: string
  custom: boolean
}

interface HevyExerciseTemplate {
  id: string
  title: string
  type?: string
  primary_muscle_group?: string
  secondary_muscle_groups?: string[]
  is_custom?: boolean
}

async function fetchAllTemplates(apiKey: string): Promise<TemplateRow[]> {
  const all: TemplateRow[] = []
  let page = 1
  const pageSize = 100
  const MAX_PAGES = 20

  while (page <= MAX_PAGES) {
    const res = await fetch(
      `https://api.hevyapp.com/v1/exercise_templates?page=${page}&page_size=${pageSize}`,
      { headers: { 'api-key': apiKey, accept: 'application/json' } },
    )
    if (res.status === 401) throw new Error('API_KEY_EXPIRED')
    if (!res.ok) throw new Error(`Hevy API error: ${res.status}`)

    const data = await res.json()
    const templates: HevyExerciseTemplate[] = data.exercise_templates || []
    for (const t of templates) {
      if (!t?.id || typeof t.title !== 'string') continue
      all.push({
        id: String(t.id),
        title: t.title,
        primary_muscle: t.primary_muscle_group || '',
        custom: !!t.is_custom,
      })
    }
    if (templates.length < pageSize || page >= (data.page_count || 1)) break
    page++
    await new Promise((r) => setTimeout(r, 100))
  }

  // Sort once at fetch time so filter results come back in a stable order.
  all.sort((a, b) => a.title.localeCompare(b.title))
  return all
}

function applyFilter(templates: TemplateRow[], q: string | undefined): TemplateRow[] {
  if (!q || !q.trim()) return templates
  const needle = q.trim().toLowerCase()
  return templates.filter((t) => t.title.toLowerCase().includes(needle))
}

// ─── Handler ───────────────────────────────────────────────────────────────
export default async function handler(req: VercelRequest, res: VercelResponse) {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { coach_token, q } = (req.body || {}) as {
    coach_token?: string
    q?: string
  }
  if (!coach_token) return res.status(400).json({ error: 'coach_token required' })

  try {
    const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
    if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

    const { data: coach } = await supabase
      .from('training_coaches')
      .select('id')
      .eq('user_id', user.id)
      .single()
    if (!coach) return res.status(403).json({ error: 'No coach profile' })

    // Hot-path: cached.
    const cached = catalogCache.get(coach.id)
    if (cached && Date.now() - cached.fetchedAt < CACHE_TTL_MS) {
      return res.status(200).json({
        templates: applyFilter(cached.templates, q),
        cached: true,
        total: cached.templates.length,
      })
    }

    // Slow path: fetch + cache.
    const { data: conn } = await supabase
      .from('training_coach_hevy_connections')
      .select('hevy_api_key_encrypted, connection_status')
      .eq('coach_id', coach.id)
      .single()
    if (!conn) {
      return res.status(404).json({
        error: 'Connect your Hevy Pro API key first (header chip).',
        error_code: 'COACH_HEVY_NOT_CONNECTED',
      })
    }
    if (conn.connection_status === 'expired') {
      return res.status(400).json({
        error: 'Hevy API key expired — reconnect in the header.',
        error_code: 'COACH_HEVY_KEY_EXPIRED',
      })
    }

    const apiKey = await decryptApiKey(conn.hevy_api_key_encrypted)
    let templates: TemplateRow[]
    try {
      templates = await fetchAllTemplates(apiKey)
    } catch (err: any) {
      if (err?.message === 'API_KEY_EXPIRED') {
        await supabase
          .from('training_coach_hevy_connections')
          .update({ connection_status: 'expired', last_error: 'API key rejected (401)' })
          .eq('coach_id', coach.id)
        return res.status(401).json({
          error: 'Hevy API key rejected — reconnect in the header.',
          error_code: 'COACH_HEVY_KEY_EXPIRED',
        })
      }
      throw err
    }

    catalogCache.set(coach.id, { fetchedAt: Date.now(), templates })

    return res.status(200).json({
      templates: applyFilter(templates, q),
      cached: false,
      total: templates.length,
    })
  } catch (err: any) {
    console.error('[list-hevy-exercise-templates] fatal:', err)
    return res.status(500).json({ error: err.message || 'Unexpected error' })
  }
}
