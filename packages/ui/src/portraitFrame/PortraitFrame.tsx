import { memo, useMemo, useSyncExternalStore } from 'react';
import {
  getPortraitFrameVersion,
  resolvePortraitFrame,
  subscribePortraitFrames,
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
 * `frameId` is the per-player override hook for ranked rewards later (a frame id carried on a snapshot, like
 * titles and skins). Nothing passes one yet.
 */
export function usePortraitFrame(side: PortraitSide, frameId?: string | null): ResolvedFrame | null {
  const v = useSyncExternalStore(subscribePortraitFrames, getPortraitFrameVersion, getPortraitFrameVersion);
  // `v` is the cache key: the resolver's own cache is cleared on every tuner write.
  return useMemo(() => resolvePortraitFrame(side, frameId), [v, side, frameId]);
}

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
