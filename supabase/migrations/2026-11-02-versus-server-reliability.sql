-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- VERSUS SERVER RELIABILITY (2026-11-02, fix/versus-server-reliability). Run AFTER 2026-11-01-versus-ready-signal.sql.
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner 2026-10-27, after a night of End of Turn freezes: Versus 1v1, Group, Duos and Ranked Duos "need to be spotless
-- experiences"; "disconnect/reconnects werent done correctly, where it would simply pause when someone returned".
-- Every mode, server side (the client half is fix/versus-client-reliability):
--
--   1. ONE RESOLVER PER ROUND (R-VERSUS-CLOSE-ONCE-01). Every call that can close a round (versus_submit,
--      versus_reconcile, versus_group_submit, versus_group_reconcile, versus_ranked_duos_submit,
--      versus_ranked_duos_reconcile) answers `closed_by_me: true` on exactly the ONE call that moved the round from
--      shop to resolving (the match row lock makes it one), `false` on every other. Only that caller kicks
--      versus-resolve. A duplicate resolver save of a committed round answers from a plain read with no lock
--      (`alreadyCommitted: true`), so a burst of saves never queues on the match row.
--   2. A RETURNING PLAYER RESUMES THE PAUSE (R-VERSUS-AUTO-RESUME-01). A heartbeat from the paused (absent) player starts
--      the same server 3-2-1 that their Unpause does (resume_at = now + 3 s). Hero Select pauses too. After the 30 s
--      grace any other player may still Unpause (unchanged: versus_unpause / versus_group_unpause).
--   3. NO FALSE PAUSES FROM LOCK WAITS (R-VERSUS-LEASE-01). The heartbeat writes last_seen_at without the match row
--      lock; it takes the lock only when it must change the match (clear its own auto flag, start the 3-2-1), under a
--      2 s lock_timeout, and a busy match just skips that step (the next beat retries) and still records the beat.
--      Reconcile reads first and returns WITHOUT any lock when nothing is due. The lease is 14 s (was 12 s): with a 4 s
--      beat that is two whole missed beats (t+4, t+8) plus a third (t+12) allowed 2 s of round trip or lock wait, so
--      one slow beat can never pause a match, and a real disconnect still pauses within ~14 s. Lock order unchanged:
--      match, room, members (R-VERSUS-LOCK-ORDER-01).
--   4. NO ROUND SITS IN RESOLVING (R-VERSUS-RESOLVE-TIMEOUT-01). A round that enters resolving gets resolving_since and
--      resolve_deadline (+10 s). Each reconcile past the deadline bumps resolve_retry (and the revision, so every client
--      sees it) and sets a new 10 s deadline: a client that sees resolve_retry go up kicks versus-resolve once, whoever
--      closed. After 90 s in resolving (pauses excluded), or at the first window after versus-resolve reported that the
--      match's own content can never resolve on this server (engine/content mismatch), the match ends as 'void': no
--      winner, nobody charged, Ranked Duos unrated ('void'). Ending is the safe, deterministic choice: replaying a
--      round or inventing a result would put the two clients' runs out of step with the committed rounds.
--   5. ONE SWEEP (R-VERSUS-SWEEP-01). versus_sweep() ends any 1v1 / Group / Duos match whose players have all been silent
--      for 10 minutes ('abandoned'), runs the Ranked Duos abandoned sweep, and prunes versus_events older than 14 days.
--      Every candidate is taken FOR UPDATE SKIP LOCKED, so one stuck match never stalls the sweep. Schedule:
--      2026-11-02-versus-sweep-cron.sql (replaces the ranked-duos-sweep job).
--   6. RANKED DUOS AUTO IS VISIBLE (R-RANKED-DUOS-AUTO-VISIBLE-01). Reconcile putting a seat on or off auto bumps the
--      match row (revision, updated_at), so every client hears it through Realtime.
--   7. versus_events: a small service-role-only log (pause, resume, resume_request, close, resolve_ok, resolve_err,
--      resolve_retry, void, auto_on, auto_off, sweep_end) written by these functions and by versus-resolve on a failure.
--
-- Backward compatible: every RPC keeps its name, arguments and answer; the new keys (closed_by_me, resolving_since,
-- resolve_deadline, resolve_retry) are extra fields an old client ignores, and 'void' is a new end_reason with no
-- winner (an old client shows it like 'abandoned'). Idempotent.

-- ── 0. Columns, the 'void' end, the event log ──────────────────────────────────────────────────────────────
alter table public.versus_matches add column if not exists resolving_since timestamptz;
alter table public.versus_matches add column if not exists resolve_deadline timestamptz;
alter table public.versus_matches add column if not exists resolve_retry int not null default 0;
alter table public.versus_group_matches add column if not exists resolving_since timestamptz;
alter table public.versus_group_matches add column if not exists resolve_deadline timestamptz;
alter table public.versus_group_matches add column if not exists resolve_retry int not null default 0;

alter table public.versus_matches drop constraint if exists versus_matches_end_reason_check;
alter table public.versus_matches add constraint versus_matches_end_reason_check
  check (end_reason in ('hearts', 'forfeit', 'missed', 'abandoned', 'void'));
alter table public.versus_group_matches drop constraint if exists versus_group_matches_end_reason_check;
alter table public.versus_group_matches add constraint versus_group_matches_end_reason_check
  check (end_reason in ('hearts', 'forfeit', 'missed', 'abandoned', 'void'));
alter table public.versus_group_matches drop constraint if exists versus_group_matches_unrated_check;
alter table public.versus_group_matches add constraint versus_group_matches_unrated_check
  check (unrated is null or unrated in ('generated', 'not_seated', 'bot', 'dev', 'void'));

-- The sweep's candidates: open matches by age (a partial index, so it stays the size of the live matches).
create index if not exists versus_matches_open on public.versus_matches (updated_at) where phase <> 'complete';
create index if not exists versus_group_matches_open on public.versus_group_matches (updated_at) where phase <> 'complete';

create table if not exists public.versus_events (
  id        bigserial primary key,
  match_id  uuid not null,
  round     int,
  kind      text not null check (kind in ('pause', 'resume', 'resume_request', 'close', 'resolve_start', 'resolve_ok',
              'resolve_err', 'resolve_retry', 'void', 'auto_on', 'auto_off', 'sweep_end')),
  actor     uuid,
  at        timestamptz not null default now(),
  detail    jsonb check (detail is null or octet_length(detail::text) <= 2048)
);
create index if not exists versus_events_match on public.versus_events (match_id, round);
create index if not exists versus_events_at on public.versus_events (at);
alter table public.versus_events enable row level security; -- no policies: service role + the SECURITY DEFINER RPCs only
revoke all on public.versus_events from anon, authenticated;
grant select, insert, delete on public.versus_events to service_role;
grant usage, select on sequence public.versus_events_id_seq to service_role;

-- ── 1. Helpers ─────────────────────────────────────────────────────────────────────────────────────────────
-- The presence lease (see 3. above).
create or replace function public.versus__lease()
returns interval language sql immutable as $$ select interval '14 seconds' $$;
-- The resolving retry window and the void cap (see 4. above).
create or replace function public.versus__resolve_window()
returns interval language sql immutable as $$ select interval '10 seconds' $$;
create or replace function public.versus__resolve_cap()
returns interval language sql immutable as $$ select interval '90 seconds' $$;

-- One event row. Cheap: a single insert, never read on a hot path.
create or replace function public.versus__event(p_match uuid, p_round int, p_kind text, p_detail jsonb)
returns void
language sql
security definer
set search_path = public
as $$
  insert into public.versus_events (match_id, round, kind, actor, at, detail)
    values (p_match, p_round, p_kind, auth.uid(), public.versus_clock(), p_detail);
$$;

-- Every move INTO resolving (whichever function made it) stamps the resolve clock and logs the close; every move OUT
-- clears it. One trigger serves both match tables (same column names).
create or replace function public.versus__phase_watch()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if new.phase = 'resolving' and old.phase is distinct from 'resolving' then
    new.resolving_since := public.versus_clock();
    new.resolve_deadline := new.resolving_since + public.versus__resolve_window();
    new.resolve_retry := 0;
    perform public.versus__event(new.id, new.round, 'close', null);
  elsif old.phase = 'resolving' and new.phase is distinct from 'resolving' then
    new.resolving_since := null;
    new.resolve_deadline := null;
  end if;
  return new;
end;
$$;
drop trigger if exists versus_matches_phase_watch on public.versus_matches;
create trigger versus_matches_phase_watch before update of phase on public.versus_matches
  for each row when (old.phase is distinct from new.phase) execute function public.versus__phase_watch();
drop trigger if exists versus_group_matches_phase_watch on public.versus_group_matches;
create trigger versus_group_matches_phase_watch before update of phase on public.versus_group_matches
  for each row when (old.phase is distinct from new.phase) execute function public.versus__phase_watch();

-- Has versus-resolve reported that this round can NEVER resolve on this server (the match's content or engine is not
-- the deployed one)? Then waiting longer cannot help.
create or replace function public.versus__unresolvable(p_match uuid, p_round int)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (select 1 from public.versus_events e where e.match_id = p_match and e.round = p_round and e.kind = 'resolve_err'
    and e.detail->>'stage' = 'handler' and e.detail->>'error' in ('engine_mismatch', 'content_mismatch'));
$$;

-- A 1v1 round past its resolve deadline (caller holds the match lock): another window, or void.
create or replace function public.versus__resolve_overdue(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
begin
  if m.phase <> 'resolving' or m.resolve_deadline is null or v_now < m.resolve_deadline then return m; end if;
  if v_now >= coalesce(m.resolving_since, v_now) + public.versus__resolve_cap() or public.versus__unresolvable(m.id, m.round) then
    perform public.versus__event(m.id, m.round, 'void', jsonb_build_object('retries', m.resolve_retry));
    return public.versus__complete(m, null, 'void');
  end if;
  update public.versus_matches set resolve_retry = resolve_retry + 1, resolve_deadline = v_now + public.versus__resolve_window(),
    revision = revision + 1, updated_at = v_now
    where id = m.id returning * into m;
  perform public.versus__event(m.id, m.round, 'resolve_retry', jsonb_build_object('retry', m.resolve_retry));
  return m;
end;
$$;

-- The Group / Duos / Ranked Duos twin. A void Ranked Duos table is unrated and places the live team in the lowest open
-- place (the same placement an abandoned table gets), with nothing settled.
create or replace function public.versus_group__resolve_overdue(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
begin
  if m.phase <> 'resolving' or m.resolve_deadline is null or v_now < m.resolve_deadline then return m; end if;
  if v_now >= coalesce(m.resolving_since, v_now) + public.versus__resolve_cap() or public.versus__unresolvable(m.id, m.round) then
    perform public.versus__event(m.id, m.round, 'void', jsonb_build_object('retries', m.resolve_retry));
    if public.versus_ranked_duos__is(m) then
      update public.versus_group_matches set unrated = coalesce(unrated, 'void') where id = m.id returning * into m;
      m := public.versus_ranked_duos__place_team(m, 'a', public.versus_duos__living_teams(m.id), 'abandoned');
      update public.versus_group_matches set end_reason = 'void', revision = revision + 1 where id = m.id and phase = 'complete'
        returning * into m;
      if m.phase = 'complete' then return m; end if;
      select * into m from public.versus_group_matches where id = m.id;
    end if;
    return public.versus_group__complete(m, null, 'void');
  end if;
  update public.versus_group_matches set resolve_retry = resolve_retry + 1, resolve_deadline = v_now + public.versus__resolve_window(),
    revision = revision + 1, updated_at = v_now
    where id = m.id returning * into m;
  perform public.versus__event(m.id, m.round, 'resolve_retry', jsonb_build_object('retry', m.resolve_retry));
  return m;
end;
$$;

-- ── 2. Resume: the pause no longer counts against the resolve clock; resume_at always clears ──────────────
-- (2026-10-14-versus-ready-pause.sql's body, with the resolve fields shifted like every other deadline and the event.)
create or replace function public.versus__resume(m public.versus_matches)
returns public.versus_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_delta interval;
  v_out public.versus_matches;
begin
  if m.paused_at is null then return m; end if;
  v_delta := v_now - m.paused_at;
  update public.versus_matches set
    hero_deadline = hero_deadline + v_delta, shop_starts_at = shop_starts_at + v_delta,
    shop_deadline = shop_deadline + v_delta, combat_deadline = combat_deadline + v_delta,
    intro_deadline = intro_deadline + v_delta,
    resolving_since = resolving_since + v_delta, resolve_deadline = resolve_deadline + v_delta,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  perform public.versus__event(m.id, m.round, 'resume', jsonb_build_object('seat', m.paused_seat, 'pausedMs', round(extract(epoch from v_delta) * 1000)));
  -- Back with both intros already in (the second came in while paused): the clock starts now.
  if v_out.phase = 'shop' and v_out.shop_deadline is null and (v_out.p1_intro or v_out.p1_auto) and (v_out.p2_intro or v_out.p2_auto) then
    v_out := public.versus__start_clock(v_out);
  end if;
  return v_out;
end;
$$;

create or replace function public.versus_group__resume(m public.versus_group_matches)
returns public.versus_group_matches
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  v_delta interval;
  v_out public.versus_group_matches;
begin
  if m.paused_at is null then return m; end if;
  v_delta := v_now - m.paused_at;
  update public.versus_group_matches set
    hero_deadline = hero_deadline + v_delta, shop_starts_at = shop_starts_at + v_delta,
    shop_deadline = shop_deadline + v_delta, combat_deadline = combat_deadline + v_delta,
    intro_deadline = intro_deadline + v_delta,
    resolving_since = resolving_since + v_delta, resolve_deadline = resolve_deadline + v_delta,
    paused_seat = null, paused_at = null, pause_grace_until = null, resume_at = null,
    revision = revision + 1, updated_at = v_now
  where id = m.id returning * into v_out;
  perform public.versus__event(m.id, m.round, 'resume', jsonb_build_object('seat', m.paused_seat, 'pausedMs', round(extract(epoch from v_delta) * 1000)));
  return public.versus_group__maybe_clock(v_out);
end;
$$;

-- ── 3. Heartbeat: presence without the match lock; a returning paused player resumes ──────────────────────
create or replace function public.versus_heartbeat(p_room uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
set lock_timeout = '2s'
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  r public.versus_rooms;
  m public.versus_matches;
  g public.versus_group_matches;
  v_role text;
  v_prev timestamptz;
  v_seat text;
  v_out jsonb;
  v_paused boolean := false;
  v_auto boolean;
begin
  -- Plain reads first (no row locks): who am I in this room, when did I last beat, and is a match running.
  select role, last_seen_at into v_role, v_prev from public.versus_members where room_id = p_room and user_id = v_user;
  if v_role is null then raise exception 'not_a_member'; end if;
  select * into r from public.versus_rooms where id = p_room;
  if r.current_match_id is not null then
    select * into m from public.versus_matches where id = r.current_match_id;
    if not found then select * into g from public.versus_group_matches where id = r.current_match_id; end if;
  end if;

  if m.id is not null then
    v_seat := case when v_role <> 'spectator' then public.versus__seat_of(m, v_user) end;
    if v_seat is not null and m.phase <> 'complete' then
      v_auto := (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto);
      -- Only when the beat must CHANGE the match does it take the match lock (match first: R-VERSUS-LOCK-ORDER-01).
      if v_auto or (m.paused_at is not null and m.resume_at is null and m.paused_seat = v_seat) then
        begin
          select * into m from public.versus_matches where id = m.id for update;
          if m.phase <> 'complete' then
            if (v_seat = 'p1' and m.p1_auto) or (v_seat = 'p2' and m.p2_auto) then
              update public.versus_matches set
                p1_auto = case when v_seat = 'p1' then false else p1_auto end, p1_missed = case when v_seat = 'p1' then 0 else p1_missed end,
                p2_auto = case when v_seat = 'p2' then false else p2_auto end, p2_missed = case when v_seat = 'p2' then 0 else p2_missed end,
                revision = revision + 1, updated_at = v_now
                where id = m.id returning * into m;
            end if;
            -- R-VERSUS-AUTO-RESUME-01: the paused player is back, so the server 3-2-1 starts (as their Unpause would).
            if m.paused_at is not null and m.resume_at is null and m.paused_seat = v_seat then
              update public.versus_matches set resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
                where id = m.id returning * into m;
              perform public.versus__event(m.id, m.round, 'resume_request', jsonb_build_object('seat', v_seat, 'by', 'heartbeat'));
            end if;
          end if;
        exception when lock_not_available then
          null; -- the match is busy (a commit, a close): the next beat retries; the beat itself is still recorded below
        end;
      end if;
      v_paused := m.paused_at is not null and m.phase <> 'complete';
      v_out := jsonb_build_object('serverNow', v_now, 'match', public.versus__match_json(m));
    else
      v_paused := m.paused_at is not null and m.phase <> 'complete';
    end if;
  elsif g.id is not null then
    v_paused := g.paused_at is not null and g.phase <> 'complete';
    if v_role <> 'spectator' and g.phase <> 'complete' then
      v_seat := public.versus_group__seat_of(g.id, v_user);
      if v_seat is not null then
        v_auto := exists (select 1 from public.versus_group_seats where match_id = g.id and seat = v_seat and auto and eliminated_round is null);
        if v_auto or (g.paused_at is not null and g.resume_at is null and g.paused_seat = v_seat) then
          begin
            select * into g from public.versus_group_matches where id = g.id for update;
            if g.phase <> 'complete' then
              update public.versus_group_seats set auto = false, missed = 0
                where match_id = g.id and seat = v_seat and auto and eliminated_round is null;
              if found then
                g := public.versus_group__touch(g.id);
                perform public.versus__event(g.id, g.round, 'auto_off', jsonb_build_object('seat', v_seat, 'by', 'heartbeat'));
              end if;
              if g.paused_at is not null and g.resume_at is null and g.paused_seat = v_seat then
                update public.versus_group_matches set resume_at = v_now + interval '3 seconds', revision = revision + 1, updated_at = v_now
                  where id = g.id returning * into g;
                perform public.versus__event(g.id, g.round, 'resume_request', jsonb_build_object('seat', v_seat, 'by', 'heartbeat'));
              end if;
            end if;
          exception when lock_not_available then
            null;
          end;
          v_paused := g.paused_at is not null and g.phase <> 'complete';
        end if;
        v_out := jsonb_build_object('serverNow', v_now, 'groupMatch', public.versus_group__match_json(g));
      end if;
    end if;
  end if;
  -- Back after a lapse (no beat for a lease): the room's revision wakes every client now (the "is back" notice). A busy
  -- room row skips the bump (the next beat is no longer a lapse, but the match row / seen map carries the news).
  if v_prev is null or v_prev < v_now - public.versus__lease() then
    begin
      update public.versus_rooms set revision = revision + 1, updated_at = v_now where id = p_room;
    exception when lock_not_available then
      null;
    end;
  end if;
  update public.versus_members set last_seen_at = v_now where room_id = p_room and user_id = v_user;
  if not found then raise exception 'not_a_member'; end if;
  v_out := coalesce(v_out, jsonb_build_object('serverNow', v_now));
  -- While the match is paused: every member's last beat (who is back), a few dozen bytes per member.
  if v_paused then
    v_out := v_out || jsonb_build_object('seen', (select coalesce(jsonb_object_agg(user_id, last_seen_at), '{}'::jsonb)
      from public.versus_members where room_id = p_room));
  end if;
  return v_out;
end;
$$;

-- ── 4. Reconcile (1v1): lock-free when nothing is due; closed_by_me; the resolving timeout ────────────────
create or replace function public.versus__close_json(m public.versus_matches, p_before text)
returns jsonb
language sql
stable
as $$
  select public.versus__match_json(m) || jsonb_build_object('closed_by_me', coalesce(p_before = 'shop' and m.phase = 'resolving', false));
$$;

create or replace function public.versus_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_before text;
  v_seen1 timestamptz;
  v_seen2 timestamptz;
  v_gone1 boolean;
  v_gone2 boolean;
  v_due boolean;
begin
  -- LOCK-FREE FIRST LOOK (R-VERSUS-LEASE-01): most reconciles find nothing due and must not queue on the match row.
  select * into m from public.versus_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  if m.phase = 'complete' then return public.versus__close_json(m, m.phase); end if;
  select last_seen_at into v_seen1 from public.versus_members where room_id = m.room_id and user_id = m.p1_user;
  select last_seen_at into v_seen2 from public.versus_members where room_id = m.room_id and user_id = m.p2_user;
  v_gone1 := v_seen1 is null or v_seen1 < v_now - public.versus__lease();
  v_gone2 := v_seen2 is null or v_seen2 < v_now - public.versus__lease();
  v_due := case
    when m.paused_at is not null then
      (m.resume_at is not null and v_now >= m.resume_at) or (v_gone1 and v_gone2 and v_now >= m.paused_at + interval '10 minutes')
    when (v_gone1 and not m.p1_auto) or (v_gone2 and not m.p2_auto) then true
    when m.phase = 'hero_select' then v_now >= m.hero_deadline
    when m.phase = 'shop' and m.shop_deadline is null then
      v_now >= m.intro_deadline or ((m.p1_intro or m.p1_auto) and (m.p2_intro or m.p2_auto))
    when m.phase = 'shop' then
      v_now >= m.shop_deadline + public.versus__shop_grace() or ((m.p1_locked or m.p1_auto) and (m.p2_locked or m.p2_auto))
    when m.phase = 'combat' then v_now >= m.combat_deadline
    when m.phase = 'resolving' then m.resolve_deadline is not null and v_now >= m.resolve_deadline
    else true
  end;
  if not coalesce(v_due, true) then return public.versus__close_json(m, m.phase); end if;

  select * into m from public.versus_matches where id = p_match for update;
  v_before := m.phase;
  if m.phase = 'complete' then return public.versus__close_json(m, v_before); end if;
  select last_seen_at into v_seen1 from public.versus_members where room_id = m.room_id and user_id = m.p1_user;
  select last_seen_at into v_seen2 from public.versus_members where room_id = m.room_id and user_id = m.p2_user;
  v_gone1 := v_seen1 is null or v_seen1 < v_now - public.versus__lease();
  v_gone2 := v_seen2 is null or v_seen2 < v_now - public.versus__lease();

  if m.paused_at is not null then
    -- The 3-2-1 (an Unpause, a Resume or the paused player's own heartbeat) has run out: play on. Both players gone for
    -- 10 minutes: abandoned.
    if m.resume_at is not null and v_now >= m.resume_at then
      m := public.versus__resume(m);
      m := public.versus__maybe_resolve(m);
      if m.phase = 'combat' and (m.p1_ready or m.p1_auto) and (m.p2_ready or m.p2_auto) then m := public.versus__open_shop(m, m.round + 1); end if;
    elsif v_gone1 and v_gone2 and v_now >= m.paused_at + interval '10 minutes' then
      m := public.versus__complete(m, null, 'abandoned');
      return public.versus__close_json(m, v_before);
    else
      return public.versus__close_json(m, v_before);
    end if;
  end if;

  -- A newly absent player (not already on auto) pauses the shared clock.
  if (v_gone1 and not m.p1_auto) or (v_gone2 and not m.p2_auto) then
    update public.versus_matches set
      paused_seat = case when v_gone1 and not m.p1_auto then 'p1' else 'p2' end,
      paused_at = v_now, pause_grace_until = v_now + interval '30 seconds', resume_at = null,
      revision = revision + 1, updated_at = v_now
      where id = m.id returning * into m;
    perform public.versus__event(m.id, m.round, 'pause', jsonb_build_object('seat', m.paused_seat, 'phase', m.phase));
    return public.versus__close_json(m, v_before);
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    -- Round 1 before its clock: started by both intros, or by the cap.
    if v_now >= m.intro_deadline or ((m.p1_intro or m.p1_auto) and (m.p2_intro or m.p2_auto)) then
      m := public.versus__start_clock(m);
    end if;
  elsif m.phase = 'shop' and v_now >= m.shop_deadline + public.versus__shop_grace() then
    -- Past the deadline AND its grace: a final side sent at 0:00 has had its 250 ms to land first.
    if not m.p1_locked then perform public.versus__finalize_seat(m.id, m.round, 'p1', m.p1_user, m.p1_auto); end if;
    if not m.p2_locked then perform public.versus__finalize_seat(m.id, m.round, 'p2', m.p2_user, m.p2_auto); end if;
    update public.versus_matches set p1_locked = true, p2_locked = true where id = m.id returning * into m;
    m := public.versus__maybe_resolve(m);
  elsif m.phase = 'shop' then
    m := public.versus__maybe_resolve(m); -- an auto seat never locks: the present player's lock is enough
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus__open_shop(m, m.round + 1);
  elsif m.phase = 'resolving' then
    m := public.versus__resolve_overdue(m);
  end if;
  return public.versus__close_json(m, v_before);
end;
$$;

-- ── 5. Submit (1v1): closed_by_me (2026-11-01-versus-ready-signal.sql's body, answers wrapped) ─────────────
create or replace function public.versus_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_matches;
  v_seat text;
  v_before text;
  s public.versus_submissions;
begin
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  v_before := m.phase;
  v_seat := public.versus__seat_of(m, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  -- A side sent at 0:00 lands within the grace (R-VERSUS-CLOCK-LOCK-01); later than that it is too late.
  if m.paused_at is null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  select * into s from public.versus_submissions where match_id = p_match and round = p_round and seat = v_seat;
  -- READY SIGNAL: a seat that already ended may send its board again (a newer seq), and stays ended.
  if found and s.final then
    if not p_final or p_seq <= s.candidate_seq then return public.versus__close_json(m, v_before); end if;
    update public.versus_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus__close_json(m, v_before);
  end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus__close_json(m, v_before); -- an older candidate arriving late: ignore
  end if;
  insert into public.versus_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_submissions.checkpoint), updated_at = now();
  if p_final then
    if v_seat = 'p1' then update public.versus_matches set p1_locked = true, revision = revision + 1 where id = p_match returning * into m;
    else update public.versus_matches set p2_locked = true, revision = revision + 1 where id = p_match returning * into m; end if;
    m := public.versus__maybe_resolve(m);
  end if;
  return public.versus__close_json(m, v_before);
end;
$$;

-- ── 6. Group / Duos: reconcile + submit ──────────────────────────────────────────────────────────────────
create or replace function public.versus_group__close_json(m public.versus_group_matches, p_before text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.versus_group__match_json(m) || jsonb_build_object('closed_by_me', coalesce(p_before = 'shop' and m.phase = 'resolving', false));
$$;

create or replace function public.versus_group_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_before text;
  v_gone text;
  v_all_gone boolean;
  v_due boolean;
  s record;
begin
  -- LOCK-FREE FIRST LOOK (R-VERSUS-LEASE-01).
  select * into m from public.versus_group_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  if public.versus_ranked_duos__is(m) then return public.versus_ranked_duos_reconcile(p_match); end if;
  if m.phase = 'complete' then return public.versus_group__close_json(m, m.phase); end if;
  -- Living seats whose lease lapsed, in seat order; and are they all gone.
  select s2.seat into v_gone from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto
      and (mm.last_seen_at is null or mm.last_seen_at < v_now - public.versus__lease())
    order by s2.seat limit 1;
  select bool_and(mm.last_seen_at is null or mm.last_seen_at < v_now - public.versus__lease()) into v_all_gone
    from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null;
  v_due := case
    when m.paused_at is not null then
      (m.resume_at is not null and v_now >= m.resume_at) or (coalesce(v_all_gone, true) and v_now >= m.paused_at + interval '10 minutes')
    when v_gone is not null then true
    when m.phase = 'hero_select' then v_now >= m.hero_deadline
    when m.phase = 'shop' and m.shop_deadline is null then
      v_now >= m.intro_deadline or not exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (intro or auto))
    when m.phase = 'shop' then
      v_now >= m.shop_deadline + public.versus__shop_grace()
        or not exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (locked or auto))
    when m.phase = 'combat' then v_now >= m.combat_deadline
    when m.phase = 'resolving' then m.resolve_deadline is not null and v_now >= m.resolve_deadline
    else true
  end;
  if not coalesce(v_due, true) then return public.versus_group__close_json(m, m.phase); end if;

  select * into m from public.versus_group_matches where id = p_match for update;
  v_before := m.phase;
  if m.phase = 'complete' then return public.versus_group__close_json(m, v_before); end if;
  select s2.seat into v_gone from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto
      and (mm.last_seen_at is null or mm.last_seen_at < v_now - public.versus__lease())
    order by s2.seat limit 1;
  select bool_and(mm.last_seen_at is null or mm.last_seen_at < v_now - public.versus__lease()) into v_all_gone
    from public.versus_group_seats s2
    left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
    where s2.match_id = m.id and s2.eliminated_round is null;

  if m.paused_at is not null then
    if m.resume_at is not null and v_now >= m.resume_at then
      m := public.versus_group__resume(m);
      m := public.versus_group__maybe_resolve(m);
      m := public.versus_group__maybe_next(m);
    elsif coalesce(v_all_gone, true) and v_now >= m.paused_at + interval '10 minutes' then
      m := public.versus_group__complete(m, null, 'abandoned');
      return public.versus_group__close_json(m, v_before);
    else
      return public.versus_group__close_json(m, v_before);
    end if;
  end if;

  if v_gone is not null then
    update public.versus_group_matches set paused_seat = v_gone, paused_at = v_now, pause_grace_until = v_now + interval '30 seconds',
      resume_at = null, revision = revision + 1, updated_at = v_now
      where id = m.id returning * into m;
    perform public.versus__event(m.id, m.round, 'pause', jsonb_build_object('seat', v_gone, 'phase', m.phase));
    return public.versus_group__close_json(m, v_before);
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus_group__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    if v_now >= m.intro_deadline then m := public.versus_group__start_clock(m); else m := public.versus_group__maybe_clock(m); end if;
  elsif m.phase = 'shop' and v_now >= m.shop_deadline + public.versus__shop_grace() then
    for s in select * from public.versus_group_seats where match_id = m.id and not locked and eliminated_round is null loop
      perform public.versus_group__finalize_seat(m.id, m.round, s.seat, s.user_id, s.auto);
    end loop;
    m := public.versus_group__maybe_resolve(m);
  elsif m.phase = 'shop' then
    m := public.versus_group__maybe_resolve(m);
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus_group__open_shop(m, m.round + 1);
  elsif m.phase = 'resolving' then
    m := public.versus_group__resolve_overdue(m);
  end if;
  return public.versus_group__close_json(m, v_before);
end;
$$;

create or replace function public.versus_group_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb, p_scout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  m public.versus_group_matches;
  v_seat text;
  v_before text;
  s public.versus_group_submissions;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if public.versus_ranked_duos__is(m) then
    return public.versus_ranked_duos_submit(p_match, p_round, p_seq, p_side, p_final, p_checkpoint, p_scout);
  end if;
  v_before := m.phase;
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and eliminated_round is not null) then raise exception 'eliminated'; end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  if m.paused_at is null and m.shop_deadline is not null and public.versus_clock() >= m.shop_deadline + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  select * into s from public.versus_group_submissions where match_id = p_match and round = p_round and seat = v_seat;
  if found and s.final then
    -- READY SIGNAL: a ready seat may send its board again (a newer seq) and stays ready.
    if not p_final or p_seq <= s.candidate_seq then return public.versus_group__close_json(m, v_before); end if;
    update public.versus_group_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), scout = coalesce(p_scout, scout), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus_group__close_json(m, v_before);
  end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus_group__close_json(m, v_before); -- an older candidate arriving late: ignore
  end if;
  insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint, scout)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint, p_scout)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_group_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_group_submissions.checkpoint),
      scout = coalesce(excluded.scout, public.versus_group_submissions.scout), updated_at = now();
  if p_final then
    update public.versus_group_seats set locked = true where match_id = p_match and seat = v_seat;
    m := public.versus_group__touch(p_match);
    m := public.versus_group__maybe_resolve(m);
  end if;
  return public.versus_group__close_json(m, v_before);
end;
$$;

-- ── 7. Ranked Duos: reconcile (lock-free look, visible auto, timeout) + submit (closed_by_me) ───────────────
create or replace function public.versus_ranked_duos__close_json(m public.versus_group_matches, p_before text)
returns jsonb
language sql
stable
security definer
set search_path = public
as $$
  select public.versus_ranked_duos__json(m) || jsonb_build_object('closed_by_me', coalesce(p_before = 'shop' and m.phase = 'resolving', false));
$$;

create or replace function public.versus_ranked_duos_reconcile(p_match uuid)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_before text;
  v_due boolean;
  v_close timestamptz;
  v_on text[];
  v_off text[];
begin
  -- LOCK-FREE FIRST LOOK (R-VERSUS-LEASE-01): due when the caller's own seat comes off auto, a seat goes on auto, or a
  -- phase deadline / the end-turn close / the resolve deadline has passed.
  select * into m from public.versus_group_matches where id = p_match;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if m.phase = 'complete' then return public.versus_ranked_duos__close_json(m, m.phase); end if;
  v_close := case when m.phase = 'shop' then public.versus_ranked_duos__close_at(m) end;
  v_due := exists (select 1 from public.versus_group_seats where match_id = m.id and user_id = auth.uid() and auto and left_at is null and eliminated_round is null)
    or exists (select 1 from public.versus_group_seats s2
      left join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s2.user_id
      where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto and s2.user_id is distinct from auth.uid()
        and (mm.last_seen_at is null or mm.last_seen_at < v_now - public.versus__lease()))
    or case
      when m.phase = 'hero_select' then v_now >= m.hero_deadline
      when m.phase = 'shop' and m.shop_deadline is null then
        v_now >= m.intro_deadline or not exists (select 1 from public.versus_group_seats where match_id = m.id and eliminated_round is null and not (intro or auto))
      when m.phase = 'shop' then v_close is not null and v_now >= v_close
      when m.phase = 'combat' then v_now >= m.combat_deadline
      when m.phase = 'resolving' then m.resolve_deadline is not null and v_now >= m.resolve_deadline
      else true
    end;
  if not coalesce(v_due, true) then return public.versus_ranked_duos__close_json(m, m.phase); end if;

  select * into m from public.versus_group_matches where id = p_match for update;
  v_before := m.phase;
  if m.phase = 'complete' then return public.versus_ranked_duos__close_json(m, v_before); end if;

  -- Back: the caller's own seat comes off auto (never a seat that left).
  with x as (
    update public.versus_group_seats set auto = false, auto_since = null
      where match_id = m.id and user_id = auth.uid() and auto and left_at is null and eliminated_round is null
      returning seat)
  select coalesce(array_agg(seat), '{}') into v_off from x;
  -- Gone: a living seat whose lease lapsed (or who is no longer a room member) goes on auto, from now.
  with x as (
    update public.versus_group_seats s2 set auto = true, auto_since = v_now
      where s2.match_id = m.id and s2.eliminated_round is null and not s2.auto and s2.user_id is distinct from auth.uid()
        and not exists (select 1 from public.versus_members mm where mm.room_id = m.room_id and mm.user_id = s2.user_id
          and mm.last_seen_at >= v_now - public.versus__lease())
      returning seat)
  select coalesce(array_agg(seat), '{}') into v_on from x;
  -- R-RANKED-DUOS-AUTO-VISIBLE-01: an auto change is a match change, so every client hears it through Realtime.
  if cardinality(v_off) > 0 or cardinality(v_on) > 0 then
    m := public.versus_group__touch(m.id);
    if cardinality(v_off) > 0 then perform public.versus__event(m.id, m.round, 'auto_off', jsonb_build_object('seats', to_jsonb(v_off))); end if;
    if cardinality(v_on) > 0 then perform public.versus__event(m.id, m.round, 'auto_on', jsonb_build_object('seats', to_jsonb(v_on))); end if;
  end if;

  if m.phase = 'hero_select' and v_now >= m.hero_deadline then
    m := public.versus_group__maybe_start(m);
  elsif m.phase = 'shop' and m.shop_deadline is null then
    if v_now >= m.intro_deadline then m := public.versus_group__start_clock(m); else m := public.versus_group__maybe_clock(m); end if;
  elsif m.phase = 'shop' then
    m := public.versus_ranked_duos__maybe_close(m);
  elsif m.phase = 'combat' and v_now >= m.combat_deadline then
    m := public.versus_group__open_shop(m, m.round + 1);
  elsif m.phase = 'resolving' then
    m := public.versus_group__resolve_overdue(m);
  end if;
  return public.versus_ranked_duos__close_json(m, v_before);
end;
$$;

create or replace function public.versus_ranked_duos_submit(p_match uuid, p_round int, p_seq int, p_side jsonb, p_final boolean, p_checkpoint jsonb, p_scout jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_user uuid := auth.uid();
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_seat text;
  v_before text;
  v_close timestamptz;
  s public.versus_group_submissions;
begin
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  v_before := m.phase;
  v_seat := public.versus_group__seat_of(p_match, v_user);
  if v_seat is null then raise exception 'not_a_player'; end if;
  if exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_seat and (eliminated_round is not null or left_at is not null)) then
    raise exception 'eliminated';
  end if;
  if m.phase <> 'shop' or m.round <> p_round then raise exception 'stale_round'; end if;
  v_close := public.versus_ranked_duos__close_at(m);
  if v_close is not null and v_now >= v_close + public.versus__shop_grace() then raise exception 'deadline_passed'; end if;
  if p_side is null or octet_length(p_side::text) > 262144 then raise exception 'side_too_large'; end if;
  if p_checkpoint is not null and octet_length(p_checkpoint::text) > 1048576 then raise exception 'checkpoint_too_large'; end if;
  if p_scout is not null and (jsonb_typeof(p_scout) <> 'object' or octet_length(p_scout::text) > 8192) then raise exception 'scout_too_large'; end if;
  select * into s from public.versus_group_submissions where match_id = p_match and round = p_round and seat = v_seat;
  -- READY SIGNAL: a seat that already ended may send its board again (a newer seq), and stays ended.
  if found and s.final then
    if not p_final or p_seq <= s.candidate_seq then return public.versus_ranked_duos__close_json(m, v_before); end if;
    update public.versus_group_submissions set candidate_seq = p_seq, prepared_side = p_side,
      checkpoint = coalesce(p_checkpoint, checkpoint), scout = coalesce(p_scout, scout), updated_at = now()
      where match_id = p_match and round = p_round and seat = v_seat;
    return public.versus_ranked_duos__close_json(m, v_before);
  end if;
  if found and p_seq <= s.candidate_seq and not p_final then
    return public.versus_ranked_duos__close_json(m, v_before);
  end if;
  insert into public.versus_group_submissions (match_id, round, seat, user_id, candidate_seq, prepared_side, final, source, checkpoint, scout)
    values (p_match, p_round, v_seat, v_user, p_seq, p_side, p_final, case when p_final then 'lock' else 'candidate' end, p_checkpoint, p_scout)
    on conflict (match_id, round, seat) do update set candidate_seq = greatest(excluded.candidate_seq, public.versus_group_submissions.candidate_seq),
      prepared_side = excluded.prepared_side, final = excluded.final, source = excluded.source,
      checkpoint = coalesce(excluded.checkpoint, public.versus_group_submissions.checkpoint),
      scout = coalesce(excluded.scout, public.versus_group_submissions.scout), updated_at = now();
  if p_final then
    -- A lock sent inside the grace after the close still counts as the player's own, at the close.
    update public.versus_group_seats set locked = true, locked_at = least(v_now, coalesce(v_close, v_now))
      where match_id = p_match and seat = v_seat;
    m := public.versus_group__touch(p_match);
    m := public.versus_ranked_duos__maybe_close(m);
  end if;
  return public.versus_ranked_duos__close_json(m, v_before);
end;
$$;

-- ── 8. Commit: a duplicate save is answered without the lock; the first one logs resolve_ok ─────────────────
create or replace function public.versus_commit_round(
  p_match uuid, p_round int, p_chair text, p_outcome text, p_loser text, p_p1 jsonb, p_p2 jsonb, p_digest text, p_vitals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  v_h1 int; v_a1 int; v_d1 int;
  v_h2 int; v_a2 int; v_d2 int;
begin
  -- FAST PATH (R-VERSUS-CLOSE-ONCE-01): a duplicate save of a committed round is answered from a plain read, no lock.
  select * into m from public.versus_matches where id = p_match;
  if found and exists (select 1 from public.versus_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus__match_json(m));
  end if;
  select * into m from public.versus_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  perform public.versus__event(p_match, p_round, 'resolve_ok', jsonb_build_object('retries', m.resolve_retry,
    'ms', round(extract(epoch from (v_now - m.resolving_since)) * 1000)));
  if p_outcome not in ('p1', 'p2', 'draw') then raise exception 'bad_outcome'; end if;
  if (p_outcome = 'draw') <> (p_loser is null) or (p_outcome = 'p1' and p_loser <> 'p2') or (p_outcome = 'p2' and p_loser <> 'p1') then
    raise exception 'bad_outcome';
  end if;
  v_h1 := public.versus__vital(p_vitals->'p1', 'health'); v_a1 := public.versus__vital(p_vitals->'p1', 'armor'); v_d1 := public.versus__vital(p_vitals->'p1', 'damage');
  v_h2 := public.versus__vital(p_vitals->'p2', 'health'); v_a2 := public.versus__vital(p_vitals->'p2', 'armor'); v_d2 := public.versus__vital(p_vitals->'p2', 'damage');
  -- Only the loser takes damage; a draw costs nobody.
  if (v_d1 > 0 and p_loser is distinct from 'p1') or (v_d2 > 0 and p_loser is distinct from 'p2') then raise exception 'bad_vitals'; end if;
  insert into public.versus_rounds (match_id, round, chair, outcome, heart_lost_by, p1_result, p2_result, digest,
      p1_hearts, p2_hearts, p1_health, p1_armor, p2_health, p2_armor, p1_damage, p2_damage)
    values (p_match, p_round, p_chair, p_outcome, p_loser, p_p1, p_p2, p_digest,
      null, null, v_h1, v_a1, v_h2, v_a2, v_d1, v_d2);
  update public.versus_matches set p1_health = v_h1, p1_armor = v_a1, p2_health = v_h2, p2_armor = v_a2,
    p1_missed = case when p1_auto then p1_missed + 1 else 0 end,
    p2_missed = case when p2_auto then p2_missed + 1 else 0 end,
    phase = 'combat', combat_deadline = v_now + interval '90 seconds', p1_ready = false, p2_ready = false,
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  -- Health 0 is out ('hearts' is the knockout reason's legacy id: "knocked out in a fight").
  if v_h1 <= 0 or v_h2 <= 0 then
    m := public.versus__complete(m, case when v_h1 <= 0 then 'p2' else 'p1' end, 'hearts');
  elsif m.p1_missed >= 3 then
    m := public.versus__complete(m, 'p2', 'missed');
  elsif m.p2_missed >= 3 then
    m := public.versus__complete(m, 'p1', 'missed');
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus__match_json(m));
end;
$$;

create or replace function public.versus_group_commit_round(p_match uuid, p_round int, p_fights jsonb, p_digest text, p_vitals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  f jsonb;
  v_a text;
  v_b text;
  v_l text;
  v_copy boolean;
  v_dmg int;
  v_hit text[] := '{}';
  v_dead text[];
  v_living int;
  v_winner text;
  v_reason text := 'hearts';
  s record;
begin
  -- FAST PATH (R-VERSUS-CLOSE-ONCE-01): a duplicate save of a committed round is answered from a plain read, no lock.
  select * into m from public.versus_group_matches where id = p_match;
  if found and exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  perform public.versus__event(p_match, p_round, 'resolve_ok', jsonb_build_object('retries', m.resolve_retry,
    'ms', round(extract(epoch from (v_now - m.resolving_since)) * 1000)));
  if p_fights is null or jsonb_typeof(p_fights) <> 'array' or jsonb_array_length(p_fights) > 2 then raise exception 'bad_fights'; end if;
  if p_vitals is null or jsonb_typeof(p_vitals) <> 'object' then raise exception 'bad_vitals'; end if;
  -- Every seat still in carries its pools; nobody else does.
  if exists (select 1 from public.versus_group_seats where match_id = p_match and eliminated_round is null and not (p_vitals ? seat))
     or exists (select 1 from jsonb_object_keys(p_vitals) k where not exists (
       select 1 from public.versus_group_seats where match_id = p_match and seat = k and eliminated_round is null)) then
    raise exception 'bad_vitals';
  end if;

  for f in select value from jsonb_array_elements(p_fights) loop
    v_a := f->>'a'; v_b := f->>'b'; v_l := f->>'loser'; v_copy := coalesce((f->>'copy')::boolean, false);
    v_dmg := coalesce((f->>'damage')::int, 0);
    if not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_a)
       or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_b)
       or v_a = v_b or f->>'outcome' not in ('a', 'b', 'draw') or f->>'chair' not in ('a', 'b') or v_dmg < 0 then
      raise exception 'bad_fights';
    end if;
    if v_l is not null and (v_l not in (v_a, v_b) or (v_copy and v_l = v_b) or v_l = any (v_hit)
        or (f->>'outcome' = 'draw') or (f->>'outcome' = 'a' and v_l <> v_b) or (f->>'outcome' = 'b' and v_l <> v_a)) then
      raise exception 'bad_fights';
    end if;
    if v_l is null and v_dmg <> 0 then raise exception 'bad_fights'; end if;
    -- The loser's charged damage must be the one its pools record.
    if v_l is not null and p_vitals ? v_l and public.versus__vital(p_vitals->v_l, 'damage') <> v_dmg then raise exception 'bad_vitals'; end if;
    insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, damage, a_result, b_result, a_scout, b_scout)
      values (p_match, p_round, (f->>'fight')::smallint, v_a, v_b, v_copy, f->>'chair', f->>'outcome', v_l, v_dmg, f->'aResult', f->'bResult',
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
        (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
           from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));
    if v_l is not null then v_hit := array_append(v_hit, v_l); end if;
  end loop;

  -- Every seat still in lands on its pools after the round (a copy and a ghost are never charged).
  update public.versus_group_seats gs set
      health = public.versus__vital(p_vitals->gs.seat, 'health'),
      armor = public.versus__vital(p_vitals->gs.seat, 'armor')
    where gs.match_id = p_match and gs.eliminated_round is null;

  -- Health 0: out TOGETHER, sharing a placement (the lobby's rule for simultaneous knockouts). Ordered by Health +
  -- Armor going INTO the round, then seat: the lobby's wipeout tiebreak.
  select coalesce(array_agg(seat order by public.versus__vital(p_vitals->seat, 'before') desc, seat), '{}') into v_dead
    from public.versus_group_seats
    where match_id = p_match and eliminated_round is null and health <= 0;
  v_living := public.versus_group__living(p_match);
  if cardinality(v_dead) > 0 and cardinality(v_dead) >= v_living then
    -- WIPEOUT GUARD (the lobby's): never a round with nobody standing. The healthiest going in survives the round, and
    -- so wins the match.
    v_dead := v_dead[2:];
  end if;
  update public.versus_group_seats set eliminated_round = p_round, out_reason = 'hearts', auto = false, placement = v_living
    where match_id = p_match and seat = any (v_dead);

  -- Missed rounds: an auto seat's count grows, a present seat's resets; three in a row is out (never the last seat).
  update public.versus_group_seats set missed = case when auto then missed + 1 else 0 end
    where match_id = p_match and eliminated_round is null;
  for s in select seat from public.versus_group_seats where match_id = p_match and eliminated_round is null and missed >= 3 order by seat loop
    exit when public.versus_group__living(p_match) <= 1;
    update public.versus_group_seats set eliminated_round = p_round, out_reason = 'missed', auto = false,
      placement = public.versus_group__living(p_match)
      where match_id = p_match and seat = s.seat;
    v_dead := array_append(v_dead, s.seat);
    if public.versus_group__living(p_match) <= 1 and cardinality(v_hit) = 0 then v_reason := 'missed'; end if;
  end loop;

  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated)
    values (p_match, p_round, p_digest, null,
      (select jsonb_object_agg(seat, jsonb_build_object('health', health, 'armor', armor)) from public.versus_group_seats
        where match_id = p_match and health is not null),
      to_jsonb(v_dead));
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if public.versus_group__living(p_match) <= 1 then
    select seat into v_winner from public.versus_group_seats where match_id = p_match and eliminated_round is null;
    m := public.versus_group__complete(m, v_winner, v_reason);
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_group__match_json(m));
end;
$$;

create or replace function public.versus_duos_commit_round(p_match uuid, p_round int, p_fight jsonb, p_digest text, p_vitals jsonb)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_a text := p_fight->>'a';
  v_b text := p_fight->>'b';
  v_outcome text := p_fight->>'outcome';
  v_lose text := p_fight->>'losingTeam';
  v_dmg int := coalesce((p_fight->>'damage')::int, 0);
  v_dead text[] := '{}';
  v_winner text;
  v_reason text := 'hearts';
  v_team text;
  t record;
begin
  -- FAST PATH (R-VERSUS-CLOSE-ONCE-01): a duplicate save of a committed round is answered from a plain read, no lock.
  select * into m from public.versus_group_matches where id = p_match;
  if found and public.versus_duos__is(m) and exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_duos__is(m) then raise exception 'not_duos'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_group__match_json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  perform public.versus__event(p_match, p_round, 'resolve_ok', jsonb_build_object('retries', m.resolve_retry,
    'ms', round(extract(epoch from (v_now - m.resolving_since)) * 1000)));
  if p_fight is null or jsonb_typeof(p_fight) <> 'object'
     or public.versus_duos__team(v_a) is distinct from 'a' or public.versus_duos__team(v_b) is distinct from 'b'
     or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_a)
     or not exists (select 1 from public.versus_group_seats where match_id = p_match and seat = v_b)
     or v_outcome not in ('a', 'b', 'draw') or p_fight->>'chair' not in ('a', 'b')
     or (v_outcome = 'draw') <> (v_lose is null) or (v_outcome = 'a' and v_lose <> 'b') or (v_outcome = 'b' and v_lose <> 'a')
     or v_dmg < 0 or (v_outcome = 'draw' and v_dmg <> 0) then
    raise exception 'bad_fight';
  end if;
  if p_vitals is null or jsonb_typeof(p_vitals) <> 'object' then raise exception 'bad_vitals'; end if;
  -- Every team still in carries its pool; the losing team's charged damage is the fight's.
  for t in select team from public.versus_group_teams where match_id = p_match and eliminated_round is null loop
    perform public.versus__vital(p_vitals->t.team, 'health');
    if public.versus__vital(p_vitals->t.team, 'damage') <> (case when t.team = v_lose then v_dmg else 0 end) then raise exception 'bad_vitals'; end if;
  end loop;
  insert into public.versus_group_fights (match_id, round, fight, a_seat, b_seat, b_copy, chair, outcome, heart_lost_by, damage, a_result, b_result, a_scout, b_scout)
    values (p_match, p_round, 0, v_a, v_b, false, p_fight->>'chair', v_outcome,
      case v_lose when 'a' then v_a when 'b' then v_b end, case when v_lose is null then 0 else v_dmg end, p_fight->'aResult', p_fight->'bResult',
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_a),
      (select coalesce(su.scout, '{}'::jsonb) || jsonb_strip_nulls(jsonb_build_object('tier', su.prepared_side -> 'state' -> 'tier'))
         from public.versus_group_submissions su where su.match_id = p_match and su.round = p_round and su.seat = v_b));

  -- TEAM pools (the team's own row; each seat mirrors it). A team at 0 Health is out together, placed by how many teams
  -- were still in (2nd of 2); the last team in is 1st.
  update public.versus_group_teams tt set
      health = public.versus__vital(p_vitals->tt.team, 'health'),
      armor = public.versus__vital(p_vitals->tt.team, 'armor')
    where tt.match_id = p_match and tt.eliminated_round is null;
  if v_lose is not null and exists (select 1 from public.versus_group_teams where match_id = p_match and team = v_lose and health <= 0 and eliminated_round is null) then
    update public.versus_group_teams set eliminated_round = p_round, out_reason = 'hearts', placement = public.versus_duos__living_teams(p_match)
      where match_id = p_match and team = v_lose;
    v_dead := public.versus_duos__seats(v_lose);
  end if;

  -- Missed rounds: an auto seat's count grows, a present seat's resets; three in a row puts its TEAM out.
  update public.versus_group_seats set missed = case when auto then missed + 1 else 0 end
    where match_id = p_match and eliminated_round is null;
  if cardinality(v_dead) = 0 then
    select team into v_team from public.versus_group_seats
      where match_id = p_match and eliminated_round is null and missed >= 3 order by seat limit 1;
    if v_team is not null then
      update public.versus_group_teams set eliminated_round = p_round, out_reason = 'missed', placement = public.versus_duos__living_teams(p_match)
        where match_id = p_match and team = v_team and eliminated_round is null;
      v_dead := public.versus_duos__seats(v_team);
      if v_lose is null then v_reason := 'missed'; end if;
    end if;
  end if;

  -- Every seat mirrors its team (the pool, and when out: the round, why and the placement).
  update public.versus_group_seats s set health = t2.health, armor = t2.armor,
    eliminated_round = coalesce(s.eliminated_round, t2.eliminated_round),
    out_reason = case when s.eliminated_round is null and t2.eliminated_round is not null
      then case when t2.out_reason = 'missed' and s.missed < 3 then 'forfeit' else t2.out_reason end else s.out_reason end,
    auto = case when t2.eliminated_round is not null then false else s.auto end,
    placement = coalesce(t2.placement, s.placement)
    from public.versus_group_teams t2 where s.match_id = p_match and t2.match_id = p_match and t2.team = s.team;

  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated)
    values (p_match, p_round, p_digest, null,
      (select jsonb_object_agg(seat, jsonb_build_object('health', health, 'armor', armor)) from public.versus_group_seats
        where match_id = p_match and health is not null),
      to_jsonb(v_dead));
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if public.versus_duos__living_teams(p_match) <= 1 then
    select seat into v_winner from public.versus_group_seats where match_id = p_match and eliminated_round is null order by seat limit 1;
    m := public.versus_group__complete(m, v_winner, v_reason);
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_group__match_json(m));
end;
$$;

create or replace function public.versus_ranked_duos_commit_round(p_match uuid, p_round int, p_result jsonb, p_digest text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  f jsonb;
  p jsonb;
  t record;
  v_live_place int;
  v_dead jsonb := '[]'::jsonb;
begin
  -- FAST PATH (R-VERSUS-CLOSE-ONCE-01): a duplicate save of a committed round is answered from a plain read, no lock.
  select * into m from public.versus_group_matches where id = p_match;
  if found and public.versus_ranked_duos__is(m) and exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_ranked_duos__json(m));
  end if;
  select * into m from public.versus_group_matches where id = p_match for update;
  if not found then raise exception 'no_match'; end if;
  if not public.versus_ranked_duos__is(m) then raise exception 'not_ranked_duos'; end if;
  if exists (select 1 from public.versus_group_rounds where match_id = p_match and round = p_round) then
    return jsonb_build_object('alreadyCommitted', true, 'match', public.versus_ranked_duos__json(m));
  end if;
  if m.phase <> 'resolving' or m.round <> p_round then raise exception 'not_resolving'; end if;
  perform public.versus__event(p_match, p_round, 'resolve_ok', jsonb_build_object('retries', m.resolve_retry,
    'ms', round(extract(epoch from (v_now - m.resolving_since)) * 1000)));
  if p_result is null or jsonb_typeof(p_result->'fights') <> 'array' or jsonb_typeof(p_result->'vitals') <> 'object'
     or jsonb_typeof(p_result->'placed') <> 'array' then
    raise exception 'bad_result';
  end if;
  for f in select * from jsonb_array_elements(p_result->'fights') loop
    if f->>'a' not in ('a', 'b', 'c', 'd') or f->>'b' not in ('a', 'b', 'c', 'd') or f->>'a' = f->>'b'
       or f->>'outcome' not in ('a', 'b', 'draw') or f->>'chair' not in ('a', 'b')
       or (f ? 'loser' and f->>'loser' is not null and f->>'loser' not in (f->>'a', f->>'b'))
       or coalesce((f->>'damage')::int, -1) < 0 then
      raise exception 'bad_fight';
    end if;
    insert into public.versus_ranked_duos_fights (match_id, round, fight, a_team, b_team, ghost, chair, outcome, loser, damage, first, live_result)
      values (p_match, p_round, (f->>'fight')::int, f->>'a', f->>'b', coalesce((f->>'ghost')::boolean, false), f->>'chair', f->>'outcome',
        f->>'loser', (f->>'damage')::int, f->'first',
        case when 'a' in (f->>'a', f->>'b') then f->'liveResult' end);
  end loop;
  -- Every team still in carries its pool after the round.
  for t in select team from public.versus_group_teams where match_id = p_match and eliminated_round is null loop
    update public.versus_group_teams set health = public.versus__vital(p_result->'vitals'->t.team, 'health'),
      armor = public.versus__vital(p_result->'vitals'->t.team, 'armor')
      where match_id = p_match and team = t.team;
  end loop;
  update public.versus_group_seats s set health = tt.health, armor = tt.armor
    from public.versus_group_teams tt where s.match_id = p_match and tt.match_id = p_match and tt.team = 'a' and s.team = 'a';
  -- Placements: a recorded team is simply out (or 1st); the live team goes through place_team (after the round row).
  for p in select * from jsonb_array_elements(p_result->'placed') loop
    if p->>'team' not in ('a', 'b', 'c', 'd') or (p->>'placement')::int not between 1 and 4 then raise exception 'bad_placement'; end if;
    if p->>'team' = 'a' then
      v_live_place := (p->>'placement')::int;
    else
      update public.versus_group_teams set placement = (p->>'placement')::int,
        eliminated_round = case when (p->>'placement')::int = 1 then eliminated_round else p_round end,
        out_reason = case when (p->>'placement')::int = 1 then out_reason else 'hearts' end
        where match_id = p_match and team = p->>'team' and placement is null;
    end if;
    if (p->>'placement')::int > 1 then v_dead := v_dead || to_jsonb(p->>'team'); end if;
  end loop;
  insert into public.versus_group_rounds (match_id, round, digest, hearts, vitals, eliminated, first)
    values (p_match, p_round, p_digest, null, p_result->'vitals', v_dead,
      case when p_result->>'liveFirst' in ('0', '1') then jsonb_build_object('a', 'p' || ((p_result->>'liveFirst')::int + 1)::text) end);
  update public.versus_group_seats set ready = false where match_id = p_match;
  update public.versus_group_matches set phase = 'combat', combat_deadline = v_now + interval '90 seconds',
    revision = revision + 1, updated_at = v_now
    where id = p_match returning * into m;
  if v_live_place is null and not exists (select 1 from public.versus_group_teams where match_id = p_match and team <> 'a' and eliminated_round is null) then
    v_live_place := 1; -- every recorded team is out: the live team wins
  end if;
  if v_live_place is not null then
    m := public.versus_ranked_duos__place_team(m, 'a', v_live_place, 'hearts');
  end if;
  return jsonb_build_object('alreadyCommitted', false, 'match', public.versus_ranked_duos__json(m));
end;
$$;


-- ── 9. The sweep (R-VERSUS-SWEEP-01) ──────────────────────────────────────────────────────────────────────
-- Ranked Duos' abandoned sweep, now skipping a match another transaction holds (2026-10-29-ranked-duos.sql's body).
create or replace function public.versus_ranked_duos_sweep_abandoned()
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_group_matches;
  v_n int := 0;
begin
  for m in select * from public.versus_group_matches g
      where g.phase <> 'complete' and coalesce(g.options->>'mode', '') = 'ranked_duos'
      order by g.updated_at limit 50
      for update skip locked loop
    continue when exists (
      select 1 from public.versus_group_seats s
      join public.versus_members mm on mm.room_id = m.room_id and mm.user_id = s.user_id
      where s.match_id = m.id and s.team = 'a' and s.left_at is null and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus__event(m.id, m.round, 'sweep_end', jsonb_build_object('mode', 'ranked_duos', 'phase', m.phase));
    perform public.versus_ranked_duos__place_team(m, 'a', public.versus_duos__living_teams(m.id), 'abandoned');
    v_n := v_n + 1;
  end loop;
  return v_n;
end;
$$;

-- Every mode: a match nobody has been in for 10 minutes ends 'abandoned' (no winner), whatever phase it froze in, so a
-- room never stays stuck behind a match its clients left. A match with ANY seated player still beating is left to its
-- clients' reconciles. Bounded (50 a mode per run) and SKIP LOCKED: a busy or stuck match is simply taken next run.
create or replace function public.versus_sweep()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_now timestamptz := public.versus_clock();
  m public.versus_matches;
  g public.versus_group_matches;
  v_solo int := 0;
  v_group int := 0;
  v_ranked int;
  v_pruned int;
begin
  for m in select * from public.versus_matches
      where phase <> 'complete' and updated_at < v_now - interval '10 minutes'
      order by updated_at limit 50
      for update skip locked loop
    continue when exists (select 1 from public.versus_members mm
      where mm.room_id = m.room_id and mm.user_id in (m.p1_user, m.p2_user) and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus__event(m.id, m.round, 'sweep_end', jsonb_build_object('mode', '1v1', 'phase', m.phase));
    perform public.versus__complete(m, null, 'abandoned');
    v_solo := v_solo + 1;
  end loop;

  for g in select * from public.versus_group_matches
      where phase <> 'complete' and updated_at < v_now - interval '10 minutes' and coalesce(options->>'mode', '') <> 'ranked_duos'
      order by updated_at limit 50
      for update skip locked loop
    continue when exists (select 1 from public.versus_group_seats s
      join public.versus_members mm on mm.room_id = g.room_id and mm.user_id = s.user_id
      where s.match_id = g.id and s.eliminated_round is null and mm.last_seen_at >= v_now - interval '10 minutes');
    perform public.versus__event(g.id, g.round, 'sweep_end', jsonb_build_object('mode', coalesce(g.options->>'mode', 'group'), 'phase', g.phase));
    perform public.versus_group__complete(g, null, 'abandoned');
    v_group := v_group + 1;
  end loop;

  v_ranked := public.versus_ranked_duos_sweep_abandoned();

  -- Retention: 14 days of events.
  delete from public.versus_events where at < v_now - interval '14 days';
  get diagnostics v_pruned = row_count;
  return jsonb_build_object('solo', v_solo, 'group', v_group, 'rankedDuos', v_ranked, 'pruned', v_pruned);
end;
$$;

-- ── 10. Grants ──────────────────────────────────────────────────────────────────────────────────────────────
revoke all on function public.versus__event(uuid, int, text, jsonb) from public, anon, authenticated;
grant execute on function public.versus__event(uuid, int, text, jsonb) to service_role;
revoke all on function public.versus__phase_watch() from public, anon, authenticated;
revoke all on function public.versus__unresolvable(uuid, int) from public, anon, authenticated;
revoke all on function public.versus__resolve_overdue(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_group__resolve_overdue(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus__close_json(public.versus_matches, text) from public, anon, authenticated;
revoke all on function public.versus_group__close_json(public.versus_group_matches, text) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos__close_json(public.versus_group_matches, text) from public, anon, authenticated;
revoke all on function public.versus__resume(public.versus_matches) from public, anon, authenticated;
revoke all on function public.versus_group__resume(public.versus_group_matches) from public, anon, authenticated;
revoke all on function public.versus_ranked_duos_sweep_abandoned() from public, anon, authenticated;
grant execute on function public.versus_ranked_duos_sweep_abandoned() to service_role;
revoke all on function public.versus_sweep() from public, anon, authenticated;
grant execute on function public.versus_sweep() to service_role;
