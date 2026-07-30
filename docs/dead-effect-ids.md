# Dead effect-factory ids — verified inventory

_Generated 2026-07-29 while clearing the roadmap's "Dead-code purge" item; re-run 2026-07-30 against Set 2
(#762/#780). The roadmap had estimated "~17 dead effect-factory ids"; the actual figure is **69**, so that
estimate is retired in favour of this inventory._

_The re-run is the point: between the two dates the schema grew 338 → 355 ids, and the dead count moved
66 → 69. Set 2 adopted none of the previously-dead ids, and added three of its own that no card uses
(`battlecryBuffOtherTribe`, `onKillGrantRandomSpell`, `rallyImpsAttackNow`). Treat this table as a snapshot,
never as standing truth._

## What "dead" means here

An id in `EffectFactoryIdSchema` (`packages/content/src/schema.ts`) is listed below when **no content data
anywhere uses it as `do: '<id>'`** — no card, threat, quest, or rune reaches it. The remaining references are
plumbing: the factory that implements it, the `EffectFactoryId` union, and any sim/UI helper that switches on
the id.

## Method (reproduce before deleting)

The sweep parses the ids straight out of `EffectFactoryIdSchema`, then scans every `.ts`/`.tsx` under
`packages/` (excluding `node_modules`, `dist`, and `schema.ts` itself), classifying each hit as a `do:` usage
or a plain reference. Re-run it before acting — `main` moves fast, and an id becomes live the moment one card
adopts it.

Two traps this sweep already caught, worth repeating for whoever does the deleting:

- **A word-boundary regex built through a shell heredoc silently matched nothing** (the `\b` collapsed to a
  literal backspace), reporting every id as having zero references. If a sweep says "no references at all"
  for an id you can see wired up in `factories.ts`, the sweep is broken, not the code.
- **Comments and stale test prose look like usage.** `hoardbreaker`'s test comment names `onKillCastSpell`,
  but the card only carries `rallyCastSpell`. Grep for `do: '<id>'`, not the bare id.

## Not dead — claims that did not survive checking

The roadmap bundled these into the same purge. They are live, and deleting them causes regressions:

| Claimed dead | Reality |
|---|---|
| `battlecryGrantKeyword` chain | **Live** — `packages/content/src/cards/set1/beasts.ts` uses it twice. |
| Card's removed Reborn-tears DOM | **Already gone** — no such markup remains. |
| `.disc-gem` CSS | **Live** — rendered by `Recruit.tsx`; the rule is a deliberate `display: none`, so deleting it makes the gems reappear. |
| `.ob` CSS | **Live** — the odds bar reuses the class (`.oddsbar .ob.win`), so the OMEN-era base rule still applies. |

## The 69 ids

`refs` counts files referencing the id outside `schema.ts`. Each deletion is a sweep of the id's factory, the
`EffectFactoryId` union in `packages/core/src/types.ts`, the enum in `packages/content/src/schema.ts`, and
every file in the refs column.

| id | refs | referencing files |
|---|---|---|
| `buffOnSummon` | 6 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/recruit.ts`<br>`sim/src/reducer.ts`<br>`ui/src/cardText.ts`<br>`ui/src/liveTextAudit.test.ts` |
| `reAttackOnKill` | 4 | `core/src/combat/minion.ts`<br>`core/src/combat/simulate.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onKillBuffSelf` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onKillGrantFreeRolls` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onKillCastSpell` | 4 | `content/src/content.test.ts`<br>`content/src/index.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyCastRandomStatSpell` | 3 | `content/src/cards/set1/neutral.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `avengeCastRandomStatSpell` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scDamage` | 3 | `content/src/cards/set1/dragons.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scSplitDamage` | 3 | `content/src/cards/set1/dragons.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scAoePerTribe` | 3 | `content/src/cards/set1/dragons.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `deathrattleBuffRandom` | 4 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/recruit.ts`<br>`ui/src/deathrattleBuffers.ts` |
| `deathrattleBuffAllRandomStat` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`ui/src/deathrattleBuffers.ts` |
| `onFriendDeathBuffRandom` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `battlecryBuffTribeImproving` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onBattlecryImproveSelf` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onSpellCastOnThisSpreadAdjacent` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onRubyPlayedSpreadAdjacent` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `rallyTriggerLeftmostTribeShout` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scSummonOnlyTribeAura` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `deathrattleSummonRandomTribe` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `deathrattleSummonRandomTier` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyImpsAttackNow` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onImpDeathSummonImp` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scFillWithImpsAndBuff` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onImpAttackBuffImps` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `consumeShopRightmost` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `endOfTurnGainRightmostShopStats` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `endOfTurnNeighboursConsumeShop` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `battlecryGrantShoutDragon` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `battlecryGrantTribeAndSpell` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `battlecryBuffOtherTribe` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `deathrattleBuffSpellPower` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/buildTags.ts` |
| `buffFodderEverywhere` | 3 | `core/src/types.ts`<br>`sim/src/buildTags.ts`<br>`sim/src/recruit.ts` |
| `deathrattleFillTribe` | 3 | `core/src/combat/simulate.ts`<br>`core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `avengeBuff` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scGrantShieldTribe` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`ui/src/MinionBook.tsx` |
| `onShieldBreakGrantShield` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`ui/src/MinionBook.tsx` |
| `onShieldBreakDamage` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onShieldBreakBuffAll` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scDestroyHighestAttack` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scTribeBuffPerSpell` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scTribeBuffPerProgress` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scTribeBuffPerPlayed` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`ui/src/cardText.ts` |
| `buffOnBuy` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onBattlecryBuffTribe` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/recruit.ts` |
| `endOfTurnBuff` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `deathrattleAddFodder` | 4 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/buildTags.ts`<br>`sim/src/recruit.ts` |
| `deathrattleBuffFodder` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`ui/src/deathrattleBuffers.ts` |
| `rallyBuffFodderHalf` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyBuffFodder` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onConsumeBuffSelf` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onConsumeGrantSelfKeyword` | 3 | `core/src/types.ts`<br>`sim/src/recruit.ts`<br>`ui/src/MinionBook.tsx` |
| `onConsumeShieldNextCombat` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `spellCastBuffSelf` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onGainAttackBuffAll` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/recruit.ts` |
| `battlecryBuffBeastAttack` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onKillBuffFodderImps` | 3 | `core/src/effects/factories.ts`<br>`core/src/types.ts`<br>`sim/src/buildTags.ts` |
| `battlecryTargetConsumeFodder` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `rallyGrantRandomSpell` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `onKillGrantRandomSpell` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyTribeAura` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyGiveDemonAttack` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `rallyImproveSummonAura` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `endOfTurnCastSpellEscalating` | 5 | `content/src/index.ts`<br>`core/src/types.ts`<br>`sim/src/recruit.ts`<br>`ui/src/cardText.test.ts`<br>`ui/src/cardText.ts` |
| `endOfTurnBuffPerTribePlayed` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `onKillGrantMagnetic` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `scConsumeWeakestBuffDemons` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
| `spellAddTribe` | 2 | `core/src/types.ts`<br>`sim/src/recruit.ts` |
| `deathrattleBuffImpsImproving` | 2 | `core/src/effects/factories.ts`<br>`core/src/types.ts` |
