// @vitest-environment jsdom
/**
 * R-OUTLINE-ROUND-01 (owner 2026-11-22: "the pointy edge that you fixed on N is the same issue that the numbers during
 * all of the attack animation ceremony have"). A `-webkit-text-stroke` is drawn with mitre joins, so every sharp letter
 * corner (1, 4, 7, N, M, A, W) shoots a spike out of a thick outline, and nothing in CSS rounds the joins of HTML text.
 * The hero attack numbers therefore draw their outline as a ring of hard text-shadow copies (round by construction),
 * never as a stroke. This pins: no stroke and no paint-order in damageFormation.css, the ring's shape, every label
 * wearing it, and the labels staying out of the WebKit `data-wkt` layering (which would switch the ring off).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { afterEach, describe, expect, it } from 'vitest';
import { DamageFormation, formationCapped } from './damageFormation';
import { FORMATION_DEFAULTS, formationPlan } from './formationConfig';
import { formationOf } from './formationFixtures';

const css = readFileSync(join(__dirname, 'damageFormation.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sels: m[1]!.split(',').map((s) => s.trim().replace(/\s+/g, ' ')), body: m[2]! }));
/** Every declaration of `prop` that applies to exactly `sel`, in source order. */
const decls = (sel: string, prop: string): string[] => rules
  .filter((r) => r.sels.includes(sel))
  .flatMap((r) => [...r.body.matchAll(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1]!.trim()));

/** The outlined labels: the five numbers, and the four captions / the stamp. */
const NUMBERS = ['.dform-chip b', '.dform-merge b', '.dform-hero b', '.hblast-total-n', '.hblast-hit'];
const CAPTIONS = ['.dform-merge i', '.dform-hero i', '.hblast-total-l', '.dform-stamp'];

describe('the hero attack numbers wear a ROUND outline (R-OUTLINE-ROUND-01)', () => {
  it('nothing in damageFormation.css strokes text: no text-stroke, no paint-order, no WebKit layering variables', () => {
    expect(css).not.toMatch(/text-stroke/);
    expect(css).not.toMatch(/paint-order/);
    expect(css).not.toMatch(/--wk-(stroke|ts)/);
  });

  it('the ring is 16 hard copies of the letters, evenly spaced on a circle of radius --ol-r', () => {
    const ring = decls(NUMBERS[0]!, '--ol-ring');
    expect(ring).toHaveLength(1);
    const factor = (t: string): number => {
      if (t === '0') return 0;
      if (t === 'var(--ol-r)') return 1;
      const m = t.match(/^calc\(var\(--ol-r\) \* (-?[\d.]+)\)$/);
      if (!m) throw new Error(`not a multiple of --ol-r: ${t}`);
      return Number(m[1]);
    };
    const pts = ring[0]!.split(/,(?![^(]*\))/).map((s) => {
      const m = s.trim().match(/^(0|var\(--ol-r\)|calc\([^)]*\)[^)]*\)) (0|var\(--ol-r\)|calc\([^)]*\)[^)]*\)) 0 var\(--ol-c\)$/);
      if (!m) throw new Error(`not a hard, unblurred copy: ${s.trim()}`);
      return { x: factor(m[1]!), y: factor(m[2]!) };
    });
    expect(pts).toHaveLength(16);
    const angles = pts.map((p) => {
      expect(Math.hypot(p.x, p.y)).toBeCloseTo(1, 3); // on the circle: the outline is the same width all the way round
      return (Math.atan2(p.y, p.x) * 180 / Math.PI + 360) % 360;
    }).sort((a, b) => a - b);
    angles.forEach((a, i) => expect(a).toBeCloseTo(i * 22.5, 1)); // no gap wide enough to flatten a corner
  });

  it('every outlined label draws the ring as its text-shadow and sets its own radius', () => {
    for (const sel of [...NUMBERS, ...CAPTIONS]) {
      expect(decls(sel, 'text-shadow'), sel).toEqual(['var(--ol-ring)']);
      expect(decls(sel, '--ol-ring'), sel).toHaveLength(1);
      const r = decls(sel, '--ol-r');
      expect(r, sel).toHaveLength(1);
      expect(r[0], sel).toMatch(/^calc\(var\(--(df-chip|df-merge|df-hero|df-stamp|hb-total)\) \* 0\.\d+\)$/);
    }
    expect(decls('.hblast-total-flash', 'text-shadow')).toEqual([]); // the flash copy keeps the number's ring
  });

  it('a number keeps its hard drop shadow and its side glow, as a static filter on the outlined shape', () => {
    for (const sel of NUMBERS) {
      const f = decls(sel, 'filter');
      expect(f, sel).toHaveLength(1);
      expect(f[0], sel).toMatch(/^drop-shadow\(0 calc\(.+?\) 0 #1b0f06\) drop-shadow\(0 0 calc\(.+?\) .*var\(--hb-side\).*\)$/);
    }
    expect(css).not.toMatch(/@keyframes|animation\s*:|transition\s*:/); // static paint: nothing here loops
  });

  describe('the DOM', () => {
    afterEach(() => { document.body.innerHTML = ''; });

    it('no formation label carries data-wkt (the WebKit layering would force its text-shadow, the ring, off)', () => {
      const data = formationOf([4, 2, 3, 4, 5], 10);
      const host = document.createElement('div');
      document.body.append(host);
      const fp = formationPlan({ minions: data.minions.length, hero: data.hero !== null, capped: formationCapped(data), reduced: false }, FORMATION_DEFAULTS);
      const f = new DamageFormation({
        data, plan: fp, beats: { reduced: false, k: 0.5, chargeAt: fp.endAt, absorbEnd: fp.endAt + 200, impactAt: fp.endAt + 800, dim: 0 },
        cfg: FORMATION_DEFAULTS, attacker: { x: 100, y: 800 }, defender: { x: 1400, y: 150 }, sideHex: '#ffb627', local: false, host, scale: 1, voices: null,
      });
      for (let t = 0; t <= fp.endAt + 900; t += 40) f.paint(t); // every text rewrite along the way included
      expect(host.querySelectorAll('.dform-chip b, .dform-merge b, .dform-hero b, .hblast-total-n, .hblast-hit').length).toBeGreaterThanOrEqual(8);
      expect(host.querySelectorAll('[data-wkt]')).toHaveLength(0);
      f.remove();
    });
  });
});

/**
 * THE WHOLE UI (owner 2026-11-22, asked whether to extend it past the hero attack numbers: "Yes, extend it"). No label
 * anywhere outlines its text with a text stroke; an outline is the ring (`--ol-ring`), 8 or 16 evenly spaced copies.
 */
describe('no text in the UI is outlined with a text stroke (R-OUTLINE-ROUND-01)', () => {
  const UI = join(__dirname, '..');
  const cssFiles = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
    const p = join(dir, f);
    if (statSync(p).isDirectory()) return cssFiles(p);
    return f.endsWith('.css') ? [p] : [];
  });
  const all = cssFiles(UI).flatMap((f) => [...readFileSync(f, 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .map((m) => ({ file: relative(UI, f).split('\\').join('/'), sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! })));
  const declsOf = (body: string, prop: string): string[] =>
    [...body.matchAll(new RegExp(`(?:^|[;\\s])${prop}\\s*:\\s*([^;]+)`, 'g'))].map((m) => m[1]!.trim());

  it('the only text-stroke declarations left are resets to 0 and the tier badge number\'s tuner stroke (ships at 0)', () => {
    const left: string[] = [];
    for (const r of all) {
      for (const prop of ['-webkit-text-stroke', '-webkit-text-stroke-width', 'text-stroke']) {
        for (const v of declsOf(r.body, prop)) {
          if (/^0(px)?( |$)/.test(v)) continue; // a reset
          left.push(`${r.file} :: ${r.sel} { ${prop}: ${v} }`);
        }
      }
    }
    // NOT an outline under the fill (no paint-order), and 0 wide unless the dev tuner widens it (milestoneFrameConfig.ts).
    expect(left).toEqual(["styles.css :: .badge:not([data-milestone='0']) > .value { -webkit-text-stroke: var(--msnum-stroke-w, 0px) var(--msnum-stroke-color, #000) }"]);
  });

  it('every ring is 8 or 16 hard copies evenly spaced on the circle, and is the FIRST thing in its label\'s text-shadow', () => {
    const factor = (t: string): number => {
      if (t === '0') return 0;
      if (t === 'var(--ol-r)') return 1;
      const m = t.match(/^calc\(var\(--ol-r\) \* (-?[\d.]+)\)$/);
      if (!m) throw new Error(`not a multiple of --ol-r: ${t}`);
      return Number(m[1]);
    };
    const T = String.raw`(0|var\(--ol-r\)|calc\(var\(--ol-r\) \* -?[\d.]+\))`;
    let rings = 0;
    for (const r of all) {
      for (const ring of declsOf(r.body, '--ol-ring')) {
        rings++;
        const where = `${r.file} :: ${r.sel}`;
        const pts = ring.split(/,(?![^(]*\))/).map((s) => {
          const m = s.trim().match(new RegExp(`^${T} ${T} 0 var\\(--ol-c\\)$`));
          if (!m) throw new Error(`${where}: not a hard, unblurred copy: ${s.trim()}`);
          return { x: factor(m[1]!), y: factor(m[2]!) };
        });
        expect([8, 16], where).toContain(pts.length);
        const step = 360 / pts.length;
        const angles = pts.map((p) => {
          expect(Math.hypot(p.x, p.y), where).toBeCloseTo(1, 3);
          return (Math.atan2(p.y, p.x) * 180 / Math.PI + 360) % 360;
        }).sort((a, b) => a - b);
        angles.forEach((a, i) => expect(a, where).toBeCloseTo(i * step, 1));
        // The rule that declares a ring gives it a radius and a colour, and draws it first (above its real shadows).
        expect(declsOf(r.body, '--ol-c').length, where).toBe(1);
        const ts = declsOf(r.body, 'text-shadow');
        expect(ts.length, where).toBe(1);
        expect(ts[0], where).toMatch(/^var\(--ol-ring\)(,|$)/);
      }
    }
    // The formation (1, shared), the announcement, spell bold words, 2 tribe labels, damage floats, power floats,
    // 2 hero-select names, the showcase name, the lobby rail, the party home name, the Collection tiles.
    expect(rings).toBeGreaterThanOrEqual(13);
  });

  it('nothing still writes the old WebKit copy: no data-wkt in any component', () => {
    const src = (dir: string): string[] => readdirSync(dir).flatMap((f) => {
      const p = join(dir, f);
      if (statSync(p).isDirectory()) return src(p);
      return /\.(ts|tsx)$/.test(f) && !/\.test\.tsx?$/.test(f) ? [p] : [];
    });
    const hits = src(UI).filter((f) => /data-wkt|setGlowText/.test(readFileSync(f, 'utf8'))).map((f) => relative(UI, f));
    expect(hits).toEqual([]);
  });
});
