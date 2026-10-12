-- ========================================================================================================
-- GUIDES, STEP 3: publishing, bookmarks, and a save that can be retried  (2026-10-13)
-- ========================================================================================================
--
-- Paste into the Supabase SQL Editor and Run, AFTER supabase/migrations/2026-10-12-guides.sql. Idempotent: safe to
-- re-run. The same block is appended to schema.sql; keep the two identical.
-- Do not re-run 2026-10-12-guides.sql alone after this file: it puts the old guide_save back and a retried save is no longer recognised. If you did, run this file again.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-13-guides-community.md.
--
-- WHAT
--  - `guides.last_save_id`: the id the client made for the press of Save that last wrote the row. `guide_save` given
--    the same id again by the same account answers that row and writes nothing, so a save that timed out on the
--    client but landed here is not applied twice when the player presses Save again.
--  - `guide_own_row`: the caller's own player guide, for the Edge Function to re-check its text before publishing.
--  - `guide_set_published`: the author makes a guide public or private. Publishing is refused while the team has it
--    hidden, and when the row is not at the revision whose text was checked. It counts toward the 30 an hour.
--  - `guide_bookmark`: a player bookmarks a published guide that is not theirs and not Team Ascent's (200 at most),
--    or removes a bookmark. A trigger keeps `guides.bookmark_count` true, whichever way a bookmark goes.
--  - Three indexes: the Community list's order (most bookmarked, and newest), and bookmarks by guide (for the cascade
--    when a guide is deleted).
--
-- A client from before this file never sends a save id or calls these functions. A client from after it, talking to
-- a database from before it: saves still work (the old `guide_save` ignores the id), and publishing and bookmarking
-- answer "something went wrong" until this file is run and `guide-write` is redeployed.

begin;

alter table public.guides add column if not exists last_save_id uuid;
create index if not exists guides_last_save on public.guides (last_save_id) where last_save_id is not null;
create index if not exists guides_community on public.guides (bookmark_count desc, published_at desc nulls last, id) where published and not hidden and not official;
create index if not exists guides_community_new on public.guides (published_at desc nulls last, id) where published and not hidden and not official;
create index if not exists guide_bookmarks_guide on public.guide_bookmarks (guide_id);

create or replace function public.guide_save(p_user uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team     boolean;
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_official boolean := coalesce((p_doc->>'official')::boolean, false);
  v_fork     uuid := nullif(p_doc->>'forked_from', '')::uuid;
  v_save     uuid := nullif(p_doc->>'save_id', '')::uuid; -- step 3
  v_ftitle   text;
  v_fbyline  text;
  v_row      public.guides;
  v_count    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  -- The 20-guide cap and the 30-per-hour limit are count-then-insert; this serialises one account's saves so a
  -- parallel burst cannot beat them. (Released at the end of the transaction.)
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  -- step 3: this account already made this very save (the client is pressing Save again after a timeout): answer
  -- the row it wrote. Before the rate limit, so a replay is never counted or refused.
  if v_save is not null then
    select * into v_row from public.guides where last_save_id = v_save and updated_by = p_user and (v_id is null or id = v_id); -- step 3
    if found then return to_jsonb(v_row); end if;
  end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  if v_official and not v_team then raise exception 'not_allowed'; end if;

  select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
  if v_count >= 30 then raise exception 'rate_limited'; end if;

  if v_id is null then
    if not v_official then
      select count(*) into v_count from public.guides where author_id = p_user and not official;
      if v_count >= 20 then raise exception 'too_many_guides'; end if;
    end if;
    if v_fork is not null then
      select title, byline into v_ftitle, v_fbyline from public.guides
       where id = v_fork and (official or (published and not hidden) or author_id = p_user);
      if not found then v_fork := null; v_ftitle := null; v_fbyline := null; end if;
    end if;
    insert into public.guides (author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases,
                               forked_from, forked_title, forked_byline, sort_order, updated_by, last_save_id) -- step 3: last_save_id
    values (case when v_official then null else p_user end,
            case when v_official then 'Team Ascent' else p_doc->>'byline' end,
            v_official, v_official, case when v_official then now() end,
            public.guide_text_array(p_doc->'sets'), public.guide_text_array(p_doc->'tribes'), public.guide_text_array(p_doc->'pairs_with'),
            p_doc->>'icon_card', p_doc->>'title', coalesce(p_doc->>'tagline', ''), p_doc->>'body',
            public.guide_text_array(p_doc->'core'), public.guide_text_array(p_doc->'enablers'), public.guide_text_array(p_doc->'mentions'),
            coalesce(p_doc->'aliases', '{}'::jsonb),
            v_fork, v_ftitle, v_fbyline,
            case when v_official then (select coalesce(max(sort_order), -1) + 1 from public.guides where official) else 0 end,
            p_user, v_save)
    returning * into v_row;
  else
    select * into v_row from public.guides where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    if v_row.official then
      if not v_team then raise exception 'not_allowed'; end if;
    elsif v_row.author_id is distinct from p_user then
      raise exception 'not_allowed';
    end if;
    if v_official <> v_row.official then raise exception 'not_allowed'; end if; -- a save never flips official
    if (p_doc->>'revision')::int is distinct from v_row.revision then raise exception 'conflict'; end if;
    update public.guides set
      byline     = case when v_row.official then 'Team Ascent' else p_doc->>'byline' end,
      sets       = public.guide_text_array(p_doc->'sets'),
      tribes     = public.guide_text_array(p_doc->'tribes'),
      pairs_with = public.guide_text_array(p_doc->'pairs_with'),
      icon_card  = p_doc->>'icon_card',
      title      = p_doc->>'title',
      tagline    = coalesce(p_doc->>'tagline', ''),
      body       = p_doc->>'body',
      core       = public.guide_text_array(p_doc->'core'),
      enablers   = public.guide_text_array(p_doc->'enablers'),
      mentions   = public.guide_text_array(p_doc->'mentions'),
      aliases    = coalesce(p_doc->'aliases', '{}'::jsonb),
      revision   = v_row.revision + 1,
      updated_at = now(),
      updated_by = p_user,
      last_save_id = v_save -- step 3
    where id = v_id
    returning * into v_row;
  end if;

  delete from public.guide_writes where user_id = p_user and at < now() - interval '1 day';
  insert into public.guide_writes (user_id) values (p_user);
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_own_row(p_user uuid, p_id uuid) returns jsonb
language plpgsql stable security definer set search_path = public as $$
declare
  v_row public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  select * into v_row from public.guides where id = p_id;
  if not found then raise exception 'not_found'; end if;
  if v_row.official or v_row.author_id is distinct from p_user then raise exception 'not_allowed'; end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_set_published(p_user uuid, p_id uuid, p_on boolean, p_revision int) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on    boolean := coalesce(p_on, false);
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if v_row.official or v_row.author_id is distinct from p_user then raise exception 'not_allowed'; end if;
  if v_on = v_row.published then return to_jsonb(v_row); end if; -- already so: nothing to do, nothing counted
  if v_on then
    if v_row.hidden then raise exception 'guide_hidden'; end if;
    -- The text that was checked is the text that goes public: a save since then is a conflict.
    if p_revision is distinct from v_row.revision then raise exception 'conflict'; end if;
    select count(*) into v_count from public.guide_writes where user_id = p_user and at > now() - interval '1 hour';
    if v_count >= 30 then raise exception 'rate_limited'; end if;
  end if;
  update public.guides
     set published = v_on,
         published_at = case when v_on then coalesce(published_at, now()) else published_at end
   where id = p_id
  returning * into v_row;
  if v_on then insert into public.guide_writes (user_id) values (p_user); end if;
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_bookmark(p_user uuid, p_id uuid, p_on boolean) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_on    boolean := coalesce(p_on, false);
  v_row   public.guides;
  v_count int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if v_on then
    perform pg_advisory_xact_lock(hashtextextended('guides:' || p_user::text, 0));
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
    end if;
  else
    delete from public.guide_bookmarks where user_id = p_user and guide_id = p_id;
  end if;
  return jsonb_build_object('bookmarked', v_on, 'count', coalesce((select bookmark_count from public.guides where id = p_id and published and not hidden), 0));
end $$;

-- The count follows every way a bookmark can come or go: this function, a deleted guide, a deleted account.
create or replace function public.guide_bookmark_counted() returns trigger
language plpgsql security definer set search_path = public as $$
begin
  if tg_op = 'INSERT' then
    update public.guides set bookmark_count = bookmark_count + 1 where id = new.guide_id;
    return new;
  end if;
  update public.guides set bookmark_count = greatest(0, bookmark_count - 1) where id = old.guide_id;
  return old;
end $$;
drop trigger if exists guide_bookmarks_count on public.guide_bookmarks;
create trigger guide_bookmarks_count after insert or delete on public.guide_bookmarks
  for each row execute function public.guide_bookmark_counted();

revoke all on function public.guide_own_row(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_set_published(uuid, uuid, boolean, int) from public, anon, authenticated;
revoke all on function public.guide_bookmark(uuid, uuid, boolean) from public, anon, authenticated;
revoke all on function public.guide_bookmark_counted() from public, anon, authenticated, service_role;
revoke all on function public.guide_save(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guide_own_row(uuid, uuid) to service_role;
grant execute on function public.guide_set_published(uuid, uuid, boolean, int) to service_role;
grant execute on function public.guide_bookmark(uuid, uuid, boolean) to service_role;
grant execute on function public.guide_save(uuid, jsonb) to service_role;

commit;

notify pgrst, 'reload schema';
