/**
 * PRACTICE-ONLY HEROES — playable, but off PLAY mode.
 *
 * Owner ask 2026-08-23: Fi and Coran are pulled from Play while their hero quests are reworked, and stay
 * available in Practice. That is a different withhold from `wip`, which hides a hero from EVERY picker
 * (including Practice) because it is not finished. Conflating the two is the easy mistake here — it would
 * either leave a reworked hero on the ladder or take it away from the owner entirely.
 */
import { describe, expect, it } from 'vitest';
import { HEROES, playableHeroes, practiceHeroes, powerDiscoverPool } from './heroes';

const PULLED = ['fi', 'coran'];

describe('practice-only heroes', () => {
  it('Fi and Coran are OFF the Play roster', () => {
    const play = playableHeroes().map((h) => h.id);
    for (const id of PULLED) expect(play, `${id} is still offered in Play`).not.toContain(id);
  });

  it('…and still ON the Practice roster — that is the whole point of the flag', () => {
    const practice = practiceHeroes().map((h) => h.id);
    for (const id of PULLED) expect(practice, `${id} was pulled from Practice too`).toContain(id);
  });

  it('the flag is the only difference between the two rosters', () => {
    const play = new Set(playableHeroes().map((h) => h.id));
    const missing = practiceHeroes().filter((h) => !play.has(h.id));
    expect(missing.map((h) => h.id).sort()).toEqual([...PULLED].sort());
    for (const h of missing) expect(h.practiceOnly, `${h.id} is off Play without the flag saying so`).toBe(true);
  });

  it('practiceOnly is never used as a substitute for wip', () => {
    // A hero cannot be both: `wip` already means "withheld everywhere", so carrying both flags hides the
    // intent (is it unfinished, or finished-but-pulled?) and makes the Practice roster wrong.
    for (const h of HEROES) expect(h.wip && h.practiceOnly, `${h.id} is both wip and practiceOnly`).toBeFalsy();
  });

  it('a pulled hero cannot come back through a power Discover', () => {
    // Power Shifter / Mimic / Void hand out another hero's POWER. Fi and Coran are already excluded there by
    // the owner's lists and by their `heroQuest` kind — assert it, so pulling a hero from Play can never be
    // undone by a spell handing its power out anyway.
    for (const who of ['mimic', 'void'] as const) {
      for (const id of PULLED) expect(powerDiscoverPool(who), `${id} is discoverable via ${who}`).not.toContain(id);
    }
  });
});
