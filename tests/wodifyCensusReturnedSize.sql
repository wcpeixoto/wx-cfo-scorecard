-- Run after loading the previous canonical schema, seeding 40 current 25/25
-- drafts plus one legacy 100/21 draft, and applying the candidate migration.
-- Synthetic local-only fixtures. Never run against production.
begin;
do $$ begin
  if (select count(*) from public.wodify_census_runs) <> 41 then
    raise exception 'existing fixtures did not survive';
  end if;
end $$;
create function pg_temp.check_page(s integer, r integer, more boolean, accepted boolean, p integer default 1)
returns void language plpgsql as $$
begin
  begin
    insert into public.wodify_census_runs
      (run_id,page,page_size,has_more,rows_seen,active_clients_seen,student_total,
       student_member,student_dependent,student_guardian_with_signin,student_no_group_with_signin,
       guardian_only,unclassified,ambiguous_no_signin_with_membership,detail_calls_made,detail_clients_failed)
    values ('99999999-9999-4999-8999-999999999999',p,s,more,r,0,0,0,0,0,0,0,0,0,0,0);
    if not accepted then raise exception 'invalid shape accepted: %,%,%,%',s,r,more,p; end if;
    delete from public.wodify_census_runs where run_id='99999999-9999-4999-8999-999999999999';
  exception when check_violation then
    if accepted then raise exception 'valid shape rejected: %,%,%,%',s,r,more,p; end if;
  end;
end $$;
select pg_temp.check_page(21,21,false,true);
select pg_temp.check_page(0,0,false,true);
select pg_temp.check_page(25,25,false,true);
select pg_temp.check_page(25,25,true,true);
select pg_temp.check_page(25,25,false,true,200);
select pg_temp.check_page(21,21,true,false);
select pg_temp.check_page(0,0,true,false);
select pg_temp.check_page(25,21,false,false);
select pg_temp.check_page(21,25,false,false);
select pg_temp.check_page(26,26,false,false);
select pg_temp.check_page(-1,0,false,false);
select pg_temp.check_page(25,25,true,false,200);
-- Compatibility only: the runtime tests separately reject legacy size 100.
select pg_temp.check_page(100,21,false,true);
select pg_temp.check_page(100,101,false,false);
rollback;
