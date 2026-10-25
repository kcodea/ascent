# 2026-10-25 — Versus Duos (2v2 tag-team): live edge cases (phase 3 of 3)

Phases 1 (#2290) and 2 (#2292) shipped the engine, the server and the UI. Phase 3 played the edges live on the real
backend with Claudebot1-4 (four Chrome windows) plus Claudebot5 as a spectator, on the prod bench build, and fixed
what broke. Rules: GAME-RULES.md "Versus Duos" (Leaving, conceding, disconnects; Spectating a Duos match); oracle
R-DUOS-PASS-01 (approved/foundation.ts).

## Tested live

- **Full hand, up front:** the teammate's hand at 10. Hovering their portrait shows the red ring and "Their hand is full".
  A drop springs back, with no charge.
- **Full-hand race:** the hand at 9, a pass sent, then the hand filled before it landed. The server refused it, and the
  card and the Gold came back.
- **Receiver reloads mid-pass:** the pass landed exactly once after the reload.
- **Sender reloads mid-pass:** found a bug, fixed below.
- **Disconnect:** the teammate's window closed. The match paused for everyone ("Claudebot4 disconnected, reconnect time
  30s"). After the grace, Unpause put their board on auto. They came back, rejoined and played on.
- **Passing to an away teammate:** found a gap, fixed below.
- **Concede:** the whole team went out together, both placed 2nd, and the other team won.
- **Double wipe:** a natural draw round came up live, with no hearts lost. The engine side is covered by
  `tagTeam.test.ts` and the db test "a draw costs nobody".
- **Spectating a Duos match:** a fifth account watched a whole match. The shop, the hand-off ("Claudebot4 steps in", the
  foe portrait following) and both hero slots all behaved. The fight picker is fixed below.

## Fixed

- **A reload could pass a card twice.** A restored run (from its last lock) lined its outbox up with the server's rows
  by POSITION. A pass the server refused up front never gets a row, so every later entry slid onto the wrong row. The
  sender then kept a card the teammate had already received, and paid nothing for it.
  - `lineUpOutbox` (duosPasses.ts) now pairs entries and rows by card uid + round, with refused rows paired to refunded
    entries.
  - Rows with no entry are played again on the restored run, so the card leaves and the Gold is paid.
  - Entries the server never saw go out under fresh numbers.
  - Re-tested live: two passes, a reload, then board empty, Gold down by 2, and the receiver got exactly two cards.
- **A returned pass was silent.** The card just reappeared. Now the portrait says "Their hand was full. You got it
  back." (or "Your teammate is away..." / "Pass returned...") with the deny sound.
- **Passing to an away teammate.** A teammate on auto (disconnected past the grace) or one the match is paused for
  could be passed to. The card then waited on the server, with the Gold paid, until they came back.
  - Now their portrait reads "Away" and greys.
  - A drop is refused with "Your teammate is away".
  - The server refuses it too (`teammate_away`, migration `2026-10-25-versus-duos-edges.sql`).
- **The spectator's fight picker** said "vs <one player>" and interleaved the teams. In Duos it now lists Team 1 then
  Team 2 (the board fighting first leads), each plate reading its team.

## Known, not changed

- **Swap build frames.** The teammate-view swap still builds the other screen in 1-3 long frames hidden under the still
  sweep panel. Lead ruling: keep it as a known item. A store instance per screen would remove it.
- **Spectator picker hearts (group mode, pre-existing).** The picker's hearts read the server's committed seats. During
  a fight's replay they can show the result before the fight ends (seen once: 4 on the plate, 6 on the watched screen).

## Verification

- `duosPassesRestore.test.ts` covers the live case, the full line-up and a refused-vs-refunded pairing.
- `versusDuos.db.test.ts` covers `teammate_away` (on auto, and paused for them), with the migration run twice.
- Live re-tests on the new build: the sender reload, the away teammate (screenshots) and the spectator plates.
