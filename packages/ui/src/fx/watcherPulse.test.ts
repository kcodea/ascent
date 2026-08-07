import { describe, it, expect } from 'vitest';
import { WATCHER_PULSE_DEF_ID, useWatcherPixi } from './watcherPulse';

describe('watcherPulse channel decision', () => {
  it('uses Pixi only when the def is committed AND the renderer can play', () => {
    expect(useWatcherPixi(true, true)).toBe(true);
    expect(useWatcherPixi(true, false)).toBe(false); // renderer not ready → CSS fallback
    expect(useWatcherPixi(false, true)).toBe(false); // def not authored yet → CSS fallback
    expect(useWatcherPixi(false, false)).toBe(false);
  });
  it('names the owner-authored def', () => {
    expect(WATCHER_PULSE_DEF_ID).toBe('watcher-pulse');
  });
});
