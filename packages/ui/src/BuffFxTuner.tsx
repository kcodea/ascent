import { useState } from 'react';
import {
  BUFFFX_KEYS, BUFFFX_RANGES, getBuffFxConfig, resetBuffFxConfig, setBuffFxValue, type BuffFxConfig,
} from './buffFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testBuffFx } from './fxTestFire';

/**
 * DEV-only "Buff FX" tuner — the animation that plays on a minion when something BUFFS it (`buffFxConfig`
 * → the descend ribbon + its landing pulse), plus the WAVE PACING used by itemized per-z rewards on their
 * End-of-Turn beat: Blueprint Cache's "+2/+2 per Attachment", Rune of Spending / Action, Forsaken Speed.
 *
 * `wave gap ms` is the MINIMUM spacing between waves — every eligible minion fires inside the SAME wave
 * (all the Mechs pulse together) and the gap separates the steps, so a wide board reads one step at a time
 * instead of smearing. `wave max total` caps the whole run so a huge board still finishes inside its beat.
 *
 * Persists to localStorage; edits apply to the NEXT buff — ▶ Test fires a 3-wave run across your board, or
 * play a real Blueprint Cache turn. Dev-only — stripped from production.
 */
const BUFF_LABELS: Partial<Record<keyof BuffFxConfig, string>> = {
  waveGapMs: 'wave gap ms',
  waveMaxTotalMs: 'wave max total',
  startHeight: 'drop height',
  dropMs: 'drop ms',
  retractMs: 'retract ms',
  baseWidth: 'ribbon top w',
  tipWidth: 'ribbon tip w',
  coreAlpha: 'ribbon α',
  ringCount: 'rings',
  ringSize: 'ring px',
  ringWidth: 'ring width',
  ringMs: 'ring ms',
  coreFlashSize: 'flash px',
  coreFlashMs: 'flash ms',
  sparkCount: 'sparks',
  sparkSpeed: 'spark speed',
  sparkSize: 'spark px',
  sparkLife: 'spark life',
};

export function BuffFxTuner() {
  const [cfg, setCfg] = useState<BuffFxConfig>(getBuffFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('bufffx');

  const set = (k: keyof BuffFxConfig, v: number): void => { setBuffFxValue(k, v); setCfg({ ...getBuffFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getBuffFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetBuffFxConfig(); setCfg({ ...getBuffFxConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Buff FX <span>dev · next buff · drag</span></div>
      {BUFFFX_KEYS.map((k) => {
        const [min, max, step] = BUFFFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{BUFF_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={() => testBuffFx(3)} title="Fire a 3-wave itemized buff across your whole board — the Blueprint Cache shape, no setup needed">▶ Test 3 waves</button>
        <button className="sfxmix-copy" onClick={() => testBuffFx(1)} title="A single buff landing on every board minion">▶ Test 1</button>
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
