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

// ── Triage round 2 (2026-08-27) shared pins — lane-level, because the sibling implementation PRs'
//    dedicated test suites are still in flight; each lane re-alarms if the ruled surface drifts. ──
const RUNEDUP_PIN: RuleEnforcement = { kind: 'oracle', refs: ['runeSwallowScan'], lastVerifiedAt: '2026-08-27' };
const SNAPSHOT_PIN: RuleEnforcement = { kind: 'oracle', refs: ['snapshotFidelity'], lastVerifiedAt: '2026-08-27' };
const CARRY_OVER_PIN: RuleEnforcement = { kind: 'oracle', refs: ['carryOver'], lastVerifiedAt: '2026-08-27' };
const ORDER_GOLDENS_PIN: RuleEnforcement = { kind: 'oracle', refs: ['orderGoldens'], lastVerifiedAt: '2026-08-27' };
const INTERACTION_PIN: RuleEnforcement = { kind: 'oracle', refs: ['interactionFamilyMatrix'], lastVerifiedAt: '2026-08-27' };

// ── Convention-deck triage (2026-08-28): the split + the park each carry their own executable pin. ──
/** The cohesion assertion — the machine-checkable form of the owner's "not a cohesive family" complaint. */
const CONVENTION_COHESION_PIN: RuleEnforcement = {
  kind: 'scenario',
  refs: ['packages/sim/src/docbot/conventionCohesion.test.ts'],
  lastVerifiedAt: '2026-08-28',
};
/** The parking pin: parked classes generate no questions, bind no members, and stamp their contracts. */
const PARKED_PIN: RuleEnforcement = {
  kind: 'scenario',
  refs: ['packages/sim/src/docbot/conventionCohesion.test.ts', 'packages/rules/src/parked.test.ts'],
  lastVerifiedAt: '2026-08-28',
};

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

  // ════════════════ TRIAGE ROUND 2 (2026-08-27) — all 24 manual cards decided; board drained to 0 ════════════════
  // Implemented-by-sibling rulings cite the LANE that pins the ruled surface (the sibling PRs'
  // dedicated test files are still in flight, so lane-level refs are the durable pin today).
  // The standing rules the rulings established live in approved.ts (R-RUNEDUP-01..08, R-ORD-01/02,
  // R-MULT-01, R-SHOUT-01).

  // ── A. Rune duplicate stacking — all 8 family rules ruled; IMPLEMENTED in feat/rune-duplicate-stacking ──
  {
    id: 'q-runedup-recurring',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): recurring/per-event rune duplicates STACK — a second copy makes the effect fire once more each time it recurs (two Flagships = +4/+4 per Shop spell). Standing rule R-RUNEDUP-01. IMPLEMENTED in feat/rune-duplicate-stacking; the runeSwallowScan lane pins the duplicate-swallow surface shrinking as families land.',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-threshold',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim): "A second copy copy should double the output. i.e. 2 rune of the returning pack, every 6 beast summons you\'d get 2 random beasts, etc." — double the PAYOFF at the same threshold, not parallel meters. Standing rule R-RUNEDUP-02. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-repeat',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): repeat runes gain +1 repetition per copy (two Wishbones = hero power fires 3 times), riding the existing extraTriggerFires / per-family fold plumbing. Standing rule R-RUNEDUP-03. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-oneshot',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE): one-shot duplicates RE-FIRE the reward; when immediate re-fire would still give no value, the effect BANKS and fires next turn (a second Armory grants its 10 Attachments next turn — hand cap), Muster covers the first 2 refreshes with 2 copies, Ornate Clock is unique and a duplicate does nothing, and Held Strength is to be REDESIGNED from a one-shot into a "Start of Combat: give xyz" rune. Standing rule R-RUNEDUP-04. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-boolean-flags',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): boolean combat flags whose effect can meaningfully repeat fire ONCE PER COPY (flagCopies goes live everywhere, matching the Avenge dispatchers that already consume it); true one-offs fall back to the universal sweetener. Standing rule R-RUNEDUP-05. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-sweetener-floor',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): the universal sweetener floor — any duplicate that cannot meaningfully stack grants Gold equal to half the rune\'s cost rounded up plus a free refresh, so a duplicate is NEVER a dead buy. Standing rule R-RUNEDUP-06. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-forge-filter',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): the forge filter — the Runeforge stops offering an owned rune whose duplicate would only pay the sweetener; stacking families stay offerable, and Rune of Duplication still reaches everything (backstopped by the sweetener). Standing rule R-RUNEDUP-07. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },
  {
    id: 'q-runedup-unique-engines',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim): "generally, try and double the effect when possible. rune of structure = you get 2 random shop spells. rune of summoning = your imps get +4/+4, rune of contraband doubles the output of the ale/ruby per trigger etc." — unique engines double their output where a doubling reading exists; the sweetener remains the fallback for the rest. Standing rule R-RUNEDUP-08. IMPLEMENTED in feat/rune-duplicate-stacking (runeSwallowScan lane).',
    retiredAt: '2026-08-27',
    enforcement: RUNEDUP_PIN,
  },

  // ── B. Copy / carry-over / snapshot rulings ──
  {
    id: 'q-copy-gilded-badge',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE): Exgalloper\'s summons "should be exact copies without the echo, so they would be gilded too" — the plain-badge behaviour is the bug; exact copies of a Gilded source keep the Gilded badge (Mirrorhide Rhino was already right). The owner will rename the copy-without-echo keyword to REBIRTH soon (his own follow-up work). IMPLEMENTED in fix/combat-replay-multipliers; the textOracleSummons lane pins the gilded-badge convention on summoned copies.',
    retiredAt: '2026-08-27',
    enforcement: { kind: 'oracle', refs: ['textOracleSummons'], lastVerifiedAt: '2026-08-27' },
  },
  {
    id: 'q-carry-demand-encore',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim, a STANDING rule): "\'This turn\' terminology runs from shop through that turn\'s combat, and ends at the start of the next shop turn. so this effect should absolutely carry over into combat. use this language and logic moving forward and to retroactively fix issues." Demand an Encore\'s unused charge carries to combat-triggered Shouts, and every other "this turn" effect follows the same rule. IMPLEMENTED in feat/this-turn-rule (carryOver lane).',
    retiredAt: '2026-08-27',
    enforcement: CARRY_OVER_PIN,
  },
  {
    id: 'q-carry-warm-embers-double-dip',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE): "first shout each turn = the first shout triggered EACH shop or combat phase. so if a shout gets triggered through parting cry in combat on turn 7, then the first shout in turn 8 is a separate charge, so both should work." Not a double-dip of ONE charge — each phase carries its own first-Shout charge. Standing rule R-SHOUT-01. IMPLEMENTED in feat/this-turn-rule (carryOver lane).',
    retiredAt: '2026-08-27',
    enforcement: CARRY_OVER_PIN,
  },
  {
    id: 'q-snap-impbank',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): Ashen Heir\'s Imp bank RIDES both boundaries — BoardMinion gains the slot, capture and the player board→combat mapping thread it, and a served Heir fights with the bank it was captured with. IMPLEMENTED in feat/snapshot-carries (snapshotFidelity lane).',
    retiredAt: '2026-08-27',
    enforcement: SNAPSHOT_PIN,
  },
  {
    id: 'q-snap-rallyspreadatk',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): Sunmane Herald\'s rally-Attack accrual is PER-COMBAT — a within-fight snowball resetting each fight, matching the printed "only in combat" and the 2026-08-08 Rise ruling. The write-dead BoardCard.rallySpreadAtk field and its stale "run-long" docblock are deleted so the code stops promising otherwise (cleanup rides feat/snapshot-carries). The snapshotFidelity lane pins the field classification.',
    retiredAt: '2026-08-27',
    enforcement: SNAPSHOT_PIN,
  },
  {
    id: 'q-snap-one-combat-marks',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): the drop was a bug — capture carries Parting Cry, Soren\'s Reclaim and Closed Casket exactly as it carries Bloodlust, so served boards fight with the marks the player paid for (the Soren best-Echo reconstruction heuristic becomes unnecessary). IMPLEMENTED in feat/snapshot-carries (snapshotFidelity lane).',
    retiredAt: '2026-08-27',
    enforcement: SNAPSHOT_PIN,
  },
  {
    id: 'q-snap-granted-effects',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): grafted Deathrattles (grantedEffects — Grave Body, Echo Mimic, Contract Rewrite, Rune of Rebirth\'s shop half) ride into combat and capture through the same channel as copiedEcho — the shop-only silence was a bug. IMPLEMENTED in feat/snapshot-carries (snapshotFidelity lane).',
    retiredAt: '2026-08-27',
    enforcement: SNAPSHOT_PIN,
  },
  {
    id: 'q-snap-echostripped',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE): the echoStripped mark carries — "if a summoned copy that removes the echo is somehow granted into the shop, then it would be the rebirthed/cleansed version that should then NOT summon itself when killed in combat." The printed "without Echo" holds in every phase; the coming REBIRTH keyword (owner\'s follow-up) formalizes the copy-without-echo shape. IMPLEMENTED in feat/snapshot-carries (snapshotFidelity lane).',
    retiredAt: '2026-08-27',
    enforcement: SNAPSHOT_PIN,
  },

  // ── C. Order ambiguities ──
  {
    id: 'q-order-clash-echo-defender-first',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): defender-first IS the rule — in a mutual-kill clash the defender\'s death and Echo resolve before the attacker\'s, on both sides. Golden G3 (orderGoldens) stays the pin; GAME-RULES documents it.',
    retiredAt: '2026-08-27',
    enforcement: ORDER_GOLDENS_PIN,
  },
  {
    id: 'q-order-soc-player-side-first',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim): "This should be initiative-side first. the side that attacks first resolves start of combat first. both SOC\'s trigger before attacks start, but the side that attacks first gets the SoC triggers first." The fixed first-passed-side order was a bug. IMPLEMENTED in fix/combat-replay-multipliers (golden G2 re-pinned to initiative-side-first; ships with a replay-version note since it re-times replays).',
    retiredAt: '2026-08-27',
    enforcement: ORDER_GOLDENS_PIN,
  },
  {
    id: 'q-order-improve-steps-mid-resolution',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): live improve steps are the rule — every summon re-reads the current step, even within one simultaneous wave (Beardsley\'s 4th Pup of one Cleave wave gets the improved rate). Standing rule R-ORD-01; golden G4 (orderGoldens) is the pin.',
    retiredAt: '2026-08-27',
    enforcement: ORDER_GOLDENS_PIN,
  },
  {
    id: 'q-order-shop-aura-before-shout',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): aura-first with live improve steps is the rule in the shop too — on-summon auras (and their improve steps) resolve before the played minion\'s own Shout (Den Mother\'s improved grant reaches Pennycat\'s Stray). Standing rule R-ORD-02; golden G6 (orderGoldens) is the pin.',
    retiredAt: '2026-08-27',
    enforcement: ORDER_GOLDENS_PIN,
  },

  // ── D. Interaction ambiguities ──
  {
    id: 'q-interact-nonstack-best-of',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim): "This is correct behavior. We will probably change our text/terminology to better reflect non stackers. i.e. using \'Twice\' instead of \'an additional time.\'" Best-of across different non-stacking multipliers of one family stands; the terminology pass is the owner\'s future work. Standing rule R-MULT-01; the interactionFamilyMatrix lane pins the collapse.',
    retiredAt: '2026-08-27',
    enforcement: INTERACTION_PIN,
  },
  {
    id: 'q-interact-combat-shout-multipliers',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): the flat paths were an omission — EVERY combat Shout re-fire (Parting Cry, Embercrest\'s Rally, Rune of Ancestral Roar, Rune of Shared Scripture, Rune of the War Chorus) folds the Battlecry multipliers, matching Ryme/Dawnclaw/Thunderous Sovereign and the shop (the 2026-08-20 "multipliers follow the trigger" principle applied uniformly). IMPLEMENTED in fix/combat-replay-multipliers (interactionFamilyMatrix lane).',
    retiredAt: '2026-08-27',
    enforcement: INTERACTION_PIN,
  },
  {
    id: 'q-interact-empty-graves-flat',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, APPROVE): Empty Graves\' forced Echo folds the side\'s Echo multipliers like every other forced trigger (Rune of the Herald, Deathsayer, Echohorn) — the single-fire was an omission. IMPLEMENTED in fix/combat-replay-multipliers (interactionFamilyMatrix lane). The stale questText reward line found in passing is tracked with the same fix.',
    retiredAt: '2026-08-27',
    enforcement: INTERACTION_PIN,
  },
  {
    id: 'q-interact-forced-echo-first-bonus',
    why:
      'OWNER RULED 2026-08-27 (triage round 2, REVISE — verbatim): "an echo trigger is an echo trigger, so for example Spot\'s start of combat trigger would trigger that charge on the left-most echo that gets triggered first." Forced, deathless Echo triggers legitimately consume the once-per-combat first-Echo bonus — current behaviour confirmed; the interactionFamilyMatrix lane pins it.',
    retiredAt: '2026-08-27',
    enforcement: INTERACTION_PIN,
  },
  {
    id: 'q-word-lg-scope-01',
    why:
      'OWNER RULED 2026-08-28 (Sitting 3, REVISE — verbatim): "this is correct, however we want to re-brand the '
      + '\'wherever they are\' vocabulary to Aura\'s instead. i.e. Buff your Undead Army Aura +4/+1, or Buff your Imp '
      + 'Aura +4/+4 etc." IMPLEMENTED in feat/aura-vocabulary (#1279): 11 carriers rewritten to the Aura vocabulary, '
      + 'LG-SCOPE-01 approved as the canon, and the wording deck self-retired the question (11 → 10 cards). The '
      + 'textParse lane pins the vocabulary (a live card reusing the retired phrasing re-alarms).',
    retiredAt: '2026-08-28',
    enforcement: { kind: 'oracle', refs: ['textParse'], lastVerifiedAt: '2026-08-28' },
  },

  {
    id: 'q-conv-trigger-residual',
    why:
      'OWNER RULED 2026-08-28 (Sitting 4, REVISE — verbatim): "These are unique minions but they could share '
      + 'families in some ways. gangplank and kegheart are cards that track when cards get added to hand, fel '
      + 'conjurer is a start of turn get spell to hand, reflect and mirrorwing are when targeted by spell minions, '
      + 'hellrider is a refresh mechanic minion. these families will be expanded on eventually so they shouldnt be '
      + 'fully isolated cards." IMPLEMENTED: the four groupings the owner named became four real TRIGGER_GROUPS '
      + '(gainCard, startOfTurn, spellTargeted, shopRefresh), so the residual bucket is now EMPTY and this card '
      + 'cannot regenerate. The next card authored on any of those triggers joins a standing convention instead of '
      + 're-opening a settled question.',
    retiredAt: '2026-08-28',
    enforcement: { kind: 'oracle', refs: ['contractExtraction'], lastVerifiedAt: '2026-08-28' },
  },

  // ── E. The Sitting-2 anomaly deck (owner decisions 2026-08-28) — all three cards resolved, so the deck
  //    regenerates EMPTY. Each anomaly is gone because its cause was fixed, never because it was suppressed. ──
  {
    id: 'q-interact2-2ad14500',
    why:
      'OWNER RULED 2026-08-28 (Sitting-2, REVISE — verbatim): "I do not understand this ask. simply put a xerox copy should be an exact copy, so identical in every way." The ENGINE was right and the CONTRACT was incomplete: Kennelmaster\'s copySubject.rides now states gilding and every other card-owned instance property as riding an exact copy (R-COPY-02), so the copied-source-unexpected-state detector no longer fires on it. The card itself also failed the self-contained bar — the anomaly-question template was rewritten to state the observation and the ✓/✕ meaning on its face (interactionQuestions.ts).',
    retiredAt: '2026-08-28',
    enforcement: { kind: 'oracle', refs: ['interactionSweep'], lastVerifiedAt: '2026-08-28' },
  },
  {
    id: 'q-interact2-32aa654f',
    why:
      'OWNER RULED 2026-08-28 (Sitting-2, APPROVE): Uron\'s endOfTurn/startOfCombat multipliers compose by the same law as the ruled families — additive within a family, best-of across non-stacking cards. Encoded as standing rule R-MULT-02, pinned by matrix fixtures P12–P13; endOfTurn and startOfCombat joined RULED_MULTIPLIER_FAMILIES so the unruled-composition detector cannot re-ask it.',
    retiredAt: '2026-08-28',
    enforcement: INTERACTION_PIN,
  },
  {
    id: 'q-interact2-faeb3c44',
    why:
      'OWNER RULED 2026-08-28 (Sitting-2, APPROVE): Chronos\'s endOfTurn multiplier composes by the same law — the sibling half of q-interact2-32aa654f. Encoded as standing rule R-MULT-02 and pinned by matrix fixture P12 (Uron + Chronos collapse to one extra End-of-Turn fire, not two); this also resolves interaction-ambiguities.md Q1.',
    retiredAt: '2026-08-28',
    enforcement: INTERACTION_PIN,
  },

  // ── Convention deck, owner triage 2026-08-28: the economy split + the Orbit/Celestial park ────────────
  // These five ids are SUPERSEDED, never recycled. Their replacements carry NEW q-conv-trigger-* ids (or,
  // for the parked classes, no id at all — a parked surface is not asked about). The cohesion pin is the
  // machine-checkable form of the owner's complaint.
  {
    id: 'q-conv-family-economy',
    why:
      'OWNER RULED 2026-08-28 (REVISE — verbatim): "this family seems extremely varied. there are cards that '
      + 'proc on sell in this category, there are some shouts, there are cards that trigger from buying x cards, '
      + 'there are cards that learn other spells etc. this does not seem like a cohesive family of cards or '
      + 'rulings to me." He was right: the \'economy\' PRESENTATION family spanned 11 distinct trigger events, so '
      + 'its card\'s claim ("all 36 trigger the same way") was false. SUPERSEDED by the trigger-keyed re-cluster '
      + '(q-conv-trigger-sell / -buy / -goldSpent / -ruby / -residual), each of whose members genuinely share the '
      + 'trigger the card names. conventionCohesion.test.ts now fails any family card that repeats the mistake.',
    retiredAt: '2026-08-28',
    enforcement: CONVENTION_COHESION_PIN,
  },
  {
    id: 'q-conv-family-economyReact',
    why:
      'SUPERSEDED 2026-08-28 by the same re-cluster as q-conv-family-economy (owner REVISE on that card): '
      + '\'economyReact\' spanned 8 distinct trigger events and duplicated economy\'s trigger moments, so pooling '
      + 'both families and re-clustering by TRIGGER was the only way to avoid two cards asking the same question. '
      + 'Undecided when it left the board; its members now sit under q-conv-trigger-sell / -buy / -goldSpent / '
      + '-ruby / -residual. The id is retired, not recycled.',
    retiredAt: '2026-08-28',
    enforcement: CONVENTION_COHESION_PIN,
  },
  {
    id: 'q-conv-family-react',
    why:
      'SUPERSEDED 2026-08-28 by the audit the owner\'s economy ruling triggered: \'react\' was the third family '
      + 'whose members did not share the trigger its card claimed (friendlyDemonDealtDamage, onConsume, onDamaged, '
      + 'onGainAttack, summonOverflow — five unrelated moments under one "all N trigger the same way" statement). '
      + 'Undecided when it left the board; re-clustered into q-conv-trigger-damaged / -consume / -gainAttack / '
      + '-overflow. The id is retired, not recycled.',
    retiredAt: '2026-08-28',
    enforcement: CONVENTION_COHESION_PIN,
  },
  {
    id: 'q-conv-family-orbit',
    why:
      'OWNER RULED 2026-08-28 (REVISE — verbatim): "orbit is extremely work in progress and should not receive '
      + 'any true rules yet, neither should any celestial as they are temp minions". PARKED, not answered: the '
      + '\'orbit\' family is registered in packages/rules/src/parked.ts, which suppresses its convention card, '
      + 'strips Celestial content from every other card\'s member list, stamps its contracts \'parked-wip\' (still '
      + 'counted, never dropped), and keeps the Doc Bot lanes measuring without asserting intent. Un-parking is '
      + 'one edit: delete the class entry. The id is retired, not recycled — a resumed design gets a NEW id.',
    retiredAt: '2026-08-28',
    enforcement: PARKED_PIN,
  },
  {
    id: 'q-conv-family-orbitReact',
    why:
      'OWNER RULED 2026-08-28 (REVISE — verbatim): "as stated before, orbit and celestials are masssive works in '
      + 'progress right now." PARKED with its sibling under the \'orbit\' class in packages/rules/src/parked.ts — '
      + 'no convention question, no approved rule, contracts stamped \'parked-wip\' and visible in the counts. '
      + 'Un-parking is one edit. The id is retired, not recycled — a resumed design gets a NEW id.',
    retiredAt: '2026-08-28',
    enforcement: PARKED_PIN,
  },
];

export const RETIRED_IDS: ReadonlySet<string> = new Set(RETIRED_RULES.map((r) => r.id));
