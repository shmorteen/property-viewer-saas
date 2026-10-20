import type { LayoutGraph } from './topology'
import type { PlanResult } from './plan-analysis'

/** Analysis IDs describe image evidence; persistent room IDs belong to one review. */
export function preparePlanReview(result: PlanResult, propertyBoundary: LayoutGraph['property_boundary'], uuid: () => string = () => crypto.randomUUID()): PlanResult & { graph: LayoutGraph } {
  if (!result.graph) throw new Error('This analysis has no reviewable wall graph.')
  const copied = structuredClone(result)
  const graph = copied.graph!
  const ids = new Map<string, string>()
  for (const id of [...graph.rooms.map(room => room.room_id), ...copied.room_candidates.map(room => room.id)]) {
    if (!ids.has(id)) ids.set(id, uuid())
  }
  graph.property_boundary = structuredClone(propertyBoundary)
  graph.rooms = graph.rooms.map(room => ({ ...room, room_id: ids.get(room.room_id)! }))
  graph.site_edges = graph.site_edges.map(edge => ({ ...edge, room_id: ids.get(edge.room_id) || edge.room_id }))
  copied.room_candidates = copied.room_candidates.map(room => ({ ...room, id: ids.get(room.id)! }))
  if (copied.confidence) copied.confidence.rooms = Object.fromEntries(Object.entries(copied.confidence.rooms).map(([id, evidence]) => [ids.get(id) || id, evidence]))
  return { ...copied, graph }
}
