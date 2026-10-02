import type { CSSProperties, ReactNode } from 'react';

/**
 * THE SHARED TOOLTIP PANEL (owner 2026-10-02: every tooltip wears the hero-power "Aegis" look). Renders the shared
 * `.atip` classes from tooltips.css: an optional title (with an optional icon beside it), body content whose `<b>`
 * words read in the highlight gold, optional pill tags, and an optional pointer arrow. A `simple` tip is the same
 * panel with one line of text and no title.
 *
 * Placement and show/hide stay with the caller (pass a className that positions it and reveals it on hover): this
 * component is the LOOK only, so a new tooltip can never drift from the others. Pure markup; no state, no effects.
 */
export interface TipPanelProps {
  title?: ReactNode;
  /** A small icon (img or svg) beside the title. */
  icon?: ReactNode;
  /** Pill tags under the body ("once per turn"). */
  pills?: ReactNode[];
  /** A pointer arrow on the panel's top (`up`, the tip opens below its control) or bottom (`down`) edge. */
  arrow?: 'up' | 'down';
  /** One line of text in the same panel, no title. */
  simple?: boolean;
  className?: string;
  style?: CSSProperties;
  role?: string;
  children?: ReactNode;
}

export function TipPanel({ title, icon, pills, arrow, simple, className, style, role = 'tooltip', children }: TipPanelProps): JSX.Element {
  const cls = ['atip', simple ? 'atip-simple' : '', arrow ? `atip-arrow atip-arrow-${arrow}` : '', className ?? ''].filter(Boolean).join(' ');
  if (simple) return <div className={cls} style={style} role={role}>{children}</div>;
  return (
    <div className={cls} style={style} role={role}>
      {title != null && (
        <b className={`atip-title${icon ? ' atip-has-ico' : ''}`}>
          {icon && <span className="atip-ico" aria-hidden>{icon}</span>}
          {title}
        </b>
      )}
      {children != null && <div className="atip-body">{children}</div>}
      {pills && pills.length > 0 && (
        <div className="atip-pills">{pills.map((p, i) => <span key={i} className="atip-pill">{p}</span>)}</div>
      )}
    </div>
  );
}
