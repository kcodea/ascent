// @vitest-environment jsdom
/**
 * PRACTICE "OPPONENT RANK" (owner 2026-10-13, R-PRACTICE-RANK-01): "when playing in practice mode, can we add an option
 * to select what rank the snapshots they face are in? this should be exactly what is already in place with what
 * snapshots a bronze vs silver vs gold player can face", then "we'd just add buttons that says All Ranks, Bronze,
 * Silver, Gold, Platinum". The row on the Practice screen, and the seam that tells the opponent pool which rank a
 * Practice launch wants.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { STRENGTH_BANDS, type PlayerProfile, type PracticeConfig } from '@game/sim';
import { mount, type Mounted } from './renderedText.mount';
import { useGame } from './store';
import { PracticeOptions } from './PracticeOptions';
import { lobbyBandFor, pendingPracticeRank, poolBandFor, seatExclusionsFor } from './boardStrength';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const open = (draft: Partial<PracticeConfig> = {}): HTMLElement => {
  act(() => { useGame.setState({ practiceSetupOpen: true, practiceDraft: { ...useGame.getState().practiceDraft, godMode: false, rank: 'all', ...draft } }); });
  ui = mount(<PracticeOptions />);
  return ui.container;
};
const row = (el: HTMLElement): HTMLElement => [...el.querySelectorAll<HTMLElement>('.porow')].find((r) => r.querySelector('.poseg')?.getAttribute('aria-label') === 'Opponent Rank')!;
const buttons = (el: HTMLElement) => [...row(el).querySelectorAll<HTMLButtonElement>('.poseg-btn')];
// jsdom has no PointerEvent; React's onPointerDown listens for the event TYPE, so a MouseEvent named 'pointerdown' drives it.
const press = (b: HTMLElement): void => { act(() => { b.dispatchEvent(new MouseEvent('pointerdown', { bubbles: true })); }); };

describe('the Practice screen: Opponent Rank', { timeout: 60_000 }, () => {
  it('offers All Ranks, Bronze, Silver, Gold and Platinum, All Ranks lit by default', () => {
    const el = open();
    expect(buttons(el).map((b) => b.textContent)).toEqual(['All Ranks', 'Bronze', 'Silver', 'Gold', 'Platinum']);
    expect(buttons(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['All Ranks']);
    expect(row(el).textContent).toContain('recorded players of every rank');
  });

  it('picking a rank writes it to the setup and says whose opponents you get', () => {
    const el = open();
    press(buttons(el).find((b) => b.textContent === 'Silver')!);
    expect(useGame.getState().practiceDraft.rank).toBe('silver');
    expect(buttons(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['Silver']);
    expect(row(el).textContent).toContain('a Silver player meets in ranked games');
    press(buttons(el).find((b) => b.textContent === 'All Ranks')!);
    expect(useGame.getState().practiceDraft.rank).toBe('all');
  });

  it('a setup saved before the row existed (no rank) opens on All Ranks', () => {
    const el = open({ rank: undefined });
    expect(buttons(el).filter((b) => b.getAttribute('aria-pressed') === 'true').map((b) => b.textContent)).toEqual(['All Ranks']);
  });

  it('is greyed and inert while God Mode is selected, like the other Sandbox options', () => {
    const el = open({ godMode: true, rank: 'gold' });
    expect(buttons(el).every((b) => b.disabled)).toBe(true);
    press(buttons(el).find((b) => b.textContent === 'Bronze')!);
    expect(useGame.getState().practiceDraft.rank).toBe('gold');
  });

  it('carries no native tooltip and no em dash', () => {
    const el = open({ rank: 'platinum' });
    expect(row(el).querySelector('[title]')).toBeNull();
    expect(row(el).textContent).not.toMatch(/—|--/);
  });
});

describe('which rank the opponent pool is sampled for', () => {
  const gold = { rank: { position: { divisionIndex: 0 } } } as unknown as Pick<PlayerProfile, 'rank'>;
  const mine = lobbyBandFor(gold);
  const state = (over: Partial<Parameters<typeof poolBandFor>[0]>): Parameters<typeof poolBandFor>[0] =>
    ({ pendingMode: 'practice', heroChoices: ['a', 'b', 'c'], practiceDraft: { rank: 'silver' }, profile: gold, ...over });

  it('a Practice hero picker asks for the picked rank; everything else asks for the player\'s own', () => {
    expect(pendingPracticeRank(state({}))).toBe('silver');
    expect(poolBandFor(state({}))).toEqual(STRENGTH_BANDS.Silver);
    expect(poolBandFor(state({ practiceDraft: { rank: 'all' } }))).toBeNull();
    expect(pendingPracticeRank(state({ practiceDraft: {} }))).toBe('all'); // an older setup
    // No picker open (the game is running, or the player is on the title), another mode, or God Mode.
    for (const s of [state({ heroChoices: null }), state({ pendingMode: 'lobby' }), state({ pendingMode: 'gauntlet' }), state({ practiceDraft: { rank: 'silver', godMode: true } })]) {
      expect(pendingPracticeRank(s)).toBeNull();
      expect(poolBandFor(s)).toEqual(mine);
    }
  });

  it('seat selection passes over the runs the loader names for the band, and adds nothing when there are none', () => {
    const asked: unknown[] = [];
    const loader = (keys: string[]) => ({ foreignRuns: (band: unknown) => { asked.push(band); return new Set(keys); } });
    expect(seatExclusionsFor(STRENGTH_BANDS.Bronze, loader(['a|b|1']))).toEqual({ excludeRuns: new Set(['a|b|1']) });
    expect(asked).toEqual([STRENGTH_BANDS.Bronze]);
    expect(seatExclusionsFor(null, loader([]))).toEqual({});
    expect(seatExclusionsFor(null, null)).toEqual({});
  });

  it('confirming the Practice setup opens its picker with the picked rank pending, and God Mode with none', () => {
    act(() => { useGame.setState({ practiceSetupOpen: true, practiceDraft: { ...useGame.getState().practiceDraft, godMode: false, rank: 'bronze' } }); });
    act(() => { useGame.getState().confirmPracticeSetup(); });
    expect(pendingPracticeRank(useGame.getState())).toBe('bronze');
    expect(poolBandFor(useGame.getState())).toEqual(STRENGTH_BANDS.Bronze);
    act(() => { useGame.getState().openTitle(); });
    expect(pendingPracticeRank(useGame.getState())).toBeNull();

    act(() => { useGame.setState({ practiceSetupOpen: true, practiceDraft: { ...useGame.getState().practiceDraft, godMode: true, rank: 'bronze' } }); });
    act(() => { useGame.getState().confirmPracticeSetup(); });
    expect(pendingPracticeRank(useGame.getState())).toBeNull();
    act(() => { useGame.getState().openTitle(); useGame.getState().setPracticeDraft({ godMode: false, rank: 'all' }); });
  });
});
