/**
 * SEED HYGIENE — the pure logic `npm run rules:seed` (packages/tools/src/rules-seed.ts) runs so the
 * regenerated pending board honors owner decisions and retirement (§10.4), unit-tested here in the rules
 * package (including the sabotage cases):
 *
 *  · a REJECTED question leaves the active pending set on reseed — tombstoned into retired.generated.ts,
 *    never silently kept, never silently dropped;
 *  · a previously-pending question whose content ids no longer resolve retires AUTOMATICALLY with an
 *    audit record (a stale question must not vanish without a trace);
 *  · a tombstoned id (hand or auto) is never re-emitted as a pending question — retired/approved ids are
 *    never recycled;
 *  · approve/revise decisions leave their questions untouched (decisions survive regeneration).
 */
import type { DecisionMap, GameRule } from './schema';
import type { RetiredRule } from './registry/retired';

export interface SeedHygieneInput {
  /** The freshly generated candidate rows, before hygiene. */
  fresh: GameRule[];
  /** The PREVIOUS pending board (the committed pending.generated.ts, imported before overwriting). */
  previous: GameRule[];
  /** Owner decisions (decisions.json). */
  decisions: DecisionMap;
  /** Ids already tombstoned — hand-retired (RETIRED_IDS) plus previously auto-retired. */
  retiredIds: ReadonlySet<string>;
  /** Does a content id still resolve (CARD_INDEX / RUNE_INDEX)? */
  contentResolves: (id: string) => boolean;
  /** Today's ISO date, for tombstones. */
  today: string;
}

export interface SeedHygieneResult {
  /** The pending rows to actually emit. */
  pending: GameRule[];
  /** NEW tombstones to append to retired.generated.ts (never rewrites or drops existing ones). */
  newTombstones: RetiredRule[];
}

export function applySeedHygiene(input: SeedHygieneInput): SeedHygieneResult {
  const { fresh, previous, decisions, retiredIds, contentResolves, today } = input;
  const newTombstones: RetiredRule[] = [];
  const tombstoned = (id: string): boolean => retiredIds.has(id) || newTombstones.some((t) => t.id === id);

  const pending = fresh.filter((row) => {
    // Never resurrect a tombstoned question — retired ids are permanent (id-recycling guard at the source).
    if (retiredIds.has(row.id)) return false;
    // §10.4: reject retires the recommendation; it must not remain in the active pending set.
    if (decisions[row.id]?.decision === 'reject') {
      newTombstones.push({
        id: row.id,
        why:
          `AUTO-RETIRED by rules:seed (${today}): the owner REJECTED this recommendation on `
          + `${decisions[row.id]!.decidedAt.slice(0, 10)}${decisions[row.id]!.note ? ` — "${decisions[row.id]!.note}"` : ''}. `
          + `A rejected question leaves the active pending set on reseed (§10.4); any follow-up work the `
          + `rejection implies is roadmap material, not a standing board card. `
          + `Question was: "${row.title}"`,
        retiredAt: today,
      });
      return false;
    }
    return true;
  });

  // A previously-pending question that did not regenerate AND whose content vanished retires with an
  // audit record instead of silently disappearing.
  const freshIds = new Set(pending.map((r) => r.id));
  for (const prev of previous) {
    if (freshIds.has(prev.id) || tombstoned(prev.id)) continue;
    const gone = (prev.contentIds ?? []).filter((cid) => !contentResolves(cid));
    if (prev.contentIds?.length && gone.length > 0) {
      newTombstones.push({
        id: prev.id,
        why:
          `AUTO-RETIRED by rules:seed (${today}): stale question — content id(s) ${gone.map((g) => `'${g}'`).join(', ')} `
          + `no longer resolve in CARD_INDEX/RUNE_INDEX, so the question is unaskable. Audit record kept so the id `
          + `is never recycled and any owner decision on it stays traceable. Question was: "${prev.title}"`,
        retiredAt: today,
      });
    }
    // Otherwise: the queue legitimately drained (Doc Bot verified it, or the scan's excuse resolved). If an
    // owner DECISION exists on such an id, the registry integrity test demands an explicit hand tombstone.
  }

  return { pending, newTombstones };
}
