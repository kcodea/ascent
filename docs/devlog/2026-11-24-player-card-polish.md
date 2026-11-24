# 2026-11-24: Player card polish (after the showcase card shipped)

Owner review pass on the showcase player card (PRs 2866, 2869, 2870), done live against the dev server. Rule added:
R-SFX-STOPPED-PRESS-01.

## The card takes the hero select card's look (`partyHome/kit/phShowcase.css`)

The owner pointed at the hero select showcase card (`.phi`, phCompendium.css / heroShowcase.css) as the reference.

- The gold edge is `var(--ph-gild)` on `.phs-press::after`, over the art, so the art can never cover it. The rival and
  open-seat edges are drawn the same way.
- Corner `--ph-r-l` (was 3.4cqw, far rounder), solid `--ph-navy`, the hero card's drop shadow.
- The art fades by the hero card's eased mask on its BOX (solid to 72%, gone at 100%), with the image 6% larger about a
  point near the top. The box is 56% wide so the fade ends where the name column starts. A soft blurred wash of the same
  art sits behind the name side (off on the phone GPU path).
- The extra halo ring on your own card is gone, and the card no longer lifts on hover (owner asks).

## The tabs under your card

- Navy, on the layer under the card, tucked 10 units behind its foot. The card's big drop shadow moved to
  `.phs-card::before` (under the tabs), because cast from the face it dimmed the tabs' white labels.
- One width for all four (equal `1fr` columns of a shrink-to-fit grid), the Card plate tab 16 units wider. On the compact
  (three and four seat) card the tabs are sized in the card's own units so the row fits with no label cut off.
- A soft gold glow behind a hovered tab: a static shadow on `::before`, only its opacity fades.
- The Title tab shows the painted Titles medallion (`MenuMedal name="titles"`), not a rarity dot, so `PhCardTabs` no
  longer takes `titleId`.

## Three things worth knowing before touching this again

- **A stopped press is a silent press.** The tabs stop their `pointerdown` so the Versus room never drags from them. The
  app-wide click sound listens on `window` (Game.tsx), so it never heard them. The tabs now call `sfx.clickThock()`
  themselves (R-SFX-STOPPED-PRESS-01). Any new control that stops a press must do the same.
- **`.titlebadge` takes no presses anywhere** (styles.css sets `pointer-events: none`), and so does `.phs-art`. The
  card's press zones (`onArt`, `onTitle`, `onRank` on `PhShowcaseCard`) turn them back on with `.phs-artgo` /
  `.phs-titlego`. jsdom has no CSS, so a click test alone passes while the real page fails; the test pins the rules as text.
- **The inline sample card draws far outside its layout box.** `InlinePlateCard` lays out 218 px square but draws 536 x
  327 px (text box and tribe label below, tier crest above), with the drawn centre 91 px under the box centre. The
  customize window scales it to 0.68 and lifts it by that offset. The Collection does the same with its own numbers.

## Press zones on your card (Play lineup only)

Art opens the customize window on Avatar, the title badge on Title, the rank box goes to Career. Anything else, and a
keyboard press, still opens the card menu. Other players' cards get only the rank zone, where their menu has View Career.
Versus room cards are unchanged.

## Customize window

Section tabs show their medallion (Heroes for Avatar), tab names are white with smaller muted counts in both tab rows,
and the name and rarity sit up beside the section tabs so the preview has more room.
