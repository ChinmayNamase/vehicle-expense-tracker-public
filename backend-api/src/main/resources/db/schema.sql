-- =====================================================================
-- Vehicle Expense Tracker: OWN DATABASE (H2, stored in backend-api/data/)
-- Runs on every start; "if not exists" keeps existing data.
-- Same tables and rules as the original PostgreSQL design (sql/schema.sql),
-- plus our own login tables (auth.users with password hashes, auth.sessions).
-- =====================================================================

create schema if not exists auth;

-- Login accounts. Passwords are stored ONLY as BCrypt hashes.
create table if not exists auth.users (
  id               uuid default random_uuid() primary key,
  email            varchar(255) not null unique,
  full_name        varchar(120),
  password_hash    varchar(100),
  created_at       timestamp with time zone not null default current_timestamp,
  last_sign_in_at  timestamp with time zone
);

-- Login sessions. The browser keeps a random token; only its SHA-256 hash is stored.
create table if not exists auth.sessions (
  token_hash  varchar(64) primary key,
  user_id     uuid not null references auth.users (id) on delete cascade,
  created_at  timestamp with time zone not null default current_timestamp,
  expires_at  timestamp with time zone not null
);

create table if not exists public.vehicles (
  id                        uuid default random_uuid() primary key,
  user_id                   uuid not null references auth.users (id) on delete cascade,
  vehicle_type              varchar(10) not null check (vehicle_type in ('Bike', 'Car')),
  make                      varchar(60) not null,
  model                     varchar(60) not null,
  registration_number       varchar(20) not null,
  chassis_number            varchar(40),
  engine_number             varchar(40),
  manufacturing_month_year  varchar(7),
  registration_date         date,
  registration_valid_until  date,
  purchase_date             date,
  purchase_price            numeric(12, 2) check (purchase_price is null or purchase_price >= 0),
  current_odometer          numeric(10, 1) not null default 0 check (current_odometer >= 0),
  fuel_type                 varchar(20) not null default 'Petrol'
                              check (fuel_type in ('Petrol', 'Diesel', 'CNG', 'Electric', 'Hybrid', 'LPG')),
  tank_capacity             numeric(6, 2) check (tank_capacity is null or tank_capacity > 0),
  notes                     varchar(1000),
  created_at                timestamp with time zone not null default current_timestamp,
  updated_at                timestamp with time zone not null default current_timestamp,
  constraint vehicles_id_user_unique unique (id, user_id)
);

create table if not exists public.expenses (
  id            uuid default random_uuid() primary key,
  user_id       uuid not null,
  vehicle_id    uuid not null,
  expense_date  date not null,
  description   varchar(120) not null,
  amount        numeric(12, 2) not null check (amount >= 0),
  category      varchar(30) not null check (category in ('Bike/Car Purchase', 'Petrol', 'Servicing', 'Spare Parts',
                  'Insurance', 'Repairs', 'Accessories', 'Parking and Tolls', 'Other')),
  source        varchar(20) not null default 'manual' check (source in ('manual', 'fuel', 'maintenance', 'insurance')),
  notes         varchar(1000),
  receipt_url   varchar(300),
  created_at    timestamp with time zone not null default current_timestamp,
  updated_at    timestamp with time zone not null default current_timestamp,
  -- a record can only point at a vehicle owned by the SAME user
  constraint expenses_vehicle_owner_fk foreign key (vehicle_id, user_id)
    references public.vehicles (id, user_id) on delete cascade,
  -- Petrol rows must come from the Fuel Tracker
  constraint expenses_petrol_from_fuel_logs check (category <> 'Petrol' or source = 'fuel')
);

create table if not exists public.fuel_logs (
  id                uuid default random_uuid() primary key,
  user_id           uuid not null,
  vehicle_id        uuid not null,
  expense_id        uuid unique references public.expenses (id) on delete cascade,
  fuel_date         date not null,
  description       varchar(120) not null default 'Petrol',
  fuel_station      varchar(60),
  amount_paid       numeric(10, 2) not null check (amount_paid > 0),
  price_per_litre   numeric(8, 2) not null check (price_per_litre > 0),
  litres            numeric(8, 3) not null check (litres > 0),
  litres_is_manual  boolean not null default false,
  odometer_reading  numeric(10, 1) check (odometer_reading is null or odometer_reading >= 0),
  is_full_tank      boolean not null default false,
  notes             varchar(1000),
  created_at        timestamp with time zone not null default current_timestamp,
  updated_at        timestamp with time zone not null default current_timestamp,
  constraint fuel_logs_vehicle_owner_fk foreign key (vehicle_id, user_id)
    references public.vehicles (id, user_id) on delete cascade
);

create table if not exists public.maintenance_records (
  id                     uuid default random_uuid() primary key,
  user_id                uuid not null,
  vehicle_id             uuid not null,
  expense_id             uuid unique references public.expenses (id) on delete cascade,
  service_date           date not null,
  description            varchar(120) not null,
  service_centre         varchar(80),
  cost                   numeric(12, 2) not null default 0 check (cost >= 0),
  odometer_reading       numeric(10, 1) check (odometer_reading is null or odometer_reading >= 0),
  next_service_date      date,
  next_service_odometer  numeric(10, 1),
  notes                  varchar(1000),
  created_at             timestamp with time zone not null default current_timestamp,
  updated_at             timestamp with time zone not null default current_timestamp,
  constraint maintenance_vehicle_owner_fk foreign key (vehicle_id, user_id)
    references public.vehicles (id, user_id) on delete cascade
);

create table if not exists public.insurance_records (
  id                 uuid default random_uuid() primary key,
  user_id            uuid not null,
  vehicle_id         uuid not null,
  expense_id         uuid unique references public.expenses (id) on delete cascade,
  provider           varchar(80) not null,
  policy_number      varchar(60),
  policy_start_date  date not null,
  expiry_date        date not null,
  premium_amount     numeric(12, 2) not null check (premium_amount >= 0),
  notes              varchar(1000),
  created_at         timestamp with time zone not null default current_timestamp,
  updated_at         timestamp with time zone not null default current_timestamp,
  constraint insurance_dates_check check (expiry_date > policy_start_date),
  constraint insurance_vehicle_owner_fk foreign key (vehicle_id, user_id)
    references public.vehicles (id, user_id) on delete cascade
);

create index if not exists expenses_user_date_idx on public.expenses (user_id, expense_date);
create index if not exists fuel_logs_vehicle_date_idx on public.fuel_logs (vehicle_id, fuel_date);
create index if not exists sessions_user_idx on auth.sessions (user_id);
