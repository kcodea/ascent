# 2026-08-20 — Cia's enchant treatment follows the card (looping `cia-hp` FX)

Owner: replace the old persistent "enchanted foil" on Cia's Lucky-Seat offers with the workbench-authored
`cia-hp` def — "remove the wisps, gravity to zero… have it be a continuous emit" → then "make the effect fire
on AND FOLLOW a card. currently it is on a place. if i move cards it stays still." Owner chose the true-follow
build (attach the effect to the card).

## What changed (UI only)

- **`playDef` gained a `follow` option** (`packages/ui/src/fx/playDef.ts`). It is a `() => {x,y} | null`
  callback re-read every frame that overrides the snapshot anchors, so an effect's head rides a moving target.
  Returning `null` HIDES the effect for that frame (card mid-drag / briefly out of the DOM) without ending the
  play — retirement stays caller-owned, the same contract `loop` already established. This is the ONE
  sanctioned per-frame `getBoundingClientRect` in the FX path: bounded to the handful of Enchanted offers, and
  exactly what the retired `ciaEnchantedFx` foil did. The `emitter` primitive already inherits its head's
  velocity (`headVx/headVy`, read at spawn), so a moving head produces a natural drift rather than the whole
  particle cloud translating rigidly (which reads as pasted-on) — which is why the head follows, not a rigid
  container move.
- **`useCiaEnchantedFx`** (`packages/ui/src/useCiaEnchantedFx.ts`) now plays `cia-hp` with `{ loop: true,
  follow }`, tracking each card's live `.card.enchanted[data-uid]` rect and hiding while `.dragsrc`. It owns
  teardown (a looping player never retires itself): the loop stops the instant a card un-enchants (its uid
  leaves the list) or the shop unmounts (combat, title, a new run).
- **`cia-hp.json`** the CSS `.enchantwisp` swirl removed from `Card.tsx` (the def replaces it).
  `.enchantwisp` styles remain in `styles.css` unused — deletion deferred to a follow-up. Owner's final
  tune (after eyeballing the follow live): a ring of custom **spade** art motes — `shape: art:spade-2`, which
  ships the committed `fx/defs/art/spade-2.png` (128×128 RGBA) — drifting up under light gravity, add-blended
  on the four-stop gold palette.
- **FX registries** updated so the library still names the def played from code: `DIRECT_CALL_SITES`
  (`directCalls.ts`), the hardcoded id list in `directCalls.test.ts`, and a `UNIT_LESS` exemption in
  `playDefUids.test.ts` (it fires at a shop card's DOM rect, not a combat slot).

## Verification

typecheck ✅ · lint 0 errors ✅ · full suite 6320 passed / 2 skipped ✅ · build:web ✅. The visual follow
behaviour is the owner's to eyeball at 1× in a focused Chrome tab — a Pixi canvas cannot be rAF-sampled in the
headless preview.

## Follow-ups

- Delete the now-dead `ciaEnchantedFx.ts` and the unused `.enchantwisp` CSS (superseded by `cia-hp`).
- Owner ask: build **seamless-loop controls** into the FX workbench — a looped def currently re-emits only
  once the previous pass fully finishes, which reads as a pause between cycles; expose loop-overlap / cross-fade
  so a continuous emit loops without a visible seam.
