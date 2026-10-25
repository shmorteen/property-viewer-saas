-- The curated material and furniture catalog ships as read-only application
-- assets. Only property-specific overrides need database rows.
create table public.room_interior_settings (
  room_id uuid primary key references public.rooms(id) on delete cascade,
  preset text not null default 'standard' check (preset in ('standard', 'unfurnished')),
  floor_material_id text check (floor_material_id is null or floor_material_id in
    ('light_oak','dark_wood','neutral_tile','marble','concrete')),
  wall_material_id text check (wall_material_id is null or wall_material_id in
    ('neutral_paint','warm_paint','marble_accent','wall_tile','wood_panel')),
  removed_asset_ids text[] not null default '{}',
  updated_at timestamptz not null default now(),
  check (removed_asset_ids <@ array['sofa','coffee_table','tv_stand','armchair','bed',
    'bedside','wardrobe','dining_table','dining_chair','desk','office_chair']::text[])
);

alter table public.room_interior_settings enable row level security;
create policy room_interiors_read on public.room_interior_settings for select to authenticated
  using (public.can_read(public.room_org(room_id)));
create policy room_interiors_insert on public.room_interior_settings for insert to authenticated
  with check (public.can_edit(public.room_org(room_id)));
create policy room_interiors_update on public.room_interior_settings for update to authenticated
  using (public.can_edit(public.room_org(room_id))) with check (public.can_edit(public.room_org(room_id)));
create policy room_interiors_delete on public.room_interior_settings for delete to authenticated
  using (public.can_edit(public.room_org(room_id)));
