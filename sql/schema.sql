-- =====================================================================
-- Vehicle Expense Tracker — database schema (Supabase PostgreSQL)
-- Run this file FIRST in the Supabase SQL Editor, then run policies.sql.
--
-- Design summary
--   vehicles            one row per bike/car owned by a user
--   expenses            THE money ledger. Every rupee spent is one row here.
--   fuel_logs           fuel-specific details (price/L, litres, odometer)
--   maintenance_records service details (next service date/odometer)
--   insurance_records   policy details (provider, expiry)
--
-- Single source of truth for money:
--   A fuel log, maintenance record or insurance record automatically
--   creates/updates/deletes ONE linked row in `expenses` (via triggers).
--   Totals are always calculated from `expenses` only, so a petrol purchase
--   is never counted twice. Fuel statistics (litres, km/L) come from fuel_logs.
-- =====================================================================

-- gen_random_uuid() is built into PostgreSQL 13+ (Supabase uses 15+), no extension needed.

-- ---------------------------------------------------------------------
-- Generic helper: keep updated_at current on every UPDATE
-- ---------------------------------------------------------------------
create or replace function public.set_updated_at()
returns trigger
language plpgsql
as $$
begin
  new.updated_at := now();
  return new;
end;
$$;

-- ---------------------------------------------------------------------
-- vehicles
-- ---------------------------------------------------------------------
create table if not exists public.vehicles (
  id                        uuid primary key default gen_random_uuid(),
  user_id                   uuid not null default auth.uid()
                              references auth.users (id) on delete cascade,
  vehicle_type              text not null check (vehicle_type in ('Bike', 'Car')),
  make                      text not null check (char_length(btrim(make)) between 1 and 60),
  model                     text not null check (char_length(btrim(model)) between 1 and 60),
  registration_number       text not null check (char_length(btrim(registration_number)) between 1 and 20),
  chassis_number            text check (chassis_number is null or char_length(chassis_number) <= 40),
  engine_number             text check (engine_number is null or char_length(engine_number) <= 40),
  -- stored as 'YYYY-MM' (the value produced by <input type="month">)
  manufacturing_month_year  text check (manufacturing_month_year is null
                                        or manufacturing_month_year ~ '^[0-9]{4}-(0[1-9]|1[0-2])$'),
  registration_date         date,
  registration_valid_until  date,
  purchase_date             date,
  purchase_price            numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  current_odometer          numeric(10, 1) not null default 0 check (current_odometer >= 0),
  fuel_type                 text not null default 'Petrol'
                              check (fuel_type in ('Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG')),
  tank_capacity             numeric(6, 2) check (tank_capacity is null or tank_capacity > 0),
  notes                     text check (notes is null or char_length(notes) <= 1000),
  created_at                timestamptz not null default now(),
  updated_at                timestamptz not null default now(),
  constraint vehicles_registration_validity_check
    check (registration_valid_until is null or registration_date is null
           or registration_valid_until >= registration_date),
  -- (id, user_id) is referenced by child tables so a child row can only
  -- point at a vehicle owned by the SAME user (ownership enforced by the DB).
  constraint vehicles_id_user_unique unique (id, user_id)
);

-- One registration number per user (case-insensitive)
create unique index if not exists vehicles_user_registration_idx
  on public.vehicles (user_id, upper(registration_number));
create index if not exists vehicles_user_idx on public.vehicles (user_id);

drop trigger if exists vehicles_set_updated_at on public.vehicles;
create trigger vehicles_set_updated_at
  before update on public.vehicles
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- expenses (the money ledger)
-- ---------------------------------------------------------------------
create table if not exists public.expenses (
  id            uuid primary key default gen_random_uuid(),
  user_id       uuid not null default auth.uid()
                  references auth.users (id) on delete cascade,
  vehicle_id    uuid not null,
  expense_date  date not null,
  description   text not null check (char_length(btrim(description)) between 1 and 120),
  amount        numeric(12, 2) not null check (amount >= 0),
  category      text not null check (category in (
                  'Bike/Car Purchase', 'Petrol', 'Servicing', 'Spare Parts', 'Insurance',
                  'Repairs', 'Accessories', 'Parking and Tolls', 'Other')),
  -- where the row came from: typed directly, or created by a linked module
  source        text not null default 'manual'
                  check (source in ('manual', 'fuel', 'maintenance', 'insurance')),
  notes         text check (notes is null or char_length(notes) <= 1000),
  -- path inside the private 'receipts' storage bucket (NOT a public URL)
  receipt_url   text check (receipt_url is null or char_length(receipt_url) <= 300),
  created_at    timestamptz not null default now(),
  updated_at    timestamptz not null default now(),
  constraint expenses_vehicle_owner_fk
    foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade,
  constraint expenses_id_user_unique unique (id, user_id),
  -- Petrol rows must come from the Fuel Tracker so litres/odometer are never missing
  constraint expenses_petrol_from_fuel_logs check (category <> 'Petrol' or source = 'fuel')
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, expense_date desc);
create index if not exists expenses_vehicle_date_idx on public.expenses (vehicle_id, expense_date desc);
create index if not exists expenses_category_idx on public.expenses (user_id, category);

drop trigger if exists expenses_set_updated_at on public.expenses;
create trigger expenses_set_updated_at
  before update on public.expenses
  for each row execute function public.set_updated_at();

-- Linked expense rows (source <> 'manual') may only be written by the
-- module triggers below, never directly by the app. pg_trigger_depth() = 1
-- means "this statement came straight from the client".
create or replace function public.guard_linked_expenses()
returns trigger
language plpgsql
as $$
begin
  if pg_trigger_depth() = 1 then
    if tg_op = 'INSERT' and new.source <> 'manual' then
      raise exception 'Linked expenses are created automatically. Use the Fuel, Maintenance or Insurance form.';
    end if;
    if tg_op = 'UPDATE' and (old.source <> 'manual' or new.source <> 'manual') then
      raise exception 'This expense is linked to a % record. Edit it from that module.', old.source;
    end if;
  end if;
  return new;
end;
$$;

drop trigger if exists expenses_guard_linked on public.expenses;
create trigger expenses_guard_linked
  before insert or update on public.expenses
  for each row execute function public.guard_linked_expenses();

-- ---------------------------------------------------------------------
-- fuel_logs
-- ---------------------------------------------------------------------
create table if not exists public.fuel_logs (
  id                uuid primary key default gen_random_uuid(),
  user_id           uuid not null default auth.uid()
                      references auth.users (id) on delete cascade,
  vehicle_id        uuid not null,
  expense_id        uuid unique,
  fuel_date         date not null,
  description       text not null default 'Petrol'
                      check (char_length(btrim(description)) between 1 and 120),
  fuel_station      text check (fuel_station is null or char_length(fuel_station) <= 60),
  amount_paid       numeric(10, 2) not null check (amount_paid > 0),
  price_per_litre   numeric(8, 2) not null check (price_per_litre > 0),
  litres            numeric(8, 3) not null check (litres > 0),
  -- true when litres were typed from the pump receipt instead of amount ÷ price
  litres_is_manual  boolean not null default false,
  -- nullable so old spreadsheet rows without a reading can still be imported
  odometer_reading  numeric(10, 1) check (odometer_reading is null or odometer_reading >= 0),
  is_full_tank      boolean not null default false,
  notes             text check (notes is null or char_length(notes) <= 1000),
  created_at        timestamptz not null default now(),
  updated_at        timestamptz not null default now(),
  constraint fuel_logs_vehicle_owner_fk
    foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade,
  constraint fuel_logs_expense_owner_fk
    foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete cascade
);

create index if not exists fuel_logs_vehicle_date_idx
  on public.fuel_logs (vehicle_id, fuel_date, odometer_reading);
create index if not exists fuel_logs_user_idx on public.fuel_logs (user_id);

drop trigger if exists fuel_logs_set_updated_at on public.fuel_logs;
create trigger fuel_logs_set_updated_at
  before update on public.fuel_logs
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- maintenance_records
-- ---------------------------------------------------------------------
create table if not exists public.maintenance_records (
  id                     uuid primary key default gen_random_uuid(),
  user_id                uuid not null default auth.uid()
                           references auth.users (id) on delete cascade,
  vehicle_id             uuid not null,
  expense_id             uuid unique,
  service_date           date not null,
  description            text not null check (char_length(btrim(description)) between 1 and 120),
  service_centre         text check (service_centre is null or char_length(service_centre) <= 80),
  cost                   numeric(12, 2) not null default 0 check (cost >= 0),
  odometer_reading       numeric(10, 1) check (odometer_reading is null or odometer_reading >= 0),
  next_service_date      date,
  next_service_odometer  numeric(10, 1) check (next_service_odometer is null or next_service_odometer >= 0),
  notes                  text check (notes is null or char_length(notes) <= 1000),
  created_at             timestamptz not null default now(),
  updated_at             timestamptz not null default now(),
  constraint maintenance_next_date_check
    check (next_service_date is null or next_service_date >= service_date),
  constraint maintenance_next_odometer_check
    check (next_service_odometer is null or odometer_reading is null
           or next_service_odometer >= odometer_reading),
  constraint maintenance_vehicle_owner_fk
    foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade,
  constraint maintenance_expense_owner_fk
    foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete cascade
);

create index if not exists maintenance_vehicle_date_idx
  on public.maintenance_records (vehicle_id, service_date desc);
create index if not exists maintenance_user_idx on public.maintenance_records (user_id);

drop trigger if exists maintenance_set_updated_at on public.maintenance_records;
create trigger maintenance_set_updated_at
  before update on public.maintenance_records
  for each row execute function public.set_updated_at();

-- ---------------------------------------------------------------------
-- insurance_records
-- ---------------------------------------------------------------------
create table if not exists public.insurance_records (
  id                 uuid primary key default gen_random_uuid(),
  user_id            uuid not null default auth.uid()
                       references auth.users (id) on delete cascade,
  vehicle_id         uuid not null,
  expense_id         uuid unique,
  provider           text not null check (char_length(btrim(provider)) between 1 and 80),
  policy_number      text check (policy_number is null or char_length(policy_number) <= 60),
  policy_start_date  date not null,
  expiry_date        date not null,
  premium_amount     numeric(12, 2) not null check (premium_amount >= 0),
  notes              text check (notes is null or char_length(notes) <= 1000),
  created_at         timestamptz not null default now(),
  updated_at         timestamptz not null default now(),
  constraint insurance_dates_check check (expiry_date > policy_start_date),
  constraint insurance_vehicle_owner_fk
    foreign key (vehicle_id, user_id) references public.vehicles (id, user_id) on delete cascade,
  constraint insurance_expense_owner_fk
    foreign key (expense_id, user_id) references public.expenses (id, user_id) on delete cascade
);

create index if not exists insurance_vehicle_expiry_idx
  on public.insurance_records (vehicle_id, expiry_date desc);
create index if not exists insurance_user_idx on public.insurance_records (user_id);

drop trigger if exists insurance_set_updated_at on public.insurance_records;
create trigger insurance_set_updated_at
  before update on public.insurance_records
  for each row execute function public.set_updated_at();

-- =====================================================================
-- Linked-expense triggers (keep `expenses` in sync with the modules)
-- These run with the caller's permissions, so RLS still applies.
-- =====================================================================

-- Insert a new linked expense, or update the existing one. Returns its id.
create or replace function public.upsert_linked_expense(
  p_expense_id  uuid,
  p_user_id     uuid,
  p_vehicle_id  uuid,
  p_date        date,
  p_description text,
  p_amount      numeric,
  p_category    text,
  p_source      text,
  p_notes       text
)
returns uuid
language plpgsql
as $$
declare
  v_id uuid := p_expense_id;
begin
  if v_id is not null then
    update public.expenses
       set vehicle_id = p_vehicle_id,
           expense_date = p_date,
           description = left(p_description, 120),
           amount = p_amount,
           notes = p_notes
     where id = v_id;
    if found then
      return v_id;
    end if;
  end if;

  insert into public.expenses (user_id, vehicle_id, expense_date, description, amount, category, source, notes)
  values (p_user_id, p_vehicle_id, p_date, left(p_description, 120), p_amount, p_category, p_source, p_notes)
  returning id into v_id;
  return v_id;
end;
$$;

-- fuel_logs -> expenses (category 'Petrol')
create or replace function public.sync_fuel_expense()
returns trigger
language plpgsql
as $$
begin
  new.expense_id := public.upsert_linked_expense(
    case when tg_op = 'UPDATE' then old.expense_id end,
    new.user_id, new.vehicle_id, new.fuel_date, new.description,
    new.amount_paid, 'Petrol', 'fuel', new.notes);
  return new;
end;
$$;

drop trigger if exists fuel_logs_sync_expense on public.fuel_logs;
create trigger fuel_logs_sync_expense
  before insert or update on public.fuel_logs
  for each row execute function public.sync_fuel_expense();

-- maintenance_records -> expenses (category 'Servicing')
create or replace function public.sync_maintenance_expense()
returns trigger
language plpgsql
as $$
begin
  new.expense_id := public.upsert_linked_expense(
    case when tg_op = 'UPDATE' then old.expense_id end,
    new.user_id, new.vehicle_id, new.service_date,
    new.description || coalesce(' (' || new.service_centre || ')', ''),
    new.cost, 'Servicing', 'maintenance', new.notes);
  return new;
end;
$$;

drop trigger if exists maintenance_sync_expense on public.maintenance_records;
create trigger maintenance_sync_expense
  before insert or update on public.maintenance_records
  for each row execute function public.sync_maintenance_expense();

-- insurance_records -> expenses (category 'Insurance')
create or replace function public.sync_insurance_expense()
returns trigger
language plpgsql
as $$
begin
  new.expense_id := public.upsert_linked_expense(
    case when tg_op = 'UPDATE' then old.expense_id end,
    new.user_id, new.vehicle_id, new.policy_start_date,
    'Insurance premium - ' || new.provider,
    new.premium_amount, 'Insurance', 'insurance', new.notes);
  return new;
end;
$$;

drop trigger if exists insurance_sync_expense on public.insurance_records;
create trigger insurance_sync_expense
  before insert or update on public.insurance_records
  for each row execute function public.sync_insurance_expense();

-- Deleting a module record deletes its linked expense.
-- (Deleting the expense instead cascades to the module record via the FK.)
create or replace function public.delete_linked_expense()
returns trigger
language plpgsql
as $$
begin
  if old.expense_id is not null then
    delete from public.expenses where id = old.expense_id;
  end if;
  return old;
end;
$$;

drop trigger if exists fuel_logs_delete_expense on public.fuel_logs;
create trigger fuel_logs_delete_expense
  after delete on public.fuel_logs
  for each row execute function public.delete_linked_expense();

drop trigger if exists maintenance_delete_expense on public.maintenance_records;
create trigger maintenance_delete_expense
  after delete on public.maintenance_records
  for each row execute function public.delete_linked_expense();

drop trigger if exists insurance_delete_expense on public.insurance_records;
create trigger insurance_delete_expense
  after delete on public.insurance_records
  for each row execute function public.delete_linked_expense();

-- Keep vehicles.current_odometer at the highest reading seen.
-- (Lower readings never reduce it; the user can correct it on the vehicle form.)
create or replace function public.bump_vehicle_odometer()
returns trigger
language plpgsql
as $$
begin
  if new.odometer_reading is not null then
    update public.vehicles
       set current_odometer = new.odometer_reading
     where id = new.vehicle_id
       and current_odometer < new.odometer_reading;
  end if;
  return new;
end;
$$;

drop trigger if exists fuel_logs_bump_odometer on public.fuel_logs;
create trigger fuel_logs_bump_odometer
  after insert or update of odometer_reading, vehicle_id on public.fuel_logs
  for each row execute function public.bump_vehicle_odometer();

drop trigger if exists maintenance_bump_odometer on public.maintenance_records;
create trigger maintenance_bump_odometer
  after insert or update of odometer_reading, vehicle_id on public.maintenance_records
  for each row execute function public.bump_vehicle_odometer();
