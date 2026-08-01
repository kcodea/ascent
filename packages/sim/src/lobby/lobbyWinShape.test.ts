import { describe, it, expect } from 'vitest';
import { createLobbyRun } from './runLobby';
import { reduce } from '../reducer';
import type { RunState } from '../state';

/**
 * The SHAPE of a lobby win — the invariant the UI's end-of-run block depends on.
 *
 * Owner report 2026-07-31: the Hall of Champions never populated. The cause was an assumption in `store.ts`
 * that a lobby win looks like a course win (`phase === 'victory'`). It does not: `advanceCombat`'s victory
 * branch explicitly excludes lobby mode — a lobby has no course clock to complete — so EVERY lobby ends at
 * `gameover`, winner or not, and the win is expressed as **placement 1** instead. The upload was gated on
 * `won && …`, which is therefore never true, so nothing was ever logged.
 *
 * These tests pin both halves of that invariant so the next person to read `phase` for a lobby outcome finds
 * a failing test instead of an empty leaderboard.
 */
describe('a lobby win is placement 1, never phase "victory"', () => {
  /** Play a lobby to its conclusion, closing whatever start-of-turn modal blocks the turn. */
  const playOut = (seed: number): RunState => {
    let s = createLobbyRun(seed, 'drakko');
    for (let round = 0; round < 80 && s.phase !== 'gameover' && s.phase !== 'victory'; round++) {
      for (let guard = 0; guard < 6 && (s.runeforgeOffer || s.discover || s.questOffer); guard++) {
        if (s.runeforgeOffer) s = reduce(s, { type: 'skipRuneforge' });
        if (s.discover) s = reduce(s, { type: 'discover', index: 0 });
        if (s.questOffer) s = reduce(s, { type: 'buyQuest', index: 0 });
      }
      s = reduce(s, { type: 'faceOmen' });
      s = reduce(s, { type: 'resolveCombat' });
    }
    return s;
  };

  it('ends at gameover — NOT victory — however it turns out', () => {
    for (const seed of [3, 11, 24]) {
      const s = playOut(seed);
      expect(s.phase, `seed ${seed}: a lobby must never reach 'victory'`).toBe('gameover');
    }
  });

  it("the player's seat always carries a placement when the run ends", () => {
    // The UI reads this to award MMR and to decide whether the run earns a Hall entry. An unstamped seat
    // would silently fall back to a guessed placement.
    for (const seed of [3, 11, 24]) {
      const s = playOut(seed);
      const me = s.lobby!.seats.find((seat) => seat.id === 's0')!;
      expect(me.placement, `seed ${seed}: no placement stamped`).toBeGreaterThanOrEqual(1);
      expect(me.placement).toBeLessThanOrEqual(s.lobby!.seats.length);
    }
  });

  it('a survivor of a FINISHED lobby is placement 1', () => {
    // The winning shape specifically: whoever is still standing when the lobby finishes is stamped 1, which
    // is the single condition the Hall of Champions upload is allowed to key on.
    for (const seed of [3, 11, 24, 37]) {
      const s = playOut(seed);
      const me = s.lobby!.seats.find((seat) => seat.id === 's0')!;
      if (!s.lobby!.finished || !me.alive) continue; // eliminated runs are covered above
      expect(me.placement, `seed ${seed}: survived a finished lobby but was not placement 1`).toBe(1);
    }
  });
});
