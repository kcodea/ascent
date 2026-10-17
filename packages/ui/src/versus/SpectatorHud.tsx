/**
 * THE SPECTATOR'S OWN HUD (owner 2026-10-16: "maybe in the top left it shows me as a spectator, and if there are
 * multiple players to spectate, that can be in the bottom right instead"; R-SPECTATE-HUD-01).
 *
 *  - TOP LEFT, `SpectatorSelf`: ME, as a spectator. My portrait ring in my own frame, my name and a "Spectating" pill
 *    (the same plate the PLAYER sees for me in their "Spectating" indicator, so both screens agree on where the stands
 *    are), then the other people in the stands (the player's plates, `StandsPlates`), then Leave. My plate is my emote
 *    access: click or right-click it for the emote menu, which opens under it (R-SPECTATE-EMOTE-01).
 *  - BOTTOM RIGHT, `WatchedPanel`: who I am watching. In Versus (two players) the two seat buttons (portrait, name,
 *    hearts, the 1 / 2 key): the switcher. In a live ranked game (one player) a compact name + rank plate, without a
 *    second portrait, because that player's hero portrait is already on screen bottom left.
 *
 * All existing pieces: `MemberRing`, the name / heart pills (`.vsspec-*`), `RankCrest`, the Gem plate (`.vsplate`).
 * No cursor rule anywhere here: the plates are buttons (the global gauntlet rule paints them), the rest inherits the
 * body's gauntlet (R-SPECTATE-CURSOR-02).
 */
import { memo, useMemo } from 'react';
import { rankLabel } from '@game/sim';
import { currentUserId } from '../identity';
import { Icon } from '../Icon';
import { openEmoteMenu } from '../emotes/emoteRuntime';
import { RankCrest } from '../rank/RankBar';
import { sfx } from '../sfx';
import { toStage } from '../stage';
import { useGame } from '../store';
import { MemberRing } from './MemberRing';
import { StandsPlates } from './WatchersBadge';
import { myWatcherIdentity, useWatchers } from './watchers';
import './versus.css';

/** The top-left plate's anchor key when I have no account id yet (a test, or signed out). */
export const SELF_WATCHER_FALLBACK = 'me';

/** Me, as a spectator, top left: my plate (emotes), the rest of the stands, Leave. */
export const SpectatorSelf = memo(function SpectatorSelf({ onLeave }: { onLeave: () => void }): JSX.Element {
  const playerName = useGame((s) => s.playerName);
  const avatar = useGame((s) => s.playerAvatar);
  // Re-read when my name or picture changes.
  const me = useMemo(() => myWatcherIdentity(), [playerName, avatar]);
  const myId = currentUserId() ?? SELF_WATCHER_FALLBACK;
  const fellows = useWatchers((s) => s.list);
  const name = me.name || 'You';
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    const r = e.currentTarget.querySelector('.portring')?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
    openEmoteMenu({ x: toStage(r.left + r.width / 2), y: toStage(r.bottom) }, { spectator: true, below: true });
  };
  return (
    <div className="vsspec vsself" role="group" aria-label="You are spectating">
      <div className="vsspec-seats">
        <button type="button" className="vsspec-seat on vswatch-seat vsself-seat gtip" data-watcher={myId} data-tip="Emotes"
          aria-haspopup="menu" aria-label={`${name}, spectating. Open emotes`} onClick={openMenu} onContextMenu={openMenu}>
          <MemberRing self name={name} profile={me.profile} className="vsspec-ring" />
          <span className="vsspec-info">
            <span className="vsspec-name hudpill-name">{name}</span>
            <span className="vsspec-hp hudpill-hp vswatch-tag">Spectating</span>
          </span>
        </button>
        <StandsPlates list={fellows} />
      </div>
      <button type="button" className="vsplate vsspec-leave" onClick={() => { sfx.pulse(); onLeave(); }}>Leave</button>
    </div>
  );
});

/** One player I can watch (Versus): their portrait, name and hearts, the key that picks them. */
export interface WatchSeat {
  key: string;
  name: string;
  heroId: string | null;
  profile: Record<string, unknown> | null | undefined;
  hearts: number;
  on: boolean;
  pick: () => void;
}

/** Bottom right: who I am watching. Two or more players: the switcher. One: the compact name + rank plate. */
export function WatchedPanel({ seats, single }: {
  seats?: readonly WatchSeat[];
  single?: { name: string; divisionIndex: number; rankPoints: number };
}): JSX.Element | null {
  if (seats && seats.length > 1) {
    return (
      <div className="vsspec vswatchpanel" role="group" aria-label="Choose who to watch">
        <span className="vsspec-label">Watching</span>
        <div className="vsspec-seats">
          {seats.map((s, i) => (
            <button key={s.key} type="button" className={`vsspec-seat${s.on ? ' on' : ''}`} aria-pressed={s.on}
              aria-label={`Watch ${s.name}, ${s.hearts} hearts (${i + 1})`} onClick={() => { if (!s.on) { sfx.tick(); s.pick(); } }}>
              <MemberRing name={s.name} heroId={s.heroId} profile={s.profile} className="vsspec-ring" />
              <span className="vsspec-info">
                <span className="vsspec-name hudpill-name">{s.name}</span>
                <span className="vsspec-hp hudpill-hp"><HeartIcon />{s.hearts}</span>
              </span>
              <kbd className="vsspec-key" aria-hidden="true">{i + 1}</kbd>
            </button>
          ))}
        </div>
      </div>
    );
  }
  if (!single) return null;
  return (
    <div className="vsspec vswatchpanel vswatchpanel-one" role="group" aria-label={`Watching ${single.name}`}>
      <span className="vsspec-label">Watching</span>
      <span className="vsspec-info">
        <span className="vsspec-name hudpill-name">{single.name}</span>
        <span className="vsspec-hp hudpill-hp"><RankCrest divisionIndex={single.divisionIndex} size="mini" />{rankLabel({ divisionIndex: single.divisionIndex, points: single.rankPoints })}</span>
      </span>
    </div>
  );
}

const HeartIcon = (): JSX.Element => <Icon name="heartPill" />;
