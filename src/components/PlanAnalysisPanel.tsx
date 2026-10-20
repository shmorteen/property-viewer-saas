import { useCallback, useEffect, useState } from 'react'
import { getLayoutGraph, signedUrl } from '../lib/data'
import { acceptPlanExtraction, isReviewablePlan, latestPlanExtraction, planExtractionWasAccepted, queuePlanExtraction, rejectPlanExtraction, validatePlanCandidate, verifyPlanAcceptance, type PlanExtraction, type PlanReview } from '../lib/plan-analysis'
import { completePlanAcceptance } from '../lib/plan-acceptance'
import { preparePlanReview } from '../lib/plan-review'
import { errorMessage } from '../lib/supabase'
import type { FloorPlan, Level, Property } from '../lib/types'
import { Button, Card } from './ui'
import { TopologyComposer } from './TopologyComposer'

type Props = { property: Property; level: Level; levels: Level[]; floor?: FloorPlan; floorUrl: string | null; onChanged: () => Promise<void>; onReviewChange: (value: boolean) => void }
export function PlanAnalysisPanel({ property, level, levels, floor, floorUrl, onChanged, onReviewChange }: Props) {
  const [job, setJob] = useState<PlanExtraction | null>(null)
  const [review, setReview] = useState<PlanReview | undefined>()
  const [error, setError] = useState('')
  const [busy, setBusy] = useState(false)
  const [diagnostics, setDiagnostics] = useState<{ original: string; normalized: string } | null>(null)
  const refresh = useCallback(async () => { try { setJob(await latestPlanExtraction(level.id)) } catch (e) { setError(errorMessage(e)) } }, [level.id])
  useEffect(() => { void refresh(); const timer = window.setInterval(() => void refresh(), 5000); return () => clearInterval(timer) }, [refresh])
  const close = () => { setReview(undefined); onReviewChange(false) }
  const openReview = async () => {
    if (!job?.result?.graph || !isReviewablePlan(job.result)) return
    setBusy(true); setError('')
    try {
      const current = await getLayoutGraph(level.id, property.id)
      const result = preparePlanReview(job.result, current.property_boundary)
      const graph = result.graph
      const problem = validatePlanCandidate(graph); if (problem) throw new Error(problem)
      const rooms = result.room_candidates.map((room, index) => ({ id: room.id, property_id: property.id, level_id: level.id, name: room.name,
        description: '', sort_order: index, space_type: room.space_type, category: 'indoor' as const, height: 2.7, created_at: job.created_at }))
      const progress = { saved: false }
      let savedPayload: string | null = null
      setReview({ id: job.id, graph, rooms, result, onClose: close, onAccept: async (...args) => {
        const signature = JSON.stringify(args.slice(0, 4))
        if (progress.saved && savedPayload !== signature) throw new Error('This review was already saved. Close review and reload the persisted layout before making further changes.')
        await completePlanAcceptance(progress, {
          save: async () => { await acceptPlanExtraction(job.id, ...args); savedPayload = signature },
          hasSaved: async () => { const accepted = await planExtractionWasAccepted(job.id); if (accepted) savedPayload = signature; return accepted },
          verify: () => verifyPlanAcceptance(property.id, level.id, args[0], args[1], args[2]),
          reload: async () => { await onChanged(); setJob(await latestPlanExtraction(level.id)) }, close,
        })
      } }); onReviewChange(true)
    } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) }
  }
  const showDiagnostics = async () => {
    if (!job?.original_path || !job.normalized_path) return
    try { const [original, normalized] = await Promise.all([signedUrl('plan-analysis', job.original_path), signedUrl('plan-analysis', job.normalized_path)]); setDiagnostics({ original, normalized }) } catch (e) { setError(errorMessage(e)) }
  }
  const active = job?.status === 'queued' || job?.status === 'processing'
  const stale = job && floor && (job.floor_plan_id !== floor.id || job.source_path !== floor.storage_path)
  return <Card><h2 className="text-lg font-extrabold">Analyze this floor plan <span className="text-xs font-normal text-slate-500">Experimental</span></h2>
    <p className="mt-1 text-sm text-slate-600">Generate a shared-wall candidate from this level’s original image, then review and correct it in the composer. Acceptance requires wall-length calibration and an empty level.</p>
    {error && <p role="alert" className="mt-3 text-sm text-red-700">{error}</p>}
    <div className="mt-3 flex flex-wrap gap-2"><Button size="sm" disabled={!floor || busy || active || Boolean(review)} onClick={() => { setBusy(true); void queuePlanExtraction(level.id).then(refresh).catch(e => setError(errorMessage(e))).finally(() => setBusy(false)) }}>{active ? job.status === 'queued' ? 'Analysis queued — waiting for worker' : 'Analyzing original image…' : 'Analyze plan'}</Button>
      {job?.status === 'completed' && isReviewablePlan(job.result) && !stale && !review && <Button size="sm" variant="outline" disabled={busy} onClick={() => void openReview()}>Review detected layout</Button>}
      {job && ['completed','failed'].includes(job.status) && !review && <Button size="sm" variant="ghost" disabled={busy} onClick={() => { void rejectPlanExtraction(job.id).then(refresh).catch(e => setError(errorMessage(e))) }}>Reject candidate</Button>}
      {job?.original_path && <Button size="sm" variant="ghost" onClick={() => void showDiagnostics()}>Image diagnostics</Button>}
    </div>
    {stale && <p className="mt-3 text-sm text-amber-800">The source image changed. Analyze the current upload before reviewing.</p>}
    {job?.status === 'failed' && <p className="mt-3 text-sm text-red-700">Analysis failed: {job.error_message}. Continue manual tracing or retry.</p>}
    {job?.status === 'accepted' && <p className="mt-3 text-sm text-pine">Detected layout accepted. Continue with the normal editor and 3D workflow.</p>}
    {job?.result && <div className="mt-3 space-y-2 text-sm"><p>Image: {job.result.quality.width} × {job.result.quality.height}; skew {job.result.quality.skew_degrees.toFixed(1)}°; {job.result.model.available ? job.result.model.name : 'CV baseline; semantic model unavailable'}.</p>
      {job.result.structure_confidence && <p>Structure: {job.result.structure_confidence.valid ? 'valid' : 'failed'} ({Math.round(job.result.structure_confidence.score * 100)}% evidence rating) · labels {Math.round((job.result.semantic_confidence?.score || 0) * 100)}% · openings {Math.round((job.result.opening_confidence?.score || 0) * 100)}% · scale: wall calibration required. These ratings are heuristic.</p>}
      {job.result.status === 'NEEDS_REVIEW' && <p className="text-amber-800">Structure is editable. Review uncertain partitions, room labels and openings before accepting.</p>}
      {job.result.summary && <p>{job.result.summary.wall_segments} wall segments · {job.result.summary.enclosed_spaces} enclosed spaces · {job.result.summary.doors} doors · {job.result.summary.windows} windows. Needs review: {job.result.summary.unresolved_openings} opening candidates and {job.result.summary.unidentified_rooms} room labels.</p>}
      {['FAILED', 'refused'].includes(job.result.status) && <p className="text-amber-800">Automatic extraction is not confident enough. Keep the image and continue manual tracing.</p>}
      {[...job.result.quality.errors, ...job.result.validation_errors, ...job.result.quality.warnings, ...(job.result.optional_warnings || [])].map((message, index) => <p key={index} className="text-xs text-slate-600">{message}</p>)}
      <p className="text-xs text-slate-600">{job.result.quality.corrections.join(' · ') || 'Original orientation retained.'} {job.result.ocr?.available ? 'OCR labels are available for review.' : 'OCR unavailable; name the spaces during review.'}</p>
    </div>}
    {diagnostics && <div className="mt-3 grid gap-3 sm:grid-cols-2"><a href={diagnostics.original} target="_blank" rel="noreferrer" className="text-sm underline">Download unchanged original</a><a href={diagnostics.normalized} target="_blank" rel="noreferrer" className="text-sm underline">View normalized working copy</a></div>}
    {review && <div className="mt-5"><TopologyComposer key={review.id} propertyId={property.id} layoutWidthM={property.layout_width_m} level={level} levels={levels} floor={floor} floorUrl={floorUrl} rooms={[]} polygons={[]} revision={0} onChanged={onChanged} onSelectRoom={() => {}} review={review}/></div>}
  </Card>
}
