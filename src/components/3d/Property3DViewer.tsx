import { Component, Suspense, useEffect, useMemo, useRef, useState, type ReactNode } from 'react'
import { RotateCcw } from 'lucide-react'
import { Canvas, useThree, type ThreeEvent } from '@react-three/fiber'
import { OrbitControls, useGLTF } from '@react-three/drei'
import { Box3, Color, Group, Mesh, MeshStandardMaterial, Vector3 } from 'three'
import type { ModelScene } from '../../lib/types'

class ModelErrorBoundary extends Component<{ children: ReactNode; onFallback: () => void }, { error: string }> {
  state = { error: '' }
  static getDerivedStateFromError(error: Error) { return { error: error.message } }
  render() { return this.state.error ? <div className="grid h-full place-items-center p-5 text-center text-sm text-red-700"><div><p>3D is unavailable in this browser: {this.state.error}</p><button type="button" onClick={this.props.onFallback} className="mt-4 rounded-lg bg-white px-4 py-2 font-semibold text-pine">Open floor plan</button></div></div> : this.props.children }
}

function Model({ url, scene, activeRoomId, activeLevelId, onSelectRoom, resetToken, boundsCenter, boundsDistance }: {
  url: string; scene: ModelScene; activeRoomId: string | null; activeLevelId: string | null;
  onSelectRoom: (id: string) => void; resetToken: number; boundsCenter: Vector3; boundsDistance: number
}) {
  const gltf = useGLTF(url)
  const camera = useThree(state => state.camera)
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

  useEffect(() => {
    object.traverse(child => {
      if (!(child instanceof Mesh)) return
      const wall = child.name.startsWith('wall_') ? wallById.get(child.name.slice(5, 41)) : undefined
      const roomId = child.name.startsWith('room_') ? child.name.slice(5) :
        wall?.left_space_id || wall?.right_space_id || (child.name.startsWith('wall_') ? child.name.slice(5, 41) : '')
      const room = scene.rooms.find(item => item.id === roomId)
      child.visible = wall ? (!activeLevelId || wall.level_id === activeLevelId) : child.name.startsWith('wall_legacy_') ? (!activeLevelId || child.name.startsWith(`wall_legacy_${activeLevelId}_`)) : Boolean(room && (!activeLevelId || room.level_id === activeLevelId))
      if (child.material instanceof MeshStandardMaterial) {
        child.material.color = new Color(roomId === activeRoomId ? '#58b6a1' :
          child.name.startsWith('wall_') ? '#e6ebe6' : room?.category === 'outdoor' ? '#8cbbaf' : '#e5decf')
      }
    })
  }, [object, scene, activeRoomId, activeLevelId, wallById])

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
      const roomId = name.startsWith('room_') ? name.slice(5) :
        wall?.left_space_id || wall?.right_space_id || (name.startsWith('wall_') ? name.slice(5, 41) : '')
      if (roomIds.has(roomId)) { event.stopPropagation(); onSelectRoom(roomId); return }
      node = node.parent as Group | null
    }
  }
  return <>
    <ambientLight intensity={1.7}/>
    <directionalLight position={[8, 15, 6]} intensity={2.1}/>
    <primitive object={object} onClick={click}/>
    <OrbitControls ref={controls} makeDefault enablePan enableZoom minDistance={2} maxDistance={120}/>
  </>
}

export default function Property3DViewer({ url, scene, activeRoomId, activeLevelId, onSelectRoom, onFallback }: {
  url: string; scene: ModelScene; activeRoomId: string | null; activeLevelId: string | null;
  onSelectRoom: (id: string) => void; onFallback: () => void
}) {
  const [cameraReset, setCameraReset] = useState(0)
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
          <Model url={url} scene={scene} activeRoomId={activeRoomId} activeLevelId={activeLevelId} onSelectRoom={onSelectRoom} resetToken={cameraReset} boundsCenter={bounds.center} boundsDistance={bounds.distance}/>
        </Canvas>
      </Suspense>
    </ModelErrorBoundary>
    <button type="button" onClick={() => setCameraReset(value => value + 1)} className="absolute right-3 top-3 inline-flex items-center gap-2 rounded-lg bg-white px-3 py-2 text-xs font-semibold shadow" aria-label="Reset 3D camera"><RotateCcw size={15}/>Reset camera</button>
    <p className="pointer-events-none absolute bottom-3 left-3 rounded-lg bg-white/90 px-3 py-2 text-xs text-ink">Drag to orbit · scroll to zoom · right drag to pan</p>
  </div>
}
