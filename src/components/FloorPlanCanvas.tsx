import { useEffect, useRef, useState } from 'react'
import { Circle, Group, Image as KonvaImage, Layer, Line, Stage, Text } from 'react-konva'
import type Konva from 'konva'
import { clamp, nearestSegment, pointOnSegment } from '../lib/geometry'
import type { Opening, Point, Room, RoomPolygon } from '../lib/types'

function useImage(url: string | null) {
  const [image, setImage] = useState<HTMLImageElement | null>(null)
  useEffect(() => {
    if (!url) { setImage(null); return }
    const next = new window.Image()
    next.onload = () => setImage(next)
    next.src = url
    return () => { next.onload = null }
  }, [url])
  return image
}

function wallPosition(points: Point[], segmentIndex: number, point: Point): number {
  const a = points[segmentIndex], b = points[(segmentIndex + 1) % points.length]
  const dx = b.x - a.x, dy = b.y - a.y
  return clamp(((point.x - a.x) * dx + (point.y - a.y) * dy) / (dx * dx + dy * dy || 1))
}

type CanvasProps = {
  url: string | null
  imageWidth: number
  imageHeight: number
  rooms: Room[]
  polygons: RoomPolygon[]
  openings?: Opening[]
  selectedRoomId: string | null
  selectedPolygonId: string | null
  selectedOpeningId?: string | null
  draft: Point[]
  drawing: boolean
  placingOpening?: boolean
  editable: boolean
  showGrid?: boolean
  onBackgroundClick?: (point: Point) => void
  onSelectPolygon: (polygon: RoomPolygon) => void
  onSelectOpening?: (opening: Opening) => void
  onWallClick?: (polygon: RoomPolygon, segmentIndex: number, position: number) => void
  onMovePoint?: (polygon: RoomPolygon, index: number, point: Point) => void
  onMovePolygon?: (polygon: RoomPolygon, delta: Point) => void
  onMoveOpening?: (opening: Opening, position: number) => void
}

export function FloorPlanCanvas({ url, imageWidth, imageHeight, rooms, polygons, openings = [], selectedRoomId, selectedPolygonId, selectedOpeningId, draft, drawing, placingOpening = false, editable, showGrid = false, onBackgroundClick, onSelectPolygon, onSelectOpening, onWallClick, onMovePoint, onMovePolygon, onMoveOpening }: CanvasProps) {
  const parent = useRef<HTMLDivElement>(null)
  const stage = useRef<Konva.Stage>(null)
  const [width, setWidth] = useState(500)
  const image = useImage(url)
  useEffect(() => { if (!parent.current) return; const observer = new ResizeObserver(entries => setWidth(Math.max(1, entries[0].contentRect.width))); observer.observe(parent.current); return () => observer.disconnect() }, [])
  const height = Math.max(180, width * (imageHeight / imageWidth || .75))
  const normalizedPointer = (): Point | null => { const point = stage.current?.getPointerPosition(); return point ? { x: clamp(point.x / width), y: clamp(point.y / height) } : null }
  const backgroundClick = () => { if (!drawing || !onBackgroundClick) return; const point = normalizedPointer(); if (point) onBackgroundClick(point) }
  const wallClick = (poly: RoomPolygon) => { const point = normalizedPointer(); const segment = point && nearestSegment(poly.points, point); if (segment) onWallClick?.(poly, segment.segmentIndex, segment.position) }

  return <div ref={parent} className="w-full overflow-hidden rounded-xl border border-line bg-[#e7eee8]">
    <Stage ref={stage} width={width} height={height} onClick={backgroundClick} onTap={backgroundClick}>
      <Layer>
        {image && <KonvaImage image={image} width={width} height={height} listening={false} />}
        {showGrid && Array.from({ length: 39 }, (_, i) => <Line key={`v-${i}`} points={[(i + 1) * .025 * width, 0, (i + 1) * .025 * width, height]} stroke="#205c5720" strokeWidth={1} listening={false} />)}
        {showGrid && Array.from({ length: 39 }, (_, i) => <Line key={`h-${i}`} points={[0, (i + 1) * .025 * height, width, (i + 1) * .025 * height]} stroke="#205c5720" strokeWidth={1} listening={false} />)}
        {polygons.map(poly => {
          const room = rooms.find(item => item.id === poly.room_id)
          const selected = selectedPolygonId === poly.id
          const active = selectedRoomId === poly.room_id
          const center = poly.points.reduce((acc, p) => ({ x: acc.x + p.x / poly.points.length, y: acc.y + p.y / poly.points.length }), { x: 0, y: 0 })
          const color = room?.space_type === 'stairs' ? '#7755a1' : room?.category === 'outdoor' ? '#4b8a66' : '#205c57'
          return <Group key={poly.id}>
            <Line points={poly.points.flatMap(p => [p.x * width, p.y * height])} closed fill={`${color}${active || selected ? '55' : '30'}`} stroke={color} strokeWidth={selected ? 4 : 2} draggable={editable && selected && !drawing && !placingOpening} onClick={e => { e.cancelBubble = true; if (placingOpening) wallClick(poly); else if (!drawing) onSelectPolygon(poly) }} onTap={e => { e.cancelBubble = true; if (placingOpening) wallClick(poly); else if (!drawing) onSelectPolygon(poly) }} onDragEnd={e => { const delta = { x: e.target.x() / width, y: e.target.y() / height }; e.target.position({ x: 0, y: 0 }); onMovePolygon?.(poly, delta) }} />
            <Text x={center.x * width - 52} y={center.y * height - 9} width={104} align="center" text={room?.name || 'Space'} fontSize={Math.max(11, Math.min(16, width / 36))} fontStyle="bold" fill="#13292a" shadowColor="white" shadowBlur={5} listening={false} />
            {selected && editable && !drawing && !placingOpening && poly.points.map((p, i) => <Circle key={i} x={p.x * width} y={p.y * height} radius={8} hitStrokeWidth={18} fill="white" stroke={color} strokeWidth={2} draggable dragBoundFunc={position => ({ x: clamp(position.x, 0, width), y: clamp(position.y, 0, height) })} onDragEnd={e => onMovePoint?.(poly, i, { x: e.target.x() / width, y: e.target.y() / height })} />)}
          </Group>
        })}
        {openings.map(opening => {
          const polygon = polygons.find(item => item.id === opening.polygon_id)
          if (!polygon || opening.segment_index >= polygon.points.length) return null
          const point = pointOnSegment(polygon.points, opening.segment_index, opening.position)
          const color = opening.opening_type.includes('door') ? '#b45e37' : '#3275af'
          return <Circle key={opening.id} x={point.x * width} y={point.y * height} radius={opening.id === selectedOpeningId ? 11 : 9} hitStrokeWidth={16} fill={color} stroke="white" strokeWidth={2} draggable={editable && !drawing && !placingOpening} dragBoundFunc={position => { const projected = pointOnSegment(polygon.points, opening.segment_index, wallPosition(polygon.points, opening.segment_index, { x: position.x / width, y: position.y / height })); return { x: projected.x * width, y: projected.y * height } }} onClick={e => { e.cancelBubble = true; onSelectOpening?.(opening) }} onTap={e => { e.cancelBubble = true; onSelectOpening?.(opening) }} onDragEnd={e => onMoveOpening?.(opening, wallPosition(polygon.points, opening.segment_index, { x: e.target.x() / width, y: e.target.y() / height }))} />
        })}
        {draft.length > 0 && <><Line points={draft.flatMap(p => [p.x * width, p.y * height])} stroke="#ef9c68" strokeWidth={3} dash={[7, 5]} listening={false} />{draft.map((p, i) => <Circle key={i} x={p.x * width} y={p.y * height} radius={5} fill="#ef9c68" stroke="white" strokeWidth={2} listening={false} />)}</>}
      </Layer>
    </Stage>
  </div>
}
