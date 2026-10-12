import { describe, expect, it } from 'vitest';
import type { GuideRecord, SetFacts } from '@game/guides';
import { batches, groupReports, planCarryOver } from './guideReports';
import type { GuideTagRow, OpenReport } from './guidesRemote';

const guide = (id: string): GuideRecord => ({
  id, slug: null, authorId: 'u-9', byline: 'Ann', official: false, published: true, publishedAt: null, hidden: false, sets: ['set2'], tribes: [],
  pairsWith: [], iconCard: 'grim', title: `Guide ${id}`, tagline: '', body: 'B', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '',
});
const rep = (id: string, guideId: string, reason: OpenReport['reason'], at: string, note = ''): OpenReport =>
  ({ id, guideId, reason, note, createdAt: at, guide: guide(guideId) });

describe('groupReports', () => {
  it('groups by guide, most reported first, then most recent', () => {
    const groups = groupReports([
      rep('r1', 'a', 'spam', '2026-10-14T01:00:00Z'), rep('r2', 'b', 'offensive', '2026-10-14T05:00:00Z'),
      rep('r3', 'a', 'offensive', '2026-10-14T02:00:00Z'), rep('r4', 'c', 'other', '2026-10-14T06:00:00Z'), rep('r5', 'a', 'spam', '2026-10-14T03:00:00Z'),
    ]);
    expect(groups.map((g) => [g.guide.id, g.count])).toEqual([['a', 3], ['c', 1], ['b', 1]]);
    expect(groups[0]!.reasons).toEqual([['spam', 2], ['offensive', 1]]);
    expect(groups[0]!.latestAt).toBe('2026-10-14T03:00:00Z');
  });
  it('keeps the non-empty notes, newest first, five at most', () => {
    const many = Array.from({ length: 8 }, (_, i) => rep(`r${i}`, 'a', 'spam', `2026-10-14T0${i}:00:00Z`, i === 3 ? '' : `note ${i}`));
    expect(groupReports(many)[0]!.notes).toEqual(['note 7', 'note 6', 'note 5', 'note 4', 'note 2']);
  });
  it('nothing in, nothing out', () => {
    expect(groupReports([])).toEqual([]);
  });
});

describe('planCarryOver', () => {
  const facts: SetFacts[] = [
    { id: 'set2', cardIds: new Set(['a', 'b', 'c']), tribes: ['beast', 'dragon'] },
    { id: 'set3', cardIds: new Set(['a', 'b']), tribes: ['beast'] },
  ];
  const row = (id: string, patch: Partial<GuideTagRow> = {}): GuideTagRow =>
    ({ id, sets: ['set2'], tribes: ['beast'], pairsWith: [], core: ['a'], enablers: [], mentions: [], ...patch });

  it('a guide carries over when every card and tribe it names is in the new set', () => {
    const plan = planCarryOver([row('ok'), row('ok2', { core: ['a'], enablers: ['b'] })], 'set3', facts);
    expect(plan).toEqual({ carry: ['ok', 'ok2'], stay: 0, already: 0 });
  });
  it('one missing Core, Enabler or named card keeps it behind; so does a tribe or crossover tribe not on the roster', () => {
    const plan = planCarryOver([
      row('core', { core: ['c'] }), row('enab', { enablers: ['c'] }), row('ment', { mentions: ['c'] }),
      row('tribe', { tribes: ['dragon'] }), row('pair', { pairsWith: ['dragon'] }),
    ], 'set3', facts);
    expect(plan).toEqual({ carry: [], stay: 5, already: 0 });
  });
  it('a guide that already carries the set is counted, not sent', () => {
    expect(planCarryOver([row('had', { sets: ['set2', 'set3'] }), row('new')], 'set3', facts)).toEqual({ carry: ['new'], stay: 0, already: 1 });
  });
  it('an unknown target set carries nothing', () => {
    expect(planCarryOver([row('x')], 'set9', facts)).toEqual({ carry: [], stay: 1, already: 0 });
  });
});

describe('batches', () => {
  it('cuts a list into runs of at most the size, in order', () => {
    expect(batches([1, 2, 3, 4, 5], 2)).toEqual([[1, 2], [3, 4], [5]]);
    expect(batches([], 2)).toEqual([]);
  });
});
