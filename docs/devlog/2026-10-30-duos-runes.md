# 2026-10-30 · Duos-only runes + real-time combat team effects

Owner design 2026-10-30 (nine runes). Branch `feat/duos-runes`. Rules R-DUOS-RUNES-01..03.

## The runes (R-DUOS-RUNES-01)

- `RuneDef.duos: true` (schema-whitelisted). `runeforgePool` and the `grantRune` reward filter `!rn.duos || s.duos`; the
  balance tools' lobby rune lists exclude them.
- Engines in `packages/sim/src/duosRunes.ts`, state on `duos.runes` (absent outside Duos). One reward kind `duosRune`
  (`spellTheory | teammateSynergy | salesman | shoutfulBounty | echoingResults | playingCatch`). Gold Gifts = `runeEquip`
  of the new `gold_gifter` Equipment (`giftTeammateGold`, 3); Passable = `recurringGrant` of Handout; Megamimed = `grant` of
  the `duo_megamimic` token.
- Hooks: Spell Theory in `fireTeamPassTriggers` (mine); Teammate Synergy in `noteGilded` (every Gild); Salesman in
  `settleMinionSale` (an effect pass with `{ via: 'sale', allowGolden: true }`, wire `passFrom: 'sale'`, the Worker's golden
  guard exempts exactly that; a refusal returns nothing because the sale was paid); Playing Catch in `duosPassCost` /
  `applyDuosPass` (`duosFreeKind`: Brian's Pal first, then the team's Catch), the receiver counts a teammate's Catch pass
  via the wire's `teamCatch`, and the allowance reaches the teammate as a `catch` team effect.
- Meters: Shop ticks at the reducer's per-action Shout / Echo boundary (`lastShoutFires` / `lastEchoFires`), combat via
  `QuestCombatMods.duosMeters` (ticked on `battlecryTriggered` and `bumpDeathrattles`), carried home in
  `ShoutCarry.duosMeters`. Live tallies (`duosRuneTally`) on the rune badge.

## Real-time combat team effects (R-DUOS-RUNES-02), the reusable primitive

Every combat `sendTeam(..., mate)` now emits `{ type: 'teamSend', side, member, idx }` (no step of its own; choreo hold 0).
`landDeferredFight` queues the fight's mate halves on the outbox at once with `combatIdx`; settle skips any already queued.
The UI (`duosPasses.ts`) HOLDS a `combatIdx` entry while its fight is on screen, and `useDuosCombatSync` releases each one when
the replay cursor passes its `teamSend` (`teamSendsReached`). Once the fight is settled / skipped / reloaded nothing is held.
One outbox entry per gift, so the Worker's seq dedupe and the receiver's key dedupe make delivery exactly-once. Antsy, Spencer
and any future combat team card get this for free: they only need to call `sendTeam`.

## Megamimic (R-DUOS-RUNES-03)

`core/combat/megamimic.ts`: applied to BoardMinions before instantiation (opening board vs the reserve's locked board; a
reserve stepping in vs the first board as locked). Exact clone minus `sourceUid` (combat-only). No `ascend` animation: the
copy is simply the body that enters the fight (judgement call; an in-fight transform beat can be added later).

## Judgement calls (flagged to the owner)

- Gold Gifter "(1)" read as the Gold cost (the Equip convention), not one charge.
- Playing Catch: the shared counter is eventually consistent (two simultaneous passes can both be free).
- Meters: at the per-turn cap the counter keeps counting but parks one short of a trip.
- Shoutful Bounty's "random spell" = a Shop Spell up to the receiver's tier, never an Ale (the Chorus convention).
- Megamimic never copies another Megamimic; tokens-only spells excluded.

Worker redeploy needed (core/content/sim changed, plus `groupMatch.ts` accepts `passFrom: 'sale'`).
