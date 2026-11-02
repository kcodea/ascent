/**
 * THE SHELL KIT (party home prototype, DEV only): the building blocks every menu page uses under the shared top nav, in
 * the Docked rail's language (see ../shell/shell.css for the tokens). Pages revamped for the shell should be built from
 * these and the `--ph-*` tokens only, so the whole app reads as one.
 *
 *   <PhPage title eyebrow? actions? tabs? wide?>        a page under the nav: header row + a scrolling body
 *   <PhSection title? aside? flush?>                    a navy plate with a gold hairline, an optional title row
 *   <PhRow art? title sub? lead? right? onClick? tone? selected?>
 *                                                       a list row: a rail slice, portrait bleeding in from the right
 *   <PhTabs tabs value onChange label>                  flat tabs, the current one white with the gold underline
 *   <PhChip tone?>                                      a small cut label (neutral, gold, teal, foe)
 *   <PhButton variant? size? ...button>                 primary (podium gold), plate (navy + gold edge), ghost
 *   <PhStat label value sub? tone?>                     a number tile: big white number, small muted label
 *   <PhPlace place>                                     a placement box: podium metal for 1 to 3, navy after
 *   <PhEmpty title sub? action?>                        an empty or loading state
 *
 * All static paint; no native tooltips (aria-label + the game's `data-tip`); no own cursor (the gauntlet rule paints it).
 */
import type { ButtonHTMLAttributes, ReactNode } from 'react';
import '../shell/shell.css';
import './kit.css';

const cx = (...c: (string | false | null | undefined)[]): string => c.filter(Boolean).join(' ');

export function PhPage({ title, eyebrow, actions, tabs, wide, className, children }: {
  title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; tabs?: ReactNode; wide?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section className={cx('phk-page', wide && 'wide', className)}>
      <header className="phk-pagehead">
        <div className="phk-pagetitle">
          {eyebrow && <span className="phk-eyebrow">{eyebrow}</span>}
          <h1>{title}</h1>
        </div>
        {tabs && <div className="phk-pagetabs">{tabs}</div>}
        {actions && <div className="phk-pageactions">{actions}</div>}
      </header>
      <div className="phk-pagebody">{children}</div>
    </section>
  );
}

export function PhSection({ title, aside, flush, className, children }: {
  title?: ReactNode; aside?: ReactNode; flush?: boolean; className?: string; children: ReactNode;
}) {
  return (
    <section className={cx('phk-section', flush && 'flush', className)}>
      {(title || aside) && (
        <header className="phk-sechead">
          {title && <h2>{title}</h2>}
          {aside && <div className="phk-secaside">{aside}</div>}
        </header>
      )}
      <div className="phk-secbody">{children}</div>
    </section>
  );
}

export type PhTone = 'neutral' | 'gold' | 'teal' | 'foe';

export function PhRow({ art, title, sub, lead, right, onClick, tone, selected, label, className }: {
  art?: string; title: ReactNode; sub?: ReactNode; lead?: ReactNode; right?: ReactNode; onClick?: () => void;
  tone?: PhTone; selected?: boolean; label?: string; className?: string;
}) {
  const body = (
    <>
      {art && <img className="phk-rowart" src={art} alt="" draggable={false} decoding="sync" />}
      {lead && <span className="phk-rowlead">{lead}</span>}
      <span className="phk-rowwho">
        <span className="phk-rowtitle">{title}</span>
        {sub && <span className="phk-rowsub">{sub}</span>}
      </span>
    </>
  );
  return (
    <div role="listitem" className={cx('phk-row', tone && `t-${tone}`, selected && 'sel', onClick && 'press', className)}>
      {onClick
        ? <button type="button" className="phk-rowmain" onClick={onClick} aria-label={label}>{body}</button>
        : <span className="phk-rowmain">{body}</span>}
      {right && <span className="phk-rowright">{right}</span>}
    </div>
  );
}

export function PhTabs<T extends string>({ tabs, value, onChange, label }: {
  tabs: readonly { id: T; label: ReactNode; count?: number; disabled?: boolean }[]; value: T; onChange: (id: T) => void; label: string;
}) {
  return (
    <div className="phk-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} disabled={t.disabled}
          className={cx('phk-tab', t.id === value && 'on')} onClick={() => { if (t.id !== value) onChange(t.id); }}>
          {t.label}
          {t.count ? <span className="phk-count">{t.count}</span> : null}
        </button>
      ))}
    </div>
  );
}

export function PhChip({ tone = 'neutral', className, children }: { tone?: PhTone; className?: string; children: ReactNode }) {
  return <span className={cx('phk-chip', `t-${tone}`, className)}>{children}</span>;
}

export function PhButton({ variant = 'plate', size = 'm', className, children, ...rest }: ButtonHTMLAttributes<HTMLButtonElement> & {
  variant?: 'primary' | 'plate' | 'ghost'; size?: 's' | 'm' | 'l';
}) {
  return <button type="button" {...rest} className={cx('phk-btn', `v-${variant}`, `s-${size}`, className)}><span>{children}</span></button>;
}

export function PhStat({ label, value, sub, tone }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: PhTone }) {
  return (
    <div className={cx('phk-stat', tone && `t-${tone}`)}>
      <span className="phk-statval">{value}</span>
      <span className="phk-statlbl">{label}</span>
      {sub && <span className="phk-statsub">{sub}</span>}
    </div>
  );
}

export function PhPlace({ place }: { place: number }) {
  return <span className="phk-place" data-place={place} aria-label={`Place ${place}`}>{place}</span>;
}

export function PhEmpty({ title, sub, action }: { title: ReactNode; sub?: ReactNode; action?: ReactNode }) {
  return (
    <div className="phk-empty">
      <span className="phk-emptytitle">{title}</span>
      {sub && <span className="phk-emptysub">{sub}</span>}
      {action}
    </div>
  );
}
