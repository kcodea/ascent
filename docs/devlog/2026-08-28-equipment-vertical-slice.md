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
