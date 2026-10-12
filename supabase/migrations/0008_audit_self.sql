-- A signed-in rider's own actions (entering bank details) must reach the audit log. They can only write entries under their own id.
create policy audit_insert_self on audit_logs for insert to authenticated
  with check (actor_id = auth.uid() and action in ('rider.bank_self_update'));
