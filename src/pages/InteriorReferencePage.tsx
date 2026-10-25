import { lazy, Suspense, useEffect, useState } from 'react'
import type { ModelScene } from '../lib/types'
import type { SceneMetrics } from '../components/3d/Property3DViewer'

const Property3DViewer = lazy(() => import('../components/3d/Property3DViewer'))

/** Development-only fixed reference for visual and performance checks. */
export function InteriorReferencePage() {
  const [scene, setScene] = useState<ModelScene | null>(null)
  const [selected, setSelected] = useState<string | null>(null)
  const [metrics, setMetrics] = useState<SceneMetrics | null>(null)
  const view = new URLSearchParams(window.location.search).get('view') || 'all'
  useEffect(() => {
    fetch('/interiors/reference/scene.json').then(response => response.json()).then((value: ModelScene) => {
      setScene(value)
      setSelected(value.rooms.find(room => room.space_type === view)?.id || null)
    }).catch(() => setScene(null))
  }, [view])
  return <main className="mx-auto max-w-[1100px] p-5"><h1 className="mb-4 text-xl font-bold">Interior reference · {view}</h1>
    {scene ? <Suspense fallback={<p>Loading reference model…</p>}><Property3DViewer url="/interiors/reference/model.glb" scene={scene}
      activeRoomId={selected} activeLevelId="ground" onSelectRoom={setSelected} onFallback={() => {}} onMetrics={setMetrics}/></Suspense> : <p>Loading reference scene…</p>}
    {metrics && <p className="mt-3 text-sm" aria-label="Reference scene performance">{metrics.fps} FPS · {metrics.drawCalls} draw calls · {metrics.triangles} rendered triangles</p>}
  </main>
}
