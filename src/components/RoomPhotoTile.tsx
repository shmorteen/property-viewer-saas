import { useState } from 'react'
import { Trash2 } from 'lucide-react'
import type { RoomMedia } from '../lib/types'
import { isLowResolutionPhoto } from '../lib/image-quality'

export function RoomPhotoTile({ item, roomName, busy, onDelete }: { item: RoomMedia; roomName: string; busy: boolean; onDelete: () => void }) {
  const [size, setSize] = useState<{ width: number; height: number } | null>(null)
  const lowResolution = size && isLowResolutionPhoto(size.width, size.height)

  return <div className="overflow-hidden rounded-lg border border-line bg-white">
    <div className="relative">
      <img
        src={item.url}
        alt={item.alt_text || roomName}
        className="aspect-square w-full object-cover"
        onLoad={event => setSize({ width: event.currentTarget.naturalWidth, height: event.currentTarget.naturalHeight })}
      />
      <button
        className="absolute right-1 top-1 rounded-lg bg-white p-1.5 text-red-600 shadow"
        aria-label={`Delete ${item.alt_text || roomName}`}
        disabled={busy}
        onClick={onDelete}
      ><Trash2 size={15}/></button>
    </div>
    {size && <p className={`px-2 py-1.5 text-xs ${lowResolution ? 'font-semibold text-amber-800' : 'text-slate-500'}`}>
      {size.width} × {size.height} px{lowResolution ? ' · Low resolution' : ''}
    </p>}
  </div>
}
