import { canPlayDefs, playDef } from './fx/playDef';

/**
 * THE KNOCKOUT on the lobby rail (owner ask 2026-10-02: "can you add a simple animation for when a player is knocked
 * out? some pixi smoke/burst as their card fades").
 *
 * A seat that falls plays ONE calm Pixi effect (`lobby-knockout`: a soft grey veil that drifts up and thins out, with a
 * handful of slow motes; calmed 2026-10-03 from a puff burst + embers the owner found "ugly and jarring"), kept to
 * its row, while the row eases into its eliminated look (`.lobbyseat.dead.ko`, a one-shot opacity animation in
 * lobbyRail.css, no swell). About 1.5s. Works in both rail looks.
 *
 * WHEN: eliminations land at the round's settle, under the combat -> shop curtain, so LobbyPanel holds the effect
 * until the curtain is down (`whenCurtainDown`, the same hold as the damage float) and the rail has slid back in.
 * ONCE: LobbyPanel diffs the alive set against the one it last saw (`newlyKnockedOut`). The first sight of a lobby
 * (mount, reload, a new run) only records it, so a seat that was already out shows the static dead row with no FX.
 */

/** How long the row's fade runs (lobbyRail.css `lobbyko`); the `ko` class is dropped a little after it. */
export const LOBBY_KO_MS = 1400;

/**
 * The seats that were alive in `prevAlive` and are out now: the knockouts to announce. `prevAlive` null means this is
 * the first sight of the table, which announces nothing. Pure.
 */
export function newlyKnockedOut(
  prevAlive: ReadonlySet<string> | null,
  seats: readonly { id: string; alive: boolean }[],
): string[] {
  if (!prevAlive) return [];
  return seats.filter((s) => !s.alive && prevAlive.has(s.id)).map((s) => s.id);
}

/** The ids alive right now, for the next diff. */
export function aliveSet(seats: readonly { id: string; alive: boolean }[]): Set<string> {
  return new Set(seats.filter((s) => s.alive).map((s) => s.id));
}

/** Play the knockout over a seat's rail row. The row is measured ONCE, here, never per frame. Returns whether it
 *  fired (false: the row isn't on screen, or the FX layer isn't up). */
export function playLobbyKnockoutOnSeat(seatId: string): boolean {
  if (typeof document === 'undefined' || !canPlayDefs()) return false;
  const el = document.querySelector(`.lobbyrail [data-seat="${seatId.replace(/["\\]/g, '\\$&')}"]`);
  if (!el) return false;
  const r = el.getBoundingClientRect();
  if (r.width < 4 || r.height < 4) return false;
  const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  return playDef('lobby-knockout', { source: at, target: at, cursor: at }) !== null;
}
