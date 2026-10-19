-- Undo an import. Admin only, with a written reason. Removes only the trips that file added,
-- and their calculated earnings. A copy of every removed trip is kept, the batch is marked
-- "rolled back", and the action is written to the audit log. Weeks that are already approved
-- cannot be touched.
create table if not exists import_rollbacks (
  id bigint generated always as identity primary key,
  import_batch_id uuid not null references import_batches(id),
  rolled_back_by uuid,
  rolled_back_at timestamptz not null default now(),
  reason text not null,
  trips jsonb not null
);
alter table import_rollbacks enable row level security;
create policy import_rollbacks_read on import_rollbacks for select using (has_role('super_admin'));
create trigger import_rollbacks_append_only before update or delete on import_rollbacks
  for each row execute function block_ledger_change();

create or replace function undo_import(p_batch uuid, p_reason text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  b import_batches%rowtype;
  v_count int;
  v_min date;
  v_max date;
  v_fes text[];
  v_frozen text;
begin
  if not has_role('super_admin') then raise exception 'Only an Admin can undo an import'; end if;
  if length(trim(coalesce(p_reason, ''))) < 5 then raise exception 'Write a reason (at least a few words)'; end if;

  select * into b from import_batches where id = p_batch for update;
  if not found then raise exception 'Import not found'; end if;
  if b.status <> 'imported' then raise exception 'This import is already %', b.status; end if;

  select count(*), min(operational_date), max(operational_date), array_agg(distinct fe_id)
    into v_count, v_min, v_max, v_fes
  from trips where source_import_batch_id = p_batch;
  if v_count = 0 then raise exception 'This file saved no new trips, so there is nothing to undo'; end if;

  select string_agg(distinct c.period_start::text, ', ') into v_frozen
  from payout_cycles c
  where c.status not in ('draft', 'needs_review', 'ready_for_approval')
    and exists (select 1 from trips t where t.source_import_batch_id = p_batch
                and t.operational_date between c.period_start and c.period_end);
  if v_frozen is not null then
    raise exception 'The week starting % is already approved, so its trips cannot be removed', v_frozen;
  end if;

  insert into import_rollbacks (import_batch_id, rolled_back_by, reason, trips)
  select p_batch, auth.uid(), trim(p_reason), jsonb_agg(to_jsonb(t) - 'source_row')
  from trips t where t.source_import_batch_id = p_batch;

  delete from trip_earnings where trip_id in (select id from trips where source_import_batch_id = p_batch);
  delete from trips where source_import_batch_id = p_batch;
  update import_batches set status = 'rolled_back' where id = p_batch;

  insert into audit_logs (actor_id, action, entity_type, entity_id, before_values, after_values, reason)
  values (auth.uid(), 'import.undo', 'import_batch', p_batch::text,
          jsonb_build_object('filename', b.filename, 'trips_removed', v_count),
          jsonb_build_object('from', v_min, 'to', v_max, 'fe_ids', v_fes), trim(p_reason));

  return jsonb_build_object('removed', v_count, 'from', v_min, 'to', v_max, 'fe_ids', to_jsonb(v_fes));
end $$;
revoke all on function undo_import(uuid, text) from public;
grant execute on function undo_import(uuid, text) to authenticated;
