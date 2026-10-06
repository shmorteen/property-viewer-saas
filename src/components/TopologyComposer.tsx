import { Fragment, useEffect, useMemo, useRef, useState } from 'react'
import { Circle, Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { addRoom, deleteRoom, getLayoutGraph, listMedia, restoreRoom, saveLayoutGraph, savePolygon } from '../lib/data'
import { overlapsAnother, validLayoutPolygon } from '../lib/geometry'
import { addPartition, contains, createBuilding, emptyGraph, faceCenter, faces, footprint, snapToGraph, validateBoundary, validateGraph, wallParameter, wallPoint, type LayoutGraph, type Snap, type TopologyOpening, type Wall } from '../lib/topology'
import type { FloorPlan, Level, Point, Room, RoomPolygon, SpaceType } from '../lib/types'
import { Button } from './ui'

type Mode = 'select' | 'property' | 'building' | 'partition' | 'room' | 'door' | 'double_door' | 'window' | 'wide_window' | 'outdoor'
type LayerName = 'property' | 'building' | 'spaces' | 'doors' | 'windows' | 'background'
type Props = { propertyId: string; level: Level; floor: FloorPlan | undefined; floorUrl: string | null; rooms: Room[]; polygons: RoomPolygon[]; revision: number; onChanged: () => Promise<void>; onSelectRoom: (id: string) => void }
type HistoryEntry = { graph: LayoutGraph; createdRoom?: Room; outdoorPoints?: Point[] }
const roomOptions: { type: SpaceType; name: string }[] = [
  { type: 'living_room', name: 'Living room' }, { type: 'bedroom', name: 'Bedroom' }, { type: 'bathroom', name: 'Bathroom' },
  { type: 'kitchen', name: 'Kitchen' }, { type: 'dining_room', name: 'Dining room' }, { type: 'corridor', name: 'Corridor' },
  { type: 'office', name: 'Office' }, { type: 'store', name: 'Closet / store' }, { type: 'utility', name: 'Washroom / utility' }, { type: 'stairs', name: 'Stairs' },
]
const outdoorOptions: { type: SpaceType; name: string }[] = [
  { type: 'garden', name: 'Garden' }, { type: 'pool', name: 'Pool' }, { type: 'parking', name: 'Parking' },
  { type: 'driveway', name: 'Driveway' }, { type: 'patio', name: 'Patio' }, { type: 'yard', name: 'Yard' },
]
const openingType = (mode: Mode): TopologyOpening['type'] => ({ door: 'standard_door', double_door: 'double_door', window: 'standard_window', wide_window: 'wide_window' } as const)[mode as 'door' | 'double_door' | 'window' | 'wide_window']

export function TopologyComposer({ propertyId, level, floor, floorUrl, rooms, polygons, revision, onChanged, onSelectRoom }: Props) {
  const [graph, setGraph] = useState<LayoutGraph>(emptyGraph)
  const [mode, setMode] = useState<Mode>('select')
  const [roomType, setRoomType] = useState<SpaceType>('bedroom')
  const [outdoorType, setOutdoorType] = useState<SpaceType>('garden')
  const [draft, setDraft] = useState<Snap[]>([])
  const [openingDraft, setOpeningDraft] = useState<{ wall: Wall; start: number; end?: number } | null>(null)
  const [hover, setHover] = useState<Snap | null>(null)
  const [selectedWall, setSelectedWall] = useState<string | null>(null)
  const [selectedOpening, setSelectedOpening] = useState<string | null>(null)
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
  const sx = (p: Point) => p.x * width, sy = (p: Point) => p.y * height
  const pointAt = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => { const p = event.target.getStage()?.getPointerPosition(); return p ? { x: Math.max(0, Math.min(1, p.x / width)), y: Math.max(0, Math.min(1, p.y / height)) } : null }

  useEffect(() => { let active = true; getLayoutGraph(level.id, propertyId).then(value => { if (active) { setGraph(value); setPast([]); setFuture([]); setDraft([]) } }).catch(e => { if (active) setError(e.message) }); return () => { active = false } }, [level.id, propertyId, revision])
  useEffect(() => { if (!container.current) return; const observer = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width))); observer.observe(container.current); return () => observer.disconnect() }, [])
  useEffect(() => { if (!floorUrl) { setImage(null); return }; const next = new Image(); next.onload = () => setImage(next); next.src = floorUrl; return () => { next.onload = null } }, [floorUrl])
  const regions = useMemo(() => faces(graph), [graph])
  const building = useMemo(() => footprint(graph), [graph])
  const commit = async (next: LayoutGraph, message: string) => {
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
  const changeMode = (next: Mode) => { setMode(next); setDraft([]); setOpeningDraft(null); setHover(null); setError('') }
  const nearestWall = (p: Point, only?: Wall) => {
    const candidates = only ? [only] : graph.walls
    const ranked = candidates.map(w => { const t = wallParameter(graph, w, p), q = wallPoint(graph, w, t); return { wall: w, t, distance: Math.hypot((p.x - q.x) * width, (p.y - q.y) * height) } }).sort((a, b) => a.distance - b.distance)
    return ranked[0]?.distance <= 14 ? ranked[0] : null
  }
  const placeOpening = (p: Point) => {
    if (!openingDraft) {
      const candidate = nearestWall(p)
      if (!candidate) { setError('Point 1 must be on a highlighted wall.'); return }
      setOpeningDraft({ wall: candidate.wall, start: candidate.t }); setError(''); return
    }
    if (openingDraft.end === undefined) {
      const candidate = nearestWall(p, openingDraft.wall)
      if (!candidate) { setError('Point 2 must be on the same wall as Point 1.'); return }
      if (Math.abs(candidate.t - openingDraft.start) < .03) { setError('Opening width is too small.'); return }
      const [start, end] = [candidate.t, openingDraft.start].sort((a, b) => a - b)
      if (mode.includes('window')) void finishOpening(openingDraft.wall, start, end, 1)
      else setOpeningDraft({ wall: openingDraft.wall, start, end })
      return
    }
    const a = graph.vertices.find(v => v.id === openingDraft.wall.a)!, b = graph.vertices.find(v => v.id === openingDraft.wall.b)!
    const cross = (b.x - a.x) * (p.y - a.y) - (b.y - a.y) * (p.x - a.x)
    if (Math.abs(cross) < .003) { setError('Point 3 should be away from the wall to indicate swing side.'); return }
    void finishOpening(openingDraft.wall, openingDraft.start, openingDraft.end, cross > 0 ? 1 : -1)
  }
  const finishOpening = async (wall: Wall, start: number, end: number, swing: -1 | 1) => {
    const type = openingType(mode)
    const next: LayoutGraph = { ...graph, openings: [...graph.openings, { id: crypto.randomUUID(), wall_id: wall.id, type, start, end, height: type.includes('door') ? 2.1 : 1.2, sill: type.includes('door') ? 0 : .9, swing }] }
    const problem = validateGraph(next)
    if (problem) { setError(problem); return }
    if (await commit(next, 'Opening attached to the wall.')) changeMode('select')
  }
  const onCanvasClick = (event: Konva.KonvaEventObject<MouseEvent | TouchEvent>) => {
    if (busy) return
    const p = pointAt(event); if (!p) return
    if (['door', 'double_door', 'window', 'wide_window'].includes(mode)) { placeOpening(p); return }
    if (mode === 'room') {
      const face = regions.find(f => contains(p, f.points, false))
      if (!face || face.room_id) { setError('Select an unassigned enclosed space. Draw a partition first if needed.'); return }
      void assignRoom(faceCenter(face)); return
    }
    if (mode === 'select') return
    const snap = mode === 'partition' ? snapToGraph(graph, p, width, height) : { point: p, kind: 'free' as const }
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
    const snapped = snapToGraph({ ...graph, vertices: graph.vertices.filter(v => v.id !== id) }, p, width, height)
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
  const swingArc = (opening: TopologyOpening, wall: Wall) => {
    const hinge = wallPoint(graph, wall, opening.start), tip = wallPoint(graph, wall, opening.end)
    const radius = Math.hypot((tip.x - hinge.x) * width, (tip.y - hinge.y) * height)
    const base = Math.atan2((tip.y - hinge.y) * height, (tip.x - hinge.x) * width)
    const values: number[] = []
    for (let i = 0; i <= 12; i++) { const a = base + opening.swing * i / 12 * Math.PI / 2; values.push(sx(hinge) + Math.cos(a) * radius, sy(hinge) + Math.sin(a) * radius) }
    return values
  }
  const layerToggle = (name: LayerName) => setLayers(value => ({ ...value, [name]: !value[name] }))

  return <div className="space-y-4">
    <div className="flex flex-wrap gap-2" role="toolbar" aria-label="Layout drawing modes">
      {([['select','Select'],['property','Property boundary'],['building','Building boundary'],['partition','Partition'],['room','Add room'],['door','Door: 3 points'],['double_door','Double door'],['window','Window: 2 points'],['wide_window','Wide window'],['outdoor','Outdoor space']] as [Mode,string][]).map(([value,label]) => <button key={value} type="button" aria-pressed={mode === value} disabled={busy || (value === 'building' && graph.walls.length > 0)} onClick={() => changeMode(value)} className={`rounded-lg border px-3 py-2 text-xs font-semibold ${mode === value ? 'border-pine bg-pine text-white' : 'border-line bg-white hover:bg-mint'}`}>{label}</button>)}
    </div>
    {(mode === 'room' || mode === 'outdoor') && <label className="flex items-center gap-2 text-sm">{mode === 'room' ? 'Room type' : 'Outdoor type'}<select className="rounded-lg border border-line px-2 py-1" value={mode === 'room' ? roomType : outdoorType} onChange={e => mode === 'room' ? setRoomType(e.target.value as SpaceType) : setOutdoorType(e.target.value as SpaceType)}>{(mode === 'room' ? roomOptions : outdoorOptions).map(item => <option key={item.type} value={item.type}>{item.name}</option>)}</select></label>}
    <div className="flex flex-wrap gap-x-4 gap-y-2 text-xs" aria-label="Geometry layers">{([['property','Property boundary'],['building','Building walls'],['spaces','Spaces'],['doors','Doors'],['windows','Windows'],['background','Floor plan']] as [LayerName,string][]).map(([key,label]) => <label key={key} className="flex items-center gap-1"><input type="checkbox" checked={layers[key]} onChange={() => layerToggle(key)}/>{label}</label>)}<label className="flex items-center gap-1"><input type="checkbox" checked={buildingLocked} onChange={e => setBuildingLocked(e.target.checked)}/>Lock building boundary</label></div>
    {error && <p role="alert" className="rounded-lg bg-red-50 p-3 text-sm text-red-700">{error}</p>}{notice && <p className="rounded-lg bg-mint p-3 text-sm text-pine">{notice}</p>}
    <p className="text-xs text-slate-600">{mode === 'property' ? 'Click land corners, then Finish boundary.' : mode === 'building' ? 'Trace the exterior building footprint; existing floor plan stays behind it.' : mode === 'partition' ? 'Start on a highlighted wall or vertex, add bends, and finish on another wall or vertex.' : mode === 'room' ? 'Click an unassigned enclosed area. Its existing walls become the room boundary.' : mode.includes('door') ? 'Click two points on one wall for the door width, then a third point off the wall for the swing side.' : mode.includes('window') ? 'Click two points on one wall to set the window width.' : mode === 'outdoor' ? 'Trace an outdoor area inside the property and outside the building.' : 'Select a wall or opening, or drag a shared vertex to adjust adjacent rooms.'}</p>
    <div ref={container} className="overflow-hidden rounded-xl border border-line bg-[#e7eee8]"><Stage ref={stage} width={width} height={height} onClick={onCanvasClick} onTap={onCanvasClick} onMouseMove={e => { const p = pointAt(e); setHover(p && mode === 'partition' ? snapToGraph(graph, p, width, height) : null) }}><Layer>
      {layers.background && image && <KonvaImage image={image} width={width} height={height} listening={false}/>}
      {Array.from({ length: 39 }, (_, i) => <Line key={`grid-${i}`} points={[(i+1)*.025*width,0,(i+1)*.025*width,height]} stroke="#205c5713" strokeWidth={1} listening={false}/>)}
      {layers.property && graph.property_boundary.length > 2 && <Line points={graph.property_boundary.flatMap(p => [sx(p),sy(p)])} closed stroke="#80619c" strokeWidth={3} dash={[10,5]} listening={false}/>}
      {layers.spaces && regions.map(face => { const center = faceCenter(face), room = rooms.find(item => item.id === face.room_id); return <Fragment key={face.key}><Line points={face.points.flatMap(p => [sx(p),sy(p)])} closed fill={room ? '#20837433' : '#d8a34b22'} strokeEnabled={false} onClick={() => { if (mode === 'select' && room) onSelectRoom(room.id) }}/><Text x={sx(center)-55} y={sy(center)-8} width={110} align="center" text={room?.name || 'Unassigned'} fontSize={12} fill="#173939" listening={false}/></Fragment> })}
      {layers.spaces && polygons.filter(p => rooms.some(r => r.id === p.room_id && r.category === 'outdoor')).map(p => <Line key={p.id} points={p.points.flatMap(q => [sx(q),sy(q)])} closed fill="#80b07144" stroke="#4b8a66" strokeWidth={2} listening={false}/>)}
      {graph.walls.filter(w => w.kind !== 'exterior' ? layers.spaces : layers.building).map(w => { const a = wallPoint(graph,w,0), b = wallPoint(graph,w,1); return <Line key={w.id} points={[sx(a),sy(a),sx(b),sy(b)]} stroke={selectedWall === w.id ? '#e17831' : w.kind === 'exterior' ? '#173939' : '#386661'} strokeWidth={w.kind === 'exterior' ? 7 : 4} hitStrokeWidth={18} dash={w.kind === 'virtual' ? [8,5] : undefined} draggable={mode === 'select' && w.kind === 'interior' && !busy} onClick={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedWall(w.id); setSelectedOpening(null) } }} onTap={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedWall(w.id); setSelectedOpening(null) } }} onDragEnd={e => { const delta = { x: e.target.x() / width, y: e.target.y() / height }; e.target.position({ x: 0, y: 0 }); moveWall(w, delta) }}/> })}
      {graph.openings.map(o => { const wall = graph.walls.find(w => w.id === o.wall_id); if (!wall || !(o.type.includes('door') ? layers.doors : layers.windows)) return null; const a = wallPoint(graph,wall,o.start), b = wallPoint(graph,wall,o.end), door = o.type.includes('door'); return <Line key={o.id} points={[sx(a),sy(a),sx(b),sy(b)]} stroke={door ? '#ad552f' : '#2788ae'} strokeWidth={7} hitStrokeWidth={20} onClick={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedOpening(o.id); setSelectedWall(null) } }} onTap={e => { if (mode === 'select') { e.cancelBubble = true; setSelectedOpening(o.id); setSelectedWall(null) } }}/> })}
      {graph.openings.filter(o => o.type.includes('door') && layers.doors).map(o => { const w = graph.walls.find(item => item.id === o.wall_id); return w && <Line key={`arc-${o.id}`} points={swingArc(o,w)} stroke="#ad552f" strokeWidth={2} dash={[5,4]} listening={false}/> })}
      {mode === 'select' && graph.vertices.map(v => <Circle key={v.id} x={sx(v)} y={sy(v)} radius={graph.building_boundary.includes(v.id) ? 6 : 5} fill="white" stroke="#174e4b" strokeWidth={2} hitStrokeWidth={16} draggable={!busy && (!buildingLocked || !graph.building_boundary.includes(v.id))} onDragEnd={e => { const p = { x: Math.max(0,Math.min(1,e.target.x()/width)), y: Math.max(0,Math.min(1,e.target.y()/height)) }; e.target.position({ x:sx(v),y:sy(v) }); moveVertex(v.id,p) }} onClick={e => { e.cancelBubble = true }}/>) }
      {draft.length > 0 && <Line points={draft.flatMap(item => [sx(item.point),sy(item.point)])} stroke="#e17b3e" strokeWidth={3} dash={[7,5]} listening={false}/>}
      {draft.map((item,i) => <Circle key={`draft-${i}`} x={sx(item.point)} y={sy(item.point)} radius={5} fill="#e17b3e" stroke="white" strokeWidth={2} listening={false}/>)}
      {hover && <Circle x={sx(hover.point)} y={sy(hover.point)} radius={hover.kind === 'free' ? 4 : 8} fill={hover.kind === 'free' ? '#aaa' : '#e17b3e'} stroke="white" strokeWidth={2} listening={false}/>}
      {openingDraft && <Circle x={sx(wallPoint(graph,openingDraft.wall,openingDraft.start))} y={sy(wallPoint(graph,openingDraft.wall,openingDraft.start))} radius={7} fill="#e17b3e" listening={false}/>}
      {openingDraft?.end !== undefined && <Circle x={sx(wallPoint(graph,openingDraft.wall,openingDraft.end))} y={sy(wallPoint(graph,openingDraft.wall,openingDraft.end))} radius={7} fill="#e17b3e" listening={false}/>}
    </Layer></Stage></div>
    <div className="flex flex-wrap gap-2"><Button size="sm" disabled={busy || !draft.length || (mode === 'partition' ? draft.length < 2 || !['wall','vertex'].includes(draft[draft.length-1].kind) : draft.length < 3)} onClick={finishDraft}>Finish {mode === 'partition' ? 'partition' : 'boundary / area'}</Button><Button size="sm" variant="outline" disabled={!draft.length} onClick={() => setDraft(value => value.slice(0,-1))}>Undo point</Button><Button size="sm" variant="outline" onClick={() => changeMode('select')}>Cancel mode</Button><Button size="sm" variant="outline" disabled={busy || !past.length} onClick={() => void history('undo')}>Undo</Button><Button size="sm" variant="outline" disabled={busy || !future.length} onClick={() => void history('redo')}>Redo</Button><Button size="sm" variant="danger" disabled={busy || (!selectedOpening && !selectedWall)} onClick={deleteSelected}>Delete selected wall / opening</Button></div>
  </div>
}
