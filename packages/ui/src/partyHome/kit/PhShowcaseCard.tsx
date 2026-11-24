/**
 * THE SHOWCASE CARD (kit, owner-approved look 2026-11-23): the party home's landscape player card. Splash art on one side
 * fading into the navy plate, the player on the other: eyebrow, name, title (or a fallback line), and a rank well with the
 * medal crest, the division, a progress bar and the points. It replaces the tall `PhBanner` everywhere a lineup shows.
 *
 *   <div className="phs-lineup">              a lineup sizes its cards: `phs-lineup` (1 or 2 side by side), `phs-lineup duel` (VS between),
 *     <PhShowcaseCard size="full" ... />   `phs-lineup grid` (2 x 2), `phs-lineup teams` (two `phs-team` columns + VS); see phShowcase.css
 *   </div>
 *
 * `size` is full (one seat), half (two) or compact (three or four); every inner size is in the card's own container units,
 * so one design serves every seat count. `mirrored` puts the art on the right (the far side of a VS faces inward): only the
 * art image flips, text never does. `mine` / `rival` colour the edge. `badge` (Leader, Host) sits on the art's top corner,
 * `band` (a `PhShowcaseBand`) across the art's foot, `youLabel` marks your own card when several seats show.
 * `overlay` renders after the press target inside the card (a menu); `under` renders below the card (its tabs).
 *
 * Static paint: no loops, the hover lift is a one-shot transform. No native tooltip (aria-label only), no own cursor (the
 * gauntlet rule paints it). The medallion is not a control; the whole card is one press target.
 */
import { memo, type CSSProperties, type ReactNode } from 'react';
import type { RankPosition } from '@game/sim';
import { RankCrest } from '../../rank/RankBar';
import { barFraction, pointsText, rankLabel } from '../../rank/rankFormat';
import { TitleBadge } from '../../titles/TitleBadge';
import '../shell/shell.css';
import './phShowcase.css';

export type PhCardSize = 'full' | 'half' | 'compact';

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

/** The card's press target: one button covering the whole card (as PhBanner), labelled for screen readers. */
function Press({ label, onClick, haspopup, expanded, children }: {
  label: string; onClick?: () => void; haspopup?: boolean; expanded?: boolean; children: ReactNode;
}) {
  return (
    <button type="button" className="phs-press" onClick={onClick} aria-label={label}
      aria-haspopup={haspopup ? 'menu' : undefined} aria-expanded={haspopup ? !!expanded : undefined}>
      {children}
    </button>
  );
}

export interface PhShowcaseCardProps {
  size: PhCardSize; label: string; name: string; art?: string;
  eyebrow?: ReactNode;
  /** The worn title (TitleBadge); else `fallbackLine` ("Level 12"); else a spacer, so every card keeps one height. */
  titleId?: string | null; fallbackLine?: string | null;
  rank: RankPosition | null; mine?: boolean; rival?: boolean; mirrored?: boolean;
  badge?: ReactNode; band?: ReactNode; youLabel?: boolean;
  onClick?: () => void; haspopup?: boolean; expanded?: boolean;
  overlay?: ReactNode; under?: ReactNode;
  /** The entrance stagger position. */
  index?: number; className?: string;
}

export const PhShowcaseCard = memo(function PhShowcaseCard({
  size, label, name, art, eyebrow, titleId, fallbackLine, rank, mine, rival, mirrored, badge, band, youLabel,
  onClick, haspopup, expanded, overlay, under, index = 0, className,
}: PhShowcaseCardProps): JSX.Element {
  return (
    <div className={cx('phs-card', `phs-${size}`, mine && 'phs-mine', rival && 'phs-rival', mirrored && 'phs-mirrored', expanded && 'phs-menu', className)}
      style={{ '--i': index } as CSSProperties}>
      <Press label={label} onClick={onClick} haspopup={haspopup} expanded={expanded}>
        <span className="phs-art" aria-hidden="true">
          {art && <img src={art} alt="" draggable={false} decoding="sync" />}
        </span>
        {badge && <span className="phs-badge">{badge}</span>}
        {band}
        {youLabel && <span className="phs-you">You</span>}
        <span className="phs-info">
          {eyebrow != null && <span className="phs-eyebrow">{eyebrow}</span>}
          <span className="phs-pname">{name}</span>
          <span className="phs-title">
            {titleId ? <TitleBadge id={titleId} /> : fallbackLine ? <span className="phs-fallback">{fallbackLine}</span> : '\u00A0'}
          </span>
          <RankWell rank={rank} />
        </span>
      </Press>
      {overlay}
      {under}
    </div>
  );
});

/** The rank well: crest, division, bar and points; "Unranked" alone when there is no rank. */
function RankWell({ rank }: { rank: RankPosition | null }) {
  if (!rank) {
    return (
      <span className="phs-rank unranked">
        <span className="phs-rk"><b>Unranked</b></span>
      </span>
    );
  }
  return (
    <span className="phs-rank">
      <RankCrest divisionIndex={rank.divisionIndex} size="row" className="phs-crest" />
      <span className="phs-rk">
        <b>{rankLabel(rank.divisionIndex)}</b>
        <span className="phs-bar" aria-hidden="true"><i style={{ width: `${barFraction(rank) * 100}%` }} /></span>
        <small>{pointsText(rank)}</small>
      </span>
    </span>
  );
}

/** AN OPEN SEAT: the card's footprint, a faint dashed gold edge, its content (invite medallion, label, Add bot) centred. */
export function PhShowcaseGhost({ size, label, onClick, index = 0, className, overlay, children }: {
  size: PhCardSize; label: string; onClick?: () => void; index?: number; className?: string; overlay?: ReactNode; children: ReactNode;
}): JSX.Element {
  return (
    <div className={cx('phs-card', `phs-${size}`, 'phs-ghost', className)} style={{ '--i': index } as CSSProperties}>
      <Press label={label} onClick={onClick}>{children}</Press>
      {overlay}
    </div>
  );
}

/** A seat's state band across the art's foot: Ready, In game, or the Versus pools (Resolve / Armor). */
export function PhShowcaseBand({ tone, children }: { tone: 'ready' | 'in_game' | 'pools'; children: ReactNode }): JSX.Element {
  return <span className={`phs-band t-${tone}`}>{children}</span>;
}

/** A ghost card's pieces: the gold "+" medallion, the label, a sub line, and a pill (e.g. Add bot). */
export function PhShowcaseInvite({ label = 'Invite', sub, pill }: { label?: ReactNode; sub?: ReactNode; pill?: ReactNode }) {
  return (
    <>
      <span className="phs-gmed" aria-hidden="true">+</span>
      <span className="phs-glbl">{label}</span>
      {sub && <span className="phs-gsub">{sub}</span>}
      {pill && <span className="phs-gpill">{pill}</span>}
    </>
  );
}
