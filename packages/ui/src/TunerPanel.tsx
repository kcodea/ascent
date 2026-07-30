import { useEffect, useState } from 'react';
import { useDraggablePanel } from './useDraggablePanel';
import { assertGroupRuns, formatValue, groupControls, unitSuffix, type TunerSpec } from './tunerSchema';

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
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel(spec.id);

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

  const set = (key: Extract<keyof C, string>, value: number): void => {
    spec.write(key, value);
    rerender();
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(spec.read(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const resetAll = (): void => { spec.reset(); rerender(); };

  const sections = groupControls(spec.controls);
  // Runs once per panel open: a spec whose groups are interrupted renders duplicate headings, which is always
  // an authoring slip rather than an intent.
  useEffect(() => { assertGroupRuns(spec.id, spec.controls); }, [spec.id, spec.controls]);

  return (
    <div className="sfxmix tunerpanel" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        {spec.title}
        {spec.note && <span>{spec.note}</span>}
      </div>

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

      {sections.map(([groupTitle, controls]) => (
        <div className="tuner-section" key={groupTitle ?? '__ungrouped'}>
          {groupTitle && <div className="tuner-gh">{groupTitle}</div>}
          {controls.map((c) => {
            if (c.kind === 'color') {
              const hex = String(cfg[c.key]);
              const shippedHex = spec.defaults ? String(spec.defaults[c.key]) : undefined;
              return (
                <div className="sfxmix-row tuner-row tuner-row-color" key={c.key}>
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
                <div className="sfxmix-row tuner-row tuner-row-toggle" key={c.key}>
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
              <div className="sfxmix-row tuner-row" key={c.key}>
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
                <input
                  type="range"
                  min={c.min}
                  max={c.max}
                  step={c.step}
                  value={value}
                  aria-label={c.label}
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
                <span className="sfxmix-val tuner-unit" aria-hidden>{unitSuffix(c.unit)}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={resetAll}>Reset</button>
        {spec.actions?.map((a) => (
          <button className="sfxmix-copy" key={a.label} onClick={a.run} title={a.hint}>{a.label}</button>
        ))}
      </div>
    </div>
  );
}
