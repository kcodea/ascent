/**
 * THE STANDS, FROM THE PLAYER'S SIDE (owner 2026-10-15: "can we add something in the ui for a player in the top left if
 * a spectator joins? it can show their portrait and name and say spectating?"; R-SPECTATE-WATCHERS-01).
 *
 * Top left of the player's own game screen (shop and combat, Versus and a live ranked lobby game): one plate per person
 * watching, up to three, then a "+N" chip. Built from the spectator bar's existing pieces (`.vsspec`): the portrait
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

/** Plates shown before the "+N" chip. */
export const WATCHERS_SHOWN = 3;

/** One person in the stands: their ring, name and "Spectating" (or "Muted"). Right-click mutes their emotes. */
export const StandsPlate = memo(function StandsPlate({ w, muted }: { w: Watcher; muted: boolean }): JSX.Element {
  const name = watcherName(w);
  return (
    <span
      className={`vsspec-seat on vswatch-seat gtip${muted ? ' muted' : ''}`}
      data-watcher={w.id}
      data-tip={muted ? `Right-click to unmute ${name}` : `Right-click to mute ${name}'s emotes`}
      aria-label={muted ? `${name}, spectating, emotes muted` : `${name}, spectating`}
      onContextMenu={(e) => { e.preventDefault(); toggleSpectatorMute(w.id); sfx.tick(); }}
    >
      <MemberRing name={name} profile={w.profile} className="vsspec-ring vswatch-ring" />
      <span className="vsspec-info">
        <span className="vsspec-name hudpill-name">{name}</span>
        <span className="vsspec-hp hudpill-hp vswatch-tag">{muted ? 'Muted' : 'Spectating'}</span>
      </span>
    </span>
  );
});

/** The stands as plates (up to three, then "+N"). Shared by the player's indicator and a spectator's own row. */
export const StandsPlates = memo(function StandsPlates({ list }: { list: readonly Watcher[] }): JSX.Element | null {
  const muted = useSpectatorEmotePrefs((s) => s.muted);
  if (list.length === 0) return null;
  const shown = list.slice(0, WATCHERS_SHOWN);
  const rest = list.slice(WATCHERS_SHOWN);
  return (
    <>
      {shown.map((w) => <StandsPlate key={w.id} w={w} muted={muted.includes(w.id)} />)}
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
        <StandsPlates list={list} />
      </div>
    </div>
  );
});
