import { describe, expect, it } from 'vitest';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import { ANCIENT_HERO_THEMES, resolveAncientHeroSignature, resolveAncientHeroTheme, THEME_FIELDS, THEMED_HEROES } from './ancientHeroThemes';
import { ACCENT_PARTS, MEDAL_LAYERS } from './ancientHeroBloom';

/** The awakening's per-hero theme (owner 2026-09-26): Indy gold, the Warden steel blue, the Auctioneer royal purple,
 *  Lord of the Risen pale jade; every other hero the default (and the generic medallion entrance). */
describe('resolveAncientHeroTheme', () => {
  const cfg = ANCIENTS_DEFAULTS as unknown as Record<string, unknown>;
  const colours = (h: (typeof THEMED_HEROES)[number]): Record<string, string> =>
    Object.fromEntries(THEME_FIELDS.map((f) => [f, ANCIENT_HERO_THEMES[h][f]]));
  it('an unknown / unthemed hero falls back to the default theme', () => {
    expect(resolveAncientHeroTheme('no-such-hero', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme(undefined, cfg)).toEqual(ANCIENT_HERO_THEMES.default);
    expect(resolveAncientHeroTheme('default', cfg)).toEqual(ANCIENT_HERO_THEMES.default);
  });
  it('every themed hero resolves to its own colours', () => {
    expect(THEMED_HEROES).toEqual(['indy', 'warden', 'myra', 'risen']);
    for (const h of THEMED_HEROES) expect(resolveAncientHeroTheme(h, cfg), h).toEqual(colours(h));
    expect(resolveAncientHeroTheme('indy', cfg).curtainInner).toBe('#a0620f');
    expect(resolveAncientHeroTheme('warden', cfg).curtainInner).toBe('#4a87bb');
    expect(resolveAncientHeroTheme('myra', cfg).curtainInner).toBe('#7b2887');
    expect(resolveAncientHeroTheme('risen', cfg).curtainInner).toBe('#5d8f7b');
  });
  it('Risen is not the default teal', () => {
    expect(resolveAncientHeroTheme('risen', cfg)).not.toEqual(ANCIENT_HERO_THEMES.default);
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

describe('resolveAncientHeroSignature', () => {
  it('the default (and any unthemed hero) has no signature: the generic medallion entrance', () => {
    expect(resolveAncientHeroSignature(undefined)).toBeNull();
    expect(resolveAncientHeroSignature('default')).toBeNull();
    expect(resolveAncientHeroSignature('no-such-hero')).toBeNull();
  });
  it('each themed hero has its own accent + medallion entrance', () => {
    expect(resolveAncientHeroSignature('indy')).toEqual({ label: 'Indy', accent: 'glints', medal: 'gild' });
    expect(resolveAncientHeroSignature('warden')).toEqual({ label: 'the Warden', accent: 'shell', medal: 'seal' });
    expect(resolveAncientHeroSignature('myra')).toEqual({ label: 'the Auctioneer', accent: 'rings', medal: 'thump' });
    expect(resolveAncientHeroSignature('risen')).toEqual({ label: 'Lord of the Risen', accent: 'wisps', medal: 'rise' });
    for (const h of THEMED_HEROES) {
      const s = resolveAncientHeroSignature(h)!;
      expect(ACCENT_PARTS[s.accent], h).toBeGreaterThan(0);
      for (const l of MEDAL_LAYERS[s.medal]) expect(l, h).toMatch(/^(in|out)$/);
    }
  });
});

describe('playHeroBloom', () => {
  /** A stand-in for the medallion wrapper: every part records the one-shot it is given. */
  function fakeWrap(parts: number): { wrap: Element; calls: KeyframeAnimationOptions[] } {
    const calls: KeyframeAnimationOptions[] = [];
    const el = (): { animate: (k: Keyframe[], o: KeyframeAnimationOptions) => void } => ({ animate: (_k, o) => { calls.push(o); } });
    const wrap = {
      querySelector: () => el(),
      querySelectorAll: () => Array.from({ length: parts }, el),
    } as unknown as Element;
    return { wrap, calls };
  }
  it('every hero finishes inside the eruption + title hold, one shot, never looping', async () => {
    const { playHeroBloom } = await import('./ancientHeroBloom');
    const t = { eruptionMs: 520, titleHoldMs: 1500 };
    for (const h of [undefined, ...THEMED_HEROES]) {
      const sig = resolveAncientHeroSignature(h);
      const { wrap, calls } = fakeWrap(sig ? ACCENT_PARTS[sig.accent] : 0);
      playHeroBloom(wrap, sig, t);
      expect(calls.length, String(h)).toBe(sig ? 1 + MEDAL_LAYERS[sig.medal].length + ACCENT_PARTS[sig.accent] : 1);
      for (const o of calls) {
        expect(o.iterations ?? 1, String(h)).toBe(1);
        expect(Number(o.delay ?? 0) + Number(o.duration), String(h)).toBeLessThanOrEqual(t.eruptionMs + t.titleHoldMs);
      }
    }
  });
});
