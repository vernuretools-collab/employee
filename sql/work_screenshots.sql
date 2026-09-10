-- Private work screenshots captured by CRM Desktop while an employee is clocked in.
-- Apply once against the same Supabase project the portals use (SQL editor or `supabase db query`).

create table if not exists public.work_screenshots (
  id text primary key,
  user_id text,
  org_id text,
  auth_id uuid,
  captured_at timestamptz not null default now(),
  storage_path text not null,
  width integer,
  height integer
);

create index if not exists work_screenshots_user_idx on public.work_screenshots (user_id);
create index if not exists work_screenshots_captured_idx on public.work_screenshots (captured_at desc);

alter table public.work_screenshots enable row level security;
alter table public.work_screenshots replica identity full;

drop policy if exists work_screenshots_select on public.work_screenshots;
drop policy if exists work_screenshots_insert on public.work_screenshots;

create policy work_screenshots_select on public.work_screenshots
  for select to authenticated
  using (
    public.is_admin()
    or user_id = any (public.self_identity_ids())
    or auth_id = auth.uid()
  );

create policy work_screenshots_insert on public.work_screenshots
  for insert to authenticated
  with check (
    public.is_admin()
    or user_id = any (public.self_identity_ids())
    or auth_id = auth.uid()
  );

insert into storage.buckets (id, name, public)
values ('work-screenshots', 'work-screenshots', false)
on conflict (id) do update set public = false;

drop policy if exists storage_work_screenshots_select on storage.objects;
drop policy if exists storage_work_screenshots_insert on storage.objects;
drop policy if exists storage_work_screenshots_update on storage.objects;
drop policy if exists storage_work_screenshots_delete on storage.objects;

-- Object paths: {uid}/{YYYY-MM-DD}/{timestamp}.jpg
create policy storage_work_screenshots_select on storage.objects
  for select to authenticated
  using (
    bucket_id = 'work-screenshots'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any (public.self_identity_ids())
    )
  );

create policy storage_work_screenshots_insert on storage.objects
  for insert to authenticated
  with check (
    bucket_id = 'work-screenshots'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any (public.self_identity_ids())
    )
  );

create policy storage_work_screenshots_update on storage.objects
  for update to authenticated
  using (
    bucket_id = 'work-screenshots'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any (public.self_identity_ids())
    )
  )
  with check (
    bucket_id = 'work-screenshots'
    and (
      public.is_admin()
      or (storage.foldername(name))[1] = any (public.self_identity_ids())
    )
  );

create policy storage_work_screenshots_delete on storage.objects
  for delete to authenticated
  using (
    bucket_id = 'work-screenshots'
    and public.is_admin()
  );
