-- Money received from Zomato for a Monday-Sunday week. Append-only, like the other ledgers.
create table zomato_receipts (
  id uuid primary key default gen_random_uuid(),
  period_start date not null check (extract(isodow from period_start) = 1),
  amount_paise bigint not null check (amount_paise <> 0),   -- a correction is a negative row
  received_on date not null,
  reference text,
  notes text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create unique index zomato_receipts_ref_unique on zomato_receipts (reference) where reference is not null;
create trigger zomato_receipts_append_only before update or delete on zomato_receipts
  for each row execute function block_ledger_change();
alter table zomato_receipts enable row level security;
create policy zomato_receipts_read on zomato_receipts for select using (has_role('super_admin','finance_manager','operations_manager','viewer'));
create policy zomato_receipts_insert on zomato_receipts for insert with check (has_role('super_admin','finance_manager'));
