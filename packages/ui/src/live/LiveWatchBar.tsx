/**
 * LIVE GAMES: the watch screen's chrome (2026-10-15). The Versus spectator bar's look (`.vsspec`) for ONE player: their
 * portrait ring in their frame and skin, name and rank, the live cursor, and Leave. While waiting for the first frame
 * a short "Joining" panel; when the game ends, their placement in the end screen's numeral, then back to the list.
 * All existing pieces: `MemberRing`, the name pill, `RankCrest`, `.vsplate`, `.vspanel`, `.endplace-num`.
 */
import { rankLabel } from '@game/sim';
import { sfx } from '../sfx';
import { RankCrest } from '../rank/RankBar';
import { placementText } from '../rank/rankFormat';
import { MemberRing } from '../versus/MemberRing';
import { SpectatorCursor } from '../versus/SpectatorCursor';
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
      <div className="vsspec lvbar" role="group" aria-label={`Watching ${game.display_name}`}>
        <span className="vsspec-label">Watching</span>
        <div className="vsspec-seats">
          <span className="vsspec-seat on">
            <MemberRing name={game.display_name} heroId={game.hero_id} profile={{ cosmetics: game.cosmetics }} className="vsspec-ring" />
            <span className="vsspec-info">
              <span className="vsspec-name hudpill-name">{game.display_name}</span>
              <span className="vsspec-hp hudpill-hp"><RankCrest divisionIndex={game.division_index} size="mini" />{rankLabel({ divisionIndex: game.division_index, points: game.rank_points })}</span>
            </span>
          </span>
        </div>
        <button type="button" className="vsplate vsspec-leave" onClick={() => { sfx.pulse(); leaveLiveGame(true); }}>Leave</button>
      </div>
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
