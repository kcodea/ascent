import { useState } from 'react';
import { TRAIL_KEYS, TRAIL_RANGES, getTrailConfig, resetTrailConfig, setTrailValue, type TrailConfig } from './trailConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the card motion trail (`trailConfig.ts` → `pixiFx.trail`). Drag the sliders to dial
 * wisp density / life / size / alpha / stretch / drift and the gold divine-shield variant by eye — values
 * persist to localStorage and apply to the NEXT wisps emitted (drag a card to judge). "Copy" grabs the JSON
 * to paste back as the shipped defaults in `trailConfig.ts`. Panel-only: opened from the Dev Tuning Menu.
 */
const LABELS: Record<keyof TrailConfig, string> = {
  emitSpacing: 'emit spacing px',
  lifeMs: 'wisp life ms',
  size: 'wisp size',
  alpha: 'wind alpha',
  stretch: 'streak stretch',
  drift: 'lateral drift',
  goldAlpha: 'gold alpha',
  sparkChance: 'gold sparks',
};

export function TrailTuner() {
  const [cfg, setCfg] = useState<TrailConfig>(getTrailConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('trail');

  const set = (k: keyof TrailConfig, v: number): void => {
    setTrailValue(k, v);
    setCfg({ ...getTrailConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getTrailConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetTrailConfig(); setCfg({ ...getTrailConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Motion Trail <span>dev · drag a card · drag</span></div>
      {TRAIL_KEYS.map((k) => {
        const [min, max, step] = TRAIL_RANGES[k];
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
