import type { PracticeConfig, RunState } from './state';

/**
 * GOD MODE (owner 2026-10-08): a Practice option that is a learning playground. A God Mode run is an ordinary
 * practice lobby run, stamped:
 *  - `sandbox: true`  — the existing write barrier: no save / Continue, no upload, no XP / crate, no replay draft;
 *  - `godMode: true`  — what every God Mode behaviour keys on (gated actions, clock, panel, round prompt);
 *  - 999 Gold;
 *  - an INVULNERABLE background table and a lifted round cap, so the lobby never finishes: the player picks their
 *    own opponent each round, and only the player's own seat (Health = Normal) can end the run.
 */
export const GOD_MODE_MAX_ROUNDS = 999;

export const GOD_MODE_GOLD = 999;

/** God Mode's fixed practice settings (owner sketch 2026-10-08): the Sandbox Mode options are greyed out while God
 *  Mode is selected, so God Mode ignores them - every hero, Unlimited health, every tribe, no timer. */
export function godPracticeConfig(cfg: PracticeConfig): PracticeConfig {
  return { ...cfg, godMode: true, heroes: 'all', health: 'unlimited', tribes: [], timeMult: 0 };
}

export function isGodMode(run: Pick<RunState, 'godMode'>): boolean {
  return run.godMode === true;
}

export function makeGodModeRun(run: RunState): RunState {
  const lobby = run.lobby
    ? {
        ...run.lobby,
        rules: { ...run.lobby.rules, maxRounds: GOD_MODE_MAX_ROUNDS },
        seats: run.lobby.seats.map((seat, i) => (i === 0 ? seat : { ...seat, invulnerable: true as const })),
      }
    : run.lobby;
  return { ...run, lobby, sandbox: true, godMode: true, embers: GOD_MODE_GOLD };
}
