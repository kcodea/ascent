/**
 * VERSUS — MY CONNECTION, ON SCREEN (R-VERSUS-LINK-STATUS-01, netcode audit F2; owner 2026-11-10). With my own socket
 * down the shop looked normal for 20 s and more: End Turn showed ready, a passed card flew away, the clock ran, and none
 * of it had reached the room. And a game opened in a second tab left the first one frozen with no word at all.
 *
 *  - a drop under 1.5 s: nothing (the first retries land inside it);
 *  - then a small strip, "Reconnecting", which never takes the pointer;
 *  - past 12 s: "Connection lost" and what happens to my seat meanwhile, by mode;
 *  - a socket closed for good: the pause panel with the two ways on. "Play here" opens my socket again (the room then
 *    closes the other one); "Back to menu" leaves this screen only, never the match.
 *
 * Driven by the transport's real state (`versusConnection.ts`), not by a guess from missed heartbeats. One timer to the
 * next change of text; nothing per frame. Mounted once at the root (`Game.tsx`); self-gates on being in a room.
 */
import { useEffect, useState } from 'react';
import { leaveVersusLocally, myRole, useVersus } from './versusStore';
import { LINK_LOST_AFTER_MS, LINK_SHOW_AFTER_MS, reclaimVersusLink, useVersusLink, versusLinkView, type VersusLinkMode } from './versusConnection';
import './versus.css';
import './versusConnection.css';

const MODES: readonly string[] = ['ranked_duos', 'duos', 'group', 'duel'];

export function VersusConnectionStatus(): JSX.Element | null {
  const link = useVersusLink();
  const room = useVersus((s) => s.room);
  const inMatch = useVersus((s) => !!s.match && s.match.phase !== 'complete');
  const [, bump] = useState(0);
  const down = link.status === 'down';
  // One timer to the next change of text (shown at 1.5 s, "lost" at 12 s); none while connected.
  useEffect(() => {
    if (!down) return;
    const gone = Date.now() - link.since;
    const next = gone < LINK_SHOW_AFTER_MS ? LINK_SHOW_AFTER_MS - gone : gone < LINK_LOST_AFTER_MS ? LINK_LOST_AFTER_MS - gone : null;
    if (next == null) return;
    const t = window.setTimeout(() => bump((n) => n + 1), next + 16);
    return () => window.clearTimeout(t);
  });
  const role = myRole(room);
  const mode = String(room?.options?.mode ?? '');
  const view = versusLinkView({
    link, downFor: down ? Date.now() - link.since : 0, inRoom: !!room, seated: !!role && role !== 'spectator', inMatch,
    mode: (MODES.includes(mode) ? mode : null) as VersusLinkMode,
  });
  if (view.kind === 'none') return null;
  if (view.actions) {
    return (
      <div className="vsveil vslink-veil" role="alertdialog" aria-label={view.title}>
        <div className="vspanel">
          <div className="vspanel-title">{view.title}</div>
          {view.body && <div className="vspanel-body">{view.body}</div>}
          <div className="vspanel-actions">
            <button type="button" className="vsplate vsstartbtn" disabled={link.reclaiming} onClick={() => void reclaimVersusLink()}>
              {view.kind === 'elsewhere' ? 'Play here' : 'Try again'}
            </button>
            <button type="button" className="vsplate" onClick={leaveVersusLocally}>Back to menu</button>
          </div>
        </div>
      </div>
    );
  }
  return (
    <div className={`vslink${view.kind === 'lost' ? ' lost' : ''}`} role="status" aria-live="polite">
      <span className="vslink-dot" aria-hidden />
      <span className="vslink-title">{view.title}</span>
      {view.body && <span className="vslink-body">{view.body}</span>}
    </div>
  );
}
