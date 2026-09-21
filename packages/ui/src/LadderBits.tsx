import type { ReactNode } from 'react';
import { getHero } from '@game/sim';
import type { BoardSnapshot } from '@game/sim';
import { RUNE_INDEX } from '@game/content';
import { Card, mdBold } from './Card';
import { storedCardView } from './storedBoardView';
import { heroArt, runeArt } from './art';
import { Icon } from './Icon';
import { medalOf } from './leaderboardData';

/**
 * LADDER BITS (owner polish 2026-09-20) — the presentational pieces the three ladder pages share (the ranked
 * Leaderboard, the Hall of Champions, Recent Games), in the Career page's visual language: the in-run
 * circular hero frame, the 7-slot final-team tiles built from the REAL `Card`, the podium medallion, and the
 * rune emblems. All `.lb-*` CSS. Nothing here animates in a loop; the only transitions are one-shot
 * transform/opacity (a hovered tile lifting).
 */

/** The in-run hero frame, re-seated: the same `.hero > .f > img.heroimg` markup StatusBar renders (so the
 *  ring, disc and portrait rules are shared), scoped under `.lb-heroframe` which only sets the geometry.
 *  `size` picks the diameter: `row` (default) for a table/banner row, `big` for a page hero. (Never a bare
 *  `row` class — that is the board row's class and its layout rules would apply.) On the BANNER rows (the
 *  Hall + Recent Games, inside `.lb-row-hero`) CSS alone re-seats this same markup in the game's gold
 *  portrait-ring PNG (owner 2026-09-21, the `.portring` recipe) — no wrapper, no extra class. */
export function LbHeroFrame({ heroId, size = 'row' }: { heroId: string | null | undefined; size?: 'row' | 'big' }) {
  const art = heroId ? heroArt(heroId) : undefined;
  const name = heroId ? getHero(heroId).name : '';
  return (
    <div className={`lb-heroframe${size === 'big' ? ' big' : ''}`}>
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt={name} draggable={false} /> : <Icon name="anvil" />}
        </div>
      </div>
    </div>
  );
}

export const LB_BOARD_SLOTS = 7;

/** The final team — exactly 7 slots, the real `Card` at a small scale (a transform, compositor-only), empty
 *  slots blank. `board` null → a labelled empty plate instead of seven blanks (the row has nothing stored). */
export function LbTeam({ board, empty = 'No board recorded' }: { board: BoardSnapshot | null; empty?: string }) {
  if (!board || board.minions.length === 0) return <div className="lb-team-none">{empty}</div>;
  const minions = board.minions.slice(0, LB_BOARD_SLOTS);
  return (
    <div className="lb-team" aria-label="Final team">
      {Array.from({ length: LB_BOARD_SLOTS }, (_, i) => {
        const m = minions[i];
        return m
          ? <div className="lb-tile" key={i}><div className="lb-tile-scale"><Card card={storedCardView(m)} suppressPop /></div></div>
          : <div className="lb-tile empty" key={i} aria-hidden="true" />;
      })}
    </div>
  );
}

/** The rank medallion: a gold / silver / bronze coin for the podium, a plain numeral beyond. */
export function LbMedallion({ rank }: { rank: number }) {
  const tier = medalOf(rank);
  return (
    <span className={`lb-medal ${tier}`} aria-label={`Rank ${rank}`}>
      {tier !== 'plain' && <Icon name="crown" />}
      <span className="lb-medal-n">{rank}</span>
    </span>
  );
}

/** The run's runes as emblems + names (the same art the Runeforge shows), each with the game's floating
 *  tooltip carrying the rune's text. Unknown ids (a rune this build doesn't ship) are skipped. */
export function LbRunes({ runes, empty }: { runes: readonly string[]; empty?: string }) {
  const defs = runes.map((id) => RUNE_INDEX[id]).filter((r): r is NonNullable<typeof r> => !!r);
  if (defs.length === 0) return empty ? <div className="lb-runes-none">{empty}</div> : null;
  return (
    <div className="lb-runes" aria-label="Runes">
      {defs.map((rune) => {
        const art = runeArt(rune.id);
        return (
          <div className="lb-rune" key={rune.id}>
            <span className="lb-rune-em">
              {art ? <img decoding="sync" src={art} alt="" aria-hidden draggable={false} /> : <Icon name="anvil" />}
            </span>
            <span className="lb-rune-name">{rune.name}</span>
            <div className="runtrophy-tip lb-rune-tip" role="tooltip">
              <b>{rune.name}</b>
              <span className="runtrophy-tip-body" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
              <span className="runtrophy-tip-kind">Rune</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}

/** A small-caps column / block label ("FINAL TEAM", "MATCH OUTCOME"). */
export function LbLabel({ children }: { children: ReactNode }) {
  return <div className="lb-label">{children}</div>;
}
