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
import { markPhPage } from '../shell/PhPageGuard';
import { isValidElement, useEffect, useId, useLayoutEffect, useRef, useState, type ButtonHTMLAttributes, type InputHTMLAttributes, type KeyboardEvent, type ReactNode } from 'react';
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
  // A SUB-TAB'S ARRIVAL, one for every page: when the page's own tabs change, the body's rows replay the page entrance. Web
  // Animations on the rows that are there (nothing remounts, no state lost): transform and opacity, one-shot, and a new
  // change cancels the last, so quick presses cannot stack.
  const tabValue = isValidElement(tabs) ? (tabs.props as { value?: unknown }).value : undefined;
  const bodyRef = useRef<HTMLDivElement>(null);
  const lastTab = useRef(tabValue);
  const running = useRef<Animation[]>([]);
  useLayoutEffect(() => markPhPage(), []);
  useLayoutEffect(() => {
    if (lastTab.current === tabValue) return;
    lastTab.current = tabValue;
    const body = bodyRef.current;
    if (!body || typeof body.animate !== 'function' || window.matchMedia?.('(prefers-reduced-motion: reduce)').matches) return;
    running.current.forEach((a) => a.cancel());
    running.current = [...body.children].slice(0, 6).map((el, i) => el.animate(
      [{ opacity: 0, transform: 'translateY(6px)' }, { opacity: 1, transform: 'none' }],
      { duration: 200, delay: Math.min(i, 2) * 20, easing: 'cubic-bezier(0.22, 0.8, 0.3, 1)', fill: 'backwards' },
    ));
  }, [tabValue]);
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
      <div ref={bodyRef} className="phk-pagebody">{children}</div>
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

export function PhTabs<T extends string>({ tabs, value, onChange, label, onLocked, onLockedHover }: {
  /** `reason`: the tab is locked; it stays focusable, says why on hover (the game's tip) and on a press (`onLocked`). */
  tabs: readonly { id: T; label: ReactNode; count?: number; disabled?: boolean; reason?: string }[]; value: T; onChange: (id: T) => void; label: string;
  onLocked?: (id: T, reason: string) => void;
  /** Hovering a locked tab (null on leaving): for a row that shows the reason in its own line. The tab row scrolls, so the
   *  game's `data-tip` bubble is clipped inside it. */
  onLockedHover?: (reason: string | null) => void;
}) {
  return (
    <div className="phk-tabs" role="tablist" aria-label={label}>
      {tabs.map((t) => (
        <button key={t.id} type="button" role="tab" aria-selected={t.id === value} disabled={t.disabled} aria-disabled={t.reason ? true : undefined}
          data-tip={t.reason} className={cx('phk-tab', t.id === value && 'on', t.reason && 'locked gtip')}
          onPointerEnter={t.reason && onLockedHover ? () => onLockedHover(t.reason!) : undefined} onPointerLeave={t.reason && onLockedHover ? () => onLockedHover(null) : undefined}
          onClick={() => { if (t.reason) { onLocked?.(t.id, t.reason); return; } if (t.id !== value) onChange(t.id); }}>
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
    ref.current?.querySelector<HTMLElement>(`[data-key="${typeof CSS !== 'undefined' && CSS.escape ? CSS.escape(keyOf(it)) : keyOf(it).replace(/["\\]/g, '\\$&')}"]`)?.scrollIntoView?.({ block: 'nearest' });
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
export function PhSegmented<T extends string | number | null>({ label, hint, value, isOn, options, onPick, disabled, size = 'm', max, onLocked, onLockedHover }: {
  label?: ReactNode; hint?: ReactNode; value?: T; isOn?: (v: T) => boolean;
  /** `reason`: the option is locked: dimmed, says why through `onLocked` (a press) and `onLockedHover`. */
  options: readonly { value: T; label: ReactNode; reason?: string }[];
  onLocked?: (reason: string) => void; onLockedHover?: (reason: string | null) => void;
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
          <button key={String(o.value)} type="button" className={cx('phk-segbtn', lit(o.value) && 'on', o.reason && 'locked')} aria-pressed={lit(o.value)} disabled={disabled} aria-disabled={o.reason ? true : undefined}
            onPointerEnter={o.reason ? () => onLockedHover?.(o.reason!) : undefined} onPointerLeave={o.reason ? () => onLockedHover?.(null) : undefined}
            onClick={() => { if (disabled) return; if (o.reason) { onLocked?.(o.reason); return; } onPick(o.value); }}>{o.label}</button>
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
      {/* A tap outside while a field is being typed in only ends the typing; it never throws the window away. */}
      <div className="phk-veil" aria-hidden="true" onClick={() => {
        const el = document.activeElement;
        if (el instanceof HTMLInputElement) { el.blur(); return; }
        onClose?.();
      }} />
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
export function PhSlider({ value, min, max, step = 1, onChange, onRelease, label, ariaLabel, format, disabled, muted, onMute, muteLabel, className }: {
  value: number; min: number; max: number; step?: number; onChange: (v: number) => void; label?: ReactNode;
  /** Fires once when the drag (or key press) ends, with the final value (e.g. play a preview sound). */
  onRelease?: (v: number) => void;
  /** The input's accessible name (defaults to `label` when that is a string). */
  ariaLabel?: string;
  format?: (v: number) => ReactNode; disabled?: boolean; className?: string;
  /** A mute pairing: pass both and a Mute / Unmute button sits after the value (the slider dims while muted). */
  muted?: boolean; onMute?: () => void;
  /** The mute button's accessible name (default "Mute <ariaLabel>" / "Unmute <ariaLabel>"). */
  muteLabel?: string;
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
          <button type="button" className={cx('phk-chip', 'phk-tchip', muted ? 't-foe' : 't-neutral')} aria-pressed={!!muted} onClick={onMute}
            aria-label={muteLabel ?? (name ? `${muted ? 'Unmute' : 'Mute'} ${name}` : undefined)}>{muted ? 'Muted' : 'Mute'}</button>
        )}
      </span>
    </div>
  );
}

/**
 * A dropdown select. The list opens in a layer on the page (a portal, placed from one measure on open), so a clipped
 * section never cuts it off. Closes on a pick, a press outside, or Escape.
 */
export function PhSelect<T extends string | number>({ value, options, onChange, label, disabled, className, previewSize, previewSide = 'auto', thumbAspect, thumbSize }: {
  value: T;
  /**
   * `thumb`: a small image left of the label. `disabled` + `reason`: greyed, not pickable, the reason under it.
   * `dim` + `reason`: dimmed but still pickable (e.g. "not unlocked on this account yet"). `preview`: a large image shown
   * beside the list for the highlighted option (a backdrop picker).
   */
  options: readonly { value: T; label: ReactNode; thumb?: string; disabled?: boolean; dim?: boolean; reason?: string; preview?: string; text?: string }[];
  onChange: (v: T) => void; label?: string; disabled?: boolean; className?: string;
  /** The preview's width in units (default 260). */
  previewSize?: number;
  /** Where the preview sits: 'auto' (right, flipped left when the stage has no room there), or forced. */
  previewSide?: 'auto' | 'left' | 'right';
  /**
   * The thumbnails' shape, as a CSS aspect ratio (default '1/1', square). E.g. '16/9' for backdrop thumbs. The list lives
   * in the stage layer, outside the page, so a page can't style its thumbs: it sets them here.
   */
  thumbAspect?: string;
  /** The thumbnails' height in the open list, in units (default 28). The button's own thumb stays 28 high so it fits. */
  thumbSize?: number;
}) {
  const thumbStyle = (h: number): React.CSSProperties | undefined =>
    thumbAspect === undefined && h === 28 ? undefined : { height: `calc(${h} * var(--phu))`, width: 'auto', aspectRatio: thumbAspect ?? '1 / 1' };
  const btnThumb = thumbStyle(28);
  const listThumb = thumbStyle(thumbSize ?? 28);
  const [open, setOpen] = useState<{ left: number; top: number; width: number } | null>(null);
  const [hi, setHi] = useState(0);
  const hiRef = useRef(0);
  hiRef.current = hi;
  const btn = useRef<HTMLButtonElement>(null);
  const listRef = useRef<HTMLDivElement>(null);
  const typed = useRef<{ s: string; at: number }>({ s: '', at: 0 });
  const cur = options.find((o) => o.value === value);
  const pickable = (i: number): boolean => !!options[i] && !options[i]!.disabled;
  const close = (focus = true): void => { setOpen(null); if (focus) btn.current?.focus(); };
  const pick = (i: number): void => { const o = options[i]; if (!o || o.disabled) return; close(); if (o.value !== value) onChange(o.value); };
  const step = (from: number, dir: 1 | -1): number => {
    for (let i = from + dir; i >= 0 && i < options.length; i += dir) if (pickable(i)) return i;
    return from;
  };
  const textOf = (o: { label: ReactNode; text?: string; value: T }): string => (o.text ?? (typeof o.label === 'string' ? o.label : String(o.value))).toLowerCase();
  // The keyboard while the list is open: Up / Down / Home / End move, Enter picks, Esc closes, letters jump (typeahead).
  useEffect(() => {
    if (!open) return undefined;
    const onKey = (e: globalThis.KeyboardEvent): void => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); return; }
      if (e.key === 'ArrowDown') { e.preventDefault(); setHi((h) => step(h, 1)); return; }
      if (e.key === 'ArrowUp') { e.preventDefault(); setHi((h) => step(h, -1)); return; }
      if (e.key === 'Home') { e.preventDefault(); setHi(step(-1, 1)); return; }
      if (e.key === 'End') { e.preventDefault(); setHi(step(options.length, -1)); return; }
      if (e.key === 'Enter' || e.key === ' ') { e.preventDefault(); pick(hiRef.current); return; }
      if (e.key.length === 1 && /\S/.test(e.key)) {
        const now = Date.now();
        typed.current = { s: (now - typed.current.at < 700 ? typed.current.s : '') + e.key.toLowerCase(), at: now };
        const i = options.findIndex((o, k) => pickable(k) && textOf(o).startsWith(typed.current.s));
        if (i >= 0) setHi(i);
      }
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
  }, [open, options]);
  // Keep the highlighted option in view.
  useEffect(() => { if (open) listRef.current?.querySelector<HTMLElement>(`[data-i="${hi}"]`)?.scrollIntoView?.({ block: 'nearest' }); }, [hi, open]);
  const openList = (): void => {
    const b = btn.current?.getBoundingClientRect();
    if (!b) return;
    const r = rectToStage(b); // screen -> stage space (the layer lives in the stage)
    const at = options.findIndex((o) => o.value === value);
    setHi(at >= 0 ? at : step(-1, 1));
    setOpen({ left: r.left, top: r.bottom + 4, width: r.width });
  };
  const toggle = (): void => { if (open) close(false); else openList(); };
  const onBtnKey = (e: KeyboardEvent<HTMLButtonElement>): void => {
    if (!open && (e.key === 'ArrowDown' || e.key === 'ArrowUp')) { e.preventDefault(); openList(); }
  };
  const preview = open ? options[hi]?.preview : undefined;
  const listId = useId();
  // THE PREVIEW's SIDE: measured once per open (the first time a preview shows), never per frame. Right when it fits in
  // the stage, else left; clamped inside the stage either way.
  const wrapRef = useRef<HTMLDivElement>(null);
  const [place, setPlace] = useState<{ side: 'left' | 'right'; maxW: number | null } | null>(null);
  const hasPreview = !!preview;
  useLayoutEffect(() => {
    if (!open || !hasPreview) { if (!open) setPlace(null); return; }
    if (place) return;
    const wrap = wrapRef.current; const list = listRef.current;
    const img = wrap?.querySelector<HTMLElement>('.phk-selpreview');
    if (!wrap || !list || !img) return;
    const stageW = stageHost()?.clientWidth || window.innerWidth;
    const gap = 12;
    const pw = img.offsetWidth;
    const right = open.left + list.offsetWidth + gap + pw <= stageW;
    const left = open.left - gap - pw >= 0;
    const side = previewSide !== 'auto' ? previewSide : right || !left ? 'right' : 'left';
    const room = side === 'right' ? stageW - (open.left + list.offsetWidth + gap) : open.left - gap;
    setPlace({ side, maxW: room < pw ? Math.max(80, room - 8) : null });
  }, [open, hasPreview, place, previewSide]);
  return (
    <>
      <button ref={btn} type="button" className={cx('phk-select', className)} aria-haspopup="listbox" aria-expanded={!!open} aria-controls={open ? listId : undefined}
        aria-label={label} disabled={disabled} onClick={toggle} onKeyDown={onBtnKey}>
        {cur?.thumb && <img className="phk-selthumb" src={cur.thumb} alt="" draggable={false} decoding="sync" style={btnThumb} />}
        <span className="phk-selectval">{cur?.label ?? ''}</span><span className="phk-selectcaret" aria-hidden="true">▾</span>
      </button>
      {open && createPortal(
        <div className="phk-selectlayer" onPointerDown={() => close(false)}>
          <div ref={wrapRef} className={cx('phk-selectwrap', place?.side === 'left' && 'pv-left')} style={{ left: open.left, top: open.top }} onPointerDown={(e) => e.stopPropagation()}>
            <div ref={listRef} id={listId} className="phk-selectlist" role="listbox" aria-label={label} style={{ minWidth: open.width }}
              aria-activedescendant={`${listId}-${hi}`}>
              {options.map((o, i) => (
                <button key={String(o.value)} id={`${listId}-${i}`} data-i={i} type="button" role="option" tabIndex={-1}
                  aria-selected={o.value === value} aria-disabled={o.disabled || undefined} disabled={o.disabled}
                  className={cx('phk-moreitem', 'phk-selopt', o.value === value && 'on', i === hi && 'hi', o.dim && 'dim')}
                  onPointerEnter={() => { if (!o.disabled) setHi(i); }} onClick={() => pick(i)}>
                  {o.thumb && <img className="phk-selthumb" src={o.thumb} alt="" draggable={false} decoding="sync" style={listThumb} />}
                  <span className="phk-seloptlbl">{o.label}{(o.disabled || o.dim) && o.reason && <span className="phk-selreason">{o.reason}</span>}</span>
                </button>
              ))}
            </div>
            {preview && (
              <img className="phk-selpreview" src={preview} alt="" draggable={false} decoding="sync"
                style={{ width: `calc(${previewSize ?? 260} * var(--phu))`, ...(place?.maxW ? { maxWidth: place.maxW } : {}), visibility: place ? 'visible' : 'hidden' } as React.CSSProperties} />
            )}
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

/** Digits in the name serif (the inscription serif's 1 reads as an I): wraps every run of digits in a span. */
export function phNum(text: string): ReactNode {
  const parts = text.split(/(\d+)/);
  return parts.length === 1 ? text : parts.map((p, i) => (/^\d+$/.test(p) ? <span key={i} className="phk-num">{p}</span> : p));
}

export { PhBanner, PhBannerInvite, PhBannerName, PhBannerState, PhLeaderBadge } from './PhBanner';

/** A labelled text field: a small label over a pill input (a room name, a team name), an optional hint or error under it. */
export function PhField({ label, hint, error, className, id, showCount, ...rest }: InputHTMLAttributes<HTMLInputElement> & { label: ReactNode; hint?: ReactNode; error?: ReactNode;
  /** With `maxLength`: a "3 / 16" counter beside the label, so typing never stops silently. */
  showCount?: boolean }) {
  const auto = useId();
  const fid = id ?? auto;
  return (
    <label className={cx('phk-field', className)} htmlFor={fid}>
      <span className="phk-fieldhead"><span className="phk-seglbl">{label}</span>{showCount && rest.maxLength != null && <span className="phk-fieldcount">{String(rest.value ?? '').length} / {rest.maxLength}</span>}</span>
      <input id={fid} spellCheck={false} autoComplete="off" {...rest} className="phk-search phk-fieldinput" aria-invalid={error ? true : undefined} />
      {error ? <span className="phk-fielderr" role="alert">{error}</span> : hint ? <span className="phk-seghint">{hint}</span> : null}
    </label>
  );
}
