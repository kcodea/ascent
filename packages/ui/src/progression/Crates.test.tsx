// @vitest-environment jsdom
/**
 * LEVEL CRATES, THE CRATE THEATRE AND THE COLLECTION SCREEN (2026-09-28), rendered under jsdom with the network
 * seam mocked and the Pixi layer swapped for a recorder (jsdom has no WebGL):
 *  - crates off the end screen (2026-09-28): the New rewards pop-up in the Collection, Open / Open all, never twice;
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
import type { ChestTier, ChestTierPreset } from './crateFx/chestTiers';

// jsdom has no canvas: stub it BEFORE the imports below pull in pixi.js (which probes a canvas at load).
vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });

const openCrateRemote = vi.fn();
const equipTitleRemote = vi.fn();
const fetchOwnCrates = vi.fn(async () => undefined as unknown);
/** The cue player, spied (it plays nothing under jsdom either way): which cues the theatre asked for, at what gain. */
const playTailedClip = vi.fn((_clip: string, _category: string, _opts?: { gain?: number }): null => null);
vi.mock('../sfx', async (orig) => ({
  ...(await orig<typeof import('../sfx')>()),
  playTailedClip: (clip: string, category: string, opts?: { gain?: number }) => playTailedClip(clip, category, opts),
}));
vi.mock('../identity', async (orig) => ({ ...(await orig<typeof import('../identity')>()), currentUserId: () => 'u-1' }));
vi.mock('./progressionRemote', async (orig) => ({
  ...(await orig<typeof import('./progressionRemote')>()),
  openCrateRemote: (id: string) => openCrateRemote(id),
  equipTitleRemote: (id: string | null) => equipTitleRemote(id),
  fetchOwnCrates: () => fetchOwnCrates(),
}));

import { ProgressionPostgame } from './ProgressionPostgame';
import { CrateOpener } from './CrateOpener';
import { applyProgressionOutcome, resetProgressionForTests, useProgression } from './progressionStore';
import { CollectionPage } from './CollectionScreen';
import { resetNewRewardsForTests, useNewRewards } from './newRewards';
import { setCrateFxFactoryForTests } from './crateFx/crateFxPixi';
import { CRATE_FX_DEFAULTS, chestTierPresetFor, presetFor } from './crateFx/crateFxConfig';
import { crateLabel } from '@game/progression';
import { useGame } from '../store';


/** The Pixi layer, recorded: every beat the theatre asks for, in order. */
let fxCalls: string[] = [];
/** Every tier layer handed over, whole (`fxCalls` names only its tier). */
let fxLayers: ChestTierPreset[] = [];
/** What `setChest` answers (default: the tier asked for, at once) and what `mount` answers (default: live, at once). */
let chestAnswer: (tier: ChestTier) => Promise<ChestTier> = async (tier) => tier;
let mountAnswer: () => Promise<boolean> = async () => true;
function recorder(): CrateFx {
  const rec = (name: string) => (p?: CratePreset | number | object): void => { fxCalls.push(p && typeof p === 'object' && 'rarity' in p ? `${name}:${p.rarity}` : name); };
  return {
    mount: () => mountAnswer(), resize: () => {}, setSpeed: () => {}, setArt: () => {}, onPulse: () => {}, tune: () => {}, chestKind: () => 'art',
    // the chest tier: which chest was asked for, and which layer the theatre handed the scene
    setChest: (tier) => { fxCalls.push(`setChest:${tier}`); return chestAnswer(tier); },
    setTierLayer: (t) => { fxCalls.push(`setTierLayer:${t.tier}`); fxLayers.push(t); },
    reset: rec('reset'), anticipate: rec('anticipate'), charge: rec('charge'), burst: rec('burst'), reveal: rec('reveal'),
    settle: rec('settle'), skipToSettled: rec('skipToSettled'), windDown: rec('windDown'), destroy: rec('destroy'),
  };
}

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); setCrateFxFactoryForTests(null); });
beforeEach(() => {
  resetProgressionForTests();
  resetNewRewardsForTests();
  openCrateRemote.mockReset();
  equipTitleRemote.mockReset();
  fxCalls = [];
  fxLayers = [];
  chestAnswer = async (tier) => tier;
  mountAnswer = async () => true;
  playTailedClip.mockClear();
  setCrateFxFactoryForTests(recorder);
  useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null }, accountPanelOpen: false, showCollection: false, showCareer: false });
});

const profile = (over: Partial<ProgressionProfile> = {}): ProgressionProfile =>
  ({ accountXp: 325, accountLevel: 2, revision: 9, equippedTitleId: 'alpha_tester', titles: ['alpha_tester'], ...over });
const result = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 6, comeback: false,
  xp: { base: 100, topFour: 0, firstPlace: 0, comeback: 0, total: 100 },
  before: { lifetimeXp: 225, level: 1 }, after: { lifetimeXp: 325, level: 2 }, unlockedTitles: [], cratesAwarded: 1, crateIds: ['c-2'],
  revisionAfter: 8, settledAt: new Date().toISOString(), achievements: [], achievementXp: 0, aether: null, aetherBalance: null, ...over,
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

describe('crates moved off the end screen (owner 2026-09-28: "can you have the unlocks, achievements, and crates be a pop up when the player gets back to the collection?")', () => {
  const sealedRow = (crateId: string, earnedLevel = 2) => ({ crateId, earnedLevel, state: 'sealed' as const, rewardId: null, earnedAt: 't0', openedAt: null });
  /** A settlement lands (the real seam), then the player opens the Collection. */
  function landAndOpen(r: ProgressionResult, sealed: string[]): void {
    setup(r);
    applyProgressionOutcome({ userId: 'u-1', runId: 'run-1', mode: 'ranked' }, { status: 'confirmed', result: r, profile: profile(), deduped: false } as never);
    useProgression.setState({ crateList: sealed.map((id, i) => sealedRow(id, i + 2)) });
    ui = mount(<CollectionPage reducedMotion />);
  }

  it('the end screen shows no crate row and no Open button, only the one line pointing to the Collection', () => {
    setup(result());
    ui = mount(<ProgressionPostgame localKey="42" active reducedMotion />);
    expect($('.acctxp-crates')).toBeNull();
    expect(button('Open')).toBeUndefined();
    expect(text('.acctxp-waiting span:last-child')).toBe('New rewards are waiting in your Collection.');
    expect(openCrateRemote).not.toHaveBeenCalled();
    noDashes();
  });

  it('the Collection opens with the New rewards pop-up; Open plays the theatre on that crate; the pop-up never comes back', async () => {
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-2', 'title_stormcaller'), profile: profile({ titles: ['alpha_tester', 'title_stormcaller'], revision: 10 }) });
    landAndOpen(result(), ['c-2']);
    expect(text('.nrw-title')).toBe('New rewards');
    expect(text('.nrw-crates .nrw-kicker')).toBe('Chest earned');
    expect(text('.nrw-crates .nrw-note')).toBe('Level 2 Chest');
    act(() => document.querySelector<HTMLButtonElement>('.nrw-crates .crate-btn')!.click());
    await settle();
    expect($('.nrw-panel')).toBeNull();
    expect(openCrateRemote).toHaveBeenCalledWith('c-2');
    expect(text('.crate-reward-name')).toBe('Stormcaller');
    expect(useNewRewards.getState().unseen.crates).toEqual([]); // seen
    ui!.unmount();
    ui = mount(<CollectionPage reducedMotion />);
    expect($('.nrw-panel')).toBeNull();
  });

  it('a guest: the pop-up Open lands on the sign-in gate, not the theatre (owner 2026-09-29, a hard gate)', async () => {
    useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null } });
    landAndOpen(result(), ['c-2']);
    act(() => document.querySelector<HTMLButtonElement>('.nrw-crates .crate-btn')!.click());
    await settle();
    expect($('.crgate-panel')).not.toBeNull();
    expect($('.crth')).toBeNull();
    expect(openCrateRemote).not.toHaveBeenCalled();
  });

  it('several crates: "2 chests earned" with Open all', () => {
    landAndOpen(result({ cratesAwarded: 2, crateIds: ['c-1', 'c-2'], after: { lifetimeXp: 600, level: 3 } }), ['c-1', 'c-2']);
    expect(text('.nrw-crates .nrw-kicker')).toBe('2 chests earned');
    expect([...document.querySelectorAll('.nrw-crates button')].map((b) => b.textContent)).toEqual(['Open', 'Open all (2)']);
  });

  it('a crate already opened elsewhere drops out of the pop-up (and a pop-up left with nothing never shows)', async () => {
    landAndOpen(result(), []);
    await settle();
    expect($('.nrw-panel')).toBeNull();
  });

  it('a guest who earns a crate still gets the save prompt on the end screen', () => {
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
    // a crate with no tier opens the Standard chest with no layer (today's opening), before the anticipation starts
    expect(fxCalls).toEqual(['setChest:standard', 'setTierLayer:standard', 'reset', 'anticipate']);
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

  it('an Ancient opening (owner pick 2026-10-02, "Time stops"): charge -> FREEZE (drained, silent) -> burst with the prismatic crack', async () => {
    vi.useFakeTimers();
    liveCrates();
    const anc = presetFor('ancient', CRATE_FX_DEFAULTS);
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'frame_bonds', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    advance(ant);
    expect(phase()).toBe('charge');
    expect($('.crth')!.className).toContain('r-ancient');
    expect($('.crth')!.className).toContain('sig-timestop');
    advance(anc.chargeMs);
    expect(phase()).toBe('freeze');
    expect(text('.crth-skip')).toBe('Click to skip');
    expect($('.crth-crack')).toBeNull();
    advance(anc.freezeMs);
    expect(phase()).toBe('burst');
    expect(fxCalls.at(-1)).toBe('burst:ancient');
    expect($('.crth-crack')).not.toBeNull();
    advance(5000);
    expect(phase()).toBe('settled');
    expect(text('.crate-reward-name')).toBe('Bonds');
    expect(text('.crth-ribbon')).toBe('Ancient');
    noDashes();
  });

  it('a click while time is stopped skips straight to the Ancient reward', async () => {
    vi.useFakeTimers();
    liveCrates();
    const anc = presetFor('ancient', CRATE_FX_DEFAULTS);
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'frame_war', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    advance(ant + anc.chargeMs);
    expect(phase()).toBe('freeze');
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); });
    expect(phase()).toBe('settled');
    expect($('.crth')!.className).toContain('skipped');
    expect($('.crth-crack')).toBeNull();
    expect(text('.crate-reward-name')).toBe('War');
  });

  // Owner 2026-10-15: emotes are crate drops now. The reveal names it an emote and shows its bubble beside the plate.
  it('an EMOTE reward: "New emote", its name and rarity, and the painted bubble beside the plate', async () => {
    vi.useFakeTimers();
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'emote_rich_pimm', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); });
    advance(5000);
    expect(phase()).toBe('settled');
    expect(text('.crate-reward-kind')).toBe('New emote');
    expect(text('.crate-reward-name')).toBe('Rich Pimm');
    expect(text('.crth-ribbon')).toBe('Legendary');
    expect($('.crth-skin.emote img')!.getAttribute('src')).toMatch(/emote_rich_pimm/);
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

  it('a failure: the anticipation holds, winds down, then "Could not open the chest. Try again."', async () => {
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
    expect(text('.crate-note')).toBe('Could not open the chest. Try again.');
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

  it('a skin shows its art beside the plate (hero round, minion square); a title shows none', async () => {
    liveCrates();
    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-9', 'skin_albus_1', 9), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9 }]} reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect($('.crth-plate .crth-skin.hero img')?.getAttribute('src')).toContain('skin_albus_1');
    ui.unmount();

    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-8', 'skin_blackbelt_1', 8), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-8', earnedLevel: 8 }]} reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect($('.crth-plate .crth-skin.minion img')?.getAttribute('src')).toContain('skin_blackbelt_1');
    ui.unmount();

    openCrateRemote.mockResolvedValue({ status: 'ok', value: opened('c-7', 'title_kingbreaker', 7), profile: profile() });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-7', earnedLevel: 7 }]} reducedMotion />);
    act(() => button('Open')!.click());
    await settle();
    expect(text('.crate-reward-name')).toBe('Kingbreaker');
    expect($('.crth-skin')).toBeNull();
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

// TIERED CHEST OPENINGS (2026-10-19): the crate's tier (its guaranteed floor) reaches the effects, the sound and the
// theatre's class. The click feedback never waits on the chest art: the layer starts at once, the swap lands later.
describe('the chest tier in the theatre', () => {
  const liveCrates = (): void => { useProgression.setState({ capability: 'on', cratesCapability: 'on', mirror: { userId: 'u-1', ...profile() } }); };
  const ant = CRATE_FX_DEFAULTS.anticipationMs;
  /** Every crate answers with a reward of its own id's crate. */
  const answerEach = (rewardId = 'title_kingbreaker'): void => {
    openCrateRemote.mockImplementation(async (id: string) => ({ status: 'ok', value: opened(id, rewardId, 9), profile: profile() }));
  };
  const cueCategories = (): string[] => playTailedClip.mock.calls.map((c) => c[1]);
  const cueGain = (category: string): number | undefined => playTailedClip.mock.calls.find((c) => c[1] === category)?.[2]?.gain;
  const tierClass = (): string | undefined => $('.crth')?.className.match(/\bt-(\w+)/)?.[1];
  const skipKey = (): void => { act(() => { window.dispatchEvent(new KeyboardEvent('keydown', { key: ' ' })); }); };
  /** A `setChest` answer the test resolves by hand. */
  const deferredChest = (): { promise: Promise<ChestTier>; resolve: (t: ChestTier) => void } => {
    let resolve!: (t: ChestTier) => void;
    const promise = new Promise<ChestTier>((r) => { resolve = r; });
    return { promise, resolve };
  };

  it('the tier reaches the effects: setChest(epic), then the Epic layer, before the anticipation starts', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach('title_the_unbroken'); // a Legendary reward out of an Epic chest
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9, tier: 'epic' }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    expect(tierClass()).toBe('epic'); // sealed, the class already names the chest
    act(() => button('Open')!.click());
    await settle();
    const chest = fxCalls.indexOf('setChest:epic');
    const layer = fxCalls.indexOf('setTierLayer:epic');
    expect(chest).toBeGreaterThanOrEqual(0);
    expect(layer).toBeGreaterThan(chest);
    expect(fxCalls.indexOf('anticipate')).toBeGreaterThan(layer);
    expect(fxLayers.at(-1)).toEqual(chestTierPresetFor('epic', CRATE_FX_DEFAULTS));
    expect(fxCalls.filter((c) => c.startsWith('setTierLayer'))).toEqual(['setTierLayer:epic']); // drawn as asked: no switch
    expect(tierClass()).toBe('epic');
    // the reward still drives the dials: an Epic chest with a Legendary reward charges on the Legendary preset
    advance(ant);
    expect(fxCalls.at(-1)).toBe('charge:legendary');
    expect(fxLayers.at(-1)?.tier).toBe('epic'); // and the chest's layer stays its own
  });

  it('open next swaps the chest: Standard, then Rare, and the class follows', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach();
    ui = mount(<CrateOpener queue={[{ crateId: 'c-1', earnedLevel: 2, tier: 'standard' }, { crateId: 'c-2', earnedLevel: 3, tier: 'rare' }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    expect(tierClass()).toBe('standard');
    skipKey();
    expect(phase()).toBe('settled');
    act(() => button('Open next')!.click());
    await settle();
    expect(tierClass()).toBe('rare');
    expect(fxCalls.filter((c) => c.startsWith('setChest'))).toEqual(['setChest:standard', 'setChest:rare']);
    expect(fxCalls.filter((c) => c.startsWith('setTierLayer'))).toEqual(['setTierLayer:standard', 'setTierLayer:rare']);
  });

  it('tier cues play at the tier\x27s own gain: Rare shimmers only; Ancient shimmers, swirls and bursts; Standard plays none', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach('title_ironbeard');
    const run = async (tier: ChestTier): Promise<void> => {
      playTailedClip.mockClear();
      ui?.unmount();
      ui = mount(<CrateOpener queue={[{ crateId: `c-${tier}`, earnedLevel: 9, tier }]} reducedMotion={false} onClose={() => {}} />);
      await settle();
      act(() => button('Open')!.click());
      await settle();
      advance(20000);
      expect(phase()).toBe('settled');
    };
    await run('rare');
    expect(cueCategories()).toContain('crateTierShimmer');
    expect(cueGain('crateTierShimmer')).toBeCloseTo(CRATE_FX_DEFAULTS.rareShimmerGain);
    expect(cueCategories()).not.toContain('crateTierSwirl'); // Rare's swirl gain is 0: skipped, never played silent
    expect(cueCategories()).not.toContain('crateTierBurst');
    await run('ancient');
    expect(cueCategories()).toEqual(expect.arrayContaining(['crateTierShimmer', 'crateTierSwirl', 'crateTierBurst']));
    expect(cueGain('crateTierSwirl')).toBeCloseTo(CRATE_FX_DEFAULTS.ancientSwirlGain);
    expect(cueGain('crateTierBurst')).toBeCloseTo(CRATE_FX_DEFAULTS.ancientBurstGain);
    // the shimmer is the click feedback: it plays with the hum, before the answer's charge
    const cats = cueCategories();
    expect(cats.indexOf('crateTierShimmer')).toBeLessThan(cats.indexOf('crateCharge'));
    await run('standard');
    expect(cueCategories().filter((c) => c.startsWith('crateTier'))).toEqual([]);
  });

  it('reduced motion shows the tier name: a milestone crate names its chest, wears its tier class, and calls no Pixi', async () => {
    liveCrates();
    answerEach();
    const item = { crateId: 'c-m10', earnedLevel: null, source: 'milestone:10', tier: 'legendary' as const };
    ui = mount(<CrateOpener queue={[item]} reducedMotion />);
    expect(text('.crate-name')).toBe(crateLabel({ earnedLevel: null, source: 'milestone:10' }));
    expect(text('.crate-name')).toMatch(/Legendary (Crate|Chest)/);
    expect(tierClass()).toBe('legendary');
    act(() => button('Open')!.click());
    await settle();
    expect(phase()).toBe('settled');
    expect(tierClass()).toBe('legendary');
    expect(fxCalls).toEqual([]); // never created
  });

  it('a bought chest names its own tier on the nameplate (a shop crate reads its floor)', () => {
    liveCrates();
    const source = `shop:${'0'.repeat(8)}-0000-4000-8000-${'0'.repeat(12)}`;
    ui = mount(<CrateOpener queue={[{ crateId: 'c-s', earnedLevel: null, source, tier: 'epic' }]} reducedMotion />);
    expect(text('.crate-name')).toBe(crateLabel({ earnedLevel: null, source, floor: 'epic' }));
    expect(text('.crate-name')).toMatch(/Epic (Crate|Chest)/);
  });

  it('art that is late or fails: the opening starts on the asked tier\x27s layer, then switches to the Standard one it got', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach();
    chestAnswer = async () => 'standard';
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9, tier: 'ancient' }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    expect(fxCalls.filter((c) => c.startsWith('setTierLayer'))).toEqual(['setTierLayer:ancient', 'setTierLayer:standard']);
    expect(cueCategories()).toContain('crateTierShimmer'); // the click feedback had already played
    advance(20000);
    // the swirl and the burst follow the layer actually drawn: none on the Standard chest
    expect(cueCategories()).not.toContain('crateTierSwirl');
    expect(cueCategories()).not.toContain('crateTierBurst');
  });

  it('a stale chest answer never touches the next opening (the first setChest resolves late, after Open next)', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach();
    const first = deferredChest();
    let calls = 0;
    chestAnswer = (tier) => (++calls === 1 ? first.promise : Promise.resolve(tier));
    ui = mount(<CrateOpener queue={[{ crateId: 'c-1', earnedLevel: 2, tier: 'epic' }, { crateId: 'c-2', earnedLevel: 3, tier: 'rare' }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    act(() => button('Open')!.click());
    await settle();
    skipKey();
    act(() => button('Open next')!.click());
    await settle();
    expect(fxLayers.at(-1)?.tier).toBe('rare');
    const before = fxCalls.length;
    // the superseded call resolves with the chest drawn before (Task 3's contract): it must be dropped
    await act(async () => { first.resolve('standard'); await Promise.resolve(); });
    await settle();
    expect(fxCalls.length).toBe(before);
    expect(fxLayers.at(-1)?.tier).toBe('rare');
    advance(20000);
    expect(cueCategories()).not.toContain('crateTierSwirl'); // Rare's own: none (not Epic's)
  });

  it('before Pixi is up (the bay\x27s autoOpen): the layer is handed over at once; the chest swap waits for the mount', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach();
    let mounted!: (ok: boolean) => void;
    mountAnswer = () => new Promise<boolean>((r) => { mounted = r; });
    ui = mount(<CrateOpener queue={[{ crateId: 'c-9', earnedLevel: 9, tier: 'legendary' }]} autoOpen reducedMotion={false} />);
    await settle();
    expect(phase()).toBe('anticipation');
    expect(fxCalls).toContain('setTierLayer:legendary');
    expect(fxCalls).toContain('anticipate'); // the click feedback did not wait
    expect(fxCalls.filter((c) => c.startsWith('setChest'))).toEqual([]);
    await act(async () => { mounted(true); await Promise.resolve(); });
    await settle();
    expect(fxCalls.filter((c) => c.startsWith('setChest'))).toEqual(['setChest:legendary']);
    expect(fxCalls.filter((c) => c.startsWith('setTierLayer'))).toEqual(['setTierLayer:legendary']);
  });

  it('Pixi fails: the DOM chest wears the tier class, and the next opening asks Pixi for no chest and no layer', async () => {
    vi.useFakeTimers();
    liveCrates();
    answerEach();
    mountAnswer = async () => false;
    ui = mount(<CrateOpener queue={[{ crateId: 'c-1', earnedLevel: 2, tier: 'rare' }, { crateId: 'c-2', earnedLevel: 3, tier: 'epic' }]} reducedMotion={false} onClose={() => {}} />);
    await settle();
    expect($('.crth')!.className).toContain('domcrate');
    expect(tierClass()).toBe('rare');
    act(() => button('Open')!.click());
    await settle();
    skipKey();
    act(() => button('Open next')!.click());
    await settle();
    expect(tierClass()).toBe('epic');
    expect(fxCalls.filter((c) => c.startsWith('setChest') || c.startsWith('setTierLayer'))).toEqual([]);
  });
});
