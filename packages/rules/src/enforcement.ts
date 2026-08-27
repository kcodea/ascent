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
  // OWNER REVISED 2026-08-26: Grave Body's silence is correct for now ("should get reworked, but it is also
  // not currently active in the game"). The watcher lane's WATCHER_EXCUSED reading pins the silence.
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
