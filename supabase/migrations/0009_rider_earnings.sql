-- Riders see their own earnings. Every function below returns ONLY the signed-in rider's rows (riders.user_id = auth.uid()).

-- Fix: a rider who signs in with a PIN has no phone on his login, so check the saved link first.
create or replace function claim_rider_profile() returns uuid
language plpgsql security definer set search_path = public, auth as $$
declare
  v_phone text;
  v_rider uuid;
  v_count int;
begin
  select id into v_rider from riders where user_id = auth.uid();
  if v_rider is not null then return v_rider; end if;
  select right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) into v_phone from auth.users where id = auth.uid();
  if v_phone is null or length(v_phone) < 10 then return null; end if;
  select count(*), min(id::text)::uuid into v_count, v_rider from riders
    where user_id is null and right(regexp_replace(coalesce(phone, ''), '\D', '', 'g'), 10) = v_phone;
  if v_count <> 1 then return null; end if;
  update riders set user_id = auth.uid() where id = v_rider;
  insert into audit_logs (actor_id, action, entity_type, entity_id) values (auth.uid(), 'rider.login_linked', 'rider', v_rider::text);
  return v_rider;
end $$;

create or replace function rider_my_trips(p_from date, p_to date)
returns table (trip_id text, operational_date date, delivered_at timestamp, orders_in_trip smallint, is_raining boolean,
               pickup_km100 int, drop_km100 int, first_rank int, last_rank int, base_paise bigint, extra_km100 int, distance_paise bigint,
               batch_bonus_paise bigint, rain_paise bigint, festival_paise bigint, total_paise bigint, is_final boolean)
language sql stable security definer set search_path = public as $$
  select t.source_trip_id, t.operational_date, t.delivered_at, t.orders_in_trip, t.is_raining, t.pickup_km100, t.drop_km100,
         e.first_rank, e.last_rank, e.base_paise, e.extra_km100, e.distance_paise, e.batch_bonus_paise, e.rain_paise, e.festival_paise, e.total_paise,
         exists (select 1 from payout_cycles c join rider_payouts rp on rp.payout_cycle_id = c.id
                 where rp.rider_id = r.id and c.period_start = date_trunc('week', t.operational_date)::date)
  from riders r
  join rider_platform_accounts a on a.rider_id = r.id and a.platform = 'zomato'
  join trips t on t.rider_platform_account_id = a.id
  join trip_earnings e on e.trip_id = t.id and e.superseded_at is null
  where r.user_id = auth.uid() and t.operational_date between p_from and least(p_to, p_from + 62)
  order by t.delivered_at
$$;

create or replace function rider_my_weeks()
returns table (period_start date, scheduled_payment_date date, net_payable_paise bigint, paid_paise bigint)
language sql stable security definer set search_path = public as $$
  select c.period_start, c.scheduled_payment_date, rp.net_payable_paise,
         coalesce((select sum(p.amount_paise) from rider_payments p where p.rider_payout_id = rp.id and p.status in ('confirmed', 'reversed')), 0)::bigint
  from rider_payouts rp
  join payout_cycles c on c.id = rp.payout_cycle_id
  join riders r on r.id = rp.rider_id
  where r.user_id = auth.uid()
  order by c.period_start desc limit 12
$$;

create or replace function rider_my_payments()
returns table (payment_date date, amount_paise bigint, payment_method text, transaction_reference text)
language sql stable security definer set search_path = public as $$
  select p.payment_date, p.amount_paise, p.payment_method, p.transaction_reference
  from rider_payments p join riders r on r.id = p.rider_id
  where r.user_id = auth.uid() and p.status = 'confirmed'
  order by p.payment_date desc, p.created_at desc limit 30
$$;

-- When the latest Zomato file was imported (only for a signed-in rider).
create or replace function rider_last_update() returns timestamptz
language sql stable security definer set search_path = public as $$
  select case when exists (select 1 from riders where user_id = auth.uid())
              then (select max(imported_at) from import_batches where status = 'imported') end
$$;

revoke all on function rider_my_trips(date, date), rider_my_weeks(), rider_my_payments(), rider_last_update() from public;
grant execute on function rider_my_trips(date, date), rider_my_weeks(), rider_my_payments(), rider_last_update() to authenticated;

-- A rider's own actions that reach the audit log (bank details, PIN change).
drop policy if exists audit_insert_self on audit_logs;
create policy audit_insert_self on audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and action in ('rider.bank_self_update', 'rider.pin_changed'));
