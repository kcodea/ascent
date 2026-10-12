# 2026-10-12 — The hero-power Discover wears the Discover screen

Owner ask: the Power Shifter pick "is outdated. can we have this updated to be exactly like the discover screen?"
The hero-power offer (`RunState.powerOffer`: Mimic every turn, Void's turn-4 pair, the Power Shifter spell) was
still on the Quest Shop chrome from before the 2026-09-25 Discover redesign: a flat dark-glass banner, a thin
scrim, and three bespoke `.powerpick` plaques. It could not be minimized.

## Owner rulings (question tool, same session)

1. **Options are real cards.** Each power is a full card in the spell frame, not a plaque.
2. **Title is "Discover" + the "From X" line**, as on every other Discover. The old instruction sentences are gone.
3. **Peek at board is added.** The pick stays mandatory.

## What changed (UI only; no sim, no reducer)

- `PowerOverlay` (`Recruit.tsx`) now renders the real `DiscoverDialog` + `DiscoverPeekToggle`: the spotlight
  backdrop, the ornate banner, the fly-in entrance with its dust, shimmer and sounds, the golden burst layer and
  the pick cue (`data-pick-sfx`, replacing the old `sfx.pulse()`).
- New `discoverEntrance/powerOffer.ts`:
  - `powerCardView(heroId)` draws a power as a spell card (power art via `artUrl`, power name, rules text). Its
    `cardId` is namespaced (`heropower:<id>`) so it can never resolve to a real card, skin or def.
  - `powerOfferSource(slot)` names the banner source: "Mimicry", "Power Shifter", "Twin Voids · first pick" /
    "· second pick" (Void's two picks need telling apart now that the instruction line is gone).
  - `powerOccasion(run)` is the entrance key: a new offer flies in; Peek / Return and re-renders do not replay it.
- `CardView.kindLabel` (new, `Card.tsx`): rewords a spell-like card's kind line. A power card prints its HERO's
  name where a spell prints "Shop Spell". Colour and medallion still follow the kind. Added to `cardViewEqual`.
- `DiscoverDialog` gained `label` (accessible name) and `full` (every option `forceFull` + `plated`, as the Choose
  One does). A power cannot be told apart by art alone, so the text must show whatever the compact-cards setting.
- Peek state is `powerMin` in `Recruit`, reset per offer; `body.modalup` now reads `run.powerOffer && !powerMin`.
- The dead `.powerpick*` / `.power-ov-cards` CSS is removed.

## The one layout decision

A plated card with its drawer open hangs far below the square frame the row is laid out by. Centred like a plain
Discover, the plates ran under the Peek button (pinned at 67%, the one spot it has in both states). Rather than
move the button for this one offer, `.disc-full` reserves the plate's real footprint under each card and seats the
panel by its BOTTOM just above the button's line (`discoverEntrance.css`). Measured at 1600x900: plates end at
y 576, the hero line at 588, the button starts at 603. The Choose One (also plated, no Peek button) is untouched.

## Not changed, worth knowing

- Bold terms in a power's text take the card's tribe colour like any card text. A power card is `neutral`, the
  same as every Shop spell, so they read in the neutral tan rather than the old plaque's orange.
- The power text is still the static `power.text`, as it was on the plaques.

## Verified

`powerOffer.test.tsx` (card view, source line, occasion key, and the dialog rendered with real hero powers).
Live in the dev build from this worktree: Mimicry at turn 1 and a three-power Power Shifter offer (Copy Machine /
Undying / Empowering Vines); Peek hides the dialog and clears `modalup`, Return brings it back without replaying
the entrance, and a click adopts the power.
