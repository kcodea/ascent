-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- AETHER GIFTS: the Ascent team gives a player Aether, with a reason the player sees once  (2026-11-22)
-- ══════════════════════════════════════════════════════════════════════════════════════════════════════════
-- Owner 2026-11-20: "this will likely be something we do for others going forward. i would like upon them logging
-- in, to recieve a prompt. it should say, you've been gifted XXX Aether from the Ascent team for: ..." (R-PROG-GIFT-02)
--
-- APPLY AFTER 2026-10-18-aether.sql. ADDITIVE ONLY and idempotent (safe to re-run). No Edge Function.
--
--  - aether_gifts: one row per gift (who, how much, the reason in the team's words, when, and when the player saw
--    it). Owner-only read, no API writes.
--  - aether_gift(name, discriminator, amount, reason): THE admin tool. Run it in the Supabase SQL Editor (it is
--    revoked from every API role). It finds the ONE account with that display name (and #tag, when given), records
--    the gift, pays it through `aether_apply` (ledger reason 'grant', source 'gift:<gift id>') and moves the account's
--    progression revision so its mirrors adopt the new balance. No match, or several, REFUSES and pays nothing.
--  - ack_aether_gift(gift id): the signed-in player marks THEIR OWN gift seen once the pop-up has shown.
--
-- Usage (the repo's `ascent-gift-aether` skill writes this line for you):
--   select public.aether_gift('Arivas', '2635', 1000, 'being one of our first players');

-- ── 1. aether_gifts: one row per gift; owner-only read ───────────────────────────────────────────────────────
create table if not exists public.aether_gifts (
  gift_id    uuid primary key default gen_random_uuid(),
  user_id    uuid not null references auth.users(id) on delete cascade,
  amount     int  not null check (amount > 0),
  reason     text not null check (char_length(btrim(reason)) between 1 and 300),
  created_at timestamptz not null default now(),
  seen_at    timestamptz
);
create index if not exists aether_gifts_unseen on public.aether_gifts (user_id, created_at) where seen_at is null;
alter table public.aether_gifts enable row level security;
drop policy if exists "read own aether_gifts" on public.aether_gifts;
create policy "read own aether_gifts" on public.aether_gifts for select to authenticated using (auth.uid() = user_id);
revoke insert, update, delete on public.aether_gifts from anon, authenticated;

-- ── 2. aether_gift: the admin tool (SQL Editor only) ────────────────────────────────────────────────────────
create or replace function public.aether_gift(p_name text, p_discriminator text, p_amount int, p_reason text)
returns jsonb
language plpgsql
security definer
set search_path = public
as $$
declare
  v_users   uuid[];
  v_user    uuid;
  v_author  text;
  v_tag     text;
  v_gift    uuid;
  v_balance int;
begin
  if p_amount is null or p_amount <= 0 then raise exception 'aether_gift: the amount must be a positive whole number'; end if;
  if p_reason is null or char_length(btrim(p_reason)) = 0 then raise exception 'aether_gift: a reason is required'; end if;
  if char_length(btrim(p_reason)) > 300 then raise exception 'aether_gift: keep the reason to 300 characters'; end if;

  select array_agg(p.user_id order by p.discriminator) into v_users
    from public.profiles p
    where lower(p.author) = lower(btrim(p_name)) and p.user_id is not null
      and (nullif(btrim(coalesce(p_discriminator, '')), '') is null or p.discriminator = btrim(p_discriminator));
  if v_users is null then
    raise exception 'aether_gift: no signed-in player named % %', p_name, coalesce('#' || nullif(btrim(p_discriminator), ''), '');
  end if;
  if array_length(v_users, 1) > 1 then
    raise exception 'aether_gift: % players are named % (tags: %); pass the tag',
      array_length(v_users, 1), p_name,
      (select string_agg('#' || coalesce(p.discriminator, '?'), ', ' order by p.discriminator)
         from public.profiles p where p.user_id = any(v_users));
  end if;
  v_user := v_users[1];
  select p.author, p.discriminator into v_author, v_tag from public.profiles p where p.user_id = v_user;

  -- The same per-user lock every other Aether writer holds, so a gift never races a settlement or a purchase.
  perform pg_advisory_xact_lock(hashtextextended('progression:' || v_user::text, 0));
  insert into public.aether_gifts (user_id, amount, reason) values (v_user, p_amount, btrim(p_reason))
    returning gift_id into v_gift;
  v_balance := public.aether_apply(v_user, p_amount, 'grant', 'gift:' || v_gift::text);
  update public.profiles set progression_revision = progression_revision + 1, updated_at = now() where user_id = v_user;

  return jsonb_build_object('player', v_author || coalesce('#' || v_tag, ''), 'gift_id', v_gift,
    'amount', p_amount, 'reason', btrim(p_reason), 'balance', v_balance);
end;
$$;
revoke all on function public.aether_gift(text, text, int, text) from public, anon, authenticated, service_role;

-- ── 3. ack_aether_gift: the player saw the pop-up ───────────────────────────────────────────────────────────
-- Only the caller's own unseen gift changes; anything else (another account's gift, a seen one, a bad id) is a no-op.
create or replace function public.ack_aether_gift(p_gift uuid)
returns boolean
language plpgsql
security definer
set search_path = public
as $$
declare
  v_rows int;
begin
  if auth.uid() is null or p_gift is null then return false; end if;
  update public.aether_gifts set seen_at = now() where gift_id = p_gift and user_id = auth.uid() and seen_at is null;
  get diagnostics v_rows = row_count;
  return v_rows > 0;
end;
$$;
revoke all on function public.ack_aether_gift(uuid) from public, anon, authenticated, service_role;
grant execute on function public.ack_aether_gift(uuid) to authenticated;

-- PostgREST caches the schema: reload it so the new table and functions are reachable at once.
notify pgrst, 'reload schema';
