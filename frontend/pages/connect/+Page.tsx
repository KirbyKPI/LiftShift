export { Page }

import React, { useState, useEffect } from 'react'

function Page() {
  // Extract the code from the URL path: /connect/ABC123 → ABC123
  const code = typeof window !== 'undefined'
    ? window.location.pathname.replace(/^\/connect\/?/, '')
    : ''

  const [apiKey, setApiKey] = useState('')
  const [loading, setLoading] = useState(false)
  const [validatingCode, setValidatingCode] = useState(true)
  const [codeValid, setCodeValid] = useState(false)
  const [coachName, setCoachName] = useState('')
  const [clientName, setClientName] = useState('')
  const [error, setError] = useState('')
  const [success, setSuccess] = useState(false)
  const [showGuide, setShowGuide] = useState(false)

  // Validate the connect code
  useEffect(() => {
    if (!code) { setValidatingCode(false); return }
    ;(async () => {
      try {
        // We can check the code exists via the public read policy
        const res = await fetch(`${getApiBase()}/api/hevy/connect`, {
          method: 'POST',
          headers: { 'Content-Type': 'application/json' },
          body: JSON.stringify({ mode: 'test_code', code }),
        })
        // The test_code mode doesn't exist in the API — but we can just try client-side
        // For now we'll validate on submit. Just show the form.
        setCodeValid(true)
      } catch {
        // Still show the form, error will surface on submit
        setCodeValid(true)
      } finally {
        setValidatingCode(false)
      }
    })()
  }, [code])

  const handleSubmit = async (e: React.FormEvent) => {
    e.preventDefault()
    if (!apiKey.trim()) { setError('Please enter your Hevy API key'); return }
    setLoading(true)
    setError('')

    try {
      const res = await fetch(`${getApiBase()}/api/hevy/connect`, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          mode: 'connect_via_code',
          api_key: apiKey.trim(),
          code,
        }),
      })
      const data = await res.json()
      if (!res.ok) throw new Error(data.error || 'Connection failed')
      setSuccess(true)
      setClientName(data.client_name || '')
    } catch (err: any) {
      setError(err.message)
    } finally {
      setLoading(false)
    }
  }

  if (validatingCode) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center">
        <div className="w-5 h-5 border-2 border-zinc-600 border-t-lime-400 rounded-full animate-spin" />
      </div>
    )
  }

  if (!code) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 text-white">
        <div className="text-center">
          <h1 className="text-xl font-bold mb-2">Invalid Link</h1>
          <p className="text-zinc-500">This connect link is missing a code. Ask your coach for a new link.</p>
        </div>
      </div>
    )
  }

  if (success) {
    return (
      <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4 text-white">
        <div className="w-full max-w-md text-center">
          <div className="w-16 h-16 rounded-2xl bg-lime-500/15 border border-lime-500/25 flex items-center justify-center mx-auto mb-6">
            <span className="text-3xl">✓</span>
          </div>
          <h1 className="text-2xl font-bold mb-2">Connected!</h1>
          <p className="text-zinc-400 mb-6">
            Your Hevy account is now linked{clientName ? ` as ${clientName}` : ''}. Your coach can see your workout data.
          </p>
          <p className="text-zinc-600 text-sm">You can close this page now. Keep logging workouts in Hevy as usual!</p>
        </div>
      </div>
    )
  }

  return (
    <div className="min-h-screen bg-[#0a0a0a] flex items-center justify-center px-4">
      <div className="w-full max-w-md">
        {/* Logo */}
        <div className="text-center mb-8">
          <div className="w-12 h-12 rounded-xl bg-lime-500/15 border border-lime-500/25 flex items-center justify-center mx-auto mb-3">
            <span className="text-lime-400 font-bold text-xl">K</span>
          </div>
          <h1 className="text-white font-bold text-xl">Connect Your Hevy Account</h1>
          <p className="text-zinc-500 text-sm mt-2">
            Your coach wants to sync your workout data. Enter your Hevy API key below.
          </p>
        </div>

        {/* Form Card */}
        <div className="bg-zinc-900/60 rounded-2xl border border-zinc-800 p-6">
          <form onSubmit={handleSubmit} className="space-y-4">
            <div>
              <label className="block text-zinc-400 text-xs font-medium mb-1.5">Hevy API Key</label>
              <input
                type="text"
                value={apiKey}
                onChange={e => setApiKey(e.target.value)}
                placeholder="hvy_..."
                className="w-full px-3 py-2.5 bg-zinc-800 border border-zinc-700 rounded-lg text-white text-sm font-mono placeholder:text-zinc-600 focus:outline-none focus:border-lime-500/50 transition-colors"
                autoFocus
              />
            </div>

            {error && (
              <p className="text-red-400 text-sm bg-red-500/10 border border-red-500/20 rounded-lg px-3 py-2">{error}</p>
            )}

            <button
              type="submit"
              disabled={loading}
              className="w-full py-2.5 bg-lime-500 hover:bg-lime-400 text-black font-semibold text-sm rounded-lg transition-colors disabled:opacity-50"
            >
              {loading ? 'Connecting...' : 'Connect Account'}
            </button>
          </form>

          {/* Guide toggle */}
          <div className="mt-5 pt-5 border-t border-zinc-800">
            <button
              onClick={() => setShowGuide(!showGuide)}
              className="text-zinc-500 text-sm hover:text-zinc-300 transition-colors w-full text-left"
            >
              {showGuide ? '▾' : '▸'} Where do I find my API key?
            </button>
            {showGuide && (
              <div className="mt-3 text-zinc-400 text-sm space-y-2">
                <p>1. Open the <strong className="text-white">Hevy app</strong> on your phone</p>
                <p>2. Go to <strong className="text-white">Settings</strong> (gear icon)</p>
                <p>3. Scroll down to <strong className="text-white">Developer</strong></p>
                <p>4. Tap <strong className="text-white">API Key</strong> to reveal it</p>
                <p>5. Copy the key and paste it above</p>
                <p className="text-zinc-600 text-xs mt-3">
                  Your API key is encrypted before being stored and is only used to read your workout data.
                </p>
              </div>
            )}
          </div>
        </div>
      </div>
    </div>
  )
}

function getApiBase(): string {
  // In production the API is on the same domain
  // In dev, Vike runs on port 3000 and the API might be elsewhere
  if (typeof window !== 'undefined' && window.location.hostname === 'localhost') {
    return '' // Vite proxy or same origin
  }
  return ''
}
