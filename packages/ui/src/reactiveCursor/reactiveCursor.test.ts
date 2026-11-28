import { existsSync, readFileSync, readdirSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import type { CardDef, Tribe } from '@game/core';
import { TRIBES } from '@game/core';
import { CURSOR_STATES, TRIBES_WITH_CURSOR_ART, applyTribeCursor, dominantTribe, tribeCursorPath, type CursorState } from './reactiveCursor';

// R-CURSOR-REACTIVE-01: the Reactive Cursor's tribe pick.
const def = (id: string, tribe: Tribe, extra: Partial<CardDef> = {}): CardDef => ({ id, name: id, tribe, ...extra }) as CardDef;
const CARDS: Record<string, CardDef> = {
  drake: def('drake', 'dragon'),
  wyrm: def('wyrm', 'dragon'),
  wolf: def('wolf', 'beast'),
  boar: def('boar', 'beast'),
  brewer: def('brewer', 'dwarf'),
  hybrid: def('hybrid', 'demon', { tribe2: 'mech' }),
  imp: def('imp', 'demon'),
  bolt: def('bolt', 'mech'),
  paragon: def('paragon', 'neutral', { universalTribe: true }),
  peasant: def('peasant', 'neutral'),
};
const b = (...ids: string[]) => ids.map((cardId) => ({ cardId }));
const pick = (board: Parameters<typeof dominantTribe>[0]) => dominantTribe(board, CARDS, TRIBES);

describe('dominantTribe (R-CURSOR-REACTIVE-01)', () => {
  it('picks the tribe with the most minions', () => {
    expect(pick(b('wolf', 'drake', 'wyrm', 'brewer'))).toBe('dragon');
  });
  it('a tie goes to the tied tribe whose minion is furthest left', () => {
    expect(pick(b('brewer', 'wolf', 'drake', 'boar', 'wyrm'))).toBe('beast');
    expect(pick(b('drake', 'wolf', 'boar', 'wyrm'))).toBe('dragon');
  });
  it('an empty or all-Neutral board picks nothing (the gauntlet)', () => {
    expect(pick([])).toBeNull();
    expect(pick(b('peasant', 'peasant'))).toBeNull();
  });
  it('a dual-tribe minion counts for both; its printed first tribe settles a tie it holds', () => {
    expect(pick(b('hybrid', 'bolt'))).toBe('mech');
    expect(pick(b('hybrid'))).toBe('demon');
    expect(pick(b('hybrid', 'imp', 'bolt'))).toBe('demon');
  });
  it('a spell-added tribe counts', () => {
    expect(pick([{ cardId: 'wolf', addedTribes: ['mech'] }, { cardId: 'bolt' }])).toBe('mech');
  });
  it('an All-types minion counts for every tribe but settles no tie itself', () => {
    expect(pick(b('paragon', 'wolf'))).toBe('beast');
    expect(pick(b('paragon', 'brewer', 'drake'))).toBe('dwarf');
    expect(pick(b('paragon'))).toBeNull();
    expect(pick([{ cardId: 'peasant', universalTribe: true }, { cardId: 'drake' }])).toBe('dragon');
  });
});

describe('one cursor source', () => {
  it('no CSS rule names a cursor url except the three :root custom properties in styles.css', () => {
    const src = fileURLToPath(new URL('../', import.meta.url));
    const walk = (d: string): string[] => readdirSync(d, { withFileTypes: true }).flatMap((e) =>
      e.isDirectory() ? walk(join(d, e.name)) : e.name.endsWith('.css') ? [join(d, e.name)] : []);
    const raw: string[] = [];
    for (const f of walk(src)) {
      readFileSync(f, 'utf8').split('\n').forEach((line, i) => {
        if (/cursor:\s*url\(/.test(line)) raw.push(`${f}:${i + 1}`);
      });
    }
    expect(raw, 'use var(--cursor-default | open | closed) so the Reactive Cursor reaches it').toEqual([]);
    const styles = readFileSync(join(src, 'styles.css'), 'utf8');
    for (const s of Object.keys(CURSOR_STATES)) expect(styles).toMatch(new RegExp(`--cursor-${s}: url\\(`));
  });
});

describe('tribe cursor art', () => {
  it('every tribe listed as having art has all three files', () => {
    const pub = fileURLToPath(new URL('../../../../apps/web/public/', import.meta.url));
    for (const t of TRIBES_WITH_CURSOR_ART) {
      for (const s of Object.keys(CURSOR_STATES) as CursorState[]) {
        expect(existsSync(pub + tribeCursorPath(t, s, '')), `${t} ${s}`).toBe(true);
      }
    }
  });
  it('a tribe with no art leaves the gauntlet (no custom properties written)', () => {
    const set = new Map<string, string>();
    const root = { style: { setProperty: (k: string, v: string) => set.set(k, v), removeProperty: (k: string) => set.delete(k) } } as unknown as HTMLElement;
    set.set('--cursor-open', 'stale');
    const noArt = TRIBES.find((t) => t !== 'neutral' && !TRIBES_WITH_CURSOR_ART.includes(t))!;
    applyTribeCursor(noArt, root, '/');
    expect(set.size).toBe(0);
  });
});
