import { describe, expect, it } from 'vitest';
import { contentRangeTotal, pullProblems, recordsToBundled, renderBundledGuides, type BundledSourceGuide } from './bundledSource';
import type { GuideRecord } from './types';

const rec = (id: string, patch: Partial<GuideRecord> = {}): GuideRecord => ({
  id, slug: null, authorId: null, byline: 'Team Ascent', official: true, published: true, publishedAt: null, hidden: false, sets: ['set2'], tribes: ['beast'],
  pairsWith: [], iconCard: 'grim', title: `Guide ${id}`, tagline: 'A tagline', body: 'A body.', core: ['grim'], enablers: [], mentions: [], aliases: {},
  forkedFrom: null, forkedTitle: null, forkedByline: null, bookmarkCount: 0, sortOrder: 0, revision: 1, createdAt: '', updatedAt: '', ...patch,
});
const one: BundledSourceGuide = {
  id: 'set2-beast-sunmane', set: 'set2', tribes: ['beast'], pairsWith: [], iconCard: 'b2_sunmane', title: "Sunmane's pack", tagline: 'Rally.',
  body: 'It says "go". A back\\slash too.', core: ['b2_sunmane'], enablers: [], mentions: [], aliases: {},
};
const BS = String.fromCharCode(92);

describe('recordsToBundled', () => {
  it('keeps only Team Ascent guides, in their order, keyed by slug when there is one', () => {
    const out = recordsToBundled([
      rec('z', { sortOrder: 2 }), rec('p', { official: false, authorId: 'u-1', byline: 'Mike' }),
      rec('a', { sortOrder: 0, slug: 'set2-beast-sunmane' }), rec('m', { sortOrder: 1, sets: ['set3', 'set2'] }),
    ]);
    expect(out.map((g) => [g.id, g.set])).toEqual([['set2-beast-sunmane', 'set2'], ['m', 'set3'], ['z', 'set2']]);
  });
  it('a guide with no set is left out (it could not be shown anywhere)', () => {
    expect(recordsToBundled([rec('a', { sets: [] })])).toEqual([]);
  });
  it('guides with the same order come out by id', () => {
    expect(recordsToBundled([rec('b'), rec('a'), rec('c')]).map((g) => g.id)).toEqual(['a', 'b', 'c']);
  });
});

describe('renderBundledGuides', () => {
  const text = renderBundledGuides([one, { ...one, id: 'second', pairsWith: ['dragon'], mentions: ['x'], aliases: { Oona: 'grim' } }]);
  it('is a TypeScript module that exports the data and its type, and says it is generated', () => {
    expect(text).toContain('export interface BundledGuide');
    expect(text).toContain('export const BUNDLED_GUIDE_DATA: readonly BundledGuide[] = [');
    expect(text).toContain('npm run guides:pull');
    expect(text.trimEnd().endsWith('];')).toBe(true);
  });
  it('writes strings in single quotes with quotes and backslashes escaped', () => {
    expect(text).toContain("title: 'Sunmane" + BS + "'s pack',");
    expect(text).toContain("body: 'It says \"go\". A back" + BS + BS + "slash too.',");
  });
  it('leaves out the optional parts when they are empty and writes them when they are not', () => {
    const first = text.slice(text.indexOf("id: 'set2-beast-sunmane'"), text.indexOf("id: 'second'"));
    expect(first).not.toContain('pairsWith');
    expect(first).not.toContain('mentions');
    expect(first).not.toContain('aliases');
    const second = text.slice(text.indexOf("id: 'second'"));
    expect(second).toContain("pairsWith: ['dragon'],");
    expect(second).toContain("mentions: ['x'],");
    expect(second).toContain("aliases: { 'Oona': 'grim' },");
  });
  it('is plain ASCII whatever the guide text holds', () => {
    const odd = renderBundledGuides([{ ...one, title: 'Caf' + String.fromCharCode(0xe9) + ' ' + String.fromCodePoint(0x1f525) }]);
    expect([...odd].every((ch) => ch.codePointAt(0)! < 128)).toBe(true);
    expect(odd).toContain("title: 'Caf" + BS + 'u00e9 ' + BS + 'ud83d' + BS + "udd25',");
  });
  it('the same guides always give the same text', () => {
    expect(renderBundledGuides([one])).toBe(renderBundledGuides([one]));
  });
  it('writes control characters as escapes, so a line break or tab in a string cannot break the file', () => {
    const c = (n: number): string => String.fromCharCode(n);
    const raw = 'a' + c(10) + 'b' + c(9) + 'c' + c(0) + 'd' + c(0x2028) + 'e' + c(0x7f);
    const out = renderBundledGuides([{ ...one, title: raw }]);
    expect(out).toContain("title: 'a" + BS + 'u000ab' + BS + 'u0009c' + BS + 'u0000d' + BS + 'u2028e' + BS + "u007f',");
    expect(out.includes(c(10) + 'b')).toBe(false);
    expect(out.includes(c(9))).toBe(false);
    expect(out.includes(c(0))).toBe(false);
  });
  it('says in its header that it is also the seed the team imports', () => {
    expect(text).toContain('importBuiltIns');
  });
});

describe('pullProblems', () => {
  const row = (r: GuideRecord): { id: string } => ({ id: r.id });
  it('is empty when every row was read and every Team Ascent guide has a set', () => {
    const a = rec('a'), b = rec('b', { official: false, sets: [] });
    expect(pullProblems([row(a), row(b)], [a, b])).toEqual([]);
  });
  it('names a row that could not be read, including one with no readable id', () => {
    const a = rec('a');
    const out = pullProblems([row(a), { id: 'bad-1' }, { title: 'no id' }, null], [a]);
    expect(out).toEqual(['3 of 4 guides could not be read: bad-1, (no id), (no id)']);
  });
  it('names a Team Ascent guide that is in no set (by slug when it has one), and ignores a player guide with none', () => {
    const a = rec('a', { sets: [], slug: 'set2-x' }), b = rec('b', { sets: [] }), p = rec('p', { official: false, sets: [] });
    expect(pullProblems([a, b, p].map(row), [a, b, p])).toEqual(['2 Team Ascent guides are in no set, so they could not be shown: set2-x, b']);
  });
  it('reports both problems', () => {
    const a = rec('a', { sets: [] });
    expect(pullProblems([row(a), { id: 'x' }], [a])).toHaveLength(2);
  });
});

describe('contentRangeTotal', () => {
  it('reads the total after the slash', () => {
    expect(contentRangeTotal('0-10/11')).toBe(11);
    expect(contentRangeTotal('0-0/1')).toBe(1);
    expect(contentRangeTotal(' 0-24/25 ')).toBe(25);
  });
  it('reads an empty answer', () => {
    expect(contentRangeTotal('*/0')).toBe(0);
  });
  it('is null when the header is missing, has no total, or is not a range', () => {
    for (const bad of [null, undefined, '', '0-10/*', '0-10', 'garbage', '0-10/x', '/11', '0-10/11/12', '-1/5']) expect(contentRangeTotal(bad), String(bad)).toBeNull();
  });
});
