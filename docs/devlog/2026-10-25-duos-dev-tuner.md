# 2026-10-25 — Versus test bots in every seat + the Duos dev tuner

Owner 2026-10-25: "id like the ability to test the various mechanics with bots, so maybe can you build a dev tuner or
something so i can test what the mechanics look like and how they feel? like maybe if you have a bot teammate, have a
dev tuner that says like... pass a card etc etc so i can just force the various mechanics". Before this, "Add bot"
filled ONE seat of a 1v1 room, so Group and Duos needed four browser windows. Dev / test tool only. Oracle:
R-DUOS-DEVTUNER-01 (approved/foundation.ts). No patch note (not a gameplay change).

## What

- **Bots on any seat** (`versusBot.ts`): up to three, one per bot slot, each its own anonymous account (a second
  Supabase client with its own storage key; slot 1 keeps the original key, so the existing Test Bot account is reused).
  Every empty seat in a 1v1, Group or Duos room shows "Add bot" to the host (same gate as before:
  `versusTestToolsEnabled`, dev builds or `localStorage['ascent.versus'] = '1'`). The bot joins and moves to that exact
  seat. All three play inside the host's tab. A test account set can name its bots with
  `localStorage['ascent.versus.botnames'] = 'A,B,C'` (default Test Bot, Test Bot 2, Test Bot 3).
- **The driver in every mode** (`versusBotApi.ts`): routes each match call to the 1v1 or the `versus_group_*` / Duos
  RPCs by which table the match lives in, and projects group rows from the bot's own seat with the same projection a
  person's client plays through, so `VersusBotDriver` is unchanged in shape. Driver additions: p3 / p4 gate gems, the
  match's pinned options on the run (Duos gives it its pass state), and the teammate's half of passing (land / answer
  passes, take back refusals, ship its own, report hand room) on its own cadence, never instead of a game action.
- **The dev tuner** (`VersusBotsTuner.tsx`, dev menu → Versus → "Versus Bots + Duos"; pure half in `duosDevTuner.ts`):
  bots (disconnect / reconnect, concede, remove, add), "Bots end turn after me", match (skip shop timer, concede, force
  win, force loss), team hearts, passing (the bot teammate passes you a random or a picked card), refused passes
  (teammate hand full, teammate away / back, my Gold to 0, close passing, arm the full-hand race), teammate view
  (watch / back), who fights first (shown, not set: see below), next
  fight (our hand-off, their hand-off, both teams wiped, all boards empty), and the bot teammate's board and hand.
- **Server** (`supabase/migrations/2026-10-25-versus-test-bots.sql`): `versus_test_bots` (an anonymous account names the
  host whose browser drives it); `versus_dev_set_hearts` and `versus_dev_skip_shop` open only to the
  room's host on a table of only that host's bots, and mark the match `dev_forced`; a trigger on `progression_results`
  refuses XP for a bot and for anything from a forced match (as `source_not_found`, already a permanent 409 for the
  progression queue, so no Edge Function change). Records already ignore anonymous accounts.

## Readings made (flag to the owner)

- Real paths first: passes, refusals, fights and concedes are the real ones. A forced fight sets every board of the table
  (plain minions, no effects) and lets the real resolver run, so a hero power can still nudge it. Your own board is set
  the moment you press it; each bot's as it locks ("Bots end turn after me" keeps them waiting for you).
- Owner ruling 2026-10-25 (mid-build): who fights first is a seeded 50/50 each round and players never choose it
  (#2294, merged while this was built). The coordinator asked for a dev-only override instead of a flip, but after #2294
  the resolver computes the order from the match seed alone (finalize_duos no longer reads `duos_first`), so an
  override would need a resolver change and a versus-resolve redeploy. Left out: the panel SHOWS who leads this round,
  and every forced fight is built from that order, so each one still shows its mechanic whichever board leads.
- "Teammate hand full" also stops the bot shopping (it would otherwise play cards out of its hand and the pass would
  land); "Empty teammate hand" starts it again.
- A forced match gives nobody XP, the human included: the dev RPCs make a test table, and a test must not farm XP.

## Verification

- `versusTestBots.db.test.ts` (PGlite, every Versus migration then this one twice): only an anonymous account registers;
  four bots fill a Duos room through the browser adapter and play it to the end via the real `finalize_duos` handler;
  a bot passes to its teammate bot (landed, 1 Gold); the armed race comes back refused and refunded; the bot never
  passes on its own; the dev RPCs are host-only, refuse a table with a non-bot, mark the match; no XP rows for a bot or a
  forced match. `duosDevTuner.test.ts`: each forced fight through the real `resolveVersusDuosRound` shows the mechanic.
- Live on a local dev build against the live backend (before the migration), my own Chrome profile, Claudebot1 + bots
  Claudebot2..4: the room filled by Add bot per seat, all gates, Hero Select, a bot's forced pass landed in my hand, my
  pass to the bot landed, a drop on the full-hand teammate was refused with no charge, the armed race was refused and
  refunded, "Our hand-off" made my 1/1 fall and my teammate's 4/4s step in, the teammate view, and "Force win" (the foe
  bots concede) to the Victory screen with team placements 1 / 1 / 2 / 2.
- Found while testing: the shared Browser pane was being driven by another session at the same time (it moved to
  another port), which clicked my panel; the tests moved to a dedicated Chrome. Not a product bug.

## Deploy (the lead)

Apply `supabase/migrations/2026-10-25-versus-test-bots.sql`. No function redeploy. Without it the bots still seat and
play; only the hearts / skip-shop / fight-order buttons answer "Refused" and the no-XP guard is off.
