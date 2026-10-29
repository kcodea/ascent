/**
 * THE SPECTATOR'S OWN HUD (owner 2026-10-16: "maybe in the top left it shows me as a spectator, and if there are
 * multiple players to spectate, that can be in the bottom right instead"; R-SPECTATE-HUD-01).
 *
 *  - TOP LEFT, `SpectatorSelf`: ME, as a spectator. My portrait ring in my own frame, my name and a "Spectating" pill
 *    (the same plate the PLAYER sees for me in their "Spectating" indicator, so both screens agree on where the stands
 *    are), then the other people in the stands (the player's plates, `StandsPlates`), then Leave. My plate is my emote
 *    access: click or right-click it for the emote menu, which opens under it (R-SPECTATE-EMOTE-01).
 *  - BOTTOM RIGHT, `WatchedPanel`: who I am watching. In Versus (two players) the two seat buttons (portrait, name,
 *    Health and Armor, the 1 / 2 key): the switcher. In a live ranked game (one player) a compact name + rank plate, without a
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
import { FELLOWS_SHOWN, StandsPlates } from './WatchersBadge';
import { myWatcherIdentity, othersInStands, useWatchers } from './watchers';
import { useMentors } from '../pings/pingRuntime';
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
  const stands = useWatchers((s) => s.list);
  // Never me twice: my plate is drawn first, so the others are the stands without me (R-SPECTATE-HUD-02).
  const fellows = useMemo(() => othersInStands(stands, [myId]), [stands, myId]);
  const name = me.name || 'You';
  // LIVE PINGS (R-PING-03): a player made me their Mentor: my plate says so (and right-click on their cards pings).
  const mentoring = useMentors((s) => Object.values(s.bySeat).some((m) => m?.id === myId));
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    const r = e.currentTarget.querySelector('.portring')?.getBoundingClientRect() ?? e.currentTarget.getBoundingClientRect();
    // Below the plate when it fits (it sits at the top of the screen), flipped above only if not, never off the stage.
    openEmoteMenu({ x: toStage(r.left + r.width / 2), y: toStage(r.bottom) }, { spectator: true, below: true, anchor: { top: toStage(r.top), bottom: toStage(r.bottom) } });
  };
  return (
    <div className="vsspec vsself" role="group" aria-label="You are spectating">
      <div className="vsspec-seats">
        <button type="button" className="vsspec-seat on vswatch-seat vsself-seat gtip gtip-right" data-watcher={myId} data-tip="Emotes"
          aria-haspopup="menu" aria-label={`${name}, ${mentoring ? 'mentoring' : 'spectating'}. Open emotes`} onClick={openMenu} onContextMenu={openMenu}>
          <MemberRing self name={name} profile={me.profile} className="vsspec-ring" />
          <span className="vsspec-info">
            <span className="vsspec-name hudpill-name">{name}</span>
            <span className="vsspec-hp hudpill-hp vswatch-tag">{mentoring ? 'Mentor' : 'Spectating'}</span>
          </span>
        </button>
        <StandsPlates list={fellows} max={FELLOWS_SHOWN} />
      </div>
      <button type="button" className="vsplate vsspec-leave" onClick={() => { sfx.pulse(); onLeave(); }}>Leave</button>
    </div>
  );
});

/** One player I can watch (Versus): their portrait, name, Health and Armor (R-VERSUS-HEALTH-01), the key that picks them. */
export interface WatchSeat {
  key: string;
  name: string;
  heroId: string | null;
  profile: Record<string, unknown> | null | undefined;
  health: number;
  armor: number;
  on: boolean;
  pick: () => void;
  /** VERSUS GROUP (R-VERSUS-GROUP-04): who this player fights this round ("vs Bob", "vs Copy of Bob"): the fight picker. */
  vs?: string | null;
  /** Out of the match: shown dimmed, not pickable. */
  out?: boolean;
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
            <button key={s.key} type="button" className={`vsspec-seat${s.on ? ' on' : ''}${s.out ? ' out' : ''}`} aria-pressed={s.on} disabled={s.out}
              aria-label={`Watch ${s.name}, Health ${s.health}${s.armor > 0 ? `, Armor ${s.armor}` : ''}${s.vs ? `, ${s.vs}` : ''} (${i + 1})`} onClick={() => { if (!s.on && !s.out) { sfx.tick(); s.pick(); } }}>
              <MemberRing name={s.name} heroId={s.heroId} profile={s.profile} className="vsspec-ring" />
              <span className="vsspec-info">
                <span className="vsspec-name hudpill-name">{s.name}</span>
                <span className="vsspec-hp hudpill-hp"><HeartIcon />{s.health}{s.armor > 0 && <b className="armval hudpill-arm"><Icon name="armor" /><span className="hp-armplus">+</span>{s.armor}</b>}</span>
                {s.vs && <span className="vsspec-vs">{s.vs}</span>}
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
