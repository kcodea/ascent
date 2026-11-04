import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { MODE_FAMILIES, PARTY_MODES, familyOf, modeHasSettings, partyFamilies, partyModeOf, partyModes } from './partyModes';

const here = (f: string): string => readFileSync(fileURLToPath(new URL(f, import.meta.url)), 'utf8');

describe('party home prototype', () => {
  it('every kit name the party home files import is exported by the kit (a missing export crashed START once)', async () => {
    const kit = await import('./kit');
    const files = ['./PartyHome.tsx', './ModeOptions.tsx', './PhPrompts.tsx', './shell/PhFriends.tsx'];
    for (const f of files) {
      const m = here(f).match(/import \{([^}]+)\} from '(?:\.\/kit|\.\.\/kit)';/);
      if (!m) continue;
      for (const name of m[1]!.split(',').map((x) => x.trim()).filter(Boolean)) {
        expect(kit, `${f} imports ${name}`).toHaveProperty(name);
      }
    }
  });
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
    expect(css).not.toMatch(/cursor:(?!\s*url\(')/); // only the gauntlet URL form (CLAUDE.md)
    expect(css).not.toMatch(/infinite/);
    const strings = [...tsx.matchAll(/'([^'\n]*)'/g), ...PARTY_MODES.flatMap((m) => [[m.desc, m.desc], [m.label, m.label]])].map((x) => x[1] ?? '');
    for (const s of strings) { expect(s).not.toMatch(/—|\s--\s/); expect(s).not.toMatch(/\b(Oath|climb)\b/i); }
  });
});

describe('mode families (owner 2026-11-04: fewer top tabs, sub-modes on the side)', () => {
  it('the top row is five families and every mode belongs to exactly one', () => {
    expect(MODE_FAMILIES.map((f) => f.label)).toEqual(['Ranked', 'Versus', 'Practice', 'Gauntlet', 'Learn']);
    for (const m of PARTY_MODES) expect(MODE_FAMILIES.filter((f) => f.subs.some((x) => x.id === m.id))).toHaveLength(1);
    expect(familyOf('vduos').id).toBe('versus');
  });
  it('a build without Versus keeps Ranked (Solo only) and drops the Versus family', () => {
    const fams = partyFamilies(partyModes({ versus: false, dev: false }));
    expect(fams.map((f) => f.id)).toEqual(['ranked', 'practice', 'gauntlet', 'learn']);
    expect(fams[0]!.subs.map((x) => x.id)).toEqual(['ranked']);
  });
  it('a family with sub-modes has a settings tab', () => {
    expect(modeHasSettings('ranked')).toBe(true);
    expect(modeHasSettings('learn')).toBe(false);
  });
});
