import { useState } from 'react';
import {
  LUNGE_KEYS, LUNGE_RANGES, STRIKE_EASES, getLungeConfig, lungeOverrides, resetLungeConfig, setLungeValue,
  type LungeConfig,
} from './lungeConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the combat attack lunge. Dial wind-up / strike / contact / settle by feel;
 * values apply to the NEXT attack (watch a fight to judge).
 *
 * Two deliberate differences from the version deleted in #537, which persisted to localStorage and skewed
 * every later combat silently and permanently:
 *   - overrides live in **sessionStorage** — they survive an HMR reload mid-tuning, and die with the tab;
 *   - a loud **MODIFIED** banner lists every key differing from the shipped defaults, so it's never silent.
 * "Copy" grabs the JSON to paste back into `DEFAULTS` in lungeConfig.ts (shipping is still a code change).
 */
const LABELS: Record<keyof LungeConfig, string> = {
  windupDur: 'wind-up dur',
  windupDepth: 'wind-up depth',
  windupScale: 'wind-up scale',
  strikeDur: 'strike dur (fb)',
  bite: 'corner bite',
  leadTilt: 'lead tilt',
  defenderSpin: 'defender spin',
  attackerRebound: 'atk rebound',
  targetSpeed: 'target px/s',
  minStrikeDur: 'min strike',
  maxStrikeDur: 'max strike',
  smackLead: 'smack lead',
  settleDur: 'settle dur',
  attackGap: 'attack gap',
  strikeEaseIdx: 'strike EASE',
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

  const overrides = lungeOverrides();

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Lunge Tuner <span>dev · next attack · drag</span></div>
      {overrides.length > 0 && (
        <div className="sfxmix-row" style={{ color: '#f4c542', fontWeight: 700 }}>
          MODIFIED ({overrides.length}): {overrides.map((k) => LABELS[k]).join(', ')} — session only
        </div>
      )}
      {LUNGE_KEYS.map((k) => {
        const [min, max, step] = LUNGE_RANGES[k];
        const isEase = k === 'strikeEaseIdx';
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{isEase ? STRIKE_EASES[cfg[k]] ?? '?' : cfg[k]}</span>
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
