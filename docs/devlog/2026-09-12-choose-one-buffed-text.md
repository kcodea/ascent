# 2026-09-12 — The Choose One window prints a spell branch's live (spell-powered) numbers

**Owner ask:** "If a Choose One spell is buffed, it should show the buffed spell numbers in the Choose One
windows as well."

## What was wrong

The Choose One prompt (`packages/ui/src/Recruit.tsx`) rendered each option with the branch's STATIC text
(`opt.text` / `opt.goldenText`). A spell Choose One casts its picked branch through the same spell factories as
any spell (`resolveChooseOneSpell` builds a synthetic def from the branch effects and hands it to `castSpell`),
so a branch whose factory folds spell power — Aspect's Blessing's `spellBuffRandomHand`, Apples'
`spellBuffRandomFriendlies` — granted more than the window promised. The hand card was already live (Apples was
fixed on 2026-08-31 by teaching `spellDisplayText` to read branch effects via `allEffectsOf`; Aspect's Blessing
is in that function's `flat3` list), but the window is a separate surface and had never been wired.

## What shipped

- **`chooseOneBranchText(cardId, index, golden, bonusA, bonusH)`** (+ `chooseOneBranchTextFor(def, …)`) in
  `packages/sim/src/recruit.ts`, next to `spellDisplayText`. It returns the branch's (golden) text with every
  magnitude the branch's cast will actually scale rewritten as a green `{{…}}` marker, in the same shapes
  `spellDisplayText` paints (`+A/+H` → `{{+A'/+H'}}`; a single-stat `+A Attack` becomes the live pair once the
  other stat's power is up, since the factories add both bonuses to any grant, else `{{+A' Attack}}`).
- **One fold rule, stated once:** `effectFoldsSpellPower(e)` = `on: 'cast'` AND `isStatSpellFactory(e.do)`
  AND not in Doc Bot's `SPELL_POWER_EXCUSED` (Apples' shop buffs are documented flat) AND not
  `params.flat === true` (Crest of the Climb opts out). `isStatSpellFactory` is the predicate Doc Bot's
  `spellPowerFolding` lane used to keep privately — it now imports the exported one, so the lane and the window
  can never disagree about what a stat spell is.
- Minion Choose Ones (Battlecry branches — Wildwood Shaper, Dealer, Elderhorn) are returned untouched: the
  helper bails on `!def.spell`. Equipment Choose Ones (Prismatic Pick) were checked and left alone — both
  branches are a Discover / a charge grant, nothing folds spell power.
- Recruit's window passes `spellAttackBonus(run)` / `spellHealthBonus(run)` for a spell card only, minus the
  next-Shop-spell bonus for a gift spell (mirroring `liveCardText`).

## Verification

- `packages/sim/src/chooseOneBranchText.test.ts` (12 tests): Aspect's Blessing greens both branches; Crest
  never greens; Apples' shop branch never greens while its random-friendlies branch does; single-stat shapes;
  golden variant; a sweep asserting every minion Choose One is untouched; a TRIPWIRE that every live spell branch
  whose factory folds actually greens (catches a future branch authored in an unrecognised text shape); and a
  SABOTAGE block that plays the spell through the real `reduce` (`play` → `chooseOne`) under
  `spellBonus: {1,1}` and asserts the stat delta equals the number inside the marker.
- Browser: a throwaway run on a dev server from the worktree — cast a spell-power source, then open Aspect's
  Blessing / Apples and confirm the window's numbers are green and moved (see the PR body).
- `npm run typecheck && npm run lint && npm test && npm run build:web` green; Doc Bot lanes green.

## Follow-ups

- The `spellBuffTarget` docblock used to justify Crest's `flat: true` with "since Choose-One option text isn't
  greened" — that reason is gone, but the flat design stands (owner-authored). Comment updated.
