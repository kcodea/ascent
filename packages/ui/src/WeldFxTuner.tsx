import { useState } from 'react';
import {
  WELDFX_KEYS, WELDFX_RANGES, getWeldFxConfig, resetWeldFxConfig, setWeldFxValue, type WeldFxConfig,
} from './weldFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testWeldFx } from './fxTestFire';

/**
 * DEV-only "Weld FX" tuner — the Attachment-fuses-onto-a-minion cue (`weldFxConfig` → `pixiFx.weldPulse`):
 * the ring that eases in and CONVERGES on the card, the flash + rising sparks when it lands, and the host's
 * WIGGLE on impact (these replaced the old generic green buff-burst + "+X/+Y" float, now suppressed on a
 * weld). Persists to localStorage; edits apply to the NEXT weld — drop a Magnetic onto a Mech to judge, or
 * ▶ Test on the picked kind. `play` (a hand-played Attachment, after its slide-in) and `auto`
 * (Banksly/Beatbot, Combinator, Cling Drones, Money Bots) share these dials, scaled by playScale/autoScale.
 * Dev-only — stripped from production.
 */
const WELD_LABELS: Partial<Record<keyof WeldFxConfig, string>> = {
  ringStart: 'ring start px',
  ringEnd: 'ring end px',
  ringMs: 'converge ms',
  ringWidth: 'ring width',
  ringAlpha: 'ring α',
  ringGlowWidth: 'ring halo',
  ringSides: 'shape (0=circle)',
  ringAspect: 'shape aspect',
  ringRotation: 'shape rotate°',
  ringSpin: 'spin° over close',
  easeStart: 'ease · start',
  easeFinish: 'ease · finish',
  spokeCount: 'spokes',
  spokeLen: 'spoke len',
  spokeWidth: 'spoke width',
  spokeAlpha: 'spoke α',
  spokeGap: 'spoke gap',
  flashSize: 'flash px',
  flashMs: 'flash ms',
  flashAlpha: 'flash α',
  sparkCount: 'sparks',
  sparkSpeed: 'spark rise',
  sparkSpread: 'spark spread',
  sparkSize: 'spark px',
  sparkLife: 'spark life',
  sparkGravity: 'spark gravity',
  playScale: 'play ×',
  autoScale: 'auto ×',
  wiggleMs: 'wiggle ms',
  wigglePx: 'wiggle shake px',
  wiggleDeg: 'wiggle rotate°',
  wiggleScale: 'wiggle bounce ×',
};

const TEST_KINDS: ('play' | 'auto')[] = ['play', 'auto'];

export function WeldFxTuner() {
  const [cfg, setCfg] = useState<WeldFxConfig>(getWeldFxConfig());
  const [copied, setCopied] = useState(false);
  const [kind, setKind] = useState<'play' | 'auto'>('play');
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('weldfx');

  const set = (k: keyof WeldFxConfig, v: number): void => { setWeldFxValue(k, v); setCfg({ ...getWeldFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getWeldFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetWeldFxConfig(); setCfg({ ...getWeldFxConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Weld FX <span>dev · next weld · drag</span></div>
      {WELDFX_KEYS.map((k) => {
        const [min, max, step] = WELDFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{WELD_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        {TEST_KINDS.map((t) => (
          <button key={t} className="sfxmix-copy" style={kind === t ? { outline: '1px solid currentColor' } : undefined} onClick={() => setKind(t)}>{t}</button>
        ))}
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => testWeldFx(kind)} title="Fire the full weld effect on your left-most board minion — no Attachment needed">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
