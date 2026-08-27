/**
 * RULE IMPACT — the §10.5 PR review signal, as a small PURE module: given the changed file paths and
 * content ids of a diff, which approved rules does it touch, which enforcement probes should run, and
 * which approved rules still carry no probe at all?
 *
 * Pure by construction: no fs, no process — rules are injected (defaulting to the live registry) so unit
 * tests can fabricate corpora. The CLI (`npm run rules:impact -- <paths...>`, packages/tools/src/rules-impact.ts)
 * handles path collection and content-id derivation; wiring into the Doc Bot aggregate report is a later
 * integration pass.
 */
import type { RuleEnforcement } from './schema';
import { allRules, type ResolvedRule } from './index';
import { ENFORCEMENT_LANES, enforcementOf, unenforcedApproved } from './enforcement';

export interface RuleImpactInput {
  /** Changed file paths (any separator; compared repo-relative, suffix-tolerant). */
  paths: string[];
  /** Content ids the change touches (card/rune ids), when the caller knows them. */
  contentIds?: string[];
}

export interface TouchedRule {
  id: string;
  title: string;
  effective: string;
  /** Why the rule is considered touched by this change. */
  via: ('content-id' | 'enforcement-ref' | 'evidence-ref')[];
  enforcement?: RuleEnforcement;
}

export interface RuleImpactReport {
  touchedRules: TouchedRule[];
  /** Deduped probes to run for the touched rules: test-file paths and oracle lane backing files. */
  enforcementRefs: string[];
  /** The standing §10.3 queue — always reported so a PR review sees the open enforcement debt. */
  unenforcedApproved: { id: string; title: string }[];
}

const norm = (p: string): string => p.replace(/\\/g, '/').replace(/^\.\//, '');
/** Does a changed path refer to a registry-recorded path? Tolerates absolute vs repo-relative prefixes. */
const pathTouches = (changed: string, recorded: string): boolean => {
  const c = norm(changed); const r = norm(recorded);
  return c === r || c.endsWith(`/${r}`) || r.endsWith(`/${c}`);
};

/** The concrete files behind an enforcement declaration (lane names resolve through ENFORCEMENT_LANES). */
export function enforcementFiles(enf: RuleEnforcement): string[] {
  if (enf.kind === 'manual') return [];
  if (enf.kind === 'oracle') return enf.refs.map((lane) => ENFORCEMENT_LANES[lane]?.file ?? lane);
  return enf.refs;
}

export function ruleImpact(input: RuleImpactInput, rules: ResolvedRule[] = allRules()): RuleImpactReport {
  const contentIds = new Set(input.contentIds ?? []);
  const touchedRules: TouchedRule[] = [];

  for (const rule of rules) {
    const via: TouchedRule['via'] = [];
    if (rule.contentIds?.some((cid) => contentIds.has(cid))) via.push('content-id');
    const enf = enforcementOf(rule);
    if (enf && input.paths.some((p) => enforcementFiles(enf).some((f) => pathTouches(p, f)))) via.push('enforcement-ref');
    if (rule.evidence.some((e) => input.paths.some((p) => pathTouches(p, e.ref)))) via.push('evidence-ref');
    if (via.length > 0) {
      touchedRules.push({ id: rule.id, title: rule.title, effective: rule.effective, via, ...(enf ? { enforcement: enf } : {}) });
    }
  }

  const enforcementRefs = [...new Set(touchedRules.flatMap((t) => (t.enforcement ? enforcementFiles(t.enforcement) : [])))].sort();
  return {
    touchedRules,
    enforcementRefs,
    unenforcedApproved: unenforcedApproved(rules).map((r) => ({ id: r.id, title: r.title })),
  };
}
