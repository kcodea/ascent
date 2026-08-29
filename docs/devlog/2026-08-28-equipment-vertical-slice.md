# Equipment — the engine vertical slice (Alchemist Frank + Bloodpot)

Owner handoff 2026-08-28. Equipment is a Shop-phase, second-hero-power-shaped ability GRANTED BY A MINION:
played, it hands the player an Equipment that costs Gold, spends from a shared per-turn allowance, and is
rebuilt from the board every Start of Turn. This lands the ENGINE half plus the reference card. The handoff
was explicit that only Alchemist Frank ships — no wider roster.

## The architecture questions the handoff asked, answered from the code

The handoff asked me to question anything conflicting with the engine before encoding brittle exceptions.
Eight questions, eight findings — three of them conflicts:

1. **Hero powers are authoritative engine entities**, not UI wrappers (`HERO_INDEX`, `activePowers`, real
   per-slot state).
2. **There is NO targeting transaction.** Hero powers never touch `pendingTarget`: the UI arms the power
   (`heroArmed`, UI-only), the player clicks a target, and ONE action validates, pays and resolves. Cancelling
   never reaches the reducer. → The handoff's 8-step transaction has no engine analogue.
3. **Start of Turn has no priority layers** — it is an imperative sequence in the wave advance. "First
   operation" is achievable only positionally.
4. **Effect copies already behave as specified**: repeats reuse the original payload (same target) while
   factories draw fresh RNG per call (randoms re-roll), and the repeat COUNT is read once then looped — the
   handoff's "snapshot the trigger count" is the existing behaviour.
5. **Replay v2 is STATE replay, not event replay.** It cannot carry per-trigger causality. → conflict.
6. **A native second power already has independent usage state** (`heroReady2` / `heroPowerSpent2` /
   `heroPowerUses2`, plus `slot` on the action) — but as a hardcoded PAIR, not N slots.
7. **No refresh event needed** for transforms or in-place gilding: the handoff's own rule (they do not
   re-Equip; the next rebuild picks them up) falls out of the rebuild.
8. **There is no shop timer at all.** The real problem is that only End of Turn plays beats, so per-minion
   re-equip BEATS would be recorded and never performed. → conflict.

## The three owner decisions those produced

- **Activation is ATOMIC**, matching every existing power. "Cancel spends no Gold and no activation" therefore
  holds by construction — a cancel never reaches the reducer — and there is no pending state to persist.
- **Re-equip uses a per-action FX CUE, not a beat** (`equipFx` + `equipFxSeq`), the same channel the shop
  death/Echo cues use. One cue per SOURCE BODY in board order, even though duplicates collapse into one
  selector entry.
- **State-only replay**, with `docs/replay-v2-causality.md` recording what a future revision would need.

## What landed

`content/equipment.ts` defines Equipment by ID (several cards may grant the same one — which is exactly why
the duplicate/Gilded precedence rules exist), `sim/equipment.ts` owns the state machine, the reducer owns the
two actions, and `recruit.ts` owns effect resolution because the factory table is private to it.

The load-bearing shapes:

- **`grantEquipment` is the single write path**, used by both play-time equip and the rebuild, so duplicate
  collapsing and Gilded precedence can only be implemented once.
- **Uses are DERIVED** (`equipmentUsesLeft`), never a second stored flag — the handoff asked for this
  explicitly and it is what makes bonus activations a one-field change.
- **Equipment is RunState**, so replay/reconnect capture it for free via inclusion-by-omission.
- **`equip` is its own trigger**, not a Shout: it re-fires on the rebuild, and nothing that re-fires Shouts
  (Drakko, Myra, Resonance) re-grants Equipment as a side effect.

The Start-of-Turn rebuild is the first operation in the wave advance. Since there are no priority layers, that
guarantee is positional — so a test pins it by observation rather than trusting the comment.

## Ratchets that fired, and what each one wanted

Adding a trigger and a card tripped seven gates, every one of them correctly:

- `factoryPhase` — the `equip` trigger needed a declared phase (recruit).
- `presentationPolicies` — `factory:grantEquipment:equip` needed a classification.
- `interactionGraph` — `equip` needed a channel (summon: it is arrival-driven).
- `refIntegrity` — **the sharpest one**: it asserts every `*Id` param resolves in `CARD_INDEX`, and
  `equipmentId: 'bloodpot'` does not. Rather than loosen the rule, `equipmentId` is excluded from the card
  sweep and checked against `EQUIPMENT_INDEX` in a test of its own — so widening that exclusion set means
  "checked somewhere else", never "unchecked".
- `allTypesPill` — Frank has no art yet; `e3_` joins `c3_` as set-3 scaffold.
- `contractExtract` + the report drift rail — regenerated.

## The UI

The second slot renders from `run.equipment` and nothing else — the handoff requires that "game-state and
effect code must not assume Equipment permanently lives inside a particular visual component", so moving it to
a dedicated button later is a change to one block.

- With **no** native second power, Equipment takes the second slot outright (it inherits the `.heropanel2`
  seat). With one, `.beside` offsets it a button-width; they are never stacked, because their usage budgets
  are independent and covering one would hide live state.
- **Arming is its own flag** (`equipArmed`), not a shared "armed" boolean: a player may hold Equipment and a
  native power at once, and one shared flag would let arming either silently cancel the other. Arming either
  clears the other deliberately, in the store, where that rule is visible.
- The selector renders only when there is more than one option — with a single Equipment, a picker is a
  control that can only do nothing.
- Unaffordable or spent → visible but **disabled**, with the tooltip saying which, per the handoff.
- Equip / re-equip flashes are CSS one-shots fired from the per-action cue list, staggered by source so several
  Equip minions read left-to-right rather than as one blur. They are removed on cleanup as well as on their
  timer, so a route change mid-flash leaves nothing behind.

### Verified live

Driven through a throwaway Practice run in the browser, not just in tests: playing Frank granted Bloodpot and
fired the cue; the panel rendered "Bloodpot", cost 1, 1 use, enabled; pressing it armed; activating on a target
paid 1 Gold and applied +3/+3; the panel then read 0 uses and disabled itself; and a full turn cycle
(faceOmen → settleCombat → resolveCombat) re-equipped it with the allowance back to 1 and a re-equip cue. No
console errors.

## Not built, deliberately

**Combat-effect queuing.** The handoff describes it, but no Equipment queues one, so building the state now
would be an empty box with no observable behaviour to test — and the handoff's own instruction is to implement
only Frank. It is state plus a factory away when a card needs it.

**Cost-reduction SOURCES.** The field, its additive stacking and the zero floor all exist and are tested;
nothing grants a reduction yet.

**Equipment Spells ARE built** — the handoff asked for the classification ahead of the roster, so
`equipmentCastSpell` routes through the real `castSpell` path (a Shop-spell cast, Shop-spell improvements,
"after you cast a Shop spell" listeners, spell-multiplier duplication) while never entering the hand and never
counting as a card played. No Equipment uses it yet; the contract is tested against a definition constructed
in the test rather than a card added to the registry.


## Art

`AlchemistFrank.png` and `Bloodpot.png` wired through `npm run art:wire`, which needed two new jobs:

- **set-3 minions**, scoped to `Neutrals` only. The Celestial folders still hold art for the sixteen archived
  earlier the same day, and wiring them would ship art — and itch file count — for cards that are out of play.
  Widen that list when the reworked tribe lands, which is exactly when those files mean something again.
- **equipment**, its own source folder and its own destination (`art/equipment/`), matched against the
  EQUIPMENT registry by name. Deliberately not the minion folder: an Equipment is granted by a card but is not
  one, and sharing a folder would let an icon shadow a card with the same id.

`equipmentArtFor` indexes that folder; the button shows the icon when one exists and falls back to its glyph
otherwise, so an Equipment authored ahead of its art still renders.

With Frank's portrait wired, `e3_` came OUT of the `allTypesPill` art exclusion. Only the archived `c3_` set
is excluded now, so the next Equip minion authored without art fails that gate rather than silently shipping a
tribe sprite.

Art ratchet 1046 → 1048 (two files).

`Heroes/FranticFrank.png` is a DIFFERENT card and was left alone — the strict name matcher never guessed at it,
which is the whole reason that matcher is strict.


## The aim line came out of the wrong button

Owner report, on the first live look: Bloodpot was selected and armed, but the targeting line was drawn from
the hero's Aegis power.

`.statusbar .heropowerbtn` matches the FIRST power button in document order, which is always the hero's native
one. That was fine when there was only ever one armable button; there can now be three at once (native, a
native second power, Equipment). The anchor is chosen from what is ARMED now, not from what is first — with
the old first-match kept as a fallback, because an aim line from the wrong place still beats no aim line.

Worth noting the shape of the bug: nothing about it was Equipment-specific. Void's second power had the same
latent fault — arming slot 1 drew its line from slot 0 — and it went unnoticed because a two-power hero is a
rare pick. The fix covers all three.


## The authored equip effect, the clang, and a tuner for their timing

The owner authored `equipment-spark` in the FX workbench (four layers: two shard bursts and two shockwaves,
900ms) and recorded `equipclang.wav`. Both are wired to the moment a minion grants its Equipment.

**Three things fire, and their RELATIVE timing is the whole question** — which of the source burst, the slot
burst and the clang leads, and by how much, can only be judged by eye and ear together. So all of it is dialed
from the ⚒️ Equip FX & Clang tuner rather than guessed at in code: a delay per element, an on/off per element
(so a pair can be isolated), a per-source stagger for rebuilds, and a switch for whether the Start-of-Turn
re-equip plays the full spark or stays as the quieter ring.

**The clang schedules on the AUDIO clock**, not a `setTimeout`. `playSample` already takes a `delay` that goes
to the Web Audio node, so what the owner tunes holds at any frame rate instead of drifting whenever the main
thread is busy. That is the reason the dial is in milliseconds and the caller does not wrap the call in a
timer.

The CSS ring stays underneath as the always-on floor: authored defs do not ship in production
(`canPlayDefs()` is false there), so without it an equip would be silent and invisible for players.

### Two FX gates fired, both correctly

- `playDefUids` — a unit-aimed `playDef` must carry `uids`, or be listed as unit-less WITH a reason. Both
  halves now carry the SOURCE uid: the slot burst plays at a button rather than on a card, but it is still
  ABOUT that minion's equip, so a react layer bound to the source fires for either half. Only the tuner's test
  fire is listed as unit-less — it plays at screen coordinates with no run and no unit.
- `directCalls` — the call-site registry is a derivation, not a list, so it had to learn the new id.

### Verified live

`window.__fxFires` (the FX layer's own record) shows `equipment-spark` firing four times for two equips —
source and slot for each — spaced ~70ms apart, matching the configured stagger.


## Two live bugs, and the Bloodpot use effect

### The equip animation fired once per Frank ever played

Owner: "my 5th alchemist frank plays the animation and sfx 5 times in a row."

`equipFx` was **never cleared**. Every other per-action scratch buffer is reset at the top of `reduce`; this
one was declared, stamped and read, and nothing emptied it. The UI replays the whole list whenever the seq
changes, so the list length WAS the repeat count.

The clear now happens on the CLONE inside `reduceCore`, not on the input, which is strictly better than the
older input-side pattern: every rejection returns before that clone, so a refused action is byte-identical.
The input-side version could not promise that once a buffer held something — and a test asserting "a refused
activation changes nothing" caught exactly that while I was fixing the first bug. `shopDeathFx` moved with it.

### One re-equip cue per EQUIPMENT, not per source

Owner: "if i have 2 alchemist franks on board, only 1 of them re-equips the blood pot, not both of them."

This overrides the handoff, which asked for "an individual re-equip beat for every Equip minion, including
duplicate sources". Duplicates already collapse into one selector entry, so one animation is what the player
is being told about; five Franks firing five identical bursts reads as a bug rather than as information.

EVERY source still re-equips — that is what keeps duplicate and Gilded precedence working — only the CUE is
deduplicated, attributed to the left-most source, which board order already favours.

### Using an Equipment plays its own effect

The owner authored `bloodpot` (smoke, two bursts, and a ribbon on the `travel` anchor) and `bloodpot.wav`. The
Equipment NAMES both (`useFxId` / `useSfxId`), so the def travels from the slot to whatever it was cast on and
a future Equipment brings its own cue with no UI change. ONE travel per activation, not per trigger — the
handoff's rule that repeats "communicate repetition without replaying the full animation".

The tuner grew a Using-it group: delays for the effect and its clip, an on/off for the sound, and a ▶ use test
that fires slot-to-board so the travel is judged over a real distance.

### A fixture trap, for the third time today

Three copies of one card TRIPLE. A three-Frank fixture combined itself into a golden mid-test and emptied the
board the assertions depended on — the same shape as the sandbag fixture in the Apples test and the six-Orin
board in `ownerBugs0826`. Two copies is the most a duplicate-source test can use.

### Recorded debt: one dynamic playDef outside the resolvers

`directCalls.test.ts` enforces that a dynamic `playDef(someVariable)` only appears in a BINDING RESOLVER —
every other data-resolved def id comes from `bindings.json`. The Equipment-use cue reads its id off the
Equipment instead, so it breaks that invariant.

Rather than hide it, both the registry and the invariant test now name the exception with its reason: an
Equipment-use MOMENT belongs in `recruitCues.ts` alongside the shop's other bindings, and moving it there
deletes the entry. It lives at the cue site today because the moment/binding plumbing is wider than this slice.


## The Equipment slot is its own seat now

Owner: "it is not working with void right now with 2 hero powers. can we separate the second hero power and
equipment slots for me? I want a tuner for the equipment slot."

Equipment shipped riding the `.heropanel2` seat with a `.beside` nudge, on the assumption that a hero rarely
has a second power. Void has TWO, and the two blocks collided the moment one appeared. The borrowed seat had a
second fault that would have bitten later: nudging the Second Power tuner silently moved Equipment, which is
not something either dial claims to do.

So Equipment has `--eqs-*` of its own (`equipSlotConfig.ts`, 🧪 Equipment Slot tuner: X, Y, scale), seated
above the hero per the owner's screenshot. The two slots are placed independently and neither tuner can
surprise the other. `.equipslot` replaces `.heropanel2 .equippanel .beside` entirely, so there is no shared
selector left to re-couple them by accident.

Every FX and aim selector followed: the equip spark, the use travel and the targeting line all resolve
`.equipslot .heropowerbtn`. The aim anchor's second-power branch also got simpler — it no longer has to exclude
Equipment, because Equipment is no longer a `.heropanel2`.

### Verified live, on the case that broke

A Void run holding two powers AND Bloodpot: main power (317, 763), second power (375, 909), Equipment
(370, 590) — no pair overlapping. Pressing the Equipment button armed it, the authored `bloodpot` def fired,
the target went 1/1 → 4/4, and the use cue carried the right Equipment id and target uid.

One thing worth recording from that session: the button read DISABLED on the first attempt, which looked like
a bug and was not — the shared allowance had been spent by an earlier activation on the same state. The slot
correctly showed the Equipment and refused to fire it, which is the handoff's "visible but disabled" rule
working.
