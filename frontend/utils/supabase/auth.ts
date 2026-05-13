import { supabase } from './client'
import type { Coach } from './client'

export async function signUp(email: string, password: string, displayName: string) {
  // Pass display_name in metadata so the DB trigger can create the coach profile
  const { data, error } = await supabase.auth.signUp({
    email,
    password,
    options: { data: { display_name: displayName } },
  })
  if (error) throw error
  if (!data.user) throw new Error('Signup failed')
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

/**
 * Send a password reset email. The link in the email lands on
 * `/reset-password` on whatever origin invoked this — so the same code
 * works for localhost dev, training.kpifit.com prod, and Vercel previews.
 *
 * SUPABASE DASHBOARD SETUP (one-time, per project):
 *   - Authentication → URL Configuration → Redirect URLs: add
 *       https://training.kpifit.com/reset-password
 *       http://localhost:5173/reset-password
 *       (plus any other origins you deploy to)
 *   Without these, Supabase rejects the redirect and the email link
 *   bounces back to the Site URL.
 */
export async function requestPasswordReset(email: string) {
  if (!email.trim()) throw new Error('Email is required')
  const redirectTo =
    typeof window !== 'undefined'
      ? `${window.location.origin}/reset-password`
      : undefined
  const { error } = await supabase.auth.resetPasswordForEmail(email.trim(), {
    redirectTo,
  })
  if (error) throw error
}

/**
 * Set a new password for the currently-signed-in user. The
 * /reset-password page calls this after Supabase has hydrated a recovery
 * session from the email link's code / token.
 */
export async function updatePassword(newPassword: string) {
  if (!newPassword || newPassword.length < 6) {
    throw new Error('Password must be at least 6 characters')
  }
  const { error } = await supabase.auth.updateUser({ password: newPassword })
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
