import { describe, expect, it } from 'vitest';
import { CARD_ID_RE, GUIDE_LIMITS, REPORT_REASONS, parseGuideRecord } from './types';

const row = {
  id: '11111111-1111-4111-8111-111111111111', slug: 'set2-beast-sunmane', author_id: null, byline: 'Team Ascent',
  official: true, published: true, hidden: false, sets: ['set2'], tribes: ['beast'], pairs_with: [], icon_card: 'b2_sunmane',
  title: 'Sunmane', tagline: 'Rally Attack.', body: 'Body.', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
  forked_from: null, forked_title: null, forked_byline: null, bookmark_count: 0, sort_order: 3, revision: 2,
  created_at: '2026-10-12T00:00:00Z', updated_at: '2026-10-12T00:00:00Z',
};

describe('parseGuideRecord', () => {
  it('reads a full row into camelCase', () => {
    expect(parseGuideRecord(row)).toMatchObject({ id: row.id, slug: 'set2-beast-sunmane', authorId: null, official: true, iconCard: 'b2_sunmane', pairsWith: [], sortOrder: 3, revision: 2 });
  });
  it('never throws on a malformed row: null arrays become empty, junk array members are dropped', () => {
    const r = parseGuideRecord({ ...row, sets: null, tribes: 'beast', enablers: [1, 'ok', null], aliases: ['x'], bookmark_count: 'many' });
    expect(r).toMatchObject({ sets: [], tribes: [], enablers: ['ok'], aliases: {}, bookmarkCount: 0 });
  });
  it('answers null when the row has no id, no title or no write-up', () => {
    expect(parseGuideRecord(null)).toBeNull();
    expect(parseGuideRecord({ ...row, id: 7 })).toBeNull();
    expect(parseGuideRecord({ ...row, title: '' })).toBeNull();
    expect(parseGuideRecord({ ...row, body: undefined })).toBeNull();
  });
  it('the card id pattern takes underscores and hyphens (gemheart-shard is a real id)', () => {
    for (const id of ['b2_sunmane', 'grim', 'gemheart-shard']) expect(CARD_ID_RE.test(id), id).toBe(true);
    for (const id of ['', 'Has Space', 'UPPER', 'a'.repeat(49)]) expect(CARD_ID_RE.test(id), id).toBe(false);
  });
});

describe('step 3 additions', () => {
  it('reads published_at, and null when it was never published', () => {
    const base = { id: 'a', title: 'T', body: 'B' };
    expect(parseGuideRecord({ ...base, published_at: '2026-10-13T10:00:00Z' })!.publishedAt).toBe('2026-10-13T10:00:00Z');
    expect(parseGuideRecord(base)!.publishedAt).toBeNull();
    expect(parseGuideRecord({ ...base, published_at: 7 })!.publishedAt).toBeNull();
  });
  it("carries the owner's limits for bookmarks and the Community list", () => {
    expect(GUIDE_LIMITS.bookmarksPerPlayer).toBe(200);
    expect(GUIDE_LIMITS.communityPage).toBe(20);
    expect(GUIDE_LIMITS.searchQuery).toBe(40);
  });
});

describe('step 4 additions', () => {
  it("carries the owner's report limits and the four reasons", () => {
    expect(GUIDE_LIMITS.reportNote).toBe(300);
    expect(GUIDE_LIMITS.reportsPerDay).toBe(10);
    expect(GUIDE_LIMITS.bookmarkChangesPerHour).toBe(120);
    expect(GUIDE_LIMITS.retagBatch).toBe(200);
    expect([...REPORT_REASONS]).toEqual(['offensive', 'spam', 'impersonation', 'other']);
  });
});
