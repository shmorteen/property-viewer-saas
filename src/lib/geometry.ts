import type { Point, RoomPolygon } from './types'

export const clamp = (value: number, min = 0, max = 1) => Math.max(min, Math.min(max, value))
const cross = (a: Point, b: Point, c: Point) => (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x)
const properCross = (a: Point, b: Point, c: Point, d: Point) => cross(a, b, c) * cross(a, b, d) < -1e-9 && cross(c, d, a) * cross(c, d, b) < -1e-9

export function polygonArea(points: Point[]): number {
  return Math.abs(points.reduce((sum, p, i) => sum + p.x * points[(i + 1) % points.length].y - points[(i + 1) % points.length].x * p.y, 0)) / 2
}

export function validLayoutPolygon(points: Point[]): boolean {
  if (points.length < 3 || points.length > 100 || points.some(p => !Number.isFinite(p.x) || !Number.isFinite(p.y) || p.x < 0 || p.x > 1 || p.y < 0 || p.y > 1)) return false
  if (polygonArea(points) < .0005) return false
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    if (Math.hypot(a.x - b.x, a.y - b.y) < .005) return false
    for (let j = i + 2; j < points.length; j++) {
      if (i === 0 && j === points.length - 1) continue
      if (properCross(a, b, points[j], points[(j + 1) % points.length])) return false
    }
  }
  return true
}

export function snapPoint(point: Point, polygons: RoomPolygon[], excludeId: string | null, enabled: boolean): Point {
  const raw = { x: clamp(point.x), y: clamp(point.y) }
  if (!enabled) return raw
  const grid = .025
  const snapped = { x: Math.round(raw.x / grid) * grid, y: Math.round(raw.y / grid) * grid }
  let bestX = snapped.x, bestY = snapped.y, distanceX = .012, distanceY = .012
  for (const polygon of polygons) {
    if (polygon.id === excludeId) continue
    for (const vertex of polygon.points) {
      const dx = Math.abs(vertex.x - raw.x), dy = Math.abs(vertex.y - raw.y)
      if (dx < distanceX) { bestX = vertex.x; distanceX = dx }
      if (dy < distanceY) { bestY = vertex.y; distanceY = dy }
    }
  }
  return { x: clamp(bestX), y: clamp(bestY) }
}

export function nearestSegment(points: Point[], point: Point): { segmentIndex: number; position: number; distance: number } | null {
  if (points.length < 2) return null
  let nearest: { segmentIndex: number; position: number; distance: number } | null = null
  for (let i = 0; i < points.length; i++) {
    const a = points[i], b = points[(i + 1) % points.length]
    const dx = b.x - a.x, dy = b.y - a.y
    const lengthSquared = dx * dx + dy * dy
    if (!lengthSquared) continue
    const position = clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / lengthSquared)
    const distance = Math.hypot(point.x - (a.x + position * dx), point.y - (a.y + position * dy))
    if (!nearest || distance < nearest.distance) nearest = { segmentIndex: i, position, distance }
  }
  return nearest
}

export function pointOnSegment(points: Point[], segmentIndex: number, position: number): Point {
  const a = points[segmentIndex], b = points[(segmentIndex + 1) % points.length]
  return { x: a.x + (b.x - a.x) * position, y: a.y + (b.y - a.y) * position }
}

function inside(point: Point, polygon: Point[]): boolean {
  let result = false
  for (let i = 0, j = polygon.length - 1; i < polygon.length; j = i++) {
    const a = polygon[i], b = polygon[j]
    if ((a.y > point.y) !== (b.y > point.y) && point.x < (b.x - a.x) * (point.y - a.y) / (b.y - a.y) + a.x) result = !result
  }
  return result
}

export function overlapsAnother(points: Point[], polygons: RoomPolygon[], excludeId: string | null): boolean {
  return polygons.some(poly => {
    if (poly.id === excludeId) return false
    const other = poly.points
    if (points.some(p => inside(p, other)) || other.some(p => inside(p, points))) return true
    return points.some((a, i) => other.some((c, j) => properCross(a, points[(i + 1) % points.length], c, other[(j + 1) % other.length])))
  })
}
