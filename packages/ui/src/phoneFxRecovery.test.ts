// @vitest-environment jsdom
/**
 * Phone FX fixes (owner 2026-10-26 on his iPhone: "Lots of animations aren't showing on phone, and general performance
 * is abysmal. How do we optimize this??").
 *
 * R-PHONE-FX-CTX-01: a WebGL context loss rebuilds the FX layer (a restored context brings `generateTexture` textures
 * back EMPTY, so every spark and glow vanished for the session). The falling gate's phone-skipped particles are counted
 * in the FX ledger. R-PHONE-CHARGE-30HZ-01 / R-PHONE-RUN-PAINT-01: the phone-only paint relief.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Application } from 'pixi.js';
import { CONTEXT_RECOVER_MS, contextRecoveryCount, destroyPixiApp, watchContextLoss } from './pixiAppSafety';

const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');

function fakeApp(): { app: Application; canvas: HTMLCanvasElement } {
  const canvas = document.createElement('canvas');
  const app = { canvas, destroy: vi.fn() } as unknown as Application;
  return { app, canvas };
}

afterEach(() => { vi.useRealTimers(); vi.restoreAllMocks(); });

describe('a WebGL context loss rebuilds the layer (R-PHONE-FX-CTX-01)', () => {
  it('rebuilds once on the restore', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, canvas } = fakeApp();
    const rebuild = vi.fn();
    const before = contextRecoveryCount();
    watchContextLoss(app, 'test', rebuild);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    canvas.dispatchEvent(new Event('webglcontextrestored'));
    await vi.advanceTimersByTimeAsync(1);
    expect(rebuild).toHaveBeenCalledTimes(1);
    await vi.advanceTimersByTimeAsync(CONTEXT_RECOVER_MS * 2); // the still-lost timer was cancelled
    expect(rebuild).toHaveBeenCalledTimes(1);
    expect(contextRecoveryCount()).toBe(before + 1);
  });

  it('rebuilds when the context stays lost (the browser never restores it)', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, canvas } = fakeApp();
    const rebuild = vi.fn();
    watchContextLoss(app, 'test', rebuild);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RECOVER_MS - 10);
    expect(rebuild).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(20);
    expect(rebuild).toHaveBeenCalledTimes(1);
  });

  it('a teardown losing its context on purpose is never rebuilt', async () => {
    vi.useFakeTimers();
    vi.spyOn(console, 'warn').mockImplementation(() => {});
    const { app, canvas } = fakeApp();
    const rebuild = vi.fn();
    watchContextLoss(app, 'test', rebuild);
    destroyPixiApp(app);
    canvas.dispatchEvent(new Event('webglcontextlost'));
    await vi.advanceTimersByTimeAsync(CONTEXT_RECOVER_MS * 2);
    expect(rebuild).not.toHaveBeenCalled();
  });

  it('every long-lived FX layer passes a rebuild: the board overlay and its slots, the wipe, the gate', () => {
    const fx = src('pixiFx.ts');
    expect(fx.split("() => this.scheduleRebuild('WebGL context lost')); //").length - 1).toBe(3);
    expect(src('wipeFx.ts')).toMatch(/watchContextLoss\(app, 'wipeFx', \(\) => this\.recover\(\)\)/);
    expect(src('rankedGate/gateFx.ts')).toMatch(/watchContextLoss\(app, 'gateFx', \(\) => this\.recover\(\)\)/);
  });
});

describe('the falling gate on a phone', () => {
  it('its particles stay desktop-only (no extra FX context on a phone), and the FX ledger counts each skip', () => {
    const r = src('Recruit.tsx');
    expect(r).toMatch(/else fxNote\('gate:land', 'phone-gate'\)/);
    expect(r).toMatch(/else fxNote\('gate:portal', 'phone-gate'\)/);
  });
});

describe('phone paint relief (R-PHONE-CHARGE-30HZ-01, R-PHONE-RUN-PAINT-01)', () => {
  it('the charge glyph repaints at ~30 Hz on a phone and every frame on desktop', () => {
    expect(src('Recruit.tsx')).toMatch(/if \(!PHONE_GPU \|\| now - last >= PHONE_CHARGE_PAINT_MS\)/);
  });
  it('the Gold pill and Inspect scrim lose their backdrop blur, and the rail its will-change, on phones only', () => {
    const t = src('touchUi.css');
    expect(t).toMatch(/html\[data-touch-ui\]\[data-phone-gpu\] \.goldpill \{ -webkit-backdrop-filter: none; backdrop-filter: none; \}/);
    expect(t).toMatch(/html\[data-touch-ui\]\[data-phone-gpu\] \.inspect-ov::before \{[^}]*backdrop-filter: none/);
    expect(t).toMatch(/html\[data-touch-ui\]\[data-phone-gpu\] :is\(\.lobbyrail, \.lobbyrailhead\) \{ will-change: auto; \}/);
  });
});
