import { createClient } from '@supabase/supabase-js'
const url = import.meta.env.VITE_SUPABASE_URL
const key = import.meta.env.VITE_SUPABASE_ANON_KEY
export const configured = Boolean(url && key && !url.includes('YOUR_PROJECT'))
export const supabase = createClient(url || 'https://example.supabase.co', key || 'missing-key', { auth: { autoRefreshToken: true, persistSession: true, detectSessionInUrl: true } })
export const appUrl = window.location.origin
export function errorMessage(error: unknown): string { return error instanceof Error ? error.message : String(error) }
async function functionErrorMessage(error: Error): Promise<string> {
  const response = (error as Error & { context?: unknown }).context
  if (response instanceof Response) {
    const body: unknown = await response.json().catch(() => null)
    if (body && typeof body === 'object' && 'error' in body && typeof body.error === 'string') return body.error
  }
  return error.message
}
export async function invoke<T>(name: string, body: Record<string, unknown>): Promise<T> {
  const { data, error } = await supabase.functions.invoke(name, { body })
  if (error) throw new Error(await functionErrorMessage(error))
  return data as T
}
