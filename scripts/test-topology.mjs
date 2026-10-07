import assert from 'node:assert/strict'
import crypto from 'node:crypto'
import { build } from 'esbuild'

globalThis.crypto ||= crypto.webcrypto
const bundle = await build({ entryPoints: ['src/lib/topology.ts'], bundle: true, platform: 'node', format: 'esm', write: false })
const topology = await import(`data:text/javascript;base64,${Buffer.from(bundle.outputFiles[0].text).toString('base64')}`)
const { emptyGraph, createBuilding, addPartition, faces, snapToGraph, validateGraph, wallAdjacency, footprint, contains } = topology
const converted = topology.candidateFromLegacy(emptyGraph(), [
  { room_id: 'legacy-a', points: [{ x:.1,y:.1 },{ x:.5,y:.1 },{ x:.5,y:.7 },{ x:.1,y:.7 }] },
  { room_id: 'legacy-b', points: [{ x:.5,y:.1 },{ x:.9,y:.1 },{ x:.9,y:.7 },{ x:.5,y:.7 }] },
])
assert.equal(faces(converted).length, 2)
assert.equal(converted.walls.filter(w => w.kind === 'interior').length, 1)
assert.throws(() => topology.candidateFromLegacy(emptyGraph(), [
  { room_id: 'legacy-a', points: [{ x:.1,y:.1 },{ x:.49,y:.1 },{ x:.49,y:.7 },{ x:.1,y:.7 }] },
  { room_id: 'legacy-b', points: [{ x:.5,y:.1 },{ x:.9,y:.1 },{ x:.9,y:.7 },{ x:.5,y:.7 }] },
]), /gaps|disconnected/i)
// On a 1200 × 900 canvas with layout_width_m=15.24, this .8 × .8 footprint is 40 × 30 ft.
const graph0 = createBuilding(emptyGraph(), [{ x: .1, y: .1 }, { x: .9, y: .1 }, { x: .9, y: .9 }, { x: .1, y: .9 }])
assert.equal(faces(graph0).length, 1)
assert.deepEqual(topology.orthogonalPoint({x:.2,y:.2},{x:.8,y:.5},1000,750), {x:.8,y:.2})
assert.deepEqual(topology.orthogonalPoint({x:.2,y:.2},{x:.3,y:.8},1000,750), {x:.2,y:.8})
const freeSnap = snapToGraph(graph0, {x:.103,y:.103},1000,750,true,{vertex:false,wall:false,grid:false})
assert.equal(freeSnap.kind, 'free', 'Precision toggles can disable every snap target')
const rounded = topology.filletCorner(graph0, graph0.building_boundary[1], .25, 15.24, .75)
assert.equal(validateGraph(rounded), null, 'Fillet preserves a valid connected face')
assert.ok(rounded.building_boundary.length > graph0.building_boundary.length)
assert.equal(faces(rounded).length, 1)
assert.ok(rounded.walls.some(w => w.fillet_id), 'Arc segments persist in the graph')
const firstWall = graph0.walls[0]
const filletWithOpening = topology.filletCorner({ ...graph0, openings: [{ id: crypto.randomUUID(), wall_id: firstWall.id, type: 'standard_window', start: .2, end: .3, height: 1.2, sill: .9, swing: 1, width_m: topology.wallLengthM(graph0, firstWall, 15.24, .75) * .1 }] }, graph0.building_boundary[1], .25, 15.24, .75)
assert.equal(validateGraph(filletWithOpening), null)
assert.ok(Math.abs(topology.wallPoint(filletWithOpening, filletWithOpening.walls.find(w => w.id === firstWall.id), filletWithOpening.openings[0].start).x - topology.wallPoint(graph0, firstWall, .2).x) < 1e-8, 'Fillet retains a clear opening at its original position')
assert.throws(() => topology.filletCorner({ ...graph0, openings: [{ id: crypto.randomUUID(), wall_id: firstWall.id, type: 'standard_window', start: .94, end: .96, height: 1.2, sill: .9, swing: 1 }] }, graph0.building_boundary[1], .25, 15.24, .75), /opening farther/i)
const placed = topology.openingAt(graph0, firstWall, .5, topology.OPENING_WIDTHS_M.door.standard, 15.24, .75)
assert.ok(placed)
assert.ok(Math.abs((placed.end-placed.start)*topology.wallLengthM(graph0,firstWall,15.24,.75)-.9)<1e-8)
assert.equal(topology.openingAt(graph0, firstWall, .5, 50, 15.24, .75), null)
assert.throws(() => createBuilding(emptyGraph(), [{ x:.1,y:.1 },{ x:.9,y:.9 },{ x:.9,y:.1 },{ x:.1,y:.9 }]), /boundary/i)
assert.throws(() => createBuilding({ ...emptyGraph(), property_boundary: [{ x:.2,y:.2 },{ x:.8,y:.2 },{ x:.8,y:.8 },{ x:.2,y:.8 }] }, [{ x:.1,y:.1 },{ x:.9,y:.1 },{ x:.9,y:.9 },{ x:.1,y:.9 }]), /inside/i)
assert.match(validateGraph({ ...graph0, walls: [...graph0.walls, { ...graph0.walls[0], id: crypto.randomUUID() }] }), /duplicate|overlap/i)
let graph = graph0
const partition = coordinates => {
  const points = coordinates.map(([x,y]) => snapToGraph(graph, { x, y }, 1000, 1000))
  graph = addPartition(graph, points)
  assert.equal(validateGraph(graph), null)
}
partition([[.3667,.1],[.3667,.9]])
assert.throws(() => addPartition(graph, [snapToGraph(graph,{x:.1,y:.5},1000,1000),snapToGraph(graph,{x:.9,y:.5},1000,1000)]), /cross/i)
partition([[.6333,.1],[.6333,.9]])
partition([[.1,.3667],[.3667,.3667],[.6333,.3667],[.9,.3667]])
partition([[.1,.6333],[.3667,.6333],[.6333,.6333],[.9,.6333]])
const regions = faces(graph)
assert.equal(regions.length, 9, 'A 40 × 30 ft plan subdivides into nine rooms')
assert.equal(new Set(graph.walls.map(w => [w.a,w.b].sort().join(':'))).size, graph.walls.length, 'No duplicate physical wall')
assert.equal(regions.reduce((sum, face) => sum + face.area, 0).toFixed(3), .64.toFixed(3), 'No gaps or overlap')
const labels = ['Bedroom 1','Bedroom 2','Bedroom 3','Bathroom','Living room','Dining room','Kitchen','Closet','Washroom']
graph.rooms = regions.map((face, i) => ({ room_id: labels[i], point: topology.faceCenter(face) }))
assert.equal(validateGraph(graph), null)
const shared = graph.walls.filter(w => { const adjacency = wallAdjacency(graph, w); return adjacency.left && adjacency.right })
assert.ok(shared.length >= 8, 'Interior walls reference adjacent rooms')
const wall = shared[0]
const door = { id: crypto.randomUUID(), wall_id: wall.id, type: 'standard_door', start: .3, end: .65, height: 2.1, sill: 0, swing: 1 }
graph.openings.push(door)
assert.equal(validateGraph(graph), null)
assert.match(validateGraph({ ...graph, openings: [...graph.openings, { ...door, id: crypto.randomUUID(), start: .5, end: .8 }] }), /overlap/i)
const vertex = graph.vertices.find(v => !graph.building_boundary.includes(v.id) && Math.abs(v.x - .3667) < .001 && Math.abs(v.y - .3667) < .001)
assert.ok(vertex)
const moved = { ...graph, vertices: graph.vertices.map(v => v.id === vertex.id ? { ...v, x: .3767 } : v) }
assert.equal(validateGraph(moved), null)
assert.equal(faces(moved).length, 9, 'Moving one shared junction updates adjacent room faces')
assert.ok(footprint(graph).every(p => contains(p, footprint(graph))))
console.log('Topology graph: nine rooms, shared walls, adjacency, openings, and vertex editing passed.')
