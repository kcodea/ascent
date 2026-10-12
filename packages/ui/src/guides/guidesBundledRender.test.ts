import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { renderBundledGuides } from '../../../guides/src/bundledSource';
import { BUNDLED_GUIDE_DATA, type BundledGuide } from './guides.bundled';

/**
 * `npm run guides:pull` REWRITES guides.bundled.ts. This pins that what it writes is read back as the same guides:
 * the built-in guides as they are today are rendered, the array is evaluated, and it equals the data it came from.
 */
describe('the built-in guides survive being regenerated', () => {
  it('rendering today\'s built-in guides and reading the result back gives the same guides', () => {
    const text = renderBundledGuides(BUNDLED_GUIDE_DATA.map((g) => ({
      id: g.id, set: g.set, tribes: [...g.tribes], pairsWith: [...(g.pairsWith ?? [])], iconCard: g.iconCard, title: g.title, tagline: g.tagline,
      body: g.body, core: [...g.core], enablers: [...g.enablers], mentions: [...(g.mentions ?? [])], aliases: { ...(g.aliases ?? {}) },
    })));
    const start = text.indexOf('= [') + 2;
    const end = text.lastIndexOf('];') + 1;
    // The array literal is plain JavaScript (no type syntax inside it), so it can be evaluated as it stands.
    const back = new Function(`return ${text.slice(start, end)};`)() as BundledGuide[];
    const norm = (g: BundledGuide): unknown => ({ ...g, pairsWith: g.pairsWith ?? [], mentions: g.mentions ?? [], aliases: g.aliases ?? {} });
    expect(back.length).toBe(BUNDLED_GUIDE_DATA.length);
    expect(back.length).toBeGreaterThan(0);
    expect(back.map(norm)).toEqual(BUNDLED_GUIDE_DATA.map(norm));
  });
});

describe('the pull script asks for the columns the client asks for', () => {
  const read = (rel: string): string => readFileSync(new URL(rel, import.meta.url), 'utf8');
  const columnsIn = (text: string, name: string): string => {
    const m = new RegExp(`${name} = '([^']+)'`).exec(text);
    expect(m, `${name} not found`).not.toBeNull();
    return m![1]!.replace(/\s+/g, '');
  };
  it('GUIDE_COLUMNS in guidesRemote.ts equals COLUMNS in guides-pull.ts (spaces aside)', () => {
    const client = columnsIn(read('./guidesRemote.ts'), 'GUIDE_COLUMNS');
    const script = columnsIn(read('../../../tools/src/guides-pull.ts'), 'COLUMNS');
    expect(script).toBe(client);
  });
});
