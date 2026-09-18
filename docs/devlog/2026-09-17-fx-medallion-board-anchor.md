# FX: `medallion` anchor part points at the actual pulsing gem (`.cgem`)

The `medallion` anchor part was mapped to `.plate-tribe` — the ornate **tribe plate**, which `Card.tsx`
renders on **hand cards only** (`usePlate`). Board/shop/combat minions never have it, so
`querySelector('.plate-tribe')` returned null and every board medallion resolved to the **card centre** (owner
reports 2026-09-17/18: the workbench realBoard preview and the in-game Shout burst both sat at the centre).

The "medallion" the owner means is the round **mechanic gem at the card's base that PULSES on a Shout / Rally /
crit / watcher** — `Card.tsx`'s **`.cgem`**, present on every board minion. `PART_SELECTOR.medallion` now
points at `.cgem`, so a medallion-anchored def (embermouth, shout-icon-effect) lands on that gem. The
Stage-setter mock decoy (`.plate-tribe` → `.cgem`, sized round at the base in `styles.css`) and the inspector
part blurb follow suit.

## Resolve at the RENDERED position, not the layout box
An earlier attempt "transform-corrected" a part rect to the card's un-transformed layout position (to chase a
hypothetical slide-into-slot). That was wrong: a just-played / hovered card is **deliberately scaled up and
lifted** (`matrix(1.21,…,-66)`), so the gem the player SEES is the transformed one. Correcting to the layout
box threw the shout burst ~80px BELOW the visible gem. `readUnitPartPoints` reads the plain
`getBoundingClientRect` (the on-screen rect), so the FX lands on the gem where it actually is — verified from a
live probe of the in-game fire (gem at y≈640, burst now there instead of the mis-corrected y≈721).

Files: `packages/ui/src/fx/anchorParts.ts` (+ test), `packages/ui/src/fx/ui/StageCard.tsx`,
`packages/ui/src/styles.css`, `packages/ui/src/fx/ui/copy.ts`.
