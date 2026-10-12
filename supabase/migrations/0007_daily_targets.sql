-- Zomato daily target tiers (RiderX revenue only) and a private place for the target pictures.
create table zomato_daily_targets (
  id uuid primary key default gen_random_uuid(),
  target_date date not null unique,
  base_rate_paise bigint not null check (base_rate_paise > 0),
  batch_bonus_paise bigint not null default 3000 check (batch_bonus_paise >= 0),
  tiers jsonb not null,                    -- [{"minOrders":50,"ratePaise":7000}, ...]
  picture_path text,
  notes text,
  created_by uuid references profiles(id),
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
alter table zomato_daily_targets enable row level security;
create policy daily_targets_read on zomato_daily_targets for select using (has_role('super_admin','finance_manager','operations_manager','viewer'));
create policy daily_targets_write on zomato_daily_targets for all
  using (has_role('super_admin','finance_manager','operations_manager')) with check (has_role('super_admin','finance_manager','operations_manager'));

insert into storage.buckets (id, name, public) values ('target-pictures', 'target-pictures', false) on conflict (id) do nothing;
create policy target_pictures_read on storage.objects for select to authenticated
  using (bucket_id = 'target-pictures' and has_role('super_admin','finance_manager','operations_manager','viewer'));
create policy target_pictures_insert on storage.objects for insert to authenticated
  with check (bucket_id = 'target-pictures' and has_role('super_admin','finance_manager','operations_manager'));
