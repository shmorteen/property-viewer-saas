import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT'))
export const supabase = createClient(url || 'https://example.supabase.co', key || 'missing-key', { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } })
export const appUrl = (import.meta.env.VITE_APP_URL || window.location.origin).replace(/\/$/, '')
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw error
  return data as T
}
