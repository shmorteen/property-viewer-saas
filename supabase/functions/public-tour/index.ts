import { cors, json, service, appUrl } from '../_shared/common.ts'

const resolve = async (admin: ReturnType<typeof service>, bucket: string, path: string) => {
  if (path.startsWith('/demo/')) return `${appUrl()}${path}`
  const { data, error } = await admin.storage.from(bucket).createSignedUrl(path, 3600)
  if (error) throw error
  return data.signedUrl
}

Deno.serve(async req => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: cors })
  if (req.method !== 'POST') return json({ error: 'Method not allowed' }, 405)
  try {
    const { slug } = await req.json()
    if (typeof slug !== 'string' || !/^[a-z0-9-]{3,80}$/.test(slug)) return json({ error: 'Invalid tour slug' }, 400)
    const admin = service()
    const { data: tour, error } = await admin.from('tours').select('*').eq('slug', slug).eq('published', true).single()
    if (error || !tour) return json({ error: 'Tour not found' }, 404)
    const { data: property } = await admin.from('properties').select('*').eq('id', tour.property_id).single()
    if (!property) return json({ error: 'Tour not found' }, 404)
    const { data: organization } = await admin.from('organizations').select('id,name,slug,logo_path,website,created_at').eq('id', property.organization_id).single()
    const [{ data: levels }, { data: floors }, { data: rooms }, { data: model }] = await Promise.all([
      admin.from('levels').select('*').eq('property_id', property.id).order('sort_order'),
      admin.from('floor_plans').select('*').eq('property_id', property.id),
      admin.from('rooms').select('*').eq('property_id', property.id).order('sort_order'),
      admin.from('property_models').select('*').eq('property_id', property.id).order('version', { ascending: false }).limit(1).maybeSingle(),
    ])
    const roomIds = (rooms || []).map(room => room.id)
    const [{ data: media }, { data: polygons }, { data: openings }, { data: stairs }] = await Promise.all([
      roomIds.length ? admin.from('room_media').select('*').in('room_id', roomIds).order('sort_order') : Promise.resolve({ data: [] }),
      roomIds.length ? admin.from('room_polygons').select('*').in('room_id', roomIds) : Promise.resolve({ data: [] }),
      roomIds.length ? admin.from('openings').select('*').in('space_id', roomIds) : Promise.resolve({ data: [] }),
      roomIds.length ? admin.from('stair_connections').select('*').in('space_id', roomIds) : Promise.resolve({ data: [] }),
    ])
    const [resolvedFloors, logoUrl, resolvedMedia, resolvedModel] = await Promise.all([
      Promise.all((floors || []).map(async floor => ({ ...floor, url: await resolve(admin, 'floor-plans', floor.storage_path) }))),
      organization?.logo_path ? resolve(admin, 'organization-branding', organization.logo_path) : Promise.resolve(null),
      Promise.all((media || []).map(async item => ({ ...item, url: await resolve(admin, 'room-photos', item.storage_path) }))),
      model ? Promise.all([resolve(admin, 'property-models', model.glb_path), resolve(admin, 'property-models', model.scene_path)]).then(([glb_url, scene_url]) => ({ ...model, glb_url, scene_url })) : Promise.resolve(null),
    ])
    const firstLevel = (levels || [])[0]
    await admin.from('tour_views').insert({ tour_id: tour.id })
    return json({
      property,
      organization: { ...organization, logo_url: logoUrl },
      levels: levels || [],
      floor_plans: resolvedFloors,
      floor_plan: resolvedFloors.find(floor => floor.level_id === firstLevel?.id) || resolvedFloors[0] || null,
      rooms: (rooms || []).map(room => ({ ...room, media: resolvedMedia.filter(item => item.room_id === room.id) })),
      polygons: polygons || [],
      openings: openings || [],
      stairs: stairs || [],
      model: resolvedModel,
      tour,
    })
  } catch (error) {
    console.error(error)
    return json({ error: 'Could not load tour' }, 500)
  }
})
