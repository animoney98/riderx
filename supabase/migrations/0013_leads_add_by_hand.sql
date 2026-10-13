-- Adds a person by hand from the Leads page.
--  * With an FE ID: they become a rider straight away (rider + Zomato FE ID + a lead record marked "onboarded" so the history stays in one place).
--  * Without an FE ID: they are saved as a normal lead to follow up later.
-- Everything is saved in one step or not at all. Same duplicate rules as onboard_lead.
create or replace function add_person_by_hand(
  p_name text, p_phone text, p_fe text, p_vehicle text, p_email text, p_notes text, p_urgent boolean default false
) returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_name text := btrim(coalesce(p_name, ''));
  v_digits text := regexp_replace(coalesce(p_phone, ''), '\D', '', 'g');
  v_p10 text := right(regexp_replace(coalesce(p_phone, ''), '\D', '', 'g'), 10);
  v_fe text := upper(btrim(coalesce(p_fe, '')));
  v_vehicle text := nullif(btrim(coalesce(p_vehicle, '')), '');
  v_email text := nullif(btrim(coalesce(p_email, '')), '');
  v_notes text := nullif(left(btrim(coalesce(p_notes, '')), 1000), '');
  v_dup text; v_rider uuid; v_lead uuid;
begin
  if not has_role('super_admin', 'operations_manager') then raise exception 'Only admins and operations managers can add people'; end if;
  if length(v_name) < 2 then raise exception 'Please enter the name'; end if;
  if length(v_digits) < 10 or v_p10 !~ '^[6-9][0-9]{9}$' then raise exception 'Phone number must be a valid 10-digit Indian mobile number'; end if;
  if v_vehicle is not null and v_vehicle not in ('EV 2 Wheeler', 'Scooter', 'Motorcycle', 'None') then raise exception 'Choose a vehicle from the list'; end if;
  if v_fe <> '' and v_fe !~ '^FE[0-9]+$' then raise exception 'FE ID must look like FE12345678'; end if;

  select full_name into v_dup from riders where right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_p10 limit 1;
  if v_dup is not null then raise exception 'A rider with this phone number already exists (%)', v_dup; end if;
  if exists (select 1 from leads where phone10 = v_p10 and status <> 'dropped') then raise exception 'This phone number is already in your leads'; end if;

  if v_fe = '' then
    insert into leads (source, source_key, full_name, email, phone, phone10, vehicle_type, status, urgent_manual, notes)
    values ('manual', 'manual:' || gen_random_uuid(), v_name, v_email, v_p10, v_p10, v_vehicle, 'new', coalesce(p_urgent, false), v_notes)
    returning id into v_lead;
    insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
    values (auth.uid(), 'lead.add_manual', 'lead', v_lead::text, jsonb_build_object('name', v_name));
    return v_lead;
  end if;

  if exists (select 1 from rider_platform_accounts where platform = 'zomato' and platform_rider_id = v_fe) then raise exception 'That FE ID is already registered'; end if;
  insert into riders (full_name, phone, email, notes, status, onboarding_date)
  values (v_name, v_p10, v_email, v_notes, 'active', (now() at time zone 'Asia/Kolkata')::date)
  returning id into v_rider;
  insert into rider_platform_accounts (rider_id, platform, platform_rider_id) values (v_rider, 'zomato', v_fe);
  insert into leads (source, source_key, full_name, email, phone, phone10, vehicle_type, status, rider_id, notes)
  values ('manual', 'manual:' || gen_random_uuid(), v_name, v_email, v_p10, v_p10, v_vehicle, 'onboarded', v_rider, v_notes)
  returning id into v_lead;
  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'lead.add_manual_rider', 'lead', v_lead::text, jsonb_build_object('rider_id', v_rider, 'fe', v_fe, 'name', v_name));
  return v_lead;
end $$;

revoke all on function add_person_by_hand(text, text, text, text, text, text, boolean) from public;
grant execute on function add_person_by_hand(text, text, text, text, text, text, boolean) to authenticated;
