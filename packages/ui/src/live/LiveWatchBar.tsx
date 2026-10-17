/**
 * LIVE GAMES: the watch screen's chrome (2026-10-15; re-laid out 2026-10-16, R-SPECTATE-HUD-01). The Versus spectator
 * HUD for ONE player: me as a spectator top left (my plate and emotes, the stands, Leave), the watched player's name
 * and rank compact bottom right, the live cursor. While waiting for the first frame
 * a short "Joining" panel; when the game ends, their placement in the end screen's numeral, then back to the list.
 * All existing pieces: `MemberRing`, the name pill, `RankCrest`, `.vsplate`, `.vspanel`, `.endplace-num`.
 */
import { sfx } from '../sfx';
import { placementText } from '../rank/rankFormat';
import { SpectatorCursor } from '../versus/SpectatorCursor';
import { SpectatorSelf, WatchedPanel } from '../versus/SpectatorHud';
import { useSpectate } from '../versus/spectate';
import { leaveLiveGame, useLiveWatch } from './liveWatch';
import '../versus/versus.css';
import './live.css';

export function LiveWatchBar(): JSX.Element | null {
  const game = useLiveWatch((s) => s.game);
  const ended = useLiveWatch((s) => s.ended);
  const active = useSpectate((s) => s.active);
  if (!game || !active) return null;
  return (
    <>
      <SpectatorCursor />
      {/* Me, as a spectator, top left; the one player I watch, compact, bottom right (R-SPECTATE-HUD-01). */}
      <SpectatorSelf onLeave={leaveToList} />
      <WatchedPanel single={{ name: game.display_name, divisionIndex: game.division_index, rankPoints: game.rank_points }} />
      {ended && (
        <div className="vsveil lvend" role="dialog" aria-label="The game has ended">
          <div className="vspanel">
            <div className="endplace"><span className="endplace-num">{ended.placement ? placementText(ended.placement) : 'Finished'}</span></div>
            <div className="lvend-sub">{game.display_name} finished the game.</div>
          </div>
        </div>
      )}
    </>
  );
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
