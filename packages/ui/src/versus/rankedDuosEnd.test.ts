// @vitest-environment jsdom
/**
 * THE END ALWAYS REACHES THE PLAYER (R-RANKED-DUOS-END-01; live report 2026-11-02, Ranked Duos round 13). The server
 * resolved the deciding round and placed the team; one teammate watched the fight and went back to the party, the other
 * sat on the round's shop with no fight and no way out ("how do we end the game? ... like how is it not the same logic").
 *  - a finished match whose shop is still on screen is driven again, then the end gate closes over it (the backstop);
 *  - the deciding fight on screen is never cut: its End Combat gem ends the match, as always;
 *  - a long End of Turn still animating holds the gate (up to a hard cap);
 *  - the Esc menu's leave on a finished match goes back to the room (it used to do nothing), and asks the server nothing.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { RunState } from '@game/sim';

vi.hoisted(() => { HTMLCanvasElement.prototype.getContext = (() => null) as unknown as HTMLCanvasElement['getContext']; });
const net = vi.hoisted(() => ({ forfeits: [] as string[], gates: [] as string[] }));
vi.mock('../identity', async (importOriginal) => ({ ...(await importOriginal<typeof import('../identity')>()), currentUserId: () => 'u1' }));
vi.mock('../rankedGate/rankedGateController', async (importOriginal) => ({
  ...(await importOriginal<typeof import('../rankedGate/rankedGateController')>()),
  requestRankedGate: (_swap: () => void, variant: string) => { net.gates.push(variant); return Promise.resolve(); },
}));
vi.mock('./versusRemote', async (importOriginal) => {
  const orig = await importOriginal<typeof import('./versusRemote')>();
  return { ...orig, versusRemote: { ...orig.versusRemote, forfeit: async (id: string) => { net.forfeits.push(id); throw new orig.VersusError('network'); } } };
});

const { useGame } = await import('../store');
const { useVersus, endBackstop, forfeitMatch, END_BACKSTOP_MS, END_BACKSTOP_MAX_MS } = await import('./versusStore');
const { leaveText } = await import('../gameMenuParts');

const finished = (id: string) => ({
  id, room_id: 'room1', seed: '1', set_id: 'set1', content_revision: 'x', protocol: 2, phase: 'complete', revision: 9, round: 13,
  p1_user: 'u1', p2_user: 'served:c0', p1_name: 'LazerLemon', p2_name: 'Foe', options: { v: 1, mode: 'ranked_duos', modifiers: [] },
}) as never;
const onScreen = (phase: 'recruit' | 'combat'): void => {
  useGame.setState({ run: { ...useGame.getState().run, mode: 'versus', phase, wave: 13 } as RunState, presentationTx: null } as never);
};

beforeEach(() => { Object.assign(net, { forfeits: [], gates: [] }); });
afterEach(() => { useVersus.setState({ match: null } as never); useGame.setState({ presentationTx: null } as never); });

describe('R-RANKED-DUOS-END-01: a finished match never holds a player on its game screen', () => {
  it('the shop still on screen after the end: the end gate closes over it once the backstop is up, once', () => {
    const m = finished('end-1');
    useVersus.setState({ match: m } as never);
    onScreen('recruit');
    const t0 = 1_000_000;
    endBackstop(m, t0);
    endBackstop(m, t0 + END_BACKSTOP_MS - 500);
    expect(net.gates).toEqual([]);
    endBackstop(m, t0 + END_BACKSTOP_MS + 100);
    expect(net.gates).toEqual(['end']);
    endBackstop(m, t0 + END_BACKSTOP_MS + 600);
    expect(net.gates).toEqual(['end']);
  });

  it('the deciding fight on screen is the player\'s to finish: no gate while it plays', () => {
    const m = finished('end-2');
    useVersus.setState({ match: m } as never);
    onScreen('combat');
    endBackstop(m, 0);
    endBackstop(m, END_BACKSTOP_MAX_MS + 5000);
    expect(net.gates).toEqual([]);
  });

  it('a long End of Turn still animating holds it, up to the hard cap', () => {
    const m = finished('end-3');
    useVersus.setState({ match: m } as never);
    onScreen('recruit');
    useGame.setState({ presentationTx: { id: 'eot' } } as never);
    endBackstop(m, 0);
    endBackstop(m, END_BACKSTOP_MS + 1000);
    expect(net.gates).toEqual([]);
    endBackstop(m, END_BACKSTOP_MAX_MS + 1);
    expect(net.gates).toEqual(['end']);
  });

  it('a match still running is never touched', () => {
    const m = { ...(finished('end-4') as object), phase: 'shop' } as never;
    useVersus.setState({ match: m } as never);
    onScreen('recruit');
    endBackstop(m, 0);
    endBackstop(m, END_BACKSTOP_MAX_MS * 2);
    expect(net.gates).toEqual([]);
  });

  it('the Esc menu on a finished match: "Leave match" goes back to the room, and asks the server nothing', async () => {
    const m = finished('end-5');
    useVersus.setState({ match: m } as never);
    onScreen('recruit');
    await forfeitMatch();
    expect(net.gates).toEqual(['end']);
    expect(net.forfeits).toEqual([]);
    expect(leaveText('concede', false, false, true)).toEqual({ label: 'Leave match', confirm: 'Tap again to leave', note: 'The match is over. Back to the room.' });
    expect(leaveText('concede', false, false, false).label).toBe('Concede');
  });
});
