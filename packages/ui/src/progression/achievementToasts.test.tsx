// @vitest-environment jsdom
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { mount, type Mounted } from '../renderedText.mount';
import type { RunState } from '@game/sim';
import { achievementToastContextOf, enqueueAchievementToasts, installAchievementToasts, resetAchievementToastsForTests, shiftAchievementToast, useAchievementToasts } from './achievementToasts';
import { AchievementToast } from './AchievementToast';
import { useProgression } from './progressionStore';

const human = { id: 's0', alive: true, source: 'player' } as const;
const run = (o: Partial<RunState>): RunState => ({ mode: 'lobby', phase: 'recruit', heroId: 'warden', setId: 'set2', seed: 7, ...o } as unknown as RunState);
const ratedLobby = { seats: [human, { id: 's1', alive: true, source: 'snapshot' }], unrated: undefined } as unknown as RunState['lobby'];

describe('achievementToastContextOf (R-ACH-TOAST-01)', () => {
  it('a rated lobby is Ranked, with its hero and set', () => {
    expect(achievementToastContextOf(run({ lobby: ratedLobby }))).toEqual({ mode: 'ranked', eligibleRun: true, setId: 'set2', heroId: 'warden' });
  });
  it('an all-generated (unrated) lobby, a sandbox, God Mode, Duos and a finished game never toast mid-game', () => {
    expect(achievementToastContextOf(run({ lobby: { ...ratedLobby!, unrated: 'all-generated' } as RunState['lobby'] }))).toBeNull();
    expect(achievementToastContextOf(run({ lobby: ratedLobby, sandbox: true }))).toBeNull();
    expect(achievementToastContextOf(run({ lobby: ratedLobby, sandbox: true, godMode: true }))).toBeNull();
    expect(achievementToastContextOf(run({ lobby: ratedLobby, duos: {} as RunState['duos'] }))).toBeNull();
    expect(achievementToastContextOf(run({ lobby: ratedLobby, phase: 'gameover' }))).toBeNull();
  });
  it('Practice counts only with Normal Health and a turn timer, and never for a hero', () => {
    const cfg = (health: 'normal' | 'unlimited', timeMult: 0 | 1) => ({ opponents: 'players', botDifficulty: 3, health, timeMult, tribes: [] }) as unknown as RunState['practiceConfig'];
    expect(achievementToastContextOf(run({ mode: 'practice', practiceConfig: cfg('normal', 1) }))).toEqual({ mode: 'practice', eligibleRun: true, setId: 'set2', heroId: null });
    expect(achievementToastContextOf(run({ mode: 'practice', practiceConfig: cfg('unlimited', 1) }))).toBeNull();
    expect(achievementToastContextOf(run({ mode: 'practice', practiceConfig: cfg('normal', 0) }))).toBeNull();
  });
  it('the tutorial, the Gauntlet and Versus are left to the settlement', () => {
    for (const mode of ['tutorial', 'gauntlet', 'versus'] as const) expect(achievementToastContextOf(run({ mode }))).toBeNull();
  });
});

describe('the toast queue', () => {
  let m: Mounted | null = null;
  afterEach(() => { m?.unmount(); m = null; resetAchievementToastsForTests(); useProgression.setState({ current: null, capability: 'unknown', achievementsCapability: 'unknown' }); });

  it('shows one at a time, names the achievement and its XP, and skips ids it does not know', () => {
    enqueueAchievementToasts(['economy.spend_turn_20', 'nope.unknown', 'first.gild']);
    expect(useAchievementToasts.getState().queue.map((q) => q.id)).toEqual(['economy.spend_turn_20', 'first.gild']);
    m = mount(<AchievementToast />);
    const container = m.container;
    expect(container.querySelectorAll('.achtoast')).toHaveLength(1);
    expect(container.textContent).toContain('Achievement unlocked');
    expect(container.textContent).toContain('Big Turn');
    expect(container.textContent).toContain('+50 XP');
    act(() => shiftAchievementToast(useAchievementToasts.getState().queue[0]!.key));
    expect(container.textContent).toContain('Worth Three');
  });

  it('the settlement answer toasts what it granted, minus what this game already showed, and never a duplicate answer', () => {
    const stop = installAchievementToasts();
    useProgression.setState({ capability: 'on', achievementsCapability: 'on' });
    const result = { achievements: ['economy.spend_turn_20', 'ranked.first_win'] } as never;
    // Already announced mid-game for this game (seed 7).
    localStorage.setItem('ascent.achtoast.shown', JSON.stringify({ game: '7', ids: ['economy.spend_turn_20'] }));
    useProgression.setState({ current: { localKey: '7', mode: 'ranked', runId: 'r', state: 'confirmed', result, deduped: true, error: null } });
    expect(useAchievementToasts.getState().queue).toEqual([]);
    useProgression.setState({ current: { localKey: '7', mode: 'ranked', runId: 'r', state: 'confirmed', result, deduped: false, error: null } });
    expect(useAchievementToasts.getState().queue.map((q) => q.id)).toEqual(['ranked.first_win']);
    stop();
  });
});
