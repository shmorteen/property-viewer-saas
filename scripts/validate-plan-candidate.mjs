import { build } from 'esbuild'
import crypto from 'node:crypto'
globalThis.crypto ||= crypto.webcrypto
const bundle = await build({ entryPoints: ['src/lib/topology.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const { validateGraph } = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
let input = ''
for await (const chunk of process.stdin) input += chunk
const results = JSON.parse(input).map(graph => { try { return validateGraph(graph) } catch (error) { return String(error) } })
process.stdout.write(JSON.stringify(results))
