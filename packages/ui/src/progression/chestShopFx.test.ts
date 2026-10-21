// @vitest-environment jsdom
/**
 * THE CHEST SHOP'S CELEBRATIONS (docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md, "Selecting a chest:
 * escalating by tier" and "The toggle"; owner: "make selecting each of the chest rarities increasingly exciting for each
 * rarity", the focus toggle "SUPER noticeable and fun when you toggle it on"):
 *  - each tier's burst clearly out-does the one below (more sparks every step, never fewer rings / reach / motes);
 *  - a burst adds exactly its tier's nodes, replaces the previous burst on the same host (spam never piles up), and
 *    cleans itself up (each node on its `animationend`, the whole burst on a timeout fallback);
 *  - reduced motion adds nothing;
 *  - the CSS carries every flagged effect for exactly the tiers the table names.
 */
import { afterEach, describe, expect, it, vi } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CHEST_TIERS } from './crateFx/chestTiers';
import { sfx } from '../sfx';
import { BURST_CLEANUP_MS, TIER_PICK_FX, TIER_PICK_SOUND, TOGGLE_FX, playPickBurst, playToggleBurst, playToggleSound } from './chestShopFx';

const count = (host: HTMLElement, cls: string): number => host.querySelectorAll(`.${cls}`).length;
const host = (): HTMLElement => { const el = document.createElement('div'); document.body.appendChild(el); return el; };
afterEach(() => { document.body.innerHTML = ''; vi.useRealTimers(); vi.restoreAllMocks(); });

describe('the tier table escalates', () => {
  it('is the spec table', () => {
    expect(TIER_PICK_FX).toEqual({
      standard: { rings: 1, sparks: 6, reach: 50, motes: 0, shake: 'none', flash: false, sweep: false, rays: false },
      rare: { rings: 1, sparks: 10, reach: 65, motes: 0, shake: 'none', flash: false, sweep: false, rays: false },
      epic: { rings: 2, sparks: 18, reach: 90, motes: 6, shake: 'none', flash: false, sweep: true, rays: false },
      legendary: { rings: 2, sparks: 28, reach: 115, motes: 10, shake: 'small', flash: true, sweep: true, rays: true },
      ancient: { rings: 3, sparks: 42, reach: 145, motes: 16, shake: 'big', flash: true, sweep: true, rays: true },
    });
    expect(TOGGLE_FX.sparks).toBe(14);
  });

  it('every tier out-does the one below: more sparks, never fewer rings, reach or motes, never a lost effect', () => {
    const shake = { none: 0, small: 1, big: 2 } as const;
    for (let i = 1; i < CHEST_TIERS.length; i++) {
      const lo = TIER_PICK_FX[CHEST_TIERS[i - 1]!];
      const hi = TIER_PICK_FX[CHEST_TIERS[i]!];
      expect(hi.sparks).toBeGreaterThan(lo.sparks);
      expect(hi.reach).toBeGreaterThan(lo.reach);
      expect(hi.rings).toBeGreaterThanOrEqual(lo.rings);
      expect(hi.motes).toBeGreaterThanOrEqual(lo.motes);
      expect(shake[hi.shake]).toBeGreaterThanOrEqual(shake[lo.shake]);
      for (const k of ['flash', 'sweep', 'rays'] as const) if (lo[k]) expect(hi[k]).toBe(true);
    }
  });
});

describe('playPickBurst', () => {
  it('adds exactly the tier\x27s rings, sparks and motes, and pops the host', () => {
    const h = host();
    playPickBurst(h, 'epic', false);
    expect(count(h, 'cshop-ringfx')).toBe(2);
    expect(count(h, 'cshop-spark')).toBe(18);
    expect(count(h, 'cshop-mote')).toBe(6);
    expect(h.hasAttribute('data-pop')).toBe(true);
  });

  it('a second click replaces the first burst: exactly one burst\x27s worth of nodes', () => {
    const h = host();
    playPickBurst(h, 'epic', false);
    playPickBurst(h, 'epic', false);
    expect(count(h, 'cshop-ringfx')).toBe(2);
    expect(count(h, 'cshop-spark')).toBe(18);
    expect(count(h, 'cshop-mote')).toBe(6);
    playPickBurst(h, 'ancient', false);
    expect(count(h, 'cshop-ringfx')).toBe(3);
    expect(count(h, 'cshop-spark')).toBe(42);
    expect(count(h, 'cshop-mote')).toBe(16);
  });

  it('reduced motion adds nothing and does not pop', () => {
    const h = host();
    playPickBurst(h, 'ancient', true);
    expect(h.children).toHaveLength(0);
    expect(h.hasAttribute('data-pop')).toBe(false);
  });

  it('draws into the host\x27s [data-burst] layer when it has one', () => {
    const h = host();
    const layer = document.createElement('span');
    layer.setAttribute('data-burst', '');
    h.appendChild(layer);
    playPickBurst(h, 'rare', false);
    expect(count(layer, 'cshop-spark')).toBe(10);
    expect(h.hasAttribute('data-pop')).toBe(true);
  });

  it('every node carries its direction / colour vars; Ancient\x27s rings are cyan, pink and opal and its sparks every hue', () => {
    const h = host();
    playPickBurst(h, 'ancient', false);
    const sparks = [...h.querySelectorAll<HTMLElement>('.cshop-spark')];
    expect(sparks.every((s) => s.style.getPropertyValue('--dx') !== '' && s.style.getPropertyValue('--dy') !== '' && s.style.getPropertyValue('--c') !== '')).toBe(true);
    expect(sparks.every((s) => s.style.getPropertyValue('--c').startsWith('hsl('))).toBe(true);
    expect([...h.querySelectorAll<HTMLElement>('.cshop-ringfx')].map((r) => r.style.getPropertyValue('--c'))).toEqual(['#8af5ff', '#ff9bf0', '#f4eeff']);
  });

  it('a node removes itself when its animation ends; the whole burst and the pop clear on the timeout fallback', () => {
    vi.useFakeTimers();
    const h = host();
    playPickBurst(h, 'legendary', false);
    const first = h.querySelector('.cshop-spark')!;
    first.dispatchEvent(new Event('animationend'));
    expect(count(h, 'cshop-spark')).toBe(27);
    vi.advanceTimersByTime(BURST_CLEANUP_MS + 1);
    expect(h.children).toHaveLength(0);
    expect(h.hasAttribute('data-pop')).toBe(false);
  });
});

describe('playToggleBurst', () => {
  it('adds the toggle\x27s sparks, pops the host, and replaces its previous burst', () => {
    const h = host();
    playToggleBurst(h, false);
    expect(count(h, 'cshop-spark')).toBe(14);
    expect(h.hasAttribute('data-pop')).toBe(true);
    playToggleBurst(h, false);
    expect(count(h, 'cshop-spark')).toBe(14);
  });

  it('reduced motion adds nothing', () => {
    const h = host();
    playToggleBurst(h, true);
    expect(h.children).toHaveLength(0);
    expect(h.hasAttribute('data-pop')).toBe(false);
  });
});

describe('the sounds', () => {
  it('a tier pick plays more, bigger cues the higher the tier', () => {
    const calls: Record<string, string[]> = {};
    const names = ['pulse', 'discoverSelect', 'equipmentSheen', 'upgrade', 'triple', 'gemApply'] as const;
    let cur: string[] = [];
    for (const n of names) vi.spyOn(sfx, n).mockImplementation((() => { cur.push(n); }) as never);
    for (const t of CHEST_TIERS) { cur = []; TIER_PICK_SOUND[t](); calls[t] = cur; }
    expect(calls).toEqual({
      standard: ['pulse'],
      rare: ['discoverSelect'],
      epic: ['discoverSelect', 'equipmentSheen'],
      legendary: ['upgrade', 'equipmentSheen'],
      ancient: ['triple', 'gemApply', 'equipmentSheen'],
    });
  });

  it('toggle on is one bright cue; off is the quiet tick', () => {
    const glow = vi.spyOn(sfx, 'triggerGlow').mockImplementation(() => undefined);
    const tick = vi.spyOn(sfx, 'tick').mockImplementation(() => undefined);
    playToggleSound(true);
    expect(glow).toHaveBeenCalledTimes(1);
    expect(tick).not.toHaveBeenCalled();
    playToggleSound(false);
    expect(tick).toHaveBeenCalledTimes(1);
    expect(glow).toHaveBeenCalledTimes(1);
  });
});

describe('the CSS carries each flagged effect for exactly the tiers the table names', () => {
  const css = readFileSync(join(__dirname, 'chestShop.css'), 'utf8');
  const has = (needle: string): boolean => css.includes(needle);
  it.each(CHEST_TIERS)('%s', (t) => {
    const fx = TIER_PICK_FX[t];
    const popped = `.cshop-chest.t-${t}[data-pop]`;
    expect(has(`${popped} .cshop-chest-flash { animation`)).toBe(fx.flash);
    expect(has(`${popped} .cshop-chest-sweep`)).toBe(fx.sweep);
    expect(has(`.cshop-chest.on.t-${t} .cshop-chest-rays {`)).toBe(fx.rays);
    expect(has(`${popped} { animation: cshop-shake-s`)).toBe(fx.shake === 'small');
    expect(has(`${popped} { animation: cshop-shake-l`)).toBe(fx.shake === 'big');
  });
  it('every one-shot and loop sits inside the motion-allowed block', () => {
    const block = css.slice(css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    const outside = css.slice(0, css.indexOf('@media (prefers-reduced-motion: no-preference)'));
    expect(outside).not.toMatch(/animation\s*:/);
    for (const k of ['cshop-hop', 'cshop-hopwiggle', 'cshop-shake-s', 'cshop-shake-l', 'cshop-flash', 'cshop-csweep', 'cshop-ringx', 'cshop-spark', 'cshop-rise', 'cshop-halo', 'cshop-spin', 'cshop-togpop', 'cshop-ring', 'cshop-nmpop', 'cshop-sweep']) {
      expect(css).toContain(`@keyframes ${k} `);
      expect(block).toMatch(new RegExp(`animation: ${k} `));
    }
  });
});
