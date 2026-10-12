-- RiderX core schema, phase 1-4 (riders, imports, trips, earnings, payroll, payments, adjustments, audit).
-- Money is stored as integer paise (bigint). Distances as integer hundredths of a km.
-- Settlements, receipts, revenue and expense tables come in a later migration.

create extension if not exists pgcrypto;

-- ---------- Identity & roles ----------
create type app_role as enum ('super_admin', 'operations_manager', 'finance_manager', 'viewer');

create table profiles (
  id uuid primary key references auth.users(id) on delete restrict,
  full_name text not null,
  email text not null unique,
  role app_role not null default 'viewer',
  active boolean not null default true,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create or replace function current_role_name() returns app_role
language sql stable security definer set search_path = public as
$$ select role from profiles where id = auth.uid() and active $$;

create or replace function has_role(variadic roles app_role[]) returns boolean
language sql stable security definer set search_path = public as
$$ select coalesce(current_role_name() = any(roles), false) $$;

-- ---------- Riders ----------
create type rider_status as enum ('onboarding', 'active', 'temporarily_inactive', 'suspended', 'deactivated');

create table riders (
  id uuid primary key default gen_random_uuid(),
  full_name text not null,
  phone text,
  email text,
  onboarding_date date,
  status rider_status not null default 'onboarding',
  manager_id uuid references profiles(id),
  notes text,
  deactivated_on date,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

-- Restricted payment details live in their own table so they can have stricter access.
create table rider_payment_details (
  rider_id uuid primary key references riders(id) on delete restrict,
  upi_id text,
  bank_account_holder text,
  updated_at timestamptz not null default now()
);

create table rider_platform_accounts (
  id uuid primary key default gen_random_uuid(),
  rider_id uuid not null references riders(id) on delete restrict,
  platform text not null default 'zomato',
  platform_rider_id text not null,           -- the FE ID
  account_status text not null default 'active',
  created_at timestamptz not null default now(),
  unique (platform, platform_rider_id)
);
create index on rider_platform_accounts (rider_id);

-- ---------- Imports ----------
create type import_type as enum ('zomato_trips', 'zomato_daily_summary', 'zomato_settlement', 'penalties', 'other');
create type import_status as enum ('previewed', 'imported', 'failed', 'rolled_back');

create table import_batches (
  id uuid primary key default gen_random_uuid(),
  filename text not null,
  file_checksum text not null,               -- sha-256 of the uploaded file
  import_type import_type not null,
  source_period_start date,
  source_period_end date,
  imported_by uuid references profiles(id),
  imported_at timestamptz not null default now(),
  status import_status not null default 'previewed',
  total_rows int not null default 0,
  inserted_rows int not null default 0,
  updated_rows int not null default 0,
  skipped_rows int not null default 0,
  error_count int not null default 0
);
-- The same file can be uploaded again only as a deliberate re-import.
create index on import_batches (file_checksum);

create table import_row_errors (
  id uuid primary key default gen_random_uuid(),
  import_batch_id uuid not null references import_batches(id) on delete cascade,
  row_number int not null,
  source_data jsonb,
  error_code text not null,
  error_message text not null,
  resolution_status text not null default 'open'
);

-- ---------- Rate cards (versioned) ----------
create table rate_cards (
  id uuid primary key default gen_random_uuid(),
  name text not null,
  version int not null,
  effective_start date not null,
  effective_end date,
  status text not null default 'draft' check (status in ('draft', 'active', 'retired')),
  configuration jsonb not null,              -- shape of RateCard in src/engine/payout.ts
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  unique (name, version),
  check (effective_end is null or effective_end >= effective_start)
);

-- ---------- Trips (one row per Zomato trip) ----------
create table trips (
  id uuid primary key default gen_random_uuid(),
  platform text not null default 'zomato',
  source_trip_id text not null,
  rider_platform_account_id uuid references rider_platform_accounts(id),
  fe_id text not null,                       -- kept even if the rider is not matched yet
  operational_date date not null,            -- IST date of delivered_at (midnight rule)
  delivered_at timestamp not null,           -- local IST wall time, as in the source
  orders_in_trip smallint not null check (orders_in_trip in (1, 2)),
  is_raining boolean not null default false,
  pickup_km100 int not null check (pickup_km100 >= 0),
  drop_km100 int not null check (drop_km100 >= 0),
  zomato_pay_paise bigint not null,          -- RiderX revenue side, never rider pay
  zomato_dc_paise bigint not null default 0, -- meaning unconfirmed
  tip_paise bigint not null default 0,       -- informational; paid by Zomato to rider directly
  zomato_distance_paise bigint not null default 0,
  source_import_batch_id uuid not null references import_batches(id),
  source_row jsonb,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (platform, source_trip_id)          -- repeated uploads cannot duplicate a trip
);
create index on trips (rider_platform_account_id, operational_date);
create index on trips (operational_date);

create table trip_earnings (
  id uuid primary key default gen_random_uuid(),
  trip_id uuid not null references trips(id) on delete restrict,
  rate_card_id uuid not null references rate_cards(id),
  first_rank int not null,
  last_rank int not null,
  base_paise bigint not null,
  extra_km100 int not null,
  distance_paise bigint not null,
  batch_bonus_paise bigint not null,
  rain_paise bigint not null,
  festival_paise bigint not null,
  total_paise bigint not null,
  calculation_version int not null default 1,
  calculated_at timestamptz not null default now(),
  superseded_at timestamptz,                 -- recalculation never overwrites; it supersedes
  check (total_paise = base_paise + distance_paise + batch_bonus_paise + rain_paise + festival_paise)
);
create unique index trip_earnings_one_current on trip_earnings (trip_id) where superseded_at is null;

-- ---------- Payroll ----------
create type payout_cycle_status as enum ('draft', 'needs_review', 'ready_for_approval', 'approved', 'payment_in_progress', 'paid', 'on_hold');

create table payout_cycles (
  id uuid primary key default gen_random_uuid(),
  period_start date not null unique,
  period_end date not null,
  scheduled_payment_date date not null,
  status payout_cycle_status not null default 'draft',
  approved_by uuid references profiles(id),
  approved_at timestamptz,
  finalized_at timestamptz,
  check (extract(isodow from period_start) = 1),
  check (period_end = period_start + 6),
  check (scheduled_payment_date = period_start + 11),
  check (approved_by is null or approved_at is not null)
);

create table rider_payouts (
  id uuid primary key default gen_random_uuid(),
  payout_cycle_id uuid not null references payout_cycles(id),
  rider_id uuid not null references riders(id),
  earnings_snapshot jsonb,                   -- frozen on approval, includes rate card used
  gross_paise bigint not null default 0,
  additions_paise bigint not null default 0,
  deductions_paise bigint not null default 0,  -- penalties etc., stored positive
  net_payable_paise bigint not null default 0, -- may be negative; carried forward by policy
  status text not null default 'draft',
  approved_at timestamptz,
  created_at timestamptz not null default now(),
  unique (payout_cycle_id, rider_id),
  check (net_payable_paise = gross_paise + additions_paise - deductions_paise)
);

-- Payment ledger: append-only. Reversals are new negative rows pointing at the original.
create table rider_payments (
  id uuid primary key default gen_random_uuid(),
  rider_payout_id uuid not null references rider_payouts(id),
  rider_id uuid not null references riders(id),
  amount_paise bigint not null check (amount_paise <> 0),
  payment_date date not null,
  payment_method text not null,
  transaction_reference text,
  status text not null default 'confirmed' check (status in ('initiated', 'confirmed', 'reversed')),
  reverses_payment_id uuid references rider_payments(id),
  recorded_by uuid references profiles(id),
  notes text,
  created_at timestamptz not null default now()
);
create unique index rider_payments_ref_unique on rider_payments (transaction_reference) where transaction_reference is not null;

-- ---------- Adjustments (penalties, corrections), signed, never edited in place ----------
create table adjustments (
  id uuid primary key default gen_random_uuid(),
  adjustment_type text not null,             -- e.g. penalty, correction, addition
  rider_id uuid not null references riders(id),
  effective_cycle_id uuid references payout_cycles(id),
  trip_id uuid references trips(id),
  amount_paise bigint not null,              -- negative reduces pay
  reason_code text not null,
  description text,
  evidence_reference text,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  source_import_batch_id uuid references import_batches(id),
  created_by uuid references profiles(id),
  approved_by uuid references profiles(id),
  created_at timestamptz not null default now(),
  approved_at timestamptz,
  check (approved_by is null or approved_by <> created_by)  -- no self-approval
);

-- ---------- Audit ----------
create table audit_logs (
  id bigint generated always as identity primary key,
  actor_id uuid,
  action text not null,
  entity_type text not null,
  entity_id text,
  before_values jsonb,
  after_values jsonb,
  reason text,
  created_at timestamptz not null default now()
);

-- Approved payroll is immutable: block edits to a rider payout once its cycle is approved.
create or replace function block_approved_payout_edit() returns trigger
language plpgsql as $$
begin
  if exists (select 1 from payout_cycles c where c.id = old.payout_cycle_id and c.status in ('approved','payment_in_progress','paid'))
     and (new.gross_paise, new.additions_paise, new.deductions_paise, new.earnings_snapshot)
         is distinct from (old.gross_paise, old.additions_paise, old.deductions_paise, old.earnings_snapshot) then
    raise exception 'Payroll cycle is approved; use an adjustment instead of editing figures';
  end if;
  return new;
end $$;
create trigger rider_payouts_frozen before update on rider_payouts
  for each row execute function block_approved_payout_edit();

-- Payments cannot be updated or deleted; only reversed by a new row.
create or replace function block_ledger_change() returns trigger
language plpgsql as $$ begin raise exception 'Ledger rows cannot be changed or deleted; add a reversal'; end $$;
create trigger rider_payments_append_only before update or delete on rider_payments
  for each row execute function block_ledger_change();
create trigger audit_logs_append_only before update or delete on audit_logs
  for each row execute function block_ledger_change();

-- ---------- Row Level Security: deny by default ----------
do $$
declare t text;
begin
  foreach t in array array['profiles','riders','rider_payment_details','rider_platform_accounts','import_batches','import_row_errors',
    'rate_cards','trips','trip_earnings','payout_cycles','rider_payouts','rider_payments','adjustments','audit_logs']
  loop execute format('alter table %I enable row level security', t); end loop;
end $$;

-- Read access: any active staff role.
do $$
declare t text;
begin
  foreach t in array array['riders','rider_platform_accounts','import_batches','import_row_errors','rate_cards','trips','trip_earnings','payout_cycles','rider_payouts','rider_payments','adjustments']
  loop execute format($f$create policy %I on %I for select using (has_role('super_admin','operations_manager','finance_manager','viewer'))$f$, t || '_read', t); end loop;
end $$;

create policy profiles_read_self on profiles for select using (id = auth.uid() or has_role('super_admin'));
create policy profiles_admin_write on profiles for all using (has_role('super_admin')) with check (has_role('super_admin'));
create policy payment_details_finance on rider_payment_details for all
  using (has_role('super_admin','finance_manager')) with check (has_role('super_admin','finance_manager'));
create policy audit_read on audit_logs for select using (has_role('super_admin'));

-- Write access by role. Payroll figures and approvals are written by server code
-- using the service role; these policies cover what the dashboard may do directly.
create policy riders_write on riders for all
  using (has_role('super_admin','operations_manager')) with check (has_role('super_admin','operations_manager'));
create policy accounts_write on rider_platform_accounts for all
  using (has_role('super_admin','operations_manager')) with check (has_role('super_admin','operations_manager'));
create policy rate_cards_write on rate_cards for all
  using (has_role('super_admin')) with check (has_role('super_admin'));
create policy payments_insert on rider_payments for insert
  with check (has_role('super_admin','finance_manager'));
create policy adjustments_insert on adjustments for insert
  with check (has_role('super_admin','finance_manager','operations_manager'));
