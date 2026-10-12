# 2026-10-12 — Power cards: the plate lines up, and the helm is retuned

Owner feedback on the hero-power Discover (shipped earlier the same day, PR #2048), four points:

1. "the cardplate darkening overlay is too high, it needs to be lower to matchup with the gold trim."
2. "the layout of the text on the card is too low. it should exactly match the layout for existing spell cards."
3. "the medallion is slightly too high, can we nudge it down like 6 pixels or so?"
4. "the green glow is too prominent, can we reduce that by about 40% and increase the dropshadow intensity?"

## 1 + 2: one cause, measured

Measured at 1920x1080, every part of a power card against a real spell in hand, as a fraction of card width from
the card's top:

| part | hand spell | hover preview | power card (before) |
| --- | --- | --- | --- |
| plate top | -0.268 | -0.268 | **-0.206** |
| dark backbox | -0.150 → 1.812 | same | same |
| name | 1.160 → 1.263 | same | same |
| rules text top | 1.373 | same | same |

Only the plate differed. Its lift, `--plate-top`, is plain px (`-37px`) tuned at the standard card size; the offer
row draws cards 1.3x, so the plate sat ~11px low against the frame, text and backbox. That is point 1 exactly: the
darkening ended above the plate's gold trim.

Fix: `--plate-k` (default 1) multiplies the lift at its three uses in `styles.css` (the plate, its bottom-gem label,
the plated step counter). `.disc-cards` sets it to 1.3, the same bump as its `--ch`. After the fix the power card
reads -0.268 and every row of the table matches. The full Discover row reserves the scaled footprint and hands the
extra lift back as top margin, so the plates still end 15px above the Peek button and the banner keeps its gap.

**The Choose One gets the same correction** (it is the same row and had the same 11px error).

**Point 2 is not fully understood.** The text was already identical to a hand spell; relative to the plate it now
sits ~11px LOWER than before, which is the opposite of "too low". The explicit instruction ("exactly match the
layout for existing spell cards") is now met to three decimals, so that is what shipped; flagged to the owner.

**Not fixed:** `--plate-top` is still plain px, so above 1920x1080 (where the standard card itself grows) hand
cards drift the same way. Not measured. Recorded as PARTIAL in rule `R-PLATE-01`.

## 3 + 4: the helm

`spellMedallionConfig.ts`, kind `power` (CSS fallbacks moved with it):

- Seat: `dy -3 → 3` (6px lower at the reference card width).
- Glow: strength `0.6 → 0.36` (40% less), then `→ 0.29` ("reduce the glow by another 20%", same session).
- Drop shadow: it was already fully opaque black, so "more intense" is a tighter, deeper shadow: blur `6.5 → 4`,
  drop `4.5 → 6`. This reading of "intensity" is Claude's, not the owner's; it is two dials in the 💠 tuner.

## 5: the five-star plaque (asked mid-work)

"can we add the same tier badge with 5 stars up top? just like how it is in the power shifter spell?" Every power
card now carries `tier: 5` (`POWER_CARD_TIER`), so it wears the same star plaque as the Power Shifter spell, at the
same seat. It is a look, not a rule: a power has no tier. It applies to Mimic's and Void's offers too, since they
share the card; that reach is Claude's reading, flagged to the owner.

## Verified

`offerPlateScale.test.ts` pins the two 1.3s to each other, every `--plate-top` use to `--plate-k`, and every
medallion fallback to its tuner default. Live in the dev build: the ratios above, plus magnified renders of a hand
Power Shifter and a power card side by side.
