/**
 * Retired rules — queue items that left the pending board WITHOUT becoming an approved rule, each with an
 * explicit disposition. A decision may reference a retired id (the integrity test allows it); silently
 * deleting a decided rule is what this file exists to prevent.
 */
export interface RetiredRule {
  id: string;
  why: string;
  retiredAt: string; // ISO date
}

export const RETIRED_RULES: RetiredRule[] = [
  {
    id: 'q-combatinert-b2_echohorn',
    why:
      "Resolved in the owner's favor by the 2026-08-26 instrument audit: the 'Echohorn combat-inert' finding was a Doc Bot blind spot (the scan's echo fixture was dead before Rally), not a card bug. Echohorn triggers the left-most Echo on attack, exactly as printed. The owner's revise note on this id predates the audit and stands as confirmation.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-deathrattleTriggerAdjacentRally',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Scavvers' Echo now triggers adjacent Rallies in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-echoCastRememberedSpells',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Runesnout Archivist's Echo now casts the remembered spells in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-impInheritOnDeath',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Ashen Heir now inherits from Imps destroyed in the shop (or banks). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-impInheritOnSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Ashen Heir's bank now pays out to Imps summoned in the shop. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onFriendDeathGainEcho',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Echo Mimic now copies the Echo of shop-dead friends. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onFriendDeathSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Brood Matron now breeds on shop deaths (max 3/turn). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onRubyPlayedSpreadRandom',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Reflector now spreads mid-combat Rubies (once per fight). Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-deathrattleBuffShopPermanent',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Malphas' Echo now buffs the Shop when fired in the shop phase. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-spellpower-spellBuffShopByRuby',
    why:
      "OWNER RULED 2026-08-26 (triage board): the gap was real \u2014 IMPLEMENTED in the owner-rulings PR: Veinstorm's Rubies now fold the run's spell power. Pinned by packages/sim/src/ownerRulings20260826.test.ts; the phase-registry excuse was deleted, so Doc Bot re-alarms if the factory ever vanishes.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onSummonSelfBuff',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 Cratering Hulk half 1 \u2014 combat-only per its printed text (owner chat override of the board click; shop overflow triggers stay legal for non-combat-specific cards, Flowing Monk precedent). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onSummonOverflowBuffTribe',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 Cratering Hulk half 2 \u2014 same override; combat-only per text. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onSummonTribeBuffThenDouble',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 combat-only summons doubling is correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onTribeSummonedBuffTribe',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 \"when you play a Dwarf\" is a shop event \u2014 correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-rubyPlayedGold',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 no Gold from combat-played Rubies \u2014 correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-summonBuffTribeImprove',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 Den Mother does not feed from combat summons \u2014 correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-spellpower-rubyStatGain',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 flat is correct \u2014 Ruby strength is its own channel (encoded in historyRegistry). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-countTribeSummon',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 Pack Leader counts shop plays only \u2014 correct; its card text clarified to say \"in the Shop\" (the revise half of the ruling). Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
  {
    id: 'q-phase-onTribePlayedBuffSelfPerSpell',
    why:
      "OWNER RULED 2026-08-26 (triage board): current behaviour confirmed \u2014 Vaultkeeper does not gain from combat summons \u2014 correct. Encoded as an OWNER RULED entry in the Doc Bot registries, which is the durable pin; the queue item is closed.",
    retiredAt: '2026-08-26',
  },
];

export const RETIRED_IDS: ReadonlySet<string> = new Set(RETIRED_RULES.map((r) => r.id));
