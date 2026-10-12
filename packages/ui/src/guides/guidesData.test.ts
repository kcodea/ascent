import { describe, expect, it } from 'vitest';
import { CARD_INDEX, poolFor } from '@game/content';
import { CARD_ID_RE, type GuideRecord } from '@game/guides';
import { BUNDLED_GUIDE_DATA } from './guides.bundled';
import { GUIDES, guideMissingIds, guidesFor, toGuide, type Guide } from './guides';

const rec = (patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id: '11111111-1111-4111-8111-111111111111', slug: null, authorId: 'u-1', byline: 'Mike', official: false, published: true, hidden: false,
  sets: ['set2'], tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: 'T', tagline: '', body: 'B', core: ['b2_sunmane'],
  enablers: [], mentions: [], aliases: {}, forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0,
  revision: 3, createdAt: '', updatedAt: '', ...patch,
});
const g = (patch: Partial<Guide>): Guide => ({ ...GUIDES[0]!, ...patch });

describe('the built-in guides as Guide objects', () => {
  it('are the bundled data, in order, as official Team Ascent guides with no server row', () => {
    expect(GUIDES.map((x) => x.id)).toEqual(BUNDLED_GUIDE_DATA.map((x) => x.id));
    for (const [i, x] of GUIDES.entries()) expect(x).toMatchObject({ official: true, published: true, hidden: false, byline: 'Team Ascent', rowId: null, authorId: null, order: i });
  });
  it('each shows in the set it was written for', () => {
    for (const [i, x] of GUIDES.entries()) expect(x.sets, x.id).toContain(BUNDLED_GUIDE_DATA[i]!.set);
  });
  it('every card id in the game fits the wire pattern the server checks', () => {
    for (const id of Object.keys(CARD_INDEX)) expect(CARD_ID_RE.test(id), id).toBe(true);
  });
});

describe('toGuide (a server row -> what the UI draws)', () => {
  it('keeps the slug as the id when there is one, so a built-in keeps its identity once imported', () => {
    expect(toGuide(rec({ slug: 'set2-beast-sunmane' }))).toMatchObject({ id: 'set2-beast-sunmane', rowId: '11111111-1111-4111-8111-111111111111' });
    expect(toGuide(rec())).toMatchObject({ id: '11111111-1111-4111-8111-111111111111', rowId: '11111111-1111-4111-8111-111111111111', revision: 3, byline: 'Mike' });
  });
  it('a guide for a tribe this build has never heard of is dropped, not shown as Neutral', () => {
    expect(toGuide(rec({ tribes: ['merfolk'] }))).toBeNull();
  });
  it("a row whose tribes name 'neutral' means no tribe: it becomes a Neutral guide, or just loses the word", () => {
    expect(toGuide(rec({ tribes: ['neutral'] }))!.tribes).toEqual([]);
    expect(toGuide(rec({ tribes: ['beast', 'neutral'] }))!.tribes).toEqual(['beast']);
  });
  it('an unknown set id and an unknown pairs-with tribe are dropped from the guide; unknown cards are kept (they grey out)', () => {
    const out = toGuide(rec({ sets: ['set2', 'set99'], pairsWith: ['merfolk'], core: ['b2_sunmane', 'card_from_the_future'] }))!;
    expect(out.sets).toEqual(['set2']);
    expect(out.pairsWith).toBeUndefined();
    expect(out.core).toEqual(['b2_sunmane', 'card_from_the_future']);
  });
});

describe('guidesFor over a list', () => {
  it('defaults to the built-in guides and keeps today\'s order', () => {
    expect(guidesFor('set2', ['kobold', 'beast']).map((x) => x.id)).toEqual(['set2-beast-sunmane', 'set2-beast-oona', 'set2-kobold-combat', 'set2-kobold-mountainbond', 'set2-neutral-paragon']);
  });
  it('filters on `sets`, so one guide can show in two sets', () => {
    const list = [g({ id: 'both', sets: ['set2', 'set3'], tribes: [] }), g({ id: 'only2', sets: ['set2'], tribes: [] })];
    expect(guidesFor('set3', [], list).map((x) => x.id)).toEqual(['both']);
    expect(guidesFor('set2', [], list).map((x) => x.id)).toEqual(['both', 'only2']);
  });
  it('groups by first tribe in order of first appearance, Neutral last: a new Beast guide lands beside the Beasts', () => {
    const list = [
      g({ id: 'beast-1', tribes: ['beast'], order: 0 }), g({ id: 'dragon-1', tribes: ['dragon'], order: 1 }),
      g({ id: 'neutral-1', tribes: [], order: 2 }), g({ id: 'beast-2', tribes: ['beast'], order: 3 }),
    ];
    expect(guidesFor('set2', ['beast', 'dragon'], list).map((x) => x.id)).toEqual(['beast-1', 'beast-2', 'dragon-1', 'neutral-1']);
  });
  it("a tribe's guides stay adjacent even when orders tie", () => {
    const list = [
      g({ id: 'b-sunmane', tribes: ['beast'], order: 0, sets: ['set2'] }), g({ id: 'b-oona', tribes: ['beast'], order: 1, sets: ['set2'] }),
      g({ id: 'a-dragon', tribes: ['dragon'], order: 0, sets: ['set2'] }), g({ id: 'a-neutral', tribes: [], order: 0, sets: ['set2'] }),
    ];
    expect(guidesFor('set2', ['beast', 'dragon'], list).map((x) => x.id)).toEqual(['a-dragon', 'b-sunmane', 'b-oona', 'a-neutral']);
  });
  it("a tribe's guides stay adjacent when a tied tribe's id sorts between them (the community Dragon guide case)", () => {
    const list = [
      g({ id: 'b-sunmane', tribes: ['beast'], order: 0, sets: ['set2'] }), g({ id: 'b-oona', tribes: ['beast'], order: 1, sets: ['set2'] }),
      g({ id: 'b-thorn', tribes: ['dragon'], order: 0, sets: ['set2'] }),
    ];
    // Base order by (order, id) is b-sunmane, b-thorn, b-oona: Beast is seen first, so both Beasts come before the Dragon.
    expect(guidesFor('set2', ['beast', 'dragon'], list).map((x) => x.id)).toEqual(['b-sunmane', 'b-oona', 'b-thorn']);
  });
});

describe('guideMissingIds', () => {
  const inSet2 = new Set(poolFor('set2').all.map((c) => c.id));
  const archived = Object.keys(CARD_INDEX).find((id) => !inSet2.has(id))!;
  it('names the Core, Enabler and mentioned cards that are not in the set, or do not exist', () => {
    const guide = g({ core: ['b2_sunmane', archived], enablers: ['no_such_card'], mentions: undefined });
    expect([...guideMissingIds(guide, 'set2')].sort()).toEqual([archived, 'no_such_card'].sort());
  });
  it('is empty (one shared set) for a whole guide, and for every built-in guide in its own set', () => {
    expect(guideMissingIds(GUIDES[0]!, 'set2').size).toBe(0);
    expect(guideMissingIds(GUIDES[0]!, 'set2')).toBe(guideMissingIds(GUIDES[1]!, 'set2'));
    for (const [i, x] of GUIDES.entries()) expect(guideMissingIds(x, BUNDLED_GUIDE_DATA[i]!.set).size, x.id).toBe(0);
  });
  it('the icon never counts (the Imps guide wears a token that is in no set)', () => {
    expect(inSet2.has('impscrap')).toBe(false);
    expect(guideMissingIds(GUIDES.find((x) => x.id === 'set2-demon-imps')!, 'set2').size).toBe(0);
  });
});
