import fs from 'node:fs/promises'
import path from 'node:path'
import assert from 'node:assert/strict'
import { build } from 'esbuild'
import process from 'node:process'
import { Buffer } from 'node:buffer'
import console from 'node:console'
const [expectedPath,responsePath]=process.argv.slice(2)
if(!expectedPath||!responsePath)throw new Error('Provide expected.json and the separate readback response JSON.')
const expected=JSON.parse(await fs.readFile(expectedPath,'utf8'))
const response=JSON.parse((await fs.readFile(responsePath,'utf8')).replace(/^\uFEFF/,''))
const saved=response.rows.map(row=>row.saved)
const bundle=await build({entryPoints:['src/lib/plan-acceptance.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {sameSavedValue}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
assert.equal(saved.length,expected.cases.length)
const identities=new Set()
for(const wanted of expected.cases){
 const actual=saved.find(row=>row.level_id===wanted.level_id)
 assert.ok(actual,'Committed layout must exist in a separate request')
 assert.equal(actual.status,'accepted')
 assert.ok(Math.abs(Number(actual.width)-wanted.width)<.0051,'Calibrated scale must survive numeric column rounding')
 assert.ok(sameSavedValue(actual.graph,{...wanted.graph,property_boundary:undefined}),'Complete graph and openings must survive readback')
 assert.equal(actual.rooms.length,wanted.rooms.length)
 for(const room of wanted.rooms){
  const stored=actual.rooms.find(value=>value.id===room.id)
  assert.ok(stored,'Reviewed room ID must survive acceptance')
  for(const field of ['name','space_type','category'])assert.equal(stored[field],room[field])
  assert.ok(!identities.has(room.id),'Independent accepted reviews cannot share persistent room IDs')
  identities.add(room.id)
 }
 assert.equal(actual.polygons.length,wanted.regions.filter(face=>face.room_id).length)
 for(const face of wanted.regions.filter(face=>face.room_id)){
  const polygon=actual.polygons.find(value=>value.room_id===face.room_id)
  assert.ok(polygon?.topology_managed)
  assert.ok(sameSavedValue(polygon.points,face.points),'Persisted polygons must match accepted shared-wall faces')
 }
}
await fs.writeFile(path.join(path.dirname(responsePath),'verified-layouts.json'),JSON.stringify(saved,null,2))
console.log(`PASS: ${saved.length} independent committed layouts; ${identities.size} room identities, names, types, categories, polygons, complete graphs, openings and scales match.`)
