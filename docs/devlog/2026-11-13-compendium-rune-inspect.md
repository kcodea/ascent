# 2026-11-13: Compendium rune inspect is one measured, centred group

Owner report: "this is in the compendium, inspecting a rune. fix this view please" (Guel's Apprentice: the Staff of Guel
preview lapped over the rune, hung lower than it, the pair sat off centre). Branch `fix/compendium-rune-inspect`. Oracle:
R-RUNE-INSPECT-01 (`registry/approved/foundation.ts`). Test: `packages/ui/src/runeInspectLayout.test.ts`.

## Why it broke

`RuneInspect` reused the card Inspect's `.inspect-card` (a flex row, `align-items: center`, fixed `scale(1.9)
translateY(-15%)`). Its only rune-specific layout lived under `html[data-touch-ui]`, so a mouse player got none of it.
A plated card PAINTS far past its layout box (the plate ~0.25 card widths each side, ~37px above, the "Shop Spell" label
~150px below; a Mooncloud plate's clouds further still), so flex spacing could not keep it off the rune, centring the
boxes left the painted plate low, and two named cards could land on one spot (Living Geode showed its two cards stacked).

## What it does now

- `.rune-inspect` is its own block (styles.css), not `.inspect-card`, so no card-Inspect or touch scale/translate/zoom
  rule reaches it. The old touch block (touchUi.css) and the compact-book zoom (phCompendium.css) are gone.
- `fitGroup` (RuneInspect.tsx) measures once per open and on window resize, before the first paint: the rune card
  (+ coin), and the union of everything each named card paints. `planRuneInspect` (runeInspectLayout.ts, pure) puts each
  card a 28px gap to the right, plate top level with the rune top; stacks them under the rune when that draws bigger (tall
  narrow windows); scales the group to fit (max 1.9, the card Inspect's size), centred, higher when the touch Pick pill shows.
- Rects are mapped into layout px by probing two known moves of the group, so a scaled stage, a zoomed page or the
  sideways phone stage all work without assuming the screen-to-layout map.
- Named cards keep the rune hover reveal's ratio (`zoom: var(--z-inspect-s)`), so they read larger than before.
- The pressed rune's own hover reveal is hidden while the view is open (`body.rune-inspecting .cardref`).
