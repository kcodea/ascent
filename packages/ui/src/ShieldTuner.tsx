import { useState } from 'react';
import { SHIELD_KEYS, SHIELD_RANGES, SHIELD_DESC, getShieldConfig, resetShieldConfig, setShieldValue, type ShieldConfig } from './shieldConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the divine-shield / reborn bubble placement on recruit cards (shop & warband
 * tiles). Combat units centre perfectly; recruit tiles hang their badges below the art, so this dials the
 * vertical offset by eye. Values persist to localStorage and apply on the next reconcile (hover/refresh a
 * shielded shop card to judge). "Copy" grabs the JSON to paste as the shipped default in `shieldConfig.ts`.
 * Panel-only: opened from the Dev Tuning Menu (DevMenu.tsx); dev-only, so it's stripped from production.
 */
const LABELS: Record<keyof ShieldConfig, string> = {
  recruitDy: 'shop Y offset (×h)',
};

export function ShieldTuner() {
  const [cfg, setCfg] = useState<ShieldConfig>(getShieldConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('shield');

  // Nudge Recruit to re-run syncShields so the on-screen bubble moves LIVE as the slider drags (a config change
  // alone doesn't touch run state, so nothing would otherwise re-sync until you interact with a card).
  const poke = (): void => window.dispatchEvent(new Event('ascent:shieldcfg'));
  const set = (k: keyof ShieldConfig, v: number): void => {
    setShieldValue(k, v);
    setCfg({ ...getShieldConfig() });
    poke();
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getShieldConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetShieldConfig(); setCfg({ ...getShieldConfig() }); poke(); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Shield Placement <span>dev · shop cards · drag</span></div>
      {SHIELD_KEYS.map((k) => {
        const [min, max, step] = SHIELD_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={SHIELD_DESC[k]}>{LABELS[k]}</span>
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
