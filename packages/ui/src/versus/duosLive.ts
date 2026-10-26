/**
 * RANKED DUOS on Live Games (owner design 2026-10-26, Q11; phase 3): one listing row per LIVE TEAM (`duos:<room>`),
 * published by the team's first seat only (`lobby_live_duos_heartbeat`, 2026-11-01-ranked-duos-party.sql). The row is
 * the team's name, p1's hero and the team's own medal; Watch opens the party room as a spectator, which watches the two
 * live teammates (never the recorded teams' fights). A friends-only party is never listed (the server answers 0).
 *
 * Egress (R-NET-01 / R-NET-BACKOFF-01): one tiny RPC every 15 s and on a round / phase change, nothing else; a failed
 * beat backs off; a server without the RPC (`not_deployed`) stops publishing for the session.
 */
import { useEffect } from 'react';
import { liveRemote, type LiveError } from '../live/liveRemote';
import { keyedBackoff, pageHidden } from '../net/backoff';
import { useVersus } from './versusStore';
import type { VersusPhase } from './versusRemote';

export const DUOS_LIVE_PREFIX = 'duos:';
const BEAT_MS = 15_000;
const backoff = keyedBackoff({ base: BEAT_MS, fastTries: 1, max: 120_000, hiddenFloor: 60_000 });
let missing = false;

/** The listing phase of a match phase. */
export function duosLivePhase(p: VersusPhase): 'hero' | 'shop' | 'combat' | 'end' {
  return p === 'hero_select' ? 'hero' : p === 'combat' ? 'combat' : p === 'complete' ? 'end' : 'shop';
}

/** The room a Live Games `duos:` row watches (null for a solo row). */
export const duosLiveRoomOf = (gameId: string): string | null =>
  gameId.startsWith(DUOS_LIVE_PREFIX) ? gameId.slice(DUOS_LIVE_PREFIX.length) : null;

/** Mounted with the Versus HUD: publishes my team's row while I hold the first seat of a Ranked Duos match. */
export function useDuosLivePublisher(): void {
  const roomId = useVersus((s) => s.match?.room_id ?? null);
  const ranked = useVersus((s) => s.match?.options?.mode === 'ranked_duos');
  const first = useVersus((s) => s.match?.group?.me === 'p1');
  const round = useVersus((s) => s.match?.round ?? 0);
  const phase = useVersus((s) => (s.match ? duosLivePhase(s.match.phase) : null));
  useEffect(() => {
    if (!ranked || !first || !roomId || !phase || missing) return undefined;
    let live = true;
    const beat = (): void => {
      if (!live || missing) return;
      const key = `${roomId}|${round}|${phase}`;
      const now = Date.now();
      if (!backoff.ready(key, now)) return;
      backoff.asked(key, now, pageHidden());
      liveRemote.duosHeartbeat(roomId, round, phase)
        .then(() => backoff.reset())
        .catch((e: LiveError) => { if (e?.code === 'not_deployed') missing = true; });
    };
    backoff.reset(); // a round / phase change publishes at once
    beat();
    if (phase === 'end') return () => { live = false; };
    const t = window.setInterval(beat, BEAT_MS);
    return () => { live = false; window.clearInterval(t); };
  }, [ranked, first, roomId, round, phase]);
}
