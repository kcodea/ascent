import { describe, expect, it } from 'vitest';
import { recordsToBundled, renderBundledGuides, type BundledSourceGuide } from './bundledSource';
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
});
