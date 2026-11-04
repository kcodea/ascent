/**
 * A game's board art, ahead of its first paint (round 12 critic: on a phone the art is not all preloaded, so an opened board
 * showed blank ovals until it landed). Through the one art pipe (`artPreload.ts`), so a card that mounts later finds its
 * picture ready and paints it at once. Its own small file: the title's idle prefetch reads it too.
 */
import type { BoardMinion } from '@game/core';
import type { MatchDetails } from '@game/sim';
import { artFor } from '../../art';
import { artReady, requestArtList, whenArtReady } from '../../artPreload';

const urlsOf = (minions: readonly BoardMinion[] | null | undefined): string[] =>
  (minions ?? []).map((m) => artFor(m.cardId)).filter((u): u is string => !!u);

/** Is every minion's art fetched and decoded? */
export const boardArtReady = (minions: readonly BoardMinion[] | null | undefined): boolean => urlsOf(minions).every(artReady);

/** Every minion on the lobby's boards: on a phone their art is not preloaded either, so the tiles wait for it too. */
export const lobbyMinions = (match: MatchDetails | null | undefined): BoardMinion[] => (match?.seats ?? []).flatMap((s) => s.board?.minions ?? []);

/** Fetch and decode a board's art at the front of the pipe; resolves when each picture has settled. */
export function warmBoardArt(minions: readonly BoardMinion[] | null | undefined): Promise<void> {
  const urls = urlsOf(minions);
  requestArtList(urls, 'now');
  return whenArtReady(urls);
}
