/**
 * THE BANNER (kit): the party home's player banner as one shared component, so every page draws it from one source (the
 * painted rod across the top, the navy cloth with its gold side trim, the swallowtail foot), never by copying its markup.
 *
 *   <div className="ph-cards n2">          a row sizes its banners: put them in `.ph-cards` (n1..n4; add `vs` for a VS mark)
 *     <PhBanner art={url} onClick={...} label="Mike. Options">  <PhBannerName>Mike</PhBannerName> ... </PhBanner>
 *     <PhBanner ghost onClick={...} label="Open seat">  <PhBannerInvite /> </PhBanner>
 *   </div>
 *
 * Outside a row, pass `width` (STANDALONE: a fixed width, the height follows the banner's ratio).
 * `children` is the foot (name, medal chip, state); `ghost` is an empty seat (dimmed gold, its children centred); `badge`
 * sits top left (e.g. Leader); `overlay` renders after the banner inside its box (a menu). Static paint; the hover lift is a
 * one-shot transform.
 */
import type { CSSProperties, ReactNode } from 'react';
import { Icon } from '../../Icon';
import '../partyHome.css';

export function PhBanner({ art, ghost, badge, onClick, label, expanded, haspopup, index = 0, overlay, className, width, children }: {
  art?: string; ghost?: boolean; badge?: ReactNode; onClick?: () => void; label: string; expanded?: boolean; haspopup?: boolean;
  /** STANDALONE: a fixed width (a CSS length, or units of --phu as a number) outside a `.ph-cards` row; height follows. */
  width?: string | number;
  /** The entrance stagger position. */
  index?: number; overlay?: ReactNode; className?: string; children?: ReactNode;
}) {
  return (
    <div className={`ph-cardwrap${ghost ? ' open' : ''}${expanded ? ' menu' : ''}${width != null ? ' standalone' : ''}${className ? ` ${className}` : ''}`}
      style={{ '--i': index, ...(width != null ? { '--bw': typeof width === 'number' ? `calc(${width} * var(--phu, 1px))` : width } : {}) } as CSSProperties}>
      <span className="ph-bfoot" aria-hidden="true" />
      <button type="button" className={`ph-card${ghost ? ' ph-open' : ''}`} onClick={onClick} aria-label={label}
        aria-haspopup={haspopup ? 'menu' : undefined} aria-expanded={haspopup ? !!expanded : undefined}>
        <span className="ph-card-in">
          {art && !ghost && <img className="ph-art" src={art} alt="" draggable={false} decoding="sync" />}
          {badge && <span className="ph-lead">{badge}</span>}
          {ghost ? children : <span className="ph-foot">{children}</span>}
        </span>
      </button>
      <span className="ph-rod" aria-hidden="true" />
      {overlay}
    </div>
  );
}

/** A banner's name line (heavy rounded title type, scales with the banner). A plain name also scales to its own length
 *  (`--nl`), so a long name fits a narrow banner instead of cutting off. */
export function PhBannerName({ children }: { children: ReactNode }) {
  const style = typeof children === 'string' ? ({ '--nl': Math.max(children.length, 1) } as CSSProperties) : undefined;
  return <span className="ph-name" style={style}>{children}</span>;
}

/** A banner's state strip (Ready, In game): `tone` colours it. */
export function PhBannerState({ tone = 'ready', children }: { tone?: 'ready' | 'in_game' | 'space'; children?: ReactNode }) {
  return <span className={`ph-state s-${tone}`} aria-hidden={tone === 'space' || undefined}>{tone === 'space' ? ' ' : children}</span>;
}

/** The Leader badge (crown + word) for `badge`. */
export function PhLeaderBadge() {
  return <><Icon name="crown" /><span>Leader</span></>;
}

/** A ghost banner's invite medallion and label (or the friend it waits on). */
export function PhBannerInvite({ pending }: { pending?: string | null }) {
  return pending
    ? <><span className="ph-openlbl">Invited</span><span className="ph-opensub">{pending}</span><span className="ph-opensub">Waiting for an answer</span></>
    : <><span className="ph-invmed" aria-hidden="true"><span>+</span></span><span className="ph-openlbl">Invite</span></>;
}
