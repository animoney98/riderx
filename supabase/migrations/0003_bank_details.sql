-- Rider bank details (restricted to super_admin / finance_manager by the existing policy on this table)
-- and a small settings table for the company debit account used in the bank file.
alter table rider_payment_details
  add column if not exists bank_account_number text,
  add column if not exists bank_ifsc text,
  add column if not exists bank_name text,
  add column if not exists updated_by uuid references profiles(id),
  add column if not exists source text not null default 'admin' check (source in ('admin', 'rider'));

alter table rider_payment_details
  add constraint bank_account_format check (bank_account_number is null or bank_account_number ~ '^[0-9]{6,20}$'),
  add constraint bank_ifsc_format check (bank_ifsc is null or bank_ifsc ~ '^[A-Z]{4}0[A-Z0-9]{6}$');

create table if not exists app_settings (
  key text primary key,
  value text not null,
  updated_by uuid references profiles(id),
  updated_at timestamptz not null default now()
);
alter table app_settings enable row level security;
create policy app_settings_read on app_settings for select using (has_role('super_admin','finance_manager'));
create policy app_settings_write on app_settings for all
  using (has_role('super_admin','finance_manager')) with check (has_role('super_admin','finance_manager'));
