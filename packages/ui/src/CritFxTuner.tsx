import { useState } from 'react';
import {
  CRITFX_KEYS, CRITFX_COLOR_KEYS, CRITFX_RANGES, getCritFxConfig, resetCritFxConfig, setCritFxValue, type CritFxConfig,
} from './critFxConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only "Critical Strike FX" tuner — the crimson-gold crit flourish (`critFxConfig` → `pixiFx.critImpact`):
 * the amplified core/shockwave, the bold ring, the spark burst, the "CRIT!" pop, the red defender flash, and the
 * board-shake feel. Slider dials + colour pickers persist to localStorage and apply to the NEXT crit (watch a
 * fight with Commander Impala to judge). "Copy" grabs the JSON to paste back as the shipped defaults; "Reset"
 * clears the config. Dev-only — stripped from production. Mirrors the crit-preview.html rig 1:1.
 *
 * Note: `shakePx`/`shakeMs` document the tuned board-shake; the shake itself is the `.app.shaking-crit` CSS
 * keyframe (a compositor-only transform — never a per-frame JS shake), so those two dials are display-only here.
 */
const CRIT_LABELS: Partial<Record<keyof CritFxConfig, string>> = {
  critPower: 'crit power',
  flashSize: 'flash size',
  shockwaveSize: 'shockwave size',
  ringSize: 'ring size',
  ringWidth: 'ring width',
  ringMs: 'ring ms',
  sparkCount: 'spark count',
  sparkSpeed: 'spark speed',
  sparkLife: 'spark life ms',
  sparkSize: 'spark size',
  sparkSpread: 'spark spread°',
  textSize: 'CRIT! size',
  textRise: 'CRIT! rise',
  textMs: 'CRIT! ms',
  textPop: 'CRIT! pop',
  cardFlashAlpha: 'card flash α',
  cardFlashMs: 'card flash ms',
  shakePx: 'shake px (CSS)',
  shakeMs: 'shake ms (CSS)',
  colorCore: 'core',
  colorShock: 'shockwave',
  colorRing: 'ring',
  colorSpark1: 'spark 1',
  colorSpark2: 'spark 2',
  colorSpark3: 'spark 3',
  colorText: 'CRIT! fill',
  colorTextEdge: 'CRIT! edge',
};

export function CritFxTuner() {
  const [cfg, setCfg] = useState<CritFxConfig>(getCritFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('critfx');

  const set = (k: keyof CritFxConfig, v: number | string): void => { setCritFxValue(k, v); setCfg({ ...getCritFxConfig() }); };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCritFxConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCritFxConfig(); setCfg({ ...getCritFxConfig() }); };

  const sliderKeys = CRITFX_KEYS.filter((k) => !CRITFX_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Critical Strike FX <span>dev · next crit · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = CRITFX_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{CRIT_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {CRITFX_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{CRIT_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
