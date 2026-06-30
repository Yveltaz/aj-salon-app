-- Tokenless status view: lets the frontend read connection status (never tokens).
-- Runs with the view owner's privileges (security_invoker off) so it can read
-- xero_connection past RLS, but only ever exposes these three safe columns.
create or replace view xero_status as
  select 1 as id, (tenant_id is not null) as connected, tenant_name, connected_at
  from xero_connection
  where id = 1;
grant select on xero_status to authenticated;

-- Owner-only disconnect. A frontend RLS delete can't work here: with no SELECT
-- policy on xero_connection (so tokens stay hidden), Postgres can't read the row
-- to evaluate the delete's WHERE filter. Instead, a SECURITY DEFINER function
-- runs elevated (bypassing RLS) but enforces the owner check itself, so tokens
-- are never exposed and only the owner can clear the connection.
create or replace function public.disconnect_xero() returns void
  language plpgsql security definer set search_path = public as $$
begin
  if not exists (select 1 from employees where user_id = auth.uid() and role = 'owner') then
    raise exception 'Only the owner can disconnect Xero';
  end if;
  delete from xero_connection where id = 1;
end $$;
revoke all on function public.disconnect_xero() from public, anon;
grant execute on function public.disconnect_xero() to authenticated;

-- Expose the new view to PostgREST immediately.
notify pgrst, 'reload schema';
