// @vitest-environment jsdom
/**
 * R-PHONE-SIDEWAYS-01: Android Chrome locks the phone to landscape on the first tap (fullscreen first, then the lock),
 * and a refusal is silent (the turned render stays).
 */
import { describe, expect, it, vi } from 'vitest';
import { installLandscapeLock } from './orientationLock';

describe('installLandscapeLock', () => {
  it('asks for fullscreen then the landscape lock on the first tap only, and swallows a refusal', async () => {
    const lock = vi.fn(() => Promise.reject(new Error('NotSupportedError')));
    const fs = vi.fn(() => Promise.resolve());
    Object.defineProperty(screen, 'orientation', { configurable: true, value: { lock } });
    (document.documentElement as unknown as { requestFullscreen: typeof fs }).requestFullscreen = fs;
    installLandscapeLock();
    expect(fs).not.toHaveBeenCalled();
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
    await Promise.resolve(); await Promise.resolve();
    expect(fs).toHaveBeenCalledTimes(1);
    expect(fs).toHaveBeenCalledWith({ navigationUI: 'hide' });
    expect(lock).toHaveBeenCalledWith('landscape');
    document.body.dispatchEvent(new Event('pointerup', { bubbles: true }));
    expect(fs).toHaveBeenCalledTimes(1); // disarmed until fullscreen is left
  });
});
