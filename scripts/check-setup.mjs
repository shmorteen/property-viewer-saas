import { readFileSync } from 'node:fs'
import { resolve } from 'node:path'

function readEnv() {
  try {
    const content = readFileSync(resolve('.env.local'), 'utf8')
    return Object.fromEntries(content.split(/\r?\n/).filter(line => /^\s*[A-Za-z_][\w]*\s*=/.test(line)).map(line => {
      const position = line.indexOf('=')
      const key = line.slice(0, position).trim()
      const value = line.slice(position + 1).trim().replace(/^(['"])(.*)\1$/, '$2')
      return [key, value]
    }))
  } catch {
    return null
  }
}

const env = readEnv()
if (!env) {
  console.error('FAIL .env.local is missing. Copy .env.example and add your Supabase Project URL and publishable key.')
  process.exit(1)
}

const url = env.VITE_SUPABASE_URL
const key = env.VITE_SUPABASE_ANON_KEY
let origin
try {
  origin = new URL(url).origin
  if (!origin.startsWith('https://') || !origin.endsWith('.supabase.co')) throw new Error()
} catch {
  console.error('FAIL VITE_SUPABASE_URL must be the Supabase Project URL (https://<project-ref>.supabase.co).')
  process.exit(1)
}
let legacyRole
try {
  legacyRole = JSON.parse(Buffer.from(key.split('.')[1], 'base64url').toString('utf8')).role
} catch {
  legacyRole = null
}
if (!key || (!key.startsWith('sb_publishable_') && legacyRole !== 'anon')) {
  console.error('FAIL VITE_SUPABASE_ANON_KEY must contain the publishable or legacy anon key, never a secret key.')
  process.exit(1)
}
if (env.VITE_APP_URL !== 'http://localhost:5173') console.warn('WARN VITE_APP_URL is not http://localhost:5173. Check the local port and Edge Function APP_URL secret.')

const headers = { apikey: key, Authorization: `Bearer ${key}` }
async function request(path, options = {}) {
  try {
    const response = await fetch(`${origin}${path}`, { ...options, headers: { ...headers, ...options.headers }, signal: AbortSignal.timeout(12_000) })
    const body = await response.json().catch(() => null)
    return { status: response.status, body }
  } catch (error) {
    return { status: 0, body: null, error: error?.name || 'NetworkError' }
  }
}

let failed = false
const auth = await request('/auth/v1/health')
if (auth.status === 200) console.log('PASS Supabase Auth is reachable.')
else { console.error(`FAIL Supabase Auth is not reachable (HTTP ${auth.status || auth.error}).`); failed = true }

const table = await request('/rest/v1/organizations?select=id&limit=1')
if (table.status === 200) console.log('PASS Property Viewer database schema is available.')
else if (table.body?.code === 'PGRST205') { console.error('FAIL Property Viewer tables are missing. Apply supabase/migrations/20261001000000_initial.sql to this Supabase project.'); failed = true }
else { console.error(`FAIL Could not read the organizations table (HTTP ${table.status || table.error}; ${table.body?.code || 'unknown code'}).`); failed = true }

const tour = await request('/functions/v1/public-tour', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ slug: 'setup-check' }) })
if (tour.status === 404 && tour.body?.error === 'Tour not found') console.log('PASS public-tour Edge Function is deployed.')
else if (tour.status === 404 || tour.body?.message === 'Requested function was not found') { console.error('FAIL public-tour Edge Function is missing. Deploy supabase/functions/public-tour.'); failed = true }
else if (tour.status === 500) { console.error('FAIL public-tour function returned HTTP 500. Check its Supabase logs and secrets.'); failed = true }
else if (tour.status) console.log(`INFO public-tour responded with HTTP ${tour.status}; verify its Supabase function logs.`)
else { console.error(`FAIL public-tour could not be reached (${tour.error}).`); failed = true }

console.log('INFO Stripe billing needs its three Edge Functions and test-mode secrets; this check does not validate billing.')
process.exitCode = failed ? 1 : 0
