import { heroThumb } from './art';
import { warmSharpArt } from './fullResArt';

/**
 * WHICH SIZE OF A HERO PORTRAIT THE LOBBY RAIL AND THE REVEAL LOAD ON A PHONE (R-PHONE-RAIL-THUMB-01, 2026-10-31: CI's
 * phone image budget, 140 MB decoded, was crossed by the Docked rail and the lobby reveal drawing eight 384 px copies).
 * Both pick the 256 px thumbnail (`heroThumb`, built by apps/web/phoneArtPlugin.ts) where it is at least the drawn size,
 * so the rail and the line-up share one decode per hero. Desktop and dev builds have no thumbnails: URLs pass unchanged.
 */

/**
 * A DOCKED slice's hero art (R-PHONE-RAIL-THUMB-01, phone image budget 2026-10-31). The Full art look covers the slice
 * with the square portrait, so it is drawn at the slice's longer side: on an iPhone the eight-seat slice is ~198 x 59 stage
 * px, ~230 device px across. A slice wider than tall loads the 256 px rail thumbnail (`heroThumb`), not the 384 px copy
 * (eight of those were ~4.7 MB of decoded art for the whole run, the thumbnails ~2 MB). A slice taller than wide (a lobby
 * with only a few seats) draws the face bigger, so it keeps the copy. The seat's 512 px master is still warmed (fetched,
 * not decoded) for when its face becomes the combat foe's portrait, like the classic rail. Desktop: the URL unchanged.
 */
export function railSliceFace(full: string | undefined, p: { w: number; h: number }): string | undefined {
  warmSharpArt([full]);
  return p.h <= p.w ? heroThumb(full) : full;
}

/**
 * The line-up's portrait URL (R-PHONE-RAIL-THUMB-01, phone image budget 2026-10-31). With seven or more players the
 * line-up's faces are ~181 stage px, ~210 device px on an iPhone, so a phone loads the 256 px rail thumbnail: the very
 * image the slice it lands on shows, so the line-up and the rail share one decode instead of eight 384 px copies on top
 * of eight thumbnails. Fewer players (and the duel) draw bigger faces and keep the copy. Desktop: the URL unchanged.
 */
export function revealLineupFace(url: string | undefined, play: { entries: readonly unknown[]; layout?: string } | null | undefined): string | undefined {
  if (!play) return url;
  return play.entries.length > 6 && play.layout !== 'duel' ? heroThumb(url) : url;
}

