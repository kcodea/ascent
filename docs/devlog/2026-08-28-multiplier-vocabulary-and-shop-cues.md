# The multiplier vocabulary, shop death/Echo cues, and a rule that changed twice in one day

## "twice" multiplies, "additional" adds

Owner rule, 2026-08-28: *"if something says 'twice' then it is a multiplier and not 'additional times' but
they do not stack, whereas 'additional time' texts do."* The card's own printed wording now decides how it
composes:

- **"trigger twice"** → a MULTIPLIER (`factor`). Copies of the same card do not stack; different multiplier
  cards multiply with each other.
- **"trigger N additional time(s)"** → ADDITIVE (`extra`). Every copy of every additive card counts.

`(1 + Σ extra) × Π factor`, which produces the owner's worked examples exactly: two Sylus → 3 Echoes; two
Drakko → still twice; Drakko + Zyff → four Shouts.

Drakko and Chronos became multipliers; Sylus, Zyff and Uron are additive. **Zyff and Uron now stack**, which
they did not before — their texts always said "an additional time", and the old model contradicted that.
Gilding doubles an additive card's `extra` and buys a multiplier **one more trigger** (golden Drakko is three
times, not four — owner ruling, chosen to preserve the power gilding already had).

The whole model lives inside `extraTriggerFires`. Every call site still reads `1 + extraTriggerFires(...)`, so
combat, the shop, the End-of-Turn replay and the Doc Bot lanes all changed behaviour without changing a line.

### A rule that was approved and revised on the same day

**R-MULT-02 was approved this morning** and says Uron + Chronos make End-of-Turn effects fire 2×, never 3×.
Under the new wording rule they fire **four** times. That approval was correct under the all-additive model it
was measured against; the model was replaced hours later.

R-MULT-01 predicted precisely this pass — *"the card texts will be reworded to signal non-stackers (e.g.
'Twice' instead of 'an additional time') — the owner's planned terminology pass, **not a code change**"*. It
turned out to be a code change: the terminology carried composition with it. Both rules are rewritten in place
with the owner's quote as evidence and an explicit note about what they superseded, rather than being quietly
edited to match the code.

The two Doc Bot lanes that failed (P12 and the battlecry matrix) are the tripwires doing their job. They were
updated, not deleted.

## Shop death and Echo cues

The shop has no beat playback — only End of Turn plays beats — so these ride the per-action scratch channel
every other shop FX uses (`shopDeathFx` + a `shopFxSeq` gate). The visual vocabulary is COMBAT'S, deliberately:
the same event should not look like two different things depending on the phase.

- an Echo TRIGGERED → `pixiFx.deathrattle`, the painted skull-shatter,
- a body DIED → the authored `death-dissolve`,
- a body that is RISING → neither; it re-forms rather than dissolving.

The Echo cue is stamped inside `fireRecruitDeathrattles`, the single chokepoint every shop Echo passes through
— a destroy, Ossuary Rite, Deathsayer, Rune of the Reliquary, a Gravetwin's copied Echo. Stamping at the call
sites instead is how the next one ships silently without its animation, which is the class of bug this batch
is about. The test asserts at that chokepoint for the same reason: a per-card fixture only ever proves one
caller.

**Position.** A dead body is off the board before the UI renders, so `findEl` cannot place its animation.
`Recruit.tsx` keeps a last-known-centre cache for board cards, refreshed in a layout effect declared *after*
the cue effect — React runs them in declaration order, so the cue still sees the previous layout, which is the
only place a body that just died still has a position. It reads at most a board's worth of rects once per
render (never per frame) and skips entirely mid-drag.

## Two fixture traps, same shape

Both surfaced while adding triple checks to shop deaths:

- `ownerBugs0826` built a full board out of six copies of one minion. Once a shop death checked triples, they
  legitimately combined and collapsed the board the test needed full.
- An earlier Apples test did the same with three sandbags.

A board fixture for anything that asserts on board state needs DISTINCT cardIds.

## Also

Funeral on Loan never checked triples — its play path returned before reaching any check — so a borrowed Echo
could hand you three of a kind and leave them. Graverobber's destroy already checked, through its
`battlecryTarget` case.

Quests were removed from the Scene Builder menu (owner: not actively developed). The `devGrant` quest path and
`QUEST_DEFS` are untouched — re-adding the section is putting the block back.


## Follow-up: the tuner, and "where the card was"

Owner, same day: the Echo must play WHERE the card was when it died, borrowed bodies should linger less, and
there should be a dev tuner for the timings and positions.

**Position.** The cue effect now decides by KIND rather than by what the DOM happens to hold. Any uid with a
`death` cue in the same batch is treated as dying, and its animations — including its Echo — resolve straight
from the last-known-centre cache, never from a live lookup. That closes a case the previous code could get
wrong: after a Rise the uid is gone but a DIFFERENT body now stands in that slot, so a live lookup could have
anchored the burst on the wrong card.

**Lingering.** 480ms → 300ms, and it is a dial now rather than a constant.

**The tuner** (`ShopDeathFxTuner`, dev menu → Buffs & Auras → 💀 Shop Death & Echo) exposes the time before
destruction, per-animation delays, an X/Y offset and a size scale, plus a kill switch for each animation.
Values are read at FIRE TIME, so an edit applies to the next death without a reload; DEV-persisted and inert
in production, like every other tuner.

No Test button, deliberately: these cues can only be judged against a REAL death, and both producers are one
click away in the Scene Builder. A synthetic fire would let you tune the flourish while telling you nothing
about its timing against the body actually leaving, which is the thing being judged.
