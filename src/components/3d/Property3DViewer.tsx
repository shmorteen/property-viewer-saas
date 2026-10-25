import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Canvas, useFrame, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Color, Group, Mesh, MeshStandardMaterial, PMREMGenerator, RepeatWrapping, SRGBColorSpace, Texture, TextureLoader, Vector3 } from 'three'
import { RoomEnvironment } from 'three/examples/jsm/environments/RoomEnvironment.js'
import type { FurnitureAsset, FurnitureInstance, InteriorMaterial, ModelScene, RoomInteriorSetting } from '../../lib/types'

class ModelErrorBoundary extends Component<{ children: ReactNode; onFallback: () => void }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="grid h-full place-items-center p-5 text-center text-sm text-red-700"><div><p>3D is unavailable in this browser: {this.state.error}</p><button type="button" onClick={this.props.onFallback} className="mt-4 rounded-lg bg-white px-4 py-2 font-semibold text-pine">Open floor plan</button></div></div> : this.props.children }
}

class AssetErrorBoundary extends Component<{ children: ReactNode }, { failed: boolean }> {
  state = { failed: false }
  static getDerivedStateFromError() { return { failed: true } }
  render() { return this.state.failed ? null : this.props.children }
}

function FurnitureItem({ item, asset, roomName, onSelect }: {
  item: FurnitureInstance; asset: FurnitureAsset; roomName: string; onSelect: (label: string, roomId: string) => void
}) {
  const gltf = useGLTF(asset.glb_path)
  const object = useMemo(() => gltf.scene.clone(true), [gltf.scene])
  return <group position={item.position} rotation={[0, item.rotation_y, 0]} scale={item.scale}
    onPointerOver={event => { event.stopPropagation(); document.body.style.cursor = 'pointer' }}
    onPointerOut={() => { document.body.style.cursor = '' }}
    onClick={event => { event.stopPropagation(); onSelect(`${asset.name} · ${roomName}`, item.room_id) }}>
    <primitive object={object}/>
  </group>
}

export type SceneMetrics = { fps: number; drawCalls: number; triangles: number }
function MetricsSampler({ onMetrics }: { onMetrics: (value: SceneMetrics) => void }) {
  const sample = useRef({ elapsed: 0, frames: 0 })
  useFrame(({ gl }, delta) => {
    sample.current.elapsed += delta
    sample.current.frames += 1
    if (sample.current.elapsed >= 2) {
      onMetrics({ fps: Math.round(sample.current.frames / sample.current.elapsed),
        drawCalls: gl.info.render.calls, triangles: gl.info.render.triangles })
      sample.current = { elapsed: 0, frames: 0 }
    }
  })
  return null
}

const textureCache = new Map<string, { texture: Texture; users: Set<MeshStandardMaterial>; failed: boolean }>()

function releaseSurfaceMaterial(material: MeshStandardMaterial) {
  const key = material.userData.interiorTextureKey as string | undefined
  if (key) textureCache.get(key)?.users.delete(material)
}

function makeSurfaceMaterial(definition: InteriorMaterial | undefined, fallback: string): MeshStandardMaterial {
  const material = new MeshStandardMaterial({ color: fallback, roughness: definition?.roughness ?? .85,
    metalness: definition?.metalness ?? 0 })
  if (!definition?.texture) return material
  const key = `${definition.texture}:${definition.repeat.join(',')}`
  let entry = textureCache.get(key)
  if (!entry) {
    const users = new Set<MeshStandardMaterial>()
    entry = { texture: new Texture(), users, failed: false }
    textureCache.set(key, entry)
    const cached = entry
    cached.texture = new TextureLoader().load(definition.texture, loaded => { loaded.needsUpdate = true }, undefined,
      () => { cached.failed = true; for (const user of cached.users) {
        user.map = null; user.color.set(user.userData.interiorFallback as string); user.needsUpdate = true
      } })
    cached.texture.wrapS = RepeatWrapping
    cached.texture.wrapT = RepeatWrapping
    cached.texture.colorSpace = SRGBColorSpace
    cached.texture.repeat.set(1 / definition.repeat[0], 1 / definition.repeat[1])
  }
  if (!entry.failed) {
    material.map = entry.texture
    material.color.set('#ffffff')
    material.userData.interiorTextureKey = key
    material.userData.interiorFallback = fallback
    entry.users.add(material)
  }
  return material
}

function Model({ url, scene, settings, activeRoomId, activeLevelId, onSelectRoom, onSelectFurniture, resetToken, boundsCenter, boundsDistance }: {
  url: string; scene: ModelScene; activeRoomId: string | null; activeLevelId: string | null;
  settings: RoomInteriorSetting[]; onSelectRoom: (id: string) => void; onSelectFurniture: (label: string, roomId: string) => void;
  resetToken: number; boundsCenter: Vector3; boundsDistance: number
}) {
  const gltf = useGLTF(url)
  const { camera, gl, scene: threeScene } = useThree()
  const controls = useRef<React.ComponentRef<typeof OrbitControls>>(null)
  const object = useMemo(() => {
    const copy = gltf.scene.clone(true)
    copy.traverse(child => {
      if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
        child.material = child.material.clone()
      }
    })
    return copy
  }, [gltf.scene])
  const roomIds = useMemo(() => new Set(scene.rooms.map(room => room.id)), [scene])
  const wallById = useMemo(() => new Map((scene.walls || []).map(wall => [wall.id, wall])), [scene])
  const edgeByNode = useMemo(() => (scene.site_edges || []).map(edge => ({ prefix: `edge_${edge.id}_`, edge })), [scene])
  const stairByNode = useMemo(() => (scene.stairs || []).map(stair => ({ prefixes: [`stair_${stair.id}_`, `stair_rail_${stair.id}_`], stair })), [scene])
  const materialById = useMemo(() => new Map((scene.materials || []).map(item => [item.id, item])), [scene.materials])
  const assignmentByRoom = useMemo(() => new Map((scene.surface_assignments || []).filter(item => item.room_id).map(item => [`${item.room_id}:${item.surface}`, item.material_id])), [scene.surface_assignments])
  const assignmentByWall = useMemo(() => new Map((scene.surface_assignments || []).filter(item => item.wall_id).map(item => [item.wall_id, item.material_id])), [scene.surface_assignments])
  const settingsByRoom = useMemo(() => new Map(settings.map(item => [item.room_id, item])), [settings])
  const assetById = useMemo(() => new Map((scene.furniture_assets || []).map(item => [item.id, item])), [scene.furniture_assets])
  const visibleFurniture = useMemo(() => (scene.furniture_instances || []).filter(item => {
    const room = scene.rooms.find(row => row.id === item.room_id)
    const setting = settingsByRoom.get(item.room_id)
    return room && (!activeLevelId || room.level_id === activeLevelId) && setting?.preset !== 'unfurnished' && !setting?.removed_asset_ids?.includes(item.asset_id)
  }), [scene, activeLevelId, settingsByRoom])

  useEffect(() => {
    if (scene.schema_version < 3) return
    const pmrem = new PMREMGenerator(gl)
    const environment = new RoomEnvironment()
    const envMap = pmrem.fromScene(environment).texture
    threeScene.environment = envMap
    threeScene.environmentIntensity = .45
    return () => { threeScene.environment = null; threeScene.environmentIntensity = 1; envMap.dispose(); environment.dispose(); pmrem.dispose() }
  }, [gl, threeScene, scene.schema_version])

  useEffect(() => {
    object.traverse(child => {
      if (!(child instanceof Mesh)) return
      const wall = child.name.startsWith('wall_') ? wallById.get(child.name.slice(5, 41)) : undefined
      const edge = child.name.startsWith('edge_') ? edgeByNode.find(item => child.name.startsWith(item.prefix))?.edge : undefined
      const stair = child.name.startsWith('stair_') ? stairByNode.find(item => item.prefixes.some(prefix => child.name.startsWith(prefix)))?.stair : undefined
      const roomId = child.name.startsWith('room_') ? child.name.slice(5) :
        edge?.room_id || wall?.left_space_id || wall?.right_space_id || (child.name.startsWith('wall_') ? child.name.slice(5, 41) : '')
      const room = scene.rooms.find(item => item.id === roomId)
      child.visible = stair ? (!activeLevelId || stair.source_level_id === activeLevelId || stair.destination_level_id === activeLevelId) : edge ? (!activeLevelId || edge.level_id === activeLevelId) : wall ? (!activeLevelId || wall.level_id === activeLevelId) : child.name.startsWith('wall_legacy_') ? (!activeLevelId || child.name.startsWith(`wall_legacy_${activeLevelId}_`)) : Boolean(room && (!activeLevelId || room.level_id === activeLevelId))
      if (!(child.material instanceof MeshStandardMaterial)) return
      if (scene.schema_version >= 3 && room?.category === 'indoor' && (child.name.startsWith('room_') || wall)) {
        const surface = wall ? 'wall' : 'floor'
        const selectedId = (wall && assignmentByWall.get(wall.id)) || settingsByRoom.get(roomId)?.[surface === 'floor' ? 'floor_material_id' : 'wall_material_id'] || assignmentByRoom.get(`${roomId}:${surface}`)
        releaseSurfaceMaterial(child.material)
        child.material.dispose()
        child.material = makeSurfaceMaterial(materialById.get(selectedId || ''), surface === 'floor' ? '#e5decf' : '#e6ebe6')
        if (roomId === activeRoomId) child.material.color.multiply(new Color('#b7e2d6'))
        if (wall) { child.material.transparent = true; child.material.opacity = activeRoomId ? .24 : .72; child.material.depthWrite = false }
      } else child.material.color = new Color(roomId === activeRoomId ? '#58b6a1' :
        stair ? child.name.startsWith('stair_rail_') ? '#74788b' : '#b5ab97' : edge ? '#9eaeb0' : child.name.startsWith('wall_') ? '#e6ebe6' : room?.category === 'outdoor' ? '#8cbbaf' : '#e5decf')
    })
  }, [object, scene, activeRoomId, activeLevelId, wallById, edgeByNode, stairByNode, materialById, assignmentByRoom, assignmentByWall, settingsByRoom])

  useEffect(() => () => { object.traverse(child => {
    if (child instanceof Mesh && child.material instanceof MeshStandardMaterial) {
      releaseSurfaceMaterial(child.material); child.material.dispose()
    }
  }) }, [object])

  useEffect(() => {
    const room = scene.rooms.find(item => item.id === activeRoomId)
    if (!room) return
    const target = new Vector3(...room.center)
    controls.current?.target.copy(target)
    camera.position.set(target.x + 5, target.y + 7, target.z + 7)
    controls.current?.update()
  }, [activeRoomId, scene, camera])

  useEffect(() => {
    if (!resetToken) return
    controls.current?.target.copy(boundsCenter)
    camera.position.set(boundsCenter.x + boundsDistance * .65, boundsCenter.y + boundsDistance * .8, boundsCenter.z + boundsDistance * .65)
    controls.current?.update()
  }, [resetToken, boundsCenter, boundsDistance, camera])

  const click = (event: ThreeEvent<MouseEvent>) => {
    let node: Group | Mesh | null = event.object as Mesh
    while (node) {
      const name = node.name
      const wall = name.startsWith('wall_') ? wallById.get(name.slice(5, 41)) : undefined
      const edge = name.startsWith('edge_') ? edgeByNode.find(item => name.startsWith(item.prefix))?.edge : undefined
      const roomId = name.startsWith('room_') ? name.slice(5) :
        edge?.room_id || wall?.left_space_id || wall?.right_space_id || (name.startsWith('wall_') ? name.slice(5, 41) : '')
      if (roomIds.has(roomId)) { event.stopPropagation(); onSelectRoom(roomId); return }
      node = node.parent as Group | null
    }
  }
  return <>
    <ambientLight intensity={scene.schema_version >= 3 ? .45 : 1.7}/>
    <directionalLight position={[8, 15, 6]} intensity={scene.schema_version >= 3 ? 1.5 : 2.1}/>
    <primitive object={object} onClick={click}/>
    {visibleFurniture.map(item => { const asset = assetById.get(item.asset_id); const room = scene.rooms.find(row => row.id === item.room_id); return asset && room ?
      <AssetErrorBoundary key={item.id}><Suspense fallback={null}><FurnitureItem item={item} asset={asset} roomName={room.name} onSelect={onSelectFurniture}/></Suspense></AssetErrorBoundary> : null })}
    <OrbitControls ref={controls} makeDefault enablePan enableZoom minDistance={2} maxDistance={120}/>
  </>
}

export default function Property3DViewer({ url, scene, settings = [], activeRoomId, activeLevelId, onSelectRoom, onFallback, onMetrics }: {
  url: string; scene: ModelScene; activeRoomId: string | null; activeLevelId: string | null;
  settings?: RoomInteriorSetting[]; onSelectRoom: (id: string) => void; onFallback: () => void; onMetrics?: (value: SceneMetrics) => void
}) {
  const [cameraReset, setCameraReset] = useState(0)
  const [furnitureLabel, setFurnitureLabel] = useState('')
  const bounds = useMemo(() => {
    const points = scene.rooms.filter(room => !activeLevelId || room.level_id === activeLevelId)
      .flatMap(room => room.polygon.map(([x, z]) => new Vector3(x, room.center[1], z)))
    const box = new Box3().setFromPoints(points.length ? points : [new Vector3(-5, 0, -5), new Vector3(5, 0, 5)])
    const center = box.getCenter(new Vector3())
    return { center, distance: Math.max(9, box.getSize(new Vector3()).length() * 1.2) }
  }, [scene, activeLevelId])
  return <div className="relative h-[min(65vh,620px)] min-h-[360px] w-full overflow-hidden rounded-2xl bg-[#e8efeb]">
    <ModelErrorBoundary onFallback={onFallback}>
      <Suspense fallback={<div className="grid h-full place-items-center text-sm text-slate-600">Loading 3D model…</div>}>
        <Canvas key={cameraReset} camera={{ position: [bounds.center.x + bounds.distance * .65, bounds.center.y + bounds.distance * .8, bounds.center.z + bounds.distance * .65], fov: 48, near: 0.1, far: 1000 }}>
          <Model url={url} scene={scene} settings={settings} activeRoomId={activeRoomId} activeLevelId={activeLevelId} onSelectRoom={onSelectRoom} onSelectFurniture={(label, roomId) => { setFurnitureLabel(label); onSelectRoom(roomId) }} resetToken={cameraReset} boundsCenter={bounds.center} boundsDistance={bounds.distance}/>
          {onMetrics && <MetricsSampler onMetrics={onMetrics}/>}
        </Canvas>
      </Suspense>
    </ModelErrorBoundary>
    <button type="button" onClick={() => setCameraReset(value => value + 1)} className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold shadow" aria-label="Reset 3D camera"><RotateCcw size={15}/>Reset camera</button>
    {furnitureLabel && <p className="pointer-events-none absolute left-3 top-3 rounded-lg bg-white/90 px-3 py-2 text-xs font-semibold text-ink">{furnitureLabel}</p>}
    <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-xs text-ink">Drag to orbit · scroll to zoom · right drag to pan</p>
  </div>
}
