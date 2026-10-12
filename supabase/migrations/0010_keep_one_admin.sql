-- Safety net: the database itself refuses to leave RiderX without an active Admin,
-- whatever the app or a hand-run SQL statement tries.
create or replace function keep_one_admin() returns trigger language plpgsql as $$
begin
  if (tg_op = 'DELETE' and old.role = 'super_admin' and old.active)
     or (tg_op = 'UPDATE' and old.role = 'super_admin' and old.active and not (new.role = 'super_admin' and new.active)) then
    if not exists (select 1 from profiles where role = 'super_admin' and active and id <> old.id) then
      raise exception 'There must always be at least one active Admin';
    end if;
  end if;
  return coalesce(new, old);
end $$;

drop trigger if exists profiles_keep_one_admin on profiles;
create trigger profiles_keep_one_admin before update or delete on profiles
  for each row execute function keep_one_admin();

