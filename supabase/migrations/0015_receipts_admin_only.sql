-- Only Admins can record money received from Zomato. (Everyone who could read it before still can, because the Overview totals use it.)
drop policy if exists zomato_receipts_insert on zomato_receipts;
create policy zomato_receipts_insert on zomato_receipts for insert with check (has_role('super_admin'));
