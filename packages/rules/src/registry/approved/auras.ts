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
    title: 'Beast buffs are combat-only: "Give all Beasts +X/+Y this combat", no Beast Aura, no carry-back',
    statement:
      'There is no Beast Aura. Every Beast grant that used to "give your Beast Aura" is a COMBAT buff: "Give all Beasts '
      + '+X/+Y this combat" reaches every friendly Beast in the fight, including Beasts summoned later that fight, and '
      + 'ends with the fight; nothing carries back to the run board, hand or Shop, EXCEPT through a mechanic that keeps '
      + 'combat stats (an Engraved Beast keeps it, as it keeps every combat gain). Kennelmaster: "Start of Combat: Give '
      + 'all Beasts +1 Attack this combat. Avenge (4): Improve this." (the improvement is permanent per instance, on '
      + 'its summonBonus, and is used from the next Start of Combat). Grim: "Echo: Give all Beasts +8/+8 this combat." '
      + '(gilded +16/+16). The same treatment covers Armadiyo, Trophy Stalker, Rune of Beastial Swarm (its Avenge level '
      + 'persists, the stats do not), Pack Mentality (a Start of Combat grant whose LEVEL improves and persists) and The '
      + 'Old Hunt. In the Shop or at End of Turn "this combat" has no meaning, so a Shop-fired Echo, Rally or End-of-Turn '
      + 'Start of Combat replay of these grants gives nothing (the Echo / Rally still fires and is still counted). Every '
      + 'surface prints the current value (Kennelmaster / Trophy Stalker read their summonBonus; Pack Mentality its '
      + 'level; Beastial Swarm its per-death level).',
    domain: 'auras',
    status: 'approved',
    evidence: [
      { kind: 'owner-chat', ref: 'Owner ask 2026-09-28 (Beast buffs combat-only; supersedes the 2026-08-28 "Beast Aura" wording, the 2026-09-23 Beastial Swarm carry-back and the 2026-09-24 Grim tally)', quote: 'pack mentality - aka beastial swarm buff: this is a combat buff only, not a permanent buff to beast aura everywhere. let\'s fix the beast aura so that it is corrected as it does NOT function the same as undead aura.' },
      { kind: 'owner-chat', ref: 'Owner ask 2026-09-28 (templates)', quote: 'Start of Combat: Give all Beasts +1 Attack this combat. Avenge (4) Improve this. grim should be: Echo: Give all Beasts +8/+8 this combat. … these affect beasts everywhere in combat, but there is no carryback (unless somethings engraved, etc)' },
      { kind: 'code', ref: 'packages/core/src/effects/arena.ts buffThisCombat (combat: addTribeAura + plain combat buffs; shop: no-op) via scBeastAura / deathrattleBuffTribe / rallyTribeAuraGrowing; packages/core/src/combat/simulate.ts Pack Mentality Start of Combat grant, Beastial Swarm + The Old Hunt (no beastBuy*Gain); packages/sim/src/reducer.ts scalingTribeAura (beast) + settle (level only)' },
    ],
    contentIds: ['kennel', 'grim', 'b2_armadiyo', 'trophystalker', 'rune_beastial_swarm', 'q_pack_mentality', 'q_the_old_hunt'],
    currentBehaviour:
      'Conforms as of 2026-09-28. Until then the Beast Aura was a run-wide channel (`beastBuyAtk` / `beastBuyHp`) fed by '
      + 'Pack Mentality, The Old Hunt and Rune of Beastial Swarm and baked into every Beast everywhere, and a Shop-fired '
      + 'Grim / Armadiyo / Kennelmaster buffed the run board permanently. The legacy channel is still READ, so an older '
      + 'in-flight run or recorded snapshot keeps what it banked; nothing feeds it any more.',
    enforcement: { kind: 'scenario', refs: ['packages/sim/src/beastCombatOnly0928.test.ts', 'packages/ui/src/beastCombatOnlyText.test.ts'], lastVerifiedAt: '2026-09-28' },
  },
];
