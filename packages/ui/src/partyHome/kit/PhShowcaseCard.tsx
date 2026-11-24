/**
 * THE SHOWCASE CARD (kit, owner-approved look 2026-11-23): the party home's landscape player card. Splash art on one side
 * fading into the navy plate, the player on the other: eyebrow, name, title (or a fallback line), and a rank well with the
 * medal crest, the division, a progress bar and the points. Every lineup draws its players with it (it replaced the old flag
 * banner, retired 2026-11-24).
 *
 *   <div className="phs-lineup">              a lineup sizes its cards: `phs-lineup` (1 or 2 side by side), `phs-lineup duel` (VS between),
 *     <PhShowcaseCard size="full" ... />   `phs-lineup grid` (2 x 2), `phs-lineup teams` (two `phs-team` columns + VS); see phShowcase.css
 *   </div>
 *
 * `size` is full (one seat), half (two) or compact (three or four); every inner size is in the card's own container units,
 * so one design serves every seat count. `mirrored` puts the art on the right (the far side of a VS faces inward): only the
 * art image flips, text never does. `mine` / `rival` colour the edge. `badge` (Leader, Host) sits on the art's top corner,
 * `band` (a `PhShowcaseBand`) across the art's foot, `youLabel` marks your own card when several seats show.
 * `overlay` renders after the press target inside the card (a menu); `under` renders below the card (its tabs, PhCardTabs).
 *
 * Static paint: no loops, the hover lift is a one-shot transform. No native tooltip (aria-label only), no own cursor (the
 * gauntlet rule paints it). The medallion is not a control; the whole card is one press target.
 */
import { memo, type CSSProperties, type MouseEvent as ReactMouseEvent, type ReactNode } from 'react';
import type { RankPosition } from '@game/sim';
import { RankCrest } from '../../rank/RankBar';
import { barFraction, pointsText, rankLabel } from '../../rank/rankFormat';
import { medalKey } from '../../rank/types';
import { TitleBadge } from '../../titles/TitleBadge';
import { Icon } from '../../Icon';
import '../shell/shell.css';
import './phShowcase.css';

export type PhCardSize = 'full' | 'half' | 'compact';

/** An open card (its menu showing): the showcase card's `.phs-card.phs-menu`. A lineup's outside-press close skips a press
 *  inside it, so a menu item's press lands. */
export const OPEN_CARD_SELECTOR = '.phs-card.phs-menu';

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

/** The card's press target: one button covering the whole card, labelled for screen readers. */
function Press({ label, onClick, haspopup, expanded, children }: {
  label: string; onClick?: (e: ReactMouseEvent) => void; haspopup?: boolean; expanded?: boolean; children: ReactNode;
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
  /** PRESS ZONES (owner 2026-11-24): a press on the art, on the title, or on the rank box runs its own action in place of
   *  `onClick` (on your card: the Avatar picker, the Title picker, the Career page). A press anywhere else, and a keyboard
   *  press, still runs `onClick`; each zone's action is also reachable there or from the tabs. */
  onArt?: () => void; onTitle?: () => void; onRank?: () => void;
  overlay?: ReactNode; under?: ReactNode;
  /** The entrance stagger position. */
  index?: number; className?: string;
}

/** THE NAME FITS ON ONE LINE (R8, 2026-11-23): its size steps down with how wide the name is, measured as em of the name
 *  font (Outfit 900, uppercase, 0.02em tracking; widths measured in the dev server). A short name keeps the full 8.4cqw; a
 *  longer one shrinks so it fills the info column (at least 43cqw wide at every size; 42 leaves a hair of margin). The floor
 *  is the size that still fits the widest legal name (PLAYER_NAME_MAX 24 x "W"); the CSS ellipsis is only a safety net
 *  below it. Pure (no layout read), so a lineup never measures text. */
export const PHS_NAME_MAX_CQW = 8.4;
const PHS_NAME_BUDGET_CQW = 42;
export const PHS_NAME_FLOOR_CQW = 1.7;
const WIDE: Record<string, number> = { W: 1.02, M: 0.9, O: 0.86, Q: 0.86, G: 0.84, D: 0.8, N: 0.79, H: 0.78 };
const NARROW: Record<string, number> = { I: 0.35, '1': 0.43, ' ': 0.2, '.': 0.34, ',': 0.34, "'": 0.3, '!': 0.36, '-': 0.49, J: 0.56, '7': 0.55 };

/** The name's width in em of the name font: wide and narrow letters by their measured width, every other Latin letter or
 *  digit at 0.76 em (the widest of the rest, A and K, are 0.74), anything else (accents, other scripts) at 1 em. */
export function nameEm(name: string): number {
  let em = 0;
  for (const ch of name.toUpperCase()) {
    em += WIDE[ch] ?? NARROW[ch] ?? (/[A-Z0-9_]/.test(ch) ? 0.76 : 1);
  }
  return em;
}

/** The name's font size in the card's cqw: full size when it fits, else fitted to the column, never under the floor. */
export function nameFontCqw(name: string): number {
  const fit = PHS_NAME_BUDGET_CQW / Math.max(nameEm(name), 1);
  return Math.round(Math.max(PHS_NAME_FLOOR_CQW, Math.min(PHS_NAME_MAX_CQW, fit)) * 100) / 100;
}

/** THE RANK LABEL FITS ITS SLOT (R10, 2026-11-23): "Ascendant III" overran the compact slot by 3 px and the full one by far.
 *  The slot is what the well leaves after its padding, crest and gap: 43 - 6 - 13 - 3 = 21cqw at full and half, 45 - 4.8 -
 *  10.5 - 3 = 26.7cqw at compact (each minus a hair). The label keeps 3.4cqw when it fits, else shrinks to fit; its 0.04em
 *  tracking is 0.02em more than the name's, so it adds that per letter to nameEm. */
export const PHS_RANK_MAX_CQW = 3.4;
const PHS_RANK_SLOT_CQW: Record<PhCardSize, number> = { full: 20.6, half: 20.6, compact: 26.2 };
export function rankLabelCqw(label: string, size: PhCardSize): number {
  const em = nameEm(label) + 0.02 * [...label].length;
  return Math.round(Math.min(PHS_RANK_MAX_CQW, PHS_RANK_SLOT_CQW[size] / Math.max(em, 1)) * 100) / 100;
}

export const PhShowcaseCard = memo(function PhShowcaseCard({
  size, label, name, art, eyebrow, titleId, fallbackLine, rank, mine, rival, mirrored, badge, band, youLabel,
  onClick, onArt, onTitle, onRank, haspopup, expanded, overlay, under, index = 0, className,
}: PhShowcaseCardProps): JSX.Element {
  const zoned = !!(onArt || onTitle || onRank);
  const press = !zoned ? onClick : (e: ReactMouseEvent): void => {
    const t = e.target as Element;
    if (onRank && t.closest('.phs-rank')) onRank();
    else if (onTitle && t.closest('.phs-title > *')) onTitle();
    else if (onArt && t.closest('.phs-art')) onArt();
    else onClick?.();
  };
  return (
    <div className={cx('phs-card', `phs-${size}`, mine && 'phs-mine', rival && 'phs-rival', mirrored && 'phs-mirrored', expanded && 'phs-menu', onArt && 'phs-artgo', onTitle && 'phs-titlego', className)}
      style={{ '--i': index } as CSSProperties}>
      <Press label={label} onClick={press} haspopup={haspopup} expanded={expanded}>
        <span className="phs-art" aria-hidden="true">
          {art && <img src={art} alt="" draggable={false} decoding="sync" />}
        </span>
        {art && <img className="phs-wash" src={art} alt="" aria-hidden="true" draggable={false} decoding="sync" />}
        {badge && <span className="phs-badge">{badge}</span>}
        {band}
        {youLabel && <span className="phs-you">You</span>}
        <span className="phs-info">
          {eyebrow != null && <span className="phs-eyebrow">{eyebrow}</span>}
          <span className="phs-pname" style={{ '--phs-nf': `${nameFontCqw(name)}cqw` } as CSSProperties}>{name}</span>
          <span className="phs-title">
            {titleId ? <TitleBadge id={titleId} /> : fallbackLine ? <span className="phs-fallback">{fallbackLine}</span> : '\u00A0'}
          </span>
          <RankWell rank={rank} size={size} />
        </span>
      </Press>
      {overlay}
      {under}
    </div>
  );
});

/** The rank well: crest, division, bar and points; "Unranked" alone when there is no rank. */
function RankWell({ rank, size }: { rank: RankPosition | null; size: PhCardSize }) {
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
        <b style={{ '--phs-rf': `${rankLabelCqw(rankLabel(rank.divisionIndex), size)}cqw` } as CSSProperties}>{rankLabel(rank.divisionIndex)}</b>
        <span className={`phs-bar rankbar-${medalKey(rank.divisionIndex)}`} aria-hidden="true"><i style={{ width: `${barFraction(rank) * 100}%` }} /></span>
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

/** The Leader badge (crown + word) for `badge`. */
export function PhLeaderBadge() {
  return <><Icon name="crown" /><span>Leader</span></>;
}
