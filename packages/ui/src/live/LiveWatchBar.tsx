/**
 * LIVE GAMES: the watch screen's chrome (2026-10-15; re-laid out 2026-10-16, R-SPECTATE-HUD-01). The Versus spectator
 * HUD for ONE player: me as a spectator top left (my plate and emotes, the stands, Leave) and the live cursor. No
 * "who I watch" plate: there is only the one player, whose portrait and name are on screen (R-SPECTATE-WATCHBAR-01). While waiting for the first frame
 * a short "Joining" panel. The game's END is no longer drawn here (owner 2026-10-24, R-SPECTATE-END-01): the end gate
 * shuts over the screen and opens on the Play menu, where `SpectatorEndNotice` shows the placement and the XP.
 * All existing pieces: `MemberRing`, the name pill, `.vsplate`, `.vspanel`.
 */
import { sfx } from '../sfx';
import { useGame } from '../store';
import { SpectatorSelf } from '../versus/SpectatorHud';
import { useSpectate } from '../versus/spectate';
import { leaveLiveGame, useLiveWatch } from './liveWatch';
import '../versus/versus.css';
import './live.css';

export function LiveWatchBar(): JSX.Element | null {
  const game = useLiveWatch((s) => s.game);
  const active = useSpectate((s) => s.active);
  // ONE spectator HUD at a time (R-SPECTATE-HUD-02): a Versus watch screen draws its own (SpectatorBar), so a live-game
  // session still lingering behind it never stacks a second "me" chip and cursor on top.
  const versusScreen = useGame((s) => s.run.mode === 'versus');
  if (!game || !active || versusScreen) return null;
  // Me, as a spectator, top left (R-SPECTATE-HUD-01). Nothing names the one player I watch (R-SPECTATE-WATCHBAR-01).
  return <SpectatorSelf onLeave={leaveToList} />;
}

const leaveToList = (): void => leaveLiveGame(true);

/** Waiting for the watched player's first frame (the list is closed, the screen not open yet). */
export function LiveJoining(): JSX.Element | null {
  const joining = useLiveWatch((s) => s.joining);
  const game = useLiveWatch((s) => s.game);
  const active = useSpectate((s) => s.active);
  if (!joining || !game || active) return null;
  return (
    <div className="vsveil" role="dialog" aria-label="Joining">
      <div className="vspanel">
        <div className="vspanel-title">Joining {game.display_name}</div>
        <div className="vspanel-body">The game appears in a moment.</div>
        <div className="vspanel-actions"><button type="button" className="vsplate" onClick={() => { sfx.pulse(); leaveLiveGame(true); }}>Cancel</button></div>
      </div>
    </div>
  );
}
