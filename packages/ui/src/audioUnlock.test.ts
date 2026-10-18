import { describe, expect, it, vi } from 'vitest';
import { installAudioUnlock, needsResume, UNLOCK_GESTURES, type UnlockableContext } from './audioUnlock';

// R-TOUCH-AUDIO-01 (owner 2026-10-18 mobile audit): iOS only unlocks Web Audio on touchend / click, and an iOS
// interruption (a call, Siri, backgrounding) leaves the context "interrupted" until something resumes it.
class Bus extends EventTarget { visibilityState = 'visible'; }
function fakeCtx(state: string): UnlockableContext & { state: string; resume: ReturnType<typeof vi.fn>; fire: () => void } {
  let cb: (() => void) | null = null;
  const c = {
    state,
    resume: vi.fn(() => { c.state = 'running'; return Promise.resolve(); }),
    addEventListener: (_t: 'statechange', f: () => void) => { cb = f; },
    fire: () => cb?.(),
  };
  return c;
}

describe('iOS audio unlock', () => {
  it('needs a resume when suspended or interrupted, not when running or closed', () => {
    expect(needsResume('suspended')).toBe(true);
    expect(needsResume('interrupted')).toBe(true);
    expect(needsResume('running')).toBe(false);
    expect(needsResume('closed')).toBe(false);
  });

  it('listens on touchend and click (the gestures iOS accepts) as well as pointerdown and keydown', () => {
    expect([...UNLOCK_GESTURES].sort()).toEqual(['click', 'keydown', 'pointerdown', 'touchend']);
  });

  it('every gesture creates / resumes the context, and the listeners stay for the next interruption', () => {
    const win = new Bus();
    const doc = new Bus();
    const ctx = fakeCtx('suspended');
    const getCtx = vi.fn((create: boolean) => (create ? ctx : ctx));
    const off = installAudioUnlock(win, doc, getCtx);
    win.dispatchEvent(new Event('touchend'));
    expect(getCtx).toHaveBeenCalledWith(true);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = 'interrupted'; // a phone call
    win.dispatchEvent(new Event('click'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    win.dispatchEvent(new Event('click')); // running: nothing to do
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    off();
    ctx.state = 'suspended';
    win.dispatchEvent(new Event('click'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('coming back to the page (visibilitychange, pageshow) resumes an existing context without creating one', () => {
    const win = new Bus();
    const doc = new Bus();
    const ctx = fakeCtx('interrupted');
    const getCtx = vi.fn((create: boolean) => (create ? ctx : ctx));
    installAudioUnlock(win, doc, getCtx);
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(getCtx).toHaveBeenLastCalledWith(false);
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = 'suspended';
    win.dispatchEvent(new Event('pageshow'));
    expect(ctx.resume).toHaveBeenCalledTimes(2);
    doc.visibilityState = 'hidden';
    ctx.state = 'suspended';
    doc.dispatchEvent(new Event('visibilitychange'));
    expect(ctx.resume).toHaveBeenCalledTimes(2); // hidden: leave it
  });

  it('an interruption reported by the context itself (statechange) is resumed straight away', () => {
    const win = new Bus();
    const ctx = fakeCtx('suspended');
    installAudioUnlock(win, new Bus(), () => ctx);
    win.dispatchEvent(new Event('pointerdown')); // first gesture: watched from here on
    expect(ctx.resume).toHaveBeenCalledTimes(1);
    ctx.state = 'interrupted';
    ctx.fire();
    expect(ctx.resume).toHaveBeenCalledTimes(2);
  });

  it('a refused resume (no gesture yet) never throws', async () => {
    const win = new Bus();
    const ctx = { state: 'suspended', resume: vi.fn(() => Promise.reject(new Error('NotAllowed'))) };
    installAudioUnlock(win, new Bus(), () => ctx);
    expect(() => win.dispatchEvent(new Event('click'))).not.toThrow();
    await Promise.resolve();
  });

  it('sfx.ts installs it (not the old pointerdown/keydown-once warm)', async () => {
    const { readFileSync } = await import('node:fs');
    const { join } = await import('node:path');
    const src = readFileSync(join(__dirname, 'sfx.ts'), 'utf8');
    expect(src).toContain('installAudioUnlock(window, document');
    expect(src).not.toMatch(/removeEventListener\('pointerdown', warm\)/);
  });
});
