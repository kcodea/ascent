import { useState } from 'react';
import {
  WARD_GROUPS, WARD_RANGES, getWardConfig, resetWardConfig, setWardValue, wardOverrides,
  type WardConfig,
} from './wardConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the WARD (Divine Shield) dome — the glassy energy shell on a DS card.
 *
 * Values reflect to `--wd-*` CSS vars on :root, so the dome on screen updates LIVE as you drag (no re-render
 * or re-mount needed — the CSS reads the vars). Persisted to localStorage; "Copy" grabs the JSON to paste
 * into `DEFAULTS` in `wardConfig.ts`, and the CSS fallbacks in styles.css must be updated to match (they are
 * what production renders — see the note in wardConfig.ts).
 *
 * Note the geometry group: the dome now lives in the archbox rather than the clipped `.art`, so a NEGATIVE
 * "inset" genuinely bleeds it out past the card frame. That was impossible before — `.art`'s `overflow:
 * hidden` cut it to the portrait window regardless of any value here.
 *
 * Panel-only: opened from the Dev Tuning Menu; dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof WardConfig, string> = {
  inset: 'inset px (− = out)',
  scale: 'scale ×',
  radius: 'corner ×',
  bodyAlpha: 'ring peak',
  pulseMin: 'ring trough',
  pulseSec: 'breath sec',
  hexAlpha: 'facets',
  hexSize: 'facet size %',
  shadowAlpha: 'inner shade',
  spotAlpha: 'glass shine',
  auraBlur: 'aura blur',
  auraSpread: 'aura spread',
  auraAlpha: 'aura alpha',
  breathAlpha: 'gold breath',
};

export function WardTuner() {
  const [cfg, setCfg] = useState<WardConfig>(getWardConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('ward');

  const set = (k: keyof WardConfig, v: number): void => {
    setWardValue(k, v); // writes the CSS var → the dome updates live
    setCfg({ ...getWardConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getWardConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetWardConfig(); setCfg({ ...getWardConfig() }); };

  const overrides = wardOverrides();

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Ward Dome <span>dev · live · drag</span></div>

      {overrides.length > 0 && (
        <div className="lunge-mod">
          MODIFIED ({overrides.length}): {overrides.map((k) => LABELS[k]).join(', ')}
        </div>
      )}

      {WARD_GROUPS.map((g) => (
        <div className="lunge-sec" key={g.title}>
          <div className="lunge-sec-h">{g.title}</div>
          {g.keys.map((k) => {
            const [min, max, step] = WARD_RANGES[k];
            return (
              <div className="sfxmix-row" key={k}>
                <span className="sfxmix-name">{LABELS[k]}</span>
                <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
                <span className="sfxmix-val">{cfg[k]}</span>
              </div>
            );
          })}
        </div>
      ))}

      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
