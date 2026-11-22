-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- MODERATION: the DM report queue and the name filter, for the private dev dashboard's Moderation tab
-- (owner 2026-11-22: "build the reporting dash and account name and party name flags"; feat/dash-moderation;
-- R-NAME-FILTER-01). Read by apps/dash/functions/api/moderation/* with the service role only.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- APPLY AFTER 2026-11-12-direct-messages.sql (+ 2026-11-15-dm-replies.sql, 2026-11-16-dm-retention-1-day.sql),
-- 2026-10-29-ranked-duos.sql (duos_teams), 2026-11-04-versus-cf-writer.sql (versus_cf_writer_keys) and
-- 2026-11-27-analytics-dashboard.sql. ADDITIVE and idempotent (safe to re-run).
--
-- WHAT IT ADDS
--  1. A private `moderation` schema (no API role can reach it): the name filter, the flag queue, the reset memory
--     and the action log.
--  2. The NAME FILTER, `moderation.name_verdict(name)`: a verbatim mirror of packages/sim/src/nameFilter.ts (the same
--     four lists, the same steps; apps/dash/src/server/moderation.db.test.ts fails when they drift).
--       block = a slur: the write is refused with `name_blocked` (the client shows "That name is not allowed. Please
--               pick another one." and checks before saving, so this is the backstop);
--       flag  = allowed, and a row lands in moderation.name_flags for review.
--     Checked by a BEFORE trigger where each name is written, so every write path is covered:
--       profiles.author   (account display name: claimHandle + uploadPlayerProfile, direct table writes)  kind 'account'
--       duos_teams.name   (Duos / Ranked Duos team name: duos_team_set_name)                            kind 'team'
--     The Versus ROOM name lives only in the Cloudflare room (Supabase's versus_rooms is retired, 2026-11-14): the room
--     Worker refuses a blocked name itself (workers/versus/src/core/roomCore.ts) and reports a flagged one through the
--     key-gated `moderation_cf_flag` below (kind 'room'). Guide titles keep their own filter (packages/guides).
--     A moderator's "Reset name" is remembered (moderation.name_resets): that account or team cannot take the same name
--     back (the trigger answers `name_blocked`).
--  3. dm_reports gains status bookkeeping (reviewed_at, reviewed_by, note) and `context`: the few messages around the
--     reported one, copied AT REPORT TIME (messages are pruned after a day, reports keep 180 days; dm_prune unchanged).
--  4. Service-role-only entry points for the dashboard (SECURITY DEFINER, pinned search_path, revoked from public /
--     anon / authenticated): moderation_queue, moderation_search, moderation_review_report, moderation_clear_flag,
--     moderation_reset_name. Every action writes moderation.log (who, when, what, before / after).
--  5. A one-time scan of the names already stored: an existing name that the filter would block or flag gets a flag
--     (severity 'block' for a stored slur), so the queue starts with what is already out there.
--
-- ERRORS (raise exception '<code>'): name_blocked, bad_actor, bad_target, bad_kind, not_found, not_open, bad_key.

create schema if not exists moderation;
revoke all on schema moderation from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then execute 'revoke all on schema moderation from anon, authenticated'; end if;
end
$$;

-- ── 1. The name filter (mirror of packages/sim/src/nameFilter.ts) ─────────────────────────────────────────────
-- Steps 1 to 3: camelCase split, accents stripped, lower case, look-alikes undone (or, p_digits false, every digit
-- read as a space), the runs of a to z.
create or replace function moderation.name_words(p text, p_digits boolean)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select coalesce(array_agg(t.w order by t.ord) filter (where t.w <> ''), '{}'::text[])
  from regexp_split_to_table(
    translate(
      lower(regexp_replace(normalize(
        regexp_replace(regexp_replace(coalesce(p, ''), '([a-z])([A-Z])', '\1 \2', 'g'), '([A-Z])([A-Z][a-z])', '\1 \2', 'g'),
        NFKD), '[̀-ͯ]', '', 'g')),
      '0134579@$!|',
      case when p_digits then 'oieastgasii' else '       asii' end),
    '[^a-z]+') with ordinality as t(w, ord)
$$;

-- Step 4: the forms a term is compared with (runs of 3+ to 2; then repeated vowels to one unless the term has a doubled
-- vowel; every run to one unless the term has a doubled letter).
create or replace function moderation.name_forms(x text, term text)
returns text[]
language sql
immutable
set search_path = pg_catalog
as $$
  select array[regexp_replace(x, '(.)\1{2,}', '\1\1', 'g')]
    || case when term ~ '([aeiou])\1' then '{}'::text[]
            else array[regexp_replace(regexp_replace(x, '(.)\1{2,}', '\1\1', 'g'), '([aeiou])\1+', '\1', 'g')] end
    || case when term ~ '(.)\1' then '{}'::text[] else array[regexp_replace(x, '(.)\1+', '\1', 'g')] end
$$;

-- Step 5: the first SUB term found anywhere in the joined words, else the first WORD term matching a whole word.
create or replace function moderation.name_hit(p_words text[], p_sub text[], p_word text[], p_end text[])
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  v_joined text := array_to_string(p_words, '');
  t text;
  w text;
  f text;
begin
  foreach t in array p_sub loop
    foreach f in array moderation.name_forms(v_joined, t) loop
      if position(t in f) > 0 then return t; end if;
    end loop;
  end loop;
  foreach t in array p_word loop
    foreach w in array p_words loop
      foreach f in array moderation.name_forms(w, t) loop
        if f = any (array(select t || e from unnest(p_end) as e)) then return t; end if;
      end loop;
    end loop;
  end loop;
  return null;
end;
$$;

-- { verdict: 'ok' | 'flag' | 'block', term }. The four lists are packages/sim/src/nameFilter.ts's, verbatim.
create or replace function moderation.name_verdict(p text)
returns jsonb
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare
  c_block_sub constant text[] := array['nigger', 'nigga', 'faggot', 'tranny', 'wetback'];
  c_block_words constant text[] := array['fag', 'kike', 'spic', 'chink', 'gook', 'coon', 'dyke', 'retard', 'retarded'];
  c_flag_sub constant text[] := array['fuck', 'fuk', 'fck', 'shit', 'cunt', 'bitch', 'pussy', 'whore', 'slut', 'asshole', 'arsehole', 'twat', 'wank', 'jizz',
    'dildo', 'cocksuck', 'dickhead', 'porn', 'penis', 'vagina', 'boob', 'hentai', 'killyourself',
    'teamascent', 'ascentteam', 'ascentofficial', 'ascentstaff'];
  c_flag_words constant text[] := array['ass', 'arse', 'tits', 'cum', 'cock', 'dick', 'prick', 'bastard', 'sex', 'anal', 'kys', 'stfu', 'gtfo', 'wtf',
    'rape', 'rapist', 'nazi', 'hitler', 'heil', 'negro',
    'admin', 'administrator', 'moderator', 'mod', 'developer', 'official', 'staff'];
  c_block_end constant text[] := array['', 's', 'z'];
  c_flag_end constant text[] := array['', 's', 'es', 'z', 'ed', 'er', 'ers', 'ing', 'y'];
  v_words text[];
  v_hit text;
  r int;
begin
  for r in 1..2 loop
    v_words := moderation.name_words(p, r = 1);
    continue when cardinality(v_words) = 0;
    v_hit := moderation.name_hit(v_words, c_block_sub, c_block_words, c_block_end);
    if v_hit is not null then return jsonb_build_object('verdict', 'block', 'term', v_hit); end if;
  end loop;
  for r in 1..2 loop
    v_words := moderation.name_words(p, r = 1);
    continue when cardinality(v_words) = 0;
    v_hit := moderation.name_hit(v_words, c_flag_sub, c_flag_words, c_flag_end);
    if v_hit is not null then return jsonb_build_object('verdict', 'flag', 'term', v_hit); end if;
  end loop;
  return jsonb_build_object('verdict', 'ok', 'term', null);
end;
$$;

-- The key a reset remembers (mirror of nameKey): the joined words, every run squeezed to one letter.
create or replace function moderation.name_key(p text)
returns text
language sql
immutable
set search_path = pg_catalog
as $$
  select regexp_replace(array_to_string(moderation.name_words(p, true), ''), '(.)\1+', '\1', 'g')
$$;

-- ── 2. Tables (private schema, no API role) ──────────────────────────────────────────────────────────────────
create table if not exists moderation.name_flags (
  id          uuid primary key default gen_random_uuid(),
  kind        text not null check (kind in ('account', 'team', 'room')),
  target_id   text not null check (char_length(target_id) between 1 and 64),
  name        text not null check (char_length(name) <= 64),
  term        text,
  severity    text not null default 'flag' check (severity in ('flag', 'block')),
  owner_user  uuid,
  status      text not null default 'open' check (status in ('open', 'cleared', 'reset', 'closed')),
  created_at  timestamptz not null default now(),
  reviewed_at timestamptz,
  reviewed_by text,
  note        text check (note is null or char_length(note) <= 500)
);
-- One open flag per target: a second flagged name while one is open replaces it (the newest name is what matters).
create unique index if not exists name_flags_open_one on moderation.name_flags (kind, target_id) where status = 'open';
create index if not exists name_flags_queue on moderation.name_flags (status, created_at desc);

create table if not exists moderation.name_resets (
  kind        text not null,
  target_id   text not null,
  name_key    text not null,
  created_at  timestamptz not null default now(),
  primary key (kind, target_id, name_key)
);

create table if not exists moderation.log (
  id          bigint generated always as identity primary key,
  at          timestamptz not null default now(),
  actor       text not null,
  action      text not null check (action in ('review_report', 'clear_flag', 'reset_name')),
  kind        text,
  target_id   text,
  before      jsonb,
  after       jsonb,
  note        text
);
create index if not exists moderation_log_at on moderation.log (at desc);

alter table moderation.name_flags enable row level security;
alter table moderation.name_resets enable row level security;
alter table moderation.log enable row level security;
revoke all on all tables in schema moderation from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all tables in schema moderation from anon, authenticated, service_role';
  end if;
end
$$;

-- ── 3. The guard on each name column ─────────────────────────────────────────────────────────────────────────
create or replace function moderation.name_guard()
returns trigger
language plpgsql
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_kind text;
  v_name text;
  v_old text;
  v_target text;
  v_owner uuid;
  v jsonb;
begin
  if tg_table_name = 'profiles' then
    v_kind := 'account'; v_name := new.author; v_target := new.user_id::text; v_owner := new.user_id;
    if tg_op = 'UPDATE' then v_old := old.author; end if;
  elsif tg_table_name = 'duos_teams' then
    v_kind := 'team'; v_name := new.name; v_target := new.id::text; v_owner := new.user_lo;
    if tg_op = 'UPDATE' then v_old := old.name; end if;
  else
    return new;
  end if;
  if tg_op = 'UPDATE' and v_name is not distinct from v_old then return new; end if;
  if v_name is null or btrim(v_name) = '' then return new; end if;
  v := moderation.name_verdict(v_name);
  if v->>'verdict' = 'block' then raise exception 'name_blocked'; end if;
  if v_target is not null and exists (select 1 from moderation.name_resets r
      where r.kind = v_kind and r.target_id = v_target and r.name_key = moderation.name_key(v_name)) then
    raise exception 'name_blocked';
  end if;
  if v_target is null then return new; end if;
  if v->>'verdict' = 'flag' then
    insert into moderation.name_flags (kind, target_id, name, term, severity, owner_user)
    values (v_kind, v_target, left(v_name, 64), v->>'term', 'flag', v_owner)
    on conflict (kind, target_id) where status = 'open'
      do update set name = excluded.name, term = excluded.term, severity = excluded.severity, created_at = now();
  else
    -- Renamed to a clean name: an open flag on the old one has nothing left to review.
    update moderation.name_flags set status = 'closed', reviewed_at = now(), reviewed_by = 'system', note = 'Renamed'
    where kind = v_kind and target_id = v_target and status = 'open';
  end if;
  return new;
end;
$$;

drop trigger if exists profiles_name_guard on public.profiles;
create trigger profiles_name_guard before insert or update of author on public.profiles
  for each row execute function moderation.name_guard();
drop trigger if exists duos_teams_name_guard on public.duos_teams;
create trigger duos_teams_name_guard before insert or update of name on public.duos_teams
  for each row execute function moderation.name_guard();

-- ── 4. DM reports: bookkeeping + the context copied at report time ───────────────────────────────────────────
alter table public.dm_reports add column if not exists reviewed_at timestamptz;
alter table public.dm_reports add column if not exists reviewed_by text;
alter table public.dm_reports add column if not exists note text;
alter table public.dm_reports add column if not exists context jsonb;
alter table public.dm_reports drop constraint if exists dm_reports_note_len;
alter table public.dm_reports add constraint dm_reports_note_len check (note is null or char_length(note) <= 500);
create index if not exists dm_reports_sender on public.dm_reports (sender);

-- The messages needed to judge a report: up to 3 before and 2 after the reported one in that conversation, and the
-- reported one itself (from the report's own copy when the original is gone). `by` is 'reported' (the sender) or
-- 'reporter'. Bodies only; no ids of other conversations.
create or replace function moderation.dm_context(p_sender uuid, p_reporter uuid, p_message uuid, p_body text, p_at timestamptz)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  with pair as (
    select d.id, d.sender, d.body, d.created_at from public.direct_messages d
    where ((d.sender = p_sender and d.recipient = p_reporter) or (d.sender = p_reporter and d.recipient = p_sender))
      and d.id <> p_message
  ), around as (
    (select * from pair where created_at <= p_at order by created_at desc limit 3)
    union all
    (select * from pair where created_at > p_at order by created_at asc limit 2)
    union all
    select p_message, p_sender, p_body, p_at
  )
  select coalesce(jsonb_agg(jsonb_build_object('id', a.id, 'by', case when a.sender = p_sender then 'reported' else 'reporter' end,
    'body', a.body, 'at', a.created_at) order by a.created_at, (a.id = p_message)), '[]'::jsonb)
  from around a
$$;

-- R-DM-01..05's report, unchanged for the player, now keeping the context (a second report still answers the first).
create or replace function public.dm_report(p_message uuid, p_reason text default 'other')
returns jsonb
language plpgsql security definer set search_path = public as $$
declare v_me uuid := public.friends__me(); v_m public.direct_messages; v_reason text := coalesce(p_reason, 'other');
begin
  if v_reason not in ('abuse', 'spam', 'cheating', 'other') then raise exception 'bad_reason'; end if;
  select * into v_m from public.direct_messages where id = p_message and recipient = v_me;
  if not found then raise exception 'not_found'; end if;
  insert into public.dm_reports (reporter, message_id, sender, body, sent_at, reason, context)
  values (v_me, v_m.id, v_m.sender, v_m.body, v_m.created_at, v_reason,
    moderation.dm_context(v_m.sender, v_me, v_m.id, v_m.body, v_m.created_at))
  on conflict (reporter, message_id) do nothing;
  return jsonb_build_object('reported', true);
end;
$$;
revoke all on function public.dm_report(uuid, text) from public, anon;
grant execute on function public.dm_report(uuid, text) to authenticated;

-- ── 5. The dashboard's reads (service role only) ─────────────────────────────────────────────────────────────
create or replace function moderation.who(p_user uuid)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public
as $$
  select case when p_user is null then null
    else jsonb_build_object('id', p_user, 'name', (select p.author from public.profiles p where p.user_id = p_user),
      'tag', (select p.discriminator from public.profiles p where p.user_id = p_user)) end
$$;

-- The current name and the people behind a flag's target.
create or replace function moderation.target(p_kind text, p_target text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, moderation
as $$
declare v_id uuid; t public.duos_teams;
begin
  if p_target !~ '^[0-9a-fA-F-]{36}$' then return jsonb_build_object('exists', false); end if;
  v_id := p_target::uuid;
  if p_kind = 'account' then
    return coalesce((select jsonb_build_object('exists', true, 'name', p.author, 'tag', p.discriminator)
      from public.profiles p where p.user_id = v_id), jsonb_build_object('exists', false));
  elsif p_kind = 'team' then
    select * into t from public.duos_teams where id = v_id;
    if not found then return jsonb_build_object('exists', false); end if;
    return jsonb_build_object('exists', true, 'name', t.name, 'members', jsonb_build_array(moderation.who(t.user_lo), moderation.who(t.user_hi)));
  end if;
  return jsonb_build_object('exists', false);
end;
$$;

create or replace function moderation.report_json(r public.dm_reports)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, moderation
as $$
  select jsonb_build_object(
    'id', r.id, 'createdAt', r.created_at, 'reason', r.reason, 'status', r.status,
    'reviewedAt', r.reviewed_at, 'reviewedBy', r.reviewed_by, 'note', r.note,
    'messageId', r.message_id, 'body', r.body, 'sentAt', r.sent_at,
    'reporter', moderation.who(r.reporter), 'sender', moderation.who(r.sender),
    'senderReports', (select count(*) from public.dm_reports s where s.sender = r.sender),
    'senderOpen', (select count(*) from public.dm_reports s where s.sender = r.sender and s.status = 'open'),
    'context', coalesce(r.context, moderation.dm_context(r.sender, r.reporter, r.message_id, r.body, r.sent_at)))
$$;

create or replace function moderation.flag_json(f moderation.name_flags)
returns jsonb
language sql
stable
security definer
set search_path = pg_catalog, public, moderation
as $$
  select jsonb_build_object(
    'id', f.id, 'kind', f.kind, 'targetId', f.target_id, 'name', f.name, 'term', f.term, 'severity', f.severity,
    'status', f.status, 'createdAt', f.created_at, 'reviewedAt', f.reviewed_at, 'reviewedBy', f.reviewed_by, 'note', f.note,
    'owner', moderation.who(f.owner_user), 'current', moderation.target(f.kind, f.target_id),
    'canReset', f.kind in ('account', 'team'))
$$;

-- p_reports: 'open' | 'reviewed' | 'all'. p_names: 'open' | 'done' | 'all'. Newest first; the log's newest 50.
create or replace function public.moderation_queue(p_reports text default 'open', p_names text default 'open', p_limit int default 100)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_lim int := greatest(1, least(coalesce(p_limit, 100), 200));
  v_rep text := coalesce(p_reports, 'open');
  v_nam text := coalesce(p_names, 'open');
begin
  return jsonb_build_object(
    'counts', jsonb_build_object(
      'reports', (select count(*) from public.dm_reports where status = 'open'),
      'names', (select count(*) from moderation.name_flags where status = 'open')),
    'reports', coalesce((select jsonb_agg(moderation.report_json(x.row) order by x.at desc) from (
        select r as row, r.created_at as at from public.dm_reports r
        where case v_rep when 'open' then r.status = 'open' when 'reviewed' then r.status <> 'open' else true end
        order by r.created_at desc limit v_lim) x), '[]'::jsonb),
    'names', coalesce((select jsonb_agg(moderation.flag_json(x.row) order by x.at desc) from (
        select f as row, f.created_at as at from moderation.name_flags f
        where case v_nam when 'open' then f.status = 'open' when 'done' then f.status <> 'open' else true end
        order by f.created_at desc limit v_lim) x), '[]'::jsonb),
    'log', coalesce((select jsonb_agg(jsonb_build_object('id', l.id, 'at', l.at, 'actor', l.actor, 'action', l.action,
        'kind', l.kind, 'targetId', l.target_id, 'before', l.before, 'after', l.after, 'note', l.note) order by l.at desc, l.id desc)
      from (select * from moderation.log order by at desc, id desc limit 50) l), '[]'::jsonb));
end;
$$;

-- Any account or team by name: "Name#1234" (exact handle), an id, or part of a name. 25 of each at most.
create or replace function public.moderation_search(p_q text)
returns jsonb
language plpgsql
stable
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_q text := left(btrim(coalesce(p_q, '')), 64);
  v_like text;
  v_name text;
  v_tag text;
  v_id uuid;
begin
  if v_q = '' then return jsonb_build_object('q', v_q, 'accounts', '[]'::jsonb, 'teams', '[]'::jsonb); end if;
  v_like := '%' || replace(replace(replace(v_q, '\', '\\'), '%', '\%'), '_', '\_') || '%';
  if v_q ~ '^.+#[0-9]{4}$' then
    v_name := substring(v_q from '^(.+)#[0-9]{4}$');
    v_tag := substring(v_q from '#([0-9]{4})$');
  end if;
  if v_q ~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then v_id := v_q::uuid; end if;
  return jsonb_build_object(
    'q', v_q,
    'accounts', coalesce((select jsonb_agg(jsonb_build_object('id', p.user_id, 'name', p.author, 'tag', p.discriminator,
        'verdict', moderation.name_verdict(p.author),
        'openFlag', exists (select 1 from moderation.name_flags f where f.kind = 'account' and f.target_id = p.user_id::text and f.status = 'open'))
        order by lower(p.author), p.discriminator)
      from (select * from public.profiles p
        where p.author is not null and (
          (v_id is not null and p.user_id = v_id)
          or (v_tag is not null and lower(p.author) = lower(v_name) and p.discriminator = v_tag)
          or (v_tag is null and v_id is null and p.author ilike v_like))
        order by lower(p.author), p.discriminator limit 25) p), '[]'::jsonb),
    'teams', coalesce((select jsonb_agg(jsonb_build_object('id', t.id, 'name', t.name,
        'members', jsonb_build_array(moderation.who(t.user_lo), moderation.who(t.user_hi)),
        'verdict', moderation.name_verdict(t.name),
        'openFlag', exists (select 1 from moderation.name_flags f where f.kind = 'team' and f.target_id = t.id::text and f.status = 'open'))
        order by lower(t.name))
      from (select * from public.duos_teams t
        where t.name is not null and ((v_id is not null and t.id = v_id) or (v_id is null and t.name ilike v_like))
        order by lower(t.name) limit 25) t), '[]'::jsonb));
end;
$$;

-- ── 6. The dashboard's actions (service role only; each one logged) ──────────────────────────────────────────
create or replace function moderation.actor(p_actor text)
returns text
language plpgsql
immutable
set search_path = pg_catalog
as $$
declare v text := btrim(coalesce(p_actor, ''));
begin
  if v = '' or char_length(v) > 200 then raise exception 'bad_actor'; end if;
  return lower(v);
end;
$$;

create or replace function public.moderation_review_report(p_actor text, p_report uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_actor text := moderation.actor(p_actor);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  r public.dm_reports;
  v_before jsonb;
begin
  select * into r from public.dm_reports where id = p_report for update;
  if not found then raise exception 'not_found'; end if;
  v_before := jsonb_build_object('status', r.status, 'note', r.note);
  update public.dm_reports set status = 'reviewed', reviewed_at = now(), reviewed_by = v_actor, note = coalesce(v_note, note)
  where id = p_report returning * into r;
  insert into moderation.log (actor, action, kind, target_id, before, after, note)
  values (v_actor, 'review_report', 'dm_report', r.id::text, v_before, jsonb_build_object('status', r.status, 'note', r.note), v_note);
  return jsonb_build_object('ok', true, 'report', moderation.report_json(r));
end;
$$;

create or replace function public.moderation_clear_flag(p_actor text, p_flag uuid, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_actor text := moderation.actor(p_actor);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  f moderation.name_flags;
begin
  select * into f from moderation.name_flags where id = p_flag for update;
  if not found then raise exception 'not_found'; end if;
  if f.status <> 'open' then raise exception 'not_open'; end if;
  update moderation.name_flags set status = 'cleared', reviewed_at = now(), reviewed_by = v_actor, note = v_note
  where id = p_flag returning * into f;
  insert into moderation.log (actor, action, kind, target_id, before, after, note)
  values (v_actor, 'clear_flag', f.kind, f.target_id, jsonb_build_object('status', 'open', 'name', f.name),
    jsonb_build_object('status', f.status, 'name', f.name), v_note);
  return jsonb_build_object('ok', true, 'flag', moderation.flag_json(f));
end;
$$;

-- Account: the name becomes "Player" and keeps its #tag unless "Player#tag" is taken (then a free random tag, as the
-- client's claimHandle would pick). Team: the name is cleared, so it shows its default "Name1 & Name2" again. Rooms
-- live only in the Cloudflare room, so they cannot be reset from here (bad_kind). The old name is remembered.
create or replace function public.moderation_reset_name(p_actor text, p_kind text, p_target text, p_note text default null)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, moderation
as $$
declare
  v_actor text := moderation.actor(p_actor);
  v_note text := nullif(left(btrim(coalesce(p_note, '')), 500), '');
  v_id uuid;
  p public.profiles;
  t public.duos_teams;
  v_tag text;
  v_try int := 0;
  v_before jsonb;
  v_after jsonb;
  v_old text;
begin
  if p_kind not in ('account', 'team') then raise exception 'bad_kind'; end if;
  if coalesce(p_target, '') !~ '^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$' then raise exception 'bad_target'; end if;
  v_id := p_target::uuid;
  -- The open flags close as 'reset' FIRST: the rename below fires the guard, which would close them as 'Renamed'.
  update moderation.name_flags set status = 'reset', reviewed_at = now(), reviewed_by = v_actor, note = v_note
  where kind = p_kind and target_id = v_id::text and status = 'open';
  if p_kind = 'account' then
    select * into p from public.profiles where user_id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    v_old := p.author;
    v_tag := p.discriminator;
    while v_tag is not null and exists (select 1 from public.profiles o
        where o.user_id <> v_id and lower(o.author) = 'player' and o.discriminator = v_tag) loop
      v_try := v_try + 1;
      if v_try > 50 then raise exception 'no_free_tag'; end if;
      v_tag := (1000 + floor(random() * 9000))::int::text;
    end loop;
    v_before := jsonb_build_object('name', p.author, 'tag', p.discriminator);
    update public.profiles set author = 'Player', discriminator = v_tag, updated_at = now() where user_id = v_id;
    v_after := jsonb_build_object('name', 'Player', 'tag', v_tag);
  else
    select * into t from public.duos_teams where id = v_id for update;
    if not found then raise exception 'not_found'; end if;
    v_old := t.name;
    v_before := jsonb_build_object('name', t.name);
    update public.duos_teams set name = null, updated_at = now() where id = v_id;
    v_after := jsonb_build_object('name', null);
  end if;
  if v_old is not null and moderation.name_key(v_old) <> '' then
    insert into moderation.name_resets (kind, target_id, name_key) values (p_kind, v_id::text, moderation.name_key(v_old))
    on conflict do nothing;
  end if;
  insert into moderation.log (actor, action, kind, target_id, before, after, note)
  values (v_actor, 'reset_name', p_kind, v_id::text, v_before, v_after, v_note);
  return jsonb_build_object('ok', true, 'before', v_before, 'after', v_after);
end;
$$;

-- ── 7. The room Worker's flag (key-gated, like versus_cf_persist; the SQL re-reads the name itself) ──────────
create or replace function public.moderation_cf_flag(p_key text, p_room text, p_name text, p_owner uuid)
returns jsonb
language plpgsql
security definer
set search_path = pg_catalog, public, moderation
as $$
declare v jsonb;
begin
  if p_key is null or not exists (select 1 from public.versus_cf_writer_keys k
      where k.key_hash = encode(sha256(convert_to(p_key, 'UTF8')), 'hex')) then
    raise exception 'bad_key';
  end if;
  if coalesce(btrim(p_room), '') = '' or p_name is null then raise exception 'bad_target'; end if;
  v := moderation.name_verdict(p_name);
  if v->>'verdict' = 'ok' then return jsonb_build_object('flagged', false); end if;
  insert into moderation.name_flags (kind, target_id, name, term, severity, owner_user)
  values ('room', left(btrim(p_room), 64), left(p_name, 64), v->>'term', v->>'verdict', p_owner)
  on conflict (kind, target_id) where status = 'open'
    do update set name = excluded.name, term = excluded.term, severity = excluded.severity, created_at = now();
  return jsonb_build_object('flagged', true);
end;
$$;

-- ── 8. Grants: the dashboard's five to the service role only; the Worker's one is key-gated ──────────────────
revoke all on all functions in schema moderation from public;
revoke all on function public.moderation_queue(text, text, int), public.moderation_search(text),
  public.moderation_review_report(text, uuid, text), public.moderation_clear_flag(text, uuid, text),
  public.moderation_reset_name(text, text, text, text), public.moderation_cf_flag(text, text, text, uuid) from public;
do $$
begin
  if exists (select 1 from pg_roles where rolname = 'anon') then
    execute 'revoke all on all functions in schema moderation from anon, authenticated, service_role';
    execute 'revoke all on function public.moderation_queue(text, text, int), public.moderation_search(text),
      public.moderation_review_report(text, uuid, text), public.moderation_clear_flag(text, uuid, text),
      public.moderation_reset_name(text, text, text, text) from anon, authenticated';
    execute 'grant execute on function public.moderation_queue(text, text, int), public.moderation_search(text),
      public.moderation_review_report(text, uuid, text), public.moderation_clear_flag(text, uuid, text),
      public.moderation_reset_name(text, text, text, text) to service_role';
    execute 'grant execute on function public.moderation_cf_flag(text, text, text, uuid) to anon, authenticated';
  end if;
end
$$;

-- ── 9. The names already stored (one scan; a re-run adds nothing it already flagged) ─────────────────────────
insert into moderation.name_flags (kind, target_id, name, term, severity, owner_user)
select 'account', p.user_id::text, left(p.author, 64), x.v->>'term', x.v->>'verdict', p.user_id
from public.profiles p cross join lateral (select moderation.name_verdict(p.author) as v) x
where p.author is not null and x.v->>'verdict' <> 'ok'
  and not exists (select 1 from moderation.name_flags f where f.kind = 'account' and f.target_id = p.user_id::text and f.name = left(p.author, 64))
on conflict do nothing;

insert into moderation.name_flags (kind, target_id, name, term, severity, owner_user)
select 'team', t.id::text, left(t.name, 64), x.v->>'term', x.v->>'verdict', t.user_lo
from public.duos_teams t cross join lateral (select moderation.name_verdict(t.name) as v) x
where t.name is not null and x.v->>'verdict' <> 'ok'
  and not exists (select 1 from moderation.name_flags f where f.kind = 'team' and f.target_id = t.id::text and f.name = left(t.name, 64))
on conflict do nothing;
