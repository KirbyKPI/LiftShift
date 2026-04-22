import { supabase } from './client'
import type { Coach } from './client'

export async function signUp(email: string, password: string, displayName: string) {
  const { data, error } = await supabase.auth.signUp({ email, password })
  if (error) throw error
  if (!data.user) throw new Error('Signup failed')

  // Create coach profile
  const { error: profileErr } = await supabase
    .from('training_coaches')
    .insert({ user_id: data.user.id, display_name: displayName, email })

  if (profileErr) throw profileErr
  return data
}

export async function signIn(email: string, password: string) {
  const { data, error } = await supabase.auth.signInWithPassword({ email, password })
  if (error) throw error
  return data
}

export async function signOut() {
  const { error } = await supabase.auth.signOut()
  if (error) throw error
}

export async function getSession() {
  const { data: { session } } = await supabase.auth.getSession()
  return session
}

export async function getCoachProfile(): Promise<Coach | null> {
  const { data: { user } } = await supabase.auth.getUser()
  if (!user) return null

  const { data } = await supabase
    .from('training_coaches')
    .select('*')
    .eq('user_id', user.id)
    .single()

  return data
}

export function onAuthStateChange(callback: (session: any) => void) {
  return supabase.auth.onAuthStateChange((_event, session) => {
    callback(session)
  })
}
