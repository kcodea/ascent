import { describe, it, expect } from 'vitest';
import { HEROES, playableHeroes } from '../heroes';
import { autoplayRun } from '../snapshot';
import { createRunLobby, driverFor } from './runLobby';
import { hybridSeat, recordingFieldsBoard } from './seats';

/**
 * EVERY HERO CAN HOLD A GENERATED SEAT (bug 2026-09-28).
 *
 * A generated `hybrid` lobby seat plays a headless recording (`autoplayRun`). Mimic's turn-1 hero-power Discover
 * (`powerOffer`) blocks every other action, and `autoplayRun` had no branch for it, so a Mimic recording bailed
 * before its first combat and held ZERO boards. Seat selection probed the LIVE bot (which can play Mimic), so the
 * seat was seated anyway and fielded nothing all game. Seen in 2 of 6 real Practice (players) games.
 */

/** The shortest recording any hero may produce. The greedy autoplay dies around wave 8-10 in Ascent mode. */
const MIN_WAVES = 5;

describe('autoplayRun records a real run for every hero', () => {
  it('Mimic answers its every-turn hero-power Discover and records a full run', () => {
    for (const seed of [3, 17, 99]) {
      expect(autoplayRun(seed, 'mimic').length, `mimic seed ${seed}`).toBeGreaterThanOrEqual(MIN_WAVES);
    }
  });

  it(`every hero (playable or not) records at least ${MIN_WAVES} waves`, () => {
    const short = HEROES
      .map((h) => ({ id: h.id, waves: autoplayRun(41, h.id).length }))
      .filter((r) => r.waves < MIN_WAVES);
    expect(short, 'these heroes wedge the autoplay, so their lobby seats would field no board').toEqual([]);
  });

  it('the one-board probe is an exact prefix of the full recording', () => {
    const full = autoplayRun(7, 'mimic');
    expect(autoplayRun(7, 'mimic', undefined, 1)).toEqual(full.slice(0, 1));
    expect(recordingFieldsBoard(7, 'mimic')).toBe(true);
  });
});

describe('a Mimic hybrid seat fields its board', () => {
  it('the driver has a recording and a round-1 board', () => {
    const seat = hybridSeat(9001, 'mimic', 'mimic-seat');
    expect(seat.lastRecordedWave).toBeGreaterThanOrEqual(MIN_WAVES);
    expect(seat.prepare(1)).not.toBeNull();
    expect(seat.finalBoard?.()).not.toBeNull();
  });

  it('in a real createRunLobby, a seated Mimic (and every other seat) fields a board', () => {
    expect(playableHeroes().some((h) => h.id === 'mimic'), 'Mimic is playable').toBe(true);
    let seen = 0;
    for (let seed = 1; seed <= 400 && seen < 2; seed++) {
      const lobby = createRunLobby(seed, 'warden', {}, 'set1');
      if (!lobby.seats.some((s) => s.heroId === 'mimic' && s.kind === 'hybrid')) continue;
      seen++;
      for (const s of lobby.seats) {
        if (s.kind === 'player') continue;
        expect(driverFor(s, lobby.setId)?.prepare(1), `seed ${seed}: ${s.heroId} fields nothing`).not.toBeNull();
      }
    }
    expect(seen, 'no seed seated a Mimic hybrid, so the scenario never ran').toBeGreaterThan(0);
  });
});
