import { describe, it, expect } from 'vitest';
import { WATCHER_PULSE_DEF_ID, watcherPixiReady } from './watcherPulse';

describe('watcherPulse channel decision', () => {
  it('uses Pixi only when the def is committed AND the renderer can play', () => {
    expect(watcherPixiReady(true, true)).toBe(true);
    expect(watcherPixiReady(true, false)).toBe(false);
    expect(watcherPixiReady(false, true)).toBe(false);
    expect(watcherPixiReady(false, false)).toBe(false);
  });
  it('names the owner-authored def', () => {
    expect(WATCHER_PULSE_DEF_ID).toBe('watcher-pulse');
  });
});
