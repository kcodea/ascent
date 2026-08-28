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


## Follow-up 2: the Echo LEAD, and the owner's tuned values

Owner dialled the panel live and handed back `landingMs: 200` (from 480 → 300 → 200), then asked for the
purple skull to "trigger slightly earlier". It could not: with `echoDelayMs` floored at 0, the earliest the
Echo could fire was the moment the body was destroyed, because the cue only reaches the UI in the batch the
destruction produces. By then the moment has passed.

So `echoDelayMs` now takes NEGATIVE values, and negative means a LEAD rather than a delay: the skull fires
that many ms BEFORE the destruction, while the body is still on the board, so the departure lands INTO the
burst instead of following it. Default −120ms.

A lead needs a window to live in, and only Funeral on Loan has one — its landing. The lead is fired from the
landing timer (the one place that knows the window), which records the uid so the cue effect does not play the
same Echo again a beat later. A destroy that resolves in a single action (Graverobber) has no window at all, so
a lead there clamps to 0; giving it one would mean the same two-step treatment, which is a gameplay-ordering
change and was not made on a presentation ask.

Owner's values are the shipped defaults now, not just a localStorage entry — but note that a machine which
already tuned the panel keeps its stored values, so the new defaults only appear after Reset.


## Follow-up 3: Graverobber gets the same two steps, and the row holds before it closes

Owner: Funeral on Loan reads well now; Graverobber is still janky; and the survivors should wait "like a
10-20 ms delay" before sliding into the dead minion's slot.

**Graverobber is now two-step too.** `battlecryDestroyForSpell` MARKS the victim (`pendingDeath`) instead of
destroying it inline; the Echo, the departure and any Rise are the next action. That window is the whole point
— it is where the death smoke and the Echo skull have room, and it is what lets the Echo's negative lead fire
while the body is still on the board. Resolving inline gave the animations nothing to play over.

ORDERING NOTE, worth knowing: Graverobber's spell now arrives BEFORE the Echo rather than after it. The spell
is its SHOUT's payoff and belongs to the play; the death is what moved. The one visible consequence is a full
hand — a spell taking the last slot can crowd out a card the Echo would have granted.

Twelve `battlecryTarget` calls across `run.test.ts` needed their follow-up settle. `resolveShopDeath` is a free
no-op when nothing is pending, so wrapping the non-Graverobber aims too is harmless.

**The shift hold.** The board reflowed the instant a death committed, so the gap closed underneath the
animation still playing over it. The commit FLIP's removal branch now seeds the survivors at their old offsets
and DELAYS the tween by `shiftDelayMs` (default 15ms). The flag is set by the cue effect, which is the only
place that knows a death happened — the FLIP effect just sees an ordinary board change — and is consumed by
the single commit that follows, so every other commit glides exactly as it always did.

Owner's tuned lead (−40ms) is the shipped default.


## Follow-up 4: three Choose One reports — and a blind spot in the local test run

**Crest of the Climb still drew a target line while dragging.** The DROP path honoured "choose first" from the
start; the AIM path did not. `computeCastingSpell` — the one gate that decides whether a dragged spell enters
aim mode, shared by the reticle, the aim rAF and the re-render gate — knew nothing about Choose One, so a
targeted Choose One still demanded a minion under the cursor. It takes the predicate now, threaded through
`DragDecisionInput`, and the answer is derived once in `Recruit.tsx` for both the render and the rAF.

**A shop Veinbreaker under Rune of the Unbroken Vein printed "Choose One:" while the copy in hand read
(Both).** The predicate and the plumbing were both right; the tavern row and the spell slot simply build their
view options as long inline literals, and `chooseBothState` was in neither. It is a named, hoisted `bothState`
now, so a third surface is a one-word addition. A future global arm ("your next Choose One triggers both")
belongs in `chooseBothActive` beside the two rune flags, and every surface reading that object lights up at
once with no further wiring — which is what the owner asked for.

**(Both) follows the tribe colour.** It used the green `{{…}}` marker, whose meaning is "a modified value of
this card's own rule" — which (Both) is not. It has its own `<<…>>` marker rendering `.descboth`, coloured
from `--c`, the tribe variable the card root already sets. A Kobold reads #e8763a, a Beast green.

### The blind spot

`chooseOneBoth.test.tsx` did not run. **jsdom was never installed in this checkout**, so every `.test.tsx`
file silently reported "no tests" and the suite counted 521 files while CI ran more. The marker change above
broke three assertions in that file and the local run stayed green.

After `npm install`: **532 files, 7,682 tests** — 11 files and 102 tests that had been invisible all session.
CLAUDE.md already warns to run `npm install` inside a fresh worktree before trusting a local typecheck; the
same applies to the PRIMARY checkout, and the failure mode here is quieter than the one documented (a missing
optional dep skips files silently rather than erroring).


## Follow-up 5: new branch art, and per-BRANCH art framing

Owner dropped fresh Choose One second-option art: **apples2** (new), plus redraws of **facetwright2**,
**beetle2**, and both halves of **Veinbreaker** (base and second option). Wired through `npm run art:wire`;
only apples2 costs a file, since the rest overwrote art that already existed, so the itch ratchet moved 1045
→ 1046.

A process note worth repeating: `--apply` re-encodes every file in the jobs it runs, and webp encoding is not
byte-stable, so each pass shows ~100–280 modified files for a handful of real changes. Revert everything that
is not the intended change. Doing this in TWO passes (minions, then spells) also means the keep-list must
cover BOTH passes' files — the second revert otherwise undoes the first pass's work, which happened here and
cost a redraw of facetwright2 until it was spotted.

### The framing override the owner actually asked for

The pasted `cardArt.data.json` block turned out to be **byte-identical to what is already shipped** — 46 keys,
no additions, no changes. So the ask was not "apply these values"; it was that Coppercoat Spellsword's SECOND
OPTION needs its own framing and there was nowhere to put it.

Framing was keyed on the card id alone, so a resolved branch inherited the base art's zoom and offset. Base
art and branch art are different pictures and rarely want the same crop. `artVariantKey(cardId, chosenOption)`
now resolves the key an image is framed under — `n2_spellsword2` when that branch art exists, the card id
otherwise — and both the render (`cardArtVars`) and the tuner (`beginEditCardArt`) use it. Tuning a card while
a resolved branch is on screen writes the BRANCH's entry.

A branch with no entry of its own falls back to the card's, so this changed nothing for any existing card;
`chooseOneArt.test.ts` pins both directions.
