-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- GUIDES ON THE SERVER: Team Ascent guides, player guides, the write functions  (2026-10-12)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run. Idempotent: safe to re-run. Depends on nothing but auth.users.
-- The same block is appended to schema.sql; keep the two identical.
-- Spec: docs/superpowers/specs/2026-10-11-community-guides-design.md. Devlog: docs/devlog/2026-10-12-guides-storage.md.
--
-- WHY (owner 2026-10-11: "i'd like the ability to edit existing guides while in game and save them. The existing
-- [guides] are written by 'Team Ascent' and should only be able to be modified by myself and KC. outside of that,
-- one should be able to create a new guide either from scratch or by duplicating an existing guide"): guides were
-- fixed data in the client. They move here so an edit reaches every player on their next load.
--
-- WHAT
--  - `guide_team`: the accounts that may edit Team Ascent guides. A player can read only their own row.
--  - `guides`: every guide. READ: official, or published and not hidden, or your own, or you are on the team.
--    WRITE: no client policy at all, and the API roles' write privileges are revoked. The three functions below,
--    callable only by the service role (the `guide-write` Edge Function), are the only writers.
--    Official (Team Ascent) guides belong to NO account: `author_id` is null on them (a check constraint pins that
--    shape: official means no author, published, by line "Team Ascent"), so a team member leaving cannot delete
--    them. A player's guides belong to the player and go with the account (`on delete cascade`).
--  - `guide_bookmarks`, `guide_reports`: created now so later steps add functions, not tables.
--  - `guide_writes`: one row per save, for the 30-per-hour rate limit.
--  - `guide_save`, `guide_delete`, `guide_import_builtins`: the row rules (ownership, official = team only, the
--    20-guide cap, the rate limit, edit conflicts). The text rules (limits, word filter) are the Edge Function's.
--    One account's saves are serialised (an advisory lock), so a parallel burst cannot beat the cap or the limit.
--
-- AFTER RUNNING: add the team, ONCE, with the two real emails typed here and NOT committed anywhere:
--   insert into public.guide_team (user_id) select id from auth.users where email in ('<mike>', '<kc>')
--   on conflict do nothing;
-- A client from before this file ignores these tables. A client from after it, talking to a database from before
-- it, gets "relation does not exist", treats guides as switched off, and shows its built-in guides.

begin;

create table if not exists public.guide_team (
  user_id  uuid primary key references auth.users(id) on delete cascade,
  added_at timestamptz not null default now()
);
alter table public.guide_team enable row level security;
drop policy if exists "read own guide_team" on public.guide_team;
create policy "read own guide_team" on public.guide_team for select to authenticated using ((select auth.uid()) = user_id);

create or replace function public.is_guide_team() returns boolean
language sql stable security definer set search_path = public as $$
  select exists (select 1 from public.guide_team where user_id = auth.uid());
$$;
revoke all on function public.is_guide_team() from public;
grant execute on function public.is_guide_team() to anon, authenticated, service_role;

create table if not exists public.guides (
  id             uuid primary key default gen_random_uuid(),
  slug           text unique,                                             -- imported built-ins only
  author_id      uuid references auth.users(id) on delete cascade,        -- null on official (Team Ascent) guides, which belong to no account, so a team member leaving cannot delete them; a deleted player's guides go with the account
  byline         text not null,
  official       boolean not null default false,
  published      boolean not null default false,
  published_at   timestamptz,
  hidden         boolean not null default false,
  hidden_by      uuid,
  hidden_at      timestamptz,
  sets           text[] not null default '{}',
  tribes         text[] not null default '{}',
  pairs_with     text[] not null default '{}',
  icon_card      text not null,
  title          text not null,
  tagline        text not null default '',
  body           text not null,
  core           text[] not null,
  enablers       text[] not null default '{}',
  mentions       text[] not null default '{}',
  aliases        jsonb not null default '{}'::jsonb,
  forked_from    uuid references public.guides(id) on delete set null,
  forked_title   text,
  forked_byline  text,
  bookmark_count int not null default 0,
  sort_order     int not null default 0,
  revision       int not null default 1,
  created_at     timestamptz not null default now(),
  updated_at     timestamptz not null default now(),
  updated_by     uuid,
  constraint guides_official_shape check (not official or (author_id is null and published and byline = 'Team Ascent'))
);
create index if not exists guides_sets on public.guides using gin (sets);
create index if not exists guides_author on public.guides (author_id);
create index if not exists guides_official on public.guides (sort_order) where official;

alter table public.guides enable row level security;
drop policy if exists "read guides" on public.guides;
create policy "read guides" on public.guides for select to anon, authenticated
  using (official or (published and not hidden) or author_id = (select auth.uid()) or (select public.is_guide_team()));

create table if not exists public.guide_bookmarks (
  user_id    uuid not null references auth.users(id) on delete cascade,
  guide_id   uuid not null references public.guides(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, guide_id)
);
alter table public.guide_bookmarks enable row level security;
drop policy if exists "read own guide_bookmarks" on public.guide_bookmarks;
create policy "read own guide_bookmarks" on public.guide_bookmarks for select to authenticated using ((select auth.uid()) = user_id);

create table if not exists public.guide_reports (
  id          uuid primary key default gen_random_uuid(),
  guide_id    uuid not null references public.guides(id) on delete cascade,
  reporter_id uuid not null references auth.users(id) on delete cascade,
  reason      text not null check (reason in ('offensive', 'spam', 'impersonation', 'other')),
  note        text not null default '',
  status      text not null default 'open' check (status in ('open', 'dismissed', 'actioned')),
  resolved_by uuid,
  resolved_at timestamptz,
  created_at  timestamptz not null default now(),
  unique (guide_id, reporter_id)
);
alter table public.guide_reports enable row level security;
drop policy if exists "team reads guide_reports" on public.guide_reports;
create policy "team reads guide_reports" on public.guide_reports for select to authenticated using ((select public.is_guide_team()));

create table if not exists public.guide_writes (
  user_id uuid not null,
  at      timestamptz not null default now()
);
create index if not exists guide_writes_user_at on public.guide_writes (user_id, at desc);
alter table public.guide_writes enable row level security; -- no policy: the service role only

-- Row level security has no write policy on these tables, but TRUNCATE is not covered by row level security, and
-- Supabase grants the API roles every table privilege by default. Take the write privileges away as well: the
-- functions below are the only writers. (guide_writes is the service role's alone, so it loses select too.)
revoke insert, update, delete, truncate on public.guides, public.guide_team, public.guide_bookmarks, public.guide_reports, public.guide_writes from anon, authenticated;
revoke select on public.guide_writes from anon, authenticated;

-- A jsonb array of strings as text[], order kept. Anything that is not an array is the empty list.
create or replace function public.guide_text_array(j jsonb) returns text[]
language sql immutable set search_path = public as $$
  select coalesce(array_agg(x order by n), '{}'::text[])
  from jsonb_array_elements_text(case when jsonb_typeof(j) = 'array' then j else '[]'::jsonb end) with ordinality as t(x, n);
$$;

create or replace function public.guide_save(p_user uuid, p_doc jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team     boolean;
  v_id       uuid := nullif(p_doc->>'id', '')::uuid;
  v_official boolean := coalesce((p_doc->>'official')::boolean, false);
  v_fork     uuid := nullif(p_doc->>'forked_from', '')::uuid;
  v_ftitle   text;
  v_fbyline  text;
  v_row      public.guides;
  v_count    int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  -- The 20-guide cap and the 30-per-hour limit are count-then-insert; this serialises one account's saves so a
  -- parallel burst cannot beat them. (Released at the end of the transaction.)
  perform pg_advisory_xact_lock(hashtextextended(p_user::text, 0));
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
                               forked_from, forked_title, forked_byline, sort_order, updated_by)
    values (case when v_official then null else p_user end,
            case when v_official then 'Team Ascent' else p_doc->>'byline' end,
            v_official, v_official, case when v_official then now() end,
            public.guide_text_array(p_doc->'sets'), public.guide_text_array(p_doc->'tribes'), public.guide_text_array(p_doc->'pairs_with'),
            p_doc->>'icon_card', p_doc->>'title', coalesce(p_doc->>'tagline', ''), p_doc->>'body',
            public.guide_text_array(p_doc->'core'), public.guide_text_array(p_doc->'enablers'), public.guide_text_array(p_doc->'mentions'),
            coalesce(p_doc->'aliases', '{}'::jsonb),
            v_fork, v_ftitle, v_fbyline,
            case when v_official then (select coalesce(max(sort_order), -1) + 1 from public.guides where official) else 0 end,
            p_user)
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
      updated_by = p_user
    where id = v_id
    returning * into v_row;
  end if;

  delete from public.guide_writes where user_id = p_user and at < now() - interval '1 day';
  insert into public.guide_writes (user_id) values (p_user);
  return to_jsonb(v_row);
end $$;

create or replace function public.guide_delete(p_user uuid, p_id uuid) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_team boolean;
  v_row  public.guides;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  v_team := exists (select 1 from public.guide_team where user_id = p_user);
  select * into v_row from public.guides where id = p_id for update;
  if not found then raise exception 'not_found'; end if;
  if not v_team and (v_row.official or v_row.author_id is distinct from p_user) then raise exception 'not_allowed'; end if;
  delete from public.guides where id = p_id;
  return jsonb_build_object('deleted', p_id);
end $$;

create or replace function public.guide_import_builtins(p_user uuid, p_docs jsonb) returns jsonb
language plpgsql security definer set search_path = public as $$
declare
  v_doc  jsonb;
  v_n    bigint;
  v_in   int := 0;
  v_skip int := 0;
  v_base int;
begin
  if p_user is null then raise exception 'unauthenticated'; end if;
  if not exists (select 1 from public.guide_team where user_id = p_user) then raise exception 'not_allowed'; end if;
  v_base := (select coalesce(max(sort_order), -1) + 1 from public.guides where official);
  for v_doc, v_n in select value, ordinality from jsonb_array_elements(case when jsonb_typeof(p_docs) = 'array' then p_docs else '[]'::jsonb end) with ordinality loop
    if coalesce(v_doc->>'slug', '') = '' then v_skip := v_skip + 1; continue; end if;
    insert into public.guides (slug, author_id, byline, official, published, published_at, sets, tribes, pairs_with, icon_card,
                               title, tagline, body, core, enablers, mentions, aliases, sort_order, updated_by)
    values (v_doc->>'slug', null, 'Team Ascent', true, true, now(),
            public.guide_text_array(v_doc->'sets'), public.guide_text_array(v_doc->'tribes'), public.guide_text_array(v_doc->'pairs_with'),
            v_doc->>'icon_card', v_doc->>'title', coalesce(v_doc->>'tagline', ''), v_doc->>'body',
            public.guide_text_array(v_doc->'core'), public.guide_text_array(v_doc->'enablers'), public.guide_text_array(v_doc->'mentions'),
            coalesce(v_doc->'aliases', '{}'::jsonb), v_base + (v_n - 1)::int, p_user)
    on conflict (slug) do nothing;
    if found then v_in := v_in + 1; else v_skip := v_skip + 1; end if;
  end loop;
  return jsonb_build_object('inserted', v_in, 'skipped', v_skip);
end $$;

revoke all on function public.guide_text_array(jsonb) from public, anon, authenticated;
revoke all on function public.guide_save(uuid, jsonb) from public, anon, authenticated;
revoke all on function public.guide_delete(uuid, uuid) from public, anon, authenticated;
revoke all on function public.guide_import_builtins(uuid, jsonb) from public, anon, authenticated;
grant execute on function public.guide_text_array(jsonb) to service_role;
grant execute on function public.guide_save(uuid, jsonb) to service_role;
grant execute on function public.guide_delete(uuid, uuid) to service_role;
grant execute on function public.guide_import_builtins(uuid, jsonb) to service_role;

commit;

-- Tell the REST API about the new tables and functions.
notify pgrst, 'reload schema';
