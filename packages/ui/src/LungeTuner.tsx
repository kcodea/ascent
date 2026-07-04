import { useState } from 'react';
import { LUNGE_KEYS, LUNGE_RANGES, getLungeConfig, resetLungeConfig, setLungeValue, type LungeConfig } from './lungeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the combat attack lunge. Drag each slider to dial wind-up / strike / lunge
 * distance / smack timing / settle by feel — values persist to localStorage and apply to the NEXT attack
 * (watch a fight to judge). "Copy" grabs the JSON to paste back as the shipped defaults in `lungeConfig.ts`;
 * "Reset" clears to the defaults. Panel-only: opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so
 * it's stripped from production.
 */
const LABELS: Record<keyof LungeConfig, string> = {
  windupDur: 'wind-up dur',
  windupDepth: 'wind-up depth',
  windupScale: 'wind-up scale',
  strikeDur: 'strike dur',
  strikeDist: 'lunge dist',
  smackLead: 'smack lead',
  settleDur: 'settle dur',
  attackGap: 'attack gap',
};

export function LungeTuner() {
  const [cfg, setCfg] = useState<LungeConfig>(getLungeConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('lunge');

  const set = (k: keyof LungeConfig, v: number): void => {
    setLungeValue(k, v);
    setCfg({ ...getLungeConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getLungeConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetLungeConfig(); setCfg({ ...getLungeConfig() }); };

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lunge Tuner <span>dev · next attack · drag</span></div>
      {LUNGE_KEYS.map((k) => {
        const [min, max, step] = LUNGE_RANGES[k];
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
