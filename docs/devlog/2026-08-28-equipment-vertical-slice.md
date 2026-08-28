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

## Not built (deliberately)

The UI slot, the selector, native-second-power coexistence, and the equip/re-equip animation are NOT here.
The engine is complete and tested first, which is the handoff's own implementation order (UI is step 9-10 of
13). `equipFx` cues are already emitted, so the UI half is a consumer, not a redesign.

Also unbuilt, and flagged: **Equipment Spells** (the classification exists in the handoff but no Equipment
casts one yet), **combat effect queuing** (nothing queues one), and **cost-reduction sources** (the field and
its floor exist; nothing grants it). Each is state + a factory away, deliberately not invented ahead of a card
that needs it.
