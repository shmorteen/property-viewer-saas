import assert from 'node:assert/strict'
import { build } from 'esbuild'
const bundle=await build({entryPoints:['src/lib/plan-review.ts'],bundle:true,platform:'node',format:'esm',write:false})
const {preparePlanReview}=await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const analysis={status:'NEEDS_REVIEW',graph:{property_boundary:[],vertices:[],walls:[],building_boundary:[],rooms:[{room_id:'image-stable-id',point:{x:.4,y:.5}}],openings:[],site_edges:[],stairs:[]},room_candidates:[{id:'image-stable-id',name:'Bedroom',space_type:'bedroom'}],confidence:{rooms:{'image-stable-id':{confidence:.9,source:['OCR']}}}}
const first=preparePlanReview(analysis,[],()=> 'review-a')
const second=preparePlanReview(analysis,[],()=> 'review-b')
assert.notEqual(first.graph.rooms[0].room_id,second.graph.rooms[0].room_id,'Repeated images must not reuse persistent room IDs')
assert.equal(first.graph.rooms[0].room_id,first.room_candidates[0].id)
assert.deepEqual(first.confidence.rooms['review-a'],analysis.confidence.rooms['image-stable-id'])
assert.equal(analysis.graph.rooms[0].room_id,'image-stable-id','Analysis evidence must remain immutable')
assert.throws(()=>preparePlanReview({...analysis,graph:null},[]),/no reviewable/)
console.log('Independent persistent room identities, evidence remapping and immutable analysis passed.')
