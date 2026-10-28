/**
 * THE STANDS, FROM THE PLAYER'S SIDE (owner 2026-10-15: "can we add something in the ui for a player in the top left if
 * a spectator joins? it can show their portrait and name and say spectating?"; R-SPECTATE-WATCHERS-01).
 *
 * Top left of the player's own game screen (shop and combat, Versus and a live ranked lobby game): one plate per person
 * watching, up to three, then a "+N" chip, in ONE column down the left edge (owner 2026-10-29: "It's cluttered";
 * R-EMOTE-LAYOUT-01). Built from the spectator bar's existing pieces (`.vsspec`): the portrait
 * ring in their frame (`MemberRing`), the name pill and a second pill reading "Spectating". It stays while they watch
 * and goes when they leave (the list is the watcher rows, `watchers.ts`). The chip's names ride the game's own
 * `data-tip` hover, never a native tooltip.
 *
 * SPECTATOR EMOTES (owner 2026-10-16, R-SPECTATE-EMOTE-01): a spectator's emote pops from their plate (the plate
 * carries `data-watcher`, the bubble's anchor). Right-click a plate to mute that spectator's emotes (again to unmute);
 * a muted plate sits back and says so. The same plate lists the OTHER spectators on a spectator's own top left
 * (`SpectatorHud.tsx`).
 *
 * Cheap: memoized, and it re-renders only when the list (or a mute) changes (someone joins or leaves).
 */
import { memo } from 'react';
import { sfx } from '../sfx';
import { MemberRing } from './MemberRing';
import { useSpectate } from './spectate';
import { toggleSpectatorMute, useSpectatorEmotePrefs } from './spectatorEmotes';
import { useWatchers, watcherName, type Watcher } from './watchers';
import './versus.css';
import { touchText } from '../touchInput';
import { setMyMentor, useMentors } from '../pings/pingRuntime';

/** Plates shown before the "+N" chip. */
export const WATCHERS_SHOWN = 3;

/** One person in the stands: their ring, name and "Spectating" (or "Mentor" / "Muted"). Right-click mutes their emotes.
 *  On the PLAYER's own indicator (`promote`) a click makes them my Mentor, or demotes them (LIVE PINGS, owner 2026-10-29:
 *  "i want a player to be able to promote a spectator to a mentor"; R-PING-03). */
export const StandsPlate = memo(function StandsPlate({ w, muted, mentor = false, promote = false }: { w: Watcher; muted: boolean; mentor?: boolean; promote?: boolean }): JSX.Element {
  const name = watcherName(w);
  const canPromote = promote && !w.id.startsWith('anon:');
  const muteTip = muted ? `${touchText('Right-click', 'Tap and hold')} to unmute ${name}` : `${touchText('Right-click', 'Tap and hold')} to mute ${name}'s emotes`;
  const tip = canPromote ? `${touchText('Click', 'Tap')} to ${mentor ? `remove ${name} as your mentor` : `make ${name} your mentor`}. ${muteTip}.` : muteTip;
  const toggle = (): void => { setMyMentor(mentor ? null : w); sfx.tick(); };
  return (
    <span
      className={`vsspec-seat on vswatch-seat gtip${muted ? ' muted' : ''}${mentor ? ' mentor' : ''}`}
      data-watcher={w.id}
      data-tip={tip}
      role={canPromote ? 'button' : undefined}
      tabIndex={canPromote ? 0 : undefined}
      aria-label={`${name}, ${mentor ? 'your mentor' : 'spectating'}${muted ? ', emotes muted' : ''}`}
      onClick={canPromote ? toggle : undefined}
      onKeyDown={canPromote ? (e) => { if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); toggle(); } } : undefined}
      onContextMenu={(e) => { e.preventDefault(); toggleSpectatorMute(w.id); sfx.tick(); }}
    >
      <MemberRing name={name} profile={w.profile} className="vsspec-ring vswatch-ring" />
      <span className="vsspec-info">
        <span className="vsspec-name hudpill-name">{name}</span>
        <span className="vsspec-hp hudpill-hp vswatch-tag">{mentor ? 'Mentor' : muted ? 'Muted' : 'Spectating'}</span>
      </span>
    </span>
  );
});

/** Plates shown on a spectator's own column under their own plate (theirs is drawn first, so the column stays as short). */
export const FELLOWS_SHOWN = 2;

/** The stands as plates (up to `max`, then "+N"). Shared by the player's indicator and a spectator's own column. The
 *  mentors come first, so who is mentoring is always on show; `promote` (the player's own indicator) makes each plate
 *  a mentor toggle. */
export const StandsPlates = memo(function StandsPlates({ list, max = WATCHERS_SHOWN, promote = false }: { list: readonly Watcher[]; max?: number; promote?: boolean }): JSX.Element | null {
  const muted = useSpectatorEmotePrefs((s) => s.muted);
  const mentors = useMentors((s) => s.bySeat);
  if (list.length === 0) return null;
  const ids = new Set(Object.values(mentors).map((m) => m?.id));
  const ordered = ids.size ? [...list.filter((w) => ids.has(w.id)), ...list.filter((w) => !ids.has(w.id))] : list;
  const shown = ordered.slice(0, max);
  const rest = ordered.slice(max);
  return (
    <>
      {shown.map((w) => <StandsPlate key={w.id} w={w} muted={muted.includes(w.id)} mentor={ids.has(w.id)} promote={promote} />)}
      {rest.length > 0 && (
        <span className="vsspec-name hudpill-name vswatch-more gtip" data-tip={rest.map(watcherName).join(', ')} aria-label={`${rest.length} more spectating`}>+{rest.length}</span>
      )}
    </>
  );
});

export const WatchersBadge = memo(function WatchersBadge(): JSX.Element | null {
  const list = useWatchers((s) => s.list);
  const spectating = useSpectate((s) => s.active);
  if (spectating || list.length === 0) return null;
  const label = list.length === 1 ? `${watcherName(list[0]!)} is spectating` : `${list.length} people are spectating`;
  return (
    <div className="vsspec vswatch" role="status" aria-label={label}>
      <div className="vsspec-seats">
        <StandsPlates list={list} promote />
      </div>
    </div>
  );
});
