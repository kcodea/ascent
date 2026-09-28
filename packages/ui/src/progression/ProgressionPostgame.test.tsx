// @vitest-environment jsdom
/**
 * THE POST-GAME ACCOUNT XP PANEL (2026-09-27), rendered under jsdom: the breakdown per mode, the level-up
 * moment, the Alpha Tester reveal, the anonymous "Save your progress" prompt (and its absence for a signed-in
 * player), the pending / sync-later states, the feature flag hiding everything, the rank screen's turn
 * (`active`), reduced motion, and the ceremony playing once. No native tooltips, no em dashes.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import type { ProgressionResult } from '@game/progression';
import { mount, type Mounted } from '../renderedText.mount';
import { ProgressionPostgame } from './ProgressionPostgame';
import { resetProgressionForTests, useProgression, wasProgressionPresented, type CurrentRunProgression } from './progressionStore';
import { useGame } from '../store';

// Importing the store pulls pixi in; jsdom has no 2D context (and logs "not implemented" without this).
HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext'];

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; vi.useRealTimers(); });
beforeEach(() => {
  resetProgressionForTests();
  useGame.setState({ account: { userId: 'u-1', email: null, anonymous: true, discriminator: null }, accountPanelOpen: false });
});

const result = (over: Partial<ProgressionResult> = {}): ProgressionResult => ({
  runId: 'run-1', mode: 'ranked', rulesVersion: 1, placement: 1, comeback: true,
  xp: { base: 100, topFour: 40, firstPlace: 60, comeback: 25, total: 225 },
  before: { lifetimeXp: 100, level: 1 }, after: { lifetimeXp: 325, level: 2 }, unlockedTitles: ['alpha_tester'], cratesAwarded: 0, crateIds: [], revisionAfter: 1,
  settledAt: new Date().toISOString(), achievements: [], achievementXp: 0, ...over,
});
function setCurrent(over: Partial<CurrentRunProgression> = {}, capability: 'on' | 'off' | 'unknown' = 'on'): void {
  useProgression.setState({
    capability,
    current: { localKey: '42', mode: 'ranked', runId: 'run-1', state: 'confirmed', result: result(), deduped: false, error: null, ...over },
  });
}
const render = (props: Partial<Parameters<typeof ProgressionPostgame>[0]> = {}): Mounted =>
  (ui = mount(<ProgressionPostgame localKey="42" active reducedMotion {...props} />));
const text = (sel: string): string => (ui!.container.querySelector(sel)?.textContent ?? '').replace(/\s+/g, ' ').trim();
const all = (sel: string): string[] => [...ui!.container.querySelectorAll(sel)].map((n) => (n.textContent ?? '').replace(/\s+/g, ' ').trim());

describe('a settled ranked result', () => {
  it('prints the breakdown (complete / Top 4 / first / comeback) and the total', () => {
    setCurrent();
    render();
    expect(text('.acctxp-total')).toBe('+225 XP');
    expect(all('.acctxp-line')).toEqual(['Game complete+100 XP', 'Top 4+40 XP', 'First place+60 XP', 'Comeback+25 XP']);
  });
  it('the level-up moment and the Alpha Tester reveal on reaching Level 2', () => {
    setCurrent();
    render();
    expect(text('.acctxp-levelup')).toBe('Level up! Level 2');
    expect(text('.acctxp-titlereveal-name')).toBe('Alpha Tester');
    expect(text('.acctxp-level')).toBe('Lv2');
    expect(text('.acctxp-num')).toBe('75 / 250');
  });
  it('a plain placement leaves out the zero rows; no crossing, no level-up, no reveal', () => {
    setCurrent({ result: result({ placement: 6, comeback: false, xp: { base: 100, topFour: 0, firstPlace: 0, comeback: 0, total: 100 }, before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 100, level: 1 }, unlockedTitles: [] }) });
    render();
    expect(all('.acctxp-line')).toEqual(['Game complete+100 XP']);
    expect(ui!.container.querySelector('.acctxp-levelup')).toBeNull();
    expect(ui!.container.querySelector('.acctxp-titlereveal')).toBeNull();
    expect(ui!.container.querySelector('.acctxp-save')).toBeNull();
  });
  it('several levels at once: ONE summary, never a ceremony per level', () => {
    setCurrent({ result: result({ before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 1000, level: 5 }, xp: { base: 1000, topFour: 0, firstPlace: 0, comeback: 0, total: 1000 } }) });
    render();
    expect(all('.acctxp-levelup')).toEqual(['Level up! Level 5 (+4 levels)']);
  });
});

describe('practice and tutorial', () => {
  it('practice shows its scaled numbers; no placement reads "Practice complete" at a flat 60', () => {
    setCurrent({ mode: 'practice', runId: 'practice:9', result: result({ mode: 'practice', runId: 'practice:9', xp: { base: 60, topFour: 24, firstPlace: 36, comeback: 15, total: 135 }, before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 135, level: 1 }, unlockedTitles: [] }) });
    render();
    expect(all('.acctxp-line')).toEqual(['Practice game complete+60 XP', 'Top 4+24 XP', 'First place+36 XP', 'Comeback+15 XP']);
    ui!.unmount();
    setCurrent({ mode: 'practice', runId: 'practice:10', result: result({ mode: 'practice', runId: 'practice:10', placement: null, comeback: false, xp: { base: 60, topFour: 0, firstPlace: 0, comeback: 0, total: 60 }, before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 60, level: 1 }, unlockedTitles: [] }) });
    render();
    expect(all('.acctxp-line')).toEqual(['Practice complete+60 XP']);
  });
  it('tutorial: 250 and straight to Level 2; a much later duplicate says it was already earned', () => {
    setCurrent({ mode: 'tutorial', runId: 'learn-ascent:v1', result: result({ mode: 'tutorial', runId: 'learn-ascent:v1', placement: null, comeback: false, xp: { base: 250, topFour: 0, firstPlace: 0, comeback: 0, total: 250 }, before: { lifetimeXp: 0, level: 1 }, after: { lifetimeXp: 250, level: 2 } }) });
    render();
    expect(all('.acctxp-line')).toEqual(['Tutorial complete+250 XP']);
    expect(text('.acctxp-titlereveal-name')).toBe('Alpha Tester');
    ui!.unmount();
    setCurrent({ mode: 'tutorial', runId: 'learn-ascent:v1', deduped: true, result: result({ mode: 'tutorial', runId: 'learn-ascent:v1', settledAt: '2026-01-01T00:00:00Z' }) });
    render();
    expect(text('.acctxp-status')).toBe('Tutorial XP already earned.');
  });
});

describe('the anonymous save prompt', () => {
  it('an anonymous player reaching Level 2 gets the gentle prompt, and its button opens the account panel', () => {
    setCurrent();
    render();
    expect(text('.acctxp-save-head')).toBe('Save your progress');
    expect(text('.acctxp-save-body')).not.toMatch(/[—–]/);
    const btn = ui!.container.querySelector<HTMLButtonElement>('.acctxp-save-btn')!;
    expect(btn.textContent).toBe('Create account');
    act(() => btn.click());
    expect(useGame.getState().accountPanelOpen).toBe(true);
  });
  it('a signed-in player never sees it', () => {
    useGame.setState({ account: { userId: 'u-1', email: 'kev@example.com', anonymous: false, discriminator: null } });
    setCurrent();
    render();
    expect(ui!.container.querySelector('.acctxp-save')).toBeNull();
    expect(text('.acctxp-titlereveal-name')).toBe('Alpha Tester');
  });
  it('an anonymous player who did not reach Level 2 in this game is not nagged', () => {
    setCurrent({ result: result({ before: { lifetimeXp: 300, level: 2 }, after: { lifetimeXp: 400, level: 2 }, unlockedTitles: [] }) });
    render();
    expect(ui!.container.querySelector('.acctxp-save')).toBeNull();
  });
});

describe('states and the feature flag', () => {
  it('pending, then "Progress pending. It will sync automatically." on a failure', () => {
    setCurrent({ state: 'pending', result: null });
    render();
    expect(text('.acctxp-status')).toBe('Adding Account XP');
    ui!.unmount();
    setCurrent({ state: 'retryable', result: null, error: 'timeout' });
    render();
    expect(text('.acctxp-status')).toBe('Progress pending. It will sync automatically.');
  });
  it('nothing at all while the feature is off or unknown, for a run with no XP, a rejected run, another run, or while the rank screen plays', () => {
    for (const cap of ['off', 'unknown'] as const) { setCurrent({}, cap); render(); expect(ui!.container.innerHTML, cap).toBe(''); ui!.unmount(); }
    setCurrent({ state: 'none', result: null }); render(); expect(ui!.container.innerHTML).toBe(''); ui!.unmount();
    setCurrent({ state: 'rejected', result: null }); render(); expect(ui!.container.innerHTML).toBe(''); ui!.unmount();
    setCurrent({ localKey: '999' }); render(); expect(ui!.container.innerHTML).toBe(''); ui!.unmount();
    setCurrent(); render({ active: false }); expect(ui!.container.innerHTML).toBe('');
  });
  it('no native title tooltips anywhere in the panel', () => {
    setCurrent();
    render();
    expect(ui!.container.querySelector('[title]')).toBeNull();
  });
});

describe('motion', () => {
  it('animated: the bar starts on the OLD level, sweeps, levels up, then settles; plays once', () => {
    vi.useFakeTimers();
    setCurrent();
    render({ reducedMotion: false });
    expect(text('.acctxp-level')).toBe('Lv1');
    expect(text('.acctxp-num')).toBe('100 / 250');
    expect(ui!.container.querySelector('.acctxp-titlereveal')).toBeNull();
    act(() => { vi.advanceTimersByTime(350); });
    const fill = ui!.container.querySelector<HTMLElement>('.acctxp-fill')!;
    expect(fill.style.transform).toBe('scaleX(1)');
    act(() => { vi.advanceTimersByTime(900); });
    expect(text('.acctxp-levelup')).toBe('Level up! Level 2');
    expect(text('.acctxp-level')).toBe('Lv2');
    act(() => { vi.advanceTimersByTime(1200); });
    expect(text('.acctxp-titlereveal-name')).toBe('Alpha Tester');
    expect(fill.style.transform).toBe('scaleX(0.3)');
    expect(wasProgressionPresented('ranked', 'run-1')).toBe(true);
    // A remount (Rewatch, a reload, a duplicate answer) settles at once: no replayed ceremony.
    ui!.unmount();
    render({ reducedMotion: false });
    expect(text('.acctxp-titlereveal-name')).toBe('Alpha Tester');
    expect(ui!.container.querySelector('.acctxp.animated')).toBeNull();
  });
  it('reduced motion: the final state at once, no transition', () => {
    setCurrent();
    render({ reducedMotion: true });
    expect(ui!.container.querySelector('.acctxp.animated')).toBeNull();
    expect(ui!.container.querySelector<HTMLElement>('.acctxp-fill')!.style.transition).toBe('none');
    expect(text('.acctxp-level')).toBe('Lv2');
  });
});

describe('achievements unlocked (batch 1, 2026-09-28)', () => {
  const ids = ['career.games.1', 'ranked.first_game', 'ranked.first_top_four', 'ranked.first_win', 'ranked.reach_bronze_2', 'ranked.reach_bronze_3', 'ranked.reach_silver_1', 'hero.warden.victory'];
  it('lists "Achievement unlocked: <name> +N XP" rows after the bar; the headline total includes their XP', () => {
    setCurrent({ result: result({ achievements: ['career.games.1', 'ranked.first_win'], achievementXp: 125, after: { lifetimeXp: 450, level: 2 } }) });
    render();
    expect(text('.acctxp-total')).toBe('+350 XP');
    expect(all('.acctxp-ach-row')).toEqual(['Achievement unlocked: First Steps +25 XP', 'Achievement unlocked: First Among Eight +100 XP']);
    expect(ui!.container.querySelector('.acctxp-ach')!.getAttribute('aria-label')).toBe('Achievements unlocked');
  });
  it('shows the first six, then "+N more"; unknown ids (a newer server) are skipped', () => {
    setCurrent({ result: result({ achievements: [...ids, 'future.thing'], achievementXp: 0 }) });
    render();
    expect(all('.acctxp-ach-row')).toHaveLength(6);
    expect(text('.acctxp-ach-more')).toBe('+2 more achievements. See your Career.');
  });
  it('none completed (or a pre-achievements server): no rows at all', () => {
    setCurrent();
    render();
    expect(ui!.container.querySelector('.acctxp-ach')).toBeNull();
  });
  it('the rows wait for the bar to settle when animated, then enter one-shot', () => {
    vi.useFakeTimers();
    setCurrent({ result: result({ achievements: ['career.games.1'], achievementXp: 25 }) });
    render({ reducedMotion: false });
    expect(ui!.container.querySelector('.acctxp-ach')).toBeNull();
    act(() => { vi.advanceTimersByTime(5000); });
    expect(all('.acctxp-ach-row')).toEqual(['Achievement unlocked: First Steps +25 XP']);
  });
});
