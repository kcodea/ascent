// @vitest-environment jsdom
/**
 * The pack opener shell (Task 7), rendered under jsdom with a FAKE scene (jsdom has no WebGL): the request is asked at
 * the pop only, a failure resets to sealed, close before / after the pop, a late answer, a stale answer, one flip per
 * click, Reveal all, 3-card packs, Quick open, reduced motion and the portal.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import type { PackOpenResult } from '@game/progression';
import { mount, type Mounted } from '../../renderedText.mount';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const soundCalls: string[] = [];
vi.mock('./packSounds', () => ({
  createPackSounds: () => {
    const rec = (n: string) => () => { soundCalls.push(n); };
    return { pop: rec('pop'), tear: rec('tear'), crackle: rec('crackle'), rip: rec('rip'), sleeveFree: rec('sleeveFree'), slide: rec('slide'),
      drop: rec('drop'), whoosh: rec('whoosh'), flip: rec('flip'), stamp: rec('stamp'), aether: rec('aether'), summary: rec('summary'),
      silence: rec('silence'), dispose: rec('dispose') };
  },
}));

import { PackOpener, type PackOpenerProps, type PackOpenOutcome } from './PackOpener';
import type { PackScene, PackSceneEvents } from './packScene';
import { stageHost } from '../../stage';

const LOOK = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
const mk = (n: number, dupAt: number[] = []): PackOpenResult => ({
  packId: 'p1', pack: LOOK, aether: 10,
  cards: Array.from({ length: n }, (_, i) => ({
    rewardId: 'unknown-' + i, rarity: i === n - 1 ? 'rare' : 'common', guaranteed: i === n - 1,
    duplicate: dupAt.includes(i) ? { aether: 5 } : null,
  })),
});

interface Fake { calls: string[]; events: PackSceneEvents; flipInFlight: boolean; scene: PackScene }
let fakes: Fake[] = [];
const sceneFactory: NonNullable<PackOpenerProps['sceneFactory']> = (_host, _look, _n, _sounds, events) => {
  const f: Fake = { calls: [], events, flipInFlight: false, scene: null as unknown as PackScene };
  f.scene = {
    setBacks: (b) => { f.calls.push('setBacks:' + (b ? b.length : 'null')); },
    flipTop: () => { if (f.flipInFlight) return false; f.calls.push('flipTop'); f.flipInFlight = true; return true; },
    quickOpen: () => { f.calls.push('quickOpen'); },
    resetSealed: () => { f.calls.push('resetSealed'); },
    setInputEnabled: (on) => { f.calls.push('input:' + on); },
    destroy: () => { f.calls.push('destroy'); },
  };
  fakes.push(f);
  return f.scene;
};
const fake = (): Fake => fakes[fakes.length - 1]!;
/** The scene's card reaches edge-on: ends the in-flight flip and fires the event. */
const edge = (index: number): void => { act(() => { fake().flipInFlight = false; fake().events.onFlipEdge(index, { left: 10, top: 10, width: 100, height: 150 }); }); };
const toZoom = (): void => { act(() => { const e = fake().events; e.onPop(); e.onStripFree(); e.onSleeveDropped(); e.onZoomed(); }); };

let m: Mounted | null = null;
let opens: string[] = [];
let resolveOpen: ((o: PackOpenOutcome) => void) | null = null;
const controllable = (): PackOpenerProps['open'] => (id) => { opens.push(id); return new Promise<PackOpenOutcome>((res) => { resolveOpen = res; }); };
const ok = (r: PackOpenResult): PackOpenOutcome => ({ status: 'ok', result: r });
const settle = async (o: PackOpenOutcome): Promise<void> => { await act(async () => { resolveOpen!(o); await Promise.resolve(); }); };
const q = [{ packId: 'p1', look: LOOK }];
const render = (over: Partial<PackOpenerProps> = {}): void => {
  m = mount(<PackOpener queue={q} open={controllable()} sceneFactory={sceneFactory} reducedMotion={false} {...over} />);
};
const text = (): string => document.body.textContent ?? '';
const btn = (label: string): HTMLButtonElement | undefined => [...document.querySelectorAll('button')].find((b) => b.textContent === label);
const click = (el: Element | null | undefined): void => { act(() => { el!.dispatchEvent(new MouseEvent('click', { bubbles: true })); }); };
const key = (k: string): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true })); }); };
const fx = (): Element => document.querySelector('.pkop-fx')!;

beforeEach(() => { fakes = []; opens = []; resolveOpen = null; soundCalls.length = 0; });
afterEach(() => { m?.unmount(); m = null; });

describe('PackOpener', () => {
  it('does not request on press, requests once on pop', () => {
    render();
    expect(opens).toEqual([]);
    toZoom();
    expect(opens).toEqual(['p1']);
  });

  it('a failure mid-tear resets to sealed, shows the note, and asks again only on the next pop', async () => {
    render();
    act(() => { fake().events.onPop(); });
    await settle({ status: 'error', reason: 'x' });
    const c = fake().calls;
    expect(c.slice(-2)).toEqual(['input:false', 'resetSealed']);
    expect(text()).toContain('Could not open the pack. Try again.');
    expect(btn('Quick open')).toBeTruthy();
    expect(opens).toHaveLength(1);
    act(() => { fake().events.onPop(); });
    expect(opens).toHaveLength(2);
  });

  it('close before the pop closes with the pack sealed', () => {
    const onClose = vi.fn();
    render({ onClose });
    click(btn('Close'));
    expect(onClose).toHaveBeenCalledTimes(1);
    expect(opens).toEqual([]);
  });

  it('close after the pop shows the summary instead', async () => {
    const onClose = vi.fn();
    render({ onClose });
    act(() => { fake().events.onPop(); });
    await settle(ok(mk(5)));
    click(btn('Close'));
    expect(onClose).not.toHaveBeenCalled();
    expect(document.querySelectorAll('.pkop-summary li')).toHaveLength(5);
  });

  it('a late result holds at the zoom with "Still opening", then reveals', async () => {
    render();
    toZoom();
    expect(text()).toContain('Still opening');
    await settle(ok(mk(5)));
    expect(text()).not.toContain('Still opening');
    expect(fake().calls).toContain('setBacks:5');
    expect(btn('Reveal all')).toBeTruthy();
  });

  it('a result after close is ignored', async () => {
    const onOpened = vi.fn();
    const err = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    render({ onOpened });
    act(() => { fake().events.onPop(); });
    m!.unmount(); m = null;
    await act(async () => { resolveOpen!(ok(mk(5))); await Promise.resolve(); });
    expect(onOpened).not.toHaveBeenCalled();
    expect(err).not.toHaveBeenCalled();
    err.mockRestore();
  });

  it('rapid clicks flip exactly one card per click in order', async () => {
    render();
    toZoom();
    await settle(ok(mk(5)));
    click(fx()); click(fx()); click(fx());
    expect(fake().calls.filter((c) => c === 'flipTop')).toHaveLength(1);
    edge(0);
    expect(text()).toContain('New reward, Common, new');
    click(fx());
    expect(fake().calls.filter((c) => c === 'flipTop')).toHaveLength(2);
    edge(1);
    expect(document.querySelectorAll('[data-testid="pack-face"]')).toHaveLength(1);
  });

  it('Reveal all flips the rest and shows the summary with the duplicate Aether total', async () => {
    render();
    toZoom();
    await settle(ok(mk(5, [1, 3])));
    click(btn('Reveal all'));
    for (let i = 0; i < 5; i++) {
      await act(async () => { await new Promise((r) => setTimeout(r, 60)); });
      edge(i);
    }
    await act(async () => { await new Promise((r) => setTimeout(r, 120)); });
    expect(document.querySelectorAll('.pkop-summary li')).toHaveLength(5);
    expect(text()).toContain('Duplicates: +10 Aether');
    expect(btn('Done')).toBeTruthy();
  });

  it('a 3-card result reveals 3 and the summary lists 3', async () => {
    render();
    toZoom();
    await settle(ok(mk(3)));
    for (let i = 0; i < 3; i++) { click(fx()); edge(i); }
    expect(document.querySelectorAll('.pkop-summary')).toHaveLength(0);
    click(fx());
    expect(document.querySelectorAll('.pkop-summary li')).toHaveLength(3);
  });

  it('Quick open calls scene.quickOpen; Enter on sealed does the same', () => {
    render();
    click(btn('Quick open'));
    key('Enter');
    expect(fake().calls.filter((c) => c === 'quickOpen')).toHaveLength(2);
    expect(opens).toEqual([]);
  });

  it('reduced motion: Open, five flips, summary, duplicates announced, no scene created', async () => {
    render({ reducedMotion: true });
    expect(fakes).toHaveLength(0);
    click(btn('Open'));
    expect(opens).toEqual(['p1']);
    await settle(ok(mk(5, [2])));
    const row = document.querySelector('.pkop-row')!;
    for (let i = 0; i < 5; i++) {
      click(row);
      if (i === 2) expect(document.querySelector('.pkop-live')!.textContent).toBe('New reward, Common, duplicate, +5 Aether');
    }
    expect(document.querySelectorAll('[data-testid="pack-face"]')).toHaveLength(5);
    key('Enter');
    expect(document.querySelectorAll('.pkop-summary li')).toHaveLength(5);
    expect(fakes).toHaveLength(0);
  });

  it('the theatre portals into stageHost and has no title attribute anywhere', async () => {
    render();
    toZoom();
    await settle(ok(mk(5)));
    const dlg = document.querySelector('[role="dialog"][aria-label="Opening a pack"]')!;
    expect(stageHost().contains(dlg)).toBe(true);
    expect(dlg.parentElement).toBe(stageHost());
    expect(dlg.querySelectorAll('[title]')).toHaveLength(0);
    expect(dlg.querySelectorAll('title')).toHaveLength(0);
  });

  it('survives StrictMode and destroys the scene on unmount', () => {
    m = mount(<StrictMode><PackOpener queue={q} open={controllable()} sceneFactory={sceneFactory} reducedMotion={false} /></StrictMode>);
    const last = fake();
    m.unmount(); m = null;
    expect(last.calls).toContain('destroy');
  });
});
