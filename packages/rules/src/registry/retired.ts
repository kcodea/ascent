/**
 * Retired rules — queue items that left the pending board WITHOUT becoming an approved rule, each with an
 * explicit disposition. A decision may reference a retired id (the integrity test allows it); silently
 * deleting a decided rule is what this file exists to prevent.
 *
 * Every HAND-retired entry carries `enforcement` — the machine-checkable pin that keeps its disposition
 * true (a test file that must exist on disk, or an oracle lane from ENFORCEMENT_LANES). The integrity test
 * validates every ref, so a deleted pinning test un-enforces its ruling loudly instead of rotting.
 * (AUTO-retired tombstones in retired.generated.ts carry no enforcement — a stale question has nothing to pin.)
 */
import type { RuleEnforcement } from '../schema';

export interface RetiredRule {
  id: string;
  why: string;
  retiredAt: string; // ISO date
  /** The probe that pins this disposition. Required on hand-retired entries (tested); absent on auto tombstones. */
  enforcement?: RuleEnforcement;
}

/** The nine 2026-08-26 rulings that were IMPLEMENTED share one pinning suite. */
const OWNER_RULINGS_PIN: RuleEnforcement = {
  kind: 'scenario',
  refs: ['packages/sim/src/ownerRulings20260826.test.ts'],
  lastVerifiedAt: '2026-08-27',
};
/** Confirmed-current-behaviour rulings are encoded as OWNER RULED entries in the phase-excuse registry. */
const PHASE_REGISTRY_PIN: RuleEnforcement = { kind: 'oracle', refs: ['phaseRegistry'], lastVerifiedAt: '2026-08-27' };

export const RETIRED_RULES: RetiredRule[] = [
  {
    id: 'q-combatinert-b2_echohorn',
    why:
      "Resolved in the owner's favor by the 2026-08-26 instrument audit: the 'Echohorn combat-inert' finding was a Doc Bot blind spot (the scan's echo fixture was dead before Rally), not a card bug. Echohorn triggers the left-most Echo on attack, exactly as printed. The owner's revise note on this id predates the audit and stands as confirmation.",
    retiredAt: '2026-08-26',
    enforcement: { kind: 'oracle', refs: ['combatDifferential'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'q-phase-deathrattleTriggerAdjacentRally',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Scavvers' Echo now triggers adjacent Rallies in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-echoCastRememberedSpells',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Runesnout Archivist's Echo now casts the remembered spells in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-impInheritOnDeath',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Ashen Heir now inherits from Imps destroyed in the shop (or banks). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-impInheritOnSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Ashen Heir's bank now pays out to Imps summoned in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-onFriendDeathGainEcho',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Echo Mimic now copies the Echo of shop-dead friends. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-onFriendDeathSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Brood Matron now breeds on shop deaths (max 3/turn). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-onRubyPlayedSpreadRandom',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Reflector now spreads mid-combat Rubies (once per fight). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-deathrattleBuffShopPermanent',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Malphas' Echo now buffs the Shop when fired in the shop phase. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-spellpower-spellBuffShopByRuby',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real — IMPLEMENTED in the owner-rulings PR: Veinstorm's Rubies now fold the run's spell power. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
    enforcement: OWNER_RULINGS_PIN,
  },
  {
    id: 'q-phase-onSummonSelfBuff',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — Cratering Hulk half 1 — combat-only per its printed text (owner chat override of the board click; shop overflow triggers stay legal for non-combat-specific cards, Flowing Monk precedent). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-onSummonOverflowBuffTribe',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — Cratering Hulk half 2 — same override; combat-only per text. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-onSummonTribeBuffThenDouble',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — combat-only summons doubling is correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-onTribeSummonedBuffTribe',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — \"when you play a Dwarf\" is a shop event — correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-rubyPlayedGold',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — no Gold from combat-played Rubies — correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-summonBuffTribeImprove',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — Den Mother does not feed from combat summons — correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-spellpower-rubyStatGain',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — flat is correct — Ruby strength is its own channel (encoded in historyRegistry). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: { kind: 'oracle', refs: ['historyRegistry'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'q-phase-countTribeSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — Pack Leader counts shop plays only — correct; its card text clarified to say \"in the Shop\" (the revise half of the ruling). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
  {
    id: 'q-phase-onTribePlayedBuffSelfPerSpell',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed — Vaultkeeper does not gain from combat summons — correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
    enforcement: PHASE_REGISTRY_PIN,
  },
];

export const RETIRED_IDS: ReadonlySet<string> = new Set(RETIRED_RULES.map((r) => r.id));
