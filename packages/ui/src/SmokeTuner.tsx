import { useState } from 'react';
import { SMOKE_KEYS, SMOKE_RANGES, getSmokeConfig, resetSmokeConfig, setSmokeValue, type SmokeConfig } from './smokeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the board's soft smoke/dust (`smokeConfig.ts` → `pixiFx.impact` combat smoke +
 * `pixiFx.dust` card-drop dust). Drag the sliders to amp count / rise / spread / life / expansion / alpha by
 * eye — values persist to localStorage and apply to the NEXT impact/drop (land a hit or place a card to
 * judge). "Copy" grabs the JSON to paste back as the shipped defaults in `smokeConfig.ts`. Panel-only:
 * opened from the Dev Tuning Menu.
 */
const LABELS: Record<keyof SmokeConfig, string> = {
  smokeCount: 'smoke · count',
  smokeRise: 'smoke · rise',
  smokeDrift: 'smoke · drift',
  smokeLife: 'smoke · life ms',
  smokeGrow: 'smoke · grow',
  smokeAlpha: 'smoke · alpha',
  dustCount: 'dust · count',
  dustSpeed: 'dust · speed',
  dustLife: 'dust · life ms',
  dustGrow: 'dust · grow',
  dustAlpha: 'dust · alpha',
};

export function SmokeTuner() {
  const [cfg, setCfg] = useState<SmokeConfig>(getSmokeConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('smoke');

  const set = (k: keyof SmokeConfig, v: number): void => {
    setSmokeValue(k, v);
    setCfg({ ...getSmokeConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getSmokeConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetSmokeConfig(); setCfg({ ...getSmokeConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Smoke &amp; Dust <span>dev · next impact/drop · drag</span></div>
      {SMOKE_KEYS.map((k) => {
        const [min, max, step] = SMOKE_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
