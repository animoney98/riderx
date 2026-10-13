-- RiderX does not take people who already hold a Zomato delivery partner account.
-- The database itself refuses to add such a lead as a rider.
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
  if l.has_zomato_account is true then raise exception 'Rejected: this person already holds a Zomato delivery partner account'; end if;
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
