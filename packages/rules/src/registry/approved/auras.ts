/**
 * APPROVED RULES — domain `auras`.
 *
 * One file per `RuleDomain` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (`R-<TOPIC>-<NN>`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as `enforcement.refs` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (`./index.ts`) concatenates every domain file in a fixed order into `APPROVED_RULES`; `approved.test.ts`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
import type { GameRule } from '../../schema';
import { HANDOFF } from './shared';

export const AURAS_RULES: GameRule[] = [
  {
    id: 'R-AURA-01',
    title: 'Auras are global modifiers',
    statement:
      'An Aura is a global modifier affecting an eligible type, card or population wherever the Aura defines. '
      + 'Auras can affect existing and future eligible cards. Plain copies remain plain but receive any '
      + 'independently applicable Aura. Every Aura contract must state its zone coverage and lifetime. '
      + '`Aura` becomes explicit keyword terminology once approved wording is wired.',
    domain: 'auras',
    status: 'approved',
    evidence: [{ kind: 'owner-handoff', ref: HANDOFF, quote: 'An Aura is a global modifier affecting an eligible type, card, or population wherever the Aura defines.' }],
    // DELIBERATELY UNENFORCED (in the approved-but-unenforced queue): no probe yet pins the load-bearing
    // behavioral halves (auras reach future eligibles; plain copies stay plain yet receive applicable
    // auras; per-aura zone coverage + lifetime). auraFx.test.ts checks the FX stamp, not this contract.
  },
  {
    id: 'R-AURA-02',
    title: 'An Aura-affecting spell is permanent from any phase — Lantern of Souls in combat included',
    statement:
      'A spell whose effect changes an Aura (Lantern of Souls: "your Undead Aura gets +3 Attack") is permanent '
      + 'wherever it is cast. A combat cast — a Rally, an Avenge, an Echo — raises the run-wide Aura exactly as a '
      + 'shop cast does: carried back at settle and in force for the rest of the run. There is no combat-only Aura.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Claude Code session, 2026-09-09 (triple confirmation)', quote: 'lantern of souls is always permanent since it is an aura affecting spell … therefore, lantern of soul casts in combat are always permanent.' },
      { kind: 'code', ref: 'packages/core/src/combat/simulate.ts grantUndeadAura → CombatResult.playerUndeadAuraGain; packages/sim/src/reducer.ts settle → undeadAttackBonus' },
    ],
    contentIds: ['lanternofsouls', 'watcher', 'u3_hierophant', 'anubis'],
    currentBehaviour:
      'Conforms: every combat Lantern cast goes through the arena verbs `castRepeat` + `grantUndeadAura`, whose gain is '
      + 'carried back on `playerUndeadAuraGain` and added to the run Aura at settle. Pinned by the Hierophant case '
      + '(a combat Avenge cast carries +3 back) and the shop cast in run.test.ts.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/set3Undead.test.ts', 'packages/sim/src/run.test.ts'], lastVerifiedAt: '2026-09-09' },
  },
  {
    id: 'R-AURA-03',
    title: 'There is no Beast Aura: "Give all Friendly and summoned Beasts +X/+Y" works in both phases, and a fight grant never carries back',
    statement:
      'There is no Beast Aura (no hidden run-wide Beast channel). Every Beast grant that used to "give your Beast Aura" '
      + 'reads "Give all Friendly and summoned Beasts +X/+Y" (wording 2026-09-29; it read "Give all your Beasts" until then) and works in BOTH phases with the normal "your Beasts" meaning. In the SHOP '
      + '(recruit, End of Turn) every Beast in the warband (the board, the convention every Shop tribe grant uses; not '
      + 'the hand) gains it permanently, like any Shop buff: a Grim destroyed or proc\'d in the Shop buffs the warband. '
      + 'In COMBAT every friendly Beast in the fight gains it, including Beasts summoned later that fight, and it does '
      + 'NOT carry back to the run board, unless a mechanic keeps combat stats (Engrave). Kennelmaster: "Start of Combat: '
      + 'Give all Friendly and summoned Beasts +1 Attack. Avenge (4): Improve this." (the improvement is permanent per instance, on its '
      + 'summonBonus; one earned mid-fight is used from the NEXT Start of Combat; since the owner balance of 2026-10-10 it reads '
      + '"+2 Attack. Avenge (3): Improve this." and each improvement adds +2, gilded +4 improving +4). Grim: "Echo: Give all Friendly and summoned '
      + 'Beasts +8/+8." (gilded +16/+16). The same pattern covers Armadiyo, Trophy Stalker, Rune of Beastial Swarm (a Shop '
      + 'Beast death also pays it; its Avenge level persists), Pack Mentality (a Start of Combat grant whose level '
      + 'improves and persists; a served seat applies its snapshot level) and The Old Hunt. Every surface prints the '
      + 'current value.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-09-28 (Beast buffs; supersedes the 2026-08-28 "Beast Aura" wording, the 2026-09-23 Beastial Swarm carry-back and the 2026-09-24 Grim tally)', quote: 'pack mentality - aka beastial swarm buff: this is a combat buff only, not a permanent buff to beast aura everywhere. let\'s fix the beast aura so that it is corrected as it does NOT function the same as undead aura. … these affect beasts everywhere in combat, but there is no carryback (unless somethings engraved, etc)' },
      { kind: 'owner-chat', ref: 'Owner answer 1 on PR #1813, 2026-09-28 (wording + both phases)', quote: 'let\'s just make the effect say: "Echo: Give all your Beasts +8/+8." or "Start of Combat: Give all your Beasts +1 Attack. Avenge (4): Improve this." - this SHOULD work in recruit and combat phase. in a recruit scenario, any beast in the warband would get the stats from a destroyed or triggered grim.' },
      { kind: 'owner-chat', ref: 'Owner answer 2 on PR #1813, 2026-09-28 (Kennelmaster mid-fight improvement)', quote: 'No because the buff is granted mid fight, as built is right.' },
      { kind: 'owner-chat', ref: 'Owner ask 2026-09-29 (wording only: "all your Beasts" -> "all Friendly and summoned Beasts" on every R-AURA-03 item; behaviour unchanged)', quote: "another beast text change - change the same minions, grim armadiyo kennelmaster etc to: 'give all friendly and summoned beasts' so grim says 'Echo: Give all Friendly and summoned Beasts +8/+8.'" },
      { kind: 'owner-chat', ref: 'Owner answer 3 on PR #1813, 2026-09-28 (Pack Mentality on a served seat: Start of Combat grant from its snapshot level, growth player-only)', quote: 'okay' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts buffAllOfTribe (combat: addTribeAura + plain combat buffs; shop: permanent warband buff) via scBeastAura / deathrattleBuffTribe / rallyTribeAuraGrowing; packages/core/src/combat/simulate.ts Pack Mentality Start of Combat grant, Beastial Swarm + The Old Hunt (no beastBuy*Gain); packages/sim/src/recruit.ts fireOnFriendDeath (Beastial Swarm Shop half); packages/sim/src/reducer.ts scalingTribeAura (beast) + settle (level only)' },
    ],
    contentIds: ['kennel', 'grim', 'b2_armadiyo', 'trophystalker', 'rune_beastial_swarm', 'q_pack_mentality', 'q_the_old_hunt'],
    currentBehaviour:
      'Conforms as of 2026-09-28. Until then the Beast Aura was a run-wide channel (`beastBuyAtk` / `beastBuyHp`) fed by '
      + 'Pack Mentality, The Old Hunt and Rune of Beastial Swarm and baked into every Beast everywhere. The legacy channel '
      + 'is still READ, so an older in-flight run or recorded snapshot keeps what it banked; nothing feeds it any more.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/beastCombatOnly0928.test.ts', 'packages/ui/src/beastCombatOnlyText.test.ts'], lastVerifiedAt: '2026-09-29' },
  },
  {
    id: 'R-AURA-04',
    title: 'The Imp Aura reaches every Imp you control, the moment it grows, exactly once',
    statement:
      'A "give your Imps +X/+Y this game" grant (Impossible Todd, and every other Imp Aura source) is an AURA: every Imp '
      + 'you control gets it wherever it is. In combat the Imps ALREADY alive get it the moment it fires (a real-time '
      + 'buff on each, mid-fight), Imps summoned later that fight enter with the raised Aura, and after the fight the '
      + 'Imps on your board and in your hand keep it, as do Imps you get later. Each Imp is paid each grant exactly '
      + 'once: the Aura is baked into the stats of a held Imp, so a board Imp starts a fight at its stored stats and is '
      + 'never re-paid the Aura at Start of Combat. Gilding doubles the grant.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner bug 2026-09-30 (Impossible Todd)', quote: "impossible todd should buff imps that are currently alive too since it's an aura buff - they receive the buff everywhere" },
      { kind: 'code', ref: 'packages/core/src/effects/factories.ts onFriendlyDemonDamageBuffSelf (living Imps + grantImpBuff); packages/core/src/combat/simulate.ts applyAuras (Imp Aura only on from-base bodies); packages/sim/src/reducer.ts settle (playerImpBuffGain baked onto board + hand Imps; Open the Gates Imps enter with impBuff)' },
    ],
    contentIds: ['dm_todd', 'impscrap'],
    currentBehaviour:
      'Conforms as of 2026-09-30. Until then Todd only raised the Aura (living Imps missed the grant), the settle bumped '
      + '`impBuff` without paying the Imps you held, and Start of Combat re-added the whole Aura to a board Imp whose '
      + 'stats already carried it (a 4/4 Imp under a +3/+3 Aura fought as a 7/7).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/toddImpAura.test.ts'], lastVerifiedAt: '2026-09-30' },
  },
  {
    id: 'R-AURA-ONBOARD-01',
    title: "Elderhorn is a board aura: your Beasts' Rallies and Echoes trigger an additional time while it is on your board",
    statement:
      'Elderhorn: "Your Beasts\' Rallies and Echoes trigger an additional time." It is an AURA that works only while '
      + 'Elderhorn is on your board, like normal card text; playing it installs nothing permanent, and selling it or its '
      + 'death ends it. Each Rally (on attack) and each Echo of a BEAST on that side fires one more time; other tribes are '
      + 'untouched. It is an additive "additional time" multiplier (owner vocabulary rule 2026-08-28): golden gives 2 '
      + 'additional, every copy stacks, and it adds to Sylus, Uron and the run-wide Rally/Echo extras. It applies wherever '
      + 'a Beast Echo fires (combat deaths, forced Echoes, Shop Echoes) and wherever a Beast Rally fires (on attack, and a '
      + 'forced Rally in combat or the Shop, R-RALLY-FORCED-01). A served board '
      + 'carries it with the body. SIMULTANEOUS DEATH: deaths resolve left to right, so an Elderhorn dying in the same '
      + 'strike still doubles a Beast Echo that resolves before its own death, and not one after it (the Sylus precedent).',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner batch 2026-10-07 (Elderhorn rework)', quote: 'While on board' },
      { kind: 'card-text', ref: 'packages/content/src/cards/set2/beasts.ts b2_elderhorn', quote: "Your Beasts' **Rallies** and **Echoes** trigger an additional time." },
      { kind: 'code', ref: 'packages/core/src/types.ts extraTriggerFires (tribe-scoped TriggerMultiplierDef); packages/core/src/combat/simulate.ts playerEchoExtras + the Rally repeat loop; packages/sim/src/recruit.ts fireRecruitDeathrattles' },
    ],
    contentIds: ['b2_elderhorn', 'sylus', 'uron'],
    currentBehaviour:
      'Conforms as of 2026-10-07. Before, Elderhorn was a Choose One that installed a permanent run mode (`beastHuntExtra` '
      + 'for Rallies or `beastRitualExtra` for Echoes). Those modes are still read so old saves and replays resolve, but no '
      + 'card installs them any more. A forced Rally (fired without an attack, in the Shop or in combat) is boosted too, '
      + 'as is every Rally doubler (R-RALLY-FORCED-01, owner 2026-10-07).',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/elderhornOrivaxAuras.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
  {
    id: 'R-AURA-ONBOARD-02',
    title: 'Orivax is a board aura: your Shouts trigger 2 additional times while it is on your board, added to every other Shout extra',
    statement:
      'Orivax: "Your Shouts trigger 2 additional times." It is an AURA that works only while Orivax is on your board, like '
      + 'normal card text; playing it installs nothing permanent, and selling it or its death ends it. Every Shout that '
      + 'side triggers, played or triggered, in the Shop or in real time mid-combat (R-SHOUT-TRIGGER-01), fires 2 more '
      + 'times. Golden gives 4, every copy stacks. It ADDS to the run-wide Shout extras (Rune of the Choir, Blasting '
      + 'Voices, Hoardwake, Demand an Encore, the legacy Orivax Chorus mode): Orivax plus the Choir is 1 + 2 + 1 = 4 fires, '
      + 'in both phases. Each fire is its own counted Shout for every listener. A served board carries it with the body.',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner batch 2026-10-07 (Orivax rework)', quote: 'While on board' },
      { kind: 'card-text', ref: 'packages/content/src/cards/set2/dragons.ts d2_orivax', quote: 'Your **Shouts** trigger **2** additional times.' },
      { kind: 'code', ref: 'packages/core/src/types.ts boardShoutExtras + CardDef.shoutExtraAura; packages/sim/src/recruit.ts shoutFireCount; packages/core/src/combat/simulate.ts shoutCarryExtras' },
    ],
    contentIds: ['d2_orivax', 'rune_choir'],
    currentBehaviour:
      'Conforms as of 2026-10-07. Before, Orivax was a Choose One (golden: both) that installed a permanent run mode: '
      + '`shoutExtraAlways` +1 or the first-Shop-spell triple. Those modes are still read so old saves and replays resolve, '
      + 'but no card installs them any more. Orivax folds into the SAME channel as the Choir (not the Drakko board '
      + 'multiplier), which is what keeps it additive with the run-wide extras in combat too.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/elderhornOrivaxAuras.test.ts'], lastVerifiedAt: '2026-10-07' },
  },
];
