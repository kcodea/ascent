// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE TEAMMATE SWAP RE-RENDERS IN PLACE (owner 2026-10-29, "Option A"; R-DUOS-VIEW-NOREMOUNT-01).
 *
 * Watching my teammate puts THEIR run in the store. The recruit screen used to be keyed on the run's identity, so every
 * swap unmounted and rebuilt the whole board (the hitch). Its key now holds through a teammate view, and what the remount
 * used to reset is reset on the swap render instead (screenSwap.ts). These pin both halves: the key, and the resets.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act, useEffect, useLayoutEffect } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { mount, type Mounted } from './renderedText.mount';
import { heldScreenKey, screenIdOf, useScreenSwapped, useSwapRef, useSwapState } from './screenSwap';

describe('the mount key (Game.tsx)', () => {
  it('holds my run\'s key while my teammate\'s screen is on, and follows the live key otherwise', () => {
    expect(heldScreenKey('mine', 'theirs', true)).toBe('mine');
    expect(heldScreenKey('mine', 'theirs', false)).toBe('theirs');
    // Back from the teammate view: the store holds my run again, so the live key IS the held one.
    expect(heldScreenKey('mine', 'mine', false)).toBe('mine');
  });
  it('the run on screen is identified by seed, hero and run id', () => {
    expect(screenIdOf({ seed: 7, heroId: 'warden', runId: 'r1' })).toBe('7:warden:r1');
    expect(screenIdOf({ seed: 0, heroId: 'warden', runId: 'spectate:m:p2' })).not.toBe(screenIdOf({ seed: 7, heroId: 'warden', runId: 'r1' }));
  });
});

/** A miniature recruit screen: one FX sequence watcher, one transient animation state, one in-flight timer. */
interface Log { fired: number[]; cleanups: number; flashes: string[] }
let setFlashNow: (v: Set<string>) => void = () => undefined;
function Screen({ id, seq, log }: { id: string; seq: number; log: Log }): JSX.Element {
  const swapped = useScreenSwapped(id);
  const prevSeq = useSwapRef(seq, swapped);
  useEffect(() => {
    if (seq === prevSeq.current) return;
    prevSeq.current = seq;
    log.fired.push(seq);
  }, [seq]);
  const [flash, setFlash] = useSwapState<Set<string>>(() => new Set(), swapped);
  useLayoutEffect(() => { log.flashes.push([...flash].join(',')); });
  useEffect(() => () => { log.cleanups += 1; }, [id]);
  setFlashNow = setFlash;
  return <div data-flash={[...flash].join(',')} />;
}

let m: Mounted | null = null;
afterEach(() => { m?.unmount(); m = null; });

describe('what the remount used to reset (screenSwap.ts)', () => {
  it('a sequence watcher fires on a real bump, never on the jump between two runs', () => {
    const log: Log = { fired: [], cleanups: 0, flashes: [] };
    m = mount(<Screen id="mine" seq={3} log={log} />);
    m.render(<Screen id="mine" seq={4} log={log} />);
    expect(log.fired).toEqual([4]);
    // Into my teammate's screen: their seq (41) is not an action of theirs that just happened.
    m.render(<Screen id="theirs" seq={41} log={log} />);
    expect(log.fired).toEqual([4]);
    // A real action of theirs while I watch does fire.
    m.render(<Screen id="theirs" seq={42} log={log} />);
    expect(log.fired).toEqual([4, 42]);
    // Back to mine: my seq (4) is not a new action either, though it differs from theirs.
    m.render(<Screen id="mine" seq={4} log={log} />);
    expect(log.fired).toEqual([4, 42]);
  });

  it('transient animation state is back at rest on the swap render, before anything is painted with it', () => {
    const log: Log = { fired: [], cleanups: 0, flashes: [] };
    m = mount(<Screen id="mine" seq={1} log={log} />);
    m.render(<Screen id="mine" seq={1} log={log} />);
    // My board has a flourish in flight on b5…
    act(() => { setFlashNow(new Set(['b5'])); });
    expect(m.container.querySelector('div')!.dataset.flash).toBe('b5');
    log.flashes.length = 0;
    // …and my teammate's b5 is a different card: no commit of their screen ever carries it.
    m.render(<Screen id="theirs" seq={9} log={log} />);
    expect(log.flashes).toEqual(['']);
    expect(m.container.querySelector('div')!.dataset.flash).toBe('');
  });

  it('a cleanup keyed on the screen runs on the swap, as an unmount used to', () => {
    const log: Log = { fired: [], cleanups: 0, flashes: [] };
    m = mount(<Screen id="mine" seq={1} log={log} />);
    m.render(<Screen id="mine" seq={2} log={log} />);
    expect(log.cleanups).toBe(0);
    m.render(<Screen id="theirs" seq={2} log={log} />);
    expect(log.cleanups).toBe(1);
    m.render(<Screen id="mine" seq={2} log={log} />);
    expect(log.cleanups).toBe(2);
  });
});

describe('the wiring (source pins)', () => {
  const src = (f: string): string => readFileSync(join(__dirname, f), 'utf8');
  it('Recruit is keyed on the held key; the StatusBar and the EmoteLayer stay on the live one', () => {
    const game = src('Game.tsx');
    expect(game).toMatch(/runKeyRef\.current = heldScreenKey\(runKeyRef\.current, liveRunKey, watchingMate\)/);
    expect(game).toMatch(/<Recruit key=\{runKey\} \/>/);
    expect(game).toMatch(/<StatusBar key=\{`sb:\$\{liveRunKey\}`\} \/>/);
    expect(game).toMatch(/<EmoteLayer key=\{`em:\$\{liveRunKey\}`\} \/>/);
  });
  it('no recruit-screen ref or state is seeded from the run without resetting on a swap', () => {
    // A new FX watcher written as `useRef(run.someSeq)` would fire for the jump between my run and my teammate's. The
    // only plain `useRef(run.…)` allowed is one re-assigned on the very next line (a live mirror, not a snapshot).
    const lines = src('Recruit.tsx').split('\n');
    const bad = lines.flatMap((l, i) => {
      const m2 = /const (\w+) = useRef(?:<[^>]*>)?\(run\./.exec(l) ?? /const \[\w+, \w+\] = useState(?:<[^>]*>)?\(run\./.exec(l);
      if (!m2) return [];
      if (m2[1] && lines[i + 1]?.trim().startsWith(`${m2[1]}.current = `)) return [];
      return [`${i + 1}: ${l.trim()}`];
    });
    expect(bad).toEqual([]);
  });
  it('the rows, the FLIP runner, the drag layer and the overlays are keyed on the screen', () => {
    const r = src('Recruit.tsx');
    for (const id of ['shop', 'board', 'hand', 'overlays']) expect(r).toContain(`<PerfProfiler key={screenId} id="render:recruit:${id}">`);
    expect(r).toContain('<RowFlip key={screenId} ');
    expect(r).toContain('<DragOverlay key={screenId} ');
  });
  it('the teammate portrait keeps one identity across the swap (its mount measures the hero disc: a forced layout)', () => {
    const hud = src('versus/VersusHud.tsx');
    expect(hud).toContain('<DuosMateDock key="dock" watching />');
    expect(hud).toContain('<DuosMateDock key="dock" watching={false} ');
  });
});
