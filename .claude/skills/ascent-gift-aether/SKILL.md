---
name: ascent-gift-aether
description: Gift Aether to an ASCENT player from the Ascent team, with the reason they see in a pop-up the next time they log in. Use when Mike or Kevin says to give, send, gift or grant Aether to a player.
---

# Gifting Aether to a player

The player sees a pop-up on their next login (`AetherGiftNotice.tsx`, R-PROG-GIFT-02):

> **A Gift of Aether**
> You've been gifted **N** Aether from the Ascent team for:
> *the reason*

The gift is paid by one admin SQL function, `public.aether_gift(name, tag, amount, reason)`
(`supabase/migrations/2026-11-22-aether-gifts.sql`). Claude has no database access: you write the one line and the
owner pastes it into the **Supabase SQL Editor** and presses **Run**.

## Steps

1. **Get the player and the amount** from the request. If either is missing, ask.
2. **Ask what the gift is for, every time, before writing anything** (owner 2026-11-20: "you will prompt me to
   explain what it is for, then fill it in for me"). Use the question tool or a plain question.
3. **Turn the answer into the reason line.** It finishes the sentence "You've been gifted N Aether from the Ascent
   team for:", so write it as what follows that colon: lowercase start, no trailing full stop unless it is several
   sentences, player-facing words, at most 300 characters. Examples:
   - "he found the crate bug" → `finding and reporting the crate shop bug`
   - "won the weekend tourney" → `winning the weekend community tournament`
   Show the owner the full sentence the player will read and let them adjust it.
4. **Write the SQL line**, escaping any `'` in text as `''`:
   ```sql
   select public.aether_gift('Arivas', null, 1000, 'being one of our first players');
   ```
   The second argument is the player's #tag (`'2635'`) when known, else `null`. With `null` and several players of
   that name, the function refuses and lists the tags; then ask which one and pass it.
5. **Tell the owner what a good run returns**: one row like
   `{"player":"Arivas#2635","amount":1000,"reason":"…","balance":2000,"gift_id":"…"}`. An error means nothing was
   paid (no such signed-in player, an ambiguous name, a bad amount or an empty reason).

## Rules

- Never run, schedule or retry this yourself, and never pay without the owner's go-ahead on the exact line.
- Each call is its own gift: running the line twice pays twice. If unsure whether it ran, check first:
  ```sql
  select amount, reason, created_at, seen_at from public.aether_gifts g
  join public.profiles p using (user_id) where p.author ilike 'Arivas' order by created_at desc limit 5;
  ```
  `seen_at` filled in means the player has already seen the pop-up.
- Do not use `aether_apply` directly for a gift: it pays silently, with no pop-up.
