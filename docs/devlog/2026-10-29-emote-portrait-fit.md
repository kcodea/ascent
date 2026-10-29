# 2026-10-29 — Emote bubbles fit their portraits

Owner follow-up to #2405: "The emote and spectator area looks a bit better but emotes should eclipse the players icon a
bit more and be more vertically aligned and sized appropriately to the portraits". Rule: R-EMOTE-LAYOUT-01 (amended).

**What.** Every bubble (your hero, rail rows incl. a Duos teammate, the Versus foe block, the combat foe, spectator
plates) is now placed from its portrait's rect: level with its middle, its near edge (the painted tail on the right side,
the frame's right end on the left side) 30% of the portrait's width into it, and its width a fixed multiple of the
portrait's width per surface (`BUBBLE_TO_PORTRAIT`: hero 1.15, rail 3.1, foe 1.45, spectator ring 2.3), floored at 170
stage px for readability, x1.2 on a phone. Measured on desktop: hero 266 -> 306, rail face 58 -> 180, ring 88 -> 202.

**How.** `fitToPortrait` (pure) builds the placement; `bubbleBox` now centres on `y` and puts the near edge on `x`, popping
from that edge. The no-overlap slide (`settleBubble`), the waiting queue, the caps and the never-mirrored rule are
unchanged; a bubble slid to clear another leaves the exact centre, by design.
