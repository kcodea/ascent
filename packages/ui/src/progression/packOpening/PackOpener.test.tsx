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
      drop: rec('drop'), whoosh: rec('whoosh'), tease: rec('tease'), handle: rec('handle'), squeeze: rec('squeeze'), press: rec('press'), heartbeat: rec('heartbeat'), land: rec('land'), flip: rec('flip'), stamp: rec('stamp'), aether: rec('aether'), summary: rec('summary'),
      silence: rec('silence'), dispose: rec('dispose'), bigPull: (t: string) => { soundCalls.push('bigPull:' + t); } };
  },
}));

import { PackOpener, type PackOpenerProps, type PackOpenOutcome } from './PackOpener';
import type { PackScene, PackSceneEvents } from './packScene';
import { stageHost } from '../../stage';
import { resetPackFeel, setPackFeel } from './packFxConfig';

const LOOK = { kind: 'rarity', id: 'rare', name: 'Rare Pack', guaranteedFloor: 'rare' } as const;
/** A 5-card result with the given rarities at the given indexes (the rest as `mk`). */
const withRarity = (at: Record<number, 'legendary' | 'ancient' | 'epic'>): PackOpenResult => {
  const r = mk(5);
  return { ...r, cards: r.cards.map((c, i) => (at[i] ? { ...c, rarity: at[i] } : c)) };
};
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
    showSummary: (spots) => { f.calls.push('summary:' + spots.length); },
    faceTurnStarted: () => undefined,
    setSpeed: (m) => { f.calls.push('speed:' + m); },
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
const faceAt = (i: number): HTMLElement => document.querySelectorAll<HTMLElement>('[data-testid="pack-face"]')[i]!;
const inner = (i: number): HTMLElement => faceAt(i).querySelector<HTMLElement>('.pkf-card')!;
const wait = async (ms: number): Promise<void> => { await act(async () => { await new Promise((r) => setTimeout(r, ms)); }); };
/**
 * Every face that mounts edge-on flushes that pose with ONE layout read (`offsetWidth`) before it turns in: record what
 * each face looked like at that read (its phase and its turn), so a face that skipped the edge pose is caught.
 */
const watchEdgeFlushes = (): { flushes: { phase: string | null; turn: string }[]; restore: () => void } => {
  const flushes: { phase: string | null; turn: string }[] = [];
  const desc = Object.getOwnPropertyDescriptor(HTMLElement.prototype, 'offsetWidth')!;
  Object.defineProperty(HTMLElement.prototype, 'offsetWidth', {
    configurable: true,
    get(this: HTMLElement) {
      if (this.dataset.testid === 'pack-face') {
        flushes.push({ phase: this.getAttribute('data-phase'), turn: (this.firstElementChild as HTMLElement).style.transform });
      }
      return desc.get!.call(this) as number;
    },
  });
  return { flushes, restore: () => { Object.defineProperty(HTMLElement.prototype, 'offsetWidth', desc); } };
};

beforeEach(() => { fakes = []; opens = []; resolveOpen = null; soundCalls.length = 0; });
afterEach(() => { m?.unmount(); m = null; vi.useRealTimers(); resetPackFeel(); });

describe('PackOpener', () => {
  it('applies the dev speed on scene creation and slows the DOM transitions with --pk-slow', () => {
    render({ speed: 0.25 });
    expect(fake().calls).toContain('speed:0.25');
    expect((document.querySelector('.pkop') as HTMLElement).style.getPropertyValue('--pk-slow')).toBe('4');
  });

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
    // Once both turns are done: one top face, the earlier one tucked under it.
    await wait(300);
    expect(document.querySelectorAll('[data-testid="pack-face"][data-phase="featured"]')).toHaveLength(1);
    expect(document.querySelectorAll('[data-testid="pack-face"][data-phase="tray"]')).toHaveLength(1);
    expect(faceAt(1).getAttribute('data-phase')).toBe('featured');
  });

  it('a click mid-turn lets the turning face finish its turn before it tucks into the pile (no snap)', async () => {
    render();
    toZoom();
    await settle(ok(mk(5)));
    click(fx()); edge(0);
    expect(faceAt(0).getAttribute('data-phase')).toBe('handoff');
    // The next flip starts while face 0 is still turning: it keeps its phase and its turn's transition.
    click(fx());
    expect(fake().calls.filter((c) => c === 'flipTop')).toHaveLength(2);
    expect(faceAt(0).getAttribute('data-phase')).toBe('handoff');
    expect(inner(0).style.transition).toContain('transform 260ms');
    expect(inner(0).style.transform).toContain('rotateY(0deg)');
    // Its turn done, it tucks under while the next card is still flipping in; the turn's transition stays on.
    await wait(300);
    expect(faceAt(0).getAttribute('data-phase')).toBe('tray');
    expect(inner(0).style.transition).toContain('transform 260ms');
  });

  it('Reveal all: every face mounts edge-on in handoff and turns in, though the next flip chains in the same task', async () => {
    const w = watchEdgeFlushes();
    try {
      render();
      toZoom();
      await settle(ok(mk(5)));
      click(btn('Reveal all'));
      for (let i = 0; i < 5; i++) {
        edge(i); // the shell chains the next flipTop from inside this event (the real scene allows it)
        if (i < 4) expect(fake().calls.filter((c) => c === 'flipTop')).toHaveLength(i + 2);
        expect(faceAt(i).getAttribute('data-phase'), `face ${i}`).toBe('handoff');
        expect(faceAt(i).classList.contains('pkf-handoff')).toBe(true);
        // It was flushed at the scene's edge-on pose (turned -90 deg), in handoff, then let go to turn flat.
        expect(w.flushes[i], `face ${i} flush`).toEqual({ phase: 'handoff', turn: expect.stringContaining('rotateY(-90deg)') as unknown as string });
        expect(inner(i).style.transform).toContain('rotateY(0deg)');
        expect(inner(i).style.transition).toContain(i === 4 ? 'transform 380ms' : 'transform 260ms');
      }
      expect(w.flushes).toHaveLength(5);
    } finally {
      w.restore();
    }
  });

  it('slow-mo slows the DOM half of the flip too (the face turn and move, and how long it stays handed off)', async () => {
    render({ speed: 0.25 });
    toZoom();
    await settle(ok(mk(5)));
    click(fx()); edge(0);
    expect(faceAt(0).style.transition).toContain('transform 1040ms');
    expect(inner(0).style.transition).toContain('transform 1040ms');
    await wait(400);
    expect(faceAt(0).getAttribute('data-phase')).toBe('handoff');
  });

  it('when the scene reports Pixi unavailable (synchronously), the opener falls back to the reduced-motion path', async () => {
    const factory: NonNullable<PackOpenerProps['sceneFactory']> = (...args) => {
      const sc = sceneFactory(...args);
      args[4].onUnavailable();
      return sc;
    };
    render({ sceneFactory: factory });
    expect(fake().calls).toContain('destroy');
    expect(document.querySelector('.pkop-fx')).toBeNull();
    expect(btn('Quick open')).toBeUndefined();
    click(btn('Open'));
    expect(opens).toEqual(['p1']);
    await settle(ok(mk(5)));
    const row = document.querySelector('.pkop-row')!;
    for (let i = 0; i < 5; i++) click(row);
    expect(document.querySelectorAll('.pkop-back.flipped')).toHaveLength(5);
    key('Enter');
    expect(document.querySelectorAll('.pkop-summary li')).toHaveLength(5);
    expect(fakes).toHaveLength(1); // no second scene
  });

  it('when Pixi init fails later (asynchronously), the sealed pack switches to the reduced-motion Open', () => {
    render();
    expect(btn('Quick open')).toBeTruthy();
    const f = fake();
    act(() => { f.events.onUnavailable(); });
    expect(f.calls).toContain('destroy');
    expect(btn('Open')).toBeTruthy();
    click(btn('Open'));
    expect(opens).toEqual(['p1']);
  });

  it('Open next keeps focus in the dialog', async () => {
    render({ queue: [{ packId: 'p1', look: LOOK }, { packId: 'p2', look: LOOK }] });
    act(() => { fake().events.onPop(); });
    await settle(ok(mk(5)));
    click(btn('Close'));
    const next = btn('Open next')!;
    act(() => { next.focus(); });
    click(next);
    expect(btn('Open next')).toBeUndefined();
    expect(document.activeElement).toBe(document.querySelector('[role="dialog"]'));
  });

  it('the summary lines every face up in one row', async () => {
    render();
    toZoom();
    await settle(ok(mk(5)));
    click(fx()); edge(0);
    click(btn('Close'));
    const faces = document.querySelectorAll('[data-testid="pack-face"]');
    expect(faces).toHaveLength(5);
    for (const f of faces) expect(f.getAttribute('data-phase')).toBe('summary');
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
    expect(document.querySelectorAll('.pkop-summary')).toHaveLength(0);
    await act(async () => { await new Promise((r) => setTimeout(r, 700)); });
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

  it('announces an ancient card as Ancient (Ascendant is the Rank, not a rarity)', async () => {
    render({ reducedMotion: true });
    click(btn('Open'));
    const r = mk(5);
    await settle(ok({ ...r, cards: r.cards.map((c, i) => (i === 0 ? { ...c, rarity: 'ancient' as const } : c)) }));
    click(document.querySelector('.pkop-row')!);
    const live = document.querySelector('.pkop-live')!.textContent;
    expect(live).toBe('New reward, Ancient, new');
    expect(live).not.toContain('Ascendant');
  });

  it('reduced motion: Open, five flips, summary, duplicates announced, no scene created', async () => {
    render({ reducedMotion: true });
    expect(fakes).toHaveLength(0);
    click(btn('Open'));
    expect(opens).toEqual(['p1']);
    await settle(ok(mk(5, [2])));
    const row = document.querySelector('.pkop-row')!;
    expect(document.querySelectorAll('[data-testid="pack-face"]')).toHaveLength(5);
    expect(document.querySelectorAll('.pkop-back.flipped')).toHaveLength(0);
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

  it('honours a new open passed before the pop', () => {
    const first = vi.fn(() => new Promise<PackOpenOutcome>(() => undefined));
    const second = vi.fn(() => new Promise<PackOpenOutcome>(() => undefined));
    render({ open: first });
    m!.render(<PackOpener queue={q} open={second} sceneFactory={sceneFactory} reducedMotion={false} />);
    act(() => { fake().events.onPop(); });
    expect(first).not.toHaveBeenCalled();
    expect(second).toHaveBeenCalledWith('p1');
  });

  it('ignores key repeat and keys typed into an input', () => {
    render();
    const input = document.createElement('input');
    document.body.appendChild(input);
    act(() => { input.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', bubbles: true })); });
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Enter', repeat: true, bubbles: true })); });
    input.remove();
    expect(fake().calls).not.toContain('quickOpen');
  });

  it('disposes the sounds after the scene is destroyed', () => {
    render();
    soundCalls.length = 0;
    const f = fake();
    const orig = f.scene.destroy;
    f.scene.destroy = () => { soundCalls.push('destroy'); orig(); };
    toZoom();
    soundCalls.length = 0;
    m!.unmount(); m = null;
    expect(soundCalls.indexOf('destroy')).toBeGreaterThanOrEqual(0);
    expect(soundCalls.indexOf('dispose')).toBeGreaterThan(soundCalls.indexOf('destroy'));
  });

  describe('the big pull (Legendary / Ancient)', () => {
    const flips = (): number => fake().calls.filter((c) => c === 'flipTop').length;
    const tick = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
    const quakeEl = (): HTMLElement => document.querySelector<HTMLElement>('.pkop-quake')!;
    const shaking = (): boolean => /pkop-quake-[ab]/.test(quakeEl().className);

    it('a Legendary plays its sound, shakes once, and holds the next flip for its turn plus bigPullHoldMs (clicks ignored, not queued)', async () => {
      render();
      toZoom();
      await settle(ok(withRarity({ 0: 'legendary' })));
      vi.useFakeTimers();
      click(fx()); edge(0);
      expect(soundCalls).toContain('bigPull:legendary');
      expect(shaking()).toBe(true);
      expect(quakeEl().style.getPropertyValue('--pk-quake')).toBe('6px');
      // The hold: the face's own turn (a Legendary turns in 460ms: cardFlip.ts FLIP_HALF_BY_RARITY) + the default 450ms.
      click(fx()); key('Enter');
      tick(890);
      click(fx());
      expect(flips()).toBe(1);
      tick(30);
      expect(flips()).toBe(1); // nothing was queued
      click(fx());
      expect(flips()).toBe(2);
    });

    it('a non-big-pull card has no hold, no shake and no big-pull sound', async () => {
      render();
      toZoom();
      await settle(ok(withRarity({ 0: 'epic' })));
      click(fx()); edge(0);
      click(fx());
      expect(flips()).toBe(2);
      expect(shaking()).toBe(false);
      expect(soundCalls.some((c) => c.startsWith('bigPull'))).toBe(false);
    });

    it('Reveal all waits out the hold before it flips on; an Ancient shakes 1.5x', async () => {
      render();
      toZoom();
      await settle(ok(withRarity({ 1: 'ancient' })));
      vi.useFakeTimers();
      click(btn('Reveal all'));
      expect(flips()).toBe(1);
      edge(0); // a common: the chain flips the next at once
      expect(flips()).toBe(2);
      edge(1); // the Ancient: the chain is held
      expect(soundCalls).toContain('bigPull:ancient');
      expect(quakeEl().style.getPropertyValue('--pk-quake')).toBe('9px');
      expect(flips()).toBe(2);
      tick(980); // an Ancient turns in 560ms, + the 450ms hold
      expect(flips()).toBe(2);
      tick(80);
      expect(flips()).toBe(3);
    });

    it('slow-mo stretches the hold the same way it stretches the flip', async () => {
      render({ speed: 0.5 });
      toZoom();
      await settle(ok(withRarity({ 0: 'legendary' })));
      vi.useFakeTimers();
      click(fx()); edge(0);
      tick(1800); // (460 + 450) x 2 = 1820
      click(fx());
      expect(flips()).toBe(1);
      tick(30);
      click(fx());
      expect(flips()).toBe(2);
    });

    it('a 0 shake knob shakes nothing; the hold still applies', async () => {
      setPackFeel({ bigPullShake: 0 });
      render();
      toZoom();
      await settle(ok(withRarity({ 0: 'ancient' })));
      vi.useFakeTimers();
      click(fx()); edge(0);
      expect(shaking()).toBe(false);
      click(fx());
      expect(flips()).toBe(1);
    });

    it('reduced motion: the sound and the hold, but no shake class or transform', async () => {
      render({ reducedMotion: true });
      click(btn('Open'));
      await settle(ok(withRarity({ 0: 'ancient' })));
      vi.useFakeTimers();
      const row = document.querySelector('.pkop-row')!;
      click(row);
      expect(soundCalls).toContain('bigPull:ancient');
      expect(shaking()).toBe(false);
      expect(quakeEl().getAttribute('style')).toBeNull();
      expect(document.querySelectorAll('.pkop-quake-a, .pkop-quake-b')).toHaveLength(0);
      click(row);
      expect(document.querySelectorAll('.pkop-back.flipped')).toHaveLength(1);
      tick(460);
      click(row);
      expect(document.querySelectorAll('.pkop-back.flipped')).toHaveLength(2);
    });
  });

  it('survives StrictMode and destroys the scene on unmount', () => {
    m = mount(<StrictMode><PackOpener queue={q} open={controllable()} sceneFactory={sceneFactory} reducedMotion={false} /></StrictMode>);
    const last = fake();
    m.unmount(); m = null;
    expect(last.calls).toContain('destroy');
  });
});
