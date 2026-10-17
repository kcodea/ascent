/**
 * The small "rooms are open" badge on the title's Play and the side menu's Play (owner 2026-10-17,
 * R-VERSUS-OPEN-ROOMS-01). A round count with a STATIC halo whose OPACITY breathes (the kwglow recipe), paused while
 * the window is unfocused, still under reduced motion (styles.css `.vs-badge`). The words ride the Play wrapper's
 * data-tip bubble; this carries them for screen readers.
 */
import { versusRoomsTip } from './versusOpenRooms';

export function VsOpenBadge({ n, paused }: { n: number; paused: boolean }) {
  return (
    <span className={`vs-badge${paused ? ' paused' : ''}`} aria-label={versusRoomsTip(n)}>
      {n > 9 ? '9+' : n}
    </span>
  );
}
