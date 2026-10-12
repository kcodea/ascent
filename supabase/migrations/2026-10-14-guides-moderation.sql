-- ========================================================================================================
-- GUIDES, STEP 4: reports, hiding, carrying guides over to a new set, a limit on bookmark changes  (2026-10-14)
-- ========================================================================================================
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-12-guides.sql and 2026-10-13-guides-community.sql.
-- Idempotent: safe to re-run. The same block is appended to schema.sql; keep the two identical.
-- Do not re-run an EARLIER guides file alone after this one: 2026-10-13 would put the old guide_bookmark back (no
-- limit on changes). If you did, run this file again.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-14-guides-moderation.md.
--
-- WHAT
--  - `guide_bookmark_log`: one row per bookmark added or removed, for the 120-an-hour limit. The service role's alone.
--  - `guide_bookmark`: as before, plus that limit. A call that changes nothing is not counted.
--  - `guide_report`: a signed-in player reports someone else's published guide, once per guide, ten a day.
--  - `guide_set_hidden`: the team hides or unhides a player's guide. A hidden guide is read only by its author and
--    the team; hiding marks its open reports actioned. A Team Ascent guide cannot be hidden (edit or delete it).
--  - `guide_dismiss_reports`: the team dismisses every open report of a guide.
--  - `guide_retag_set`: the team adds one set to up to 200 named guides (a new set going live). It only ever adds:
--    a card archived mid-set must not untag a guide.
-- Reports are read by the team only (the step 1 policy on `guide_reports`); a reporter cannot read their own.

begin;

create table if not exists public.guide_bookmark_log (
  user_id uuid not null references auth.users(id) on delete cascade,
  at      timestamptz not null default now()
);
create index if not exists guide_bookmark_log_user_at on public.guide_bookmark_log (user_id, at desc);
alter table public.guide_bookmark_log enable row level security; -- no policy: the service role only
revoke all on public.guide_bookmark_log from anon, authenticated;

create index if not exists guide_reports_open on public.guide_reports (guide_id) where status = 'open';
create index if not exists guides_hidden on public.guides (hidden_at desc) where hidden;

create or replace function public.guide_bookmark(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on      boolean := coalesce(p_on, false);
  v_row     public.guides;
  v_count   int;
  v_changed boolean := false; -- step 4
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0)); -- step 4: both paths, for the limit
  -- step 4: at most 120 changes an hour. Checked before anything is read, so it cannot be used to probe.
  select count(*) into v_count from public.guide_bookmark_log where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 120 then raise exception 'rate_limited'; end if;
  if v_on then
    select * into v_row from public.guides where id = p_id;
    -- A guide the caller could not read is "not found", whether it is private, hidden or was never there.
    if not found or (not v_row.official and (not v_row.published or v_row.hidden) and v_row.author_id is distinct from p_user) then
      raise exception 'not_found';
    end if;
    if v_row.official or v_row.author_id is not distinct from p_user then raise exception 'not_allowed'; end if;
    if not exists (select 1 from public.guide_bookmarks where user_id = p_user and guide_id = p_id) then
      select count(*) into v_count from public.guide_bookmarks where user_id = p_user;
      if v_count >= 200 then raise exception 'too_many_bookmarks'; end if;
      insert into public.guide_bookmarks (user_id, guide_id) values (p_user, p_id) on conflict do nothing;
      v_changed := found; -- step 4
    end if;
  else
    delete from public.guide_bookmarks where user_id = p_user and guide_id = p_id;
    v_changed := found; -- step 4
  end if;
  if v_changed then -- step 4
    delete from public.guide_bookmark_log where user_id = p_user and at < now() - interval '1 day';
    insert into public.guide_bookmark_log (user_id) values (p_user);
  end if;
  return jsonb_build_object('bookmarked', v_on, 'count',
    coalesce((select bookmark_count from public.guides where id = p_id and published and not hidden), 0));
end $$;

create or replace function public.guide_report(p_user uuid, p_id uuid, p_reason text, p_note text) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if p_reason is null or p_reason not in ('offensive', 'spam', 'impersonation', 'other') then raise exception 'bad_report'; end if;
  if char_length(coalesce(p_note, '')) > 300 then raise exception 'bad_report'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  select * into v_row from public.guides where id = p_id;
  if not found or (not v_row.official and (not v_row.published or v_row.hidden) and v_row.author_id is distinct from p_user) then
    raise exception 'not_found';
  end if;
  if v_row.official or v_row.author_id is not distinct from p_user then raise exception 'not_allowed'; end if;
  if exists (select 1 from public.guide_reports where guide_id = p_id and reporter_id = p_user) then raise exception 'already_reported'; end if;
  select count(*) into v_count from public.guide_reports where reporter_id = p_user and created_at > now() - interval '1 day';
  if v_count >= 10 then raise exception 'report_limit'; end if;
  insert into public.guide_reports (guide_id, reporter_id, reason, note) values (p_id, p_user, p_reason, coalesce(p_note, ''));
  return jsonb_build_object('reported', true);
end $$;

create or replace function public.guide_set_hidden(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on  boolean := coalesce(p_on, false);
  v_row public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.official then raise exception 'not_allowed'; end if; -- a Team Ascent guide is edited or deleted, not hidden
  update public.guides
     set hidden = v_on,
         hidden_by = case when v_on then p_user end,
         hidden_at = case when v_on then now() end
   where id = p_id
  returning * into v_row;
  if v_on then
    update public.guide_reports set status = 'actioned', resolved_by = p_user, resolved_at = now()
     where guide_id = p_id and status = 'open';
  end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_dismiss_reports(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  update public.guide_reports set status = 'dismissed', resolved_by = p_user, resolved_at = now()
   where guide_id = p_id and status = 'open';
  get diagnostics v_n = row_count;
  return jsonb_build_object('dismissed', v_n);
end $$;

create or replace function public.guide_retag_set(p_user uuid, p_set text, p_ids uuid[]) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_n int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  if p_set is null or p_set !~ '^set[0-9]{1,3}$' then raise exception 'bad_set'; end if;
  if p_ids is null or coalesce(cardinality(p_ids), 0) < 1 or cardinality(p_ids) > 200 then raise exception 'bad_ids'; end if;
  -- Adds only. The text and the revision are not touched, so an author who is editing is not disturbed.
  update public.guides set sets = array_append(sets, p_set)
   where id = any(p_ids) and not (p_set = any(sets));
  get diagnostics v_n = row_count;
  return jsonb_build_object('tagged', v_n);
end $$;

revoke all on function public.guide_bookmark(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_report(uuid, uuid, text, text) from public, anon, authenticated;
revoke all on function public.guide_set_hidden(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_dismiss_reports(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_retag_set(uuid, text, uuid[]) from public, anon, authenticated;
grant execute on function public.guide_bookmark(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_report(uuid, uuid, text, text) to service_role;
grant execute on function public.guide_set_hidden(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_dismiss_reports(uuid, uuid) to service_role;
grant execute on function public.guide_retag_set(uuid, text, uuid[]) to service_role;

commit;

notify pgrst, 'reload schema';
