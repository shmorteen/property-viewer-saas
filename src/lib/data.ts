import { supabase } from './supabase'
import type { FloorPlan, Organization, Property, Room, RoomMedia, RoomPolygon, Subscription, Tour, TourPayload } from './types'

function checked<T>(data: T | null, error: { message: string } | null): T { if (error) throw new Error(error.message); if (data === null) throw new Error('No data returned'); return data }
export async function listOrganizations(): Promise<Organization[]> { const { data, error } = await supabase.from('organizations').select('*').order('created_at'); return checked(data, error) as Organization[] }
export async function createOrganization(name: string): Promise<void> {
  const slug = `${name.toLowerCase().normalize('NFKD').replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '').slice(0, 40)}-${crypto.randomUUID().slice(0, 8)}`
  // Owner membership is added by an AFTER INSERT trigger, so this insert cannot return the row under the read policy.
  const { error } = await supabase.from('organizations').insert({ name, slug })
  if (error) throw error
}
export async function updateOrganization(id: string, patch: Partial<Pick<Organization, 'name' | 'website' | 'logo_path'>>): Promise<void> { const { error } = await supabase.from('organizations').update(patch).eq('id', id); if (error) throw error }
export async function listProperties(orgId: string): Promise<Property[]> { const { data, error } = await supabase.from('properties').select('*').eq('organization_id', orgId).order('updated_at', { ascending: false }); return checked(data, error) as Property[] }
export async function getProperty(id: string): Promise<Property> { const { data, error } = await supabase.from('properties').select('*').eq('id', id).single(); return checked(data, error) as Property }
export async function saveProperty(value: Omit<Property, 'id' | 'created_at' | 'updated_at'> & { id?: string }): Promise<Property> {
  const { data, error } = value.id ? await supabase.from('properties').update(value).eq('id', value.id).select('*').single() : await supabase.from('properties').insert(value).select('*').single()
  return checked(data, error) as Property
}
export async function deleteProperty(id: string): Promise<void> { const { error } = await supabase.from('properties').delete().eq('id', id); if (error) throw error }
export async function getFloorPlan(propertyId: string): Promise<FloorPlan | null> { const { data, error } = await supabase.from('floor_plans').select('*').eq('property_id', propertyId).maybeSingle(); if (error) throw error; return data as FloorPlan | null }
export async function saveFloorPlan(propertyId: string, path: string, width: number, height: number): Promise<FloorPlan> { const { data, error } = await supabase.from('floor_plans').upsert({ property_id: propertyId, storage_path: path, width, height }, { onConflict: 'property_id' }).select('*').single(); return checked(data, error) as FloorPlan }
export async function listRooms(propertyId: string): Promise<Room[]> { const { data, error } = await supabase.from('rooms').select('*').eq('property_id', propertyId).order('sort_order'); return checked(data, error) as Room[] }
export async function addRoom(propertyId: string, name: string, sortOrder: number): Promise<Room> { const { data, error } = await supabase.from('rooms').insert({ property_id: propertyId, name, sort_order: sortOrder }).select('*').single(); return checked(data, error) as Room }
export async function updateRoom(id: string, patch: Pick<Room, 'name' | 'description'>): Promise<void> { const { error } = await supabase.from('rooms').update(patch).eq('id', id); if (error) throw error }
export async function deleteRoom(id: string): Promise<void> { const { error } = await supabase.from('rooms').delete().eq('id', id); if (error) throw error }
export async function listMedia(roomIds: string[]): Promise<RoomMedia[]> { if (!roomIds.length) return []; const { data, error } = await supabase.from('room_media').select('*').in('room_id', roomIds).order('sort_order'); return checked(data, error) as RoomMedia[] }
export async function addMedia(roomId: string, path: string, alt: string, order: number): Promise<void> { const { error } = await supabase.from('room_media').insert({ room_id: roomId, storage_path: path, alt_text: alt, sort_order: order }); if (error) throw error }
export async function deleteMedia(id: string): Promise<void> { const { error } = await supabase.from('room_media').delete().eq('id', id); if (error) throw error }
export async function listPolygons(floorPlanId: string): Promise<RoomPolygon[]> { const { data, error } = await supabase.from('room_polygons').select('*').eq('floor_plan_id', floorPlanId); return checked(data, error) as RoomPolygon[] }
export async function savePolygon(polygon: Pick<RoomPolygon, 'floor_plan_id' | 'room_id' | 'points'> & { id?: string }): Promise<RoomPolygon> { const { data, error } = polygon.id ? await supabase.from('room_polygons').update({ points: polygon.points, room_id: polygon.room_id }).eq('id', polygon.id).select('*').single() : await supabase.from('room_polygons').insert(polygon).select('*').single(); return checked(data, error) as RoomPolygon }
export async function deletePolygon(id: string): Promise<void> { const { error } = await supabase.from('room_polygons').delete().eq('id', id); if (error) throw error }
export async function getTour(propertyId: string): Promise<Tour | null> { const { data, error } = await supabase.from('tours').select('*').eq('property_id', propertyId).maybeSingle(); if (error) throw error; return data as Tour | null }
export async function saveTour(propertyId: string, slug: string, published: boolean): Promise<Tour> { const { data, error } = await supabase.from('tours').upsert({ property_id: propertyId, slug, published, published_at: published ? new Date().toISOString() : null }, { onConflict: 'property_id' }).select('*').single(); return checked(data, error) as Tour }
export async function getSubscription(orgId: string): Promise<Subscription | null> { const { data, error } = await supabase.from('subscriptions').select('*').eq('organization_id', orgId).maybeSingle(); if (error) throw error; return data as Subscription | null }
export async function signedUrl(bucket: string, path: string): Promise<string> { const { data, error } = await supabase.storage.from(bucket).createSignedUrl(path, 3600); if (error) throw error; return data.signedUrl }
export async function upload(bucket: string, orgId: string, propertyId: string | null, file: File): Promise<string> {
  if (!['image/jpeg', 'image/png', 'image/webp'].includes(file.type)) throw new Error('Use a JPG, PNG, or WebP image.')
  if (file.size > 15 * 1024 * 1024) throw new Error('Image must be under 15 MB.')
  const ext = ({ 'image/jpeg': 'jpg', 'image/png': 'png', 'image/webp': 'webp' } as Record<string, string>)[file.type]
  const path = `${orgId}/${propertyId || 'branding'}/${crypto.randomUUID()}.${ext}`
  const { error } = await supabase.storage.from(bucket).upload(path, file, { contentType: file.type, cacheControl: '3600', upsert: false })
  if (error) throw error
  return path
}
export async function removeObject(bucket: string, path: string): Promise<void> { const { error } = await supabase.storage.from(bucket).remove([path]); if (error) throw error }
export async function getPublicTour(slug: string): Promise<TourPayload> { const { data, error } = await supabase.functions.invoke('public-tour', { body: { slug } }); if (error) throw error; if (data?.error) throw new Error(data.error); return data as TourPayload }
