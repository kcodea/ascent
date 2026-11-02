import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { PARTY_MODES, partyModeOf, partyModes } from './partyModes';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('party home prototype', () => {
  it('lists every mode, hiding Versus and dev-only modes when their flags are off', () => {
    expect(partyModes({ versus: true, dev: true }).map((m) => m.id)).toEqual(PARTY_MODES.map((m) => m.id));
    const prod = partyModes({ versus: false, dev: false }).map((m) => m.id);
    expect(prod).toEqual(['ranked', 'practice', 'gauntlet', 'learn']);
  });
  it('sizes the party by mode: one card solo, two for Ranked Duos, four for the group modes', () => {
    expect(partyModeOf('ranked').slots).toBe(1);
    expect(partyModeOf('duos').slots).toBe(2);
    expect(partyModeOf('group').slots).toBe(4);
    expect(partyModeOf('duos').ranked && partyModeOf('ranked').ranked).toBe(true);
  });
  it('is DEV only and off by default (production never loads the screen or the shell)', () => {
    const flag = here('./partyHomeFlag.ts');
    expect(flag).toMatch(/if \(!import\.meta\.env\.DEV\) return false;/);
    expect(here('../Title.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/PartyHome'\)\) : null/);
    expect(here('../MenuSidebar.tsx')).toMatch(/import\.meta\.env\.DEV \? lazy\(\(\) => import\('\.\/partyHome\/shell\/PhPageChrome'\)\)/);
  });
  it('keeps to the UI rules: no native tooltips, no bare cursor, no em dashes in player text, no looping animation', () => {
    const tsx = ['./PartyHome.tsx', './ModeOptions.tsx', './PhPrompts.tsx', './kit/index.tsx', './shell/PhTopNav.tsx', './shell/PhFriends.tsx'].map(here).join('\n');
    const css = [here('./partyHome.css'), here('./kit/kit.css'), here('./shell/shell.css')].join('\n');
    // A native tooltip is `title=` on an intrinsic (lower-case) element; the kit's own `title` props are fine.
    expect(tsx).not.toMatch(/<[a-z][a-z0-9]*\s[^>]*\stitle=/);
    expect(css).not.toMatch(/cursor:/);
    expect(css).not.toMatch(/infinite/);
    const strings = [...tsx.matchAll(/'([^'\n]*)'/g), ...PARTY_MODES.flatMap((m) => [[m.desc, m.desc], [m.label, m.label], [m.stub ?? '', m.stub ?? '']])].map((x) => x[1] ?? '');
    for (const s of strings) { expect(s).not.toMatch(/—|\s--\s/); expect(s).not.toMatch(/\b(Oath|climb)\b/i); }
  });
});
