import { describe, expect, it } from 'vitest';
import { RANK_RULES, resolveRank } from '../rank';
import { abandonPlacementOf, createLobbyRun } from './runLobby';

/**
 * QUITTING COSTS RATING (owner 2026-09-29, R-RANK-05): "quitting an official game should lose you MMR relative to
 * the lowest available place when you quit. for example. if one player was already out, then quitting would place
 * you in 7th place." The sim half: the placement an abandoned lobby takes, and that the normal placement award
 * (demotion games included) applies to it unchanged.
 */
const MID = { divisionIndex: 4, points: 50, demotionReady: false }; // Silver II 50: no gate either way

const withOut = (n: number) => {
  const run = createLobbyRun(4, 'drakko');
  const lobby = { ...run.lobby!, seats: run.lobby!.seats.map((s) => ({ ...s })) };
  lobby.seats.filter((s) => s.id !== 's0').slice(0, n).forEach((s, i) => { s.alive = false; s.placement = 8 - i; });
  return { ...run, lobby };
};

describe('abandonPlacementOf: the lowest place still open', () => {
  it('nobody out yet: quitting is an 8th, with the 8th-place award', () => {
    const p = abandonPlacementOf(withOut(0));
    expect(p).toBe(8);
    expect(resolveRank(MID, p!).appliedDelta).toBe(RANK_RULES.placementAwards[7]);
  });

  it('one seat already out: quitting is a 7th, with the 7th-place award', () => {
    const p = abandonPlacementOf(withOut(1));
    expect(p).toBe(7);
    expect(resolveRank(MID, p!).appliedDelta).toBe(RANK_RULES.placementAwards[6]);
  });

  it('generally the number of seats still alive (four out: a 4th)', () => {
    expect(abandonPlacementOf(withOut(4))).toBe(4);
  });

  it('a quit in a demotion game follows the demotion rules for that place', () => {
    const gate = { divisionIndex: 4, points: 0, demotionReady: true };
    expect(resolveRank(gate, abandonPlacementOf(withOut(0))!).demoted).toBe(true);
  });

  it('nothing to abandon: a finished run, a dead player seat, or no lobby', () => {
    expect(abandonPlacementOf({ ...withOut(0), phase: 'gameover' })).toBeNull();
    const dead = withOut(1);
    dead.lobby.seats[0]!.alive = false;
    expect(abandonPlacementOf(dead)).toBeNull();
    expect(abandonPlacementOf({ phase: 'recruit', lobby: undefined })).toBeNull();
  });
});
