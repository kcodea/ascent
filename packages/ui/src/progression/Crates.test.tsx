// @vitest-environment jsdom
/**
 * LEVEL CRATES, THE CRATE THEATRE AND THE COLLECTION SCREEN (2026-09-28), rendered under jsdom with the network
 * seam mocked and the Pixi layer swapped for a recorder (jsdom has no WebGL):
 *  - the post-game "Crate earned" row and its OPTIONAL Open button, several crates, pool_exhausted, a failure;
 *  - the theatre's flow states: sealed (idle) -> anticipation (in flight, holds, "Still opening") -> charge -> burst
 *    -> reveal -> settled; a failure winding down to Try again; a skip mid-sequence and a skip BEFORE the answer;
 *    reduced motion; StrictMode; the Pixi controller destroyed on unmount;
 *  (the Collection screen's own tests live in CollectionScreen.test.tsx.)
 * The theatre renders into the stage host (a portal), so queries go through `document`. No native tooltips, no em
 * dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { StrictMode, act } from 'react';
import type { OpenCrateResult, ProgressionProfile, ProgressionResult } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import type { CrateFx } from './crateFx/crateFxPixi';
import type { CratePreset } from './crateFx/crateFxConfig';

// jsdom has no canvas: stub it BEFORE the imports below pull in pixi.js (which probes a canvas at load).
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const openCrateRemote = vi.fn();
const equipTitleRemote = vi.fn();
const fetchOwnCrates = vi.fn(async () => undefined as unknown);
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  openCrateRemote: (id: string) => openCrateRemote(id),
  equipTitleRemote: (id: string | null) => equipTitleRemote(id),
  fetchOwnCrates: () => fetchOwnCrates(),
}));

import { ProgressionPostgame } from './ProgressionPostgame';
import { CrateOpener } from './CrateOpener';
import { resetProgressionForTests, useProgression } from './progressionStore';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { CRATE_FX_DEFAULTS, presetFor } from './crateFx/crateFxConfig';
import { useGame } from '../store';


/** The Pixi layer, recorded: every beat the theatre asks for, in order. */
let fxCalls: string[] = [];
function recorder(): CrateFx {
  const rec = (name: string) => (p?: CratePreset | number | object): void => { fxCalls.push(p && typeof p === 'object' && 'rarity' in p ? `${name}:${p.rarity}` : name); };
  return {
    mount: async () => true, resize: () => {}, setSpeed: () => {}, setArt: () => {}, onPulse: () => {},
    reset: rec('reset'), anticipate: rec('anticipate'), charge: rec('charge'), burst: rec('burst'), reveal: rec('reveal'),
    settle: rec('settle'), skipToSettled: rec('skipToSettled'), windDown: rec('windDown'), destroy: rec('destroy'),
  };
}

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); setCrateFxFactoryForTests(null); });
beforeEach(() => {
  resetProgressionForTests();
  openCrateRemote.mockReset();
  equipTitleRemote.mockReset();
  fxCalls = [];
  setCrateFxFactoryForTests(recorder);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, accountPanelOpen: false, showCollection: false, showCareer: false });
});

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'], ...over });
const result = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 6, comeback: false,
  xp: { base: 100, topFour: 0, firstPlace: 0, comeback: 0, total: 100 },
  before: { lifetimeXp: 225, level: 1 }, after: { lifetimeXp: 325, level: 2 }, unlockedTitles: [], cratesAwarded: 1, crateIds: ['c-2'],
  revisionAfter: 8, settledAt: new Date().toISOString(), ...over,
});
const opened = (crateId: string, rewardId: string, earnedLevel = 2, sealedRemaining = 0): OpenCrateResult => ({
  status: 'opened', rewardId, sealedRemaining, crate: { crateId, earnedLevel, state: 'opened', rewardId, earnedAt: 't0', openedAt: 't1' },
});
function setup(r: ProgressionResult, crates: 'on' | 'off' = 'on'): void {
  useProgression.setState({
    capability: 'on', cratesCapability: crates, crateList: null,
    mirror: { userId: 'u-1', ...profile() },
    current: { localKey: '42', mode: 'ranked', runId: 'run-1', state: 'confirmed', result: r, deduped: false, error: null },
  });
}
const $ = (sel: string): HTMLElement | null => document.querySelector<HTMLElement>(sel);
const text = (sel: string): string => ($(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const buttons = (): HTMLButtonElement[] => [...document.querySelectorAll<HTMLButtonElement>('button')];
const button = (label: string): HTMLButtonElement | undefined => buttons().find((b) => b.textContent?.trim() === label);
const settle = async (): Promise<void> => { await act(async () => { await Promise.resolve(); await Promise.resolve(); await Promise.resolve(); }); };
const phase = (): string => ($('.crth')?.className.match(/ph-(\w+)/)?.[1]) ?? 'none';
const advance = (ms: number): void => { act(() => { vi.advanceTimersByTime(ms); }); };
const noDashes = (): void => { expect(document.body.textContent).not.toMatch(/[—–]/); expect(document.querySelector('[title]')).toBeNull(); };

describe('the post-game crate', () => {
  it('a level-up shows "Crate earned" with an optional Open button; nothing is opened until it is pressed', () => {
    setup(result());
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-crates-head')).toBe('Crate earned');
    expect(text('.acctxp-crates-sub')).toBe('Open now, or later from your Collection.');
    expect(button('Open')).toBeTruthy();
    expect(openCrateRemote).not.toHaveBeenCalled();
    expect($('.crth')).toBeNull();
    noDashes();
  });

  it('Open plays the theatre: the reward chosen by the server (name, rarity), the returned profile adopted; Done closes it', async () => {
    setup(result());
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_stormcaller'), profile: profile({ titles: ['alpha_tester', 'title_stormcaller'], revision: 10 }) });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect(text('.crate-reward-kind')).toBe('New title');
    expect(text('.crate-reward-name')).toBe('Stormcaller');
    expect(text('.crate-reward-rarity')).toBe('Rare');
    expect($('.crate-reward')!.className).toContain('r-rare');
    expect(useProgression.getState().mirror!.titles).toEqual(['alpha_tester', 'title_stormcaller']);
    expect(useProgression.getState().crateList!.map((c) => [c.crateId, c.state])).toEqual([['c-2', 'opened']]);
    expect(button('Open next')).toBeUndefined();
    act(() => button('Done')!.click());
    expect($('.crth')).toBeNull();
    expect($('.acctxp-crates')).toBeNull(); // nothing left sealed from this game
  });

  it('several crates: "2 crates earned", then "Open next" after the first reveal', async () => {
    setup(result({ before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 250, level: 2 }, cratesAwarded: 2, crateIds: ['c-1', 'c-2'], mode: 'tutorial', runId: 'learn-ascent:v1' }));
    useProgression.setState({ current: { ...useProgression.getState().current!, mode: 'tutorial', runId: 'learn-ascent:v1' } });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-1', 'title_wanderer', 1, 1), profile: profile() });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-2', 'title_the_unbroken', 2, 0), profile: profile() });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-crates-head')).toBe('2 crates earned');
    act(() => button('Open')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenLastCalledWith('c-1');
    expect(text('.crate-name')).toBe('Welcome Crate');
    expect(text('.crate-reward-name')).toBe('Wanderer');
    act(() => button('Open next')!.click());
    await settle();
    expect(openCrateRemote).toHaveBeenLastCalledWith('c-2');
    expect(text('.crate-name')).toBe('Level 2 Crate');
    expect(text('.crate-reward-name')).toBe('The Unbroken');
    expect(text('.crate-reward-rarity')).toBe('Legendary');
    expect(button('Open next')).toBeUndefined();
  });

  it('pool exhausted: said plainly, the crate stays sealed, no reward shown', async () => {
    setup(result());
    openCrateRemote.mockResolvedValue({ status: 'ok', profile: profile(), value: { status: 'pool_exhausted', rewardId: null, sealedRemaining: 1, crate: { crateId: 'c-2', earnedLevel: 2, state: 'sealed', rewardId: null, earnedAt: 't0', openedAt: null } } });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-note')).toBe('You own every reward for now. This crate stays sealed until new rewards arrive.');
    expect($('.crate-reward')).toBeNull();
    expect(useProgression.getState().crateList!.map((c) => c.state)).toEqual(['sealed']);
  });

  it('a failed open says so and offers Try again', async () => {
    setup(result());
    openCrateRemote.mockResolvedValueOnce({ status: 'error', reason: 'timeout' });
    openCrateRemote.mockResolvedValueOnce({ status: 'ok', value: opened('c-2', 'title_ironbeard'), profile: profile() });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-note')).toBe('Could not open the crate. Try again.');
    act(() => button('Try again')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Ironbeard');
  });

  it('hidden while the crates switch is off, and when the game created no crate', () => {
    setup(result(), 'off');
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
    expect($('.acctxp')).not.toBeNull(); // the XP panel itself still shows
    ui.unmount();
    setup(result({ cratesAwarded: 0, crateIds: [], after: { lifetimeXp: 325, level: 1 } }));
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
  });

  it('a crate already opened elsewhere is not offered again', () => {
    setup(result());
    useProgression.setState({ crateList: [{ crateId: 'c-2', earnedLevel: 2, state: 'opened', rewardId: 'title_wanderer', earnedAt: null, openedAt: null }] });
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
  });

  it('a guest who earns a crate gets the same save prompt', () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    setup(result({ before: { lifetimeXp: 300, level: 2 }, after: { lifetimeXp: 510, level: 3 }, crateIds: ['c-3'] }));
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect(text('.acctxp-save-head')).toBe('Save your progress');
  });
});

describe('the crate theatre: flow states', () => {
  const liveCrates = (): void => { useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } }); };
  const epic = presetFor('epic', CRATE_FX_DEFAULTS);
  const ant = CRATE_FX_DEFAULTS.anticipationMs;

  it('idle -> in flight (anticipation holds) -> charge -> burst -> reveal -> settled, on the rarity timeline', async () => {
    vi.useFakeTimers();
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    expect(phase()).toBe('sealed');
    expect($('.crth')!.className).not.toContain('domcrate'); // Pixi is live: no DOM crate
    act(() => button('Open')!.click());
    await settle();
    expect(phase()).toBe('anticipation');
    expect(text('.crate-note')).toBe('Opening');
    expect(fxCalls).toEqual(['reset', 'anticipate']);
    expect($('.crate-reward')).toBeNull();
    advance(ant - 10);
    expect(phase()).toBe('anticipation'); // the answer is in, but the anticipation's minimum is not over
    advance(10);
    expect(phase()).toBe('charge');
    expect(fxCalls.at(-1)).toBe('charge:epic');
    advance(epic.chargeMs);
    expect(phase()).toBe('burst');
    expect(fxCalls.at(-1)).toBe('burst:epic');
    expect(text('.crth-skip')).toBe('Click to skip');
    expect(button('Done')).toBeUndefined(); // no leaving mid-sequence by button
    advance(Math.ceil(epic.burstMs * 0.35));
    expect(phase()).toBe('reveal');
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
    expect($('.crth')!.className).toContain('r-epic');
    advance(5000);
    expect(phase()).toBe('settled');
    expect(fxCalls.at(-1)).toBe('settle');
    expect($('.crth')!.className).not.toContain('skipped');
    expect(button('Done')).toBeTruthy();
    noDashes();
  });

  it('a slow server: the anticipation holds and says "Still opening"; the reveal lands when the answer does', async () => {
    vi.useFakeTimers();
    liveCrates();
    let answer: (v: unknown) => void = () => {};
    openCrateRemote.mockReturnValue(new Promise((r) => { answer = r; }));
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} />);
    await settle();
    advance(CRATE_FX_DEFAULTS.slowNoteMs + 10);
    expect(phase()).toBe('anticipation');
    expect(text('.crate-note')).toBe('Still opening');
    await act(async () => { answer({ status: 'ok', value: opened('c-9', 'title_wanderer', 9), profile: profile() }); });
    await settle();
    expect(phase()).toBe('charge'); // already past the minimum: straight into the charge
    expect(fxCalls.at(-1)).toBe('charge:common');
  });

  it('a failure: the anticipation holds, winds down, then "Could not open the crate. Try again."', async () => {
    vi.useFakeTimers();
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'error', reason: 'timeout' });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} />);
    await settle();
    expect(phase()).toBe('anticipation');
    advance(ant);
    expect(fxCalls.at(-1)).toBe('windDown');
    expect(phase()).toBe('anticipation');
    advance(CRATE_FX_DEFAULTS.windDownMs);
    expect(phase()).toBe('error');
    expect(text('.crate-note')).toBe('Could not open the crate. Try again.');
    expect(button('Try again')).toBeTruthy();
  });

  it('skip mid-sequence: a click on the theatre jumps to the settled reveal', async () => {
    vi.useFakeTimers();
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_the_unbroken', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} onClose={() => {}} />);
    await settle();
    advance(ant + 100);
    expect(phase()).toBe('charge');
    act(() => { $('.crth-scrim')!.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); });
    expect(phase()).toBe('settled');
    expect($('.crth')!.className).toContain('skipped');
    expect(fxCalls.at(-1)).toBe('skipToSettled:legendary');
    expect(text('.crate-reward-name')).toBe('The Unbroken');
    advance(10000); // the cancelled beats never fire
    expect(fxCalls.filter((c) => c.startsWith('burst') || c.startsWith('reveal'))).toEqual([]);
  });

  it('skip BEFORE the answer (a key): the reveal lands settled the moment the answer arrives', async () => {
    vi.useFakeTimers();
    liveCrates();
    let answer: (v: unknown) => void = () => {};
    openCrateRemote.mockReturnValue(new Promise((r) => { answer = r; }));
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} />);
    await settle();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); });
    expect(phase()).toBe('anticipation'); // nothing to reveal yet
    await act(async () => { answer({ status: 'ok', value: opened('c-9', 'title_ironbeard', 9), profile: profile() }); });
    await settle();
    expect(phase()).toBe('settled');
    expect(fxCalls.at(-1)).toBe('skipToSettled:rare');
    expect(text('.crate-reward-name')).toBe('Ironbeard');
  });

  it('reduced motion: no Pixi layer, no hold; the reward fades in', async () => {
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion />);
    expect($('.crth')!.className).toContain('reduced');
    expect($('.crth')!.className).toContain('domcrate');
    act(() => button('Open')!.click());
    await settle();
    expect(phase()).toBe('settled');
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
    expect(fxCalls).toEqual([]); // never created
  });

  it('the Pixi controller is destroyed with the theatre, and no beat fires after', async () => {
    vi.useFakeTimers();
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} />);
    await settle();
    advance(ant + 50);
    ui.unmount();
    ui = null;
    expect(fxCalls.at(-1)).toBe('destroy');
    const n = fxCalls.length;
    act(() => { vi.advanceTimersByTime(10000); });
    expect(fxCalls.length).toBe(n);
    expect($('.crth')).toBeNull();
  });
});

describe('React StrictMode (dev mounts every effect twice)', () => {
  it('the reveal still lands after the double mount, with one request', async () => {
    useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_kingbreaker', 9), profile: profile() });
    ui = mount(<StrictMode><CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion /></StrictMode>);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
    expect(openCrateRemote).toHaveBeenCalledTimes(1);
  });
});

describe('React StrictMode + autoOpen (the Collection and post-game path)', () => {
  it('the dev double mount does not strand the opening: the reveal lands, with one request and a live Pixi layer', async () => {
    vi.useFakeTimers();
    useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } });
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'title_wanderer', 9), profile: profile() });
    ui = mount(<StrictMode><CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} autoOpen reducedMotion={false} /></StrictMode>);
    await settle();
    expect(openCrateRemote).toHaveBeenCalledTimes(1);
    // the second controller was brought into the anticipation the first one had started
    expect(fxCalls.filter((c) => c === 'anticipate').length).toBe(2);
    advance(CRATE_FX_DEFAULTS.anticipationMs);
    expect(phase()).toBe('charge');
    advance(10000);
    expect(phase()).toBe('settled');
    expect(text('.crate-reward-name')).toBe('Wanderer');
  });
});
