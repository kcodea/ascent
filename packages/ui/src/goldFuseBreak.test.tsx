// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from 'vitest';
import { act, useRef } from 'react';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const played: string[] = [];
vi.mock('./fx/playDef', () => ({
  canPlayDefs: () => true,
  playDef: (id: string) => { played.push(id); },
}));

import { mount, type Mounted } from './renderedText.mount';
import { FUSE_BREAK_PUNCH_MS, FUSE_BREAK_SNAP_MS, fuseBroke, useGoldFuseBreak } from './goldFuseBreak';

/**
 * THE GOLD FUSE BREAK (owner ask 2026-11-01, R-TIMER-FUSE-02): "add an animation for when the gold fuse breaks and the
 * timer starts". It plays once, on a crossing SEEN while the plaque is mounted, and never on a restore of a turn whose
 * clock is already running.
 */
function Probe({ goal, spent }: { goal: number; spent: number }) {
  const bar = useRef<HTMLSpanElement>(null);
  const phase = useGoldFuseBreak(goal, spent, bar);
  return <span ref={bar} data-phase={phase} />;
}
const phaseOf = (m: Mounted): string | null => m.container.querySelector('span')!.getAttribute('data-phase');

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; played.length = 0; vi.useRealTimers(); });

describe('fuseBroke', () => {
  it('breaks only when the spend rises from under the threshold to it, at the same threshold', () => {
    expect(fuseBroke({ goal: 7, spent: 6 }, { goal: 7, spent: 7 })).toBe(true);
    expect(fuseBroke({ goal: 3, spent: 0 }, { goal: 3, spent: 3 }), 'one buy can jump it').toBe(true);
    expect(fuseBroke({ goal: 7, spent: 5 }, { goal: 7, spent: 6 })).toBe(false);
    expect(fuseBroke({ goal: 7, spent: 7 }, { goal: 7, spent: 7 }), 'already lit').toBe(false);
    expect(fuseBroke({ goal: 0, spent: 0 }, { goal: 10, spent: 10 }), 'a fuse appearing already paid (Practice ∞ to 1x)').toBe(false);
    expect(fuseBroke({ goal: 10, spent: 6 }, { goal: 7, spent: 7 }), 'a threshold change').toBe(false);
    expect(fuseBroke({ goal: 0, spent: 0 }, { goal: 0, spent: 0 }), 'no fuse').toBe(false);
  });
});

describe('useGoldFuseBreak', () => {
  it('a crossing while mounted plays snap (with the spark), then punch, then rests', () => {
    vi.useFakeTimers();
    m = mount(<Probe goal={7} spent={4} />);
    expect(phaseOf(m)).toBe('idle');
    m.render(<Probe goal={7} spent={7} />);
    expect(phaseOf(m)).toBe('snap');
    expect(played).toEqual(['gold-fuse-break']);
    act(() => { vi.advanceTimersByTime(FUSE_BREAK_SNAP_MS); });
    expect(phaseOf(m)).toBe('punch');
    act(() => { vi.advanceTimersByTime(FUSE_BREAK_PUNCH_MS); });
    expect(phaseOf(m)).toBe('idle');
    expect(FUSE_BREAK_SNAP_MS + FUSE_BREAK_PUNCH_MS, 'short: about 600-900 ms').toBeGreaterThanOrEqual(600);
    expect(FUSE_BREAK_SNAP_MS + FUSE_BREAK_PUNCH_MS).toBeLessThanOrEqual(900);
  });

  it('a RESTORE of an already-lit turn (mounted past the threshold) never plays it, and more Gold later does not either', () => {
    m = mount(<Probe goal={7} spent={7} />);
    expect(phaseOf(m)).toBe('idle');
    m.render(<Probe goal={7} spent={7} />);
    expect(phaseOf(m)).toBe('idle');
    expect(played).toEqual([]);
  });

  it('a new turn re-arms it (the spend resets to 0, then crosses again)', () => {
    vi.useFakeTimers();
    m = mount(<Probe goal={5} spent={5} />);
    m.render(<Probe goal={5} spent={0} />);
    expect(phaseOf(m)).toBe('idle');
    m.render(<Probe goal={5} spent={5} />);
    expect(phaseOf(m)).toBe('snap');
  });
});

describe('the plaque wiring', () => {
  const src = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'Recruit.tsx'), 'utf8');
  it('ShopTimer drives the break off the run\'s Gold and keeps the bar up while it snaps', () => {
    expect(src).toContain('const fuseBreak = useGoldFuseBreak(goal, goldSpent, fuseBarRef);');
    expect(src).toContain('<span className="gclock gfb" aria-hidden="true">');
    expect(src).toContain("className={`sc-v${fuseBreak === 'punch' ? ' gfb-punch' : ''}`}");
  });
  it('the plaque hover tip names this run\'s threshold (7 / 5 / 3 by medal), in plain words', () => {
    expect(src).toContain('`Gold Fuse: the timer starts once you spend ${goal} Gold this turn.`');
    expect(src).toContain("' Practice only: pick 1 to 4× for a longer timer (1× matches ranked), or ∞ for no timer.'");
    expect(src).not.toContain('pick 1–4×');
  });
  it('the CSS animates transform and opacity only, and nothing loops', () => {
    const css = readFileSync(join(dirname(fileURLToPath(import.meta.url)), 'goldFuseBreak.css'), 'utf8');
    expect(css).not.toMatch(/infinite/);
    const frames = css.match(/@keyframes[^{]+\{(?:[^{}]*\{[^}]*\})*[^}]*\}/g) ?? [];
    expect(frames.length).toBeGreaterThan(0);
    for (const f of frames) {
      const props = [...f.matchAll(/([a-z-]+)\s*:/g)].map((x) => x[1]);
      for (const p of props) expect(['transform', 'opacity'], f.slice(0, 30)).toContain(p);
    }
  });
});
