/**
 * ARCHIVED HEROES — in the registry, out of every picker.
 *
 * Owner ruling 2026-08-28: *"coran and fi should be archived for now. they will be redesigned and should not
 * show in our hero list for practice nor play for now. keep them archived but completely inactive for now."*
 *
 * This file replaces `practiceOnlyHeroes.test.ts`. That suite guarded the WEAKER 2026-08-23 withhold — Fi and
 * Coran pulled from Play but kept in Practice via `practiceOnly` — and its central assertion ("the flag is the
 * only difference between the two rosters") is exactly what the new ruling invalidates: the two rosters are
 * now identical, because nothing is merely practice-only any more. Renaming rather than deleting keeps the
 * distinction it taught, which is still the thing to get right:
 *
 *   · `practiceOnly` = finished but off the ladder — hidden from Play, PLAYABLE in Practice.
 *   · `wip`          = archived or unfinished — hidden from Play AND Practice AND every power Discover.
 *
 * The ruling asks for the second, so Fi and Coran carry `wip`. What must NOT happen is deletion: their defs
 * stay in `HEROES` so a saved run, a replay, a recorded rival seat or an old telemetry row still resolves
 * `heroId: 'fi'` instead of crashing.
 */
import { describe, expect, it } from 'vitest';
import { HEROES, getHero, playableHeroes, practiceHeroes, powerDiscoverPool } from './heroes';
import { createRun } from './state';

/** The heroes archived by the 2026-08-28 ruling. */
const ARCHIVED = ['fi', 'coran'];

describe('archived heroes (Fi + Coran, owner ruling 2026-08-28)', () => {
  it('carry `wip` — the flag that withholds a hero from EVERY picker', () => {
    for (const id of ARCHIVED) {
      expect(getHero(id).wip, `${id} must be wip; practiceOnly is not enough — the ruling pulls it from Practice too`)
        .toBe(true);
    }
  });

  it('are OFF the Play roster', () => {
    const play = playableHeroes().map((h) => h.id);
    for (const id of ARCHIVED) expect(play, `${id} is still offered in Play`).not.toContain(id);
  });

  it('are OFF the Practice roster too — the part the older practiceOnly withhold did not do', () => {
    const practice = practiceHeroes().map((h) => h.id);
    for (const id of ARCHIVED) expect(practice, `${id} is still offered in Practice`).not.toContain(id);
  });

  it('cannot come back through a power Discover (Mimic / Void / Power Shifter)', () => {
    // Those three systems hand out another hero's POWER, and all three read `powerDiscoverPool`. Without this
    // an archived hero's power would still reach the board on turn 9 — the archive undone by a side door.
    for (const who of ['mimic', 'void'] as const) {
      for (const id of ARCHIVED) expect(powerDiscoverPool(who), `${id} is discoverable via ${who}`).not.toContain(id);
    }
  });

  it('stay RESOLVABLE — the archived-content contract: out of every pool, still in the registry', () => {
    for (const id of ARCHIVED) {
      const def = HEROES.find((h) => h.id === id);
      expect(def, `${id}'s def must stay in HEROES — a save/replay/rival seat carrying it must still load`).toBeTruthy();
      expect(getHero(id).id).toBe(id);
      // …and a run built on one still constructs. It is unreachable through the UI, but a replay of a run
      // recorded before the archive rebuilds exactly this way, and it must not throw.
      expect(() => createRun(1, id)).not.toThrow();
    }
  });

  it('no hero is both wip and practiceOnly, and practiceOnly currently has no members', () => {
    // A hero cannot be both: `wip` already means "withheld everywhere", so carrying both hides the intent.
    for (const h of HEROES) expect(h.wip && h.practiceOnly, `${h.id} is both wip and practiceOnly`).toBeFalsy();
    // Fi and Coran were the flag's only users. If this starts failing, someone added a practice-only hero —
    // that is fine, but the two rosters below then differ and the assertion after it must be revisited.
    expect(HEROES.filter((h) => h.practiceOnly).map((h) => h.id)).toEqual([]);
    expect(practiceHeroes().map((h) => h.id)).toEqual(playableHeroes().map((h) => h.id));
  });
});
