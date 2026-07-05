import { useState } from 'react';
import { PACING_KEYS, PACING_RANGES, getPacingConfig, resetPacingConfig, setPacingValue, type PacingConfig } from './pacingConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the combat-replay PACING (the beat clock in useCombatReplay.ts). `speed` is the
 * global tempo (higher = slower/more deliberate); the rest are per-beat-type hold lengths (ms) — how long the
 * clock lingers on each action/result beat before the next — plus the damage-float + final-hold lifetimes.
 * Values persist to localStorage and apply to the NEXT beat (watch a fight to judge). The attack impact stays
 * welded to the lunge, so nothing here can desync the damage-on-contact. "Copy" grabs the JSON to paste back
 * as the shipped defaults in `pacingConfig.ts`; "Reset" clears to defaults. Opened from the Dev Tuning Menu
 * (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof PacingConfig, string> = {
  speed: 'tempo (higher=slower)',
  attack: 'pre-swing gap',
  sc: 'start-of-combat',
  summon: 'summon',
  buff: 'buff / gain',
  reborn: 'reborn',
  improve: 'improve',
  rally: 'rally',
  toHand: 'to hand',
  maxGold: 'max gold',
  hpGrant: 'hp grant',
  dmg: 'damage (post-hit)',
  shield: 'shield absorb',
  shieldUp: 'shield gained',
  poison: 'poison',
  venomLost: 'venom lost',
  death: 'death (collapse)',
  floatMs: 'float linger',
  deathFloatMs: 'death float linger',
  finalHold: 'final hold',
};

export function PacingTuner() {
  const [cfg, setCfg] = useState<PacingConfig>(getPacingConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('pacing');

  const set = (k: keyof PacingConfig, v: number): void => {
    setPacingValue(k, v);
    setCfg({ ...getPacingConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getPacingConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetPacingConfig(); setCfg({ ...getPacingConfig() }); };

  return (
    <div className="sfxmix lunge pacing" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Pacing Tuner <span>dev · next beat · drag</span></div>
      {PACING_KEYS.map((k) => {
        const [min, max, step] = PACING_RANGES[k];
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
