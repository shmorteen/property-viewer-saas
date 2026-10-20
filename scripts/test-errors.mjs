import assert from 'node:assert/strict'
import { build } from 'esbuild'

// Stub the SDK: this test exercises the application's real error formatter,
// without reading environment files, creating a session, or making requests.
const bundle = await build({
  entryPoints: ['src/lib/supabase.ts'], bundle: true, platform: 'node', format: 'esm', write: false,
  define: { 'import.meta.env.VITE_SUPABASE_URL': '"https://example.supabase.co"', 'import.meta.env.VITE_SUPABASE_ANON_KEY': '"test-public-key"', 'window.location.origin': '"http://localhost"' },
  plugins: [{ name: 'no-network', setup(build) {
    build.onResolve({ filter: /^@supabase\/supabase-js$/ }, () => ({ path: 'sdk', namespace: 'stub' }))
    build.onLoad({ filter: /.*/, namespace: 'stub' }, () => ({ contents: 'export const createClient = () => ({})' }))
  } }],
})
const { errorMessage } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const response = { code: 'P0001', message: 'Room face does not follow shared vertices', details: null, hint: null }
assert.match(errorMessage(response), /Room face does not follow shared vertices/)
assert.match(errorMessage(response), /P0001/)
assert.equal(errorMessage(new Error('Select a wall first')), 'Select a wall first')
assert.doesNotMatch(errorMessage({}), /\[object Object\]/)
assert.doesNotMatch(errorMessage({message:'Request failed',details:'private row value',context:{headers:{authorization:'private token'}}}), /private/)
assert.doesNotMatch(errorMessage({message:'Bearer secret-token sb_secret_example123 postgres://user:password@host/db'}), /secret-token|example123|password/)
console.log('Safe PostgREST object and client error rendering passed.')
