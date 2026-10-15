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
 * Cheap: memoized, and it re-renders only when the list changes (someone joins or leaves).
 */
import { memo } from 'react';
import { MemberRing } from './MemberRing';
import { useSpectate } from './spectate';
import { useWatchers, watcherName, type Watcher } from './watchers';
import './versus.css';

/** Plates shown before the "+N" chip. */
export const WATCHERS_SHOWN = 3;

const Plate = memo(function Plate({ w }: { w: Watcher }): JSX.Element {
  const name = watcherName(w);
  return (
    <span className="vsspec-seat on vswatch-seat">
      <MemberRing name={name} profile={w.profile} className="vsspec-ring vswatch-ring" />
      <span className="vsspec-info">
        <span className="vsspec-name hudpill-name">{name}</span>
        <span className="vsspec-hp hudpill-hp vswatch-tag">Spectating</span>
      </span>
    </span>
  );
});

export const WatchersBadge = memo(function WatchersBadge(): JSX.Element | null {
  const list = useWatchers((s) => s.list);
  const spectating = useSpectate((s) => s.active);
  if (spectating || list.length === 0) return null;
  const shown = list.slice(0, WATCHERS_SHOWN);
  const rest = list.slice(WATCHERS_SHOWN);
  const label = list.length === 1 ? `${watcherName(list[0]!)} is spectating` : `${list.length} people are spectating`;
  return (
    <div className="vsspec vswatch" role="status" aria-label={label}>
      <div className="vsspec-seats">
        {shown.map((w) => <Plate key={w.id} w={w} />)}
        {rest.length > 0 && (
          <span className="vsspec-name hudpill-name vswatch-more gtip" data-tip={rest.map(watcherName).join(', ')} aria-label={`${rest.length} more spectating`}>+{rest.length}</span>
        )}
      </div>
    </div>
  );
});
