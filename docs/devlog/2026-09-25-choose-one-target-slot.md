# 2026-09-25 — A Choose One minion holds its board slot through the aim step

**Owner bug (verbatim):** "for choose ones, after choosing a choose one option, the card is sent back to hand.
the card should stay on board like it is during the choose animation for that targeting animation, too, and
only go back to hand if i cancel the targeting animation or w/e the action is."

## Root cause

Presentation only. The reducer was already right: a Choose One minion commits nothing until its branch and
target are settled (2026-08-28 deferral), so the card sits in `run.hand` the whole time, and the drop slot is
carried from `chooseOne.toIndex` onto `pendingTarget.toIndex` when a targeted branch is picked.

The board preview (2026-08-31: splice the hand card into the rendered board at `toIndex`, hide it from the
hand row) read **only `run.chooseOne`**. Picking a targeted branch (Runic Beetle, The Godfodder's consume
option) clears `chooseOne` and opens a deferred `pendingTarget`, so the preview dropped out, the card popped
back into the hand row, and the aim effect's origin lookup fell through to the hand card.

## Fix

- New `packages/ui/src/chooseOneHold.ts` → `chooseOneHeldSlot(run)`: the held card is the open non-spell,
  non-Equipment `chooseOne`, **or** a `pendingTarget` with `deferredPlay` and no `spell`. One gate.
- `Recruit.tsx`: the hand-row hide (`chooseOnePreviewUid`), the board splice (`chooseOnePreview`), the
  coalesce capture and its layout effect all read that gate. The aim step's click-away cancel now calls
  `captureCoalesce()` before `cancelChoice`, so the card glides home from its slot exactly like a prompt cancel.
- The aim origin needed no change: it already prefers the warband card with that uid, which now exists.
- No sim change, no gameplay change. The commit lands in the same slot (the same uid, so React keeps the node).

Checked alongside: a plain targeted Battlecry (Twilight Emissary, Toxin Tender) commits its body at play time,
so it is really on the board while aiming (unchanged). A Choose One branch with no target commits on the pick
(unchanged). Cancel at either step leaves Gold, counters, RNG and the board untouched (the reducer's no-op).
Cancel today is click-away at both steps, plus Esc on the prompt; the aim step has no Esc / right-click cancel
(not added here).

## Verification

- `packages/ui/src/chooseOneHold.test.ts` drives the real reducer: Choose One → target → commit (held at the
  drop slot through both steps, lands there), cancel at targeting and at the prompt (fingerprint unchanged),
  a no-target branch, a plain targeted Battlecry, spell / Equipment never held, and the Recruit wiring.
- `chooseOnePreview.test.ts` updated to read the gate from its new home.
- Oracle: **R-TARGET-05** in `packages/rules/src/registry/approved/targeting.ts`.
- Live on a worktree dev server (port 5231) with Runic Beetle: dropped into slot 1 → picked "Rise +1/+1" →
  Beetle stayed in slot 1, hand empty, beam from the board slot → picked the right Beast → landed in slot 1,
  target 2/2 with Rise. Second run: dropped into slot 0 → picked "Flurry" → held in slot 0 → click-away →
  back in hand, board and Gold unchanged, no console errors.
