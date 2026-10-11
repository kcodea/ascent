# 2026-10-10 — Rune of the Ruinous + Ruinous Lord

Owner add: a new Set 2 Demon rune.

- **Rune of the Ruinous** (`rune_ruinous`): Basic (appended last in `RUNES`), 4 Gold, `tribes: ['demon']`,
  `sets: ['set2']`, "Get a **Ruinous Lord**." Reward `{ kind: 'grant', cards: ['dm_ruinouslord'] }`, the Bucky /
  Flaming Dragon shape at Basic.
- **Ruinous Lord** (`dm_ruinouslord`): rune-only T4 4/5 Demon (`token: true`), in a new `SET2_DEMON_RUNE_MINIONS`
  list appended at the very end of set 2's `own` so no seeded pool position moves. "When a **Demon** deals damage,
  give your **Demons +1/+1**." Gilded +2/+2.

## Engine

New factory `onFriendlyDemonDamageBuffTribe` (types union + schema whitelist + policy registry), subscribed to
Impossible Todd's `friendlyDemonDealtDamage` trigger, so "deals damage" means exactly what it does for Todd: a
LANDED hit by a friendly Demon (attack, counter-hit or incidental; a Ward-absorbed hit never fires; an enemy
Demon never fires it). Each fire buffs every living friendly Demon through `ctx.buff` and writes no `permaGain`,
so the gain is **combat-only** (owner ruling), Engraved bodies aside (the standing rule for every combat gain).
A new factory rather than a param on Todd's `onFriendlyDemonDamageBuffSelf`, because that body's self-gain is
PERMANENT and its policy is `foldedCue`; this one is `ownBeat` / `react`.

Presentation: each fire is one contiguous run of `buff` events, which the moment compiler collapses into ONE
buff-wave moment. So a Demon-heavy fight shows one wave per landed hit (all the Demons' +1/+1 together), never one
beat per Demon. No new FX, no new event type, no extra per-frame work.

Oracle: **R-RUINOUS-01** (triggers domain). Tests: `packages/sim/src/ruinousRune1010.test.ts` (grant on buy,
Set 2 + Demon gating, per-hit buff incl. self, no enemy trigger, gilded, determinism, no carry-back; the
carry-back test was confirmed to fail with a `permaGain` write). `RUNES.length` pin 183 → 184; set-2 `dm_` roster pin 22 → 23 (buyable unchanged at 20). The Doc Bot
text lexicon now reads "a Demon deals damage" as the same `friendlyDemonDealtDamage` trigger (it only knew
"friendly Demon"), which keeps the unresolved-parse pin at 120. Contract registry
regenerated (`docbot:sync`); final-report contract total 1069 → 1071.

Art: `RuneOfTheRuinous.png` → `rune_ruinous.webp`, `RuinousLord.png` (Special Rune Rewards) → `dm_ruinouslord.webp`
via `art:wire --only=rune-reward minions,runes` + `optimize-art`; every other file the pass touched was reverted.

## Judgement calls (flag to owner)

- Self-inclusion: the Lord's own hits fire it and it buffs itself (Todd precedent). A Lord at 0 Health in the same
  exchange pays nobody.
- Only FRIENDLY Demons trigger it (Todd's trigger), though the printed text says "a Demon".
- Text keeps the owner's wording; it does not print "this combat" (combat gains are temporary by default).
- Rune of Ruins (Epic, "give your minions +2/+2") is a near cousin on the same trigger, not a duplicate.
