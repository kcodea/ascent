// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { RUNE_INDEX } from '@game/content';
import { createRun, type RunState } from '@game/sim';

// Every entrance sound goes through `playFxSound`: spy on it (the rest of sfx stays real).
const played = vi.hoisted(() => [] as { clip: string; at: number }[]);
vi.mock('../sfx', async (orig) => {
  const real = await orig<typeof import('../sfx')>();
  return { ...real, playFxSound: (clip: string) => { played.push({ clip, at: Date.now() }); return null; } };
});

import { mount, type Mounted } from '../renderedText.mount';
import { RuneforgeOverlay } from '../Recruit';
import { RuneforgeDialog, resetRuneforgeEntranceMemoForTests, type RuneforgeDialogProps } from './RuneforgeDialog';
import { runeforgeEntranceRunning, skipRuneforgeEntrance } from './entrance';
import { RFE_DEFAULTS, entranceTimeline, resetRuneforgeEntranceConfig, resolveEntrance, setRuneforgeEntranceValue } from './runeforgeEntranceConfig';

/**
 * THE RUNEFORGE ENTRANCE on the real forge dialog (owner asks 2026-09-24): a real forge offers FOUR tablets; each is
 * un-clickable while in the air and clickable the moment it lands; a press during the entrance skips it to the
 * settled state; the Epic forge picks the Epic variant; each sound cue plays exactly once per landing; nothing
 * starts before the return-to-shop wipe has ended (plus the post-wipe pad); a re-render never replays it.
 */
const basic = Object.values(RUNE_INDEX).filter((r) => !r.epic).slice(0, 4).map((r) => r.id);
const epics = Object.values(RUNE_INDEX).filter((r) => r.epic).slice(0, 4).map((r) => r.id);
let m: Mounted | null = null;

const slots = (): HTMLElement[] => [...(m?.container.querySelectorAll<HTMLElement>('.rfe-slot') ?? [])];
const falling = (): boolean[] => slots().map((s) => s.dataset.rfe === 'falling');
const dialog = (props: Partial<RuneforgeDialogProps> = {}): JSX.Element => (
  <RuneforgeDialog
    offer={basic} epic={false} embers={99} rerollSpent={false} duplicating={false}
    onBuy={() => {}} onReroll={() => {}} {...props}
  />
);
const beats = (): ReturnType<typeof entranceTimeline> => entranceTimeline(resolveEntrance(RFE_DEFAULTS, false), 4);
const landCues = (): number => played.filter((p) => p.clip === RFE_DEFAULTS.sfxLandClip).length;
const sweepCues = (): number => played.filter((p) => p.clip === RFE_DEFAULTS.sfxSweepClip).length;

beforeEach(() => {
  vi.useFakeTimers();
  resetRuneforgeEntranceMemoForTests();
  played.length = 0;
});
afterEach(() => {
  resetRuneforgeEntranceConfig();
  m?.unmount();
  m = null;
  vi.useRealTimers();
});

describe('the Runeforge entrance', () => {
  it('drops all four tablets; each starts in the air and becomes clickable exactly as it lands', () => {
    m = mount(dialog());
    expect(slots()).toHaveLength(4);
    expect(falling()).toEqual([true, true, true, true]);
    const t = beats();
    act(() => { vi.advanceTimersByTime(t.cards[0]!.landAt); });
    expect(falling()).toEqual([false, true, true, true]);
    act(() => { vi.advanceTimersByTime(t.cards[3]!.landAt - t.cards[0]!.landAt); });
    expect(falling()).toEqual([false, false, false, false]);
    act(() => { vi.advanceTimersByTime(t.endAt); });
    expect(runeforgeEntranceRunning()).toBe(false);
  });

  it('a landed tablet takes its click (the buy) while the others are still arriving', () => {
    const onBuy = vi.fn();
    m = mount(dialog({ onBuy }));
    act(() => { vi.advanceTimersByTime(beats().cards[0]!.landAt); });
    const card = slots()[0]!.querySelector('button.runecard') as HTMLButtonElement;
    act(() => { card.click(); });
    expect(onBuy).toHaveBeenCalledWith(0, card);
  });

  it('a press during the entrance skips it to the settled state', () => {
    m = mount(dialog());
    expect(runeforgeEntranceRunning()).toBe(true);
    const root = m.container.querySelector('.forge-ov') as HTMLElement;
    act(() => { root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(runeforgeEntranceRunning()).toBe(false);
    expect(falling()).toEqual([false, false, false, false]);
    expect(root.dataset.rfePhase).toBe('settled');
  });

  it('after the skip every tablet is interactive at once, and no further cue plays', () => {
    const onBuy = vi.fn();
    m = mount(dialog({ onBuy }));
    const root = m.container.querySelector('.forge-ov') as HTMLElement;
    act(() => { root.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    const last = slots()[3]!.querySelector('button.runecard') as HTMLButtonElement;
    act(() => { last.click(); });
    expect(onBuy).toHaveBeenCalledWith(3, last);
    act(() => { vi.advanceTimersByTime(5000); });
    expect(played).toEqual([]);
  });

  it('the land cue plays exactly once per tablet, on its landing, and never again', () => {
    m = mount(dialog());
    const t = beats();
    act(() => { vi.advanceTimersByTime(t.cards[0]!.landAt - 1); });
    expect(landCues()).toBe(0); // not early
    act(() => { vi.advanceTimersByTime(1); });
    expect(landCues()).toBe(1);
    act(() => { vi.advanceTimersByTime(t.endAt + 5000); });
    expect(landCues()).toBe(4); // one per tablet, and nothing keeps playing
    // The placeholder cues (no clip mapped) are silent: only the land thud and the sweep sheen ever play.
    expect(played.every((p) => p.clip === RFE_DEFAULTS.sfxLandClip || p.clip === RFE_DEFAULTS.sfxSweepClip)).toBe(true);
  });

  it('the glow sweep sound plays ONCE per forge by default, in sync with the first sweep', () => {
    m = mount(dialog());
    const t = beats();
    act(() => { vi.advanceTimersByTime(t.cards[0]!.settledAt - 1); });
    expect(sweepCues()).toBe(0);
    act(() => { vi.advanceTimersByTime(1); });
    expect(sweepCues()).toBe(1);
    act(() => { vi.advanceTimersByTime(t.endAt + 5000); });
    expect(sweepCues()).toBe(1);
  });

  it('every-tablet mode: one sweep sound per tablet, exactly once each (the stagger clears the gap)', () => {
    setRuneforgeEntranceValue('sfxSweepEach', 1);
    m = mount(dialog());
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(sweepCues()).toBe(4);
  });

  it('every-tablet mode: sweeps closer together than the gap do not stack', () => {
    setRuneforgeEntranceValue('sfxSweepEach', 1);
    setRuneforgeEntranceValue('sfxSweepGapMs', 500);
    m = mount(dialog());
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    // Sweeps start 150 ms apart, so all four fall inside one 500 ms gap: only the first rings.
    expect(sweepCues()).toBe(1);
  });

  it('a re-render (any store update) never replays it or its sounds', () => {
    m = mount(dialog({ occasion: 'seed:6' }));
    act(() => { vi.advanceTimersByTime(beats().cards[1]!.landAt); });
    // A re-render mid-entrance, with a NEW array of the same offer (the store clones run state freely).
    m.render(dialog({ occasion: 'seed:6', offer: [...basic], embers: 98 }));
    act(() => { vi.advanceTimersByTime(beats().endAt + 5000); });
    expect(landCues()).toBe(4);
    m.render(dialog({ occasion: 'seed:6', offer: [...basic], embers: 97 }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(landCues()).toBe(4);
    expect(falling()).toEqual([false, false, false, false]);
  });

  it('a remount mid-entrance (not StrictMode) settles instead of starting the sequence and its sounds over', () => {
    m = mount(dialog({ occasion: 'seed:7' }));
    act(() => { vi.advanceTimersByTime(beats().cards[0]!.landAt); });
    expect(landCues()).toBe(1);
    m.unmount();
    vi.advanceTimersByTime(200); // well past a StrictMode re-run
    m = mount(dialog({ occasion: 'seed:7' }));
    act(() => { vi.advanceTimersByTime(5000); });
    expect(landCues()).toBe(1);
    expect(falling()).toEqual([false, false, false, false]);
  });

  it('the replay hook settles a running entrance before the lock-in is measured', () => {
    m = mount(dialog());
    act(() => { skipRuneforgeEntrance(); });
    expect(falling()).toEqual([false, false, false, false]);
  });

  it('the Epic forge plays the Epic variant; the basic forge the basic one', () => {
    m = mount(dialog({ offer: epics, epic: true }));
    const root = m.container.querySelector('.forge-ov') as HTMLElement;
    expect(root.classList.contains('rfe-epic')).toBe(true);
    expect(root.getAttribute('aria-label')).toBe('The Epic Runeforge');
    m.unmount();
    m = mount(dialog());
    expect(m.container.querySelector('.forge-ov')!.classList.contains('rfe-epic')).toBe(false);
  });

  it('returning from Inspect (a remount of the same opening) does not replay it', () => {
    m = mount(dialog({ occasion: 'seed:6' }));
    act(() => { vi.advanceTimersByTime(5000); });
    m.unmount();
    m = mount(dialog({ occasion: 'seed:6' }));
    expect(falling()).toEqual([false, false, false, false]);
    expect(runeforgeEntranceRunning()).toBe(false);
  });

  it('a re-roll drops the new tablets in again, with no post-wipe pad', () => {
    m = mount(dialog({ occasion: 'seed:6' }));
    act(() => { vi.advanceTimersByTime(5000); });
    const next = Object.values(RUNE_INDEX).filter((r) => !r.epic).slice(4, 8).map((r) => r.id);
    m.render(dialog({ occasion: 'seed:6', offer: next }));
    expect(falling()).toEqual([true, true, true, true]);
    const reroll = entranceTimeline(resolveEntrance(RFE_DEFAULTS, false), 4, { opening: false });
    act(() => { vi.advanceTimersByTime(reroll.cards[0]!.landAt); });
    expect(falling()[0]).toBe(false);
  });
});

describe('the Runeforge entrance waits for the return-to-shop wipe', () => {
  const noop = (): void => {};
  const run = (): RunState => ({ ...createRun(4242), embers: 99, runeforgeOffer: basic, runeforgeDiscounts: [0, 0, 0, 0] });
  const overlay = (overlaysHeld: boolean, r: RunState): JSX.Element => (
    <RuneforgeOverlay
      overlaysHeld={overlaysHeld} run={r} forgeMin={false} setForgeMin={noop}
      lockIn={null} lockInSlow={1} setLockIn={noop}
      runeLockInCue={null} cueRuneArrival={noop} startRuneLockIn={noop} dispatch={noop}
    />
  );

  it('nothing mounts, shows or sounds while the wipe is up; it starts only after the wipe ends plus the pad', () => {
    const r = run();
    m = mount(overlay(true, r));
    act(() => { vi.advanceTimersByTime(3000); });
    expect(m.container.querySelector('.forge-ov')).toBeNull();
    expect(played).toEqual([]);
    // The wipe ends.
    m.render(overlay(false, r));
    expect(m.container.querySelector('.forge-ov')).not.toBeNull();
    const t = beats();
    expect(t.openAt).toBe(RFE_DEFAULTS.openDelayMs);
    act(() => { vi.advanceTimersByTime(t.cards[0]!.landAt - 1); });
    expect(played).toEqual([]);
    act(() => { vi.advanceTimersByTime(t.endAt); });
    expect(landCues()).toBe(4);
  });
});
