import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import { ANCIENT_HERO_THEMES, resolveAncientHeroTheme } from './ancientHeroThemes';

/** The awakening's per-hero theme (owner 2026-09-26): Indy wears gold, every other hero the default. */
describe('resolveAncientHeroTheme', () => {
  const cfg = ANCIENTS_DEFAULTS as unknown as Record<string, unknown>;
  it('an unknown / unthemed hero falls back to the default theme', () => {
    expect(resolveAncientHeroTheme('no-such-hero', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme(undefined, cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme('default', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
  });
  it('Indy resolves to its gold theme', () => {
    const t = resolveAncientHeroTheme('indy', cfg);
    expect(t).toEqual(ANCIENT_HERO_THEMES.indy);
    expect(t.curtainInner).toBe('#c08a2c');
  });
  it('reads tuned values from the config, per hero', () => {
    const tuned = { ...cfg, curtainInner: '#111111', indyThemeTitleGlow: '#222222' };
    expect(resolveAncientHeroTheme('someone', tuned).curtainInner).toBe('#111111');
    expect(resolveAncientHeroTheme('indy', tuned).titleGlow).toBe('#222222');
    expect(resolveAncientHeroTheme('indy', tuned).curtainInner).toBe('#c08a2c');
  });
});
