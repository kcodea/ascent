-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- ANNOUNCERS CAN'T BE A CHEST FOCUS  (2026-10-20)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
--
-- Paste into the Supabase SQL Editor and Run, AFTER 2026-10-18-aether.sql and 2026-10-20-milestone-chests-epic.sql (it
-- replaces aether_quote). Idempotent: the function is REPLACED and re-revoked, so a re-run changes nothing. The same
-- block is appended to schema.sql; keep the two identical.
--
-- WHAT THIS IS (owner 2026-10-20: "lets remove announcers from being able to be focused"; asked what a chest does when
-- every focusable category is ticked: "Free, may give an Announcer"; and "yes, announcers can drop from the unfocused
-- chests"):
--  - `aether_quote` no longer counts an Announcer as an AVAILABLE focus category. A focus naming `announcer` is refused as
--    `bad_focus`, and ticking every focusable category is NO focus (null, free), exactly as ticking every available one was
--    before: the pool of that chest still holds the Announcers, so it can give one.
--  - Unchanged on purpose: `progression_tiered_crate_pool` and `progression_tiered_crate_pick` (an Announcer still drops
--    from any unfocused chest), `buy_crate` and `open_crate` (they call the quote), and every number (prices, fees, odds).
--
-- THE TS COPY: NON_FOCUSABLE_CATEGORIES / availableFocusCategories in packages/progression/src/crateShop.ts.
-- announcersNotFocusable.db.test.ts runs this file on PGlite after the Aether files and checks it against quoteCrate.

create or replace function public.aether_quote(p_user uuid, p_tier text, p_focus text[], p_milestone boolean)
returns jsonb
language plpgsql
stable
set search_path = public
as $$
declare
  v_milestone boolean := coalesce(p_milestone, false);
  v_tier      text;
  v_floor     text;
  v_eco       jsonb;
  v_price     int;
  v_available text[];
  v_focus     text[];
  v_remaining int;
  v_pct       int := 0;
  v_fee       int := 0;
  v_crate     int;
begin
  v_tier := case when v_milestone then 'legendary' else p_tier end;
  if v_tier is null or v_tier not in ('standard', 'rare', 'epic', 'legendary', 'ancient') then raise exception 'bad_tier'; end if;
  v_floor := case v_tier when 'standard' then 'common' else v_tier end;   -- mirror of CRATE_TIER_FLOOR

  select economy into v_eco from public.aether_config where id = 1;
  -- every economy number through the defensive read (section 11): a missing, fractional or garbled price is a refusal,
  -- never a cast error and never a guess (final review 2026-10-19)
  v_price := public.aether_economy_int(v_eco, array['cratePrice', v_tier]);
  if v_price is null then raise exception 'aether_config_missing'; end if;

  -- the categories a player may focus at this floor: those with something still eligible, never an Announcer
  -- (NON_FOCUSABLE_CATEGORIES in crateShop.ts). The POOL still holds them, so an unfocused chest, and one whose ticks
  -- cover every focusable category (v_focus := null below), can give one.
  select coalesce(array_agg(distinct c.category), '{}') into v_available
    from public.progression_tiered_crate_pool(p_user, v_floor, null) p
    join public.cosmetic_catalog c on c.cosmetic_id = p.pool_cosmetic_id
    where c.category <> 'announcer';

  -- normalizeFocus
  if p_focus is not null and cardinality(p_focus) > 0 then
    if exists (select 1 from unnest(p_focus) f where f is null or not (f = any(v_available))) then raise exception 'bad_focus'; end if;
    select array_agg(f order by f collate "C") into v_focus from (select distinct f from unnest(p_focus) f) d;
    if cardinality(v_focus) >= cardinality(v_available) then v_focus := null; end if;
  end if;

  select count(*) into v_remaining from public.progression_tiered_crate_pool(p_user, v_floor, v_focus);
  if v_remaining = 0 then raise exception 'sold_out'; end if;

  -- focusFeePercent: 1..7 ticked read the ladder, 8 or more (but fewer than all available) the last rung
  -- (an unreadable ladder or rung is `aether_config_missing`: a focused crate is never sold at a guessed fee)
  if v_focus is not null then
    if jsonb_typeof(v_eco -> 'focusFeePercent') is distinct from 'array' or jsonb_array_length(v_eco -> 'focusFeePercent') = 0 then
      raise exception 'aether_config_missing';
    end if;
    v_pct := public.aether_economy_int(v_eco,
      array['focusFeePercent', (least(cardinality(v_focus), jsonb_array_length(v_eco -> 'focusFeePercent')) - 1)::text]);
    if v_pct is null then raise exception 'aether_config_missing'; end if;
    v_fee := (v_price * v_pct) / 100;   -- integer division: Math.floor in the TS
  end if;
  v_crate := case when v_milestone then 0 else v_price end;
  return jsonb_build_object('tier', v_tier, 'floor', v_floor, 'focus', to_jsonb(v_focus), 'crate', v_crate,
    'fee', v_fee, 'total', v_crate + v_fee, 'remaining', v_remaining);
end;
$$;

revoke all on function public.aether_quote(uuid, text, text[], boolean) from public, anon, authenticated, service_role;
