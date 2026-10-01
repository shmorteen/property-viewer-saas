import { createContext, useContext, useEffect, useState, type ReactNode } from 'react'
import type { Session } from '@supabase/supabase-js'
import { listOrganizations } from './lib/data'
import { configured, supabase } from './lib/supabase'
import type { Organization } from './lib/types'
type AppContextValue = { session: Session | null; organizations: Organization[]; organization: Organization | null; setOrganization: (org: Organization) => void; refreshOrganizations: () => Promise<void>; loading: boolean }
const Context = createContext<AppContextValue | null>(null)
export function AppProvider({ children }: { children: ReactNode }) {
  const [session, setSession] = useState<Session | null>(null)
  const [organizations, setOrganizations] = useState<Organization[]>([])
  const [organization, setOrganizationState] = useState<Organization | null>(null)
  const [loading, setLoading] = useState(true)
  const refreshOrganizations = async () => { const items = await listOrganizations(); setOrganizations(items); setOrganizationState(current => items.find(item => item.id === current?.id) || items[0] || null) }
  useEffect(() => { if (!configured) { setLoading(false); return } let live = true; supabase.auth.getSession().then(({ data }) => { if (live) { setSession(data.session); setLoading(false) } }); const { data: { subscription } } = supabase.auth.onAuthStateChange((_event, next) => { setSession(next); setLoading(false) }); return () => { live = false; subscription.unsubscribe() } }, [])
  useEffect(() => { if (session) { void refreshOrganizations().catch(() => setOrganizations([])) } else { setOrganizations([]); setOrganizationState(null) } }, [session])
  return <Context.Provider value={{ session, organizations, organization, setOrganization: setOrganizationState, refreshOrganizations, loading }}>{children}</Context.Provider>
}
export function useApp() { const value = useContext(Context); if (!value) throw new Error('Missing AppProvider'); return value }
