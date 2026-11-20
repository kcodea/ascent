import { describe, expect, it } from 'vitest';
import { HEROES } from '@game/sim';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import { ANCIENT_HERO_THEMES, DEFAULT_THEMED_HEROES, isThemedHero, resolveAncientHeroTheme, THEME_FIELDS, THEMED_HEROES } from './ancientHeroThemes';

/** The awakening's per-hero theme (owner 2026-09-26): every hero wears its own colours; an unknown hero wears the
 *  default. (The per-hero bloom styles went with the curtain, owner 2026-11-19.) */
describe('resolveAncientHeroTheme', () => {
  const cfg = ANCIENTS_DEFAULTS as unknown as Record<string, unknown>;
  const colours = (h: (typeof THEMED_HEROES)[number]): Record<string, string> =>
    Object.fromEntries(THEME_FIELDS.map((f) => [f, ANCIENT_HERO_THEMES[h][f]]));
  it('an unknown hero falls back to the default theme', () => {
    expect(resolveAncientHeroTheme('no-such-hero', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme(undefined, cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme('default', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
  });
  it('every themed hero resolves to its own colours, all valid hex', () => {
    for (const h of THEMED_HEROES) {
      expect(resolveAncientHeroTheme(h, cfg), h).toEqual(colours(h));
      for (const f of THEME_FIELDS) expect(ANCIENT_HERO_THEMES[h][f], `${h}.${f}`).toMatch(/^#[0-9a-f]{6}$/);
    }
    expect(resolveAncientHeroTheme('indy', cfg).curtainInner).toBe('#a0620f');
    expect(resolveAncientHeroTheme('warden', cfg).curtainInner).toBe('#4a87bb');
    expect(resolveAncientHeroTheme('myra', cfg).curtainInner).toBe('#7b2887');
    expect(resolveAncientHeroTheme('risen', cfg).curtainInner).toBe('#5d8f7b');
  });
  it('no hero wears the default teal by accident', () => {
    for (const h of THEMED_HEROES) expect(resolveAncientHeroTheme(h, cfg), h).not.toEqual(ANCIENT_HERO_THEMES.default);
  });
  it('reads tuned values from the config, per hero', () => {
    const tuned = { ...cfg, curtainInner: '#111111', indyThemeTitleGlow: '#222222', myraThemeSeamColor: '#333333' };
    expect(resolveAncientHeroTheme('someone', tuned).curtainInner).toBe('#111111');
    expect(resolveAncientHeroTheme('indy', tuned).titleGlow).toBe('#222222');
    expect(resolveAncientHeroTheme('indy', tuned).curtainInner).toBe('#a0620f');
    expect(resolveAncientHeroTheme('myra', tuned).seamColor).toBe('#333333');
    expect(resolveAncientHeroTheme('warden', tuned).curtainInner).toBe('#4a87bb');
  });
});

describe('every hero has an awakening theme', () => {
  it('every hero in HEROES has its own colours (none left on the default unintentionally)', () => {
    for (const h of HEROES) {
      if (DEFAULT_THEMED_HEROES.includes(h.id)) continue;
      expect(isThemedHero(h.id), `${h.id} has no awakening theme`).toBe(true);
    }
  });
  it('the theme table names only real heroes, and the tuner label is the hero’s display name', () => {
    const byId = new Map(HEROES.map((h) => [h.id, h.name]));
    for (const h of THEMED_HEROES) {
      expect(byId.has(h), `${h} is not a hero`).toBe(true);
      expect(ANCIENT_HERO_THEMES[h].label, h).toBe(byId.get(h));
    }
  });
});
