export { Page }

/**
 * Reset password destination — where Supabase's password-reset email link
 * lands after the user clicks it.
 *
 * Two flows Supabase may use depending on auth provider settings:
 *   1. PKCE: ?code=AbCd... query param → call exchangeCodeForSession(code)
 *      to hydrate a recovery session, then updateUser({ password }).
 *   2. Implicit / legacy: #access_token=...&type=recovery URL fragment →
 *      supabase-js auto-detects and hydrates the session on page load;
 *      we just call updateUser({ password }) directly.
 *
 * We handle both: try exchangeCodeForSession first if `code` is present,
 * else trust that supabase-js has already picked up the fragment by the
 * time we render.
 *
 * SUPABASE DASHBOARD: Authentication → URL Configuration → Redirect URLs
 * must include this page's absolute URL (per origin you deploy to).
 * Without it Supabase rejects the redirect and the email link sends the
 * user to the Site URL instead.
 */

import React, { useEffect, useState } from 'react'
import { navigate } from 'vike/client/router'
import { ClientOnly } from 'vike-react/ClientOnly'
import { supabase } from '../../utils/supabase/client'
import { updatePassword, getSession } from '../../utils/supabase/auth'
import { assetPath } from '../../constants'

type Phase =
  | { kind: 'verifying' }
  | { kind: 'ready' }
  | { kind: 'submitting' }
  | { kind: 'done' }
  | { kind: 'error'; message: string }

function Page() {
  const [phase, setPhase] = useState<Phase>({ kind: 'verifying' })
  const [password, setPassword] = useState('')
  const [confirm, setConfirm] = useState('')

  // Verify the recovery session exists. Supabase-js's
  // detectSessionInUrl: true (default) auto-consumes ?code= or
  // #access_token=...&type=recovery on page load. We just need to
  // wait until that's done, then check if a session is live.
  useEffect(() => {
    let cancelled = false
    void (async () => {
      try {
        // If the URL has a ?code= param, explicitly exchange — this
        // handles the PKCE flow Supabase uses for password recovery
        // when the email template uses {{ .ConfirmationURL }} with a code.
        const url = new URL(window.location.href)
        const code = url.searchParams.get('code')
        if (code) {
          const { error } = await supabase.auth.exchangeCodeForSession(code)
          if (error) {
            if (!cancelled) {
              setPhase({
                kind: 'error',
                message: `Reset link is invalid or expired (${error.message}). Request a new one.`,
              })
            }
            return
          }
          // Clean ?code= out of the URL so refresh doesn't try to re-exchange.
          url.searchParams.delete('code')
          window.history.replaceState({}, '', url.toString())
        }

        // Either we exchanged a code, or the implicit fragment flow already
        // hydrated a session via supabase-js's detectSessionInUrl. Confirm.
        const session = await getSession()
        if (cancelled) return
        if (!session) {
          setPhase({
            kind: 'error',
            message:
              'No recovery session detected. The reset link may have expired or already been used. Request a new one.',
          })
          return
        }
        setPhase({ kind: 'ready' })
      } catch (err: any) {
        if (cancelled) return
        setPhase({
          kind: 'error',
          message: err?.message || 'Could not verify reset link',
        })
      }
    })()
    return () => {
      cancelled = true
    }
  }, [])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (password.length < 6) {
      setPhase({ kind: 'error', message: 'Password must be at least 6 characters' })
      return
    }
    if (password !== confirm) {
      setPhase({ kind: 'error', message: 'Passwords don\'t match' })
      return
    }
    setPhase({ kind: 'submitting' })
    try {
      await updatePassword(password)
      setPhase({ kind: 'done' })
      // Short pause so the user sees the success state, then send them
      // to the coach dashboard (they're already signed in from the
      // recovery session that updateUser preserved).
      setTimeout(() => navigate('/coach'), 1200)
    } catch (err: any) {
      setPhase({ kind: 'error', message: err?.message || 'Could not update password' })
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans relative overflow-hidden">
      {/* Light Rays Background — same as /login for visual continuity */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        <ClientOnly
          load={() => import('../../components/landing/lightRays/LightRays')}
          fallback={null}
        >
          {(LightRays) => (
            <LightRays
              raysOrigin="top-center"
              raysColor="#10b981"
              raysSpeed={0.6}
              lightSpread={1.0}
              rayLength={1.2}
              followMouse={true}
              mouseInfluence={0.05}
              noiseAmount={0.04}
              distortion={0.02}
              fadeDistance={1.0}
              saturation={0.8}
            />
          )}
        </ClientOnly>
      </div>

      <div className="relative z-10 min-h-screen flex flex-col">
        <header className="h-20 sm:h-24 flex items-center justify-between px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
          <a
            href="/"
            className="flex items-center rounded-xl px-1.5 sm:px-2 py-1 hover:bg-white/5 transition-colors"
          >
            <img
              src={assetPath('/UI/kpifit-logo-nav.png')}
              alt="KPI·FIT"
              className="h-10 sm:h-12 w-auto"
            />
          </a>
        </header>

        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md">
            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-8">
              <h1 className="text-xl font-bold text-white mb-1">Set a new password</h1>
              <p className="text-slate-400 text-sm mb-6">
                Pick something at least 6 characters. You'll be signed in right
                after.
              </p>

              {phase.kind === 'verifying' && (
                <div className="flex items-center justify-center py-10">
                  <div className="w-5 h-5 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
                </div>
              )}

              {phase.kind === 'error' && (
                <div className="space-y-4">
                  <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">
                    {phase.message}
                  </p>
                  <a
                    href="/login"
                    className="block text-center text-sm text-emerald-300 hover:text-emerald-200 transition-colors"
                  >
                    Back to sign in
                  </a>
                </div>
              )}

              {(phase.kind === 'ready' || phase.kind === 'submitting') && (
                <form onSubmit={handleSubmit} className="space-y-4">
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">
                      New password
                    </label>
                    <input
                      type="password"
                      value={password}
                      onChange={(e) => setPassword(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      autoFocus
                      className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">
                      Confirm new password
                    </label>
                    <input
                      type="password"
                      value={confirm}
                      onChange={(e) => setConfirm(e.target.value)}
                      placeholder="••••••••"
                      required
                      minLength={6}
                      className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                  <button
                    type="submit"
                    disabled={phase.kind === 'submitting'}
                    className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                  >
                    {phase.kind === 'submitting' ? 'Saving…' : 'Update password'}
                  </button>
                </form>
              )}

              {phase.kind === 'done' && (
                <p className="text-emerald-300 text-sm bg-emerald-500/10 border border-emerald-500/20 rounded-lg px-3 py-2">
                  Password updated. Redirecting to your dashboard…
                </p>
              )}
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
