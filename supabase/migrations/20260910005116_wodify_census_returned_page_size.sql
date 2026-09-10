-- Preserve legacy capacity-100 drafts; current census page_size is rows returned.
-- Existing 25/25 drafts survive unchanged. Runtime excludes legacy size 100.
alter table public.wodify_census_runs
  drop constraint wodify_census_runs_page_size_check;
alter table public.wodify_census_runs
  add constraint wodify_census_runs_page_size_check check (
    page_size = 100 or (
      page_size between 0 and 25 and page_size = rows_seen
      and (not has_more or (page_size = 25 and page < 200))
    )
  );
notify pgrst, 'reload schema';
