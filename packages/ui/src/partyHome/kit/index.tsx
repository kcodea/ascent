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

export function PhPage({ title, eyebrow, actions, tabs, wide, back, className, children }: {
  title: ReactNode; eyebrow?: ReactNode; actions?: ReactNode; tabs?: ReactNode; wide?: boolean; className?: string; children: ReactNode;
  /** A back step inside the page (a sub-view back to its parent): sits left of the title. */
  back?: { label: string; onClick: () => void };
}) {
  return (
    <section className={cx('phk-page', wide && 'wide', className)}>
      <header className="phk-pagehead">
        {back && (
          <button type="button" className="phk-back" onClick={back.onClick} aria-label={back.label}>
            <span className="phk-backarrow" aria-hidden="true">‹</span><span>{back.label}</span>
          </button>
        )}
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

export function PhRow({ art, title, sub, lead, right, onClick, tone, selected, label, className, dense, count, progress }: {
  art?: string; title: ReactNode; sub?: ReactNode; lead?: ReactNode; right?: ReactNode; onClick?: () => void;
  tone?: PhTone; selected?: boolean; label?: string; className?: string;
  /** A compact 48 unit row (lists of many). */
  dense?: boolean;
  /** A count at the right end, before `right` (e.g. "12 / 30"). */
  count?: ReactNode;
  /** 0..1: a thin gold progress bar along the row's foot. */
  progress?: number;
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
    <div role="listitem" className={cx('phk-row', tone && `t-${tone}`, selected && 'sel', onClick && 'press', dense && 'dense', className)}>
      {onClick
        ? <button type="button" className="phk-rowmain" onClick={onClick} aria-label={label}>{body}</button>
        : <span className="phk-rowmain">{body}</span>}
      {count != null && <span className="phk-rowcount">{count}</span>}
      {right && <span className="phk-rowright">{right}</span>}
      {progress != null && <span className="phk-rowbar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, progress))})` }} /></span>}
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

/** A chip that toggles (a filter): pressed wears the podium gold. */
export function PhToggleChip({ pressed, onToggle, disabled, className, children }: { pressed: boolean; onToggle: () => void; disabled?: boolean; className?: string; children: ReactNode }) {
  return (
    <button type="button" className={cx('phk-chip', 'phk-tchip', pressed ? 't-gold' : 't-neutral', className)} aria-pressed={pressed} disabled={disabled}
      onClick={onToggle}>{children}</button>
  );
}

/** A "collected" meter: a label, the count, and a thin gold bar. */
export function PhMeter({ label, value, max, className }: { label?: ReactNode; value: number; max: number; className?: string }) {
  const f = max > 0 ? Math.max(0, Math.min(1, value / max)) : 0;
  return (
    <div className={cx('phk-meter', className)} role="meter" aria-valuemin={0} aria-valuemax={max} aria-valuenow={value} aria-label={typeof label === 'string' ? label : undefined}>
      <span className="phk-meterhead">{label && <span className="phk-meterlbl">{label}</span>}<span className="phk-meterval">{value} / {max}</span></span>
      <span className="phk-meterbar" aria-hidden="true"><span style={{ transform: `scaleX(${f})` }} /></span>
    </div>
  );
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

/**
 * A labelled segmented control (added for the in-place mode options; the kit's other APIs are unchanged). Single-select
 * passes `value`; multi-select passes `isOn` and toggles in `onPick`. `disabled` greys the row; give `hint` the reason.
 * `size="l"`: the big two-way switch (Practice's Sandbox | God Mode).
 */
export function PhSegmented<T extends string | number | null>({ label, hint, value, isOn, options, onPick, disabled, size = 'm' }: {
  label?: ReactNode; hint?: ReactNode; value?: T; isOn?: (v: T) => boolean; options: readonly { value: T; label: ReactNode }[];
  onPick: (v: T) => void; disabled?: boolean; size?: 'm' | 'l';
}) {
  const lit = (v: T): boolean => (isOn ? isOn(v) : v === value);
  return (
    <div className={cx('phk-seg', `s-${size}`, disabled && 'off')}>
      {label && <span className="phk-seglbl">{label}</span>}
      <div className="phk-segrow" role="group" aria-label={typeof label === 'string' ? label : undefined}>
        {options.map((o) => (
          <button key={String(o.value)} type="button" className={cx('phk-segbtn', lit(o.value) && 'on')} aria-pressed={lit(o.value)} disabled={disabled}
            onClick={() => { if (!disabled) onPick(o.value); }}>{o.label}</button>
        ))}
      </div>
      {hint && <span className="phk-seghint">{hint}</span>}
    </div>
  );
}

/**
 * A modal window in the shell's language (added for the party home's confirmations; the other kit APIs are unchanged):
 * a dark veil over the screen and one navy plate in the big cut, an eyebrow, a title, the text, then the actions
 * (primary first). `onClose` runs on a press on the veil. One-shot entrance (transform + opacity).
 */
export function PhDialog({ eyebrow, title, children, actions, onClose, closing, label }: {
  eyebrow?: ReactNode; title: ReactNode; children?: ReactNode; actions: ReactNode; onClose?: () => void; closing?: boolean; label: string;
}) {
  return (
    <div className={cx('phk-dialog', closing && 'closing')} role="dialog" aria-modal="true" aria-label={label}>
      <div className="phk-veil" onClick={onClose} aria-hidden="true" />
      <div className="phk-dlgbox">
        {eyebrow && <span className="phk-eyebrow">{eyebrow}</span>}
        <h2 className="phk-dlgtitle">{title}</h2>
        {children && <div className="phk-dlgtext">{children}</div>}
        <div className="phk-dlgactions">{actions}</div>
      </div>
    </div>
  );
}
