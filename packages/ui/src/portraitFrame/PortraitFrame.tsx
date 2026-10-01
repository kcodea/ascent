import { memo, useMemo, useSyncExternalStore } from 'react';
import { portraitFrameOf, type RunCosmeticSnapshot } from '@game/progression';
import { mirrorFor, useProgression } from '../progression/progressionStore';
import { currentUserId } from '../identity';
import {
  getPortraitFrameVersion,
  resolvePortraitFrame,
  subscribePortraitFrames,
  type FrameSurface,
  type PortraitSide,
  type ResolvedFrame,
} from './portraitFrameConfig';

/**
 * THE ONE FRAME RENDERER for every hero portrait (owner ask 2026-09-29). A surface asks
 * `usePortraitFrame(side)`; null means "keep your current look" (the baked default), otherwise it:
 *   1. adds `pf-on` + `frame.hostStyle` to the element whose box IS the round portrait disc (that class drops the
 *      surface's old CSS border / ring, un-clips the disc so the ring can overhang it, and rounds the art), and
 *   2. renders `<PortraitFrame frame={…} />` as a child of that disc host.
 *
 * Performance: the frame is ONE static image element with a precomputed inline box; nothing animates, nothing measures,
 * the resolved object is cached per (tuner version, frame id) so memoised parents see a stable reference, and in
 * production the tuner never changes, so the store never notifies.
 *
 * PORTRAIT FRAME COSMETICS (owner 2026-10-01). `frameId` is the per-player frame: `undefined` = the side's default,
 * which for `self` is YOUR equipped frame (live loadout) and for `opp` the tuner's; a string = that frame (an
 * opponent's recorded frame, a Collection preview); `null` = no cosmetic frame (the tuner's look). Opponent surfaces
 * pass `frameIdOf(opponentSkins(show, snapshot))`, so "Show opponent cosmetics" off puts the default ring back.
 */
export function usePortraitFrame(side: PortraitSide, frameId?: string | null, surface: FrameSurface = 'default'): ResolvedFrame | null {
  const v = useSyncExternalStore(subscribePortraitFrames, getPortraitFrameVersion, getPortraitFrameVersion);
  const own = useOwnPortraitFrameId();
  const id = frameId !== undefined ? frameId : side === 'self' ? own : null;
  // `v` is the cache key: the resolver's own cache is cleared on every tuner write.
  return useMemo(() => resolvePortraitFrame(side, id, surface), [v, side, id, surface]);
}

/** Your equipped portrait frame (the live loadout), or null. A primitive, so a selector never re-renders for nothing;
 *  re-read on every progression change, so the server kill switch (`catalogEpoch`) retires it at once. */
export function useOwnPortraitFrameId(): string | null {
  return useProgression((s) => (s.catalogEpoch >= 0 ? portraitFrameOf(mirrorFor(currentUserId(), s.mirror)?.loadout)?.id ?? null : null));
}

/** The live portrait frame a snapshot names (null = the default ring). Pass an OPPONENT's snapshot through
 *  `opponentSkins(show, …)` first, so the "Show opponent cosmetics" switch applies. */
export const frameIdOf = (snapshot: RunCosmeticSnapshot | null | undefined): string | null => portraitFrameOf(snapshot)?.id ?? null;

/** The disc host's extra class (with its leading space) for a resolved frame, '' when there is none. */
export function pfClass(frame: ResolvedFrame | null): string {
  return frame ? ' pf-on' : '';
}

/** The ring image itself, absolutely placed over the disc host (see `.pframe` in styles.css). */
export const PortraitFrame = memo(function PortraitFrame({ frame }: { frame: ResolvedFrame | null }): JSX.Element | null {
  if (!frame) return null;
  return (
    <span className="pframe-box" aria-hidden="true" data-frame={frame.id}>
      <img decoding="sync" className="pframe" src={frame.src} alt="" draggable={false} style={frame.imgStyle} />
    </span>
  );
});
