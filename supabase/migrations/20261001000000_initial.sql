create extension if not exists pgcrypto;
create function public.valid_polygon(p jsonb) returns boolean language plpgsql immutable as $$
declare q jsonb;
begin
  if jsonb_typeof(p) <> 'array' then return false; end if;
  if jsonb_array_length(p) not between 3 and 100 then return false; end if;
  for q in select value from jsonb_array_elements(p) loop
    if jsonb_typeof(q) <> 'object' or jsonb_typeof(q->'x') <> 'number' or jsonb_typeof(q->'y') <> 'number' then return false; end if;
    if (q->>'x')::numeric not between 0 and 1 or (q->>'y')::numeric not between 0 and 1 then return false; end if;
  end loop;
  return true;
end $$;

create table public.profiles (
  id uuid primary key references auth.users(id) on delete cascade,
  full_name text not null default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organizations (
  id uuid primary key default gen_random_uuid(),
  name text not null check (char_length(name) between 2 and 100),
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,60}$'),
  logo_path text,
  website text,
  created_by uuid references auth.users(id) on delete set null default auth.uid(),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.organization_members (
  organization_id uuid not null references public.organizations(id) on delete cascade,
  user_id uuid not null references auth.users(id) on delete cascade,
  role text not null check (role in ('owner','editor','viewer')) default 'viewer',
  created_at timestamptz not null default now(),
  primary key (organization_id,user_id)
);
create index organization_members_user_idx on public.organization_members(user_id);
create table public.properties (
  id uuid primary key default gen_random_uuid(),
  organization_id uuid not null references public.organizations(id) on delete cascade,
  title text not null check (char_length(title) between 1 and 120),
  address text not null check (char_length(address) between 1 and 250),
  description text not null default '',
  property_type text not null default 'House',
  bedrooms integer not null default 0 check (bedrooms between 0 and 100),
  bathrooms integer not null default 0 check (bathrooms between 0 and 100),
  status text not null default 'draft' check (status in ('draft','active','under_offer','sold','let')),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index properties_org_updated_idx on public.properties(organization_id,updated_at desc);
create table public.floor_plans (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  storage_path text not null,
  width integer not null check (width > 0),
  height integer not null check (height > 0),
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.rooms (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  name text not null check (char_length(name) between 1 and 80),
  description text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index rooms_property_order_idx on public.rooms(property_id,sort_order);
create table public.room_media (
  id uuid primary key default gen_random_uuid(),
  room_id uuid not null references public.rooms(id) on delete cascade,
  storage_path text not null,
  alt_text text not null default '',
  sort_order integer not null default 0,
  created_at timestamptz not null default now()
);
create index room_media_room_order_idx on public.room_media(room_id,sort_order);
create table public.room_polygons (
  id uuid primary key default gen_random_uuid(),
  floor_plan_id uuid not null references public.floor_plans(id) on delete cascade,
  room_id uuid not null references public.rooms(id) on delete cascade,
  points jsonb not null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  constraint normalized_polygon check (public.valid_polygon(points))
);
create index room_polygons_floor_idx on public.room_polygons(floor_plan_id);
create index room_polygons_room_idx on public.room_polygons(room_id);
create table public.tours (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null unique references public.properties(id) on delete cascade,
  slug text not null unique check (slug ~ '^[a-z0-9-]{3,80}$'),
  published boolean not null default false,
  published_at timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create index tours_published_slug_idx on public.tours(slug) where published;
create table public.subscriptions (
  organization_id uuid primary key references public.organizations(id) on delete cascade,
  stripe_customer_id text unique,
  stripe_subscription_id text unique,
  stripe_price_id text,
  plan text not null default 'free' check (plan in ('free','professional')),
  status text not null default 'active',
  current_period_end timestamptz,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);
create table public.tour_views (
  id bigint generated always as identity primary key,
  tour_id uuid not null references public.tours(id) on delete cascade,
  viewed_at timestamptz not null default now()
);
create index tour_views_tour_date_idx on public.tour_views(tour_id,viewed_at desc);
create table public.stripe_events (
  id text primary key,
  processed_at timestamptz not null default now()
);

create function public.touch_updated_at() returns trigger language plpgsql as $$ begin new.updated_at = now(); return new; end $$;
create trigger profiles_touch before update on public.profiles for each row execute function public.touch_updated_at();
create trigger organizations_touch before update on public.organizations for each row execute function public.touch_updated_at();
create trigger properties_touch before update on public.properties for each row execute function public.touch_updated_at();
create trigger floor_plans_touch before update on public.floor_plans for each row execute function public.touch_updated_at();
create trigger rooms_touch before update on public.rooms for each row execute function public.touch_updated_at();
create trigger room_polygons_touch before update on public.room_polygons for each row execute function public.touch_updated_at();
create trigger tours_touch before update on public.tours for each row execute function public.touch_updated_at();
create trigger subscriptions_touch before update on public.subscriptions for each row execute function public.touch_updated_at();

create function public.new_user_profile() returns trigger language plpgsql security definer set search_path = public as $$ begin insert into public.profiles(id) values (new.id); return new; end $$;
create trigger on_auth_user_created after insert on auth.users for each row execute function public.new_user_profile();
create function public.new_org_owner() returns trigger language plpgsql security definer set search_path = public as $$ begin if new.created_by is not null then insert into public.organization_members(organization_id,user_id,role) values (new.id,new.created_by,'owner'); end if; insert into public.subscriptions(organization_id) values (new.id); return new; end $$;
create trigger on_org_created after insert on public.organizations for each row execute function public.new_org_owner();

create function public.member_role(org uuid) returns text language sql stable security definer set search_path = public as $$ select role from public.organization_members where organization_id = org and user_id = auth.uid() $$;
create function public.can_read(org uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.member_role(org) is not null $$;
create function public.can_edit(org uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.member_role(org) in ('owner','editor') $$;
create function public.is_owner(org uuid) returns boolean language sql stable security definer set search_path = public as $$ select public.member_role(org) = 'owner' $$;
create function public.property_org(pid uuid) returns uuid language sql stable security definer set search_path = public as $$ select organization_id from public.properties where id=pid $$;
create function public.room_org(rid uuid) returns uuid language sql stable security definer set search_path = public as $$ select p.organization_id from public.rooms r join public.properties p on p.id=r.property_id where r.id=rid $$;
create function public.floor_org(fid uuid) returns uuid language sql stable security definer set search_path = public as $$ select p.organization_id from public.floor_plans f join public.properties p on p.id=f.property_id where f.id=fid $$;
revoke all on function public.member_role(uuid), public.can_read(uuid), public.can_edit(uuid), public.is_owner(uuid), public.property_org(uuid), public.room_org(uuid), public.floor_org(uuid) from public;
grant execute on function public.member_role(uuid), public.can_read(uuid), public.can_edit(uuid), public.is_owner(uuid), public.property_org(uuid), public.room_org(uuid), public.floor_org(uuid) to authenticated;
create function public.same_property_polygon() returns trigger language plpgsql security definer set search_path=public as $$ begin if (select property_id from public.rooms where id=new.room_id) <> (select property_id from public.floor_plans where id=new.floor_plan_id) then raise exception 'Room and floor plan must belong to the same property'; end if; return new; end $$;
create trigger polygon_property_guard before insert or update on public.room_polygons for each row execute function public.same_property_polygon();
create function public.enforce_tour_limit() returns trigger language plpgsql security definer set search_path=public as $$ declare oid uuid; active_plan text; live_count integer; room_count integer; ready_count integer; begin
  if new.published then
    select organization_id into oid from public.properties where id=new.property_id;
    perform pg_advisory_xact_lock(hashtext(oid::text));
    if not exists (select 1 from public.floor_plans where property_id=new.property_id) then raise exception 'A floor plan is required to publish'; end if;
    select count(*) into room_count from public.rooms r where r.property_id=new.property_id;
    select count(*) into ready_count from public.rooms r where r.property_id=new.property_id and exists (select 1 from public.room_media m where m.room_id=r.id) and exists (select 1 from public.room_polygons poly join public.floor_plans f on f.id=poly.floor_plan_id where poly.room_id=r.id and f.property_id=new.property_id);
    if room_count=0 or room_count<>ready_count then raise exception 'Every room needs a photo and a floor plan area'; end if;
    select plan into active_plan from public.subscriptions where organization_id=oid and status in ('active','trialing');
    if coalesce(active_plan,'free') <> 'professional' then
      select count(*) into live_count from public.tours t join public.properties p on p.id=t.property_id where p.organization_id=oid and t.published and t.property_id<>new.property_id;
      if live_count >= 1 then raise exception 'Free plan allows one published tour'; end if;
    end if;
  end if;
  return new;
end $$;
create trigger tour_limit_guard before insert or update on public.tours for each row execute function public.enforce_tour_limit();

alter table public.profiles enable row level security;
alter table public.organizations enable row level security;
alter table public.organization_members enable row level security;
alter table public.properties enable row level security;
alter table public.floor_plans enable row level security;
alter table public.rooms enable row level security;
alter table public.room_media enable row level security;
alter table public.room_polygons enable row level security;
alter table public.tours enable row level security;
alter table public.subscriptions enable row level security;
alter table public.tour_views enable row level security;
alter table public.stripe_events enable row level security;
create policy profiles_self_select on public.profiles for select to authenticated using (id=auth.uid());
create policy profiles_self_update on public.profiles for update to authenticated using (id=auth.uid()) with check (id=auth.uid());
create policy org_member_select on public.organizations for select to authenticated using (public.can_read(id));
create policy org_auth_insert on public.organizations for insert to authenticated with check (created_by=auth.uid());
create policy org_owner_update on public.organizations for update to authenticated using (public.is_owner(id)) with check (public.is_owner(id));
create policy members_select on public.organization_members for select to authenticated using (public.can_read(organization_id));
create policy members_owner_insert on public.organization_members for insert to authenticated with check (public.is_owner(organization_id));
create policy members_owner_update on public.organization_members for update to authenticated using (public.is_owner(organization_id)) with check (public.is_owner(organization_id));
create policy members_owner_delete on public.organization_members for delete to authenticated using (public.is_owner(organization_id) and role <> 'owner');
create policy properties_select on public.properties for select to authenticated using (public.can_read(organization_id));
create policy properties_insert on public.properties for insert to authenticated with check (public.can_edit(organization_id));
create policy properties_update on public.properties for update to authenticated using (public.can_edit(organization_id)) with check (public.can_edit(organization_id));
create policy properties_delete on public.properties for delete to authenticated using (public.can_edit(organization_id));
create policy floor_select on public.floor_plans for select to authenticated using (public.can_read(public.property_org(property_id)));
create policy floor_insert on public.floor_plans for insert to authenticated with check (public.can_edit(public.property_org(property_id)));
create policy floor_update on public.floor_plans for update to authenticated using (public.can_edit(public.property_org(property_id))) with check (public.can_edit(public.property_org(property_id)));
create policy floor_delete on public.floor_plans for delete to authenticated using (public.can_edit(public.property_org(property_id)));
create policy rooms_select on public.rooms for select to authenticated using (public.can_read(public.property_org(property_id)));
create policy rooms_insert on public.rooms for insert to authenticated with check (public.can_edit(public.property_org(property_id)));
create policy rooms_update on public.rooms for update to authenticated using (public.can_edit(public.property_org(property_id))) with check (public.can_edit(public.property_org(property_id)));
create policy rooms_delete on public.rooms for delete to authenticated using (public.can_edit(public.property_org(property_id)));
create policy media_select on public.room_media for select to authenticated using (public.can_read(public.room_org(room_id)));
create policy media_insert on public.room_media for insert to authenticated with check (public.can_edit(public.room_org(room_id)));
create policy media_update on public.room_media for update to authenticated using (public.can_edit(public.room_org(room_id))) with check (public.can_edit(public.room_org(room_id)));
create policy media_delete on public.room_media for delete to authenticated using (public.can_edit(public.room_org(room_id)));
create policy polygons_select on public.room_polygons for select to authenticated using (public.can_read(public.floor_org(floor_plan_id)));
create policy polygons_insert on public.room_polygons for insert to authenticated with check (public.can_edit(public.floor_org(floor_plan_id)));
create policy polygons_update on public.room_polygons for update to authenticated using (public.can_edit(public.floor_org(floor_plan_id))) with check (public.can_edit(public.floor_org(floor_plan_id)));
create policy polygons_delete on public.room_polygons for delete to authenticated using (public.can_edit(public.floor_org(floor_plan_id)));
create policy tours_select on public.tours for select to authenticated using (public.can_read(public.property_org(property_id)));
create policy tours_insert on public.tours for insert to authenticated with check (public.can_edit(public.property_org(property_id)));
create policy tours_update on public.tours for update to authenticated using (public.can_edit(public.property_org(property_id))) with check (public.can_edit(public.property_org(property_id)));
create policy tours_delete on public.tours for delete to authenticated using (public.can_edit(public.property_org(property_id)));
create policy subs_select on public.subscriptions for select to authenticated using (public.can_read(organization_id));

create function public.organization_stats(org_id uuid) returns jsonb language plpgsql stable security definer set search_path=public as $$ declare result jsonb; begin if not public.can_read(org_id) then raise exception 'Forbidden'; end if; select jsonb_build_object('published',count(distinct t.id),'views',count(v.id)) into result from public.properties p left join public.tours t on t.property_id=p.id and t.published left join public.tour_views v on v.tour_id=t.id where p.organization_id=org_id; return result; end $$;
revoke all on function public.organization_stats(uuid) from public;
grant execute on function public.organization_stats(uuid) to authenticated;

insert into storage.buckets(id,name,public,file_size_limit,allowed_mime_types) values
  ('floor-plans','floor-plans',false,15728640,array['image/jpeg','image/png','image/webp']),
  ('room-photos','room-photos',false,15728640,array['image/jpeg','image/png','image/webp']),
  ('organization-branding','organization-branding',false,15728640,array['image/jpeg','image/png','image/webp'])
on conflict (id) do nothing;
create function public.storage_org(path text) returns uuid language plpgsql immutable as $$ begin return split_part(path,'/',1)::uuid; exception when others then return null; end $$;
create policy storage_member_read on storage.objects for select to authenticated using (bucket_id in ('floor-plans','room-photos','organization-branding') and public.can_read(public.storage_org(name)));
create policy storage_editor_upload on storage.objects for insert to authenticated with check (bucket_id in ('floor-plans','room-photos','organization-branding') and public.can_edit(public.storage_org(name)) and (storage.extension(name) in ('jpg','png','webp')));
create policy storage_editor_delete on storage.objects for delete to authenticated using (bucket_id in ('floor-plans','room-photos','organization-branding') and public.can_edit(public.storage_org(name)));
