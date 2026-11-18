/**
 * THE SPECTATOR'S OWN HUD (owner 2026-10-16: "maybe in the top left it shows me as a spectator, and if there are
 * multiple players to spectate, that can be in the bottom right instead"; R-SPECTATE-HUD-01).
 *
 *  - TOP LEFT, `SpectatorSelf`: ME, as a spectator. My portrait ring in my own frame, my name and a "Spectating" pill
 *    (the same plate the PLAYER sees for me in their "Spectating" indicator, so both screens agree on where the stands
 *    are), then the other people in the stands (the player's plates, `StandsPlates`), then Leave. My plate is my emote
 *    access: click or right-click it for the emote menu, which opens under it (R-SPECTATE-EMOTE-01).
 *  - TOP, right of it, `WatchedPanel`: who I am watching, when there is a choice (Versus, Versus Group, Duos): one chip
 *    per player (portrait, name, Health and Armor, the number key). Watching one player (a live ranked game) draws
 *    nothing: that player's hero portrait and name are already on screen (R-SPECTATE-WATCHBAR-01, 2026-11-17).
 *
 * All existing pieces: `MemberRing`, the name pill (`.vsspec-*`), the Docked rail's navy plate, the Gem plate (`.vsplate`).
 * No cursor rule anywhere here: the plates are buttons (the global gauntlet rule paints them), the rest inherits the
 * body's gauntlet (R-SPECTATE-CURSOR-02).
 */
import { memo, useMemo } from 'react';
import { currentUserId } from '../identity';
import { Icon } from '../Icon';
import { openEmoteMenu } from '../emotes/emoteRuntime';
import { sfx } from '../sfx';
import { toStage } from '../stage';
import { useGame } from '../store';
import { MemberRing } from './MemberRing';
import { FELLOWS_SHOWN, SpectatorSlice, StandsPlates } from './WatchersBadge';
import { myWatcherIdentity, othersInStands, useWatchers } from './watchers';
import { useMentors } from '../pings/pingRuntime';
import { useChatSpeech } from '../lobbyChat/chatSpeech';
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
  const awake = useChatSpeech((s) => !!s.awake[myId]);
  const openMenu = (e: React.MouseEvent<HTMLButtonElement>): void => {
    e.preventDefault();
    const r = e.currentTarget.getBoundingClientRect();
    // Below the plate when it fits (it sits at the top of the screen), flipped above only if not, never off the stage.
    openEmoteMenu({ x: toStage(r.left + r.width / 2), y: toStage(r.bottom) }, { spectator: true, below: true, anchor: { top: toStage(r.top), bottom: toStage(r.bottom) } });
  };
  return (
    <div className="vsspec vsself" role="group" aria-label="You are spectating">
      <div className="vsspec-seats">
        <button type="button" className={`vsspec-seat on vswatch-seat vsself-seat gtip gtip-under${awake ? ' awake' : ''}`} data-watcher={myId} data-tip="Emotes"
          aria-haspopup="menu" aria-label={`${name}, ${mentoring ? 'mentoring' : 'spectating'}. Open emotes`} onClick={openMenu} onContextMenu={openMenu}>
          <SpectatorSlice name={name} profile={me.profile} tag={mentoring ? 'Mentor' : 'Spectating'} />
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

/**
 * THE WATCH SWITCHER, along the TOP edge (owner 2026-11-17: "this is redundant and outdated - this doesnt need to show
 * when spectating one player. for lobby or duos spectating, make this cleaner and put it in the top somewhere to navigate
 * to different players instead"; R-SPECTATE-WATCHBAR-01). Two or more players: one compact chip each (portrait ring,
 * name, Health and Armor, who they fight, the number key), right of my own top-left plate, the watched one lit and the
 * players already out dimmed. One player (a live ranked game): nothing, the watched player's own portrait and name are
 * already on screen.
 */
export function WatchedPanel({ seats }: { seats: readonly WatchSeat[] }): JSX.Element | null {
  if (seats.length < 2) return null;
  return (
    <div className="vsspec vswatchbar" role="group" aria-label="Choose who to watch">
      {seats.map((s, i) => (
        <button key={s.key} type="button" className={`vswatchchip${s.on ? ' on' : ''}${s.out ? ' out' : ''}`} aria-pressed={s.on} disabled={s.out}
          aria-label={`Watch ${s.name}, Health ${s.health}${s.armor > 0 ? `, Armor ${s.armor}` : ''}${s.vs ? `, ${s.vs}` : ''} (${i + 1})`} onClick={() => { if (!s.on && !s.out) { sfx.tick(); s.pick(); } }}>
          <MemberRing name={s.name} heroId={s.heroId} profile={s.profile} className="vswatchchip-ring" />
          <kbd className="vswatchchip-key" aria-hidden="true">{i + 1}</kbd>
          <span className="vswatchchip-info">
            <span className="vswatchchip-name">{s.name}</span>
            <span className="vswatchchip-stats">
              <span className="vswatchchip-hp"><HeartIcon />{s.health}</span>
              {s.armor > 0 && <span className="vswatchchip-arm"><Icon name="armor" />{s.armor}</span>}
              {s.vs && <span className="vswatchchip-vs">{s.vs}</span>}
            </span>
          </span>
        </button>
      ))}
    </div>
  );
}

const HeartIcon = (): JSX.Element => <Icon name="heartPill" />;
