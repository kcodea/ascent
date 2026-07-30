import { useEffect, useRef, useState } from 'react';
import { useDraggablePanel } from './useDraggablePanel';
import {
  assertGroupRuns, formatValue, groupControls, PANEL_EMBLEMS, TUNERS_RESET_EVENT, unitSuffix,
  type TunerControl, type TunerSpec,
} from './tunerSchema';

/**
 * Which sections a panel has folded away, remembered per panel.
 *
 * Kept OUT of the config modules on purpose: this is a property of how you are working right now, not of the
 * look being tuned, and it must never end up in the JSON that Copy emits for pasting back into `DEFAULTS`.
 */
const FOLD_KEY = 'ascent.tunerfold';
function loadFolded(panelId: string): Set<string> {
  try {
    const all = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') as Record<string, string[]>;
    return new Set(all[panelId] ?? []);
  } catch { return new Set(); }
}
function saveFolded(panelId: string, folded: Set<string>): void {
  try {
    const all = JSON.parse(localStorage.getItem(FOLD_KEY) || '{}') as Record<string, string[]>;
    if (folded.size) all[panelId] = [...folded];
    else delete all[panelId];
    localStorage.setItem(FOLD_KEY, JSON.stringify(all));
  } catch { /* ignore */ }
}

/** A control matches the find box on its label, its hint, or its config key. */
function matches(c: TunerControl<string>, q: string): boolean {
  if (!q) return true;
  return `${c.label} ${c.hint ?? ''} ${c.key} ${c.group ?? ''}`.toLowerCase().includes(q);
}

/** Panels below this many controls fit on screen, so a find box would be clutter rather than help. */
const FIND_THRESHOLD = 10;

/** Where a value sits in its range, 0–100, for the lit portion of the slider track. */
function fillPct(value: number, min: number, max: number): number {
  if (!(max > min)) return 0;
  return Math.min(100, Math.max(0, ((value - min) / (max - min)) * 100));
}

/**
 * The one DEV tuner panel. Every tuner renders through this from a `TunerSpec`; the 47 hand-rolled panels it
 * replaces each repeated the same skeleton — local state, the drag hook, a set/copy/reset trio, a row map, and
 * two buttons — which meant every improvement below would otherwise have had to be made forty-seven times.
 *
 * It deliberately keeps the existing `.sfxmix*` class vocabulary. During the migration most panels are still
 * the old markup, and a shared component that looked like a different product would make the toolset read as
 * half-broken. The new affordances ride on additive classes instead.
 *
 * What the schema buys, beyond deleting duplication:
 *  - **Units are rendered, not typed into labels.** The audit found `°` and `deg`, `ms` and bare `s`, and `α`
 *    in thirty labels where others wrote "opacity". A control now declares its unit and this renders it, so
 *    the vocabulary cannot drift apart again.
 *  - **Sections.** `CardPlateTuner` was faking them by prefixing every label ("plate · width", "gold · sepia").
 *  - **A modified mark, and a one-click revert per control** — so "is this still the shipped value?" is
 *    answerable at a glance instead of by reading the config source.
 *  - **A number box beside every slider**, because a slider cannot express "exactly 180".
 */
export function TunerPanel<C extends object>({ spec }: { spec: TunerSpec<C> }): JSX.Element {
  const [, force] = useState(0);
  const [copied, setCopied] = useState(false);
  const { panelRef, panelElRef, headerPointerDown, panelStyle } = useDraggablePanel(spec.id);

  // Preview switches. Each pins a body class while on, and every one is removed when the panel closes — a
  // pinned "glow always on" that outlived its panel would leave the board lit with no visible cause.
  const [previewOn, setPreviewOn] = useState<Record<string, boolean>>(() =>
    Object.fromEntries((spec.toggles ?? []).map((t) => [t.id, t.defaultOn ?? true])));
  const toggleClasses = (spec.toggles ?? []).map((t) => `${t.id}:${t.bodyClass}:${previewOn[t.id] ? 1 : 0}`).join('|');
  useEffect(() => {
    const toggles = spec.toggles ?? [];
    for (const t of toggles) document.body.classList.toggle(t.bodyClass, !!previewOn[t.id]);
    return () => { for (const t of toggles) document.body.classList.remove(t.bodyClass); };
    // `toggleClasses` is the value-identity of the toggle set; `spec.toggles` is a stable module constant.
  }, [toggleClasses, spec.toggles, previewOn]);

  const cfg = spec.read();
  const rerender = (): void => force((n) => n + 1);

  // "Reset all tuners" writes through the config modules directly, which an open panel cannot see. Without this
  // it would sit showing stale numbers beside a board that had already changed under it.
  useEffect(() => {
    const onResetAll = (): void => rerender();
    window.addEventListener(TUNERS_RESET_EVENT, onResetAll);
    return () => window.removeEventListener(TUNERS_RESET_EVENT, onResetAll);
  }, []);

  const set = (key: Extract<keyof C, string>, value: number): void => {
    spec.write(key, value);
    rerender();
  };
  const copy = (): void => {
    // JSON to paste into a config module's DEFAULTS, unless the spec emits something else — the CSS-composing
    // panels paste back a rule in styles.css, not a config object.
    void navigator.clipboard?.writeText(spec.copy ? spec.copy() : JSON.stringify(spec.read(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const resetAll = (): void => { spec.reset(); rerender(); };

  // A control's value goes back through the right setter for its kind — colours and named choices are strings.
  const writeAny = (c: TunerControl<Extract<keyof C, string>>, value: unknown): void => {
    if (c.kind === 'color' || c.kind === 'select') spec.writeColor?.(c.key, String(value));
    else spec.write(c.key, Number(value));
  };

  /**
   * A/B against the shipped values.
   *
   * Judging a tune means answering "is this better than what we ship?", and the only way to ask that before now
   * was to revert each control, look, then put them all back by hand — by which point you have lost the version
   * you were judging. This writes the shipped values through the panel's own setters, keeps your values in a
   * ref, and puts them back on release.
   *
   * It goes through the real setters rather than some preview path because that is the only route that actually
   * repaints the board: every config module applies its values as a side effect of being written. The cost is
   * that the shipped values touch `localStorage` for the duration of the hold — a net-zero round trip, but a
   * crash mid-hold would leave the shipped values saved. That is the same state Reset produces, so the worst
   * case is recoverable, and it buys an A/B that works on all 46 panels instead of the handful that could be
   * taught a second write path.
   *
   * TAP toggles it sticky, HOLD is momentary. Both exist because the FX panels read their config at fire time:
   * you cannot hold the button and press Test with the same pointer, so those panels need the sticky form.
   */
  const heldValues = useRef<{ values: C; controls: TunerControl<Extract<keyof C, string>>[] } | null>(null);
  const downAt = useRef(0);
  const [comparing, setComparing] = useState(false);

  const changedFromShipped = spec.defaults
    ? spec.controls.filter((c) => cfg[c.key] !== spec.defaults![c.key])
    : [];

  const showShipped = (): void => {
    if (!spec.defaults || heldValues.current) return;
    const controls = spec.controls.filter((c) => spec.read()[c.key] !== spec.defaults![c.key]);
    heldValues.current = { values: { ...spec.read() }, controls };
    for (const c of controls) writeAny(c, spec.defaults[c.key]);
    setComparing(true);
    rerender();
  };
  const showMine = (): void => {
    const held = heldValues.current;
    if (!held) return;
    heldValues.current = null;
    for (const c of held.controls) writeAny(c, held.values[c.key]);
    setComparing(false);
    rerender();
  };
  // Restore on unmount too: closing the panel mid-compare must not leave the shipped values live.
  useEffect(() => () => { showMine(); }, []);

  const [find, setFind] = useState('');
  const q = find.trim().toLowerCase();
  const [folded, setFolded] = useState<Set<string>>(() => loadFolded(spec.id));
  const toggleFold = (title: string): void => {
    setFolded((prev) => {
      const next = new Set(prev);
      if (next.has(title)) next.delete(title); else next.add(title);
      saveFolded(spec.id, next);
      return next;
    });
  };

  const sections = groupControls(spec.controls);
  const foldable = sections.filter(([title]) => title !== null).length > 1;
  const allFolded = foldable && sections.every(([title]) => title === null || folded.has(title));
  const foldAll = (): void => {
    const next = allFolded ? new Set<string>() : new Set(sections.map(([t]) => t).filter((t): t is string => !!t));
    saveFolded(spec.id, next);
    setFolded(next);
  };
  const matchCount = q ? spec.controls.filter((c) => matches(c, q)).length : 0;
  // Runs once per panel open: a spec whose groups are interrupted renders duplicate headings, which is always
  // an authoring slip rather than an intent.
  useEffect(() => { assertGroupRuns(spec.id, spec.controls); }, [spec.id, spec.controls]);

  return (
    <div className="sfxmix tunerpanel" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        {/* The emblem is the glyph this panel is listed under in the dev menu — a panel floating over the board
            stays recognisable as the row you opened it from. */}
        {PANEL_EMBLEMS[spec.id] && <span className="tuner-emblem" aria-hidden="true">{PANEL_EMBLEMS[spec.id]}</span>}
        <b className="tuner-title">{spec.title}</b>
        {spec.note && <span>{typeof spec.note === 'function' ? spec.note() : spec.note}</span>}
      </div>

      {/* A measuring panel's readout goes first: what actually happened outranks what you might change. */}
      {spec.readout?.()}

      {/* Preview switches sit ABOVE the controls and wear their own row style, because they change what you
          can see rather than what the game ships. */}
      {(spec.toggles ?? []).length > 0 && (
        <div className="tuner-previews">
          {(spec.toggles ?? []).map((t) => (
            <label className="tuner-preview" key={t.id} title={t.hint}>
              <input
                type="checkbox"
                checked={!!previewOn[t.id]}
                onChange={(e) => setPreviewOn((s) => ({ ...s, [t.id]: e.target.checked }))}
              />
              <span>{t.label}</span>
            </label>
          ))}
        </div>
      )}

      {/* The working bar: find a control, fold the sections you are not using, A/B against what ships. All three
          are about NAVIGATING a panel rather than changing it, so they sit together above the controls. */}
      {(spec.controls.length >= FIND_THRESHOLD || spec.defaults) && (
        <div className="tuner-tools">
          {spec.controls.length >= FIND_THRESHOLD && (
            <input
              className="tuner-find"
              type="search"
              value={find}
              placeholder={`Find in ${spec.controls.length} controls…`}
              aria-label={`Find a control in ${spec.title}`}
              onChange={(e) => setFind(e.target.value)}
            />
          )}
          {foldable && (
            <button
              className="tuner-foldall"
              onClick={foldAll}
              title={allFolded ? 'Open every section' : 'Fold every section away'}
              aria-label={allFolded ? 'Expand all sections' : 'Collapse all sections'}
            >{allFolded ? '⌄' : '⌃'}</button>
          )}
          {spec.defaults && (
            <button
              className={`tuner-cmp${comparing ? ' on' : ''}`}
              disabled={!comparing && changedFromShipped.length === 0}
              aria-pressed={comparing}
              title={
                changedFromShipped.length === 0 && !comparing
                  ? 'Nothing is changed from the shipped values yet'
                  : 'Hold to see the shipped values, release for yours. Tap to keep it on — the FX panels need that, '
                    + 'since you cannot hold this and press Test at once.'
              }
              onPointerDown={(e) => {
                e.preventDefault();               // don't take focus off a slider mid-drag
                downAt.current = performance.now();
                if (comparing) showMine(); else showShipped();
              }}
              onPointerUp={() => {
                // A real hold reverts on release; a tap (under 250ms) leaves it latched on.
                if (comparing && performance.now() - downAt.current > 250) showMine();
              }}
              onPointerLeave={() => { if (comparing && performance.now() - downAt.current > 250) showMine(); }}
              onKeyDown={(e) => { if (e.key === ' ' || e.key === 'Enter') { e.preventDefault(); if (comparing) showMine(); else showShipped(); } }}
            >
              {comparing ? 'Showing shipped' : `Shipped (${changedFromShipped.length})`}
            </button>
          )}
          {q && <span className="tuner-found">{matchCount} of {spec.controls.length}</span>}
        </div>
      )}

      {sections.map(([groupTitle, controls]) => {
        const hits = q ? controls.filter((c) => matches(c, q)) : controls;
        if (hits.length === 0) return null;
        // A fold is ignored while you are searching — a match you cannot see is worse than a section you did
        // not mean to open.
        const open = !!q || groupTitle === null || !folded.has(groupTitle);
        return (
        <div className="tuner-section" key={groupTitle ?? '__ungrouped'}>
          {groupTitle && (
            <button
              className={`tuner-gh tuner-gh-btn${open ? '' : ' folded'}`}
              onClick={() => toggleFold(groupTitle)}
              aria-expanded={open}
              title={open ? `Fold “${groupTitle}” away` : `Open “${groupTitle}”`}
            >
              <span className="tuner-caret" aria-hidden="true">{open ? '▾' : '▸'}</span>
              {groupTitle}
              <span className="tuner-gh-n">{q ? `${hits.length}/${controls.length}` : controls.length}</span>
            </button>
          )}
          {open && hits.map((c) => {
            if (c.kind === 'select') {
              const current = String(cfg[c.key]);
              const shippedSel = spec.defaults ? String(spec.defaults[c.key]) : undefined;
              return (
                <div
                  className={`sfxmix-row tuner-row tuner-row-select${
                    shippedSel !== undefined && current !== shippedSel ? ' tuner-row-mod' : ''}`}
                  key={c.key}
                >
                  <span className="sfxmix-name" title={c.hint}>
                    {c.label}
                    {shippedSel !== undefined && current !== shippedSel && (
                      <button
                        className="tuner-mod"
                        onClick={() => { spec.writeColor?.(c.key, shippedSel); rerender(); }}
                        title={`Changed from the shipped “${shippedSel}” — click to put it back`}
                        aria-label={`Revert ${c.label} to ${shippedSel}`}
                      >●</button>
                    )}
                  </span>
                  <select
                    value={current}
                    aria-label={c.label}
                    onChange={(e) => { spec.writeColor?.(c.key, e.target.value); rerender(); }}
                  >
                    {(c.options ?? []).map((o) => <option key={o} value={o}>{o}</option>)}
                  </select>
                  <span className="sfxmix-val" />
                </div>
              );
            }

            if (c.kind === 'color') {
              const hex = String(cfg[c.key]);
              const shippedHex = spec.defaults ? String(spec.defaults[c.key]) : undefined;
              return (
                <div
                  className={`sfxmix-row tuner-row tuner-row-color${
                    shippedHex !== undefined && hex !== shippedHex ? ' tuner-row-mod' : ''}`}
                  key={c.key}
                >
                  <span className="sfxmix-name" title={c.hint}>
                    {c.label}
                    {shippedHex !== undefined && hex !== shippedHex && (
                      <button
                        className="tuner-mod"
                        onClick={() => { spec.writeColor?.(c.key, shippedHex); rerender(); }}
                        title={`Changed from the shipped ${shippedHex} — click to put it back`}
                        aria-label={`Revert ${c.label} to ${shippedHex}`}
                      >●</button>
                    )}
                  </span>
                  <input
                    type="color"
                    value={hex}
                    aria-label={c.label}
                    onChange={(e) => { spec.writeColor?.(c.key, e.target.value); rerender(); }}
                  />
                  <span className="sfxmix-val tuner-hex">{hex}</span>
                </div>
              );
            }
            const value = Number(cfg[c.key]);
            const shipped = spec.defaults ? Number(spec.defaults[c.key]) : undefined;
            const modified = shipped !== undefined && value !== shipped;

            if (c.kind === 'toggle') {
              const on = c.onValue ?? 1;
              const off = c.offValue ?? 0;
              const isOn = value >= on;
              return (
                <div className={`sfxmix-row tuner-row tuner-row-toggle${modified ? ' tuner-row-mod' : ''}`} key={c.key}>
                  <span className="sfxmix-name" title={c.hint}>
                    {c.label}
                    {c.note && <span className="tuner-note" title={c.note} aria-label={c.note}>†</span>}
                    {modified && shipped !== undefined && (
                      <button
                        className="tuner-mod"
                        onClick={() => set(c.key, shipped)}
                        title={`Changed from the shipped value — click to put it back`}
                        aria-label={`Revert ${c.label}`}
                      >●</button>
                    )}
                  </span>
                  <input
                    type="checkbox"
                    checked={isOn}
                    aria-label={c.label}
                    onChange={(e) => set(c.key, e.target.checked ? on : off)}
                  />
                  <span className="sfxmix-val tuner-toggleval">
                    {c.onOffLabels ? c.onOffLabels[isOn ? 0 : 1] : (isOn ? 'on' : 'off')}
                  </span>
                </div>
              );
            }

            return (
              // A modified row carries the flag itself, so "what have I changed?" is a scan down the left
              // edge rather than a hunt for dots.
              <div className={`sfxmix-row tuner-row${modified ? ' tuner-row-mod' : ''}`} key={c.key}>
                <span className="sfxmix-name" title={c.hint}>
                  {c.label}
                  {/* A per-control caveat sits ON the control it applies to, rather than as a blanket line at
                      the foot of the panel that never says which controls it means. */}
                  {c.note && (
                    <span className="tuner-note" title={c.note} aria-label={c.note}>†</span>
                  )}
                  {/* The mark is also the revert control: one click puts this control back to its shipped
                      value without disturbing anything else you have dialled. */}
                  {modified && (
                    <button
                      className="tuner-mod"
                      onClick={() => set(c.key, shipped)}
                      title={`Changed from the shipped ${formatValue(shipped, c.unit)} — click to put it back`}
                      aria-label={`Revert ${c.label} to ${formatValue(shipped, c.unit)}`}
                    >
                      ●
                    </button>
                  )}
                </span>
                {/* The travelled portion of the track is LIT, via a percentage the CSS gradient reads. Across a
                    44-control panel you can see roughly where every value sits without reading one number —
                    which is the thing a column of identical grey tracks could never tell you. */}
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={value}
                  aria-label={c.label}
                  style={{ '--fill': `${fillPct(value, c.min, c.max)}%` } as React.CSSProperties}
                  onChange={(e) => set(c.key, Number(e.target.value))}
                />
                {/* A number box as well as the slider: a slider cannot express "exactly 180", and typing is
                    the fastest path when you already know the value you want. */}
                <input
                  className="tuner-num"
                  type="number"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={value}
                  aria-label={`${c.label} value`}
                  onChange={(e) => {
                    const v = Number(e.target.value);
                    if (Number.isFinite(v)) set(c.key, v);
                  }}
                />
                {/* A value that indexes a named list shows the NAME here — picking an easing curve by reading
                    "3" is how the lunge tuner used to work. */}
                <span className="sfxmix-val tuner-unit" aria-hidden={!c.valueLabels}>
                  {c.valueLabels ? (c.valueLabels[value] ?? String(value)) : unitSuffix(c.unit)}
                </span>
              </div>
            );
          })}
        </div>
        );
      })}

      {q && matchCount === 0 && (
        <div className="tuner-nohit">Nothing matches “{find}”.</div>
      )}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : (spec.copyLabel ?? 'Copy values')}</button>
        <button className="sfxmix-copy" onClick={resetAll}>Reset</button>
        {spec.actions?.map((a) => (
          <button className="sfxmix-copy" key={a.label} onClick={() => a.run(panelElRef.current)} title={a.hint}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}
