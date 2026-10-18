import { createContext, useContext, useEffect, type ReactNode } from 'react'
import { useQuery, useQueryClient } from '@tanstack/react-query'
import { api, ApiError, setUnauthorizedHandler } from './api'
import type { Me } from './types'

interface AuthState {
  me: Me | null
  loading: boolean
  /** Replace the cached user after sign-in, 2FA, or sign-out. */
  setMe: (me: Me | null) => void
  signOut: () => Promise<void>
}

const AuthContext = createContext<AuthState | null>(null)

export function AuthProvider({ children }: { children: ReactNode }) {
  const qc = useQueryClient()
  const { data, isLoading } = useQuery({
    queryKey: ['me'],
    queryFn: async () => {
      try {
        return await api.get<Me>('/api/auth/me')
      } catch (e) {
        if (e instanceof ApiError && e.status === 401) return null
        throw e
      }
    },
    staleTime: 60_000,
  })

  const setMe = (me: Me | null) => {
    // Signing out drops every cached workspace, but keeps the "me" query itself alive.
    if (me === null) qc.removeQueries({ predicate: q => q.queryKey[0] !== 'me' })
    qc.setQueryData(['me'], me)
  }

  useEffect(() => {
    setUnauthorizedHandler(() => { if (qc.getQueryData(['me'])) setMe(null) })
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [])

  const signOut = async () => {
    await api.post('/api/auth/logout').catch(() => {})
    setMe(null)
  }

  return (
    <AuthContext.Provider value={{ me: data ?? null, loading: isLoading, setMe, signOut }}>
      {children}
    </AuthContext.Provider>
  )
}

export function useAuth() {
  const ctx = useContext(AuthContext)
  if (!ctx) throw new Error('useAuth outside AuthProvider')
  return ctx
}
