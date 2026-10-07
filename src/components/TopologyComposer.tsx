import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { addRoom, deleteRoom, getLayoutGraph, listMedia, restoreRoom, saveLayoutGraph, savePolygon } from '../lib/data'
import { overlapsAnother, validLayoutPolygon } from '../lib/geometry'
import { OPENING_WIDTHS_M, addPartition, contains, createBuilding, emptyGraph, faceCenter, faces, filletCorner, footprint, openingAt, orthogonalPoint, preserveOpeningWidths, snapToGraph, validateBoundary, validateGraph, wallLengthM, wallParameter, wallPoint, type EdgeBehavior, type LayoutGraph, type OpeningPreset, type Snap, type SnapOptions, type TopologyOpening, type Wall } from '../lib/topology'
import type { FloorPlan, Level, Point, Room, RoomPolygon, SpaceType } from '../lib/types'
import { Button } from './ui'

type Mode = 'select' | 'property' | 'building' | 'partition' | 'room' | 'door' | 'double_door' | 'window' | 'wide_window' | 'entrance' | 'outdoor'
type LayerName = 'property' | 'building' | 'spaces' | 'doors' | 'windows' | 'background'
type Props = { propertyId: string; layoutWidthM: number; level: Level; floor: FloorPlan | undefined; floorUrl: string | null; rooms: Room[]; polygons: RoomPolygon[]; revision: number; onChanged: () => Promise<void>; onSelectRoom: (id: string) => void }
type HistoryEntry = { graph: LayoutGraph; createdRoom?: Room; outdoorPoints?: Point[] }
const roomOptions: { type: SpaceType; name: string }[] = [
  { type: 'living_room', name: 'Living room' }, { type: 'bedroom', name: 'Bedroom' }, { type: 'bathroom', name: 'Bathroom' },
  { type: 'kitchen', name: 'Kitchen' }, { type: 'dining_room', name: 'Dining room' }, { type: 'corridor', name: 'Corridor' },
  { type: 'office', name: 'Office' }, { type: 'store', name: 'Closet / store' }, { type: 'utility', name: 'Washroom / utility' }, { type: 'stairs', name: 'Stairs' },
]
const outdoorOptions: { type: SpaceType; name: string }[] = [
  { type: 'garden', name: 'Garden' }, { type: 'pool', name: 'Pool' }, { type: 'parking', name: 'Parking' },
  { type: 'driveway', name: 'Driveway' }, { type: 'patio', name: 'Patio' }, { type: 'terrace', name: 'Terrace' },
  { type: 'balcony', name: 'Balcony' }, { type: 'porch', name: 'Porch / veranda' }, { type: 'yard', name: 'Yard' },
]
const openingType = (mode: Mode): TopologyOpening['type'] => ({ door: 'standard_door', double_door: 'double_door', window: 'standard_window', wide_window: 'wide_window', entrance: 'entrance' } as const)[mode as 'door' | 'double_door' | 'window' | 'wide_window' | 'entrance']
const isDoor = (mode: Mode) => mode === 'door' || mode === 'double_door'
const isWindow = (mode: Mode) => mode === 'window' || mode === 'wide_window'
const isOpeningMode = (mode: Mode) => isDoor(mode) || isWindow(mode) || mode === 'entrance'

export function TopologyComposer({ propertyId, layoutWidthM, level, floor, floorUrl, rooms, polygons, revision, onChanged, onSelectRoom }: Props) {
  const [graph, setGraph] = useState<LayoutGraph>(emptyGraph)
  const [mode, setMode] = useState<Mode>('select')
  const [roomType, setRoomType] = useState<SpaceType>('bedroom')
  const [outdoorType, setOutdoorType] = useState<SpaceType>('garden')
  const [draft, setDraft] = useState<Snap[]>([])
  const [openingDraft, setOpeningDraft] = useState<{ wall: Wall; start: number; end?: number } | null>(null)
  const [hover, setHover] = useState<Snap | null>(null)
  const [cursor, setCursor] = useState<Point | null>(null)
  const [selectedWall, setSelectedWall] = useState<string | null>(null)
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null)
  const [selectedVertex, setSelectedVertex] = useState<string | null>(null)
  const [selectedEdge, setSelectedEdge] = useState<{ roomId: string; index: number } | null>(null)
  const [filletRadius, setFilletRadius] = useState(.25)
  const [doorPreset, setDoorPreset] = useState<Exclude<OpeningPreset, 'custom'>>('standard')
  const [windowPreset, setWindowPreset] = useState<Exclude<OpeningPreset, 'custom'>>('standard')
  const [ortho, setOrtho] = useState(true)
  const [shiftHeld, setShiftHeld] = useState(false)
  const [spaceHeld, setSpaceHeld] = useState(false)
  const [snapOptions, setSnapOptions] = useState<Required<SnapOptions>>({ vertex: true, wall: true, grid: true })
  const [view, setView] = useState({ scale: 1, x: 0, y: 0 })
  const [width, setWidth] = useState(600)
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  const [layers, setLayers] = useState<Record<LayerName, boolean>>({ property: true, building: true, spaces: true, doors: true, windows: true, background: true })
  const [buildingLocked, setBuildingLocked] = useState(true)
  const [busy, setBusy] = useState(false)
  const [error, setError] = useState('')
  const [notice, setNotice] = useState('')
  const [past, setPast] = useState<HistoryEntry[]>([])
  const [future, setFuture] = useState<HistoryEntry[]>([])
  const container = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const height = Math.max(240, width * ((floor?.height || level.canvas_height) / (floor?.width || level.canvas_width) || .75))
  const aspect = (floor?.height || level.canvas_height) / (floor?.width || level.canvas_width)
  const sx = (p: Point) => p.x * width, sy = (p: Point) => p.y * height
  const pointAt = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => { const scene = event.target.getStage(), p = scene?.getPointerPosition(); if (!scene || !p) return null; const local = scene.getAbsoluteTransform().copy().invert().point(p); return { x: Math.max(0, Math.min(1, local.x / width)), y: Math.max(0, Math.min(1, local.y / height)) } }

  useEffect(() => { let active = true; getLayoutGraph(level.id, propertyId).then(value => { if (active) { setGraph(value); setPast([]); setFuture([]); setDraft([]); setSelectedEdge(null); setSelectedOpening(null); setSelectedWall(null); setSelectedVertex(null) } }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [level.id, propertyId, revision])
  useEffect(() => { if (!container.current) return; const observer = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width))); observer.observe(container.current); return () => observer.disconnect() }, [])
  useEffect(() => { if (!floorUrl) { setImage(null); return }; const next = new Image(); next.onload = () => setImage(next); next.src = floorUrl; return () => { next.onload = null } }, [floorUrl])
  const regions = useMemo(() => faces(graph), [graph])
  const building = useMemo(() => footprint(graph), [graph])
  const commit = async (next: LayoutGraph, message: string) => {
    try { next = preserveOpeningWidths(next, layoutWidthM, aspect) } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false }
    next = { ...next, site_edges: (next.site_edges || []).filter(edge => rooms.some(room => room.id === edge.room_id && room.category === 'outdoor')) }
    const problem = next.walls.length ? validateGraph(next) : validateBoundary(next.property_boundary)
    if (problem) { setError(problem); return false }
    setBusy(true); setError(''); setNotice('')
    try {
      await saveLayoutGraph(level.id, next)
      setPast(value => [...value.slice(-29), { graph }]); setFuture([]); setGraph(next); setDraft([]); setOpeningDraft(null); setNotice(message)
      await onChanged()
      return true
    } catch (e) { setError(e instanceof Error ? e.message : String(e)); return false } finally { setBusy(false) }
  }
  const history = async (direction: 'undo' | 'redo') => {
    const list = direction === 'undo' ? past : future, entry = list[list.length - 1]
    if (!entry) return
    setBusy(true); setError('')
    try {
      if (entry.createdRoom && direction === 'undo') {
        if ((await listMedia([entry.createdRoom.id])).length) throw new Error('This room now has photos. Remove those photos before undoing room creation.')
        if (!entry.outdoorPoints) await saveLayoutGraph(level.id, entry.graph)
        await deleteRoom(entry.createdRoom.id)
      } else if (entry.createdRoom && direction === 'redo') {
        await restoreRoom(entry.createdRoom)
        try {
          if (entry.outdoorPoints) await savePolygon({ room_id: entry.createdRoom.id, level_id: level.id, floor_plan_id: floor?.id || null, points: entry.outdoorPoints })
          else await saveLayoutGraph(level.id, entry.graph)
        } catch (e) { await deleteRoom(entry.createdRoom.id).catch(() => {}); throw e }
      } else await saveLayoutGraph(level.id, entry.graph)
      if (direction === 'undo') { setPast(list.slice(0, -1)); setFuture(value => [...value, { graph, createdRoom: entry.createdRoom, outdoorPoints: entry.outdoorPoints }]) }
      else { setFuture(list.slice(0, -1)); setPast(value => [...value, { graph, createdRoom: entry.createdRoom, outdoorPoints: entry.outdoorPoints }]) }
      setGraph(entry.graph); await onChanged()
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const changeMode = (next: Mode) => { setMode(next); setDraft([]); setOpeningDraft(null); setHover(null); setCursor(null); setError('') }
  const nearestWall = (p: Point, only?: Wall) => {
    const candidates = only ? [only] : graph.walls
    const ranked = candidates.map(w => { const t = wallParameter(graph, w, p), q = wallPoint(graph, w, t); return { wall: w, t, distance: Math.hypot((p.x - q.x) * width * view.scale, (p.y - q.y) * height * view.scale) } }).sort((a, b) => a.distance - b.distance)
    return ranked[0]?.distance <= 14 ? ranked[0] : null
  }
  const presetWidth = (tool: Mode): number => isDoor(tool) ? OPENING_WIDTHS_M.door[doorPreset] : OPENING_WIDTHS_M.window[windowPreset]
  const ghost = cursor && isOpeningMode(mode) && (!openingDraft || mode === 'entrance') ? (() => {
    const candidate = nearestWall(cursor, openingDraft?.wall)
    if (!candidate) return null
    const placement = mode === 'entrance' ? openingDraft ? { start: Math.min(openingDraft.start, candidate.t), end: Math.max(openingDraft.start, candidate.t) } : null
      : openingAt(graph, candidate.wall, candidate.t, presetWidth(mode), layoutWidthM, aspect)
    const valid = Boolean(placement && placement.end - placement.start >= .02 && placement.start >= .02 && placement.end <= .98 && !graph.openings.some(o => o.wall_id === candidate.wall.id && placement.start < o.end + .01 && o.start < placement.end + .01))
    return { wall: candidate.wall, placement, valid }
  })() : null
  const drawingSnap = (raw: Point): Snap => {
    const previous = draft[draft.length - 1]?.point
    const constrained = previous && (ortho !== shiftHeld) && (mode === 'property' || mode === 'building' || mode === 'partition' || mode === 'outdoor')
      ? orthogonalPoint(previous, raw, width, height) : raw
    const target = mode === 'partition' ? snapToGraph(graph, constrained, width * view.scale, height * view.scale, true, snapOptions)
      : snapOptions.grid ? snapToGraph(emptyGraph(), constrained, width * view.scale, height * view.scale, true, { vertex: false, wall: false, grid: true }) : { point: constrained, kind: 'free' as const }
    if (!previous || !(ortho !== shiftHeld)) return target
    if (Math.abs(target.point.x - previous.x) < 1e-6 || Math.abs(target.point.y - previous.y) < 1e-6) return target
    if (mode === 'partition' && target.kind === 'wall') {
      const wall = graph.walls.find(item => item.id === target.id)!
      const a = wallPoint(graph, wall, 0), b = wallPoint(graph, wall, 1)
      const horizontal = constrained.y === previous.y
      const denominator = horizontal ? b.y - a.y : b.x - a.x
      if (Math.abs(denominator) > 1e-8) {
        const t = ((horizontal ? previous.y - a.y : previous.x - a.x) / denominator)
        if (t >= 0 && t <= 1) return { point: wallPoint(graph, wall, t), kind: 'wall', id: wall.id, t }
      }
    }
    return { point: constrained, kind: 'free' }
  }
  const placeOpening = (p: Point) => {
    if (!openingDraft || mode === 'entrance' && openingDraft.end !== undefined) {
      const candidate = nearestWall(p)
      if (!candidate) { setError('Click a highlighted wall to place an opening.'); return }
      if (mode === 'entrance') { setOpeningDraft({ wall: candidate.wall, start: candidate.t }); setError(''); return }
      const placement = openingAt(graph, candidate.wall, candidate.t, presetWidth(mode), layoutWidthM, aspect)
      if (!placement) { setError('This wall is too short for the selected width.'); return }
      if (isWindow(mode)) void finishOpening(candidate.wall, placement.start, placement.end, 1)
      else setOpeningDraft({ wall: candidate.wall, ...placement })
      return
    }
    if (mode === 'entrance') {
      const candidate = nearestWall(p, openingDraft.wall)
      if (!candidate) { setError('The second entrance point must be on the same wall.'); return }
      const [start, end] = [candidate.t, openingDraft.start].sort((a, b) => a - b)
      if (end - start < .02) { setError('Entrance width is too small.'); return }
      void finishOpening(openingDraft.wall, start, end, 1); return
    }
    if (openingDraft.end === undefined) return
    const a = graph.vertices.find(v => v.id === openingDraft.wall.a)!, b = graph.vertices.find(v => v.id === openingDraft.wall.b)!
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < .003) { setError('Point 3 should be away from the wall to indicate swing side.'); return }
    void finishOpening(openingDraft.wall, openingDraft.start, openingDraft.end, cross > 0 ? 1 : -1)
  }
  const finishOpening = async (wall: Wall, start: number, end: number, swing: -1 | 1) => {
    const type = openingType(mode)
    const next: LayoutGraph = { ...graph, openings: [...graph.openings, { id: crypto.randomUUID(), wall_id: wall.id, type, start, end,
      height: type === 'entrance' ? wall.height : isDoor(mode) ? Math.min(2.1, wall.height) : Math.min(1.2, wall.height),
      sill: type === 'entrance' || isDoor(mode) ? 0 : Math.min(.9, Math.max(0, wall.height - 1.2)), swing,
      preset: type === 'entrance' ? 'custom' : isDoor(mode) ? doorPreset : windowPreset,
      width_m: (end - start) * wallLengthM(graph, wall, layoutWidthM, aspect) }] }
    const problem = validateGraph(next)
    if (problem) { setError(problem); return }
    if (await commit(next, 'Opening attached. Click another wall or press Esc to finish.')) { setOpeningDraft(null); setCursor(null) }
  }
  const onCanvasClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (busy) return
    const p = pointAt(event); if (!p) return
    if (spaceHeld) return
    if (isOpeningMode(mode)) { placeOpening(p); return }
    if (mode === 'room') {
      const face = regions.find(f => contains(p, f.points, false))
      if (!face || face.room_id) { setError('Select an unassigned enclosed space. Draw a partition first if needed.'); return }
      void assignRoom(faceCenter(face)); return
    }
    if (mode === 'select') return
    const snap = drawingSnap(p)
    if (mode === 'partition' && draft.length === 0 && !['vertex', 'wall'].includes(snap.kind)) { setError('Start a partition on a wall or vertex.'); return }
    setDraft(value => [...value, snap]); setError('')
  }
  const assignRoom = async (seed: Point) => {
    const option = roomOptions.find(item => item.type === roomType)!
    const count = rooms.filter(room => room.space_type === roomType).length
    setBusy(true); setError('')
    let created: Room | null = null
    try {
      created = await addRoom({ property_id: propertyId, level_id: level.id, name: count ? `${option.name} ${count + 1}` : option.name, sort_order: rooms.length, space_type: roomType, category: 'indoor', height: 2.7 })
      const next = { ...graph, rooms: [...graph.rooms, { room_id: created.id, point: seed }] }
      const problem = validateGraph(next); if (problem) throw new Error(problem)
      await saveLayoutGraph(level.id, next)
      setPast(value => [...value.slice(-29), { graph, createdRoom: created! }]); setFuture([]); setGraph(next); onSelectRoom(created.id); await onChanged(); setNotice('Room created from shared walls.')
    } catch (e) { if (created) await deleteRoom(created.id).catch(() => {}); setError(e instanceof Error ? e.message : String(e)) } finally { setBusy(false) }
  }
  const finishDraft = async () => {
    const points = draft.map(item => item.point)
    try {
      let saved = false
      if (mode === 'property') {
        const problem = validateBoundary(points); if (problem) throw new Error(problem)
        if (building.length && validateBoundary(building, points)) throw new Error('The current building would fall outside this property boundary.')
        if (polygons.filter(poly => rooms.find(room => room.id === poly.room_id)?.category === 'outdoor').some(poly => validateBoundary(poly.points, points))) throw new Error('An outdoor area would fall outside this property boundary.')
        saved = await commit({ ...graph, property_boundary: points }, 'Property boundary saved.')
      }
      if (mode === 'building') saved = await commit(createBuilding(graph, points), 'Building walls traced. Draw partitions next.')
      if (mode === 'partition') saved = await commit(addPartition(graph, draft), 'Partition added; select Add room and click the enclosed area.')
      if (mode === 'outdoor') saved = await addOutdoor(points)
      if (saved) { setMode('select'); setDraft([]); setOpeningDraft(null) }
    } catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const addOutdoor = async (points: Point[]): Promise<boolean> => {
    const buildingPolygon = building.length ? [{ id: 'building', points: building } as RoomPolygon] : []
    if (!validLayoutPolygon(points) || !graph.property_boundary.length || validateBoundary(points, graph.property_boundary) || overlapsAnother(points, [...polygons, ...buildingPolygon], null)) { setError('Outdoor space must be a valid non-overlapping area inside the property boundary and outside the building.'); return false }
    const option = outdoorOptions.find(item => item.type === outdoorType)!
    let created: Room | null = null
    setBusy(true)
    try {
      created = await addRoom({ property_id: propertyId, level_id: level.id, name: option.name, sort_order: rooms.length, space_type: outdoorType, category: 'outdoor', height: .1 })
      await savePolygon({ room_id: created.id, level_id: level.id, floor_plan_id: floor?.id || null, points })
      setPast(value => [...value.slice(-29), { graph, createdRoom: created!, outdoorPoints: points }]); setFuture([])
      onSelectRoom(created.id); await onChanged(); setNotice('Outdoor area saved.'); return true
    } catch (e) { if (created) await deleteRoom(created.id).catch(() => {}); setError(e instanceof Error ? e.message : String(e)); return false } finally { setBusy(false) }
  }
  const moveVertex = (id: string, p: Point) => {
    const vertex = graph.vertices.find(v => v.id === id)!
    if (buildingLocked && graph.building_boundary.includes(id)) { setError('Unlock Building boundary to move exterior vertices.'); return }
    const snapped = snapToGraph({ ...graph, vertices: graph.vertices.filter(v => v.id !== id) }, p, width * view.scale, height * view.scale, true, snapOptions)
    const next = { ...graph, vertices: graph.vertices.map(v => v.id === id ? { ...v, ...snapped.point } : v) }
    if (Math.hypot(vertex.x - snapped.point.x, vertex.y - snapped.point.y) > 1e-5) void commit(next, 'Shared vertex moved; adjacent rooms updated.')
  }
  const moveWall = (wall: Wall, delta: Point) => {
    const ids = [wall.a, wall.b]
    const next: LayoutGraph = structuredClone(graph)
    for (const id of ids) {
      const vertex = next.vertices.find(item => item.id === id)!
      let target = { x: Math.max(0, Math.min(1, vertex.x + delta.x)), y: Math.max(0, Math.min(1, vertex.y + delta.y)) }
      const index = next.building_boundary.indexOf(id)
      if (index >= 0 && buildingLocked) {
        const previous = next.vertices.find(item => item.id === next.building_boundary[(index - 1 + next.building_boundary.length) % next.building_boundary.length])!
        const following = next.vertices.find(item => item.id === next.building_boundary[(index + 1) % next.building_boundary.length])!
        const vx = following.x - previous.x, vy = following.y - previous.y
        if (Math.abs((vertex.x - previous.x) * vy - (vertex.y - previous.y) * vx) > 1e-6) { setError('Unlock the building boundary to move a corner wall.'); return }
        const t = Math.max(.02, Math.min(.98, ((target.x - previous.x) * vx + (target.y - previous.y) * vy) / (vx * vx + vy * vy)))
        target = { x: previous.x + t * vx, y: previous.y + t * vy }
      }
      Object.assign(vertex, target)
    }
    void commit(next, 'Shared wall moved; adjacent room polygons updated.')
  }
  const deleteSelected = () => {
    if (selectedOpening) { const next = { ...graph, openings: graph.openings.filter(o => o.id !== selectedOpening) }; void commit(next, 'Opening deleted.'); setSelectedOpening(null); return }
    if (selectedWall) {
      const wall = graph.walls.find(w => w.id === selectedWall)!
      if (wall.kind === 'exterior') { setError('Exterior walls can only change by editing the building boundary.'); return }
      if (graph.openings.some(o => o.wall_id === wall.id) && !window.confirm('Delete this wall and its attached openings?')) return
      const next = { ...graph, walls: graph.walls.filter(w => w.id !== wall.id), openings: graph.openings.filter(o => o.wall_id !== wall.id) }
      void commit(next, 'Wall deleted.'); setSelectedWall(null)
    }
  }
  const editOpening = (change: Partial<TopologyOpening>) => {
    const current = graph.openings.find(item => item.id === selectedOpening)
    if (!current) return
    const wall = graph.walls.find(item => item.id === current.wall_id)!
    const nextValue = { ...current, ...change }
    if (change.width_m !== undefined) {
      const placement = openingAt(graph, wall, (current.start + current.end) / 2, change.width_m, layoutWidthM, aspect)
      if (!placement) { setError('Selected width does not fit on this wall.'); return }
      Object.assign(nextValue, placement)
    }
    void commit({ ...graph, openings: graph.openings.map(item => item.id === current.id ? nextValue : item) }, 'Opening updated.')
  }
  const moveOpening = (opening: TopologyOpening, p: Point) => {
    const wall = graph.walls.find(item => item.id === opening.wall_id)!
    const center = wallParameter(graph, wall, p), half = (opening.end - opening.start) / 2
    void commit({ ...graph, openings: graph.openings.map(item => item.id === opening.id ? { ...item, start: center - half, end: center + half } : item) }, 'Opening moved along its wall.')
  }
  const resizeEntrance = (opening: TopologyOpening, side: 'start' | 'end', p: Point) => {
    const wall = graph.walls.find(item => item.id === opening.wall_id)!
    const t = wallParameter(graph, wall, p)
    const changed = { ...opening, [side]: t, width_m: Math.abs((side === 'start' ? opening.end - t : t - opening.start) * wallLengthM(graph, wall, layoutWidthM, aspect)) }
    void commit({ ...graph, openings: graph.openings.map(item => item.id === opening.id ? changed : item) }, 'Entrance resized.')
  }
  const setEdgeBehavior = (behavior: EdgeBehavior, heightValue?: number) => {
    if (!selectedEdge) return
    const current = (graph.site_edges || []).find(item => item.room_id === selectedEdge.roomId && item.segment_index === selectedEdge.index)
    const defaultHeight = behavior === 'railing' ? 1.05 : behavior === 'parapet' ? .9 : behavior === 'wall' ? 2.7 : 0
    const next = { room_id: selectedEdge.roomId, segment_index: selectedEdge.index, behavior,
      height: heightValue ?? (current?.behavior === behavior ? current.height : defaultHeight),
      thickness: current?.behavior === behavior ? current.thickness : behavior === 'railing' ? .06 : .12 }
    void commit({ ...graph, site_edges: [...(graph.site_edges || []).filter(item => item.room_id !== selectedEdge.roomId || item.segment_index !== selectedEdge.index), next] }, 'Outdoor edge updated.')
  }
  const applyFillet = () => {
    if (!selectedVertex) { setError('Select an exterior corner first.'); return }
    if (buildingLocked) { setError('Unlock the building boundary to round a corner.'); return }
    try { void commit(filletCorner(graph, selectedVertex, filletRadius, layoutWidthM, aspect), 'Corner rounded with connected walls.'); setSelectedVertex(null) }
    catch (e) { setError(e instanceof Error ? e.message : String(e)) }
  }
  const zoomTo = (scale: number, center = { x: width / 2, y: height / 2 }) => {
    const bounded = Math.max(.5, Math.min(5, scale))
    setView(current => ({ scale: bounded, x: center.x - (center.x - current.x) * bounded / current.scale, y: center.y - (center.y - current.y) * bounded / current.scale }))
  }
  const fitView = () => {
    const points = graph.property_boundary.length ? graph.property_boundary : building.length ? building : []
    if (!points.length) { setView({ scale: 1, x: 0, y: 0 }); return }
    const minX = Math.min(...points.map(p => p.x)), maxX = Math.max(...points.map(p => p.x))
    const minY = Math.min(...points.map(p => p.y)), maxY = Math.max(...points.map(p => p.y))
    const scale = Math.max(.5, Math.min(5, Math.min(.85 / Math.max(.05, maxX - minX), .85 / Math.max(.05, maxY - minY))))
    setView({ scale, x: width / 2 - (minX + maxX) / 2 * width * scale, y: height / 2 - (minY + maxY) / 2 * height * scale })
  }
  useEffect(() => {
    const keyDown = (event: KeyboardEvent) => {
      if (event.key === 'Shift') { setShiftHeld(true); return }
      if (event.target instanceof HTMLInputElement || event.target instanceof HTMLTextAreaElement || event.target instanceof HTMLSelectElement || (event.target instanceof HTMLElement && event.target.isContentEditable)) return
      if (event.code === 'Space' && !(event.target instanceof HTMLButtonElement)) { setSpaceHeld(true); event.preventDefault(); return }
      const modifier = event.ctrlKey || event.metaKey
      if (modifier && event.key.toLowerCase() === 'z') { event.preventDefault(); void history(event.shiftKey ? 'redo' : 'undo'); return }
      if (modifier && event.key.toLowerCase() === 'y') { event.preventDefault(); void history('redo'); return }
      if (modifier) return
      if (event.key === 'Escape') { event.preventDefault(); if (openingDraft) setOpeningDraft(null); else changeMode('select'); return }
      if (event.key === 'Enter' && draft.length) { event.preventDefault(); void finishDraft(); return }
      if ((event.key === 'Backspace' || event.key === 'Delete') && (selectedOpening || selectedWall)) { event.preventDefault(); deleteSelected(); return }
      if (event.key.toLowerCase() === 'o') { event.preventDefault(); setOrtho(value => !value); return }
      if (event.key.toLowerCase() === 'f') { event.preventDefault(); fitView(); return }
      if (event.key === '+' || event.key === '=') { event.preventDefault(); zoomTo(view.scale * 1.2); return }
      if (event.key === '-') { event.preventDefault(); zoomTo(view.scale / 1.2) }
    }
    const keyUp = (event: KeyboardEvent) => { if (event.key === 'Shift') setShiftHeld(false); if (event.code === 'Space') setSpaceHeld(false) }
    const blur = () => { setShiftHeld(false); setSpaceHeld(false) }
    window.addEventListener('keydown', keyDown); window.addEventListener('keyup', keyUp); window.addEventListener('blur', blur)
    return () => { window.removeEventListener('keydown', keyDown); window.removeEventListener('keyup', keyUp); window.removeEventListener('blur', blur) }
  })
  const swingArc = (opening: TopologyOpening, wall: Wall) => {
    const hinge = wallPoint(graph, wall, opening.start), tip = wallPoint(graph, wall, opening.end)
    const radius = Math.hypot((tip.x - hinge.x) * width, (tip.y - hinge.y) * height)
    const base = Math.atan2((tip.y - hinge.y) * height, (tip.x - hinge.x) * width)
    const values: number[] = []
    for (let i = 0; i <= 12; i++) { const a = base + opening.swing * i / 12 * Math.PI / 2; values.push(sx(hinge) + Math.cos(a) * radius, sy(hinge) + Math.sin(a) * radius) }
    return values
  }
  const layerToggle = (name: LayerName) => setLayers(value => ({ ...value, [name]: !value[name] }))
  const selectedOpeningData = graph.openings.find(item => item.id === selectedOpening)
  const selectedEdgeData = selectedEdge && (graph.site_edges || []).find(item => item.room_id === selectedEdge.roomId && item.segment_index === selectedEdge.index)
  const selectedEdgeBehavior: EdgeBehavior = selectedEdgeData?.behavior || (selectedEdge && ['balcony', 'terrace'].includes(rooms.find(room => room.id === selectedEdge.roomId)?.space_type || '') ? 'railing' : 'open')
  const selectedEdgeHeight = selectedEdgeData?.height ?? (selectedEdgeBehavior === 'railing' ? 1.05 : selectedEdgeBehavior === 'parapet' ? .9 : selectedEdgeBehavior === 'wall' ? 2.7 : 0)

  return <div className="space-y-4">
    <div className="space-y-2" role="toolbar" aria-label="Layout drawing modes">
      {([['Select', [['select','Select']]], ['Draw', [['property','Property boundary'],['building','Building boundary'],['partition','Partition'],['room','Add room'],['outdoor','Outdoor space']]], ['Openings', [['door','Door'],['double_door','Double door'],['window','Window'],['wide_window','Wide window'],['entrance','Entrance']]]] as [string, [Mode,string][]][]).map(([group, tools]) => <div key={group} className="flex flex-wrap items-center gap-2"><span className="w-16 text-[10px] font-bold uppercase tracking-widest text-slate-500">{group}</span>{tools.map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy || (value === 'building' && graph.walls.length > 0)} onClick={() => changeMode(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${mode === value ? 'border-pine bg-pine text-white' : 'border-line bg-white hover:bg-mint'}`}>{label}</button>)}</div>)}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Precision drawing controls">
      <span className="font-bold uppercase tracking-widest text-slate-500">Precision</span>
      <button type="button" aria-pressed={ortho} title="O · Shift temporarily reverses Ortho" onClick={() => setOrtho(value => !value)} className={`rounded-lg border px-3 py-2 font-semibold ${ortho ? 'border-pine bg-mint text-pine' : 'border-line bg-white'}`}>Ortho {ortho ? 'ON' : 'OFF'}</button>
      {([['vertex','Vertex'],['wall','Wall'],['grid','Grid']] as [keyof SnapOptions,string][]).map(([key,label]) => <label key={key} className="flex items-center gap-1 rounded-lg border border-line bg-white px-2 py-2"><input type="checkbox" checked={snapOptions[key]} onChange={e => setSnapOptions(value => ({ ...value, [key]: e.target.checked }))}/>Snap {label}</label>)}
      <button type="button" disabled={!selectedVertex || busy} onClick={applyFillet} className="rounded-lg border border-line bg-white px-3 py-2 font-semibold disabled:opacity-50">Fillet selected corner</button>
      <select aria-label="Fillet radius" value={[.15,.25,.5].includes(filletRadius) ? String(filletRadius) : 'custom'} onChange={e => setFilletRadius(e.target.value === 'custom' ? .3 : Number(e.target.value))} className="rounded-lg border border-line bg-white px-2 py-2"><option value="0.15">Small · 0.15 m</option><option value="0.25">Medium · 0.25 m</option><option value="0.5">Large · 0.5 m</option><option value="custom">Custom</option></select>
      {![.15,.25,.5].includes(filletRadius) && <input aria-label="Custom fillet radius metres" type="number" min="0.02" step="0.05" value={filletRadius} className="w-24 rounded-lg border border-line px-2 py-2" onChange={e => setFilletRadius(Number(e.target.value))}/>}
    </div>
    <div className="flex flex-wrap items-center gap-2 text-xs" aria-label="Layout view controls"><span className="font-bold uppercase tracking-widest text-slate-500">View</span><button type="button" onClick={() => zoomTo(view.scale * 1.2)} className="rounded-lg border border-line bg-white px-3 py-2">Zoom +</button><button type="button" onClick={() => zoomTo(view.scale / 1.2)} className="rounded-lg border border-line bg-white px-3 py-2">Zoom −</button><button type="button" onClick={fitView} className="rounded-lg border border-line bg-white px-3 py-2">Fit to view</button><button type="button" onClick={() => setView({ scale: 1, x: 0, y: 0 })} className="rounded-lg border border-line bg-white px-3 py-2">Reset view</button><span>{Math.round(view.scale * 100)}%</span></div>
    {(isDoor(mode) || isWindow(mode)) && <label className="flex items-center gap-2 text-sm">{isDoor(mode) ? 'Door' : 'Window'} width<select aria-label="Opening width preset" className="rounded-lg border border-line px-2 py-1" value={isDoor(mode) ? doorPreset : windowPreset} onChange={e => isDoor(mode) ? setDoorPreset(e.target.value as typeof doorPreset) : setWindowPreset(e.target.value as typeof windowPreset)}>{(['narrow','standard','wide'] as const).map(preset => <option key={preset} value={preset}>{preset[0].toUpperCase() + preset.slice(1)} · {(isDoor(mode) ? OPENING_WIDTHS_M.door[preset] : OPENING_WIDTHS_M.window[preset]).toFixed(2)} m</option>)}</select></label>}
    {(mode === 'room' || mode === 'outdoor') && <label className="flex items-center gap-2 text-sm">{mode === 'room' ? 'Room type' : 'Outdoor type'}<select className="rounded-lg border border-line px-2 py-1" value={mode === 'room' ? roomType : outdoorType} onChange={e => mode === 'room' ? setRoomType(e.target.value as SpaceType) : setOutdoorType(e.target.value as SpaceType)}>{(mode === 'room' ? roomOptions : outdoorOptions).map(item => <option key={item.type} value={item.type}>{item.name}</option>)}</select></label>}
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Geometry layers">{([['property','Property boundary'],['building','Building walls'],['spaces','Spaces'],['doors','Doors'],['windows','Windows'],['background','Floor plan']] as [LayerName,string][]).map(([key,label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={layers[key]} onChange={() => layerToggle(key)}/>{label}</label>)}<label className="flex items-center gap-1"><input type="checkbox" checked={buildingLocked} onChange={e => setBuildingLocked(e.target.checked)}/>Lock building boundary</label></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p className="rounded-lg bg-mint p-3 text-sm text-pine">{notice}</p>}
    <p className="rounded-lg bg-mint/60 px-3 py-2 text-xs text-pine" role="status">{mode === 'property' || mode === 'building' ? 'Click corners · Enter to finish · Esc to cancel · Shift reverses Ortho' : mode === 'partition' ? 'Start and finish on a wall · Enter to commit · Shift reverses Ortho' : mode === 'room' ? 'Click an unassigned enclosed area to make a room.' : isDoor(mode) ? openingDraft ? 'Click the swing side to place this door · Esc cancels this placement.' : 'Click a wall to place the preset door · repeat without reselecting.' : isWindow(mode) ? 'Hover for a preview, then click a wall · repeat without reselecting.' : mode === 'entrance' ? 'Click two points on one wall for a full-height passage · repeat without reselecting.' : mode === 'outdoor' ? 'Trace an outdoor area · Enter to finish.' : 'Select a wall, opening, outdoor edge, or corner · drag to edit · Space + drag to pan.'} · Ctrl+Z undo · F fit</p>
    <div ref={container} className="overflow-hidden rounded-xl border border-line bg-[#e7eee8]" style={{ touchAction: 'none' }}><Stage ref={stage} width={width} height={height} x={view.x} y={view.y} scaleX={view.scale} scaleY={view.scale} draggable={spaceHeld} onDragEnd={e => { if (e.target === stage.current) setView(value => ({ ...value, x: e.target.x(), y: e.target.y() })) }} onClick={onCanvasClick} onTap={onCanvasClick} onWheel={e => { e.evt.preventDefault(); const pointer = stage.current?.getPointerPosition(); if (pointer) zoomTo(view.scale * (e.evt.deltaY < 0 ? 1.12 : 1 / 1.12), pointer) }} onMouseMove={e => { const p = pointAt(e); setCursor(p); setHover(p && (mode === 'partition' || draft.length > 0) ? drawingSnap(p) : null) }} onMouseLeave={() => { setCursor(null); setHover(null) }}><Layer>
      {layers.background && image && <KonvaImage image={image} width={width} height={height} listening={false}/>}
      {Array.from({ length: 39 }, (_, i) => <Line key={`grid-${i}`} points={[(i+1)*.025*width,0,(i+1)*.025*width,height]} stroke="#205c5713" strokeWidth={1} listening={false}/>)}
      {layers.property && graph.property_boundary.length > 2 && <Line points={graph.property_boundary.flatMap(p => [sx(p),sy(p)])} closed stroke="#80619c" strokeWidth={3} strokeScaleEnabled={false} dash={[10,5]} listening={false}/>}
      {layers.spaces && regions.map(face => { const center = faceCenter(face), room = rooms.find(item => item.id === face.room_id); return <Fragment key={face.key}><Line points={face.points.flatMap(p => [sx(p),sy(p)])} closed fill={room ? '#20837433' : '#d8a34b22'} strokeEnabled={false} onClick={() => { if (mode === 'select' && room) onSelectRoom(room.id) }}/><Text x={sx(center)-55} y={sy(center)-8} width={110} align="center" text={room?.name || 'Unassigned'} fontSize={12} fill="#173939" listening={false}/></Fragment> })}
      {layers.spaces && polygons.filter(p => rooms.some(r => r.id === p.room_id && r.category === 'outdoor')).map(p => <Fragment key={p.id}><Line points={p.points.flatMap(q => [sx(q),sy(q)])} closed fill="#80b07144" strokeEnabled={false} listening={false}/>{p.points.map((a, index) => { const b = p.points[(index + 1) % p.points.length], edge = (graph.site_edges || []).find(item => item.room_id === p.room_id && item.segment_index === index), type = rooms.find(r => r.id === p.room_id)?.space_type, behavior = edge?.behavior || (type === 'balcony' || type === 'terrace' ? 'railing' : 'open'); return <Line key={`${p.id}-${index}`} points={[sx(a),sy(a),sx(b),sy(b)]} stroke={selectedEdge?.roomId === p.room_id && selectedEdge.index === index ? '#e17831' : behavior === 'railing' ? '#347c99' : behavior === 'open' ? '#4b8a66' : '#595a66'} dash={behavior === 'open' ? [5,5] : undefined} strokeWidth={3} strokeScaleEnabled={false} hitStrokeWidth={20} onClick={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedEdge({ roomId: p.room_id, index }); setSelectedWall(null); setSelectedOpening(null); setSelectedVertex(null) } }}/>} )}</Fragment>)}
      {graph.walls.filter(w => w.kind !== 'exterior' ? layers.spaces : layers.building).map(w => { const a = wallPoint(graph,w,0), b = wallPoint(graph,w,1); return <Line key={w.id} points={[sx(a),sy(a),sx(b),sy(b)]} stroke={selectedWall === w.id ? '#e17831' : w.kind === 'exterior' ? '#173939' : '#386661'} strokeWidth={w.kind === 'exterior' ? 6 : 4} strokeScaleEnabled={false} hitStrokeWidth={18} dash={w.kind === 'virtual' ? [8,5] : undefined} draggable={mode === 'select' && w.kind === 'interior' && !busy} onClick={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedWall(w.id); setSelectedOpening(null); setSelectedVertex(null); setSelectedEdge(null) } }} onTap={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedWall(w.id); setSelectedOpening(null); setSelectedVertex(null); setSelectedEdge(null) } }} onDragEnd={e => { const delta = { x: e.target.x() / width, y: e.target.y() / height }; e.target.position({ x: 0, y: 0 }); moveWall(w, delta) }}/> })}
      {graph.openings.map(o => { const wall = graph.walls.find(w => w.id === o.wall_id); if (!wall || !(o.type === 'entrance' || o.type.includes('door') ? layers.doors : layers.windows)) return null; const a = wallPoint(graph,wall,o.start), b = wallPoint(graph,wall,o.end), door = o.type.includes('door'); return <Fragment key={o.id}><Line points={[sx(a),sy(a),sx(b),sy(b)]} stroke={o.type === 'entrance' ? '#9b5c9b' : door ? '#ad552f' : '#2788ae'} dash={o.type === 'entrance' ? [8,3] : undefined} strokeWidth={7} strokeScaleEnabled={false} hitStrokeWidth={20} draggable={mode === 'select' && !busy} onClick={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedOpening(o.id); setSelectedWall(null); setSelectedVertex(null); setSelectedEdge(null) } }} onTap={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedOpening(o.id); setSelectedWall(null); setSelectedVertex(null); setSelectedEdge(null) } }} onDragEnd={e => { const middle = wallPoint(graph, wall, (o.start + o.end) / 2); const moved = { x: middle.x + e.target.x() / width, y: middle.y + e.target.y() / height }; e.target.position({ x: 0, y: 0 }); moveOpening(o, moved) }}/>{o.type === 'entrance' && selectedOpening === o.id && (['start','end'] as const).map(side => { const p = wallPoint(graph,wall,o[side]); return <Circle key={side} x={sx(p)} y={sy(p)} radius={6 / view.scale} fill="white" stroke="#9b5c9b" strokeWidth={2} strokeScaleEnabled={false} draggable onDragEnd={e => { const moved = { x: e.target.x()/width, y: e.target.y()/height }; e.target.position({x:sx(p),y:sy(p)}); resizeEntrance(o,side,moved) }}/>} )}</Fragment> })}
      {graph.openings.filter(o => o.type.includes('door') && layers.doors).map(o => { const w = graph.walls.find(item => item.id === o.wall_id); return w && <Line key={`arc-${o.id}`} points={swingArc(o,w)} stroke="#ad552f" strokeWidth={2} strokeScaleEnabled={false} dash={[5,4]} listening={false}/> })}
      {mode === 'select' && graph.vertices.map(v => <Circle key={v.id} x={sx(v)} y={sy(v)} radius={(graph.building_boundary.includes(v.id) ? 6 : 5) / view.scale} fill={selectedVertex === v.id ? '#e17831' : 'white'} stroke="#174e4b" strokeWidth={2} strokeScaleEnabled={false} hitStrokeWidth={16} draggable={!busy && (!buildingLocked || !graph.building_boundary.includes(v.id))} onDragEnd={e => { const p = { x: Math.max(0,Math.min(1,e.target.x()/width)), y: Math.max(0,Math.min(1,e.target.y()/height)) }; e.target.position({ x:sx(v),y:sy(v) }); moveVertex(v.id,p) }} onClick={e => { e.cancelBubble = true; setSelectedVertex(v.id); setSelectedWall(null); setSelectedOpening(null); setSelectedEdge(null) }}/>) }
      {draft.length > 0 && <Line points={draft.flatMap(item => [sx(item.point),sy(item.point)])} stroke="#e17b3e" strokeWidth={3} strokeScaleEnabled={false} dash={[7,5]} listening={false}/>}
      {draft.length > 0 && hover && <Line points={[sx(draft[draft.length-1].point),sy(draft[draft.length-1].point),sx(hover.point),sy(hover.point)]} stroke="#e17b3e" strokeWidth={2} strokeScaleEnabled={false} dash={[4,4]} listening={false}/>}
      {draft.length > 0 && hover && <Text x={sx(hover.point) + 10 / view.scale} y={sy(hover.point) - 18 / view.scale} text={`${Math.round(Math.atan2((hover.point.y-draft[draft.length-1].point.y)*height,(hover.point.x-draft[draft.length-1].point.x)*width)*180/Math.PI)}°`} fontSize={11 / view.scale} fill="#ad552f" listening={false}/>}
      {draft.map((item,i) => <Circle key={`draft-${i}`} x={sx(item.point)} y={sy(item.point)} radius={5 / view.scale} fill="#e17b3e" stroke="white" strokeWidth={2} strokeScaleEnabled={false} listening={false}/>)}
      {hover && <Circle x={sx(hover.point)} y={sy(hover.point)} radius={(hover.kind === 'free' ? 4 : 8) / view.scale} fill={hover.kind === 'free' ? '#aaa' : '#e17b3e'} stroke="white" strokeWidth={2} strokeScaleEnabled={false} listening={false}/>}
      {ghost?.placement && <Line points={[sx(wallPoint(graph,ghost.wall,ghost.placement.start)),sy(wallPoint(graph,ghost.wall,ghost.placement.start)),sx(wallPoint(graph,ghost.wall,ghost.placement.end)),sy(wallPoint(graph,ghost.wall,ghost.placement.end))]} stroke={ghost.valid ? '#2788ae' : '#c23a3a'} strokeWidth={8} strokeScaleEnabled={false} dash={[5,4]} listening={false}/>}
      {openingDraft && <Circle x={sx(wallPoint(graph,openingDraft.wall,openingDraft.start))} y={sy(wallPoint(graph,openingDraft.wall,openingDraft.start))} radius={7 / view.scale} fill="#e17b3e" listening={false}/>}
      {openingDraft?.end !== undefined && <Circle x={sx(wallPoint(graph,openingDraft.wall,openingDraft.end))} y={sy(wallPoint(graph,openingDraft.wall,openingDraft.end))} radius={7 / view.scale} fill="#e17b3e" listening={false}/>}
    </Layer></Stage></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" title="Enter" disabled={busy || !draft.length || (mode === 'partition' ? draft.length < 2 || !['wall','vertex'].includes(draft[draft.length-1].kind) : draft.length < 3)} onClick={finishDraft}>Finish {mode === 'partition' ? 'partition' : 'boundary / area'} · Enter</Button><Button size="sm" variant="outline" disabled={!draft.length} onClick={() => setDraft(value => value.slice(0,-1))}>Undo point</Button><Button size="sm" variant="outline" title="Esc" onClick={() => changeMode('select')}>Cancel mode · Esc</Button><Button size="sm" variant="outline" disabled={busy || !past.length} onClick={() => void history('undo')}>Undo</Button><Button size="sm" variant="outline" disabled={busy || !future.length} onClick={() => void history('redo')}>Redo</Button><Button size="sm" variant="danger" disabled={busy || (!selectedOpening && !selectedWall)} onClick={deleteSelected}>Delete selected wall / opening</Button></div>
    {selectedOpeningData && <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 text-sm"><strong className="w-full">Selected {selectedOpeningData.type.replaceAll('_',' ')}</strong><label className="space-y-1">Width preset<select aria-label="Selected opening preset" className="block rounded-lg border border-line p-2" value={selectedOpeningData.preset || 'custom'} onChange={e => { const preset = e.target.value as OpeningPreset; const kind = selectedOpeningData.type.includes('door') ? 'door' : 'window'; if (preset !== 'custom' && selectedOpeningData.type !== 'entrance') editOpening({ preset, width_m: OPENING_WIDTHS_M[kind][preset] }) }}><option value="custom">Custom</option>{selectedOpeningData.type !== 'entrance' && (['narrow','standard','wide'] as const).map(preset => <option key={preset} value={preset}>{preset}</option>)}</select></label><label className="space-y-1">Width (m)<input aria-label="Selected opening width metres" type="number" min="0.1" step="0.05" defaultValue={selectedOpeningData.width_m?.toFixed(2) || ''} key={`${selectedOpeningData.id}-${selectedOpeningData.width_m}`} onBlur={e => { const value = Number(e.target.value); if (value > 0 && Math.abs(value - (selectedOpeningData.width_m || 0)) > .001) editOpening({ preset: 'custom', width_m: value }) }} className="block w-24 rounded-lg border border-line p-2"/></label><label className="space-y-1">Height (m)<input aria-label="Selected opening height metres" type="number" min="0.1" step="0.1" defaultValue={selectedOpeningData.height} key={`${selectedOpeningData.id}-height-${selectedOpeningData.height}`} onBlur={e => { const value = Number(e.target.value); if (value > 0 && value !== selectedOpeningData.height) editOpening({ height: value }) }} className="block w-24 rounded-lg border border-line p-2"/></label>{!selectedOpeningData.type.includes('door') && selectedOpeningData.type !== 'entrance' && <label className="space-y-1">Sill (m)<input aria-label="Selected window sill metres" type="number" min="0" step="0.1" defaultValue={selectedOpeningData.sill} key={`${selectedOpeningData.id}-sill-${selectedOpeningData.sill}`} onBlur={e => { const value = Number(e.target.value); if (value >= 0 && value !== selectedOpeningData.sill) editOpening({ sill: value }) }} className="block w-24 rounded-lg border border-line p-2"/></label>}{selectedOpeningData.type.includes('door') && <button type="button" onClick={() => editOpening({ swing: selectedOpeningData.swing === 1 ? -1 : 1 })} className="rounded-lg border border-line px-3 py-2">Flip swing</button>}<span className="text-xs text-slate-500">Drag to move along wall{selectedOpeningData.type === 'entrance' ? ' · drag handles to resize' : ''}.</span></div>}
    {selectedEdge && <div className="flex flex-wrap items-end gap-3 rounded-xl border border-line bg-white p-3 text-sm"><strong className="w-full">Selected outdoor edge</strong><label className="space-y-1">Boundary<select aria-label="Outdoor edge behavior" className="block rounded-lg border border-line p-2" value={selectedEdgeBehavior} onChange={e => setEdgeBehavior(e.target.value as EdgeBehavior)}>{(['open','railing','parapet','wall'] as const).map(option => <option key={option} value={option}>{option[0].toUpperCase() + option.slice(1)}</option>)}</select></label><label className="space-y-1">Height (m)<input aria-label="Outdoor edge height metres" type="number" min="0" step="0.05" defaultValue={selectedEdgeHeight} key={`${selectedEdge.roomId}-${selectedEdge.index}-${selectedEdgeHeight}`} onBlur={e => { const value = Number(e.target.value); if (value >= 0 && value !== selectedEdgeHeight) setEdgeBehavior(selectedEdgeBehavior, value) }} className="block w-24 rounded-lg border border-line p-2"/></label></div>}
  </div>
}
