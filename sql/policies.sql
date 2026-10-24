-- =====================================================================
-- Vehicle Expense Tracker — Row Level Security (RLS) and storage policies
-- Run this file AFTER schema.sql in the Supabase SQL Editor.
--
-- Rule for every table: a signed-in user can only see and change rows
-- where user_id = their own auth.uid().
-- The composite foreign keys in schema.sql additionally guarantee that a
-- record can only reference a vehicle owned by the same user, so changing
-- an ID in the URL or in a request can never reach someone else's data.
-- =====================================================================

-- Anonymous (not signed-in) visitors get no access to any table.
revoke all on public.vehicles, public.expenses, public.fuel_logs,
              public.maintenance_records, public.insurance_records from anon;

grant select, insert, update, delete on public.vehicles, public.expenses, public.fuel_logs,
              public.maintenance_records, public.insurance_records to authenticated;

-- ---------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------
alter table public.vehicles enable row level security;

drop policy if exists "vehicles_select_own" on public.vehicles;
create policy "vehicles_select_own" on public.vehicles
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "vehicles_insert_own" on public.vehicles;
create policy "vehicles_insert_own" on public.vehicles
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "vehicles_update_own" on public.vehicles;
create policy "vehicles_update_own" on public.vehicles
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "vehicles_delete_own" on public.vehicles;
create policy "vehicles_delete_own" on public.vehicles
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- expenses
-- ---------------------------------------------------------------------
alter table public.expenses enable row level security;

drop policy if exists "expenses_select_own" on public.expenses;
create policy "expenses_select_own" on public.expenses
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "expenses_insert_own" on public.expenses;
create policy "expenses_insert_own" on public.expenses
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "expenses_update_own" on public.expenses;
create policy "expenses_update_own" on public.expenses
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "expenses_delete_own" on public.expenses;
create policy "expenses_delete_own" on public.expenses
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- fuel_logs
-- ---------------------------------------------------------------------
alter table public.fuel_logs enable row level security;

drop policy if exists "fuel_logs_select_own" on public.fuel_logs;
create policy "fuel_logs_select_own" on public.fuel_logs
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_insert_own" on public.fuel_logs;
create policy "fuel_logs_insert_own" on public.fuel_logs
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_update_own" on public.fuel_logs;
create policy "fuel_logs_update_own" on public.fuel_logs
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "fuel_logs_delete_own" on public.fuel_logs;
create policy "fuel_logs_delete_own" on public.fuel_logs
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- maintenance_records
-- ---------------------------------------------------------------------
alter table public.maintenance_records enable row level security;

drop policy if exists "maintenance_select_own" on public.maintenance_records;
create policy "maintenance_select_own" on public.maintenance_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "maintenance_insert_own" on public.maintenance_records;
create policy "maintenance_insert_own" on public.maintenance_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "maintenance_update_own" on public.maintenance_records;
create policy "maintenance_update_own" on public.maintenance_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "maintenance_delete_own" on public.maintenance_records;
create policy "maintenance_delete_own" on public.maintenance_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- ---------------------------------------------------------------------
-- insurance_records
-- ---------------------------------------------------------------------
alter table public.insurance_records enable row level security;

drop policy if exists "insurance_select_own" on public.insurance_records;
create policy "insurance_select_own" on public.insurance_records
  for select to authenticated
  using ((select auth.uid()) = user_id);

drop policy if exists "insurance_insert_own" on public.insurance_records;
create policy "insurance_insert_own" on public.insurance_records
  for insert to authenticated
  with check ((select auth.uid()) = user_id);

drop policy if exists "insurance_update_own" on public.insurance_records;
create policy "insurance_update_own" on public.insurance_records
  for update to authenticated
  using ((select auth.uid()) = user_id)
  with check ((select auth.uid()) = user_id);

drop policy if exists "insurance_delete_own" on public.insurance_records;
create policy "insurance_delete_own" on public.insurance_records
  for delete to authenticated
  using ((select auth.uid()) = user_id);

-- =====================================================================
-- Storage: private bucket for receipt images
-- Files are stored as  receipts/<user-id>/<random-uuid>.<ext>
-- A user can only read/write files inside the folder named after their id.
-- =====================================================================
insert into storage.buckets (id, name, public, file_size_limit, allowed_mime_types)
values ('receipts', 'receipts', false, 5242880,
        array['image/jpeg', 'image/png', 'image/webp', 'image/heic'])
on conflict (id) do update
  set public = false,
      file_size_limit = excluded.file_size_limit,
      allowed_mime_types = excluded.allowed_mime_types;

drop policy if exists "receipts_select_own" on storage.objects;
create policy "receipts_select_own" on storage.objects
  for select to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_insert_own" on storage.objects;
create policy "receipts_insert_own" on storage.objects
  for insert to authenticated
  with check (bucket_id = 'receipts'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_update_own" on storage.objects;
create policy "receipts_update_own" on storage.objects
  for update to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = (select auth.uid())::text)
  with check (bucket_id = 'receipts'
              and (storage.foldername(name))[1] = (select auth.uid())::text);

drop policy if exists "receipts_delete_own" on storage.objects;
create policy "receipts_delete_own" on storage.objects
  for delete to authenticated
  using (bucket_id = 'receipts'
         and (storage.foldername(name))[1] = (select auth.uid())::text);
