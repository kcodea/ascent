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
import { useEffect, useId, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
import { createPortal } from 'react-dom';
import { rectToStage, stageHost } from '../../stage';
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

export function PhSection({ title, aside, flush, unclipped, className, children }: {
  title?: ReactNode; aside?: ReactNode; flush?: boolean; className?: string; children: ReactNode;
  /** Square corners and no clip, so a menu opening inside (a PhSelect, a More menu) is never cut off. */
  unclipped?: boolean;
}) {
  return (
    <section className={cx('phk-section', flush && 'flush', unclipped && 'unclipped', className)}>
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

export function PhStat({ label, value, sub, tone, size = 'm' }: { label: ReactNode; value: ReactNode; sub?: ReactNode; tone?: PhTone; size?: 's' | 'm' }) {
  return (
    <div className={cx('phk-stat', tone && `t-${tone}`, size === 's' && 's-s')}>
      <span className="phk-statval">{value}</span>
      <span className="phk-statlbl">{label}</span>
      {sub && <span className="phk-statsub">{sub}</span>}
    </div>
  );
}

/** `size="l"`: the big box (a result header). `plain`: no podium metal (e.g. 2nd of 2 is not a podium). */
export function PhPlace({ place, size = 'm', plain }: { place: number; size?: 'm' | 'l'; plain?: boolean }) {
  return <span className={cx('phk-place', size === 'l' && 's-l')} data-place={plain ? undefined : place} aria-label={`Place ${place}`}>{place}</span>;
}

/** A small fact tile: a short label over a value, for a row of facts (PhStat at size s). */
export function PhFact({ label, value, tone }: { label: ReactNode; value: ReactNode; tone?: PhTone }) {
  return <PhStat label={label} value={value} tone={tone} size="s" />;
}

/**
 * A selectable list with keyboard navigation: Up / Down (and Home / End) move the selection, Enter re-picks. Renders
 * `role="listbox"`; each item is a row you render (a `PhRow` fits). The selected item gets `selected`.
 */
export function PhSelectList<T>({ items, keyOf, selected, onSelect, render, label, className }: {
  items: readonly T[]; keyOf: (item: T) => string; selected: string | null; onSelect: (item: T) => void;
  render: (item: T, selected: boolean) => ReactNode; label: string; className?: string;
}) {
  const ref = useRef<HTMLDivElement>(null);
  const at = items.findIndex((it) => keyOf(it) === selected);
  const move = (i: number): void => {
    const it = items[Math.max(0, Math.min(items.length - 1, i))];
    if (!it) return;
    onSelect(it);
    ref.current?.querySelector<HTMLElement>(`[data-key="${CSS.escape(keyOf(it))}"]`)?.scrollIntoView?.({ block: 'nearest' });
  };
  const onKey = (e: KeyboardEvent<HTMLDivElement>): void => {
    if (e.key === 'ArrowDown') { e.preventDefault(); move(at + 1); }
    else if (e.key === 'ArrowUp') { e.preventDefault(); move(at <= 0 ? 0 : at - 1); }
    else if (e.key === 'Home') { e.preventDefault(); move(0); }
    else if (e.key === 'End') { e.preventDefault(); move(items.length - 1); }
  };
  return (
    <div ref={ref} className={cx('phk-selist', className)} role="listbox" aria-label={label} tabIndex={0} onKeyDown={onKey}
      aria-activedescendant={selected ? `phk-sel-${selected}` : undefined}>
      {items.map((it) => {
        const k = keyOf(it);
        return (
          <div key={k} id={`phk-sel-${k}`} data-key={k} role="option" aria-selected={k === selected} className="phk-selitem"
            onClick={() => onSelect(it)}>{render(it, k === selected)}</div>
        );
      })}
    </div>
  );
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
export function PhSegmented<T extends string | number | null>({ label, hint, value, isOn, options, onPick, disabled, size = 'm', max }: {
  label?: ReactNode; hint?: ReactNode; value?: T; isOn?: (v: T) => boolean; options: readonly { value: T; label: ReactNode }[];
  onPick: (v: T) => void; disabled?: boolean; size?: 'm' | 'l';
  /** Show at most this many options; the rest go into a "More" menu (the picked one, if hidden, names the button). */
  max?: number;
}) {
  const lit = (v: T): boolean => (isOn ? isOn(v) : v === value);
  const [moreOpen, setMoreOpen] = useState(false);
  if (max != null && options.length > max) {
    const shown = options.slice(0, Math.max(1, max - 1));
    const rest = options.slice(shown.length);
    const restOn = rest.find((o) => lit(o.value));
    return (
      <div className={cx('phk-seg', `s-${size}`, disabled && 'off')}>
        {label && <span className="phk-seglbl">{label}</span>}
        <div className="phk-segrow" role="group" aria-label={typeof label === 'string' ? label : undefined}>
          {shown.map((o) => (
            <button key={String(o.value)} type="button" className={cx('phk-segbtn', lit(o.value) && 'on')} aria-pressed={lit(o.value)} disabled={disabled}
              onClick={() => { if (!disabled) onPick(o.value); }}>{o.label}</button>
          ))}
          <span className="phk-more">
            <button type="button" className={cx('phk-segbtn', restOn && 'on')} aria-haspopup="menu" aria-expanded={moreOpen} disabled={disabled}
              onClick={() => setMoreOpen((v) => !v)}>{restOn ? restOn.label : 'More'} <span aria-hidden="true">▾</span></button>
            {moreOpen && (
              <span className="phk-moremenu" role="menu">
                {rest.map((o) => (
                  <button key={String(o.value)} type="button" role="menuitemradio" aria-checked={lit(o.value)} className={cx('phk-moreitem', lit(o.value) && 'on')}
                    onClick={() => { setMoreOpen(false); onPick(o.value); }}>{o.label}</button>
                ))}
              </span>
            )}
          </span>
        </div>
        {hint && <span className="phk-seghint">{hint}</span>}
      </div>
    );
  }
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
  // Esc closes the window (and nothing under it).
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
  useEffect(() => {
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key !== 'Escape' || !closeRef.current) return;
      e.preventDefault(); e.stopImmediatePropagation(); closeRef.current();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, []);
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

/**
 * An on / off switch (owner rule: red when off, green when on, with the word On or Off on it). `label` sits left; `hint`
 * under it. `role="switch"` with `aria-checked`.
 */
export function PhSwitch({ checked, onChange, label, hint, disabled, className }: {
  checked: boolean; onChange: (next: boolean) => void; label?: ReactNode; hint?: ReactNode; disabled?: boolean; className?: string;
}) {
  const hintId = useId();
  return (
    <div className={cx('phk-switchrow', disabled && 'off', className)}>
      {(label || hint) && <span className="phk-switchtext">{label && <span className="phk-switchlbl">{label}</span>}{hint && <span className="phk-seghint" id={hintId}>{hint}</span>}</span>}
      <button type="button" role="switch" aria-checked={checked} disabled={disabled} className={cx('phk-switch', checked ? 'is-on' : 'is-off')} aria-describedby={hint ? hintId : undefined}
        aria-label={typeof label === 'string' ? label : undefined} onClick={() => { if (!disabled) onChange(!checked); }}>
        <span className="phk-switchknob" aria-hidden="true" />
        <span className="phk-switchword">{checked ? 'On' : 'Off'}</span>
      </button>
    </div>
  );
}

/** A slider: a native range input in the shell's look, the value shown at the right (`format` it). */
export function PhSlider({ value, min, max, step = 1, onChange, onRelease, label, ariaLabel, format, disabled, muted, onMute, className }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: ReactNode;
  /** Fires once when the drag (or key press) ends, with the final value (e.g. play a preview sound). */
  onRelease?: (v: number) => void;
  /** The input's accessible name (defaults to `label` when that is a string). */
  ariaLabel?: string;
  format?: (v: number) => ReactNode; disabled?: boolean; className?: string;
  /** A mute pairing: pass both and a Mute / Unmute button sits after the value (the slider dims while muted). */
  muted?: boolean; onMute?: () => void;
}) {
  const f = max > min ? (value - min) / (max - min) : 0;
  const name = ariaLabel ?? (typeof label === 'string' ? label : undefined);
  return (
    <div className={cx('phk-slider', disabled && 'off', muted && 'muted', className)}>
      {label && <span className="phk-switchlbl">{label}</span>}
      <span className="phk-sliderrow">
        <input type="range" min={min} max={max} step={step} value={value} disabled={disabled} aria-label={name} style={{ '--f': f } as React.CSSProperties}
          onChange={(e) => onChange(Number(e.target.value))}
          onPointerUp={(e) => onRelease?.(Number((e.target as HTMLInputElement).value))}
          onKeyUp={(e) => onRelease?.(Number((e.target as HTMLInputElement).value))} />
        <span className="phk-sliderval">{format ? format(value) : value}</span>
        {onMute && (
          <button type="button" className={cx('phk-chip', 'phk-tchip', muted ? 't-foe' : 't-neutral')} aria-pressed={!!muted} onClick={onMute}>{muted ? 'Muted' : 'Mute'}</button>
        )}
      </span>
    </div>
  );
}

/**
 * A dropdown select. The list opens in a layer on the page (a portal, placed from one measure on open), so a clipped
 * section never cuts it off. Closes on a pick, a press outside, or Escape.
 */
export function PhSelect<T extends string | number>({ value, options, onChange, label, disabled, className }: {
  value: T;
  /** `thumb`: a small preview image left of the label. `disabled` + `reason`: dimmed, not pickable, the reason under it. */
  options: readonly { value: T; label: ReactNode; thumb?: string; disabled?: boolean; reason?: string }[];
  onChange: (v: T) => void; label?: string; disabled?: boolean; className?: string;
}) {
  const [open, setOpen] = useState<{ left: number; top: number; width: number } | null>(null);
  const btn = useRef<HTMLButtonElement>(null);
  const cur = options.find((o) => o.value === value);
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => { if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); setOpen(null); } };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open]);
  const toggle = (): void => {
    if (open) { setOpen(null); return; }
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const r = rectToStage(b); // screen -> stage space (the layer lives in the stage)
    setOpen({ left: r.left, top: r.bottom + 4, width: r.width });
  };
  return (
    <>
      <button ref={btn} type="button" className={cx('phk-select', className)} aria-haspopup="listbox" aria-expanded={!!open} aria-label={label} disabled={disabled} onClick={toggle}>
        {cur?.thumb && <img className="phk-selthumb" src={cur.thumb} alt="" draggable={false} decoding="sync" />}
        <span className="phk-selectval">{cur?.label ?? ''}</span><span className="phk-selectcaret" aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div className="phk-selectlayer" onPointerDown={() => setOpen(null)}>
          <div className="phk-selectlist" role="listbox" aria-label={label} style={{ left: open.left, top: open.top, minWidth: open.width }} onPointerDown={(e) => e.stopPropagation()}>
            {options.map((o) => (
              <button key={String(o.value)} type="button" role="option" aria-selected={o.value === value} aria-disabled={o.disabled || undefined} disabled={o.disabled}
                className={cx('phk-moreitem', 'phk-selopt', o.value === value && 'on')}
                onClick={() => { if (o.disabled) return; setOpen(null); if (o.value !== value) onChange(o.value); }}>
                {o.thumb && <img className="phk-selthumb" src={o.thumb} alt="" draggable={false} decoding="sync" />}
                <span className="phk-seloptlbl">{o.label}{o.disabled && o.reason && <span className="phk-selreason">{o.reason}</span>}</span>
              </button>
            ))}
          </div>
        </div>,
        stageHost(),
      )}
    </>
  );
}

/** A search box in the shell's look (a well with the gold focus edge). Pass any input props. */
export function PhSearch({ className, ...rest }: InputHTMLAttributes<HTMLInputElement>) {
  return <input type="search" spellCheck={false} autoComplete="off" {...rest} className={cx('phk-search', className)} />;
}

/** A profile / info plate: a small muted heading over its content (a career identity block, a details card). */
export function PhPlate({ heading, children, className }: { heading?: ReactNode; children: ReactNode; className?: string }) {
  return (
    <div className={cx('phk-plate', className)}>
      {heading && <span className="phk-platehead">{heading}</span>}
      {children}
    </div>
  );
}

/** A podium card (a leaderboard's top three): the placing crest, the portrait, the name, one line and one stat. */
export function PhPodiumCard({ place, art, name, sub, stat, onClick, label }: {
  place: number; art?: string; name: ReactNode; sub?: ReactNode; stat?: ReactNode; onClick?: () => void; label?: string;
}) {
  const body = (
    <>
      <PhPlace place={place} size="l" />
      {art && <img className="phk-podart" src={art} alt="" draggable={false} decoding="sync" />}
      <span className="phk-podname">{name}</span>
      {sub && <span className="phk-podsub">{sub}</span>}
      {stat && <span className="phk-podstat">{stat}</span>}
    </>
  );
  return onClick
    ? <button type="button" className={cx('phk-podium', `p-${place}`)} onClick={onClick} aria-label={label}>{body}</button>
    : <div className={cx('phk-podium', `p-${place}`)}>{body}</div>;
}

/**
 * A table row on a shared column grid: pass the same `cols` (a CSS grid-template-columns) to the header row (`head`) and
 * every body row, so the columns line up. Cells are the children.
 */
export function PhGridRow({ cols, head, selected, onClick, label, className, children }: {
  cols: string; head?: boolean; selected?: boolean; onClick?: () => void; label?: string; className?: string; children: ReactNode;
}) {
  const style = { gridTemplateColumns: cols } as React.CSSProperties;
  if (onClick) {
    return <button type="button" role="row" className={cx('phk-grow', selected && 'sel', 'press', className)} style={style} onClick={onClick} aria-label={label}>{children}</button>;
  }
  return <div role="row" className={cx('phk-grow', head && 'head', selected && 'sel', className)} style={style}>{children}</div>;
}
