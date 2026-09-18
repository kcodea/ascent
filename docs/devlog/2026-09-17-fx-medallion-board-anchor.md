# FX: `medallion` anchor part points at the actual pulsing gem (`.cgem`), resolved at the settled slot

Two related fixes for the `medallion` anchor part, both in `anchorParts.ts`, from owner reports 2026-09-17.

## Fix 1 — wrong element (the real root cause)
`medallion` was mapped to `.plate-tribe` — the ornate **tribe plate**, which `Card.tsx` renders on **hand
cards only** (`usePlate`). Board/shop/combat minions never have it, so `querySelector('.plate-tribe')` returned
null and every board medallion resolved to the **card centre**.

But the "medallion" the owner means is the round **mechanic gem at the card's base that PULSES on a Shout /
Rally / crit / watcher** — `Card.tsx`'s **`.cgem`**, present on every board minion. `PART_SELECTOR.medallion`
now points at `.cgem`, so a medallion-anchored def (embermouth, shout-icon-effect) lands on the gem — exactly
the object that flashes when the effect fires.

Also updated: the Stage-setter mock card's decoy (`.plate-tribe` → `.cgem`, sized round at the base in
`styles.css`) so the workbench preview resolves the medallion too, and the inspector part blurb.

## Fix 2 — resolve parts at the RESTING slot, not mid-slide
A Shout played from hand fires its burst as the card SLIDES into its warband slot. The base anchor was already
transform-corrected (the recruit path measures with `restingCenterOf`), but the **part** was read off raw
`getBoundingClientRect`, which mid-slide is the drop position — so the burst emerged where the card was
released. `readUnitPartPoints` now transform-corrects every part rect to its resting position (`restingDelta`,
the same offset `restingCenterOf` computes). No-op with no transform (combat) or for test stubs (no
`offsetParent`).

Together: a Shout on a board minion emerges from the **settled card's trigger gem** — "where the card is on the
warband after I placed it."

Needs an in-game by-eye check (the play-settle DOM is transient, not unit-testable without jsdom).

Files: `packages/ui/src/fx/anchorParts.ts` (+ test), `packages/ui/src/fx/ui/StageCard.tsx`,
`packages/ui/src/styles.css`, `packages/ui/src/fx/ui/copy.ts`.
