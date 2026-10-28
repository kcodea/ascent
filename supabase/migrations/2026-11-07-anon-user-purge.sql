-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- EMPTY ANONYMOUS USER PURGE (2026-11-07, chore/purge-empty-anon-users; docs/design/2026-10-28-supabase-cleanup.md
-- S8 / Phase 4.3). OWNER RULING 2026-10-28: "yes, purge empty ones". Idempotent. Creates tools only: applying this
-- file deletes NOTHING. The lead runs the report, then the batches, by hand.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Every install signs in anonymously at boot, so new browsers, headless test runs, Claudebots and Versus test bots leave
-- auth users behind (2,529 anonymous of 2,534 on 2026-10-28). A purge CANDIDATE is an auth user that is ALL of:
--   1. anonymous: is_anonymous, no email, no pending email change, no phone, no identity row (never an email account);
--   2. owns NOTHING: its id appears in no uuid / uuid[] column of any table in `public` or `storage` (found from the
--      catalog at run time, so a table added later is covered without editing this file; this includes every foreign key
--      to auth.users AND the non-FK user columns: versus seats/members/submissions, duos_teams, friendships.requester,
--      pool_runs, client_crash_reports, storage.objects.owner, ...), and in no uuid-shaped text inside any jsonb/text
--      column of a public table under 32 MB (duo_runs.members, Versus jsonb, ...) or storage.objects.owner_id.
--      A false match (a match id that equals a user id) can only KEEP a user, never delete one;
--   3. idle: its last sign-in, last update, last session refresh and last refresh-token use are all older than the window
--      (default 30 days, minimum 7). A brand-new guest with no data yet is never touched.
--
-- Functions (schema `maint`, closed to the client roles; run as `postgres`, e.g. `supabase db query --linked`):
--   select * from maint.anon_purge_report();                         -- dry run: counts only, writes nothing
--   select * from maint.anon_purge_candidates() limit 20;             -- dry run: who, created, last seen
--   select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS');    -- deletes ONE batch (200), logs each id
--   select maint.anon_purge_batch('DELETE EMPTY ANONYMOUS USERS', interval '30 days', 500);
-- Each batch re-derives the candidates in its own transaction, locks the rows (skip locked) and logs every deleted id to
-- maint.anon_purge_log. Deleting an auth user cascades only into auth.* (sessions, refresh tokens): it owns no public
-- row by definition. Repeat batches until one returns 0. A purged guest's next visit simply signs in fresh.
--
-- Rollback: `drop schema maint cascade;` removes the tools (and the log). Deleted users cannot be restored; they owned
-- no data, and the log keeps their ids.

create schema if not exists maint;
revoke all on schema maint from public, anon, authenticated;

create table if not exists maint.anon_purge_log (
  user_id         uuid primary key,
  user_created_at timestamptz,
  last_seen       timestamptz,
  purged_at       timestamptz not null default now()
);
revoke all on maint.anon_purge_log from public, anon, authenticated;

-- Every id that any public/storage row could be pointing at, into the session temp table _anon_refs.
create or replace function maint.anon_collect_refs() returns bigint
language plpgsql set search_path = pg_catalog, public as $$
declare
  c record;
  n bigint;
  uuid_re constant text := '[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}';
begin
  create temp table if not exists _anon_refs (uid uuid primary key);
  truncate _anon_refs;
  -- uuid and uuid[] columns: every table in public and storage.
  for c in
    select ns.nspname, cl.relname, a.attname, a.atttypid = 'uuid[]'::regtype as arr
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname in ('public', 'storage') and cl.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('uuid'::regtype, 'uuid[]'::regtype)
  loop
    if c.arr then
      execute format('insert into _anon_refs select distinct x from %I.%I, unnest(%I) x where x is not null on conflict do nothing', c.nspname, c.relname, c.attname);
    else
      execute format('insert into _anon_refs select distinct %I from %I.%I where %I is not null on conflict do nothing', c.attname, c.nspname, c.relname, c.attname);
    end if;
  end loop;
  -- user ids written inside jsonb / text (duo_runs.members, Versus payloads): public tables under 32 MB.
  for c in
    select ns.nspname, cl.relname, a.attname
    from pg_attribute a join pg_class cl on cl.oid = a.attrelid join pg_namespace ns on ns.oid = cl.relnamespace
    where ns.nspname = 'public' and cl.relkind in ('r', 'p') and a.attnum > 0 and not a.attisdropped
      and a.atttypid in ('jsonb'::regtype, 'json'::regtype, 'text'::regtype, 'character varying'::regtype)
      and pg_total_relation_size(cl.oid) < 32 * 1024 * 1024
  loop
    execute format('insert into _anon_refs select distinct lower(m[1])::uuid from %I.%I t, regexp_matches(t.%I::text, %L, ''g'') m on conflict do nothing',
      c.nspname, c.relname, c.attname, '(' || uuid_re || ')');
  end loop;
  if to_regclass('storage.objects') is not null then
    insert into _anon_refs select distinct lower(owner_id)::uuid from storage.objects where owner_id ~ ('^' || uuid_re || '$') on conflict do nothing;
  end if;
  select count(*) into n from _anon_refs;
  return n;
end $$;

-- The candidates: anonymous, owning nothing, idle for p_idle. Read-only (apart from the session temp table).
create or replace function maint.anon_purge_candidates(p_idle interval default interval '30 days')
returns table (user_id uuid, created_at timestamptz, last_seen timestamptz)
language plpgsql set search_path = pg_catalog, public as $$
begin
  perform maint.anon_collect_refs();
  return query
  with anon as (
    select u.id, u.created_at,
      greatest(u.created_at, u.updated_at, u.last_sign_in_at,
        (select max(greatest(s.updated_at, s.refreshed_at at time zone 'utc')) from auth.sessions s where s.user_id = u.id),
        (select max(r.updated_at) from auth.refresh_tokens r where r.user_id = u.id::text)) as seen
    from auth.users u
    where u.is_anonymous is true
      and coalesce(u.email, '') = '' and coalesce(u.email_change, '') = ''
      and coalesce(u.phone, '') = '' and coalesce(u.phone_change, '') = ''
      and not exists (select 1 from auth.identities i where i.user_id = u.id)
      and not exists (select 1 from _anon_refs r where r.uid = u.id)
  )
  select a.id, a.created_at, a.seen from anon a where a.seen < now() - p_idle order by a.seen, a.id;
end $$;

-- The dry run: counts only.
create or replace function maint.anon_purge_report(p_idle interval default interval '30 days')
returns table (metric text, n bigint)
language plpgsql set search_path = pg_catalog, public as $$
declare
  refs bigint;
  cand bigint;
begin
  create temp table if not exists _anon_cand (user_id uuid primary key);
  truncate _anon_cand;
  insert into _anon_cand select c.user_id from maint.anon_purge_candidates(p_idle) c;
  select count(*) into cand from _anon_cand;
  select count(*) into refs from _anon_refs;
  return query
    select 'auth users', count(*) from auth.users
    union all select 'email / phone / identity accounts (never touched)', count(*) from auth.users u
      where u.is_anonymous is not true or coalesce(u.email, '') <> '' or coalesce(u.email_change, '') <> '' or coalesce(u.phone, '') <> ''
        or exists (select 1 from auth.identities i where i.user_id = u.id)
    union all select 'anonymous', count(*) from auth.users where is_anonymous is true
    union all select 'anonymous owning data (kept)', count(*) from auth.users u where u.is_anonymous is true and exists (select 1 from _anon_refs r where r.uid = u.id)
    union all select 'anonymous owning nothing', count(*) from auth.users u where u.is_anonymous is true and not exists (select 1 from _anon_refs r where r.uid = u.id)
    union all select 'ids referenced anywhere (scan)', refs
    union all select 'PURGE CANDIDATES (anonymous, nothing, idle ' || p_idle::text || ')', cand;
end $$;

-- One batch. Deletes only on the exact confirmation phrase.
create or replace function maint.anon_purge_batch(p_confirm text, p_idle interval default interval '30 days', p_limit int default 200)
returns int
language plpgsql set search_path = pg_catalog, public as $$
declare
  n int;
begin
  if p_confirm is distinct from 'DELETE EMPTY ANONYMOUS USERS' then
    raise exception 'anon_purge_batch: pass the phrase ''DELETE EMPTY ANONYMOUS USERS'' (run maint.anon_purge_report() first)';
  end if;
  if p_idle < interval '7 days' then raise exception 'anon_purge_batch: the idle window must be at least 7 days'; end if;
  if p_limit is null or p_limit < 1 or p_limit > 1000 then raise exception 'anon_purge_batch: batch size 1..1000'; end if;

  with c as (
    select * from maint.anon_purge_candidates(p_idle) limit p_limit
  ), locked as (
    select u.id from auth.users u join c on c.user_id = u.id where u.is_anonymous is true for update of u skip locked
  ), del as (
    delete from auth.users u using locked l where u.id = l.id and u.is_anonymous is true returning u.id
  )
  insert into maint.anon_purge_log (user_id, user_created_at, last_seen)
  select d.id, c.created_at, c.last_seen from del d join c on c.user_id = d.id
  on conflict (user_id) do nothing;
  get diagnostics n = row_count;
  return n;
end $$;

revoke all on function maint.anon_collect_refs() from public, anon, authenticated;
revoke all on function maint.anon_purge_candidates(interval) from public, anon, authenticated;
revoke all on function maint.anon_purge_report(interval) from public, anon, authenticated;
revoke all on function maint.anon_purge_batch(text, interval, int) from public, anon, authenticated;
