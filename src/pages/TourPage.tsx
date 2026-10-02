import { useEffect, useState } from 'react'
import { Link, useParams } from 'react-router-dom'
import { ArrowLeft, ArrowRight, Bath, BedDouble, Building2, ChevronLeft, ChevronRight, MapPin } from 'lucide-react'
import { FloorPlanCanvas } from '../components/FloorPlanCanvas'
import { Button, Notice, Spinner } from '../components/ui'
import { getProperty, getPublicTour, getTour, listFloorPlans, listLevelPolygons, listLevels, listMedia, listOpenings, listRooms, listStairs, signedUrl } from '../lib/data'
import { errorMessage } from '../lib/supabase'
import type { Level, TourPayload } from '../lib/types'
import { useApp } from '../context'

async function privatePayload(id: string, organization: NonNullable<ReturnType<typeof useApp>['organization']>): Promise<TourPayload> {
  const [property, levels, floors, rooms, tour] = await Promise.all([getProperty(id), listLevels(id), listFloorPlans(id), listRooms(id), getTour(id)])
  const roomIds = rooms.map(room => room.id)
  const [rawMedia, polygons, openings, stairs, resolvedFloors, logoUrl] = await Promise.all([
    listMedia(roomIds), listLevelPolygons(levels.map(level => level.id)), listOpenings(roomIds), listStairs(roomIds),
    Promise.all(floors.map(async floor => ({ ...floor, url: await signedUrl('floor-plans', floor.storage_path) }))),
    organization.logo_path ? signedUrl('organization-branding', organization.logo_path) : Promise.resolve(''),
  ])
  const media = await Promise.all(rawMedia.map(async item => ({ ...item, url: await signedUrl('room-photos', item.storage_path) })))
  return {
    property, organization: { ...organization, logo_url: logoUrl }, levels, floor_plans: resolvedFloors,
    floor_plan: resolvedFloors.find(floor => floor.level_id === levels[0]?.id) || resolvedFloors[0] || null,
    rooms: rooms.map(room => ({ ...room, media: media.filter(item => item.room_id === room.id) })),
    polygons, openings, stairs,
    tour: tour || { id: '', property_id: id, slug: '', published: false, published_at: null, created_at: '' },
  }
}

export function TourPage({ preview = false }: { preview?: boolean }) {
  const { slug, id } = useParams()
  const { organization } = useApp()
  const [payload, setPayload] = useState<TourPayload | null>(null)
  const [levelId, setLevelId] = useState<string | null>(null)
  const [roomId, setRoomId] = useState<string | null>(null)
  const [photo, setPhoto] = useState(0)
  const [error, setError] = useState('')
  const [loading, setLoading] = useState(true)
  useEffect(() => {
    setLoading(true); setError('')
    const promise = preview && id && organization ? privatePayload(id, organization) : slug ? getPublicTour(slug) : Promise.reject(new Error('Tour not found'))
    promise.then(data => { setPayload(data); const firstLevel = data.levels?.[0]; setLevelId(firstLevel?.id || data.rooms[0]?.level_id || null); setRoomId(data.rooms.find(room => room.level_id === firstLevel?.id)?.id || data.rooms[0]?.id || null) }).catch(e => setError(errorMessage(e))).finally(() => setLoading(false))
  }, [preview, id, slug, organization])
  const levels: Level[] = payload?.levels?.length ? payload.levels : payload?.rooms[0]?.level_id ? [{ id: payload.rooms[0].level_id, property_id: payload.property.id, name: 'Ground Floor', level_type: 'ground', sort_order: 0, elevation: 0, canvas_width: 1200, canvas_height: 900, created_at: '' }] : []
  const activeLevel = levels.find(level => level.id === levelId) || levels[0]
  const visibleRooms = payload?.rooms.filter(room => room.level_id === activeLevel?.id) || []
  const activeRoom = visibleRooms.find(room => room.id === roomId) || visibleRooms[0]
  const photos = activeRoom?.media || []
  const visiblePolygons = payload?.polygons.filter(poly => poly.level_id === activeLevel?.id) || []
  const visibleOpenings = payload?.openings?.filter(opening => visibleRooms.some(room => room.id === opening.space_id)) || []
  const floor = payload?.floor_plans?.find(item => item.level_id === activeLevel?.id) || (levels.length === 1 ? payload?.floor_plan : null)
  const stair = payload?.stairs?.find(item => item.space_id === activeRoom?.id)
  const stairDestination = levels.find(level => level.id === stair?.destination_level_id)
  const roomIndex = visibleRooms.findIndex(room => room.id === activeRoom?.id)
  const selectRoom = (next: string) => { setRoomId(next); setPhoto(0) }
  const selectLevel = (next: Level) => { setLevelId(next.id); setRoomId(payload?.rooms.find(room => room.level_id === next.id)?.id || null); setPhoto(0) }

  return <div className={preview ? '' : 'min-h-screen bg-cream'}>
    {preview && <Link to={`/properties/${id}/editor`} className="mb-6 inline-flex items-center gap-2 text-sm font-semibold text-slate-500"><ArrowLeft size={17}/>Back to editor</Link>}
    {loading ? <div className="grid min-h-[60vh] place-items-center"><Spinner /></div> : error || !payload ? <div className="mx-auto max-w-xl px-5 py-20"><Notice>{error || 'Tour not found.'}</Notice></div> : <>
      <div className={preview ? 'mb-6' : 'border-b border-line bg-white'}><div className={preview ? '' : 'mx-auto flex max-w-7xl items-center justify-between px-5 py-5 sm:px-8'}>{!preview && <div className="flex items-center gap-3">{payload.organization.logo_url ? <img src={payload.organization.logo_url} alt={`${payload.organization.name} logo`} className="h-10 w-10 rounded-lg object-contain"/> : <div className="grid h-10 w-10 place-items-center rounded-lg bg-mint text-pine"><Building2 size={20}/></div>}<span className="text-sm font-extrabold">{payload.organization.name}</span></div>}{preview && <span className="rounded-full bg-amber-100 px-3 py-1 text-xs font-bold text-amber-800">Private preview</span>}</div></div>
      <div className={preview ? '' : 'mx-auto max-w-7xl px-5 py-8 sm:px-8'}>
        <div className="mb-7"><p className="text-xs font-bold uppercase tracking-[.18em] text-pine">Interactive property tour</p><h1 className="mt-2 text-3xl font-extrabold sm:text-4xl">{payload.property.title}</h1><div className="mt-3 flex flex-wrap items-center gap-5 text-sm text-slate-500"><span className="flex items-center gap-1"><MapPin size={16}/>{payload.property.address}</span><span className="flex items-center gap-1"><BedDouble size={16}/>{payload.property.bedrooms} bedrooms</span><span className="flex items-center gap-1"><Bath size={16}/>{payload.property.bathrooms} bathrooms</span></div></div>
        {levels.length > 1 && <div className="mb-6 flex flex-wrap gap-2" aria-label="Tour levels">{levels.map(level => <button key={level.id} onClick={() => selectLevel(level)} className={`min-h-10 rounded-xl border px-4 py-2 text-sm font-semibold ${activeLevel?.id === level.id ? 'border-pine bg-pine text-white' : 'border-line bg-white hover:bg-mint'}`}>{level.name}</button>)}</div>}
        <div className="grid gap-6 lg:grid-cols-[minmax(0,1.25fr)_minmax(320px,.75fr)]">
          <div className="min-w-0"><div className="relative overflow-hidden rounded-2xl bg-[#dce8dd]">{photos.length ? <img src={photos[photo]?.url} alt={photos[photo]?.alt_text || activeRoom?.name || 'Space photo'} className="aspect-[4/3] w-full object-cover"/> : <div className="grid aspect-[4/3] place-items-center text-center text-slate-500"><div><Building2 size={42} className="mx-auto mb-3 text-pine/40"/><p>No photos for this space yet</p></div></div>}{photos.length > 1 && <><button aria-label="Previous photo" onClick={() => setPhoto((photo - 1 + photos.length) % photos.length)} className="absolute left-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90"><ChevronLeft/></button><button aria-label="Next photo" onClick={() => setPhoto((photo + 1) % photos.length)} className="absolute right-4 top-1/2 grid h-10 w-10 -translate-y-1/2 place-items-center rounded-full bg-white/90"><ChevronRight/></button><span className="absolute bottom-4 right-4 rounded-full bg-ink/75 px-3 py-1 text-xs font-semibold text-white">{photo + 1} / {photos.length}</span></>}</div><div className="mt-5"><h2 className="text-2xl font-extrabold">{activeRoom?.name || 'No spaces yet'}</h2><p className="mt-1 text-sm text-slate-500">{activeRoom?.description}</p>{stairDestination && <button className="mt-3 rounded-xl border border-pine bg-mint px-4 py-2 text-sm font-semibold text-pine" onClick={() => selectLevel(stairDestination)}>Go to {stairDestination.name} <ArrowRight size={15} className="ml-1 inline"/></button>}</div>{photos.length > 1 && <div className="mt-5 flex gap-2 overflow-x-auto pb-2">{photos.map((item, index) => <button key={item.id} onClick={() => setPhoto(index)} aria-label={`Show photo ${index + 1}`} className={`shrink-0 overflow-hidden rounded-lg border-2 ${photo === index ? 'border-pine' : 'border-transparent'}`}><img src={item.url} alt={item.alt_text} className="h-16 w-20 object-cover"/></button>)}</div>}</div>
          <div className="min-w-0 space-y-5"><div className="rounded-2xl border border-line bg-white p-5"><div className="mb-4 flex items-center justify-between"><h2 className="text-lg font-extrabold">Explore {activeLevel?.name || 'the layout'}</h2><span className="text-xs text-slate-400">Tap a space</span></div>{floor || visiblePolygons.length ? <FloorPlanCanvas url={floor?.url || null} imageWidth={floor?.width || activeLevel?.canvas_width || 1200} imageHeight={floor?.height || activeLevel?.canvas_height || 900} rooms={visibleRooms} polygons={visiblePolygons} openings={visibleOpenings} selectedRoomId={activeRoom?.id || null} selectedPolygonId={null} draft={[]} drawing={false} editable={false} onSelectPolygon={poly => selectRoom(poly.room_id)} /> : <div className="grid aspect-[4/3] place-items-center rounded-xl bg-cream text-sm text-slate-500">No layout available</div>}</div><div className="rounded-2xl border border-line bg-white p-5"><h2 className="mb-4 text-lg font-extrabold">Spaces</h2><div className="space-y-2">{visibleRooms.map((room, index) => <button key={room.id} onClick={() => selectRoom(room.id)} className={`flex min-h-11 w-full items-center justify-between rounded-xl px-4 py-3 text-left text-sm font-semibold ${activeRoom?.id === room.id ? 'bg-mint text-pine' : 'bg-cream hover:bg-mint'}`}><span>{String(index + 1).padStart(2, '0')} <span className="ml-2">{room.name}</span></span><ArrowRight size={16}/></button>)}</div><div className="mt-5 flex justify-between gap-2"><Button size="sm" variant="outline" disabled={roomIndex <= 0} onClick={() => selectRoom(visibleRooms[roomIndex - 1].id)}><ChevronLeft size={16}/>Previous</Button><Button size="sm" variant="outline" disabled={roomIndex < 0 || roomIndex >= visibleRooms.length - 1} onClick={() => selectRoom(visibleRooms[roomIndex + 1].id)}>Next<ChevronRight size={16}/></Button></div></div></div>
        </div>{payload.property.description && <div className="mt-8 max-w-3xl"><h2 className="text-lg font-extrabold">About this property</h2><p className="mt-3 whitespace-pre-wrap text-sm leading-7 text-slate-600">{payload.property.description}</p></div>}
      </div>
    </>}
  </div>
}
