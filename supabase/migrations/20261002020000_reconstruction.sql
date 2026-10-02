alter table public.properties
  add column layout_width_m numeric(6,2) not null default 12
  check (layout_width_m between 2 and 100);

create table public.processing_jobs (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  status text not null default 'queued' check (status in ('queued', 'processing', 'completed', 'failed')),
  progress integer not null default 0 check (progress between 0 and 100),
  error_message text,
  attempts integer not null default 0,
  started_at timestamptz,
  completed_at timestamptz,
  created_at timestamptz not null default now()
);
create index processing_jobs_property_recent on public.processing_jobs(property_id, created_at desc);
create index processing_jobs_queue on public.processing_jobs(created_at) where status = 'queued';
create unique index processing_jobs_one_active on public.processing_jobs(property_id) where status in ('queued', 'processing');

create table public.property_models (
  id uuid primary key default gen_random_uuid(),
  property_id uuid not null references public.properties(id) on delete cascade,
  glb_path text not null,
  scene_path text not null,
  version integer not null check (version > 0),
  created_at timestamptz not null default now(),
  unique (property_id, version)
);
create index property_models_property_latest on public.property_models(property_id, version desc);

alter table public.processing_jobs enable row level security;
alter table public.property_models enable row level security;
create policy processing_jobs_read on public.processing_jobs for select to authenticated
  using (public.can_read(public.property_org(property_id)));
create policy processing_jobs_queue on public.processing_jobs for insert to authenticated
  with check (public.can_edit(public.property_org(property_id)) and status = 'queued'
    and progress = 0 and error_message is null and attempts = 0
    and started_at is null and completed_at is null);
create policy property_models_read on public.property_models for select to authenticated
  using (public.can_read(public.property_org(property_id)));

-- The worker claims one queued or abandoned job atomically. Only service_role may call it.
create function public.claim_processing_job()
returns setof public.processing_jobs
language plpgsql security definer set search_path = public
as $$
declare claimed public.processing_jobs;
begin
  update public.processing_jobs set status = 'failed', completed_at = now(),
    error_message = 'Worker stopped repeatedly; start a new job after checking the service'
  where status = 'processing' and started_at < now() - interval '30 minutes' and attempts >= 3;
  select * into claimed from public.processing_jobs
  where status = 'queued' or (status = 'processing' and started_at < now() - interval '30 minutes' and attempts < 3)
  order by created_at
  for update skip locked limit 1;
  if not found then return; end if;
  update public.processing_jobs set status = 'processing', progress = 5,
    error_message = null, started_at = now(), completed_at = null, attempts = attempts + 1
  where id = claimed.id returning * into claimed;
  return next claimed;
end $$;
revoke all on function public.claim_processing_job() from public, anon, authenticated;
grant execute on function public.claim_processing_job() to service_role;

insert into storage.buckets(id, name, public, file_size_limit, allowed_mime_types)
values ('property-models', 'property-models', false, 52428800,
  array['model/gltf-binary', 'application/octet-stream', 'application/json'])
on conflict (id) do nothing;
create policy storage_model_read on storage.objects for select to authenticated
  using (bucket_id = 'property-models' and public.can_read(public.storage_org(name)));
create policy storage_model_delete on storage.objects for delete to authenticated
  using (bucket_id = 'property-models' and public.can_edit(public.storage_org(name)));
