/**
 * Long Animation Frame attribution (perf 2026-10-10): a > 50 ms frame's scripts and its style/layout/paint tail are
 * recorded as `loaf:*` breakdown spans, so the monitor can name what an otherwise unlabelled long task was.
 */
import { describe, expect, it } from 'vitest';
import { loafScriptLabel, perfMonitor } from './perfMonitor';
import { isKnownLabel, shortName } from './perfNames';

describe('loaf labels', () => {
  it('names a script by its invoker type and function, trimming URLs', () => {
    expect(loafScriptLabel({ duration: 30, startTime: 0, invokerType: 'event-listener', invoker: 'DOMWindow.onpointermove', sourceFunctionName: 'onMove' })).toBe('loaf:event-listener:onMove');
    expect(loafScriptLabel({ duration: 30, startTime: 0, invokerType: 'user-callback', invoker: 'https://x.test/assets/index-abc.js' })).toBe('loaf:user-callback:index-abc.js');
    expect(loafScriptLabel({ duration: 30, startTime: 0 })).toBe('loaf:script:anonymous');
  });

  it('every loaf label is a known family with a readable short name', () => {
    expect(isKnownLabel('loaf:style-layout-paint')).toBe(true);
    expect(isKnownLabel('loaf:event-listener:onMove')).toBe(true);
    expect(shortName('loaf:style-layout-paint')).toBe('style + layout + paint');
    expect(shortName('loaf:event-listener:onMove')).toBe('slow frame · event-listener:onMove');
  });

  it('is a no-op while the monitor is off', () => {
    expect(() => perfMonitor.noteLongAnimationFrame({ startTime: 0, duration: 80, styleAndLayoutStart: 40, scripts: [{ startTime: 1, duration: 30 }] })).not.toThrow();
  });
});
