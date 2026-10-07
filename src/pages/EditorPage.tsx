import { useCallback, useEffect, useState, type ChangeEvent } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowDown, ArrowLeft, ArrowUp, Check, Copy, ImagePlus, Plus, Redo2, Trash2, Undo2, UploadCloud, X } from 'lucide-react'
import { useApp } from '../context'
import { addLevel, addMedia, addRoom, applyTemplate, deleteLevel, deleteMedia, deleteOpening, deletePolygon, deleteRoom, duplicateRoom, ensureDefaultLevel, getProperty, getLayoutGraph, saveLayoutGraph, listFloorPlans, listLevelPolygons, listLevels, listMedia, listOpenings, listRooms, listStairs, removeObject, saveFloorPlan, saveOpening, savePolygon, saveStair, signedUrl, updateLevel, updateSpace, upload } from '../lib/data'
import { clamp, overlapsAnother, snapPoint, validLayoutPolygon } from '../lib/geometry'
import { candidateFromLegacy } from '../lib/topology'
import { isLowResolutionPhoto } from '../lib/image-quality'
import { errorMessage } from '../lib/supabase'
import { layoutTemplates } from '../lib/templates'
import type { FloorPlan, Level, LevelType, Opening, OpeningType, Point, Property, Room, RoomMedia, RoomPolygon, SpaceCategory, SpaceType, StairConnection, StairType } from '../lib/types'
import { FloorPlanCanvas } from '../components/FloorPlanCanvas'
import { TopologyComposer } from '../components/TopologyComposer'
import { RoomPhotoTile } from '../components/RoomPhotoTile'
import { Button, Card, Field, Input, Notice, PageHeader, Spinner, Textarea } from '../components/ui'

const indoorTools: { type: SpaceType; label: string }[] = [
  { type: 'living_room', label: 'Living room' }, { type: 'bedroom', label: 'Bedroom' }, { type: 'kitchen', label: 'Kitchen' }, { type: 'bathroom', label: 'Bathroom' },
  { type: 'dining_room', label: 'Dining room' }, { type: 'corridor', label: 'Corridor' }, { type: 'office', label: 'Office' }, { type: 'garage', label: 'Garage' }, { type: 'utility', label: 'Utility' }, { type: 'other', label: 'Other indoor' },
]
const outdoorTools: { type: SpaceType; label: string }[] = [
  { type: 'building_footprint', label: 'Building footprint' }, { type: 'pool', label: 'Pool' }, { type: 'parking', label: 'Parking' }, { type: 'garden', label: 'Garden' },
  { type: 'patio', label: 'Patio' }, { type: 'driveway', label: 'Driveway' }, { type: 'terrace', label: 'Terrace' }, { type: 'yard', label: 'Yard' },
]
const openingTools: { type: OpeningType; label: string }[] = [
  { type: 'standard_door', label: 'Door' }, { type: 'double_door', label: 'Double door' }, { type: 'standard_window', label: 'Window' }, { type: 'wide_window', label: 'Wide window' },
]
const levelDefaults: Record<LevelType, { name: string; elevation: number }> = {
  site: { name: 'Site / Outdoor', elevation: 0 }, ground: { name: 'Ground Floor', elevation: 0 }, upper: { name: 'First Floor', elevation: 2.7 },
  basement: { name: 'Basement', elevation: -2.7 }, roof_terrace: { name: 'Roof Terrace', elevation: 8.1 }, custom: { name: 'New Level', elevation: 0 },
}
type GeometryEdit = { kind: 'polygon'; id: string; before: Point[]; after: Point[] } | { kind: 'opening'; id: string; before: number; after: number }

async function imageSize(file: File): Promise<{ width: number; height: number }> {
  return new Promise((resolve, reject) => { const image = new Image(); const url = URL.createObjectURL(file); image.onload = () => { resolve({ width: image.naturalWidth, height: image.naturalHeight }); URL.revokeObjectURL(url) }; image.onerror = () => { reject(new Error('Could not read image.')); URL.revokeObjectURL(url) }; image.src = url })
}

export function EditorPage() {
  const { id } = useParams()
  const { organization } = useApp()
  const [property, setProperty] = useState<Property | null>(null)
  const [levels, setLevels] = useState<Level[]>([])
  const [floors, setFloors] = useState<FloorPlan[]>([])
  const [floorUrls, setFloorUrls] = useState<Record<string, string>>({})
  const [rooms, setRooms] = useState<Room[]>([])
  const [media, setMedia] = useState<RoomMedia[]>([])
  const [polygons, setPolygons] = useState<RoomPolygon[]>([])
  const [openings, setOpenings] = useState<Opening[]>([])
  const [stairs, setStairs] = useState<StairConnection[]>([])
  const [selectedLevelId, setSelectedLevelId] = useState<string | null>(null)
  const [selectedRoomId, setSelectedRoomId] = useState<string | null>(null)
  const [selectedPolygonId, setSelectedPolygonId] = useState<string | null>(null)
  const [selectedOpeningId, setSelectedOpeningId] = useState<string | null>(null)
  const [draft, setDraft] = useState<Point[]>([])
  const [drawing, setDrawing] = useState(false)
  const [placingOpening, setPlacingOpening] = useState<OpeningType | null>(null)
  const [showAddLevel, setShowAddLevel] = useState(false)
  const [newLevelType, setNewLevelType] = useState<LevelType>('upper')
  const [newLevelName, setNewLevelName] = useState('First Floor')
  const [newElevation, setNewElevation] = useState(2.7)
  const [snap, setSnap] = useState(true)
  const [topologyRevision, setTopologyRevision] = useState(0)
  const [undoStack, setUndoStack] = useState<GeometryEdit[]>([])
  const [redoStack, setRedoStack] = useState<GeometryEdit[]>([])
  const [error, setError] = useState('')
  const [success, setSuccess] = useState('')
  const [loading, setLoading] = useState(true)
  const [busy, setBusy] = useState(false)

  const load = useCallback(async () => {
    if (!id) return
    const [nextProperty, existingLevels, nextFloors, nextRooms] = await Promise.all([getProperty(id), listLevels(id), listFloorPlans(id), listRooms(id)])
    const nextLevels = existingLevels.length ? existingLevels : [await ensureDefaultLevel(id)]
    const [nextMedia, nextPolygons, nextOpenings, nextStairs, urls] = await Promise.all([
      listMedia(nextRooms.map(room => room.id)), listLevelPolygons(nextLevels.map(level => level.id)), listOpenings(nextRooms.map(room => room.id)), listStairs(nextRooms.map(room => room.id)),
      Promise.all(nextFloors.map(async floor => [floor.level_id, await signedUrl('floor-plans', floor.storage_path)] as const)),
    ])
    const signedMedia = await Promise.all(nextMedia.map(async item => ({ ...item, url: await signedUrl('room-photos', item.storage_path) })))
    setProperty(nextProperty); setLevels(nextLevels); setFloors(nextFloors); setRooms(nextRooms); setMedia(signedMedia); setPolygons(nextPolygons); setOpenings(nextOpenings); setStairs(nextStairs); setFloorUrls(Object.fromEntries(urls))
    setSelectedLevelId(current => current && nextLevels.some(level => level.id === current) ? current : nextLevels[0].id)
    setSelectedRoomId(current => current && nextRooms.some(room => room.id === current) ? current : null)
  }, [id])
  useEffect(() => { setLoading(true); load().catch(e => setError(errorMessage(e))).finally(() => setLoading(false)) }, [load])
  const run = async (action: () => Promise<void>, message: string) => { setBusy(true); setError(''); setSuccess(''); try { await action(); await load(); setSuccess(message) } catch (e) { setError(errorMessage(e)) } finally { setBusy(false) } }

  const activeLevel = levels.find(level => level.id === selectedLevelId) || levels[0]
  const levelRooms = rooms.filter(room => room.level_id === activeLevel?.id)
  const levelPolygons = polygons.filter(poly => poly.level_id === activeLevel?.id)
  const levelOpenings = openings.filter(opening => levelRooms.some(room => room.id === opening.space_id))
  const floor = floors.find(item => item.level_id === activeLevel?.id)
  const activeRoom = levelRooms.find(room => room.id === selectedRoomId)
  const selectedPolygon = levelPolygons.find(poly => poly.id === selectedPolygonId)
  const selectedOpening = levelOpenings.find(opening => opening.id === selectedOpeningId)
  const stair = stairs.find(item => item.space_id === activeRoom?.id)
  const layoutIsEmpty = rooms.length === 0 && floors.length === 0

  const selectLevel = (level: Level) => { setSelectedLevelId(level.id); setSelectedRoomId(rooms.find(room => room.level_id === level.id)?.id || null); setSelectedPolygonId(null); setSelectedOpeningId(null); setDraft([]); setDrawing(false); setPlacingOpening(null); setUndoStack([]); setRedoStack([]) }
  const chooseLevelType = (type: LevelType) => { setNewLevelType(type); setNewLevelName(levelDefaults[type].name); setNewElevation(type === 'upper' ? Math.max(2.7, ...levels.filter(item => item.level_type === 'upper').map(item => Number(item.elevation) + 2.7)) : levelDefaults[type].elevation) }
  const createLevel = () => { if (!id || !newLevelName.trim()) return; void run(async () => { const level = await addLevel({ property_id: id, name: newLevelName.trim(), level_type: newLevelType, sort_order: levels.length, elevation: newElevation }); setSelectedLevelId(level.id); setSelectedRoomId(null); setShowAddLevel(false) }, 'Level added.') }
  const reorderLevel = (direction: -1 | 1) => { if (!activeLevel) return; const index = levels.findIndex(item => item.id === activeLevel.id); const other = levels[index + direction]; if (!other) return; void run(async () => { await updateLevel(activeLevel.id, { sort_order: other.sort_order }); await updateLevel(other.id, { sort_order: activeLevel.sort_order }) }, 'Level order updated.') }
  const removeLevel = () => { if (!activeLevel || levels.length < 2) return; if (levelRooms.length || floor || stairs.some(item => item.destination_level_id === activeLevel.id)) { setError('Remove this level’s spaces, floor plan, and stair connections before deleting it.'); return } if (!window.confirm(`Delete the empty level “${activeLevel.name}”?`)) return; void run(() => deleteLevel(activeLevel.id), 'Level deleted.') }
  const onFloor = (event: ChangeEvent<HTMLInputElement>) => {
    const file = event.target.files?.[0]; event.target.value = ''
    if (!file || !organization || !id || !activeLevel) return
    void run(async () => {
      const dimensions = await imageSize(file)
      const canvasWidth = 1200, canvasHeight = Math.round(1200 * dimensions.height / dimensions.width)
      if (canvasHeight < 200 || canvasHeight > 10000) throw new Error('Floor-plan image aspect ratio is outside the supported canvas range.')
      const newAspect = dimensions.width / dimensions.height
      const oldAspect = activeLevel.canvas_width / activeLevel.canvas_height
      if (activeLevel.geometry_mode === 'topology' && Math.abs(newAspect / oldAspect - 1) > .02) {
        const graph = await getLayoutGraph(activeLevel.id, id)
        if (graph.walls.length) throw new Error('This traced level uses a different plan aspect ratio. Use a matching image or trace a new level so walls do not stretch.')
      }
      const path = await upload('floor-plans', organization.id, id, file)
      let changedAspect = false
      try {
        if (activeLevel.geometry_mode === 'topology' && (activeLevel.canvas_width !== canvasWidth || activeLevel.canvas_height !== canvasHeight)) {
          await updateLevel(activeLevel.id, { canvas_width: canvasWidth, canvas_height: canvasHeight }); changedAspect = true
        }
        await saveFloorPlan(id, activeLevel.id, path, dimensions.width, dimensions.height)
      } catch (e) {
        if (changedAspect) await updateLevel(activeLevel.id, { canvas_width: activeLevel.canvas_width, canvas_height: activeLevel.canvas_height }).catch(() => {})
        await removeObject('floor-plans', path).catch(() => {})
        throw e
      }
      if (floor) await removeObject('floor-plans', floor.storage_path)
    }, 'Floor plan uploaded for this level.')
  }

  const addSpace = (type: SpaceType, category: SpaceCategory, label: string) => { if (!id || !activeLevel) return; void run(async () => { const existing = levelRooms.filter(room => room.space_type === type).length; const room = await addRoom({ property_id: id, level_id: activeLevel.id, name: existing ? `${label} ${existing + 1}` : label, sort_order: levelRooms.length, space_type: type, category, height: category === 'outdoor' ? .1 : 2.7 }); setSelectedRoomId(room.id); setSelectedPolygonId(null); setDraft([]); setDrawing(true) }, 'Space added. Draw its area on the canvas.') }
  const onPhotos = (event: ChangeEvent<HTMLInputElement>) => {
    const files = Array.from(event.target.files || []); event.target.value = ''
    if (!organization || !id || !activeRoom || !files.length) return
    void (async () => { const sizes = await Promise.all(files.map(imageSize)); const small = files.filter((_, index) => isLowResolutionPhoto(sizes[index].width, sizes[index].height)); if (small.length && !window.confirm(`${small.length} photo${small.length === 1 ? ' is' : 's are'} below 1200 × 900 px and may look blurry. Upload anyway?`)) return; await run(async () => { const first = media.filter(item => item.room_id === activeRoom.id).length; for (const [index, file] of files.entries()) { const path = await upload('room-photos', organization.id, id, file); try { await addMedia(activeRoom.id, path, file.name.replace(/\.[^.]+$/, ''), first + index) } catch (e) { await removeObject('room-photos', path); throw e } } }, `${files.length} photo${files.length === 1 ? '' : 's'} added.`) })().catch(e => setError(errorMessage(e)))
  }
  const validateArea = (points: Point[], excludeId: string | null) => { if (!validLayoutPolygon(points)) { setError('The area is too small, crosses itself, or has repeated corners. Adjust the points and try again.'); return false } if (overlapsAnother(points, levelPolygons, excludeId)) { setError('This area overlaps another space. Move the corners to keep the layout clear.'); return false } return true }
  const saveDraft = () => { if (!activeLevel || !activeRoom || !validateArea(draft, null)) return; void run(async () => { const poly = await savePolygon({ floor_plan_id: floor?.id || null, level_id: activeLevel.id, room_id: activeRoom.id, points: draft }); setSelectedPolygonId(poly.id); setDraft([]); setDrawing(false) }, 'Space area saved.') }
  const commitPolygon = (poly: RoomPolygon, points: Point[]) => { if (!validateArea(points, poly.id)) { void load(); return } void run(async () => { await savePolygon({ id: poly.id, floor_plan_id: poly.floor_plan_id, level_id: poly.level_id, room_id: poly.room_id, points }); setUndoStack(stack => [...stack.slice(-29), { kind: 'polygon', id: poly.id, before: poly.points, after: points }]); setRedoStack([]) }, 'Space area updated.') }
  const movePoint = (poly: RoomPolygon, index: number, point: Point) => commitPolygon(poly, poly.points.map((item, i) => i === index ? snapPoint(point, levelPolygons, poly.id, snap) : item))
  const movePolygon = (poly: RoomPolygon, delta: Point) => { const minX = Math.min(...poly.points.map(point => point.x)), maxX = Math.max(...poly.points.map(point => point.x)); const minY = Math.min(...poly.points.map(point => point.y)), maxY = Math.max(...poly.points.map(point => point.y)); const dx = clamp(delta.x, -minX, 1-maxX), dy = clamp(delta.y, -minY, 1-maxY); const first = snapPoint({ x: poly.points[0].x + dx, y: poly.points[0].y + dy }, levelPolygons, poly.id, snap); const shift = { x: clamp(first.x - poly.points[0].x, -minX, 1-maxX), y: clamp(first.y - poly.points[0].y, -minY, 1-maxY) }; commitPolygon(poly, poly.points.map(point => ({ x: clamp(point.x + shift.x), y: clamp(point.y + shift.y) }))) }
  const addOpening = (poly: RoomPolygon, segmentIndex: number, position: number) => { if (!placingOpening || poly.room_id !== activeRoom?.id) { setError('Select the space first, then click one of its wall segments.'); return } const type = placingOpening; void run(async () => { const opening = await saveOpening({ space_id: poly.room_id, polygon_id: poly.id, opening_type: type, segment_index: segmentIndex, position, width: type === 'double_door' || type === 'wide_window' ? 1.6 : .9, height: type.includes('door') ? 2.1 : 1.2, sill_height: type.includes('door') ? 0 : .9 }); setSelectedOpeningId(opening.id); setPlacingOpening(null) }, 'Opening attached to wall.') }
  const moveOpening = (opening: Opening, position: number) => { void run(async () => { await saveOpening({ ...opening, position }); setUndoStack(stack => [...stack.slice(-29), { kind: 'opening', id: opening.id, before: opening.position, after: position }]); setRedoStack([]) }, 'Opening moved along wall.') }
  const historyStep = (direction: 'undo' | 'redo') => { const from = direction === 'undo' ? undoStack : redoStack; const edit = from[from.length-1]; if (!edit) return; const target = direction === 'undo' ? edit.before : edit.after; void run(async () => { if (edit.kind === 'polygon') { const poly = polygons.find(item => item.id === edit.id); if (!poly || !Array.isArray(target)) throw new Error('The edited area no longer exists.'); await savePolygon({ ...poly, points: target }) } else { const opening = openings.find(item => item.id === edit.id); if (!opening || typeof target !== 'number') throw new Error('The edited opening no longer exists.'); await saveOpening({ ...opening, position: target }) } if (direction === 'undo') { setUndoStack(stack => stack.slice(0, -1)); setRedoStack(stack => [...stack, edit]) } else { setRedoStack(stack => stack.slice(0, -1)); setUndoStack(stack => [...stack, edit]) } }, direction === 'undo' ? 'Edit undone.' : 'Edit restored.') }

  const convertLegacy = () => { if (!activeLevel) return; void run(async () => {
    if (levelOpenings.length) throw new Error('This legacy level has doors or windows. Review and recreate them on shared walls before converting; no geometry was changed.')
    const source = await getLayoutGraph(activeLevel.id, activeLevel.property_id)
    const indoor = levelPolygons.filter(poly => levelRooms.find(room => room.id === poly.room_id)?.category === 'indoor')
    const candidate = candidateFromLegacy(source, indoor)
    if (!window.confirm(`A safe candidate was found: ${candidate.rooms.length} rooms and ${candidate.walls.length} shared walls. Convert this level? Existing room photos and tour URL will stay attached.`)) return
    await saveLayoutGraph(activeLevel.id, candidate)
  }, 'Legacy layout converted to shared-wall geometry.') }

  return <>
    <Link to={`/properties/${id}`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500 hover:text-pine"><ArrowLeft size={17}/>Property details</Link>
    <PageHeader eyebrow="Property layout" title="Layout composer" description={property ? `Map levels and spaces for ${property.title}.` : 'Build an interactive property layout.'} action={id && <Button variant="outline" asChild><Link to={`/properties/${id}/preview`}>Preview tour</Link></Button>} />
    {error && <div className="mb-4"><Notice>{error}</Notice></div>}{success && <div className="mb-4"><Notice kind="success">{success}</Notice></div>}
    {loading ? <Spinner /> : <div className="space-y-5">
      <Card><div className="flex flex-wrap items-center gap-2">
        {levels.map(level => <button key={level.id} onClick={() => selectLevel(level)} className={`min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold ${activeLevel?.id === level.id ? 'border-pine bg-pine text-white' : 'border-line bg-white hover:bg-mint'}`}>{level.name}</button>)}
        <Button size="sm" variant="outline" onClick={() => setShowAddLevel(!showAddLevel)}><Plus size={16}/>Add level</Button>
      </div>
      {showAddLevel && <div className="mt-4 grid gap-3 border-t border-line pt-4 sm:grid-cols-[1fr_1fr_120px_auto]"><select aria-label="New level type" className="h-10 rounded-xl border border-line px-3 text-sm" value={newLevelType} onChange={e => chooseLevelType(e.target.value as LevelType)}>{Object.entries(levelDefaults).map(([type, item]) => <option key={type} value={type}>{item.name}</option>)}</select><Input aria-label="New level name" maxLength={80} value={newLevelName} onChange={e => setNewLevelName(e.target.value)}/><Input aria-label="New level elevation" type="number" step="0.1" min="-100" max="1000" value={newElevation} onChange={e => setNewElevation(Number(e.target.value))}/><Button disabled={busy || !newLevelName.trim()} onClick={createLevel}>Create</Button></div>}
      {activeLevel && <div className="mt-4 flex flex-wrap items-end gap-3 border-t border-line pt-4"><Field label="Level name"><Input key={`${activeLevel.id}-name`} defaultValue={activeLevel.name} maxLength={80} onBlur={e => { const value = e.target.value.trim(); if (value && value !== activeLevel.name) void run(() => updateLevel(activeLevel.id, { name: value }), 'Level renamed.') }}/></Field><Field label="Elevation (m)"><Input key={`${activeLevel.id}-elevation`} type="number" min="-100" max="1000" step="0.1" defaultValue={activeLevel.elevation} onBlur={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value !== Number(activeLevel.elevation)) void run(() => updateLevel(activeLevel.id, { elevation: value }), 'Elevation updated.') }}/></Field><Button size="icon" variant="outline" title="Move level earlier" disabled={busy || levels[0]?.id === activeLevel.id} onClick={() => reorderLevel(-1)}><ArrowUp size={16}/></Button><Button size="icon" variant="outline" title="Move level later" disabled={busy || levels[levels.length-1]?.id === activeLevel.id} onClick={() => reorderLevel(1)}><ArrowDown size={16}/></Button><Button size="icon" variant="danger" title="Delete empty level" disabled={busy || levels.length < 2} onClick={removeLevel}><Trash2 size={16}/></Button></div>}
      </Card>

      {activeLevel?.geometry_mode === 'legacy' && <Card><h2 className="font-extrabold">Legacy geometry needs review</h2><p className="mt-1 text-sm text-slate-600">This level still uses independent room polygons. Existing rooms, photos, tours, and embeds continue to work. Exact non-overlapping partitions can be converted to shared walls after review.</p><Button size="sm" variant="outline" className="mt-3" disabled={busy || !levelPolygons.length} onClick={convertLegacy}>Review safe conversion</Button></Card>}

      {layoutIsEmpty && activeLevel?.geometry_mode === 'legacy' && <Card><h2 className="text-lg font-extrabold">Start your layout</h2><p className="mt-1 text-sm text-slate-500">Upload a floor plan for this level and trace spaces, or start with editable geometry.</p><div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">{layoutTemplates.map(template => <button key={template.id} disabled={busy} onClick={() => { if (!id) return; void run(() => applyTemplate(id, { levels: template.levels }), `${template.label} created. Every space can now be edited.`) }} className="min-h-24 rounded-xl border border-line bg-cream p-3 text-left hover:border-pine hover:bg-mint"><strong className="block text-sm">{template.label}</strong><span className="mt-1 block text-xs text-slate-500">{template.description}</span></button>)}</div></Card>}

      <div className="grid gap-5 lg:grid-cols-[220px_minmax(0,1fr)] 2xl:grid-cols-[220px_minmax(0,1fr)_300px]">
        {activeLevel?.geometry_mode === 'topology' && <div className="min-w-0 lg:col-span-1 2xl:col-span-2"><Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold">{activeLevel.name} · shared-wall layout</h2><p className="text-xs text-slate-500">Trace boundaries, partition the building, then assign rooms to enclosed areas.</p></div><label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-mint"><UploadCloud size={16}/>{floor ? 'Replace plan' : 'Upload plan'}<input aria-label="Upload floor plan" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFloor} disabled={busy}/></label></div><TopologyComposer propertyId={id!} layoutWidthM={property?.layout_width_m || 12} level={activeLevel} floor={floor} floorUrl={floor ? floorUrls[activeLevel.id] || null : null} rooms={levelRooms} polygons={levelPolygons} revision={topologyRevision} onChanged={load} onSelectRoom={roomId => setSelectedRoomId(roomId)}/></Card></div>}
        <div className={activeLevel?.geometry_mode === 'topology' ? 'hidden' : 'space-y-5'}><Card><h2 className="font-extrabold">Indoor spaces</h2><div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">{indoorTools.map(tool => <button key={tool.type} disabled={busy} onClick={() => addSpace(tool.type, 'indoor', tool.label)} className="min-h-10 rounded-lg border border-line px-3 text-left text-sm hover:bg-mint">+ {tool.label}</button>)}</div></Card><Card><h2 className="font-extrabold">Outdoor</h2><div className="mt-3 grid grid-cols-2 gap-2 xl:grid-cols-1">{outdoorTools.map(tool => <button key={tool.type} disabled={busy} onClick={() => addSpace(tool.type, 'outdoor', tool.label)} className="min-h-10 rounded-lg border border-line px-3 text-left text-sm hover:bg-mint">+ {tool.label}</button>)}</div></Card><Card><h2 className="font-extrabold">Features</h2><button disabled={busy} onClick={() => addSpace('stairs', 'indoor', 'Stairs')} className="mt-3 min-h-10 w-full rounded-lg border border-line px-3 text-left text-sm hover:bg-mint">+ Stairs</button><div className="mt-2 grid grid-cols-2 gap-2">{openingTools.map(tool => <button key={tool.type} disabled={busy || !activeRoom || !levelPolygons.some(poly => poly.room_id === activeRoom.id)} onClick={() => { setPlacingOpening(tool.type); setDrawing(false); setSelectedOpeningId(null) }} className={`min-h-10 rounded-lg border px-2 text-left text-xs ${placingOpening === tool.type ? 'border-pine bg-mint' : 'border-line hover:bg-mint'}`}>+ {tool.label}</button>)}</div></Card></div>

        <div className={activeLevel?.geometry_mode === 'topology' ? 'hidden' : 'min-w-0 space-y-5'}><Card><div className="mb-4 flex flex-wrap items-center justify-between gap-3"><div><h2 className="text-lg font-extrabold">{activeLevel?.name || 'Layout'}</h2><p className="text-xs text-slate-500">{floor ? 'Trace and edit over the uploaded plan.' : 'Draw on the blank layout canvas.'}</p></div><label className="inline-flex h-10 cursor-pointer items-center gap-2 rounded-xl border border-line px-3 text-sm font-semibold hover:bg-mint"><UploadCloud size={16}/>{floor ? 'Replace plan' : 'Upload plan'}<input aria-label="Upload floor plan" type="file" accept="image/jpeg,image/png,image/webp" className="sr-only" onChange={onFloor} disabled={busy}/></label></div>
          {activeLevel && <FloorPlanCanvas url={floor ? floorUrls[activeLevel.id] || null : null} imageWidth={floor?.width || activeLevel.canvas_width} imageHeight={floor?.height || activeLevel.canvas_height} rooms={levelRooms} polygons={levelPolygons} openings={levelOpenings} selectedRoomId={selectedRoomId} selectedPolygonId={selectedPolygonId} selectedOpeningId={selectedOpeningId} draft={draft} drawing={drawing} placingOpening={Boolean(placingOpening)} editable showGrid={snap} onBackgroundClick={point => setDraft(current => [...current, snapPoint(point, levelPolygons, null, snap)])} onSelectPolygon={poly => { setSelectedPolygonId(poly.id); setSelectedRoomId(poly.room_id); setSelectedOpeningId(null) }} onSelectOpening={opening => { setSelectedOpeningId(opening.id); setSelectedPolygonId(opening.polygon_id); setSelectedRoomId(opening.space_id) }} onWallClick={addOpening} onMovePoint={movePoint} onMovePolygon={movePolygon} onMoveOpening={moveOpening} />}
          <div className="mt-4 flex flex-wrap items-center gap-2">{drawing ? <><Button size="sm" disabled={busy || draft.length < 3} onClick={saveDraft}><Check size={15}/>Finish area ({draft.length})</Button><Button size="sm" variant="outline" disabled={!draft.length} onClick={() => setDraft(draft.slice(0,-1))}>Undo point</Button><Button size="sm" variant="ghost" onClick={() => { setDraft([]); setDrawing(false) }}><X size={15}/>Cancel</Button></> : <Button size="sm" disabled={!activeRoom || busy} onClick={() => { setDraft([]); setDrawing(true); setPlacingOpening(null); setSelectedPolygonId(null) }}>Draw area</Button>}
            {placingOpening && <Button size="sm" variant="outline" onClick={() => setPlacingOpening(null)}>Cancel {placingOpening.replaceAll('_',' ')}</Button>}
            <Button size="icon" variant="outline" title="Undo last geometry edit" disabled={busy || !undoStack.length} onClick={() => historyStep('undo')}><Undo2 size={16}/></Button><Button size="icon" variant="outline" title="Redo geometry edit" disabled={busy || !redoStack.length} onClick={() => historyStep('redo')}><Redo2 size={16}/></Button>
            <label className="flex items-center gap-2 text-xs"><input type="checkbox" checked={snap} onChange={e => setSnap(e.target.checked)}/>Snap to grid and nearby corners</label>
          </div><p className="mt-3 text-xs text-slate-500">{placingOpening ? 'Click a wall of the selected space to attach the opening.' : drawing ? 'Click at least three corners, then finish the area.' : 'Select an area. Drag inside to move it, drag white corners to reshape it, or drag an opening along its wall.'}</p>
          {selectedPolygon && !drawing && <Button size="sm" variant="danger" className="mt-3" disabled={busy} onClick={() => { if (window.confirm('Delete this space area and its attached openings?')) void run(async () => { await deletePolygon(selectedPolygon.id); setSelectedPolygonId(null); setSelectedOpeningId(null) }, 'Area deleted.') }}><Trash2 size={15}/>Delete selected area</Button>}
        </Card></div>

        <div className="space-y-5 lg:col-start-2 2xl:col-start-3 2xl:row-start-1"><Card><h2 className="text-lg font-extrabold">Spaces on this level</h2>{levelRooms.length ? <div className="mt-3 space-y-2">{levelRooms.map(room => <button key={room.id} onClick={() => { setSelectedRoomId(room.id); setSelectedPolygonId(levelPolygons.find(poly => poly.room_id === room.id)?.id || null); setSelectedOpeningId(null); setDrawing(false); setPlacingOpening(null); setDraft([]) }} className={`flex min-h-11 w-full items-center justify-between rounded-xl border px-3 text-left text-sm ${selectedRoomId === room.id ? 'border-pine bg-mint font-bold' : 'border-line hover:bg-cream'}`}><span>{room.name}</span><span className="text-xs text-slate-500">{media.filter(item => item.room_id === room.id).length} photos</span></button>)}</div> : <p className="mt-3 text-sm text-slate-500">{activeLevel?.geometry_mode === 'topology' ? 'Trace the footprint, partition it, then click Add room.' : 'Add a space on the left, then draw its area.'}</p>}</Card>
          {activeRoom && <Card><div className="flex items-center justify-between gap-2"><h2 className="text-lg font-extrabold">Selected space</h2><Button size="icon" variant="danger" title="Delete space" disabled={busy} onClick={() => { if (!window.confirm(`Delete “${activeRoom.name}”, its geometry, and its photos?`)) return; void run(async () => { if (activeLevel.geometry_mode === 'topology') { const graph = await getLayoutGraph(activeLevel.id, id!); await saveLayoutGraph(activeLevel.id, { ...graph, rooms: graph.rooms.filter(seed => seed.room_id !== activeRoom.id) }) } await deleteRoom(activeRoom.id); if (activeLevel.geometry_mode === 'topology') setTopologyRevision(value => value + 1); for (const item of media.filter(photo => photo.room_id === activeRoom.id)) await removeObject('room-photos', item.storage_path); setSelectedRoomId(null); setSelectedPolygonId(null) }, 'Space deleted.') }}><Trash2 size={16}/></Button></div><div className="mt-4 space-y-3">
            <Field label="Name"><Input key={`${activeRoom.id}-name`} defaultValue={activeRoom.name} maxLength={80} onBlur={e => { const value = e.target.value.trim(); if (value && value !== activeRoom.name) void run(() => updateSpace(activeRoom.id, { name: value }), 'Space renamed.') }}/></Field>
            <Field label="Category"><select className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={activeRoom.category} disabled={activeLevel.geometry_mode === 'topology'} onChange={e => void run(() => updateSpace(activeRoom.id, { category: e.target.value as SpaceCategory }), 'Category updated.')}><option value="indoor">Indoor</option><option value="outdoor">Outdoor</option></select></Field>
            <Field label="Type"><select className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={activeRoom.space_type} onChange={e => { const nextType = e.target.value as SpaceType; if (stair && nextType !== 'stairs' && !window.confirm('Change this stair space and remove its level connection?')) { e.target.value = activeRoom.space_type; return } void run(() => updateSpace(activeRoom.id, { space_type: nextType }), 'Space type updated.') }}><optgroup label="Indoor">{indoorTools.map(tool => <option key={tool.type} value={tool.type}>{tool.label}</option>)}<option value="stairs">Stairs</option><option value="studio">Studio</option><option value="store">Store</option></optgroup><optgroup label="Outdoor">{outdoorTools.map(tool => <option key={tool.type} value={tool.type}>{tool.label}</option>)}<option value="balcony">Balcony</option></optgroup></select></Field>
            <Field label="Height (m)"><Input key={`${activeRoom.id}-height`} type="number" min="0.1" max="20" step="0.1" defaultValue={activeRoom.height} onBlur={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value !== Number(activeRoom.height)) void run(() => updateSpace(activeRoom.id, { height: value }), 'Height updated.') }}/></Field>
            <Field label="Description"><Textarea key={`${activeRoom.id}-description`} defaultValue={activeRoom.description} onBlur={e => { if (e.target.value !== activeRoom.description) void run(() => updateSpace(activeRoom.id, { description: e.target.value }), 'Description updated.') }}/></Field>
          </div><Button size="sm" variant="outline" className="mt-3" disabled={busy || activeLevel.geometry_mode === 'topology'} onClick={() => void run(async () => { const copy = await duplicateRoom(activeRoom); setSelectedRoomId(copy.id); setSelectedPolygonId(null); setDrawing(true) }, 'Space details duplicated. Draw a new area for the copy.')}><Copy size={15}/>Duplicate details</Button>
          {activeRoom.space_type === 'stairs' && <div className="mt-5 space-y-3 border-t border-line pt-4"><h3 className="font-bold">Stair connection</h3><Field label="Destination level"><select aria-label="Destination level" className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={stair?.destination_level_id || ''} onChange={e => { if (!e.target.value) return; void run(() => saveStair({ id: stair?.id, space_id: activeRoom.id, destination_level_id: e.target.value, stair_type: stair?.stair_type || 'straight' }).then(() => {}), 'Stair levels connected.') }}><option value="">Choose destination</option>{levels.filter(level => level.id !== activeLevel?.id).map(level => <option key={level.id} value={level.id}>{level.name}</option>)}</select></Field><Field label="Stair type"><select aria-label="Stair type" className="h-11 w-full rounded-xl border border-line bg-white px-3 text-sm" value={stair?.stair_type || 'straight'} onChange={e => { if (!stair) return; void run(() => saveStair({ ...stair, stair_type: e.target.value as StairType }).then(() => {}), 'Stair type updated.') }}><option value="straight">Straight</option><option value="l_shaped">L-shaped</option><option value="u_shaped">U-shaped</option></select></Field></div>}
          <div className="mt-5 border-t border-line pt-4"><h3 className="font-bold">Photos</h3><label className="mt-3 flex min-h-14 cursor-pointer items-center justify-center gap-2 rounded-xl border-2 border-dashed border-line px-3 text-sm font-semibold text-pine hover:bg-mint"><ImagePlus size={18}/>Upload photos<input aria-label={`Upload photos for ${activeRoom.name}`} type="file" accept="image/jpeg,image/png,image/webp" multiple className="sr-only" onChange={onPhotos} disabled={busy}/></label><p className="mt-2 text-xs text-slate-500">Use original photos, ideally at least 1600 × 1200 px.</p><div className="mt-3 grid grid-cols-2 gap-2">{media.filter(item => item.room_id === activeRoom.id).map(item => <RoomPhotoTile key={item.id} item={item} roomName={activeRoom.name} busy={busy} onDelete={() => void run(async () => { await deleteMedia(item.id); await removeObject('room-photos', item.storage_path) }, 'Photo deleted.')} />)}</div></div>
          </Card>}
          {selectedOpening && <Card><h2 className="font-extrabold">Selected opening</h2><p className="mt-1 text-sm capitalize text-slate-500">{selectedOpening.opening_type.replaceAll('_',' ')}</p><Field label="Width (m)"><Input key={`${selectedOpening.id}-width`} className="mt-2" type="number" min="0.4" max="4" step="0.1" defaultValue={selectedOpening.width} onBlur={e => { const value = Number(e.target.value); if (Number.isFinite(value) && value !== Number(selectedOpening.width)) void run(() => saveOpening({ ...selectedOpening, width: value }).then(() => {}), 'Opening width updated.') }}/></Field><p className="mt-2 text-xs text-slate-500">Drag the marker along its wall to change position.</p><Button size="sm" variant="danger" className="mt-3" disabled={busy} onClick={() => { if (window.confirm('Delete this opening?')) void run(async () => { await deleteOpening(selectedOpening.id); setSelectedOpeningId(null) }, 'Opening deleted.') }}><Trash2 size={15}/>Delete opening</Button></Card>}
        </div>
      </div>
    </div>}
  </>
}
