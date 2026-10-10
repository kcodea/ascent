// @vitest-environment jsdom
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { Container, Ticker, UPDATE_PRIORITY } from 'pixi.js';

vi.mock('./sfx', async (orig) => {
  const real = await orig<typeof import('./sfx')>();
  return { ...real, playTailedClip: () => null };
});

import { pixiFx } from './pixiFx';
import { fxFaultStats, guardAppRender, isTickerStalled, resetFxFaultStats, reviveTicker } from './pixiAppSafety';

/**
 * THE DEAD FX LAYER (owner report 2026-10-10: "sometimes i have an issue with like... my hero power or spell
 * targeting animation completely not loading, and neither will other pixi effects").
 *
 * Root cause, reproduced live: a short-lived Pixi app (the hero ceremony, the crate opener, the attack preview)
 * was destroyed with `releaseGlobalResources: true`. That emptied Pixi's shared global pools under the live board
 * overlay, whose next filter pass threw. Pixi's Ticker does not catch a listener's throw: it stops requesting
 * frames but stays `started`, so every effect was dead for the session. See `pixiAppSafety.ts`.
 */

const SRC = __dirname;

function walk(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) walk(p, out);
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) out.push(p);
  }
  return out;
}

describe('no Pixi app releases the shared global pools', () => {
  const files = walk(SRC);

  it('nothing passes releaseGlobalResources: true or destroy(true) outside pixiAppSafety.ts', () => {
    const offenders: string[] = [];
    for (const f of files) {
      if (f.endsWith('pixiAppSafety.ts')) continue;
      const s = readFileSync(f, 'utf8');
      if (/releaseGlobalResources\s*:\s*true/.test(s) || /\.destroy\(\s*true\s*,\s*\{\s*children/.test(s)) offenders.push(f);
    }
    expect(offenders).toEqual([]);
  });

  it('every file that creates an Application tears it down through destroyPixiApp (the bounded-context rule)', () => {
    // Long-lived singletons that are never torn down (one context each, for the whole session).
    const singletons = ['wipeFx.ts'];
    const missing: string[] = [];
    for (const f of files) {
      const s = readFileSync(f, 'utf8');
      if (!/new Application\(/.test(s)) continue;
      if (singletons.some((n) => f.endsWith(n))) continue;
      if (!/destroyPixiApp\(/.test(s)) missing.push(f);
    }
    expect(missing).toEqual([]);
  });
});

describe('a throw can no longer kill a ticker', () => {
  beforeEach(() => resetFxFaultStats());

  it('guardAppRender: a render that throws is counted and the rest of the frame still runs', () => {
    const ticker = new Ticker();
    ticker.autoStart = false;
    const calls: string[] = [];
    const app = {
      ticker,
      render(): void { calls.push('render'); throw new TypeError("Cannot read properties of null (reading '2')"); },
    };
    ticker.add(app.render, app, UPDATE_PRIORITY.LOW); // what Pixi's TickerPlugin does
    ticker.add(() => { calls.push('after'); }, undefined, UPDATE_PRIORITY.UTILITY);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    // Unguarded: the throw escapes the ticker pass (in the browser this is where the loop stopped for good).
    expect(() => ticker.update(performance.now() + 16)).toThrow();
    guardAppRender(app as never, 'test');
    calls.length = 0;
    expect(() => ticker.update(performance.now() + 32)).not.toThrow();
    expect(calls).toEqual(['render', 'after']);
    expect(fxFaultStats().faults).toBe(1);
    err.mockRestore();
    ticker.destroy();
  });

  it('reviveTicker restarts a ticker in the dead state (started, no frame requested)', () => {
    const ticker = new Ticker();
    ticker.autoStart = false;
    ticker.add(() => {});
    const raf = vi.spyOn(globalThis, 'requestAnimationFrame').mockImplementation(() => 7);
    ticker.start();
    // Simulate Pixi's `_tick` after a throw: the frame id was cleared and never re-requested.
    (ticker as unknown as { _requestId: number | null })._requestId = null;
    expect(isTickerStalled(ticker)).toBe(true);
    ticker.start(); // the old wake(): a no-op on a dead ticker
    expect(isTickerStalled(ticker)).toBe(true);
    const err = vi.spyOn(console, 'error').mockImplementation(() => {});
    reviveTicker(ticker, 'test');
    expect(isTickerStalled(ticker)).toBe(false);
    expect(ticker.started).toBe(true);
    expect(fxFaultStats().faults).toBe(1);
    err.mockRestore();
    raf.mockRestore();
    ticker.destroy();
  });
});

// HEADLESS SEAM, as in fx/auxCanvasClearsOnRetire.test.ts: seed the controller's private fields through a cast and
// drive the real `update` / render listeners by hand.
type Seam = {
  app: unknown;
  layer: Container | null;
  ready: boolean;
  aim: unknown;
  extraUpdaters: unknown[];
  aboveApp: unknown;
  aboveLayer: Container | null;
  aboveShowing: boolean;
  update: (ticker: { deltaMS: number }) => void;
  renderAbove: () => void;
};
const seam = (): Seam => pixiFx as unknown as Seam;

describe('per-def isolation on the board overlay', () => {
  let err: ReturnType<typeof vi.spyOn>;
  beforeEach(() => {
    resetFxFaultStats();
    err = vi.spyOn(console, 'error').mockImplementation(() => {});
    const ticker = { remove(): void {}, stop(): void {}, start(): void {}, add(): void {} };
    seam().app = { renderer: {}, canvas: { style: {} }, ticker };
    seam().layer = new Container();
    seam().ready = true;
  });
  afterEach(() => {
    seam().aim = null;
    seam().extraUpdaters.length = 0;
    seam().aboveApp = null;
    seam().aboveLayer = null;
    seam().aboveShowing = false;
    seam().app = null;
    seam().layer = null;
    seam().ready = false;
    err.mockRestore();
  });

  it('an aim def that throws drops only the aim; the tick and the other effects carry on', () => {
    const root = new Container();
    seam().layer!.addChild(root);
    let destroyed = 0;
    const bad = { update(): void { throw new Error('bad aim layer'); }, destroy(): void { destroyed++; } };
    seam().aim = {
      root, insts: [bad], containers: [new Container()], specs: [], sink: { setHead(): void {}, setAim(): void {} },
      defId: 'spell-target', spawnedDefId: 'spell-target', from: { x: 0, y: 0 }, to: { x: 10, y: 10 }, onTarget: false,
    };
    let ticks = 0;
    seam().extraUpdaters.push(() => { ticks++; });
    expect(() => seam().update({ deltaMS: 16 })).not.toThrow();
    expect(seam().aim).toBeNull(); // dropped, so the next setAimLine respawns it clean
    expect(destroyed).toBe(1);
    expect(fxFaultStats().faults).toBe(1);
    // The next frame is clean, and a def play keeps ticking.
    expect(() => seam().update({ deltaMS: 16 })).not.toThrow();
    expect(ticks).toBe(2);
    expect(fxFaultStats().faults).toBe(1);
  });

  it('a throwing above-slot render is caught instead of escaping into the ticker', () => {
    const above = new Container();
    above.addChild(new Container());
    seam().aboveLayer = above;
    seam().aboveApp = { renderer: { render(): void { throw new Error('poisoned pool'); } }, stage: new Container() };
    expect(() => seam().renderAbove()).not.toThrow();
    expect(fxFaultStats().faults).toBe(1);
  });
});
