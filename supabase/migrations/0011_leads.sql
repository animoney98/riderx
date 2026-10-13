-- Rider leads from the Google "RiderX Job Enquiry Form". Personal details, so only admins and operations managers can see them.
create table leads (
  id uuid primary key default gen_random_uuid(),
  source text not null default 'google_form',
  source_key text not null unique,                 -- one form response can never be saved twice
  submitted_at timestamptz not null default now(),
  full_name text not null,
  email text,
  phone text not null,
  phone10 text not null check (phone10 ~ '^[6-9][0-9]{9}$'),
  date_of_birth date,
  vehicle_type text,
  has_license_insurance boolean,
  work_type text,
  prior_experience boolean,
  prior_platforms text[] not null default '{}',
  has_zomato_account boolean,
  start_when text,
  wants_onboarding boolean,
  status text not null default 'new' check (status in ('new', 'contacted', 'onboarded', 'dropped')),
  urgent_manual boolean not null default false,
  notes text,
  rider_id uuid references riders(id),
  raw_answers jsonb,                               -- the form row exactly as received
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  check ((status = 'onboarded') = (rider_id is not null))
);
create index on leads (status);
create index on leads (phone10);
create index on leads (submitted_at desc);

alter table leads enable row level security;
create policy leads_read on leads for select using (has_role('super_admin', 'operations_manager'));
-- Staff may change status (not to onboarded: that goes through onboard_lead), the urgent flag and notes.
create policy leads_update on leads for update
  using (has_role('super_admin', 'operations_manager') and status <> 'onboarded')
  with check (has_role('super_admin', 'operations_manager') and status in ('new', 'contacted', 'dropped') and rider_id is null);
-- New leads arrive through the webhook using the server key, which bypasses these policies.

create or replace function leads_touch() returns trigger language plpgsql as $$
begin new.updated_at := now(); return new; end $$;
create trigger leads_touch before update on leads for each row execute function leads_touch();

-- Adds a lead to the rider list with their Zomato FE ID, in one atomic step: either everything is saved or nothing is.
create or replace function onboard_lead(p_lead uuid, p_fe text)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  l leads%rowtype;
  v_fe text := upper(trim(coalesce(p_fe, '')));
  v_rider uuid;
  v_dup text;
begin
  if not has_role('super_admin', 'operations_manager') then raise exception 'Only admins and operations managers can add riders'; end if;
  select * into l from leads where id = p_lead for update;
  if not found then raise exception 'Lead not found'; end if;
  if l.status = 'onboarded' then raise exception 'This lead is already a rider'; end if;
  if v_fe !~ '^FE[0-9]+$' then raise exception 'FE ID must look like FE12345678'; end if;
  if exists (select 1 from rider_platform_accounts where platform = 'zomato' and platform_rider_id = v_fe) then raise exception 'That FE ID is already registered'; end if;
  select full_name into v_dup from riders where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = l.phone10 limit 1;
  if v_dup is not null then raise exception 'A rider with this phone number already exists (%)', v_dup; end if;

  insert into riders (full_name, phone, email, status, onboarding_date)
  values (l.full_name, l.phone, l.email, 'active', (now() at time zone 'Asia/Kolkata')::date)
  returning id into v_rider;
  insert into rider_platform_accounts (rider_id, platform, platform_rider_id) values (v_rider, 'zomato', v_fe);
  update leads set status = 'onboarded', rider_id = v_rider where id = l.id;
  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'lead.onboard', 'lead', l.id::text, jsonb_build_object('rider_id', v_rider, 'fe', v_fe, 'name', l.full_name));
  return v_rider;
end $$;

revoke all on function onboard_lead(uuid, text) from public;
grant execute on function onboard_lead(uuid, text) to authenticated;
