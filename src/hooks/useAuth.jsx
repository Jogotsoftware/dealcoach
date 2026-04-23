import { createContext, useContext, useEffect, useState } from 'react'
import { supabase } from '../lib/supabase'
import { identify, reset as analyticsReset } from '../lib/analytics'

const AuthContext = createContext({})

export function AuthProvider({ children }) {
  const [user, setUser] = useState(null)
  const [profile, setProfile] = useState(null)
  const [loading, setLoading] = useState(true)

  useEffect(() => {
    // Get initial session
    supabase.auth.getSession().then(({ data: { session } }) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else setLoading(false)
    })

    // Listen for auth changes
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, session) => {
      setUser(session?.user ?? null)
      if (session?.user) loadProfile(session.user.id)
      else {
        setProfile(null)
        setLoading(false)
      }
    })

    return () => subscription.unsubscribe()
  }, [])

  async function loadProfile(userId) {
    try {
      const { data, error } = await supabase
        .from('profiles')
        .select('*')
        .eq('id', userId)
        .single()

      if (error && error.code === 'PGRST116') {
        // Profile doesn't exist yet — create it
        const { data: authUser } = await supabase.auth.getUser()
        const email = authUser?.user?.email || ''
        const name = authUser?.user?.user_metadata?.full_name || email.split('@')[0]
        const initials = name.split(' ').map(w => w[0]).join('').toUpperCase().slice(0, 2)

        const { data: newProfile, error: insertErr } = await supabase
          .from('profiles')
          .insert({
            id: userId,
            email,
            full_name: name,
            initials,
          })
          .select()
          .single()

        if (!insertErr) {
          setProfile(newProfile)
          identify(newProfile.id, { email: newProfile.email, org_id: newProfile.org_id, role: newProfile.role })
        }
      } else if (data) {
        setProfile(data)
        identify(data.id, { email: data.email, org_id: data.org_id, role: data.role })
      }
    } catch (err) {
      console.error('Error loading profile:', err)
    } finally {
      setLoading(false)
    }
  }

  async function signIn(email, password) {
    const { error } = await supabase.auth.signInWithPassword({ email, password })
    return { error }
  }

  async function signUp(email, password, fullName) {
    const { error } = await supabase.auth.signUp({
      email,
      password,
      options: { data: { full_name: fullName } },
    })
    return { error }
  }

  async function signOut() {
    await supabase.auth.signOut()
    setUser(null)
    setProfile(null)
    analyticsReset()
  }

  return (
    <AuthContext.Provider value={{ user, profile, loading, signIn, signUp, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  return useContext(AuthContext)
}
