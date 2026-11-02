/**
 * THE PARTY HOME's MODE TABS (prototype, owner 2026-11-02). Every mode the current menus reach, as one row of tabs across
 * the top of the party home (the Valorant pattern: pick the mode, the party slots follow, START does the rest).
 *
 * `slots` is how many banner cards the mode shows (you plus the open seats); `party` says whether the other seats are
 * TEAMMATES (Ranked Duos) or RIVALS (the Versus rooms) or there are none (solo modes). Pure data, so it is testable.
 */
export type PartyModeId = 'ranked' | 'duos' | 'versus' | 'group' | 'vduos' | 'practice' | 'gauntlet' | 'learn';

export interface PartyMode {
  id: PartyModeId;
  label: string;
  /** One short line under the tabs (plain words, no em dashes). */
  desc: string;
  slots: number;
  party: 'solo' | 'team' | 'rivals';
  /** Rated: START asks the ranked confirmation first (R-RANK-06). */
  ranked: boolean;
  /** Needs the Versus build flag. */
  versus?: boolean;
  /** DEV builds only. */
  dev?: boolean;
  /** Has in-place options (ModeOptions.tsx), shown in a panel beside the cards. */
  options?: boolean;
}

export const PARTY_MODES: readonly PartyMode[] = [
  { id: 'ranked', label: 'Ranked', desc: 'The ranked eight-seat lobby.', slots: 1, party: 'solo', ranked: true },
  { id: 'duos', label: 'Ranked Duos', desc: 'You and a teammate against three teams.', slots: 2, party: 'team', ranked: true, versus: true },
  { id: 'versus', label: 'Versus 1v1', desc: 'Real-time 1v1 against a friend. Unranked.', slots: 2, party: 'rivals', ranked: false, versus: true, options: true },
  { id: 'group', label: 'Versus Group', desc: 'Three or four players, last one standing. Unranked.', slots: 4, party: 'rivals', ranked: false, versus: true, options: true },
  { id: 'vduos', label: 'Versus Duos', desc: 'Two teams of two, shared hearts. Unranked.', slots: 4, party: 'rivals', ranked: false, versus: true, options: true },
  { id: 'practice', label: 'Practice', desc: 'Practice your way. Nothing here is rated.', slots: 1, party: 'solo', ranked: false, options: true },
  { id: 'gauntlet', label: 'Gauntlet', desc: 'Survive 10 rounds against a hand-built foe.', slots: 1, party: 'solo', ranked: false, options: true },
  { id: 'learn', label: 'Learn', desc: 'The tutorial and techniques.', slots: 1, party: 'solo', ranked: false },
];

/** The tabs this build shows. */
export function partyModes(opts: { versus: boolean; dev: boolean }): PartyMode[] {
  return PARTY_MODES.filter((m) => (!m.versus || opts.versus) && (!m.dev || opts.dev));
}

export const partyModeOf = (id: PartyModeId): PartyMode => PARTY_MODES.find((m) => m.id === id) ?? PARTY_MODES[0]!;

const MODE_KEY = 'ascent.partyHome.mode';
export function readPartyMode(): PartyModeId {
  try {
    const v = localStorage.getItem(MODE_KEY);
    if (v && PARTY_MODES.some((m) => m.id === v)) return v as PartyModeId;
  } catch { /* a convenience only */ }
  return 'ranked';
}
export function rememberPartyMode(id: PartyModeId): void {
  try { localStorage.setItem(MODE_KEY, id); } catch { /* a convenience only */ }
}
