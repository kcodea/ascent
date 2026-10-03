# 2026-10-03: Rune of Amplification gets an End-of-Turn beat

Owner decision (verbatim): "Where should Rune of Amplification's End of Turn effect play? i think it should get an
end of turn beat". This was the open item #1924's audit (`2026-10-02-eot-economy-beats.md`) listed as "End of Turn,
amplifies unused Equipment with no beat; not a Shop number, needs an Equipment target ruling".

## Fix

- **Sim** (`reducer.ts`): the rune's End-of-Turn pass now runs inside its own trigger scope
  (`rune:rune_amplification:endOfTurn`, registered `ownBeat` / `endOfTurn` in `core/presentation/policies.ts`) and
  emits one `counterChanged` per Equipment it Amplified, counter `equipmentAmplified:<id>`
  (`EQUIPMENT_AMPLIFIED_COUNTER`, exported from `@game/sim`). No new consequence type: `counterChanged` already takes
  any counter name, so the shared event union is untouched. Nothing Amplified means the scope is discarded
  (`discardIfEmpty`), so no empty beat. Gameplay untouched: the collector only records.
- **UI**: `choreographer/equipmentFx.ts` maps the counter to the Equipment slot button (`AMPLIFIED_SLOT_SELECTOR`)
  and the same authored `self-buff-burst` def the economy beats use. Recruit's `counterChanged` presenter (a no-op
  before) plays it on the beat. `onProjection` hands the delivered ids to a tiny bus (`setEotAmplified`; StatusBar
  is in a different tree), and StatusBar ORs them into `equipAmplified` while the End-of-Turn lock holds. So the
  charge turns blue, and the owner's `amplified-slot` loop starts, with the burst, not before. A boolean OR, so the
  commit tick cannot double-count.
- **Replays** compile the recorded batch through the same presenter (tested on `eotRecordOf`).

## Audit follow-up (the #1924 "listed, not changed" set)

- Tradesman x Bonds: Shop phase per Refresh, not End of Turn; the price updates instantly. Not silent at EoT.
- The turn-start per-wave upgrade discount: Start of Turn, not End of Turn.
- The Ancient-of-Time hero beats with no `policyKey`: they DO play (and since #1924 carry their consequences); the
  gap is a `missingPolicyKey` diagnostic, not a silent trigger.
- So no other End-of-Turn trigger from that set is still silent with an obvious target.

Oracle **R-EOT-AMPLIFY-01** (`packages/rules/src/registry/approved/economy.ts`); test
`packages/ui/src/choreographer/eotAmplificationBeat.test.ts`.
