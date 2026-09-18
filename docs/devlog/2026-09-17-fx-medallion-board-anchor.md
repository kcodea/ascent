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

## Resolve parts at the card's SETTLED slot (affine-invariant)
A Shout played from hand fires WHILE the card is still animating into its warband slot — and the card's
transform at fire time is BOTH a slide (translate, drop → slot) AND the hover enlarge (scale + lift):
`matrix(1.21,…,-66)` from a live probe. A first attempt shifted the part by the card's translation delta —
which can't handle the scale, so the burst landed ~80px below the gem; reading the raw on-screen rect instead
put it where the card was RELEASED (mid-slide).

`readUnitPartPoints` now takes each part's FRACTIONAL position inside the card's live (transformed) rect and
maps it onto the card's **settled layout box** (`settledCardRect`, the offsetParent + offset* geometry
`restingCenterOf` uses for the base). A fraction is invariant under the card's affine transform, so this
cancels the slide and the scale together — the gem resolves to its settled slot, "where the card lands." With
no transform (combat, workbench, stubs) the settled box equals the live rect and the mapping is the identity.

Files: `packages/ui/src/fx/anchorParts.ts` (+ test), `packages/ui/src/fx/ui/StageCard.tsx`,
`packages/ui/src/styles.css`, `packages/ui/src/fx/ui/copy.ts`.
