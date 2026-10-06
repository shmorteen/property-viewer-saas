import { clamp, polygonArea, validLayoutPolygon } from './geometry'
import type { Point } from './types'

export type Vertex = Point & { id: string }
export type Wall = { id: string; a: string; b: string; kind: 'exterior' | 'interior' | 'virtual'; thickness: number; height: number }
export type TopologyOpening = { id: string; wall_id: string; type: 'standard_door' | 'double_door' | 'standard_window' | 'wide_window'; start: number; end: number; height: number; sill: number; swing: -1 | 1 }
export type RoomSeed = { room_id: string; point: Point }
export type LayoutGraph = { property_boundary: Point[]; building_boundary: string[]; vertices: Vertex[]; walls: Wall[]; rooms: RoomSeed[]; openings: TopologyOpening[] }
export type Face = { ids: string[]; points: Point[]; key: string; area: number; room_id?: string }

export const emptyGraph = (): LayoutGraph => ({ property_boundary: [], building_boundary: [], vertices: [], walls: [], rooms: [], openings: [] })
const eps = 1e-7
const point = (graph: LayoutGraph, id: string) => graph.vertices.find(v => v.id === id)!
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const segmentDistance = (p: Point, a: Point, b: Point) => {
  const dx = b.x - a.x, dy = b.y - a.y
  const t = clamp(((p.x - a.x) * dx + (p.y - a.y) * dy) / (dx * dx + dy * dy || 1))
  const projected = { x: a.x + t * dx, y: a.y + t * dy }
  return { t, projected, distance: Math.hypot(p.x - projected.x, p.y - projected.y) }
}
export function contains(p: Point, polygon: Point[], boundary = true): boolean {
  if (polygon.length < 3) return false
  if (boundary && polygon.some((a, i) => segmentDistance(p, a, polygon[(i + 1) % polygon.length]).distance < eps)) return true
  let inside = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > p.y) !== (b.y > p.y) && p.x < (b.x - a.x) * (p.y - a.y) / (b.y - a.y) + a.x) inside = !inside
  }
  return inside
}
function intersect(a: Point, b: Point, c: Point, d: Point) {
  return cross(a, b, c) * cross(a, b, d) < -eps && cross(c, d, a) * cross(c, d, b) < -eps
}
export function validateBoundary(points: Point[], outer?: Point[]): string | null {
  if (!validLayoutPolygon(points)) return 'Boundary must be a closed, non-self-intersecting polygon with no tiny edges.'
  for (let i = 0; i < points.length; i++) for (let j = i + 2; j < points.length; j++) {
    if (i === 0 && j === points.length - 1) continue
    const a = points[i], b = points[(i + 1) % points.length], c = points[j], d = points[(j + 1) % points.length]
    if (segmentDistance(a, c, d).distance < eps || segmentDistance(b, c, d).distance < eps || segmentDistance(c, a, b).distance < eps || segmentDistance(d, a, b).distance < eps) return 'Boundary touches or overlaps itself.'
  }
  if (outer?.length && (points.some(p => !contains(p, outer)) || points.some((a, i) => outer.some((c, j) => intersect(a, points[(i + 1) % points.length], c, outer[(j + 1) % outer.length]))))) return 'Building footprint must remain inside the property boundary.'
  return null
}
export function createBuilding(graph: LayoutGraph, points: Point[]): LayoutGraph {
  const problem = validateBoundary(points, graph.property_boundary)
  if (problem) throw new Error(problem)
  if (graph.walls.length) throw new Error('The building footprint already has walls. Start a new level to trace a different footprint.')
  const vertices = points.map(p => ({ ...p, id: crypto.randomUUID() }))
  const walls = vertices.map((v, i) => ({ id: crypto.randomUUID(), a: v.id, b: vertices[(i + 1) % vertices.length].id, kind: 'exterior' as const, thickness: .18, height: 2.7 }))
  return { ...graph, vertices, walls, building_boundary: vertices.map(v => v.id) }
}
export function footprint(graph: LayoutGraph): Point[] { return graph.building_boundary.map(id => point(graph, id)) }
export type Snap = { point: Point; kind: 'vertex' | 'wall' | 'grid' | 'free'; id?: string; t?: number }
export function snapToGraph(graph: LayoutGraph, raw: Point, width: number, height: number, allowGrid = true): Snap {
  const pixel = (p: Point) => Math.hypot((p.x - raw.x) * width, (p.y - raw.y) * height)
  const vertex = graph.vertices.map(v => ({ v, distance: pixel(v) })).sort((a, b) => a.distance - b.distance)[0]
  if (vertex && vertex.distance <= 12) return { point: { x: vertex.v.x, y: vertex.v.y }, kind: 'vertex', id: vertex.v.id }
  const wall = graph.walls.map(w => ({ w, ...segmentDistance(raw, point(graph, w.a), point(graph, w.b)) })).map(item => ({ ...item, distance: pixel(item.projected) })).sort((a, b) => a.distance - b.distance)[0]
  if (wall && wall.distance <= 10) return { point: wall.projected, kind: 'wall', id: wall.w.id, t: wall.t }
  const grid = { x: clamp(Math.round(raw.x / .025) * .025), y: clamp(Math.round(raw.y / .025) * .025) }
  return allowGrid && pixel(grid) <= 8 ? { point: grid, kind: 'grid' } : { point: { x: clamp(raw.x), y: clamp(raw.y) }, kind: 'free' }
}
function splitAt(graph: LayoutGraph, snap: Snap): string {
  if (snap.kind === 'vertex') return snap.id!
  if (snap.kind !== 'wall') throw new Error('A partition must start and end on an existing wall or vertex.')
  const index = graph.walls.findIndex(w => w.id === snap.id)
  const old = graph.walls[index]
  if (graph.openings.some(o => o.wall_id === old.id)) throw new Error('This wall has openings. Remove or relocate them before splitting it.')
  const id = crypto.randomUUID()
  graph.vertices.push({ ...snap.point, id })
  graph.walls.splice(index, 1, { ...old, b: id }, { ...old, id: crypto.randomUUID(), a: id })
  if (old.kind === 'exterior') {
    const boundaryIndex = graph.building_boundary.findIndex((vertex, i) => vertex === old.a && graph.building_boundary[(i + 1) % graph.building_boundary.length] === old.b)
    if (boundaryIndex >= 0) graph.building_boundary.splice(boundaryIndex + 1, 0, id)
    else {
      const reversed = graph.building_boundary.findIndex((vertex, i) => vertex === old.b && graph.building_boundary[(i + 1) % graph.building_boundary.length] === old.a)
      if (reversed >= 0) graph.building_boundary.splice(reversed + 1, 0, id)
    }
  }
  return id
}
export function addPartition(source: LayoutGraph, path: Snap[]): LayoutGraph {
  if (path.length < 2 || !['wall', 'vertex'].includes(path[0].kind) || !['wall', 'vertex'].includes(path[path.length - 1].kind)) throw new Error('Start and finish the partition on a highlighted wall or vertex.')
  const graph: LayoutGraph = structuredClone(source)
  const ids = path.map((snap, index) => {
    if (index === 0 || index === path.length - 1) {
      const current = snapToGraph(graph, snap.point, 1000, 1000, false)
      return splitAt(graph, current)
    }
    if (snap.kind === 'vertex') return snap.id!
    if (snap.kind === 'wall') return splitAt(graph, snapToGraph(graph, snap.point, 1000, 1000, false))
    const id = crypto.randomUUID(); graph.vertices.push({ ...snap.point, id }); return id
  })
  for (let i = 0; i < ids.length - 1; i++) {
    if (ids[i] === ids[i + 1] || Math.hypot(point(graph, ids[i]).x - point(graph, ids[i + 1]).x, point(graph, ids[i]).y - point(graph, ids[i + 1]).y) < .005) throw new Error('Partition contains a zero-length wall.')
    graph.walls.push({ id: crypto.randomUUID(), a: ids[i], b: ids[i + 1], kind: 'interior', thickness: .1, height: 2.7 })
  }
  const problem = validateGraph(graph)
  if (problem) throw new Error(problem)
  return graph
}
export function faces(graph: LayoutGraph): Face[] {
  if (graph.walls.length < 3) return []
  const outgoing = new Map<string, { to: string; wall: string; angle: number }[]>()
  for (const w of graph.walls) for (const [a, b] of [[w.a, w.b], [w.b, w.a]]) {
    const p = point(graph, a), q = point(graph, b)
    outgoing.set(a, [...(outgoing.get(a) || []), { to: b, wall: w.id, angle: Math.atan2(q.y - p.y, q.x - p.x) }])
  }
  for (const edges of outgoing.values()) edges.sort((a, b) => a.angle - b.angle)
  const seen = new Set<string>(), result: Face[] = []
  for (const [start, edges] of outgoing) for (const edge of edges) {
    const first = `${start}:${edge.to}`
    if (seen.has(first)) continue
    let from = start, to = edge.to
    const ids: string[] = [], wallIds: string[] = []
    for (let steps = 0; steps <= graph.walls.length * 2; steps++) {
      const directed = `${from}:${to}`
      if (seen.has(directed)) break
      seen.add(directed); ids.push(from)
      const around = outgoing.get(to) || []
      const reverse = around.findIndex(e => e.to === from)
      if (reverse < 0) break
      wallIds.push(around[reverse].wall)
      const next = around[(reverse - 1 + around.length) % around.length]
      from = to; to = next.to
      if (`${from}:${to}` === first) break
    }
    const points = ids.map(id => point(graph, id))
    const signed = points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0) / 2
    if (ids.length >= 3 && signed > .0005) {
      const face: Face = { ids, points, key: [...wallIds].sort().join(':'), area: signed }
      face.room_id = graph.rooms.find(seed => contains(seed.point, points, false))?.room_id
      result.push(face)
    }
  }
  return result
}
export function validateGraph(graph: LayoutGraph): string | null {
  const building = footprint(graph)
  const boundaryError = validateBoundary(building, graph.property_boundary)
  if (boundaryError) return boundaryError
  const used = new Set<string>()
  for (const w of graph.walls) {
    const a = point(graph, w.a), b = point(graph, w.b)
    if (!a || !b || Math.hypot(a.x - b.x, a.y - b.y) < .005) return 'A wall has missing vertices or zero length.'
    const key = [w.a, w.b].sort().join(':')
    if (used.has(key)) return 'Duplicate wall segment.'
    used.add(key)
    if (!contains({ x: (a.x + b.x) / 2, y: (a.y + b.y) / 2 }, building)) return 'A wall extends outside the building.'
    for (const other of graph.walls) {
      if (other.id >= w.id) continue
      const c = point(graph, other.a), d = point(graph, other.b)
      if (intersect(a, b, c, d)) return 'Wall segments cross. End each partition on an existing wall.'
      if (Math.abs(cross(a, b, c)) < eps && Math.abs(cross(a, b, d)) < eps) {
        const axis: 'x' | 'y' = Math.abs(a.x - b.x) >= Math.abs(a.y - b.y) ? 'x' : 'y'
        const overlap = Math.min(Math.max(a[axis], b[axis]), Math.max(c[axis], d[axis])) - Math.max(Math.min(a[axis], b[axis]), Math.min(c[axis], d[axis]))
        if (overlap > eps) return 'Overlapping wall segments.'
      }
      for (const [endpoint, endpointId] of [[a, w.a], [b, w.b]] as [Point, string][]) {
        const projection = segmentDistance(endpoint, c, d)
        if (projection.distance < eps && projection.t > eps && projection.t < 1 - eps && endpointId !== other.a && endpointId !== other.b) return 'A wall joins another wall without a shared vertex.'
      }
      for (const [endpoint, endpointId] of [[c, other.a], [d, other.b]] as [Point, string][]) {
        const projection = segmentDistance(endpoint, a, b)
        if (projection.distance < eps && projection.t > eps && projection.t < 1 - eps && endpointId !== w.a && endpointId !== w.b) return 'A wall joins another wall without a shared vertex.'
      }
    }
  }
  const regions = faces(graph)
  if (!regions.length || regions.some(f => f.area < .0005 || !validLayoutPolygon(f.points))) return 'Partition creates an invalid or tiny space.'
  if (graph.rooms.some(r => regions.filter(f => f.room_id === r.room_id).length !== 1)) return 'A room lost its enclosed area. Move its partition or remove the room assignment first.'
  for (const o of graph.openings) {
    const w = graph.walls.find(item => item.id === o.wall_id)
    if (!w || o.start < .02 || o.end > .98 || o.end - o.start < .02 || o.start >= o.end) return 'Opening must fit within one existing wall.'
    if (graph.openings.some(other => other !== o && other.wall_id === o.wall_id && o.start < other.end + .01 && other.start < o.end + .01)) return 'Openings on the same wall overlap.'
  }
  return null
}
export function wallPoint(graph: LayoutGraph, wall: Wall, t: number): Point { const a = point(graph, wall.a), b = point(graph, wall.b); return { x: a.x + (b.x - a.x) * t, y: a.y + (b.y - a.y) * t } }
export function wallParameter(graph: LayoutGraph, wall: Wall, p: Point): number { return segmentDistance(p, point(graph, wall.a), point(graph, wall.b)).t }
export function faceCenter(face: Face): Point {
  const xs = face.points.map(p => p.x), ys = face.points.map(p => p.y)
  const minX = Math.min(...xs), minY = Math.min(...ys), dx = Math.max(...xs) - minX, dy = Math.max(...ys) - minY
  const center = { x: minX + dx / 2, y: minY + dy / 2 }
  if (contains(center, face.points, false)) return center
  for (let resolution = 5; resolution <= 40; resolution *= 2) for (let row = 0; row < resolution; row++) for (let column = 0; column < resolution; column++) {
    const candidate = { x: minX + (column + .5) * dx / resolution, y: minY + (row + .5) * dy / resolution }
    if (contains(candidate, face.points, false)) return candidate
  }
  throw new Error('Could not find an interior point for this room.')
}
export function wallAdjacency(graph: LayoutGraph, wall: Wall): { left: string | null; right: string | null } {
  const a = point(graph, wall.a), b = point(graph, wall.b), mid = wallPoint(graph, wall, .5), len = Math.hypot(b.x - a.x, b.y - a.y)
  const n = { x: -(b.y - a.y) / len * .0001, y: (b.x - a.x) / len * .0001 }
  const regions = faces(graph)
  return { left: regions.find(f => contains({ x: mid.x + n.x, y: mid.y + n.y }, f.points, false))?.room_id || null, right: regions.find(f => contains({ x: mid.x - n.x, y: mid.y - n.y }, f.points, false))?.room_id || null }
}

/** Converts only a single, exact tessellation. No existing polygon is changed by this function. */
export function candidateFromLegacy(source: LayoutGraph, polygons: { room_id: string; points: Point[] }[]): LayoutGraph {
  if (!polygons.length) throw new Error('Draw at least one indoor room before converting.')
  if (source.walls.length) throw new Error('This level already has shared-wall geometry.')
  if (polygons.some(p => !validLayoutPolygon(p.points))) throw new Error('One or more legacy room areas are invalid and need review.')
  if (new Set(polygons.map(p => p.room_id)).size !== polygons.length) throw new Error('A room has multiple legacy areas. Review it before conversion.')
  const all = polygons.flatMap(p => p.points)
  const key = (p: Point) => `${Math.round(p.x * 1e6)},${Math.round(p.y * 1e6)}`
  const unique = new Map(all.map(p => [key(p), p]))
  const vertexByKey = new Map([...unique].map(([name, p]) => [name, { ...p, id: crypto.randomUUID() }]))
  const edgeMap = new Map<string, { a: string; b: string; count: number }>()
  for (const polygon of polygons) for (let i = 0; i < polygon.points.length; i++) {
    const a = polygon.points[i], b = polygon.points[(i + 1) % polygon.points.length]
    const pieces = [a, b, ...[...unique.values()].filter(p => key(p) !== key(a) && key(p) !== key(b) && segmentDistance(p, a, b).distance < eps)].sort((p, q) => segmentDistance(p, a, b).t - segmentDistance(q, a, b).t)
    for (let j = 0; j < pieces.length - 1; j++) {
      const first = vertexByKey.get(key(pieces[j]))!.id, second = vertexByKey.get(key(pieces[j + 1]))!.id
      const pair = [first, second].sort().join(':')
      const entry = edgeMap.get(pair)
      if (entry) entry.count++
      else edgeMap.set(pair, { a: first, b: second, count: 1 })
    }
  }
  if ([...edgeMap.values()].some(edge => edge.count > 2)) throw new Error('Three rooms claim the same wall; review overlapping legacy polygons.')
  const exterior = [...edgeMap.values()].filter(edge => edge.count === 1)
  const neighbors = new Map<string, string[]>()
  for (const edge of exterior) for (const [a,b] of [[edge.a,edge.b],[edge.b,edge.a]]) neighbors.set(a, [...(neighbors.get(a) || []), b])
  if (!exterior.length || [...neighbors.values()].some(list => list.length !== 2)) throw new Error('The room union has gaps, overlaps, or disconnected boundaries. Trace a new footprint for review.')
  const boundary = [exterior[0].a]
  let previous = '', current = boundary[0]
  do {
    const next = neighbors.get(current)!.find(id => id !== previous)!
    previous = current; current = next
    if (current !== boundary[0]) boundary.push(current)
    if (boundary.length > exterior.length) throw new Error('Legacy room union has more than one boundary loop.')
  } while (current !== boundary[0])
  if (boundary.length !== exterior.length) throw new Error('Legacy room union is disconnected or has an internal hole.')
  const graph: LayoutGraph = { ...emptyGraph(), property_boundary: source.property_boundary, vertices: [...vertexByKey.values()],
    building_boundary: boundary, walls: [...edgeMap.values()].map(edge => ({ id: crypto.randomUUID(), a: edge.a, b: edge.b,
      kind: edge.count === 1 ? 'exterior' : 'interior', thickness: edge.count === 1 ? .18 : .1, height: 2.7 })) }
  const regions = faces(graph)
  if (regions.length !== polygons.length) throw new Error('Legacy rooms do not form a clean partition. Review boundaries manually.')
  graph.rooms = polygons.map(poly => {
    const face = regions.find(region => region.points.every(p => contains(p, poly.points)))
    if (!face || Math.abs(face.area - polygonArea(poly.points)) > .00001) throw new Error('Legacy room edges do not match exactly. Review this layout before conversion.')
    return { room_id: poly.room_id, point: faceCenter(face) }
  })
  const problem = validateGraph(graph)
  if (problem) throw new Error(problem)
  return graph
}
