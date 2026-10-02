// @vitest-environment jsdom
/**
 * THE HERO ATTACK CAMERA reaches the FX exactly ONCE (2026-09-29). Since the scaled stage (#1762) the shared
 * above-portrait canvas lives INSIDE `#stage`, and the Collection sandbox's canvas lives inside its own camera box, so
 * the DOM camera already zooms and shakes the FX. Every style also mirrored the camera onto its Pixi root, which applied
 * it twice (a zoom of z² about the focus plus a doubled shake): the FX drifted off the struck portrait by up to about a
 * portrait radius during the push-ins (found by the Banana Cannon, #1839; measured on every style in the real game).
 *
 * Covered here: the shared decision (`fxCanvasRidesCamera` / `heroFxCanvas`), `StageCamera` mirroring only a canvas that
 * does not ride it (and writing the same DOM transform either way), and, for EVERY style on the shared camera, that the
 * impact point maps onto the struck portrait under a zoomed camera in both layouts (canvas inside / outside the camera),
 * and that the camera and the Pixi root are back at rest afterwards.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { Container, Texture } from 'pixi.js';
import { StageCamera, fxCanvasRidesCamera, heroFxCanvas } from './stageCamera';
import { formationOf } from './formationFixtures';
import { fireTexturesFrom } from './pixiFire';
import type { HeroAttackHandle, HeroAttackOptions } from './options';
import { playHeroBlast } from '../heroBlast/heroBlast';
import { playHeroQuake } from '../heroQuake/heroQuake';
import { playHeroArcana } from '../heroArcana/heroArcana';
import { playHeroBlades } from '../heroBlades/heroBlades';
import { playHeroEnraged } from '../heroEnraged/heroEnraged';
import { playHeroPoison } from '../heroPoison/heroPoison';
import { playHeroFrost } from '../heroFrost/heroFrost';
import { playHeroHoly } from '../heroHoly/heroHoly';
import { playHeroFire } from '../heroFire/heroFire';
import { playHeroUndead } from '../heroUndead/heroUndead';
import { playHeroBeast } from '../heroBeast/heroBeast';
import { playHeroBanana } from '../heroBanana/heroBanana';
import { playHeroBleed } from '../heroBleed/heroBleed';
import { playHeroCards } from '../heroCards/heroCards';
import { playHeroStorm } from '../heroStorm/heroStorm';
import { playHeroCoin } from '../heroCoin/heroCoin';
import { playHeroBoomerang } from '../heroBoomerang/heroBoomerang';
import { playHeroBubble } from '../heroBubble/heroBubble';
import { playHeroBackstab } from '../heroBackstab/heroBackstab';
import { playHeroBasketball } from '../heroBasketball/heroBasketball';
import { playHeroStitch } from '../heroStitch/heroStitch';

afterEach(() => { document.body.innerHTML = ''; });

describe('the decision: does the FX canvas already ride the camera?', () => {
  it('true only when the camera element contains the canvas; no canvas yet = the shared overlay, which lives in #stage', () => {
    const cam = document.createElement('div');
    const inside = document.createElement('canvas');
    const outside = document.createElement('canvas');
    cam.appendChild(inside);
    document.body.append(cam, outside);
    expect(fxCanvasRidesCamera(cam, inside)).toBe(true);
    expect(fxCanvasRidesCamera(cam, outside)).toBe(false);
    expect(fxCanvasRidesCamera(null, inside)).toBe(false);
    expect(fxCanvasRidesCamera(cam, null)).toBe(false);
    const stage = document.createElement('div');
    stage.id = 'stage';
    expect(fxCanvasRidesCamera(stage, null)).toBe(true); // pixiFx appends the above canvas into stageHost()
  });

  it('heroFxCanvas: the sandbox canvas when the caller mounts the scene, else the shared above-portrait overlay', () => {
    const host = document.createElement('div');
    const own = document.createElement('canvas');
    host.appendChild(own);
    const overlay = document.createElement('canvas');
    overlay.className = 'pixifx-above pixi-screen';
    document.body.append(host, overlay);
    expect(heroFxCanvas({ mount: () => () => {}, host })()).toBe(own);
    expect(heroFxCanvas({ mount: () => () => {}, host: null, camera: host })()).toBe(own);
    expect(heroFxCanvas({})()).toBe(overlay);
  });
});

describe('StageCamera', () => {
  const setup = (canvasInside: boolean | null) => {
    const el = document.createElement('div');
    const canvas = document.createElement('canvas');
    if (canvasInside) el.appendChild(canvas);
    else document.body.appendChild(canvas);
    document.body.appendChild(el);
    const calls: [number, number, number][] = [];
    const cam = new StageCamera(canvasInside === null ? null : el, { setCamera: (ax, ay, z) => { calls.push([ax, ay, z]); } }, () => canvas);
    return { el, cam, calls };
  };

  it('canvas INSIDE the camera: the DOM moves, the Pixi root is never zoomed (the camera applied once)', () => {
    const { el, cam, calls } = setup(true);
    cam.start();
    cam.apply({ x: 400, y: 300 }, 1.2, 5, -3, 1);
    expect(el.style.transform).toBe('translate(-75.00px, -63.00px) scale(1.2000)');
    expect(cam.mirrorsCamera).toBe(false);
    expect(calls.filter(([, , z]) => z !== 1)).toEqual([]);
    cam.reset();
    expect(el.style.transform).toBe('');
    expect(calls.at(-1)).toEqual([0, 0, 1]);
  });

  it('canvas OUTSIDE the camera: the SAME DOM transform, and the root mirrors it exactly', () => {
    const { el, cam, calls } = setup(false);
    cam.start();
    cam.apply({ x: 400, y: 300 }, 1.2, 5, -3, 1);
    expect(el.style.transform).toBe('translate(-75.00px, -63.00px) scale(1.2000)');
    expect(cam.mirrorsCamera).toBe(true);
    expect(calls.at(-1)![0]).toBeCloseTo(-75, 5);
    expect(calls.at(-1)![1]).toBeCloseTo(-63, 5);
    expect(calls.at(-1)![2]).toBeCloseTo(1.2, 5);
    cam.reset();
    expect(calls.at(-1)).toEqual([0, 0, 1]);
  });

  it('no DOM camera (tests, headless): the mirror is the only camera, so it moves', () => {
    const { cam, calls } = setup(null);
    cam.apply({ x: 400, y: 300 }, 1.2, 0, 0, 1);
    expect(cam.mirrorsCamera).toBe(true);
    expect(calls.at(-1)![2]).toBeCloseTo(1.2, 5);
  });

  it('keeps the base transform (the scaled stage) innermost and restores it exactly', () => {
    const { el, cam } = setup(true);
    el.style.transform = 'scale(0.833333)';
    cam.start();
    cam.apply({ x: 100, y: 100 }, 1.1, 0, 0, 0.833333);
    expect(el.style.transform).toBe('translate(-10.00px, -10.00px) scale(1.1000) scale(0.833333)');
    cam.reset();
    expect(el.style.transform).toBe('scale(0.833333)');
  });
});

// ── every style on the shared camera: the impact point lands on the struck portrait under a zoomed camera ──

const W = Texture.WHITE;
const ARRAYS = new Set(['rocks', 'shards', 'glyphs', 'banana', 'splat', 'pips']);
const FIRE = fireTexturesFrom(W, W, W);
/** Any style's texture set: every key a white texture (the list-valued keys a short list, the shared fire its own set). */
/** A keyed texture set (Card Shark's faces): every key a white texture. */
const ANY_W = new Proxy({} as Record<string, unknown>, { get: (_t, k) => (k === 'then' ? undefined : W) });
const TEX = new Proxy({} as Record<string, unknown>, {
  get: (_t, k) => (k === 'then' ? undefined : k === 'fire' ? FIRE : k === 'cardFaces' ? ANY_W : ARRAYS.has(String(k)) ? [W, W, W, W] : W),
});

type Runner = (o: HeroAttackOptions & { textures?: unknown }) => HeroAttackHandle;
const STYLES: [string, Runner][] = [
  ['blast', playHeroBlast as Runner], ['quake', playHeroQuake as Runner], ['arcana', playHeroArcana as Runner],
  ['blades', playHeroBlades as Runner], ['enraged', playHeroEnraged as Runner], ['poison', playHeroPoison as Runner],
  ['frost', playHeroFrost as Runner], ['holy', playHeroHoly as Runner], ['fire', playHeroFire as Runner],
  ['undead', playHeroUndead as Runner], ['beast', playHeroBeast as Runner], ['banana', playHeroBanana as Runner],
  ['bleed', playHeroBleed as Runner], ['cards', playHeroCards as Runner], ['storm', playHeroStorm as Runner],
  ['coin', playHeroCoin as Runner], ['boomerang', playHeroBoomerang as Runner],
  ['bubble', playHeroBubble as Runner], ['backstab', playHeroBackstab as Runner],
  ['basketball', playHeroBasketball as Runner],
  ['stitch', playHeroStitch as Runner],
];

/** Styles whose camera only PUNCHES (a brief small zoom on each hit, no push-in): Backstab. */
const PUNCH_ONLY = new Set(['backstab']);

/** Parse the camera's `translate(ax, ay) scale(z)` (the frame the DOM shows); null at rest. */
function domCam(el: HTMLElement): { ax: number; ay: number; z: number } | null {
  const m = /translate\((-?[\d.]+)px, (-?[\d.]+)px\) scale\(([\d.]+)\)/.exec(el.style.transform);
  return m ? { ax: +m[1]!, ay: +m[2]!, z: +m[3]! } : null;
}

function play(runner: Runner, canvasInCamera: boolean, total: number, side: 'player' | 'opp') {
  const fns: ((dt: number) => void)[] = [];
  const frames = (fn: (dt: number) => void): (() => void) => { fns.push(fn); return () => { const i = fns.indexOf(fn); if (i >= 0) fns.splice(i, 1); }; };
  const root = new Container();
  const camera = document.createElement('div');
  const host = document.createElement('div');
  const canvas = document.createElement('canvas');
  (canvasInCamera ? camera : host).appendChild(canvas);
  const attackerEl = document.createElement('div');
  const defenderEl = document.createElement('div');
  camera.append(attackerEl, defenderEl);
  document.body.append(camera, host);
  const a = side === 'player' ? { x: 260, y: 860 } : { x: 1640, y: 200 };
  const d = side === 'player' ? { x: 1640, y: 200 } : { x: 260, y: 860 };
  const h = runner({
    formation: formationOf([10, 10, 20], total), total, side, attacker: a, defender: d, defenderRadius: 120, attackerRadius: 120,
    reduced: false, onImpact: () => {}, frames, textures: TEX, sound: false, safety: false,
    mount: (c) => { root.addChild(c); return () => root.removeChild(c); }, host: canvasInCamera ? camera : host, camera, attackerEl, defenderEl,
  });
  return { h, root, camera, d, tick: (ms: number) => { for (let t = 0; t < ms; t += 16) [...fns].forEach((f) => f(16)); }, hooked: () => fns.length };
}

describe('every style: the FX get the camera ONCE (the impact point stays on the struck portrait while zoomed)', () => {
  for (const [style, runner] of STYLES) {
    for (const inside of [true, false]) {
      it(`${style}: canvas ${inside ? 'INSIDE' : 'outside'} the camera, Tier IV, both directions`, () => {
        for (const side of ['player', 'opp'] as const) {
          const r = play(runner, inside, 40, side);
          let zoomed = 0;
          let worst = 0;
          for (let t = 0; t < 20000 && !r.h.done; t += 16) {
            r.tick(16);
            const cam = domCam(r.camera);
            const scene = r.root.children[0];
            if (!cam || cam.z < (PUNCH_ONLY.has(style) ? 1.002 : 1.02) || !scene) continue;
            zoomed++;
            // Where the FX draw the impact point: through the Pixi root, then (canvas inside) through the DOM camera.
            const g = scene.toGlobal(r.d);
            const fx = inside ? { x: cam.ax + cam.z * g.x, y: cam.ay + cam.z * g.y } : g;
            // Where the struck portrait's centre is on screen (it rides the DOM camera).
            const portrait = { x: cam.ax + cam.z * r.d.x, y: cam.ay + cam.z * r.d.y };
            worst = Math.max(worst, Math.hypot(fx.x - portrait.x, fx.y - portrait.y));
          }
          expect(zoomed, `${style} ${side}: the camera pushed in`).toBeGreaterThan(PUNCH_ONLY.has(style) ? 2 : 10);
          // Within 0.2 portrait radius (the DOM transform is written to 2 decimals, so it is ~0 in practice).
          expect(worst, `${style} ${side} (${inside ? 'inside' : 'outside'})`).toBeLessThan(0.2 * 120);
          r.tick(4000);
          expect(r.h.done).toBe(true);
          expect(r.camera.style.transform, `${style}: the camera is reset`).toBe('');
          for (const c of r.root.children) {
            expect(c.scale.x).toBe(1);
            expect(c.position.x).toBe(0);
            expect(c.position.y).toBe(0);
          }
          r.h.cancel();
        }
      });
    }
  }
});
