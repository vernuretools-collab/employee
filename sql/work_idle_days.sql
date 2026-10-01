-- Daily idle seconds captured by CRM Employee while clocked in.
-- Idle starts after 20 minutes without keyboard or mouse input.
-- Apply once against the same Supabase project the portals use.

create table if not exists public.work_idle_days (
  id text primary key,
  org_id text,
  user_id text,
  parent_id text,
  collection_name text,
  auth_id uuid,
  data jsonb not null default '{}'::jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create index if not exists work_idle_days_org_idx on public.work_idle_days (org_id);
create index if not exists work_idle_days_user_idx on public.work_idle_days (user_id);
create index if not exists work_idle_days_data_gin on public.work_idle_days using gin (data);

alter table public.work_idle_days replica identity full;
alter table public.work_idle_days enable row level security;

drop policy if exists work_idle_days_select on public.work_idle_days;
drop policy if exists work_idle_days_write on public.work_idle_days;

create policy work_idle_days_select on public.work_idle_days
  for select to authenticated
  using (public.can_access_row(org_id, user_id) or public.is_admin());

create policy work_idle_days_write on public.work_idle_days
  for all to authenticated
  using (public.can_access_row(org_id, user_id) or public.is_admin())
  with check (public.can_access_row(org_id, user_id) or public.is_admin());

drop trigger if exists trg_default_org_id on public.work_idle_days;
create trigger trg_default_org_id
  before insert or update on public.work_idle_days
  for each row execute function public.default_org_id();
