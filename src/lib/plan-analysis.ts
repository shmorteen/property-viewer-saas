import { supabase } from './supabase'
import { faces, validateGraph, type LayoutGraph } from './topology'
import type { Room, SpaceType } from './types'

export type EvidenceRating = { confidence: number; source: string[] }
export type PlanResult = {
  parser_version: string; input_sha256: string; status: 'USABLE' | 'NEEDS_REVIEW' | 'FAILED' | 'candidate' | 'refused'; graph: LayoutGraph | null
  quality: { accepted: boolean; width: number; height: number; blur_laplacian: number; contrast: number; skew_degrees: number; corrections: string[]; errors: string[]; warnings: string[] }
  structure_confidence?: { score: number; valid: boolean }; semantic_confidence?: { score: number }; opening_confidence?: { score: number }; scale_confidence?: { score: number }; optional_warnings?: string[]; failed_stage?: string | null
  room_candidates: { id: string; name: string; space_type: SpaceType; confidence: number; raw_text: string | null }[]
  unresolved: { kind: string; reason: string; box: number[]; points?: { x: number; y: number }[] }[]; validation_errors: string[]
  confidence?: { walls: Record<string, EvidenceRating>; junctions: Record<string, EvidenceRating>; rooms: Record<string, EvidenceRating>; openings: Record<string, EvidenceRating> }
  model: { available: boolean; name: string; reason?: string }; ocr?: { available: boolean; reason?: string }
  summary?: { wall_segments: number; enclosed_spaces: number; doors: number; windows: number; unresolved_openings: number; unidentified_rooms: number }
}
export type PlanExtraction = { id: string; level_id: string; floor_plan_id: string; source_path: string; status: 'queued' | 'processing' | 'completed' | 'failed' | 'accepted' | 'rejected'; result: PlanResult | null; error_message: string | null; original_path: string | null; normalized_path: string | null; created_at: string }
export type PlanCalibration = { source: 'wall_measurement'; wall_id: string; length_m: number }
export type PlanReview = {
  id: string; graph: LayoutGraph; rooms: Room[]; result: PlanResult
  onAccept: (graph: LayoutGraph, rooms: Room[], width: number, calibration: PlanCalibration, stats: { operations: number; seconds: number }) => Promise<void>
  onClose: () => void
}

/** Validate untrusted worker output before the existing graph routines dereference it. */
export function validatePlanCandidate(graph: LayoutGraph): string | null {
  if (!graph || !['vertices','walls','building_boundary','rooms','openings','property_boundary','site_edges'].every(key => Array.isArray((graph as unknown as Record<string, unknown>)[key]))) return 'Candidate is missing graph arrays.'
  if (graph.vertices.length > 500 || graph.walls.length > 700 || graph.openings.length > 300 || graph.building_boundary.length < 3) return 'Candidate exceeds supported graph limits.'
  if ([...graph.vertices, ...graph.walls, ...graph.openings, ...graph.rooms].some(item => !item || typeof item !== 'object')) return 'Candidate contains malformed elements.'
  const vertices = new Set(graph.vertices.map(v => v.id))
  const walls = new Set(graph.walls.map(w => w.id))
  if (vertices.size !== graph.vertices.length || walls.size !== graph.walls.length) return 'Candidate contains duplicate IDs.'
  if (graph.vertices.some(v => !v.id || !Number.isFinite(v.x) || !Number.isFinite(v.y) || v.x < 0 || v.x > 1 || v.y < 0 || v.y > 1)) return 'Candidate has invalid vertices.'
  if (graph.building_boundary.some(id => !vertices.has(id)) || graph.walls.some(w => !vertices.has(w.a) || !vertices.has(w.b) || !['interior','exterior','virtual'].includes(w.kind) || !Number.isFinite(w.height) || w.height <= 0 || !Number.isFinite(w.thickness) || w.thickness <= 0)) return 'Candidate has orphan or invalid walls.'
  if (graph.openings.some(o => !walls.has(o.wall_id) || !Number.isFinite(o.start) || !Number.isFinite(o.end))) return 'Candidate contains an unattached opening.'
  if (graph.rooms.some(r => !r.room_id || !r.point || !Number.isFinite(r.point.x) || !Number.isFinite(r.point.y))) return 'Candidate has invalid room seeds.'
  if (new Set(graph.rooms.map(r => r.room_id)).size !== graph.rooms.length) return 'Candidate repeats a room assignment.'
  try { return validateGraph(graph) } catch { return 'Candidate topology could not be validated.' }
}

export const isReviewablePlan = (result: PlanResult | null | undefined) => Boolean(result?.graph && ['USABLE', 'NEEDS_REVIEW', 'candidate'].includes(result.status))

export async function latestPlanExtraction(levelId: string): Promise<PlanExtraction | null> {
  const { data, error } = await supabase.from('plan_extractions').select('*').eq('level_id', levelId).order('created_at', { ascending: false }).limit(1).maybeSingle()
  if (error) throw error
  return data as PlanExtraction | null
}
export async function queuePlanExtraction(levelId: string): Promise<void> {
  const { error } = await supabase.rpc('queue_plan_extraction', { lid: levelId }); if (error) throw error
}
export async function rejectPlanExtraction(id: string): Promise<void> {
  const { error } = await supabase.rpc('reject_plan_extraction', { eid: id }); if (error) throw error
}
export async function acceptPlanExtraction(id: string, graph: LayoutGraph, rooms: Room[], width: number, calibration: PlanCalibration, stats: { operations: number; seconds: number }): Promise<void> {
  const problem = validatePlanCandidate(graph); if (problem) throw new Error(problem)
  const regions = faces(graph)
  const assigned = new Set(graph.rooms.map(room => room.room_id))
  const { error } = await supabase.rpc('accept_plan_extraction', {
    eid: id, payload: graph, room_specs: rooms.filter(room => assigned.has(room.id)).map((room, index) => ({ id: room.id, name: room.name, space_type: room.space_type, sort_order: index })),
    face_regions: regions.map(face => ({ room_id: face.room_id || null, points: face.points.map(p => ({ x: p.x, y: p.y })), vertex_ids: face.ids })),
    width_m: width, calibration, stats,
  })
  if (error) throw error
}
