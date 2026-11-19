# 2026-11-19: the portrait window (avatar picker rebuild)

Owner: "this portrait select menu is so extremely outdated. using all of the UI elements we've created over the last
few weeks, please propose a change", then "add a section that allows players to also select any hero or minion
cosmetic they've unlocked from their collection".

## What changed

`packages/ui/src/AvatarPicker.tsx` is rebuilt on the party home kit (`.phk-dialog` veil, `PhTabs`, `PhSearch`,
`PhButton`, `PhEmpty`, `PhBanner`) with its own stylesheet, `avatarPicker.css`. The old `.avatarpick-*` rules are gone
from `styles.css` (only `.avatarpick-close` stays: the account panel uses it).

- Tabs: My Skins, Heroes, Minions, Hero Powers. Only the grid scrolls.
- A press selects and previews (your equipped portrait frame, your banner); "Use portrait" saves. A double press
  applies at once. It used to pick and close on one press.
- Search filters by name; the tab counts become the match counts.
- "Reset to default" replaces the lone dash tile.

## Skins as portraits

A skin portrait is saved as `skin:<art key>` (the catalog item's `assets.art`, which is the cosmetic id). `art.ts`
adds every bundled skin to the `avatarSrc` map, so the Leaderboard, Career and banners resolve it for every viewer
with no other change. The id fits the `profiles.avatar` 64 character check.

Decisions worth knowing:

- Ownership is checked in the client only. `profiles.avatar` takes any id today (the same as every other portrait),
  so a hand-edited value can show an unowned skin. A server check would be its own change.
- The portrait is independent of the loadout: you do not have to equip a skin to wear it as your portrait.
- `avatarSrc` does not consult the kill switch, so a retired skin already chosen as a portrait keeps showing. The
  window itself only offers live skins (`albumOf`).
- Hovered names go to a caption line under the grid, written straight to the DOM: the game's `data-tip` bubble is
  clipped inside a scrolling box, and a hover must not re-render a few hundred tiles.
