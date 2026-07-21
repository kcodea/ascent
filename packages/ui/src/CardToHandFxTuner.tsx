import { useState } from 'react';
import {
  C2H_KEYS, C2H_COLOR_KEYS, C2H_RANGES,
  getCardToHandFxConfig, resetCardToHandFxConfig, setCardToHandFxValue, animateCardToHand, type CardToHandFxConfig,
} from './cardToHandFxConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { pixiFx } from './pixiFx';
import { Card } from './Card';
import { createRoot } from 'react-dom/client';

/**
 * DEV-only "Card To Hand" tuner — the flourish when a card is sent to hand (`cardToHandFxConfig` →
 * `animateCardToHand` + `pixiFx.cardShine`). Persists to localStorage; edits apply to the NEXT grant, so
 * ▶ Test spawns a throwaway `.handgrant` card and runs the full flourish on it. "Copy" grabs the JSON to bake
 * as the shipped defaults; "Reset" clears.
 */
const C2H_LABELS: Partial<Record<keyof CardToHandFxConfig, string>> = {
  popScale: 'pop scale ×', popMs: 'pop ms', settleMs: 'settle ms', holdMs: 'hold ms',
  slideVh: 'slide vh', slideMs: 'slide ms', slideEndScale: 'land scale ×', startScale: 'start scale ×', riseVh: 'rise vh',
  shineDelayMs: 'shine delay', shineMs: 'shine ms', shineWidth: 'shine width', shineAlpha: 'shine α', shineAngle: 'shine angle °',
  sparkCount: 'sparkles', sparkSpeed: 'spark speed', sparkSize: 'spark px', sparkLife: 'spark life', sparkSpread: 'spark spread',
  colorShine: 'shine colour',
};

/** Spawn a throwaway granted card (the first shop card, or a fallback) and run the full flourish on it. */
function fireTest(): void {
  const host = document.createElement('div');
  document.body.appendChild(host);
  const root = createRoot(host);
  const cardId = document.querySelector('[data-zone="tavern"] .card')?.getAttribute('data-cardid') ?? 'depositbox';
  root.render(<Card card={{ name: 'Test', cardId, tribe: 'neutral', attack: 3, health: 4, keywords: [], tier: 1, text: '' }} suppressPop />);
  const el = host.firstElementChild as HTMLElement | null;
  if (el) {
    el.className = 'handgrant';
    animateCardToHand(el, (cx, cy, w, h) => pixiFx.cardShine(cx, cy, w, h, getCardToHandFxConfig()));
  }
  window.setTimeout(() => { root.unmount(); host.remove(); }, 2000);
}

export function CardToHandFxTuner() {
  const [cfg, setCfg] = useState<CardToHandFxConfig>(getCardToHandFxConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cardtohandfx');

  const set = (k: keyof CardToHandFxConfig, v: number | string): void => { setCardToHandFxValue(k, v); setCfg({ ...getCardToHandFxConfig() }); };
  const copy = (): void => { void navigator.clipboard?.writeText(JSON.stringify(getCardToHandFxConfig(), null, 2)); setCopied(true); window.setTimeout(() => setCopied(false), 1400); };
  const reset = (): void => { resetCardToHandFxConfig(); setCfg({ ...getCardToHandFxConfig() }); };

  const sliderKeys = C2H_KEYS.filter((k) => !C2H_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card To Hand <span>dev · next grant · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = C2H_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{C2H_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {C2H_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{C2H_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={fireTest} title="Play the flourish on a throwaway card">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
