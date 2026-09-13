# 2026-09-12 — Live text standard: the current value replaces the printed number in place; two renames; Lantern of Souls

Owner, looking at Stellar Chorus in hand reading "Give a minion +2/+2. Improve this by +3/+3 … **Now +5/+5.**":
*"the correct behavior for this is to say: 'Give a minion +5/+5…' instead of adding the 'Now +5/+5' at the end.
this behavior should be the standard. simply turn the text green for current values. only in explicitly asked
situations should it differ."*

**The standard, as encoded:** when a spell's grant depends on live state, the printed grant token is REPLACED by
the current value, wrapped `{{…}}` so the card paints it green. No appendix. A per-step rate that only scales
with spell power greens on its own token; a base that stands unchanged stays plain. Applied to the three spells
that carried a "Now" appendix (`spellDisplayText` in `recruit.ts`): Stellar Chorus, Crescendo, Patch Job.

**Deliberately NOT changed:** Cling Drone's and Eternal Knight's `{{Now +A/+H}}` / `{{… this run}}` tallies.
Their printed number is a per-event STEP ("your Cling Drones get +1/+1" per magnetize); the live figure is the
accumulated run-wide total, which is a different quantity — replacing the step with the total would misstate
the rule. They stay as a trailing tally until the owner rules otherwise.

**Renames (display only, ids and art unchanged):** Comet Conductor → Neptus; Orrery Artificer → Cometius.

**Lantern of Souls:** "Give your Undead Aura +3 Attack." Under +0/+1 spell power the live text reads
"+3/+1" (owner's example); under Attack-only power it keeps the Attack wording ("+4 Attack"). The engine was
already folding both stats; only the text moved.
