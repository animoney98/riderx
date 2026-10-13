-- Bank controls:
--  1. The company debit account can only be changed through two functions. A change needs a second person
--     (another active admin or finance manager) to approve it, whenever one exists.
--  2. Bank results: after the bank file is uploaded, record per rider whether the payment went through or failed.
--     Failures are kept in their own permanent table so a failed payment is never lost.

-- ---------- 1. Debit account guard ----------
create or replace function app_settings_guard() returns trigger language plpgsql as $$
declare k text := coalesce(new.key, old.key);
begin
  if k in ('bank_debit_account', 'bank_debit_account_pending') and coalesce(current_setting('riderx.bank_fn', true), '') <> 'on' then
    raise exception 'The debit account can only be changed from the Bank page';
  end if;
  return coalesce(new, old);
end $$;
drop trigger if exists app_settings_guard on app_settings;
create trigger app_settings_guard before insert or update or delete on app_settings
  for each row execute function app_settings_guard();

-- Ask to set or change the debit account. Returns 'set' (done), or 'pending' (waiting for a second person).
create or replace function propose_debit_account(p_account text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_acct text := regexp_replace(coalesce(p_account, ''), '\s', '', 'g');
  v_current text;
  v_name text;
  v_others int;
begin
  if not has_role('super_admin', 'finance_manager') then raise exception 'Only finance managers and admins can change this'; end if;
  if v_acct !~ '^[0-9]{6,20}$' then raise exception 'Account number must be digits only'; end if;
  select value into v_current from app_settings where key = 'bank_debit_account';
  if v_current = v_acct then raise exception 'That is already the debit account'; end if;
  select full_name into v_name from profiles where id = auth.uid();
  select count(*) into v_others from profiles where active and role in ('super_admin', 'finance_manager') and id <> auth.uid();
  perform set_config('riderx.bank_fn', 'on', true);

  if v_current is null or v_others = 0 then
    insert into app_settings (key, value, updated_by, updated_at) values ('bank_debit_account', v_acct, auth.uid(), now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
    delete from app_settings where key = 'bank_debit_account_pending';
    insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
    values (auth.uid(), 'settings.debit_account', 'setting', 'bank_debit_account',
            jsonb_build_object('last4', right(v_acct, 4), 'previous_last4', right(coalesce(v_current, ''), 4), 'approved_by', null,
                               'note', case when v_current is null then 'first setup' else 'no second approver available' end));
    return 'set';
  end if;

  insert into app_settings (key, value, updated_by, updated_at)
  values ('bank_debit_account_pending', jsonb_build_object('account', v_acct, 'by', auth.uid(), 'by_name', v_name, 'at', now())::text, auth.uid(), now())
  on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'settings.debit_account_requested', 'setting', 'bank_debit_account', jsonb_build_object('last4', right(v_acct, 4)));
  return 'pending';
end $$;

-- Decide on the waiting change. 'approve' and 'reject' must come from someone other than the requester; the requester may 'cancel'.
create or replace function decide_debit_account(p_decision text)
returns text
language plpgsql security definer set search_path = public as $$
declare
  v_raw text; v jsonb; v_acct text; v_by uuid;
begin
  if not has_role('super_admin', 'finance_manager') then raise exception 'Only finance managers and admins can do this'; end if;
  if p_decision not in ('approve', 'reject', 'cancel') then raise exception 'Unknown decision'; end if;
  select value into v_raw from app_settings where key = 'bank_debit_account_pending' for update;
  if v_raw is null then raise exception 'There is no change waiting'; end if;
  v := v_raw::jsonb; v_acct := v->>'account'; v_by := (v->>'by')::uuid;
  if p_decision = 'cancel' and v_by <> auth.uid() then raise exception 'Only the person who asked can cancel the request'; end if;
  if p_decision in ('approve', 'reject') and v_by = auth.uid() then raise exception 'A second person must decide on this request'; end if;
  perform set_config('riderx.bank_fn', 'on', true);
  if p_decision = 'approve' then
    insert into app_settings (key, value, updated_by, updated_at) values ('bank_debit_account', v_acct, auth.uid(), now())
    on conflict (key) do update set value = excluded.value, updated_by = excluded.updated_by, updated_at = excluded.updated_at;
  end if;
  delete from app_settings where key = 'bank_debit_account_pending';
  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'settings.debit_account_' || p_decision, 'setting', 'bank_debit_account', jsonb_build_object('last4', right(v_acct, 4), 'requested_by', v_by));
  return p_decision;
end $$;

revoke all on function propose_debit_account(text) from public;
revoke all on function decide_debit_account(text) from public;
grant execute on function propose_debit_account(text) to authenticated;
grant execute on function decide_debit_account(text) to authenticated;

-- ---------- 2. Bank results ----------
create table payment_failures (
  id uuid primary key default gen_random_uuid(),
  rider_payout_id uuid not null references rider_payouts(id),
  rider_id uuid not null references riders(id),
  amount_paise bigint not null check (amount_paise > 0),
  failed_on date not null,
  reason text not null check (length(btrim(reason)) >= 3),
  batch_reference text,
  recorded_by uuid references profiles(id),
  created_at timestamptz not null default now()
);
create index on payment_failures (rider_payout_id);
create trigger payment_failures_append_only before update or delete on payment_failures
  for each row execute function block_ledger_change();
alter table payment_failures enable row level security;
create policy payment_failures_read on payment_failures for select using (has_role('super_admin', 'finance_manager'));
-- No insert policy: rows are only written by record_bank_results below.

-- p_results: [{ "payout_id": uuid, "outcome": "paid" | "failed", "reference": text?, "reason": text? }, ...]
-- Everything is saved or nothing is. A rider's amount is always the full outstanding amount at that moment.
create or replace function record_bank_results(p_period_start date, p_date date, p_method text, p_batch_ref text, p_results jsonb)
returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_cycle uuid; r jsonb; po rider_payouts%rowtype;
  v_paid bigint; v_out bigint; v_fe text; v_ref text; v_seen uuid[] := '{}';
  n_paid int := 0; n_failed int := 0; t_paid bigint := 0; t_failed bigint := 0;
  v_today date := (now() at time zone 'Asia/Kolkata')::date;
begin
  if not has_role('super_admin', 'finance_manager') then raise exception 'Only finance managers and admins can record bank results'; end if;
  if p_method not in ('Bank transfer', 'UPI', 'Cash', 'Other') then raise exception 'Choose a payment method'; end if;
  if p_date is null or p_date > v_today then raise exception 'Payment date must be today or earlier'; end if;
  if jsonb_typeof(p_results) <> 'array' or jsonb_array_length(p_results) = 0 then raise exception 'Nothing to record'; end if;
  select id into v_cycle from payout_cycles where period_start = p_period_start;
  if v_cycle is null then raise exception 'This week is not approved yet'; end if;

  for r in select * from jsonb_array_elements(p_results) loop
    select * into po from rider_payouts where id = (r->>'payout_id')::uuid and payout_cycle_id = v_cycle for update;
    if not found then raise exception 'A rider in your list does not belong to this week'; end if;
    if po.id = any(v_seen) then raise exception 'A rider appears twice in your list'; end if;
    v_seen := v_seen || po.id;
    select coalesce(sum(amount_paise), 0) into v_paid from rider_payments where rider_payout_id = po.id and status in ('confirmed', 'reversed');
    v_out := po.net_payable_paise - v_paid;
    select platform_rider_id into v_fe from rider_platform_accounts where rider_id = po.rider_id and platform = 'zomato' limit 1;
    if v_out <= 0 then raise exception 'Nothing is outstanding for %', coalesce(v_fe, po.rider_id::text); end if;

    if r->>'outcome' = 'paid' then
      v_ref := nullif(btrim(coalesce(r->>'reference', '')), '');
      if v_ref is null and nullif(btrim(coalesce(p_batch_ref, '')), '') is not null then v_ref := btrim(p_batch_ref) || '-' || coalesce(v_fe, po.rider_id::text); end if;
      if v_ref is null and p_method <> 'Cash' then raise exception 'Enter the bank reference for %', coalesce(v_fe, po.rider_id::text); end if;
      insert into rider_payments (rider_payout_id, rider_id, amount_paise, payment_date, payment_method, transaction_reference, status, recorded_by)
      values (po.id, po.rider_id, v_out, p_date, p_method, v_ref, 'confirmed', auth.uid());
      n_paid := n_paid + 1; t_paid := t_paid + v_out;
    elsif r->>'outcome' = 'failed' then
      if length(btrim(coalesce(r->>'reason', ''))) < 3 then raise exception 'Say why the payment failed for %', coalesce(v_fe, po.rider_id::text); end if;
      insert into payment_failures (rider_payout_id, rider_id, amount_paise, failed_on, reason, batch_reference, recorded_by)
      values (po.id, po.rider_id, v_out, p_date, btrim(r->>'reason'), nullif(btrim(coalesce(p_batch_ref, '')), ''), auth.uid());
      n_failed := n_failed + 1; t_failed := t_failed + v_out;
    else
      raise exception 'Mark every rider as paid or failed';
    end if;
  end loop;

  insert into audit_logs (actor_id, action, entity_type, entity_id, after_values)
  values (auth.uid(), 'payment.bank_results', 'payout_cycle', v_cycle::text,
          jsonb_build_object('paid', n_paid, 'paid_paise', t_paid, 'failed', n_failed, 'failed_paise', t_failed, 'method', p_method, 'batch', p_batch_ref));
  return jsonb_build_object('paid', n_paid, 'paid_paise', t_paid, 'failed', n_failed, 'failed_paise', t_failed);
end $$;
revoke all on function record_bank_results(date, date, text, text, jsonb) from public;
grant execute on function record_bank_results(date, date, text, text, jsonb) to authenticated;
