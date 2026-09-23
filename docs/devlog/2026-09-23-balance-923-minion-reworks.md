# 2026-09-23 — Balance 9/23, tranche 2: the minion mechanic reworks

Owner sheet (verbatim texts), tranche 2 of the 9/23 balance batch: eight minions whose MECHANIC changed, not just
a number. Tranche 1 (Embermouth Whelp, Legion Shepherd, Staff of Guel's own +3/+4 change, …) is a separate PR.

| Card | Before | After |
| --- | --- | --- |
| Conductor (`n2_conductor`) | Shout: give adjacent minions +2/+3. Every Conductor played improves this by +2/+3. (a run-wide `conductorBuff` snowball) | **Shout:** give adjacent minions **+2/+3** and improve this. (this copy grows +1/+1 per fire; see the assumption below) |
| Traveling Skald (`d2_skald`) | 2/3; another friendly Dragon attacks → +2/+1 | **1/3**; another friendly Dragon attacks → **+3/+2** (gilded +6/+4) |
| Rope Wrangler (`ropewrangler`) | End of Turn: cast Lasso, +1 cast per 6 Gold spent, 5 max, all in one tick | **End of Turn:** cast **Lasso**. Repeat for every **10 Gold** spent this turn. (no cap; one tick per repeat) |
| Soul Defiler (`dm_curator`) | End of Turn: +1 Attack to the Shop, improving +1 and alternating Attack/Health | **End of Turn:** cast **Staff of Guel**. (gilded: twice) |
| Moira (`b2_moira`) | End of Turn: trigger adjacent Shouts | **End of Turn:** trigger your **Shout** minions. (every friendly Shout, anywhere on the board; gilded twice) |
| Impossible Todd (`dm_todd`) | +4/+4 to himself, Imps +2/+2, per friendly-Demon damage instance | **+1/+2** to himself, **Imps +2/+1**, per instance (gilded +2/+4 / +4/+2). Ward untouched. |
| Muster General (`n2_muster`) + Trooper (`n2_trooper`) | Avenge (3): a 1/1 Trooper that attacks immediately, then improve future Troopers +1/+1 | **Avenge (3):** summon a **3/3 Trooper** that attacks immediately, and improve your Troopers. (the +1/+1 step is unchanged and applies to the 3/3) |
| Exgalloper (`dw_exgalloper`) | Echo: summon an exact copy of this without Echo | **Rebirth.** |

## How each one is wired

- **Conductor** — one arena body (`battlecryConductorAdjacent` in `arena.ts`) grants `(base + summonBonus) × golden`
  to both neighbours and THEN steps `summonBonus` by `params.step` (1, × Rune of Mastery), so a shop fire (the play,
  a Moira / Ryme / Dawnclaw re-fire) and a combat fire (Parting Cry, Rune of Shared Scripture) improve the copy
  the same way. `summonBonus` is the generic per-instance permanent channel (Pack Leader, Hunter, Thundeer):
  carried back at settle (`playerSummonBonus`), merged as the top two on a gild, served in a snapshot. The
  recruit wrapper no longer writes `state.conductorBuff`; the arena-level `conductorTally()` is gone. Live text
  (`conductorText`) prints `(base + accrual) × golden` in place of the first "+A/+B" on every surface — the old
  shop-vs-board framing split is gone with the snowball.
- **Moira** — new factory `endOfTurnTriggerShouts` replaces `endOfTurnTriggerAdjacentShouts` (registered in the
  `EffectFactoryId` union, the schema whitelist and the presentation policy registry). It snapshots the board's
  Shout minions before firing, skips itself, and routes every fire through `replayBattlecry`, which counts the
  shout objective, applies Spell Drummer and fires `battlecryTriggered` once per Shout (Embermouth Whelp counts
  each). The text-parse grammar (`recTriggerOther`) learned "trigger your Shout minions".
- **Rope Wrangler** — the REPEAT form of R-REPEAT-01 on a cast. `eotTickCount` gained a `castSpell` case
  (`1 + ⌊Gold spent / perGold⌋`, one tick when there is no `perGold`), so `applyEndOfTurn`, the projection and
  the legacy beat list all fire one root trigger / beat per repeat; the `castSpell` factory casts `gold(self)`
  times per tick through `forEachTick` (a single-shot caller such as Dusk's replay runs every tick in one call).
  The old `maxCasts` cap left the factory — no live card used it. `castSpellPerGoldText` folds `(×N)` into the
  Repeat sentence in the Mother Moss / Kringle / Rocket Power house style.
- **Soul Defiler** — the existing "minion casts a named spell" primitive (`castSpell`, no `perGold`). The Staff's
  factory (`spellBuffShop`) now reads the caster's `_origin` and names it for the shop-wide FX stamp, so the
  End-of-Turn beat credits Soul Defiler exactly as a Shout's shop buff does. `buffShopPermanent` with `improve`
  has no live user; the `shopBuffImproveText` helper stays for archived / future content.
- **Todd, Skald** — parameter and text changes on the existing primitives (`onFriendlyDemonDamageBuffSelf`,
  `onTribeAttackBuffAttacker`).
- **Muster General** — the Trooper token is 3/3; `musterTrooperText` now reads the base off the token the effect
  names and matches inside "**Gilded 3/3 Trooper**" too (the old `**1/1 Trooper**` pattern never rewrote the
  gilded line).
- **Exgalloper** — `keywords: ['RB']`, no effects, text `**Rebirth.**`. Combat's `killOrReborn` and the shop's
  `rebirthReturn` already key on the keyword. `echoSummonCopyNoEcho` stays as Rune of Living Treasure's graft
  body; the tests that used Exgalloper as a generic Echo fixture moved to Knocked.

## Assumption to confirm (Conductor)

The owner's text says only "and improve this". Implemented as **+1/+1 per fire, permanent for this copy**
(the lead's assumption). Two other readings are plausible: the step is +2/+3 (the grant itself, as the old
text had it), or the improvement is still run-wide across every Conductor. Both are a one-line change
(`step` in the card params, or the accrual channel). No oracle rule was written for Conductor because the
increment is not an owner ruling yet.

## Follow-ups

- The run-wide `conductorBuff` channel (`RunState`, `CombatSideState`, snapshot, replay v2, the bots' feature
  vector, the UI live-params) is now dormant — never written, never read. Deleting it touches the shared types
  and the bot feature vector, so it is its own chore PR.
- Conductor's per-copy step and Muster General's "improve" wording print no rate; if the owner wants the step
  visible ("+1/+1"), it is a text change only.

## Oracle

`R-SHOUT-02` (Moira: every friendly Shout, one notify per fire), `R-REPEAT-02` (Rope Wrangler: base + one tick per
10 Gold, each its own beat, uncapped, gilded doubles the per-tick cast) and `R-DEALT-01` (Todd: once per damage
instance, permanent self-gain, run-wide Imp gain) in `packages/rules/src/registry/approved/triggers.ts`, enforced
by `packages/sim/src/balance923MinionReworks.test.ts` and `packages/ui/src/balance923LiveText.test.ts`.
