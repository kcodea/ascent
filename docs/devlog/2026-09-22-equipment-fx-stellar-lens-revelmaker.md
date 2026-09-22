# Equipment FX: Stellar Lens + Revelmaker, and the Equipment tooltip loses its keyword pills

**Date:** 2026-09-22 · **Branch:** `feat/stellar-lens-fx`

## What shipped

Two owner-authored FX defs, wired to the Equipment that fires them, plus a small tooltip trim.

- `packages/ui/src/fx/defs/stellar-lens.json` — four camera-anchored bursts and a sparkle whoosh. Camera
  anchored on purpose: the Lens lights the shop, it does not spark on a button.
- `packages/ui/src/fx/defs/revelmaker.json` — two shard bursts and a ring off the Equipment button, with the
  `equipclang` clip. Source anchored, so it reads as the button throwing the Reveler out.
- `packages/ui/src/audio/fx/djartmusic-christmas-sparkle-whoosh-1-275404.mp3` — the Lens clip, previously only
  in the owner's working copy.

## How it is wired

Both are data. `EquipmentDefinition.useFxId` already exists (`packages/content/src/equipment.ts:66`) and the
recruit screen already plays it from the slot at `packages/ui/src/Recruit.tsx:2195` (and from screen centre at
`:4651` for a Choose One prompt). Six Equipment were already on that path, so the change is one field each:

- `STELLAR_LENS` → `useFxId: 'stellar-lens'`
- `REVELMAKER` → `useFxId: 'revelmaker'`

Nothing new was registered in `fx/directCalls.ts`: the `playDef(eq.useFxId, …)` call site is one of the
declared DYNAMIC sites, so an Equipment picking up a def adds no literal call and the snapshot test stays
green. `packages/ui/src/fx/defs.test.ts` validates the two files against the primitives' own param specs
(a typo'd param would be silently dropped at load, which is what that test exists to catch).

The owner's Revelmaker JSON arrived with the workbench's scratch id `workbench`; it is saved under the def id
`revelmaker` so the filename, the id inside the file and the `useFxId` all agree. Params are untouched.

## The tooltip trim

Owner ask 2026-09-22: "remove the keyword pill from equipment." `StatusBar.tsx` rendered a `KeywordDefs` block
under the Equipment rule, which turned a small hover into a wall of text for a definition the player can read
on any card that carries the keyword. The block is gone; the rule and the charges stay.

## Not done

No browser capture of either effect: the wiring is the existing proven path and the def files validate, but
nobody has watched them fire in a live shop yet.
