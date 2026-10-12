/**
 * GUIDES: two pure helpers for the team's Reports pill.
 *
 *  - `groupReports`: the open reports, one group per guide, the most reported first.
 *  - `planCarryOver`: which guides a new set should be added to. A guide carries over when every Core card, Enabler and
 *    named card is in the new set's pool and its tribes are on the new set's roster (`guideSetsFor`, the same rule a
 *    save uses). It only ever ADDS the set: a guide that fails is left as it is (owner 2026-10-11: a card archived
 *    mid-set does not untag a guide).
 */
import { guideSetsFor, type GuideRecord, type ReportReason, type SetFacts } from '@game/guides';
import type { GuideTagRow, OpenReport } from './guidesRemote';

export interface ReportGroup {
  guide: GuideRecord;
  count: number;
  /** Each reason given, most given first. */
  reasons: Array<[ReportReason, number]>;
  /** The notes that say something, newest first, five at most. */
  notes: string[];
  latestAt: string;
}

const MAX_NOTES = 5;

export function groupReports(reports: readonly OpenReport[]): ReportGroup[] {
  const byGuide = new Map<string, OpenReport[]>();
  for (const r of reports) {
    const list = byGuide.get(r.guideId);
    if (list) list.push(r); else byGuide.set(r.guideId, [r]);
  }
  const groups: ReportGroup[] = [];
  for (const list of byGuide.values()) {
    const newest = [...list].sort((a, b) => b.createdAt.localeCompare(a.createdAt));
    const tally = new Map<ReportReason, number>();
    for (const r of list) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
    groups.push({
      guide: newest[0]!.guide,
      count: list.length,
      reasons: [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      notes: newest.map((r) => r.note.trim()).filter((n) => n !== '').slice(0, MAX_NOTES),
      latestAt: newest[0]!.createdAt,
    });
  }
  return groups.sort((a, b) => b.count - a.count || b.latestAt.localeCompare(a.latestAt) || a.guide.id.localeCompare(b.guide.id));
}

export interface CarryPlan {
  /** The guides to add the set to. */
  carry: string[];
  /** Guides that do not fit the set and stay as they are. */
  stay: number;
  /** Guides that already carry it. */
  already: number;
}

export function planCarryOver(rows: readonly GuideTagRow[], target: string, facts: readonly SetFacts[]): CarryPlan {
  const set = facts.filter((f) => f.id === target);
  const plan: CarryPlan = { carry: [], stay: 0, already: 0 };
  for (const r of rows) {
    if (r.sets.includes(target)) { plan.already += 1; continue; }
    if (set.length > 0 && guideSetsFor(r, set).length > 0) plan.carry.push(r.id);
    else plan.stay += 1;
  }
  return plan;
}

/** A list cut into runs of at most `size`, in order. */
export function batches<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += Math.max(1, size)) out.push(items.slice(i, i + Math.max(1, size)));
  return out;
}
