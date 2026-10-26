# 2026-10-25 — Duos: pass a card back, hand only, and the held card glows

Three owner rulings (2026-10-25), one PR (`fix/duos-pass-back`), R-DUOS-PASS-01 / -03 / -04:

- **"you should be able to pass cards back to your teammate".** The "Just passed to you" refusal is gone everywhere:
  `BoardCard.passedWave` (the only thing that enforced it) is replaced by `passKey`, the pass key (`<fromSeat>:<seq>`) a
  card last arrived through. It is identity, never a restriction. A received card can go straight back, and a card can
  be passed again later the same turn; every pass costs its own 1 Gold. The server never had a per-card rule; its
  per-round anti-spam cap stays at **10 passes per player per round** (`VERSUS_DUOS_PASS_CAP`, `too_many_passes`).
- **"you aren't supposed to be able to pass a card off your board, only from hand."** `duosPassBlocked` refuses a
  board card (`'board'`), `applyDuosPass` only splices the hand, the drag only measures the teammate portrait for a
  HAND drag (a board minion gets no glow and drops like any board drag), and the server refuses any pass whose card is
  not marked `passFrom: 'hand'` (`duosWireCard` adds it; the receiver drops it). The server raises `bad_card` for it on
  purpose: a client from before this change sends no marker, and `bad_card` is already one of its refusals, so it is
  refunded rather than retried forever. A refund of an older checkpoint's board pass still goes back to the board.
- **"when holding a card over your teammate where it'll pass, have the card's border glow blue/green"** and **"if you
  dont have enough gold to pass, or if their hand is full, have it glow red"**. The floating `.dragcard` takes
  `pass-ok` / `pass-no` from `dragStore.passOver` (the same state the portrait reads), and `versus.css` recolours the
  card's own plate hover-glow layer (`.plateglow`) teal or red with a static drop-shadow; only its opacity moves (teal
  breathes, red holds), the kwglow rule.

## The restore (the part that needed real work)

Since #2293 a reload lines the restored outbox up with the server's rows by card uid + round. With passing back that
is not enough: a restored run re-lands this round's incoming passes under FRESH uids, so "the card I passed back" can
no longer be found by the uid it had. Now:

- `lineUpOutbox` matches by round + uid + `passKey` (+ refused with refunded).
- `replayRestore` (pure, injected run access; `duosPasses.ts`) replays the round in the order the server recorded it
  (`created_at`, now selected): a teammate's pass lands, one of mine is played again (found by its `passKey` when it
  has one, else by uid among cards I never received), and a receiver-refused one is refunded at once so the card is
  there for a later pass of it. Incoming rows already `refused` never land (their sender has the card back; the old
  pull path would have landed them on a reload).
- The ordinary pull no longer lands anything until the replay has run, then the replay pulls once more.

## Verified

- Unit: ping-pong A->B->A->B through the real reducer (Gold each hop, landed once each); reloads of either side mid
  ping-pong (`duosPassesRestore.test.ts`); refused-then-passed-again; board refused; the glow CSS (static shadow,
  opacity-only keyframes) and the hand-only drag gate (`duosPassRelease.test.ts`).
- PGlite: `2026-10-25-versus-duos-pass-back.sql` twice (idempotent); A->B->A->B rows; a board-marked or unmarked pass
  refused; the same card ten times then `too_many_passes`.
- Live (prod bench build, Claudebot1 + three test bots on the live backend, before the migration): a real drag pass,
  the bot passing it straight back through its run action + RPC, and passing it again: Gold 7 -> 6 -> 5, the card
  landed once each hop. Then a page reload right after an A->B->A->B round: the restored run re-landed the card's
  return (`p2:0`) and replayed the second pass of it by its `passKey`, ending with an empty hand while the bot held the
  card (no duplicate, nothing lost). The first hop of that card was skipped on the replay because the card had been
  bought earlier that same shop and a reload drops the round's unlocked shop actions (pre-existing restore model, its
  Gold comes back with the buy). Captures of the teal and red held-card glow.

## Lead to-dos

- Apply `supabase/migrations/2026-10-25-versus-duos-pass-back.sql` (one CREATE OR REPLACE of `versus_duos_pass`).
- The versus-resolve bundle is untouched (no `packages/sim/src/versus/server*` or resolver change).
