# 2026-09-19 — Kurse (Set 3 Kobold) + Pickles' Ruby branch to 3

Owner handoff 2026-09-18, two items in `packages/content/src/cards/set3/kobolds.ts`.

## Pickles (`k3_splitpick`)

The second Choose One branch pays **3 Rubies** (was 2); gilded **6** (was 4). `params.count: 3`, the branch
texts and the card `text` / `goldenText` all moved together. No test had pinned the old 2/4.

## Kurse (`k3_kurse`) — T5 Kobold 10/5

> **Avenge (3):** Summon a **1/1 Gemheart Golem**, plus this minion's Rubies.

**One arena body, two triggers.** Gemheart Carver's Echo already runs `ARENA_EFFECTS.deathrattleSummonRubyStats`
— a `tokenId` (Gemheart Golem) at `(1 + rubyTally) × gild`, where the tally is the shop `Ruby` buff plus every
mid-combat `rubyGain`. Kurse's new combat factory `avengeSummonRubyStats` is a thin wrapper: the standard Avenge
gate (`side === self.side`, `avengeCountFor` so a risen body restarts, `seen % count === 0` so it fires on EVERY
multiple) and then the SAME arena body. Nothing about the Golem's stats is re-derived, so Carver and Kurse can
never drift.

- It is NOT added to `ARENA_EFFECTS` itself — Avenge is combat-only and the arena ratchet requires every arena
  body to be reachable from both phases. The wrapper lives in `factories.ts` beside Carver's combat wrapper.
- Lands beside Kurse via `ctx.summon(…, self.uid)`; a full board takes the ordinary `summonOverflow` path.
- **Golden = Carver's convention exactly** (owner ruling 2026-08-04): ONE Golem at double stats
  (`(1 + t) × 2`), never two Golems. Text: "Summon a **2/2 Gemheart Golem**, plus double this minion's Rubies."
- **Printed "1/1" is static, matching Carver.** Carver has no live-text helper; the referenced-card hover shows the
  Golem at its live stats through `tokenRefView`'s `ownerRuby` branch, which keys off the `tokenId` param — so
  `avengeSummonRubyStats: 'tokenId'` was added to `CARD_REF_EFFECTS` and Kurse's hover previews the Golem exactly
  as Carver's does. The test pins Kurse's text as Carver's with the keyword swapped.

Registered in the four places a factory needs: `EffectFactoryId`, the content schema whitelist, the presentation
policy registry (`factory:avengeSummonRubyStats:avenge` → ownBeat/avenge) and `CARD_REF_EFFECTS`. Contracts
re-extracted (1048 → 1049; the pending `avenge` convention question now lists 21 carriers); `final-report.md`
headline numbers moved; the balance fixture snapshot re-pinned (a new pool card reseeds shop draws); set-3
roster pin appended; art ratchet 1253 → 1254 for `k3_kurse.webp`.

Tests: `packages/sim/src/kursePickles.test.ts` — 1/1 after three friendly deaths; 3/3 with +2/+2 of Rubies;
golden 2/2 and 6/6; six deaths → two Golems; a Wall-echo full board → no Golem; enemy deaths never count; Pickles
hands 3 / 6 Rubies through the reducer.
