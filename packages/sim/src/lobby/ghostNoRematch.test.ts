import { describe, it, expect } from 'vitest';
import { createRunLobby, ghostFor, ghostIsRematch, pairRunLobby, playerOpponent } from './runLobby';

/**
 * NO GHOST REMATCH (owner report 2026-09-19 — the Hearthstone rule): "player just fought and killed the dead ghost
 * opponent that he is fighting now. that shouldn't be possible." At a 3-alive table the bye holder used to be served
 * the most recently fallen seat — which is exactly the seat it eliminated the round before. Now: the ghost never is the
 * bye holder's last-round opponent / the seat it eliminated (the next most recent ghost stands in), and when the only
 * ghost on offer IS a rematch the bye goes to another seat.
 */
describe('the ghost is never a rematch', () => {
  /** A table at `round`: `alive` seats live; `dead` = [id, eliminatedRound]; `fights` = prior encounters. */
  const table = (round: number, alive: string[], dead: [string, number][], fights: { round: number; a: string; b: string; bye?: string }[]) => {
    const l = createRunLobby(4242, 'warden', {}, 'set1');
    const deadMap = new Map(dead);
    l.seats = l.seats.map((s) => ({
      ...s,
      alive: alive.includes(s.id),
      armor: 0,
      resolve: alive.includes(s.id) ? 20 : 0,
      eliminatedRound: deadMap.get(s.id),
    }));
    l.round = round;
    l.encounters = fights.map((f) => ({ round: f.round, a: f.a, b: f.b, outcome: 'win' as const, damageToA: 0, damageToB: 5, fought: true, ...(f.bye ? { bye: f.bye } : {}) }));
    return l;
  };

  it("the owner's table: 3 alive, the player killed s3 last round — the player's ghost is NOT s3", () => {
    // Round 11: s0 beat s3 and s3 died; s4 died in round 9, s5 in round 8 (other ghosts exist).
    const l = table(12, ['s0', 's1', 's2'], [['s3', 11], ['s4', 9], ['s5', 8], ['s6', 5], ['s7', 3]],
      [{ round: 11, a: 's0', b: 's3' }, { round: 11, a: 's1', b: 's2' }]);
    expect(ghostIsRematch(l, 's0', l.seats.find((x) => x.id === 's3')!)).toBe(true);
    const g = ghostFor(l, 's0');
    expect(g, 'a ghost still exists').toBeTruthy();
    expect(g!.seat.id, 'the next most recent fallen seat stands in').toBe('s4');
    // …while a seat that never met s3 recently still gets the freshest ghost.
    expect(ghostFor(l, 's1')!.seat.id).toBe('s3');
  });

  it('the eliminator rule holds even when the elimination was earlier than last round', () => {
    // s0 eliminated s3 in round 9; rounds 10–11 s0 fought others. s3 is still off-limits as s0's ghost.
    const l = table(12, ['s0', 's1', 's2'], [['s3', 9], ['s4', 11]],
      [{ round: 9, a: 's0', b: 's3' }, { round: 10, a: 's0', b: 's1' }, { round: 11, a: 's0', b: 's2' }, { round: 11, a: 's1', b: 's4' }]);
    // The most recent ghost is s4 (died r11 to s1) — fine for s0.
    expect(ghostFor(l, 's0')!.seat.id).toBe('s4');
    // For s1, s4 is BOTH last round's opponent and its kill → skipped to s3.
    expect(ghostFor(l, 's1')!.seat.id).toBe('s3');
  });

  it('when the ONLY ghost is a rematch for a candidate, the bye goes to another seat', () => {
    // 3 alive, exactly one dead seat (s3), killed by s0 last round. s0 must not hold the bye.
    const l = table(4, ['s0', 's1', 's2'], [['s3', 3]],
      [{ round: 3, a: 's0', b: 's3' }, { round: 3, a: 's1', b: 's2' }]);
    const { bye } = pairRunLobby(l);
    expect(bye, 'odd table → a bye').toBeTruthy();
    expect(bye!.id, 'the eliminator never faces its own kill as the ghost').not.toBe('s0');
    // and the player, paired live, is served a living seat.
    const foe = playerOpponent(l);
    expect(foe?.ghost ?? false).toBe(false);
  });

  it('with nobody else eligible the most recent ghost still stands (a fight beats a free round)', () => {
    // Every dead seat was s0's own kill AND s0 is the only bye-eligible seat (the two others are not — but at 3
    // alive all are eligible, so force it via a 1-alive-plus-ghost shape: only s0 alive is not odd>1; use 3 alive
    // where both other seats also just fought each other's ghosts is impossible — so pin the fallback directly.)
    const l = table(6, ['s0', 's1', 's2'], [['s3', 5]], [{ round: 5, a: 's0', b: 's3' }]);
    expect(ghostFor(l, 's0')!.seat.id, 'fallback: the only ghost, even though it is a rematch').toBe('s3');
  });
});
