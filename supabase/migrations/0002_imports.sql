-- Saved imports: default rate card, write policies, and one atomic import function.

-- Default rate card (same numbers as DEFAULT_RATE_CARD in src/engine/payout.ts).
insert into rate_cards (name, version, effective_start, status, configuration)
values (
  'RiderX default', 1, '2026-01-01', 'active',
  '{"name":"RiderX default","version":1,
    "slabs":[{"upToOrder":25,"ratePaise":5000},{"upToOrder":null,"ratePaise":6000}],
    "includedKm100":600,"extraKmRatePaise":500,"batchBonusPaise":3000,
    "rainBonusPaisePerOrder":0,"festivalBonusPaisePerOrder":0}'::jsonb
)
on conflict (name, version) do nothing;

-- Earnings are derived data: staff who import may write them. Old rows are superseded, never deleted.
create policy trip_earnings_insert on trip_earnings for insert
  with check (has_role('super_admin','operations_manager','finance_manager'));
create policy trip_earnings_supersede on trip_earnings for update
  using (has_role('super_admin','operations_manager','finance_manager'))
  with check (has_role('super_admin','operations_manager','finance_manager'));

-- The app writes audit entries as the signed-in user; the log stays append-only.
create policy audit_insert on audit_logs for insert
  with check (has_role('super_admin','operations_manager','finance_manager'));

-- Atomic import: either the whole batch and all its new trips are saved, or nothing is.
create or replace function commit_zomato_import(
  p_filename text,
  p_checksum text,
  p_period_start date,
  p_period_end date,
  p_trips jsonb,
  p_errors jsonb default '[]'::jsonb
) returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_batch uuid;
  t jsonb;
  v_acc uuid;
  ex trips%rowtype;
  v_ins int := 0;
  v_same int := 0;
  v_conf jsonb := '[]'::jsonb;
  v_unmatched text;
  v_total int := jsonb_array_length(p_trips);
  v_err int := jsonb_array_length(p_errors);
begin
  if not has_role('super_admin','operations_manager','finance_manager') then
    raise exception 'Not allowed to import';
  end if;

  select string_agg(distinct x->>'fe_id', ', ') into v_unmatched
  from jsonb_array_elements(p_trips) x
  where not exists (
    select 1 from rider_platform_accounts a
    where a.platform = 'zomato' and a.platform_rider_id = x->>'fe_id');
  if v_unmatched is not null then
    raise exception 'Unregistered FE IDs: %', v_unmatched;
  end if;

  insert into import_batches (filename, file_checksum, import_type, source_period_start, source_period_end,
                              imported_by, status, total_rows, error_count)
  values (p_filename, p_checksum, 'zomato_trips', p_period_start, p_period_end,
          auth.uid(), 'imported', v_total + v_err, v_err)
  returning id into v_batch;

  insert into import_row_errors (import_batch_id, row_number, error_code, error_message)
  select v_batch, (e->>'row')::int, e->>'code', e->>'message' from jsonb_array_elements(p_errors) e;

  for t in select * from jsonb_array_elements(p_trips) loop
    select id into v_acc from rider_platform_accounts
      where platform = 'zomato' and platform_rider_id = t->>'fe_id';
    select * into ex from trips where platform = 'zomato' and source_trip_id = t->>'trip_id';
    if found then
      if (ex.pickup_km100, ex.drop_km100, ex.orders_in_trip, ex.zomato_pay_paise, ex.is_raining)
         is distinct from ((t->>'pickup_km100')::int, (t->>'drop_km100')::int, (t->>'orders')::smallint,
                           (t->>'zomato_pay_paise')::bigint, (t->>'raining')::boolean) then
        v_conf := v_conf || jsonb_build_object('trip_id', t->>'trip_id');
      else
        v_same := v_same + 1;
      end if;
    else
      insert into trips (source_trip_id, rider_platform_account_id, fe_id, operational_date, delivered_at,
                         orders_in_trip, is_raining, pickup_km100, drop_km100, zomato_pay_paise,
                         zomato_dc_paise, tip_paise, zomato_distance_paise, source_import_batch_id)
      values (t->>'trip_id', v_acc, t->>'fe_id', (t->>'operational_date')::date, (t->>'delivered_at')::timestamp,
              (t->>'orders')::smallint, (t->>'raining')::boolean, (t->>'pickup_km100')::int, (t->>'drop_km100')::int,
              (t->>'zomato_pay_paise')::bigint, (t->>'dc_paise')::bigint, (t->>'tip_paise')::bigint,
              (t->>'zomato_distance_paise')::bigint, v_batch);
      v_ins := v_ins + 1;
    end if;
  end loop;

  update import_batches
     set inserted_rows = v_ins, skipped_rows = v_same + jsonb_array_length(v_conf)
   where id = v_batch;

  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'import.commit', 'import_batch', v_batch::text,
          jsonb_build_object('filename', p_filename, 'inserted', v_ins, 'identical', v_same, 'conflicts', v_conf));

  return jsonb_build_object('batch_id', v_batch, 'inserted', v_ins, 'identical', v_same, 'conflicts', v_conf);
end $$;

revoke all on function commit_zomato_import(text, text, date, date, jsonb, jsonb) from public;
grant execute on function commit_zomato_import(text, text, date, date, jsonb, jsonb) to authenticated;
