# Dwarven Ale shop-cast FX — design

**Date:** 2026-08-11
**Owner:** Mike (presentation)
**Branch:** `feat/ale-shop-fx` (FX authoring in the playtest worktree)

## Goal

Give each of the five Set-2 **Dwarven Ale** shop spells its own bespoke cast FX, fired when the card is
released to play it in the shop. Today all untargeted shop spells share one generic `fireSpark` burst
(`Recruit.tsx` ~4244) — there is no per-card FX path for a shop cast. This adds one.

The five ales (`packages/content/src/cards/set2/spells.ts`):

| Ale | id | Effect | Look intent (settled in workbench) |
|---|---|---|---|
| Golden Ale | `wo_mine` | gain 2 Gold | amber froth burst, gold coins spraying outward |
| Reinforcing Ale | `wo_reinforcement` | summon a minion of your most common type (to hand) | a muster/forge shimmer, a body-summoning glint |
| Champion's Ale | `wo_champion` | +6/+6 to left-most | one heavy, weighty impact spike |
| Defensive Ale | `wo_health` | +4 Health to 3 random friendlies | green shield-motes blooming upward |
| Bloody Ale | `wo_attack` | +4 Attack to 3 random friendlies | red slash arcs / crimson spatter |

## Core decision: origin = the `cursor` anchor (the release point)

Every ale's FX **originates at the point the card is released** — the live pointer position. The engine
already names this: the **`cursor`** anchor (`fx/anchors.ts` `FX_ANCHOR_IDS`; `fx/scenarios.ts:18` —
"the live pointer position in page coordinates"). The workbench has a **pinned-cursor scenario** that
stages `cursor` at the pointer, so a def authored there fires from exactly where it was authored to.

No payoff-target anchoring, no DOM measuring of buffed minions, no recruit-moment cascade, **no sim
change**. The anchor is the pointer, known at the cast site.

## Architecture (entirely in the presentation layer)

1. **`spellCast` becomes a workbench-bindable kind**, keyed per-card
   (`cards.wo_mine.spellCast → ale-golden`, etc.) in `bindings.json` / `bindings.ts`. It is a
   binding kind, *not* a `RecruitMomentKind` routed through the cascade cue runner (that runner is
   uid-anchored and DOM-measuring; this fire is a raw point and needs neither).
2. **At the cast site** (`Recruit.tsx applyDrop`, the untargeted `up` spell branch ~4243, and the
   targeted branch ~4239): resolve `bindingFor(cardId, 'spellCast')`.
   - **Bound** → `playDef(binding.def, { cursor: dropPoint, source: dropPoint, target: dropPoint, camera })`
     at the release x/y, and **suppress the generic `castSparks`** for that cast (the same
     "an authored def replaces the stock cue" rule the buff/Karwind paths already follow).
   - **Unbound** → unchanged: today's `castSparks` / `fireSpark`.
3. **Five authored defs** in `packages/ui/src/fx/defs/`, each with `cursor`-anchored layers, bound to
   its ale.

## Build order

1. **Wiring slice first** (the risky part, landed before art): add the `spellCast` binding kind + the
   cast-site fire + spark suppression, with **one** ale bound to a placeholder def. Prove it fires from
   the release point in a real cast, and that the generic spark no longer double-fires for it.
2. **Author the five defs** in the workbench (pinned-cursor scenario), agreeing each look on a cheap
   preview before wiring the full def.
3. **Bind all five**, verify each fires on its ale, publish.

## Verification

- `npm run typecheck && npm run lint && npm test && npm run build:web` green.
- Live: cast each ale in the shop, confirm its def fires from the release point and the generic spark is
  gone for bound ales (and still present for other, unbound spells).
- `bindings.ts` binding-kind tests updated for the new `spellCast` kind.

## Out of scope

- No new combat FX. No sim/content changes (attribution in `applyCastEffects` stays `sourceCardId: ''`).
- No coins-fly-to-the-gold-counter second anchor — Golden bursts at `cursor` like the rest (coins may
  spray outward from there, but there is no HUD sink to chase).
