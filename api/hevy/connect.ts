import type { VercelRequest, VercelResponse } from '@vercel/node'
import { createClient } from '@supabase/supabase-js'

const supabase = createClient(
  process.env.VITE_SUPABASE_URL!,
  process.env.SUPABASE_SERVICE_ROLE_KEY!
)

// ─── AES-256-CBC Encryption ────────────────────────────────────────────────

async function encryptApiKey(plaintext: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16))
  ).slice(0, 32)

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['encrypt'])
  const iv = crypto.getRandomValues(new Uint8Array(16))
  const encoded = new TextEncoder().encode(plaintext)
  const ct = await crypto.subtle.encrypt({ name: 'AES-CBC', iv }, key, encoded)

  const ivHex = Array.from(iv).map(b => b.toString(16).padStart(2, '0')).join('')
  const ctHex = Array.from(new Uint8Array(ct)).map(b => b.toString(16).padStart(2, '0')).join('')
  return `${ivHex}:${ctHex}`
}

async function decryptApiKey(encrypted: string): Promise<string> {
  const keyHex = process.env.HEVY_ENCRYPTION_KEY || ''
  const keyBytes = new Uint8Array(
    keyHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16))
  ).slice(0, 32)

  const [ivHex, ctHex] = encrypted.split(':')
  const iv = new Uint8Array(ivHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))
  const ct = new Uint8Array(ctHex.match(/.{1,2}/g)!.map((b: string) => parseInt(b, 16)))

  const key = await crypto.subtle.importKey('raw', keyBytes, { name: 'AES-CBC' }, false, ['decrypt'])
  const plain = await crypto.subtle.decrypt({ name: 'AES-CBC', iv }, key, ct)
  return new TextDecoder().decode(plain)
}

// ─── Validate API key with Hevy ────────────────────────────────────────────

async function validateHevyKey(apiKey: string): Promise<{ valid: boolean; username?: string; count?: number }> {
  try {
    const res = await fetch('https://api.hevyapp.com/v1/workouts?page=1&page_size=1', {
      headers: { 'api-key': apiKey, 'accept': 'application/json' }
    })
    if (!res.ok) return { valid: false }

    const data = await res.json()
    return { valid: true, count: data.page_count || 0 }
  } catch {
    return { valid: false }
  }
}

// ─── Handler ────────────────────────────────────────────────────────────────

export default async function handler(req: VercelRequest, res: VercelResponse) {
  // CORS
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization')
  if (req.method === 'OPTIONS') return res.status(200).end()

  if (req.method !== 'POST') return res.status(405).json({ error: 'Method not allowed' })

  const { mode, api_key, code, client_id, coach_token } = req.body || {}

  try {
    // ─── Mode 1: Client connects via shareable code ─────────────────
    if (mode === 'connect_via_code') {
      if (!api_key || !code) return res.status(400).json({ error: 'api_key and code required' })

      // Validate the Hevy key
      const validation = await validateHevyKey(api_key)
      if (!validation.valid) return res.status(400).json({ error: 'Invalid Hevy API key' })

      // Find the connect code
      const { data: codeRow, error: codeErr } = await supabase
        .from('training_connect_codes')
        .select('*')
        .eq('code', code)
        .is('used_at', null)
        .gt('expires_at', new Date().toISOString())
        .single()

      if (codeErr || !codeRow) return res.status(404).json({ error: 'Invalid or expired connection code' })

      // Create client if not already linked
      let clientId = codeRow.client_id
      if (!clientId) {
        const { data: newClient, error: clientErr } = await supabase
          .from('training_clients')
          .insert({ coach_id: codeRow.coach_id, name: codeRow.client_name })
          .select('id')
          .single()
        if (clientErr) throw clientErr
        clientId = newClient.id

        // Link code to client
        await supabase
          .from('training_connect_codes')
          .update({ client_id: clientId })
          .eq('id', codeRow.id)
      }

      // Encrypt and store API key
      const encrypted = await encryptApiKey(api_key)
      await supabase
        .from('training_hevy_connections')
        .upsert({
          client_id: clientId,
          hevy_api_key_encrypted: encrypted,
          hevy_username: validation.username || null,
          connection_status: 'active',
          last_error: null,
          sync_failure_count: 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })

      // Mark code as used
      await supabase
        .from('training_connect_codes')
        .update({ used_at: new Date().toISOString() })
        .eq('id', codeRow.id)

      // Create sync metadata
      await supabase
        .from('training_sync_metadata')
        .upsert({ client_id: clientId }, { onConflict: 'client_id' })

      return res.status(200).json({ success: true, client_name: codeRow.client_name })
    }

    // ─── Mode 2: Coach adds client key directly ─────────────────────
    if (mode === 'connect_direct') {
      if (!api_key || !client_id || !coach_token)
        return res.status(400).json({ error: 'api_key, client_id, and coach_token required' })

      // Verify coach auth
      const { data: { user }, error: authErr } = await supabase.auth.getUser(coach_token)
      if (authErr || !user) return res.status(401).json({ error: 'Unauthorized' })

      // Verify coach owns this client
      const { data: client } = await supabase
        .from('training_clients')
        .select('id, coach_id, training_coaches!inner(user_id)')
        .eq('id', client_id)
        .single()

      if (!client || (client as any).training_coaches?.user_id !== user.id)
        return res.status(403).json({ error: 'Not your client' })

      // Validate key
      const validation = await validateHevyKey(api_key)
      if (!validation.valid) return res.status(400).json({ error: 'Invalid Hevy API key' })

      // Encrypt and store
      const encrypted = await encryptApiKey(api_key)
      await supabase
        .from('training_hevy_connections')
        .upsert({
          client_id: client_id,
          hevy_api_key_encrypted: encrypted,
          hevy_username: validation.username || null,
          connection_status: 'active',
          last_error: null,
          sync_failure_count: 0,
          updated_at: new Date().toISOString(),
        }, { onConflict: 'client_id' })

      await supabase
        .from('training_sync_metadata')
        .upsert({ client_id: client_id }, { onConflict: 'client_id' })

      return res.status(200).json({ success: true, workout_count: validation.count })
    }

    // ─── Mode 3: Test a key without storing ─────────────────────────
    if (mode === 'test') {
      if (!api_key) return res.status(400).json({ error: 'api_key required' })
      const validation = await validateHevyKey(api_key)
      return res.status(200).json(validation)
    }

    return res.status(400).json({ error: 'Invalid mode. Use: connect_via_code, connect_direct, or test' })
  } catch (err: any) {
    console.error('Connect error:', err)
    return res.status(500).json({ error: err.message || 'Internal server error' })
  }
}
