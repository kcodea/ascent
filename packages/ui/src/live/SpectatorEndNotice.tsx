/**
 * THE SPECTATOR'S END NOTICE (owner 2026-10-24, R-SPECTATE-END-01): the end gate opens on the menu with this over it.
 * The watched player's place in the end screen's numeral and the line the watch screen showed at a game's end, then the
 * Account XP panel for watching it (the post-game one, `ProgressionPostgame`, once its settlement answers; nothing when
 * it earned none). Continue closes it. All existing pieces: `.vsveil`, `.vspanel`, `.endplace-num`, `.vsplate`.
 */
import { sfx } from '../sfx';
import { placementText } from '../rank/rankFormat';
import { ProgressionPostgame } from '../progression/ProgressionPostgame';
import { dismissSpectatorEnd, useSpectatorEnd } from './spectatorEnd';
import '../versus/versus.css';
import './live.css';

export function SpectatorEndNotice(): JSX.Element | null {
  const notice = useSpectatorEnd((s) => s.notice);
  if (!notice) return null;
  return (
    <div className="vsveil lvend lvend-menu" role="dialog" aria-label="The game has ended">
      <div className="vspanel">
        <div className="endplace"><span className="endplace-num">{notice.placement ? placementText(notice.placement) : 'Finished'}</span></div>
        <div className="lvend-sub">{notice.name} finished the game.</div>
        {notice.xpKey && <div className="lvend-xp"><ProgressionPostgame localKey={notice.xpKey} active /></div>}
        <div className="vspanel-actions">
          <button type="button" className="vsplate" onClick={() => { sfx.pulse(); dismissSpectatorEnd(); }}>Continue</button>
        </div>
      </div>
    </div>
  );
}
