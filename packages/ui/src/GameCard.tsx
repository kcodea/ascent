/**
 * THE GAME CARD (UI refinement 2026-10-16; owner: "make the 'game' cards considerably better across the board. they
 * are pretty ugly. this should help both career and recent games as well"). ONE card for a finished game, used by
 * the Career's Match History (ranked + practice) and by Recent Games. The hierarchy, left to right:
 *
 *   PLACEMENT  the single dominant element, said ONCE: a big ordinal coloured by band (1st gold with the crown, its own
 *              shape; top 4 green; 5th-8th red) over a matching band down the card's left edge.
 *   HERO       the portrait in its recorded frame, the hero's name, the player's name (feed), the fight record and
 *              the rank the game was played at (R-GAME-RANK-01; ranked games only).
 *   BOARD      the final board as a compact strip of the real `Card` (stars, Gilded and stat badges are the Card's own).
 *   SIDE       the actions (Replay, Career) as secondary plates.
 *   RUNES      a row under the board: each rune's emblem and name, with its hover tip.
 *   META       one quiet dotted line under it all: date · length · rounds · rating change · strength.
 *
 * The card is LAYOUT ONLY: every slot is a node the host renders, so each page keeps its own data rules (skins
 * through "Show opponent cosmetics", Watch / Lobby behaviour, test hooks) and only the presentation is shared.
 * Static styling; the hover is a transform lift (styles.css "THE GAME CARD").
 */
import type { HTMLAttributes, ReactNode } from 'react';
import { Icon } from './Icon';

export type GameBand = 'won' | 'top4' | 'lost' | 'none';

/** The placement as the card prints it: "1st", "2nd" ... or "-" with no placement. */
export function placeText(place: number | null): string {
  if (place === null || !(place > 0)) return '-';
  const v = place % 100;
  const suf = v >= 11 && v <= 13 ? 'th' : ({ 1: 'st', 2: 'nd', 3: 'rd' } as Record<number, string>)[place % 10] ?? 'th';
  return `${place}${suf}`;
}

/** Band of a placement: 1st `won`, 2nd-4th `top4`, 5th-8th `lost`, none `none` (the same split as `outcomeOf`). */
export function bandOf(place: number | null): GameBand {
  if (place === null || !(place > 0)) return 'none';
  return place === 1 ? 'won' : place <= 4 ? 'top4' : 'lost';
}

export function GameCard({
  place, label, resultClass = '', className = '', hero, title, subtitle, record, rank, board, boardKey, lobby, runes, actions, meta, extra, as = 'article', rootProps,
}: {
  place: number | null;
  /** What the placement means, for assistive tech ("Victory", "2nd place"). */
  label: string;
  /** Extra classes on the placement element (a host's own hooks). */
  resultClass?: string;
  /** Extra classes on the card itself (a host's own hooks, e.g. `focus`). */
  className?: string;
  hero: ReactNode; title: ReactNode; subtitle?: ReactNode; record?: ReactNode;
  /** The rank the game was played at (`GameRank`, R-GAME-RANK-01): beside the record; nothing on an unranked game. */
  rank?: ReactNode;
  board: ReactNode; runes?: ReactNode; actions?: ReactNode; meta: ReactNode;
  /** Whose board the board slot shows (a new key crossfades it in: the lobby picker swapping seats). */
  boardKey?: string;
  /** Above the board: the lobby picker (who is in this game, and whose board is showing). */
  lobby?: ReactNode;
  /** Below the card's body: an expanded drill-down (the lobby scoreboard). */
  extra?: ReactNode;
  as?: 'article' | 'div';
  rootProps?: HTMLAttributes<HTMLElement>;
}) {
  const band = bandOf(place);
  const Root = as;
  return (
    <Root {...rootProps} className={`gc gc-${band} ${className}`.trim()}>
      <div className="gc-body">
        <div className={`gc-place ${band} ${resultClass}`.trim()} aria-label={label}>
          {band === 'won' && <span className="gc-crown" aria-hidden><Icon name="crown" /></span>}
          <span className="gc-place-n">{placeText(place)}</span>
        </div>
        <div className="gc-hero">
          {hero}
          <div className="gc-heroid">
            <div className="gc-title">{title}</div>
            {subtitle && <div className="gc-sub">{subtitle}</div>}
            {(record || rank) && <div className="gc-record">{record}{rank}</div>}
          </div>
        </div>
        <div className="gc-side">
          {actions && <div className="gc-actions">{actions}</div>}
        </div>
        {lobby && <div className="gc-lobby">{lobby}</div>}
        <div className="gc-board"><div className="gc-board-in" key={boardKey ?? 'own'}>{board}</div></div>
        {/* The runes are their own row under the board, icon + name (owner 2026-10-16: "the minions + runes can be much
            larger and contain the rune names as well"). */}
        {runes && <div className="gc-runes">{runes}</div>}
        <div className="gc-meta">{meta}</div>
      </div>
      {extra}
    </Root>
  );
}
