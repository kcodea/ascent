/**
 * ENFORCEMENT REGISTRY — the machine-checkable half of the §10.3 closed loop.
 *
 *  · `ENFORCEMENT_LANES` — the small registry of oracle lane names an `oracle` enforcement ref may cite.
 *    Each lane names its backing file so a renamed/deleted lane un-enforces its rules LOUDLY (the
 *    integrity test fs-checks every backing file).
 *  · `RULE_ENFORCEMENT` — enforcement for GENERATED rules (pending.generated.ts is rewritten by
 *    `npm run rules:seed`, so inline metadata there would be lost; this map is keyed by stable rule id
 *    and survives re-seeding). Hand-authored rules in approved.ts / retired.ts declare theirs inline.
 *  · `enforcementErrors` — the pure validator both the integrity test and the sabotage tests run.
 *  · `unenforcedApproved` — the approved-but-unenforced queue (§10.3), ratcheted in enforcement.test.ts.
 */
import type { GameRule, RuleEnforcement } from './schema';
import type { ResolvedRule } from './index';

export interface EnforcementLane {
  /** Repo-relative path of the scan/registry/test that re-alarms when the pinned behaviour drifts. */
  file: string;
  /** What the lane actually checks — so an oracle ref is auditable without opening the file. */
  what: string;
}

export const ENFORCEMENT_LANES: Record<string, EnforcementLane> = {
  temporalWindow: {
    file: 'packages/sim/src/docbot/temporalWindow.test.ts',
    what: 'per-instance trigger windows: the ten Avenge temporal scenarios, copy/Rise/gild progress semantics, the Rise RETURN-STAT probe (base first, Auras re-applied after — R-RISE-01), once-per-combat latches, first-N windows, per-source improve counters — plus the shrink-only KNOWN_VIOLATIONS pins for R-AVWIN-02/10',
  },
  factoryPhase: {
    file: 'packages/sim/src/docbot/factoryPhase.test.ts',
    what: 'every effect factory fires (or carries a typed excuse) in each phase where its trigger fires',
  },
  phaseRegistry: {
    file: 'packages/sim/src/docbot/phaseRegistry.ts',
    what: 'the typed phase-excuse registry — an OWNER RULED entry pins a confirmed phase no-op; deleting the factory re-alarms the factoryPhase lane',
  },
  historyRegistry: {
    file: 'packages/sim/src/docbot/historyRegistry.ts',
    what: 'the typed history/derivation excuse registry — an OWNER RULED entry pins a confirmed derivation choice',
  },
  spellPowerFolding: {
    file: 'packages/sim/src/docbot/spellPowerFolding.test.ts',
    what: 'stat-granting Shop spells fold spell power (or carry a typed excuse)',
  },
  heroPowerLane: {
    file: 'packages/sim/src/docbot/heroPowerLane.test.ts',
    what: 'every hero power changes state through the real heroPower action, or is classified passive/scheduled',
  },
  'playDifferential.refused': {
    file: 'packages/sim/src/docbot/playDifferential.test.ts',
    what: 'an unusable spell is refused, not consumed (#847 audit rule) — the refused set is pinned',
  },
  'playDifferential.watchers': {
    file: 'packages/sim/src/docbot/playDifferential.test.ts',
    what: 'board watchers react to plays staged past them, or carry a typed WATCHER_EXCUSED reading',
  },
  runeRewardDifferential: {
    file: 'packages/sim/src/docbot/runeRewardDifferential.test.ts',
    what: 'every rune reward changes state when armed; duplicate-swallow surface tracked by runeSwallowScan',
  },
  combatDifferential: {
    file: 'packages/sim/src/docbot/combatDifferential.test.ts',
    what: 'staged combat variants prove each combat effect changes the outcome (the audited echo fixture lives here)',
  },
  // ── lanes added for the 2026-08-27 triage-round-2 rulings (the sibling implementation PRs' pinning
  //    suites are in flight; each lane names the scan/suite that re-alarms when the ruled surface drifts) ──
  runeSwallowScan: {
    file: 'packages/sim/src/docbot/runeSwallowScan.ts',
    what: 'the rune duplicate-swallow surface: every owned-rune re-offer whose purchase changes nothing is enumerated — the R-RUNEDUP family rules shrink this list to zero as they are implemented, and a regression re-grows it loudly',
  },
  snapshotFidelity: {
    file: 'packages/sim/src/docbot/snapshotFidelity.test.ts',
    what: 'per-instance fields across the capture and player-mapping boundaries: every dropped field is enumerated against the snapshot registry, so a carried field silently going missing re-alarms',
  },
  carryOver: {
    file: 'packages/sim/src/docbot/carryOver.test.ts',
    what: 'turn-scoped charges/effects across the shop→combat boundary: what carries, what expires, and the per-phase charge semantics the owner ruled',
  },
  interactionFamilyMatrix: {
    file: 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts',
    what: 'the trigger-family × multiplier matrix: which re-fire paths fold which multiplier families, and the non-stacking best-of collapse',
  },
  orderGoldens: {
    file: 'packages/sim/src/docbot/orderGoldens.test.ts',
    what: 'the pinned resolution-order goldens (G1..G6): clash death order, Start-of-Combat side order, live improve steps mid-wave, shop aura-before-Shout',
  },
  // ── Doc Bot 2.0 WP B: the contract knowledge foundation ──
  contractExtraction: {
    file: 'packages/sim/src/docbot/contractExtract.test.ts',
    what: 'the ContentContract extraction + triangle-screening lane: every active content object holds a draft contract; the corroboration screen re-alarms when a covered aspect (phase reachability, text amounts/summons, play differential) disagrees with a member\'s extracted shape — the convention questions\' shared pin until WP D\'s per-contract oracle lands',
  },
  // ── Doc Bot 2.0 WP E: text intelligence ──
  textParse: {
    file: 'packages/sim/src/docbot/textParse/textParse.test.ts',
    what: 'the WP E text lane: every active object classified parsed-equivalent / verified-mismatch / approved-exception / unresolved-parse; the unresolved queue ratcheted grow-loudly; every mismatch registry-pinned (verify-before-alarm); guide-predicate advisor + Sitting-3 deck format bar — a wording ruling drifting out of the printed text re-alarms here',
  },
  textOracleSummons: {
    file: 'packages/sim/src/docbot/textOracleSummons.test.ts',
    what: 'summon-effect reconciliation against printed text: copy counts, exact-stat carriage, and the gilded-badge convention on summoned copies',
  },
  // ── Gilding shapes (owner rulings 2026-08-28: R-GILD-01 / R-GILD-02) ──
  gildingKinds: {
    file: 'packages/sim/src/docbot/gildingKinds.test.ts',
    what: 'the gilded-shape vocabulary: every card contract carries a derived-or-owner-ruled GildedDeltaContract kind (multiply / gilded-token / reshape / extra-proc / not-applicable), the named exemplars are driven through the real engine (Dunkey summons ONE gilded Armadiyo; a plain ×2 card doubles its count), every spell is not-applicable with its reason, and each kind\'s oracle branch is sabotage-proven to flip',
  },
  // ── Doc Bot 2.0 WP F: interaction intelligence ──
  interactionSweep: {
    file: 'packages/sim/src/docbot/interactionSweep.test.ts',
    what: 'the generated §10.3 pairwise coverage table (trigger×multiplier, death×Avenge/Echo, Echo×Rise, copy×counter, gild×progress, rune×minion, spell×improvement, overflow×summon — real-engine diffs; blocked pairs visibly cited) plus the §9.7 anomaly oracle and its Sitting-2 card template — an owner-ruled interaction card re-alarms here when the measured pair behaviour drifts (e.g. R-COPY-02\'s exact-copy rides: strip them from the Kennelmaster contract and the copy detector re-fires)',
  },
};

/**
 * Enforcement for generated (pending) rules, keyed by stable rule id — survives `npm run rules:seed`.
 * Only DECIDED generated rules belong here: an undecided question has nothing to enforce yet.
 */
export const RULE_ENFORCEMENT: Record<string, RuleEnforcement> = {
  // OWNER REVISED 2026-08-26 ("all good here" + named exceptions checked): the passive/scheduled hero-power
  // list is working-as-designed. The heroPowerLane pins the active set and the classified silent set — a
  // power drifting between the two re-alarms the lane.
  'q-policy-passive-hero-powers': { kind: 'oracle', refs: ['heroPowerLane'], lastVerifiedAt: '2026-08-27' },
  // OWNER REVISED 2026-08-26: refusal guards stand. The play lane pins the refused-spell set (#847 rule).
  'q-policy-refused-spells': { kind: 'oracle', refs: ['playDifferential.refused'], lastVerifiedAt: '2026-08-27' },
  // OWNER REVISED 2026-08-26 (reaffirmed in triage round 2): Grave Body is PARKED FOR REWORK — "this card
  // should get reworked, but it is also not currently active in the game. we'll revisit when we need to."
  // The watcher lane's WATCHER_EXCUSED entry carries the OWNER RULED parked reading and pins the silence.
  'q-watch-gravebody': { kind: 'oracle', refs: ['playDifferential.watchers'], lastVerifiedAt: '2026-08-27' },
};

/** A rule's effective enforcement: inline declaration first, then the survives-reseeding map. */
export function enforcementOf(rule: Pick<GameRule, 'id' | 'enforcement'>): RuleEnforcement | undefined {
  return rule.enforcement ?? RULE_ENFORCEMENT[rule.id];
}

export interface EnforcementCheckEnv {
  /** Does a repo-relative file path exist? (Tests pass fs.existsSync rooted at the repo; sabotage tests pass fakes.) */
  fileExists: (repoRelativePath: string) => boolean;
  /** The known oracle lanes (defaults to ENFORCEMENT_LANES). */
  lanes?: Record<string, EnforcementLane>;
}

/**
 * Validate one enforcement declaration. Returns human-readable errors; empty = valid.
 * This is the single validator the integrity test AND the sabotage tests exercise — a fabricated rule with
 * a nonexistent ref must fail HERE for the intended reason.
 */
export function enforcementErrors(ruleId: string, enf: RuleEnforcement, env: EnforcementCheckEnv): string[] {
  const errors: string[] = [];
  const lanes = env.lanes ?? ENFORCEMENT_LANES;
  if (enf.kind === 'manual') {
    if (!enf.reason?.trim()) errors.push(`${ruleId}: kind 'manual' requires a reason (why no executable probe exists)`);
    return errors; // manual refs are prose pointers; nothing to resolve
  }
  if (enf.refs.length === 0) errors.push(`${ruleId}: kind '${enf.kind}' declares no refs — an empty enforcement enforces nothing`);
  for (const ref of enf.refs) {
    if (enf.kind === 'oracle') {
      if (!lanes[ref]) errors.push(`${ruleId}: oracle ref '${ref}' is not a known lane (see ENFORCEMENT_LANES)`);
    } else if (!env.fileExists(ref)) {
      errors.push(`${ruleId}: ${enf.kind} ref '${ref}' does not exist on disk — the pin rotted or the path is wrong`);
    }
  }
  return errors;
}

/** The §10.3 queue: approved/revised-effective rules with NO enforcement declaration. */
export function unenforcedApproved(rules: ResolvedRule[]): ResolvedRule[] {
  return rules.filter((r) => (r.effective === 'approved' || r.effective === 'revised') && !enforcementOf(r));
}
