import { describe, expect, it } from 'vitest';
import { HEROES } from '@game/sim';
import { ANCIENTS_DEFAULTS } from './ancientsConfig';
import {
  ANCIENT_HERO_THEMES, BLOOM_STYLES, DEFAULT_THEMED_HEROES, isThemedHero, resolveAncientHeroSignature, resolveAncientHeroTheme, STYLE_FAMILY,
  THEME_FIELDS, THEMED_HEROES, type AncientHeroSignature,
} from './ancientHeroThemes';
import { bloomMarkup, playHeroBloom } from './ancientHeroBloom';

/** The awakening's per-hero theme (owner 2026-09-26): every hero wears its own colours and one of the nine bloom
 *  styles (or a one-off); an unknown hero wears the default (and the generic medallion entrance). */
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

describe('every hero has a bloom style', () => {
  it('every hero in HEROES resolves to a theme with a valid style (none left on the default unintentionally)', () => {
    for (const h of HEROES) {
      if (DEFAULT_THEMED_HEROES.includes(h.id)) continue;
      expect(isThemedHero(h.id), `${h.id} has no awakening theme`).toBe(true);
      const sig = resolveAncientHeroSignature(h.id)!;
      expect(BLOOM_STYLES, h.id).toContain(sig.style);
      expect(bloomMarkup(sig), h.id).not.toBeNull();
    }
  });
  it('the theme table names only real heroes, and the tuner label is the hero’s display name', () => {
    const byId = new Map(HEROES.map((h) => [h.id, h.name]));
    for (const h of THEMED_HEROES) {
      expect(byId.has(h), `${h} is not a hero`).toBe(true);
      expect(ANCIENT_HERO_THEMES[h].label, h).toBe(byId.get(h));
    }
  });
  it('every style is used by at least one hero', () => {
    const used = new Set(THEMED_HEROES.map((h) => ANCIENT_HERO_THEMES[h].style));
    for (const s of BLOOM_STYLES) expect(used.has(s), `${s} (${STYLE_FAMILY[s]}) has no hero`).toBe(true);
  });
});

describe('resolveAncientHeroSignature', () => {
  it('the default (and any unthemed hero) has no signature: the generic medallion entrance', () => {
    expect(resolveAncientHeroSignature(undefined)).toBeNull();
    expect(resolveAncientHeroSignature('default')).toBeNull();
    expect(resolveAncientHeroSignature('no-such-hero')).toBeNull();
    expect(bloomMarkup(null)).toBeNull();
  });
  it('the approved four keep their look: style, knobs and the exact markup they had', () => {
    expect(resolveAncientHeroSignature('indy')).toEqual({ label: 'Indy', style: 'coinStrike', knobs: { baked: true } });
    expect(resolveAncientHeroSignature('warden')).toEqual({ label: 'Warden', style: 'glassShell', knobs: { baked: true, medal: 'seal' } });
    expect(resolveAncientHeroSignature('myra')).toEqual({ label: 'Auctioneer', style: 'strikeRings', knobs: { medal: 'thump', rhythm: 'shout', count: 3 } });
    expect(resolveAncientHeroSignature('risen')).toEqual({ label: 'Lord of the Risen', style: 'spiritRise', knobs: { baked: true } });
    const mk = (h: string): unknown => { const m = bloomMarkup(resolveAncientHeroSignature(h))!; return { ...m, layers: m.layers.map((l) => [l.name, l.cls, l.parts.length]) }; };
    expect(mk('indy')).toEqual({ wrapCls: 'acc-glints med-gild', medal: 'gild', out: ['anc-medal-fx anc-medal-gild'], in: ['anc-medal-fx anc-medal-gild-in'], layers: [['glints', undefined, 5]] });
    expect(mk('warden')).toEqual({ wrapCls: 'acc-shell med-seal', medal: 'seal', out: [], in: [], layers: [['shell', undefined, 2]] });
    expect(mk('myra')).toEqual({ wrapCls: 'acc-rings med-thump', medal: 'thump', out: ['anc-medal-fx anc-medal-thump'], in: [], layers: [['rings', undefined, 3]] });
    expect(mk('risen')).toEqual({ wrapCls: 'acc-wisps med-rise', medal: 'rise', out: ['anc-medal-fx anc-medal-rise'], in: [], layers: [['wisps', undefined, 14]] });
  });
  it('a style preview keeps the hero but drops knobs that belong to its own style', () => {
    expect(resolveAncientHeroSignature('indy', 'cardFan')).toEqual({ label: 'Indy', style: 'cardFan', knobs: {} });
    expect(resolveAncientHeroSignature('indy', 'coinStrike')).toEqual({ label: 'Indy', style: 'coinStrike', knobs: { baked: true } });
    expect(resolveAncientHeroSignature(undefined, 'vines')).toEqual({ label: 'Default', style: 'vines', knobs: {} });
  });
});

/** A tiny stand-in DOM built from `bloomMarkup`: every element records the one-shots it is given. */
interface FakeEl {
  classes: Set<string>;
  parent?: FakeEl;
  children: FakeEl[];
  classList: { contains: (c: string) => boolean };
  animate: (k: Keyframe[], o: KeyframeAnimationOptions) => void;
  querySelector: (s: string) => FakeEl | null;
  querySelectorAll: (s: string) => FakeEl[];
}
function fakeDom(sig: AncientHeroSignature | null): { wrap: Element; calls: { k: Keyframe[]; o: KeyframeAnimationOptions }[] } {
  const calls: { k: Keyframe[]; o: KeyframeAnimationOptions }[] = [];
  const el = (cls: string, parent?: FakeEl): FakeEl => {
    const e: FakeEl = {
      classes: new Set(cls.split(/\s+/).filter(Boolean)), parent, children: [],
      classList: { contains: (c) => e.classes.has(c) },
      animate: (k, o) => { calls.push({ k, o }); },
      querySelector: (s) => e.querySelectorAll(s)[0] ?? null,
      querySelectorAll: (s) => {
        const tokens = s.trim().split(/\s+/).map((t) => t.split('.').filter(Boolean));
        const matches = (x: FakeEl, t: string[]): boolean => t.every((c) => x.classes.has(c));
        const out: FakeEl[] = [];
        const walk = (x: FakeEl): void => {
          for (const c of x.children) {
            if (matches(c, tokens[tokens.length - 1]!)) {
              let ok = true;
              let up = c.parent;
              for (let i = tokens.length - 2; i >= 0; i--) {
                while (up && up !== e && !matches(up, tokens[i]!)) up = up.parent;
                if (!up || up === e) { ok = false; break; }
                up = up.parent;
              }
              if (ok) out.push(c);
            }
            walk(c);
          }
        };
        walk(e);
        return out;
      },
    };
    parent?.children.push(e);
    return e;
  };
  const mk = bloomMarkup(sig);
  const wrap = el(`anc-gate-medalwrap ${mk?.wrapCls ?? ''}`);
  for (const c of mk?.out ?? []) el(c, wrap);
  const medal = el('anc-gate-medal', wrap);
  for (const c of mk?.in ?? []) el(c, medal);
  for (const l of mk?.layers ?? []) {
    const layer = el(`anc-acc anc-acc-${l.name} ${l.cls ?? ''}`, wrap);
    l.parts.forEach((p, i) => el(`anc-acc-p p${i} ${p.cls ?? ''}`, layer));
  }
  return { wrap: wrap as unknown as Element, calls };
}

describe('playHeroBloom', () => {
  const t = { eruptionMs: 520, titleHoldMs: 1500 };
  const check = (label: string, sig: AncientHeroSignature | null): number => {
    const { wrap, calls } = fakeDom(sig);
    playHeroBloom(wrap, sig, t);
    for (const { k, o } of calls) {
      expect(o.iterations ?? 1, label).toBe(1);
      expect(Number.isFinite(Number(o.duration)), label).toBe(true);
      expect(Number(o.delay ?? 0) + Number(o.duration), label).toBeLessThanOrEqual(t.eruptionMs + t.titleHoldMs);
      // Motion is transform / opacity only (the one sanctioned pseudo-element is still transform / opacity).
      for (const f of k) for (const p of Object.keys(f)) expect(['opacity', 'transform', 'offset', 'easing'], `${label}: ${p}`).toContain(p);
    }
    return calls.length;
  };
  it('every hero finishes inside the eruption + title hold, one shot, transform / opacity only', () => {
    expect(check('default', null)).toBe(1);
    for (const h of THEMED_HEROES) {
      const n = check(h, resolveAncientHeroSignature(h));
      expect(n, `${h} plays its accent`).toBeGreaterThan(1);
    }
  });
  it('so does every style previewed on every hero', () => {
    for (const h of THEMED_HEROES) for (const s of BLOOM_STYLES) expect(check(`${h}/${s}`, resolveAncientHeroSignature(h, s))).toBeGreaterThan(1);
  });
  it('the approved four play exactly the animations they did before the styles refactor', () => {
    const count = (h: string): number => { const sig = resolveAncientHeroSignature(h); const { wrap, calls } = fakeDom(sig); playHeroBloom(wrap, sig, t); return calls.length; };
    expect(count('indy')).toBe(1 + 2 + 5); // medallion, sheen + rim flash, five glints
    expect(count('warden')).toBe(1 + 2); // medallion, shell + shine
    expect(count('myra')).toBe(1 + 1 + 3); // medallion, strike ring, three shock rings
    expect(count('risen')).toBe(1 + 1 + 14); // medallion, Rise dome, fourteen wisps
  });
});
