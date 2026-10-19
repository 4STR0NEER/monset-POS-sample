import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from './lib/supabase.js'

const AuthCtx = createContext(null)

// session / profile: undefined = still loading, null = none.
export function AuthProvider({ children }) {
  const [session, setSession] = useState(undefined)
  const [loaded, setLoaded] = useState(null) // { uid, full_name, role } for the last fetched user

  useEffect(() => {
    supabase.auth.getSession().then(({ data }) => setSession(data.session))
    const { data } = supabase.auth.onAuthStateChange((_event, s) => setSession(s))
    return () => data.subscription.unsubscribe()
  }, [])

  const uid = session?.user.id
  useEffect(() => {
    if (!uid) return
    supabase
      .from('profiles')
      .select('full_name, role')
      .eq('id', uid)
      .maybeSingle()
      .then(({ data }) => setLoaded({ uid, full_name: data?.full_name ?? null, role: data?.role ?? 'inactive' }))
  }, [uid])

  // Derived, so a just-arrived session never renders against a missing or previous user's profile.
  const profile = session === undefined ? undefined : !uid ? null : loaded?.uid === uid ? loaded : undefined

  const value = {
    session,
    profile,
    isAdmin: profile?.role === 'admin',
    signOut: () => supabase.auth.signOut(),
  }
  return <AuthCtx.Provider value={value}>{children}</AuthCtx.Provider>
}

export const useAuth = () => useContext(AuthCtx)
