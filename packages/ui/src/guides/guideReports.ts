/**
 * GUIDES: two pure helpers for the team's Reports pill.
 *
 *  - `groupReports`: the open reports, one group per guide, the most reported first. "Newest" is by TIME, never by
 *    the text of a timestamp: the server writes a whole second without a fraction and any other time with one, so
 *    the two do not sort as text. A time that cannot be read counts as the oldest.
 *  - `planCarryOver`: which guides a new set should be added to. A guide carries over when every Core card, Enabler and
 *    named card is in the new set's pool and its tribes are on the new set's roster (`guideSetsFor`, the same rule a
 *    save uses). It only ever ADDS the set: a guide that fails is left as it is (owner 2026-10-11: a card archived
 *    mid-set does not untag a guide). A guide is counted, and proposed, once however often its row comes: the read
 *    pages through a table that may be written to meanwhile, and the server refuses a batch that names an id twice.
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
  /** How many more notes say something and are not in `notes`. The panel says so: no note goes missing unheard. */
  moreNotes: number;
  latestAt: string;
}

const MAX_NOTES = 5;

/** When a report was made, as a number to compare. One that cannot be read (or is empty) is 0: the oldest. */
const timeOf = (at: string): number => {
  const t = Date.parse(at);
  return Number.isFinite(t) ? t : 0;
};

export function groupReports(reports: readonly OpenReport[]): ReportGroup[] {
  const byGuide = new Map<string, OpenReport[]>();
  for (const r of reports) {
    const list = byGuide.get(r.guideId);
    if (list) list.push(r); else byGuide.set(r.guideId, [r]);
  }
  const groups: ReportGroup[] = [];
  for (const list of byGuide.values()) {
    const newest = [...list].sort((a, b) => timeOf(b.createdAt) - timeOf(a.createdAt));
    const tally = new Map<ReportReason, number>();
    for (const r of list) tally.set(r.reason, (tally.get(r.reason) ?? 0) + 1);
    const notes = newest.map((r) => r.note.trim()).filter((n) => n !== '');
    groups.push({
      guide: newest[0]!.guide,
      count: list.length,
      reasons: [...tally.entries()].sort((a, b) => b[1] - a[1] || a[0].localeCompare(b[0])),
      notes: notes.slice(0, MAX_NOTES),
      moreNotes: Math.max(0, notes.length - MAX_NOTES),
      latestAt: newest[0]!.createdAt,
    });
  }
  return groups.sort((a, b) => b.count - a.count || timeOf(b.latestAt) - timeOf(a.latestAt) || a.guide.id.localeCompare(b.guide.id));
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
  const seen = new Set<string>();
  for (const r of rows) {
    if (seen.has(r.id)) continue; // the same row again: it counts once
    seen.add(r.id);
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
