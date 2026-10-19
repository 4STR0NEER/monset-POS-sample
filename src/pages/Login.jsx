import { useState } from 'react'
import { motion } from 'motion/react'
import { CircleAlert, Loader2, LogOut } from 'lucide-react'
import { supabase } from '../lib/supabase.js'
import { DEMO_PASSWORD, DEMO_USERS } from '../lib/seed.js'
import { useAuth } from '../auth.jsx'
import { EASE_OUT } from '../components/ui.jsx'

function Frame({ children }) {
  return (
    <main className="grid min-h-dvh place-items-center bg-ink px-4 py-10 text-paper">
      <motion.div
        className="w-full max-w-sm"
        initial={{ opacity: 0, y: 16 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.5, ease: EASE_OUT }}
      >
        <img src="/assets/logo.svg" alt="Sample POS" className="mx-auto size-24" />
        {children}
      </motion.div>
    </main>
  )
}

export default function Login() {
  const [email, setEmail] = useState('')
  const [password, setPassword] = useState('')
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState(null)

  const signIn = async (email, password) => {
    setBusy(true)
    setError(null)
    const { error } = await supabase.auth.signInWithPassword({ email: email.trim(), password })
    if (error) setError(error.message === 'Invalid login credentials' ? 'Wrong email or password.' : error.message)
    setBusy(false)
  }
  const submit = (e) => {
    e.preventDefault()
    signIn(email, password)
  }

  const field = 'mt-1.5 h-12 w-full rounded-lg bg-ink-2 px-3.5 text-paper ring-1 ring-paper/10 outline-none transition-shadow placeholder:text-ash/60 focus:ring-2 focus:ring-gold'

  return (
    <Frame>
      <h1 className="mt-4 text-center font-display text-4xl font-black uppercase leading-none">
        Staff <span className="text-gold">POS</span>
      </h1>
      <p className="mt-2 text-center text-sm text-ash">Demo · no backend, dummy data saved in this browser</p>

      <form onSubmit={submit} className="mt-8 space-y-4">
        <label className="block text-sm font-semibold">
          Email
          <input type="email" autoComplete="username" required value={email} onChange={(e) => setEmail(e.target.value)} className={field} />
        </label>
        <label className="block text-sm font-semibold">
          Password
          <input type="password" autoComplete="current-password" required value={password} onChange={(e) => setPassword(e.target.value)} className={field} />
        </label>
        {error && (
          <p role="alert" className="flex items-center gap-2 rounded-lg bg-crimson/20 px-3 py-2.5 text-sm text-paper ring-1 ring-crimson/50">
            <CircleAlert className="size-4 shrink-0" aria-hidden="true" /> {error}
          </p>
        )}
        <button
          type="submit"
          disabled={busy}
          className="press flex h-12 w-full items-center justify-center gap-2 rounded-lg bg-gold font-display text-xl font-black uppercase tracking-[0.04em] text-ink disabled:opacity-60"
        >
          {busy && <Loader2 className="size-5 animate-spin" aria-hidden="true" />}
          {busy ? 'Signing in' : 'Sign in'}
        </button>
      </form>
      <div className="mt-8">
        <p className="text-center text-xs font-bold uppercase tracking-[0.14em] text-ash">Try a demo account</p>
        <div className="mt-3 grid gap-2">
          {DEMO_USERS.map(([demoEmail, name, role]) => (
            <button key={demoEmail} type="button" disabled={busy} onClick={() => signIn(demoEmail, DEMO_PASSWORD)} className="press flex h-11 items-center justify-between rounded-lg bg-ink-2 px-4 text-sm ring-1 ring-paper/10 hover:ring-gold/60 disabled:opacity-60">
              <span className="font-semibold">{name}</span>
              <span className="text-xs font-bold uppercase tracking-[0.1em] text-gold">{role}</span>
            </button>
          ))}
        </div>
        <p className="mt-3 text-center text-xs text-ash">
          Or sign in with any of them: password <code className="text-paper">{DEMO_PASSWORD}</code>
        </p>
      </div>
    </Frame>
  )
}

// Signed in, but the profile's role is not staff or admin.
export function NoAccess() {
  const { session, signOut } = useAuth()
  return (
    <Frame>
      <h1 className="mt-4 text-center font-display text-4xl font-black uppercase leading-none">Not active yet</h1>
      <p className="mt-3 text-center text-ash">
        <b className="text-paper">{session.user.email}</b> is signed in but doesn't have POS access. Ask the admin to set your role to staff.
      </p>
      <button type="button" onClick={signOut} className="press mx-auto mt-8 flex h-11 items-center gap-2 rounded-lg bg-ink-2 px-5 font-semibold ring-1 ring-paper/10">
        <LogOut className="size-4" aria-hidden="true" /> Sign out
      </button>
    </Frame>
  )
}

