// @vitest-environment jsdom
/**
 * VERSUS DUOS — THE TEAMMATE PORTRAIT'S SIGNALS AND THE TEAM RAIL (owner 2026-10-27; R-DUOS-MATE-SIGNALS-01,
 * R-DUOS-RAIL-TEAM-01):
 *  - "if a teammate tiers their shop up, can you play a similar burst animation over their portrait": their stream's tier
 *    going up plays the player's own `shop-tier-up` over the bottom-right disc;
 *  - "if a teammate's end of turn effects are going off, causing an end of turn hang, can you play a glow or effect on the
 *    teammate's portrait so players know the game isnt frozen": `.duosdock.working` while the round waits on their screen;
 *  - "tie the teammates together better by putting them into chunkier rail slots as a team": one slot per team.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { act } from 'react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
vi.mock('./teammateView', () => ({ enterTeammateView: vi.fn(), exitTeammateView: vi.fn() }));
const playDef = vi.fn(() => null);
vi.mock('../fx/playDef', async (orig) => ({ ...(await orig<typeof import('../fx/playDef')>()), playDef }));

const { mount } = await import('../renderedText.mount');
const { DuosMateDock, DOCK_TIER_FX_SCALE } = await import('./DuosMateDock');
const { useVersus } = await import('./versusStore');
const { useGame } = await import('../store');
const { mateWorking, noteMateFrame, resetDuosMateSignals, useDuosMateSignals } = await import('./duosMateSignals');
const { duosRailTeams, duosTeamHealthRow, duosRailTeamOf } = await import('./duosRailTeams');

const seat = (s: string, userId: string, name: string, hero: string, ready = false) => ({ seat: s, userId, name, hero, ready });
function setMatch(phase: string, round: number, mateReady = false, meReady = false): void {
  useVersus.setState({
    room: { members: [] }, readyRound: null,
    match: { round, phase, p1_ready: meReady, group: { me: 'p1', duos: { team: 'a', mate: 'p2', first: { a: 'p1', b: 'p3' } }, raw: { seats: [
      seat('p1', 'u1', 'Ann', 'warden'), seat('p2', 'u2', 'Bob', 'warden', mateReady), seat('p3', 'u3', 'Cy', 'warden'), seat('p4', 'u4', 'Di', 'warden'),
    ] } } },
  } as never);
}
const view = (wave: number, phase: string, tier: number) => ({ wave, phase, tier, heroId: 'warden' });

beforeEach(() => { resetDuosMateSignals(); setMatch('shop', 3); });
afterEach(() => { vi.clearAllMocks(); resetDuosMateSignals(); useVersus.setState({ room: null, match: null } as never); });

describe('the teammate stream, as signals (R-DUOS-MATE-SIGNALS-01)', () => {
  it('a tier going UP between two frames is one tier-up; the first frame, a repeat or a drop is none', () => {
    noteMateFrame('p2', null, view(3, 'recruit', 2), undefined);
    expect(useDuosMateSignals.getState().tierPop.p2 ?? 0).toBe(0);
    noteMateFrame('p2', view(3, 'recruit', 2), view(3, 'recruit', 2), undefined);
    expect(useDuosMateSignals.getState().tierPop.p2 ?? 0).toBe(0);
    noteMateFrame('p2', view(3, 'recruit', 2), view(3, 'recruit', 3), undefined);
    expect(useDuosMateSignals.getState().tierPop.p2).toBe(1);
    noteMateFrame('p2', view(3, 'recruit', 3), view(3, 'recruit', 1), undefined);
    expect(useDuosMateSignals.getState().tierPop.p2).toBe(1);
  });

  it('a frame that moves nothing the signals read writes nothing (no render)', () => {
    noteMateFrame('p2', null, view(3, 'recruit', 2), undefined);
    const before = useDuosMateSignals.getState();
    noteMateFrame('p2', view(3, 'recruit', 2), { ...view(3, 'recruit', 2), gold: 9 }, undefined);
    expect(useDuosMateSignals.getState()).toBe(before);
  });

  it('their End Turn press with beats marks the round; a new round forgets it', () => {
    noteMateFrame('p2', null, view(3, 'recruit', 2), [{ t: 'endTurn', eot: { batch: [] } }]);
    expect(useDuosMateSignals.getState().seen.p2?.eotWave).toBe(3);
    noteMateFrame('p2', view(3, 'recruit', 2), view(4, 'recruit', 2), undefined);
    expect(useDuosMateSignals.getState().seen.p2?.eotWave).toBeNull();
  });

  const base = { round: 3, myWave: 3, myPhase: 'combat', meBack: false, mateBack: false, away: false };
  it('working while their End of Turn goes off: the round is closed and their screen is still on its shop', () => {
    expect(mateWorking({ ...base, matchPhase: 'combat', seen: { wave: 3, phase: 'recruit', eotWave: null } })).toBe(true);
    expect(mateWorking({ ...base, matchPhase: 'resolving', seen: { wave: 3, phase: 'recruit', eotWave: 3 } })).toBe(true);
  });
  it('not working while they are only shopping, once they are in the fight, while away, or before any frame', () => {
    expect(mateWorking({ ...base, matchPhase: 'shop', myPhase: 'recruit', seen: { wave: 3, phase: 'recruit', eotWave: null } })).toBe(false);
    expect(mateWorking({ ...base, matchPhase: 'resolving', seen: { wave: 3, phase: 'recruit', eotWave: null } })).toBe(false);
    expect(mateWorking({ ...base, matchPhase: 'combat', seen: { wave: 3, phase: 'combat', eotWave: 3 } })).toBe(false);
    expect(mateWorking({ ...base, matchPhase: 'combat', away: true, seen: { wave: 3, phase: 'recruit', eotWave: null } })).toBe(false);
    expect(mateWorking({ ...base, matchPhase: 'combat', seen: null })).toBe(false);
  });
  it('working while I am back from the fight and their late fight is still playing; not once they are back', () => {
    const seen = { wave: 3, phase: 'combat', eotWave: null };
    expect(mateWorking({ ...base, matchPhase: 'combat', meBack: true, seen })).toBe(true);
    expect(mateWorking({ ...base, matchPhase: 'combat', meBack: true, mateBack: true, seen })).toBe(false);
    expect(mateWorking({ ...base, matchPhase: 'combat', meBack: false, seen })).toBe(false);
  });
});

describe('the teammate portrait plays them', () => {
  it('a tier-up plays the player\'s own tier-up burst over the disc, once per tier-up, never on mount', () => {
    noteMateFrame('p2', null, view(3, 'recruit', 1), undefined);
    noteMateFrame('p2', view(3, 'recruit', 1), view(3, 'recruit', 2), undefined); // before the dock mounts: not replayed
    const ui = mount(<DuosMateDock watching={false} />);
    try {
      const hold = ui.container.querySelector<HTMLElement>('[data-duos-mate]')!;
      hold.getBoundingClientRect = () => ({ left: 100, top: 200, width: 80, height: 80, right: 180, bottom: 280, x: 100, y: 200, toJSON: () => ({}) });
      expect(playDef).not.toHaveBeenCalled();
      act(() => { noteMateFrame('p2', view(3, 'recruit', 2), view(3, 'recruit', 3), undefined); });
      expect(playDef).toHaveBeenCalledTimes(1);
      expect(playDef).toHaveBeenCalledWith('shop-tier-up', { source: { x: 140, y: 240 }, target: { x: 140, y: 240 } }, { scale: DOCK_TIER_FX_SCALE });
    } finally { ui.unmount(); }
  });

  it('while I watch them it is MY portrait: no burst there (their own screen shows the press)', () => {
    noteMateFrame('p2', null, view(3, 'recruit', 1), undefined);
    const ui = mount(<DuosMateDock watching />);
    try {
      act(() => { noteMateFrame('p2', view(3, 'recruit', 1), view(3, 'recruit', 2), undefined); });
      expect(playDef).not.toHaveBeenCalled();
    } finally { ui.unmount(); }
  });

  it('the working glow: on while the closed round waits on their shop, off once they are in the fight', () => {
    useGame.setState({ run: { ...useGame.getState().run, wave: 3, phase: 'combat' } });
    setMatch('combat', 3);
    noteMateFrame('p2', null, view(3, 'recruit', 2), undefined);
    const ui = mount(<DuosMateDock watching={false} inCombat />);
    try {
      expect(ui.container.querySelector('.duosdock')?.className).toContain('working');
      expect(ui.container.querySelector('.duosdock-work')).not.toBeNull();
      act(() => { noteMateFrame('p2', view(3, 'recruit', 2), view(3, 'combat', 2), undefined); });
      expect(ui.container.querySelector('.duosdock')?.className).not.toContain('working');
    } finally { ui.unmount(); }
  });

  it('the glow loops only opacity and transform (the kwglow rule)', () => {
    const css = readFileSync(join(__dirname, 'duosMateSignals.css'), 'utf8');
    const keyframes = [...css.matchAll(/@keyframes\s+[\w-]+\s*\{([\s\S]*?)\}\s*\}/g)].map((m) => m[1]!);
    expect(keyframes.length).toBeGreaterThan(0);
    for (const k of keyframes) expect(k).not.toMatch(/box-shadow|filter|background|border-radius/);
    expect(css).toMatch(/kwglow/);
  });
});

describe('the Duos rail, one slot per team (R-DUOS-RAIL-TEAM-01)', () => {
  it('teams are seat pairs, in the order they first appear', () => {
    expect(['s0', 's1', 's2', 's3', 's7'].map(duosRailTeamOf)).toEqual([0, 0, 1, 1, 3]);
    const rows = [{ id: 's2' }, { id: 's3' }, { id: 's0' }, { id: 's1' }];
    expect(duosRailTeams(rows)).toEqual([{ team: 1, rows: [{ id: 's2' }, { id: 's3' }] }, { team: 0, rows: [{ id: 's0' }, { id: 's1' }] }]);
  });
  it('the slot shows the pool of the first member still standing', () => {
    expect(duosTeamHealthRow([{ id: 'a', alive: false }, { id: 'b', alive: true }])?.id).toBe('b');
    expect(duosTeamHealthRow([{ id: 'a', alive: false }, { id: 'b', alive: false }])?.id).toBe('a');
  });
});
