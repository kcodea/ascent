import type { CSSProperties, RefObject } from 'react';
import { rankArt } from '../art';
import { Icon } from '../Icon';
import { barFraction, pointsText, rankLabel, standingGateText } from './rankFormat';
import { divisionNumeralOf, isPromotionReady, medalOf, type RankPosition } from './types';

/**
 * THE SHARED RANK PRESENTATION (blueprint §8: one component so the end screen, the Title's Play card, the
 * Rankings rows and the Career card cannot disagree). Two pieces:
 *
 *  • `RankCrest` — the medal crest seated inside the game's gold hero-portrait RING (the heroportrait.png the
 *    hero-select ceremony and the Career portrait wear), the disc keeping the in-run `.hero > .f > img.heroimg`
 *    markup, plus a small division PLATE (I / II / III) on the ring's bottom edge (owner decision 2026-09-20:
 *    the marker is composited, not eighteen paintings).
 *  • `RankBar` — crest + label + the division progress bar + points, with the promotion-ready line when the
 *    player sits on the gate. `size` picks the footprint; `anim` hands the end screen the refs GSAP drives.
 *
 * The fill is a `scaleX` transform (compositor-only) so the end screen can animate it without a repaint;
 * nothing here loops.
 */

export type RankSize = 'mini' | 'row' | 'big' | 'xl';
/** `row` = crest beside the text (Rankings, Title plate); `stack` = crest above a full-width bar with the name
 *  under it (the Career card, owner 2026-09-20); `screen` = the end screen's column (crest → label → bar). */
export type RankLayout = 'row' | 'stack' | 'screen';

export function RankCrest({ divisionIndex, size = 'row', className = '', style, crestRef, hideDivision = false }: {
  divisionIndex: number;
  size?: RankSize;
  className?: string;
  style?: CSSProperties;
  crestRef?: RefObject<HTMLDivElement>;
  /** The Title's mini crest carries the numeral in its label instead. */
  hideDivision?: boolean;
}): JSX.Element {
  const medal = medalOf(divisionIndex);
  const art = rankArt(medal);
  // `.portring` is the game's gold hero-portrait ring (hero-select/heroportrait.png, painted by CSS as the
  // ring's ::after) with the crest disc seated in its hole — the same composition the Career hero portrait
  // wears (owner ask 2026-09-20). The disc keeps the in-run `.hero > .f > img.heroimg` markup.
  return (
    <div className={`rankcrest portring rankcrest-${size} rankcrest-${medal.toLowerCase()} ${className}`.trim()} style={style} ref={crestRef} aria-hidden="true">
      <div className="hero">
        <div className="f">
          {art ? <img decoding="sync" className="heroimg" src={art} alt="" draggable={false} /> : <Icon name="crown" />}
        </div>
      </div>
      {!hideDivision && <span className="rankcrest-plate">{divisionNumeralOf(divisionIndex)}</span>}
    </div>
  );
}

export interface RankBarAnimRefs {
  crest: RefObject<HTMLDivElement>;
  crestNext: RefObject<HTMLDivElement>;
  label: RefObject<HTMLDivElement>;
  track: RefObject<HTMLDivElement>;
  fill: RefObject<HTMLDivElement>;
  tip: RefObject<HTMLSpanElement>;
  points: RefObject<HTMLDivElement>;
}

export function RankBar({ position, size = 'row', layout = 'row', showGate = true, demotionReady = false, caption, anim, nextDivisionIndex, className = '' }: {
  position: RankPosition;
  size?: RankSize;
  layout?: RankLayout;
  /** Print the "Promotion game ready — …" / "Demotion game — …" line when on a gate. */
  showGate?: boolean;
  /** The profile's demotion-ready flag (a 0 at a medal floor alone is ambiguous — a won promotion lands there too). */
  demotionReady?: boolean;
  /** An optional small caption under the points (the Career card's scalar). */
  caption?: string;
  /** End screen only: the refs GSAP animates. Without them the bar is static. */
  anim?: RankBarAnimRefs;
  /** End screen only: a second crest (the division a transition lands on), hidden until the timeline shows it. */
  nextDivisionIndex?: number;
  className?: string;
}): JSX.Element {
  const frac = barFraction(position);
  const onGate = isPromotionReady(position);                              // the endpoint glow lights on every surface
  const gateLine = showGate ? standingGateText(position, demotionReady) : null; // the gate line is opt-in per surface
  const medal = medalOf(position.divisionIndex).toLowerCase();
  const label = <div className="rankbar-label" ref={anim?.label}>{rankLabel(position)}</div>;
  const track = (
    <div className="rankbar-track" ref={anim?.track} role="progressbar" aria-valuemin={0} aria-valuemax={100} aria-valuenow={Math.round(frac * 100)} aria-label="Division progress">
      <div className="rankbar-fill" ref={anim?.fill} style={{ transform: `scaleX(${frac})` }} />
      <span className="rankbar-tip" ref={anim?.tip} />
    </div>
  );
  const points = <div className="rankbar-points" ref={anim?.points}>{pointsText(position)}</div>;
  return (
    <div className={`rankbar rankbar-${size} rankbar-${layout} rankbar-${medal}${onGate ? ' on-gate' : ''} ${className}`.trim()} aria-label={`${rankLabel(position)}, ${pointsText(position)}`}>
      <div className="rankbar-crests">
        <RankCrest divisionIndex={position.divisionIndex} size={size} crestRef={anim?.crest} />
        {nextDivisionIndex !== undefined && (
          <RankCrest divisionIndex={nextDivisionIndex} size={size} className="rankcrest-next" crestRef={anim?.crestNext} />
        )}
      </div>
      <div className="rankbar-body">
        {/* stack: bar → points → NAME → caption (the name reads under the bar, owner 2026-09-20). */}
        {layout === 'stack' ? <>{track}{points}{label}</> : <>{label}{track}{points}</>}
        {caption && <div className="rankbar-caption">{caption}</div>}
        {gateLine && <div className={`rankbar-gate${!onGate ? ' demo' : ''}`}>{gateLine}</div>}
      </div>
    </div>
  );
}
