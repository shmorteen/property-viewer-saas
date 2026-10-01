import { createContext, useContext, useEffect, useRef, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { listOrganizations } from './lib/data'
import { configured, supabase } from './lib/supabase'
import type { Organization } from './lib/types'

type AppContextValue = {
  session: Session | null
  organizations: Organization[]
  organization: Organization | null
  setOrganization: (org: Organization) => void
  refreshOrganizations: () => Promise<Organization[]>
  organizationError: string | null
  loading: boolean
}

const Context = createContext<AppContextValue | null>(null)

export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organization, setOrganizationState] = useState<Organization | null>(null)
  const [authLoading, setAuthLoading] = useState(true)
  const [loadedForUser, setLoadedForUser] = useState<string | null>(null)
  const [organizationError, setOrganizationError] = useState<string | null>(null)
  const requestId = useRef(0)
  const userId = session?.user.id ?? null

  const applyOrganizations = (items: Organization[]) => {
    setOrganizations(items)
    setOrganizationState(current => items.find(item => item.id === current?.id) || items[0] || null)
    setOrganizationError(null)
  }

  const refreshOrganizations = async (): Promise<Organization[]> => {
    if (!userId) throw new Error('Sign in to load your workspace.')
    const currentRequest = ++requestId.current
    try {
      const items = await listOrganizations()
      if (currentRequest === requestId.current) applyOrganizations(items)
      return items
    } catch (error) {
      if (currentRequest === requestId.current) {
        setOrganizationError(error instanceof Error ? error.message : 'Could not load your workspace.')
      }
      throw error
    } finally {
      if (currentRequest === requestId.current) setLoadedForUser(userId)
    }
  }

  useEffect(() => {
    if (!configured) { setAuthLoading(false); return }
    let live = true
    supabase.auth.getSession().then(({ data }) => {
      if (live) { setSession(data.session); setAuthLoading(false) }
    }).catch(() => { if (live) setAuthLoading(false) })
    const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => {
      setSession(next)
      setAuthLoading(false)
    })
    return () => { live = false; subscription.unsubscribe() }
  }, [])

  useEffect(() => {
    if (!userId) {
      requestId.current += 1
      setOrganizations([])
      setOrganizationState(null)
      setOrganizationError(null)
      setLoadedForUser(null)
      return
    }
    const currentRequest = ++requestId.current
    listOrganizations().then(items => {
      if (currentRequest === requestId.current) applyOrganizations(items)
    }).catch(error => {
      if (currentRequest === requestId.current) {
        setOrganizationError(error instanceof Error ? error.message : 'Could not load your workspace.')
      }
    }).finally(() => {
      if (currentRequest === requestId.current) setLoadedForUser(userId)
    })
  }, [userId])

  const loading = authLoading || Boolean(userId && loadedForUser !== userId)
  return <Context.Provider value={{ session, organizations, organization, setOrganization: setOrganizationState, refreshOrganizations, organizationError, loading }}>{children}</Context.Provider>
}

export function useApp() {
  const value = useContext(Context)
  if (!value) throw new Error('Missing AppProvider')
  return value
}
