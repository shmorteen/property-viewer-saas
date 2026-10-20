import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle=await build({entryPoints:['src/lib/plan-acceptance.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {completePlanAcceptance,sameSavedValue}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
let saves=0, closes=0, reloads=0, failRead=true
const progress={saved:false}
const actions={save:async()=>{saves++},verify:async()=>{if(failRead)throw {code:'NETWORK_ERROR',message:'Connection lost'}},reload:async()=>{reloads++},close:()=>{closes++}}
await assert.rejects(completePlanAcceptance(progress,actions),/layout was saved.*reload.*Connection lost.*NETWORK_ERROR/)
assert.equal(closes,0,'Failed read keeps corrected review open')
assert.equal(reloads,0)
failRead=false
await completePlanAcceptance(progress,actions)
assert.equal(saves,1,'Reload retry must not repeat an already committed RPC')
assert.equal(reloads,1);assert.equal(closes,1)
const denied={saved:false}
await assert.rejects(completePlanAcceptance(denied,{...actions,save:async()=>{throw new Error('Forbidden')}}),/Forbidden/)
assert.equal(denied.saved,false,'Rejected RPC must not count as saved')
assert.equal(closes,1,'Rejected RPC keeps review open')
let receiptReads=0
await completePlanAcceptance({saved:false},{save:async()=>{throw new Error('Lost response after commit')},hasSaved:async()=>{receiptReads++;return true},verify:async()=>{},reload:async()=>{},close:()=>{}})
assert.equal(receiptReads,1,'Lost acknowledgements are resolved by reading the accepted receipt')
assert.equal(sameSavedValue({a:1,b:[{x:.2,y:.3}]},{b:[{y:.3,x:.2}],a:1}),true)
assert.equal(sameSavedValue({wall:'a'},{wall:'b'}),false)
console.log('Acceptance rejection, retained review, persisted-read ordering and reload-only retry passed.')
