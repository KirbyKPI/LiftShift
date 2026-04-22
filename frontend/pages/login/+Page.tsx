export { Page }

import React, { useState, useEffect } from 'react'
import { signIn, signUp, getSession, getCoachProfile } from '../../utils/supabase/auth'
import { navigate } from 'vike/client/router'
import { ClientOnly } from 'vike-react/ClientOnly'
import { assetPath } from '../../constants'

function Page() {
  const [mode, setMode] = useState<'login' | 'signup'>('login')
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [name, setName] = useState('')
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(false)
  const [checkingAuth, setCheckingAuth] = useState(true)

  useEffect(() => {
    ;(async () => {
      const session = await getSession()
      if (session) {
        const profile = await getCoachProfile()
        if (profile) { navigate('/coach'); return }
      }
      setCheckingAuth(false)
    })()
  }, [])

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-slate-950 flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-slate-600 border-t-emerald-400 rounded-full animate-spin" />
      </div>
    )
  }

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    setError('')
    setLoading(true)

    try {
      if (mode === 'signup') {
        if (!name.trim()) { setError('Name is required'); setLoading(false); return }
        await signUp(email, password, name.trim())
      } else {
        await signIn(email, password)
      }
      navigate('/coach')
    } catch (err: any) {
      setError(err.message || 'Authentication failed')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div className="min-h-screen bg-slate-950 text-slate-200 font-sans relative overflow-hidden">
      {/* Light Rays Background */}
      <div className="absolute inset-0 z-[1] pointer-events-none">
        <ClientOnly load={() => import('../../components/landing/lightRays/LightRays')} fallback={null}>
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

      {/* Content */}
      <div className="relative z-10 min-h-screen flex flex-col">
        {/* Header */}
        <header className="h-20 sm:h-24 flex items-center justify-between px-4 sm:px-6 lg:px-8 max-w-6xl mx-auto w-full">
          <a href="/" className="flex items-center rounded-xl px-1.5 sm:px-2 py-1 hover:bg-white/5 transition-colors">
            <img src={assetPath('/UI/kpifit-logo-nav.png')} alt="KPI·FIT" className="h-10 sm:h-12 w-auto" />
          </a>
        </header>

        {/* Form — centered */}
        <div className="flex-1 flex items-center justify-center px-4 pb-16">
          <div className="w-full max-w-md">
            {/* Card */}
            <div className="rounded-2xl border border-white/10 bg-black/30 backdrop-blur-xl shadow-[0_20px_60px_rgba(0,0,0,0.5)] p-8">
              <h1 className="text-xl font-bold text-white mb-1">
                {mode === 'login' ? 'Welcome back' : 'Create your account'}
              </h1>
              <p className="text-slate-400 text-sm mb-6">
                {mode === 'login'
                  ? 'Sign in to your KPI·FIT coaching dashboard'
                  : 'Set up your coach account to manage clients'}
              </p>

              <form onSubmit={handleSubmit} className="space-y-4">
                {mode === 'signup' && (
                  <div>
                    <label className="block text-slate-400 text-xs font-medium mb-1.5">Your Name</label>
                    <input
                      type="text"
                      value={name}
                      onChange={e => setName(e.target.value)}
                      placeholder="Coach Kirby"
                      className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                    />
                  </div>
                )}
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Email</label>
                  <input
                    type="email"
                    value={email}
                    onChange={e => setEmail(e.target.value)}
                    placeholder="coach@example.com"
                    required
                    className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                  />
                </div>
                <div>
                  <label className="block text-slate-400 text-xs font-medium mb-1.5">Password</label>
                  <input
                    type="password"
                    value={password}
                    onChange={e => setPassword(e.target.value)}
                    placeholder="••••••••"
                    required
                    minLength={6}
                    className="w-full px-3.5 py-2.5 bg-slate-900/60 border border-white/10 rounded-lg text-white text-sm placeholder:text-slate-600 focus:outline-none focus:border-emerald-500/50 focus:ring-1 focus:ring-emerald-500/20 transition-all"
                  />
                </div>

                {error && (
                  <p className="text-red-300 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
                )}

                <button
                  type="submit"
                  disabled={loading}
                  className="w-full py-2.5 bg-emerald-500 hover:bg-emerald-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed shadow-lg shadow-emerald-500/20"
                >
                  {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
                </button>
              </form>

              <div className="mt-6 text-center">
                <button
                  onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
                  className="text-slate-500 text-sm hover:text-emerald-300 transition-colors"
                >
                  {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
                </button>
              </div>
            </div>
          </div>
        </div>
      </div>
    </div>
  )
}
