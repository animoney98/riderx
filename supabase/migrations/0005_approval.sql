-- Payroll approval: freezes a week's figures per rider in one atomic step.
create or replace function approve_payroll_cycle(p_period_start date, p_rate_card_id uuid, p_rows jsonb)
returns uuid
language plpgsql security definer set search_path = public as $$
declare
  v_cycle uuid;
  r jsonb;
  v_rider uuid;
  v_unmatched text;
begin
  if not has_role('super_admin','finance_manager') then raise exception 'Only finance managers and admins can approve payroll'; end if;
  if jsonb_array_length(p_rows) = 0 then raise exception 'Nothing to approve'; end if;
  if exists (select 1 from payout_cycles where period_start = p_period_start) then raise exception 'This week is already approved'; end if;

  select string_agg(x->>'fe_id', ', ') into v_unmatched from jsonb_array_elements(p_rows) x
  where not exists (select 1 from rider_platform_accounts a where a.platform = 'zomato' and a.platform_rider_id = x->>'fe_id');
  if v_unmatched is not null then raise exception 'Unregistered FE IDs: %', v_unmatched; end if;

  insert into payout_cycles (period_start, period_end, scheduled_payment_date, status, approved_by, approved_at)
  values (p_period_start, p_period_start + 6, p_period_start + 11, 'approved', auth.uid(), now())
  returning id into v_cycle;

  for r in select * from jsonb_array_elements(p_rows) loop
    select rider_id into v_rider from rider_platform_accounts where platform = 'zomato' and platform_rider_id = r->>'fe_id';
    insert into rider_payouts (payout_cycle_id, rider_id, earnings_snapshot, gross_paise, additions_paise, deductions_paise, net_payable_paise, status, approved_at)
    values (v_cycle, v_rider, (r->'snapshot') || jsonb_build_object('rate_card_id', p_rate_card_id),
            (r->>'gross_paise')::bigint, 0, 0, (r->>'gross_paise')::bigint, 'approved', now());
  end loop;

  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'payroll.approve', 'payout_cycle', v_cycle::text,
          jsonb_build_object('period_start', p_period_start, 'riders', jsonb_array_length(p_rows),
                             'gross_paise', (select sum((x->>'gross_paise')::bigint) from jsonb_array_elements(p_rows) x)));
  return v_cycle;
end $$;
revoke all on function approve_payroll_cycle(date, uuid, jsonb) from public;
grant execute on function approve_payroll_cycle(date, uuid, jsonb) to authenticated;
