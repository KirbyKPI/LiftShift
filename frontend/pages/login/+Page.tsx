export { Page }

import React, { useState, useEffect } from 'react'
import { signIn, signUp, getSession, getCoachProfile } from '../../utils/supabase/auth'
import { navigate } from 'vike/client/router'

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
        // Only redirect if the user also has a coach profile —
        // otherwise they'd bounce between /login and /coach forever
        const profile = await getCoachProfile()
        if (profile) { navigate('/coach'); return }
      }
      setCheckingAuth(false)
    })()
  }, [])

  if (checkingAuth) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
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
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <a href="/" className="inline-flex items-center gap-3">
            <div className="w-12 h-12 rounded-xl bg-lime-500/15 border border-lime-500/25 flex items-center justify-center">
              <span className="text-lime-400 font-bold text-xl">K</span>
            </div>
            <div className="text-left">
              <div className="text-white font-bold text-lg">KPIFit Training</div>
              <div className="text-zinc-500 text-xs">Coach Portal</div>
            </div>
          </a>
        </div>

        {/* Card */}
        <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800 p-8">
          <h1 className="text-xl font-bold text-white mb-1">
            {mode === 'login' ? 'Welcome back' : 'Create your account'}
          </h1>
          <p className="text-zinc-500 text-sm mb-6">
            {mode === 'login'
              ? 'Sign in to access your coaching dashboard'
              : 'Set up your coach account to manage clients'}
          </p>

          <form onSubmit={handleSubmit} className="space-y-4">
            {mode === 'signup' && (
              <div>
                <label className="block text-zinc-400 text-xs font-medium mb-1.5">Your Name</label>
                <input
                  type="text"
                  value={name}
                  onChange={e => setName(e.target.value)}
                  placeholder="Coach Kirby"
                  className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
                />
              </div>
            )}
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Email</label>
              <input
                type="email"
                value={email}
                onChange={e => setEmail(e.target.value)}
                placeholder="coach@example.com"
                required
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
              />
            </div>
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Password</label>
              <input
                type="password"
                value={password}
                onChange={e => setPassword(e.target.value)}
                placeholder="••••••••"
                required
                minLength={6}
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50 disabled:cursor-not-allowed"
            >
              {loading ? 'Loading...' : mode === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          </form>

          <div className="mt-6 text-center">
            <button
              onClick={() => { setMode(mode === 'login' ? 'signup' : 'login'); setError('') }}
              className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors"
            >
              {mode === 'login' ? "Don't have an account? Sign up" : 'Already have an account? Sign in'}
            </button>
          </div>
        </div>
      </div>
    </div>
  )
}
