# 2026-09-12 — Starform pull FX, shortened Devotee / Herald / Twin Star texts, Collapse + Starform glossary pills

Owner asks, same day as the Celestial roster landed.

## What shipped

**Card texts (data only, `packages/content/src/cards/set3/celestials.ts`).** Corona Devotee now reads
`**Shout:** Consume your **Starform**.` (gilded: `…for **double** its stats.`), Nova Herald
`**Shout:** Collapse your **Starform**.` (gilded: `… — each gains its **full** stats.`), Twin Star
`Whenever your **Starform** gains stats, this does, too.` (gilded unchanged: `…this gains **double**.`). The
mechanics are untouched; the pill explains what Collapse does, so the card no longer restates it. The gilded
rewrites are a judgement call — same shape as the plain line, the rider kept as short as it can be while still
saying what changes. `npm run docbot:sync` regenerated `pendingConventions.generated.ts` (the Twin Star
exemplar quote); the text-parse lane's unresolved cap did not move.

**Glossary (`packages/ui/src/keywordGlossary.ts`).** Two mechanic-noun entries next to `consume`: `collapse`
("Your Starform breaks apart — 3 random friendly Celestials each gain half its stats (rounded up).") and
`starform` (the token's one-paragraph explanation). Neither carries a `badge` — the panel (`KeywordDefs`)
renders a pill from the text hit alone, exactly as Shout does, and the badge test pins the 16 schema codes
exactly, so `'CL'` would have failed both the type and the test. Consequence the owner accepted in advance:
every Celestial whose text names the Starform (most of the roster) now shows a **Starform** pill on the side.

**The `starform-pull` def (`packages/ui/src/fx/defs/starform-pull.json`).** The owner's workbench def, verbatim
apart from `id` and `version: 1`. Every layer anchors `source` and the beam travels source→target, so it plays
FROM the thing being consumed TO the thing gaining.

**The sim channel (`RunState.starformFx` / `starformFxSeq`).** One per-action channel modelled on
`shopEaten` / `shopEatenSeq`: `{ kind: 'consumeShop' | 'consumed' | 'collapse'; fromUid; toUids[] }[]`,
appended by `starform.ts` (`recordStarformFx`), cleared at the top of `reduce` beside `shopEaten`. Emitted at
three moments only:

1. the token eating a Shop minion — `starformConsumeShopMinion` (Accretion, Accretion Warden) and the
   creation-time meal in `createStarform` — from the eaten offer to the token;
2. `consumeStarform` (Corona Devotee) — from the token to the body;
3. `collapseStarform` (Nova Herald) — from the token to EVERY receiver. The factory's random draw now runs
   inside the collapse (a `receivers` callback, same rng order as before) so the record can name them.

A dismiss buy and a Demon eating the token emit nothing (`starformFx.test.ts` pins all of it). The seq bumps
with `?? 0` because a save from before the field restores without it and `undefined + 1` would poison the UI's
seq compare with NaN.

**The UI (`Recruit.tsx`).** Two sites:

- Case 1 rides the EXISTING `shopEaten` ghost: `consumeShopOffer` already records the token's meal with the
  token's uid as the eater, so `playFodderEat` now looks the eater up in the tavern row
  (`.card.starform[data-uid]`) when it is not a warband body, and fires `starform-pull` from the ghost's
  slot to the token INSTEAD of `consume-pull` — one pull, never two. The token also gets the eater "gulp"
  swell. The `starformFxSeq` watcher deliberately skips the `consumeShop` kind for this reason.
- Cases 2 and 3 are the new `useEffect` on `run.starformFxSeq`: the token is spliced from `run.shop` in the
  same commit, so its card is gone by the time the passive effect runs — the source rect comes from
  `shopRectsRef` (the drag layer's double-buffered measure cache: `prev` after the layout snapshot swapped,
  `cur` while a slot is held). No ghost is drawn for the token itself. One `playDef` per `toUids` entry, all
  fired together; a brief rAF retry if the receiving board card has not laid out yet; `sfx.consume()` once per
  action.

Registered in `directCalls.ts` (+ its test's pinned id list).

## Not done / open

- No ghost card for the token when it is consumed or collapses — the pull launches from the empty slot where
  it sat. If the owner wants the token to visibly fly/crumble like a Fodder ghost, that is a `heldConsume`-style
  hold on the Starform's slot plus a ghost; out of scope here.
- The Starform's stat hold (`holdStat`) on case 1 keys by the token's uid like any eater; the offer's number
  climbs on the pull's clock rather than snapping.
