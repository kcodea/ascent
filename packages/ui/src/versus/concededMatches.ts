/**
 * THE MATCHES THIS DEVICE CONCEDED (R-RANKED-DUOS-CONCEDE-01, owner report 2026-11-01: "i was in a duos ranked game w/
 * mike and i conceded ... then i reloaded the game and it put me in a lobby where i faced opponents until the game
 * ended").
 *
 * A Ranked Duos concede does not end the match: the teammate plays on, so the room stays in game and the conceder still
 * holds a player seat in it. The server marks the seat as gone (`leftAt`), but a reload used to re-enter the room at
 * boot and rebuild a playable run before anything read that. This list is the client's own memory of the concede: a
 * match in it is never resumed at boot and never rebuilt as a run. It survives a reload (localStorage), holds only the
 * last few match ids, and a blocked storage only loses the memory (the server's `leftAt` still keeps the seat out).
 */
const KEY = 'ascent.versus.conceded.v1';
/** How many conceded match ids are kept (oldest dropped first). */
export const CONCEDED_KEEP = 12;

let cache: string[] | null = null;

function read(): string[] {
  if (cache) return cache;
  try {
    const raw = localStorage.getItem(KEY);
    const parsed = raw ? (JSON.parse(raw) as unknown) : [];
    cache = Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === 'string').slice(-CONCEDED_KEEP) : [];
  } catch {
    cache = [];
  }
  return cache;
}

/** Remember that I conceded `matchId` (the Esc menu's Concede). */
export function markConceded(matchId: string): void {
  const ids = read().filter((x) => x !== matchId);
  ids.push(matchId);
  cache = ids.slice(-CONCEDED_KEEP);
  try { localStorage.setItem(KEY, JSON.stringify(cache)); } catch { /* storage blocked: memory only */ }
}

/** Did I concede `matchId` on this device? */
export function concededHere(matchId: string | null | undefined): boolean {
  return !!matchId && read().includes(matchId);
}

/** Tests: forget the in-memory copy (the next read comes from storage). */
export function resetConcededCache(): void {
  cache = null;
}
