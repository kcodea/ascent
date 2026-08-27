/**
 * RULES-REGISTRY HASH — the `rulesRev` component of the §16 semantic-revision identity
 * (docs/docbot2/canonical-schemas.md §5).
 *
 * One FNV-1a hash over every rule (folded with its decision) so a finding/scenario can record exactly
 * which rulebook it was evaluated under, and a later run can tell "the rules moved" apart from "the
 * content moved" component-wise. Lives beside the registry (not in @game/sim) so `rules:impact` and the
 * enforcement suite can reuse it without a dependency inversion.
 *
 * Deliberately hashes the RESOLVED view (`allRules()` — statement, status, effective status, decision,
 * enforcement) rather than raw file text: a comment-only edit to a registry file must not move the hash,
 * while an owner click in decisions.json must.
 */
import { allRules } from './index';

/** Canonical stringify: keys sorted at every depth, undefined stripped (the revisions.ts pattern). */
function canonical(value: unknown): string {
  if (value === null || typeof value !== 'object') return JSON.stringify(value) ?? 'null';
  if (Array.isArray(value)) return `[${value.map(canonical).join(',')}]`;
  const entries = Object.entries(value as Record<string, unknown>)
    .filter(([, v]) => v !== undefined)
    .sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0));
  return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonical(v)}`).join(',')}}`;
}

/** FNV-1a 32-bit → 8 hex chars (the shared repo fingerprint primitive). */
function fnv1a(str: string): string {
  let h = 0x811c9dc5;
  for (let i = 0; i < str.length; i++) {
    h ^= str.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return (h >>> 0).toString(16).padStart(8, '0');
}

let cached: string | null = null;

/** The rulebook revision: moves when any rule's statement/status/decision/enforcement moves. Memoised —
 *  the registry is immutable for a process lifetime (decisions land via file writes + reload). */
export function rulesRevision(): string {
  if (!cached) {
    cached = fnv1a(
      allRules()
        .map((r) => `${r.id}:${fnv1a(canonical(r))}`)
        .sort()
        .join('|'),
    );
  }
  return cached;
}
