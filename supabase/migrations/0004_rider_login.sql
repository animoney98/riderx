-- Rider self-service: a rider signs in with a phone OTP and can see/enter only his own bank details.
alter table riders add column if not exists user_id uuid unique references auth.users(id);
alter table rider_payment_details
  add column if not exists verified_at timestamptz,
  add column if not exists verified_by uuid references profiles(id);

-- Existing admin-entered details count as checked.
update rider_payment_details set verified_at = coalesce(verified_at, updated_at) where source = 'admin' and bank_account_number is not null;

-- Links the signed-in phone to the rider with the same phone number. The OTP proves he owns the phone.
-- Refuses when no rider or more than one rider has that number.
create or replace function claim_rider_profile() returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_phone text;
  v_rider uuid;
  v_count int;
begin
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) into v_phone from auth.users where id = auth.uid();
  if v_phone is null or length(v_phone) < 10 then return null; end if;
  select id into v_rider from riders where user_id = auth.uid();
  if v_rider is not null then return v_rider; end if;
  select count(*), min(id::text)::uuid into v_count, v_rider from riders
    where user_id is null and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone;
  if v_count <> 1 then return null; end if;
  update riders set user_id = auth.uid() where id = v_rider;
  insert into audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'rider.login_linked', 'rider', v_rider::text);
  return v_rider;
end $$;
revoke all on function claim_rider_profile() from public;
grant execute on function claim_rider_profile() to authenticated;

-- A rider reads his own row and his own bank details, and may write them only as unverified rider-entered data.
create policy riders_self_read on riders for select using (user_id = auth.uid());
create policy payment_self_read on rider_payment_details for select
  using (rider_id in (select id from riders where user_id = auth.uid()));
create policy payment_self_insert on rider_payment_details for insert
  with check (rider_id in (select id from riders where user_id = auth.uid()) and source = 'rider' and verified_at is null and verified_by is null);
create policy payment_self_update on rider_payment_details for update
  using (rider_id in (select id from riders where user_id = auth.uid()))
  with check (rider_id in (select id from riders where user_id = auth.uid()) and source = 'rider' and verified_at is null and verified_by is null);
