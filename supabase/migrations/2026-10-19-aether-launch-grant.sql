-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER LAUNCH GRANT: 1,000 Aether for every account, once  (2026-10-19)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql (it replaces that file's
-- `aether_rollout`). Before or after the launch both work: the launch step stays `select public.aether_rollout();`,
-- and if Aether is ALREADY on when this file runs, the bottom block pays every existing account at once. Idempotent:
-- every function is REPLACED and re-granted, the trigger is dropped and re-added, and each account's grant is one
-- ledger row (reason 'grant', source 'aether_launch'), so a re-run, a second rollout or a retried insert never pays
-- twice. The same block is appended to schema.sql; keep the two identical.
--
-- WHAT THIS IS (owner 2026-10-19: "lets give everyone 1,000 Aether as part of the announcement of this change"):
--  - `aether_launch_grant(user)`: credits the grant through `aether_apply` (the one balance writer). Internal.
--  - `aether_rollout()`: as before (backdate the milestone crates, flip the switch), and now ALSO pays the grant to
--    every profile, moving the progression revision of each account it pays so its mirrors adopt the balance.
--    Answers {accounts, crates, granted}.
--  - A profile created AFTER the launch (a new account's first game, a guest signing in) is paid by the
--    `profiles_aether_launch_grant` trigger, so "everyone" stays true for players who join later. With the switch
--    off the trigger pays nothing (the rollout pays those accounts instead).
-- THE TS COPY of the amount is `AETHER_LAUNCH_GRANT` (packages/progression/src/aether.ts), which the Collection's
-- "Introducing Aether" announcement names; aetherLaunchGrant.db.test.ts checks the two agree.

-- ── 1. aether_launch_grant: one account's grant (internal) ──────────────────────────────────────────────────
create or replace function public.aether_launch_grant(p_user uuid)
returns int
language plpgsql
security definer
set search_path = public
as $$
declare
  c_grant constant int := 1000;
begin
  return public.aether_apply(p_user, c_grant, 'grant', 'aether_launch');
end;
$$;
revoke all on function public.aether_launch_grant(uuid) from public, anon, authenticated, service_role;

-- ── 2. The trigger: a profile created while Aether is on is paid at once ───────────────────────────────────
create or replace function public.profiles_aether_launch_grant()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
begin
  if coalesce((select c.aether_enabled from public.progression_config c where c.id = 1), false) then
    perform public.aether_launch_grant(new.user_id);
  end if;
  return new;
end;
$$;
revoke all on function public.profiles_aether_launch_grant() from public, anon, authenticated, service_role;
drop trigger if exists profiles_aether_launch_grant on public.profiles;
create trigger profiles_aether_launch_grant after insert on public.profiles
  for each row execute function public.profiles_aether_launch_grant();

-- ── 3. aether_rollout: the 2026-10-18 body, plus the grant for every existing profile ──────────────────────
-- Unchanged from 2026-10-18-aether.sql except for the grant: the milestone crates are backdated exactly as before,
-- then every profile is paid (`granted` counts the accounts actually paid NOW; a re-run answers 0), each account given
-- a crate or the grant has its progression revision moved once, and the switch flips. An unreadable
-- `milestoneEvery` still REFUSES (`aether_config_invalid`) and changes nothing.
create or replace function public.aether_rollout()
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_every    int;
  v_crates   int := 0;
  v_accounts int := 0;
  v_granted  int := 0;
  v_user     uuid;
  v_paid     uuid[] := '{}';
begin
  v_every := public.aether_economy_int((select c.economy from public.aether_config c where c.id = 1), array['milestoneEvery']);
  if v_every is null or v_every < 1 then raise exception 'aether_config_invalid'; end if;

  for v_user in
    select p.user_id from public.profiles p
    where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'aether_launch')
    order by p.user_id
  loop
    perform public.aether_launch_grant(v_user);
    v_paid := v_paid || v_user;
  end loop;
  v_granted := coalesce(array_length(v_paid, 1), 0);

  with ins as (
    insert into public.loot_crates (user_id, earned_level, source, source_id, floor_rarity)
      select p.user_id, null, 'milestone:' || g.lvl, 'aether_rollout', 'legendary'
      from public.profiles p
      cross join lateral generate_series(v_every, p.account_level, v_every) as g(lvl)
      where p.account_level >= v_every
      on conflict (user_id, source) where source is not null do nothing
      returning user_id
  ), touched as (
    update public.profiles p set progression_revision = p.progression_revision + 1, updated_at = now()
      where p.user_id in (select distinct ins.user_id from ins) or p.user_id = any(v_paid)
      returning p.user_id
  )
  select (select count(distinct ins.user_id) from ins), (select count(*) from ins) into v_accounts, v_crates;

  update public.progression_config set aether_enabled = true where id = 1;
  return jsonb_build_object('accounts', v_accounts, 'crates', v_crates, 'granted', v_granted);
end;
$$;
revoke all on function public.aether_rollout() from public, anon, authenticated;
grant execute on function public.aether_rollout() to service_role;

-- ── 4. Already launched? Pay everyone now ─────────────────────────────────────────────────────────────────
-- Only when this file runs AFTER `aether_rollout()` (the switch is already on): the trigger cannot reach the profiles
-- that exist already, so pay them here. Before the launch this does nothing and the rollout pays them.
do $$
declare
  v_user uuid;
begin
  if coalesce((select c.aether_enabled from public.progression_config c where c.id = 1), false) then
    for v_user in
      select p.user_id from public.profiles p
      where not exists (select 1 from public.aether_ledger l where l.user_id = p.user_id and l.reason = 'grant' and l.source_id = 'aether_launch')
    loop
      perform public.aether_launch_grant(v_user);
      update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = v_user;
    end loop;
  end if;
end;
$$;

-- PostgREST caches the schema: reload it so the replaced rollout is callable at once.
notify pgrst, 'reload schema';
