import { useState } from 'react';
import {
  CARD_PILLS_KEYS,
  CARD_PILLS_COLOR_KEYS,
  CARD_PILLS_RANGES,
  CARD_PILLS_DESC,
  getCardPillsConfig,
  resetCardPillsConfig,
  setCardPillsColor,
  setCardPillsValue,
  type CardPillsConfig,
  type CardPillsColorKey,
  type CardPillsNumKey,
} from './cardPillsConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only floating tuner for the four CARD PILLS (`cardPillsConfig.ts`) — the cost coin, the Tier badge, the
 * Spell/Ruby type pill and the ×N multicast badge. Each gets its own x/y/scale so they can be seated
 * INDEPENDENTLY (owner ask 2026-07-24); nothing here is shared between them. The ×N badge also gets two colour
 * pickers (fill + numeral), the fill being the single colour its minted gradient is mixed from.
 *
 * Values persist to localStorage (dev-only) and apply LIVE via the composed `--cpl-*-t` transform vars — no
 * reload and no re-render, since the vars sit on `:root` and every card reads them. "Copy" grabs the JSON to
 * paste back as the shipped defaults in `cardPillsConfig.ts`. Stripped from production.
 */
const LABELS: Record<keyof CardPillsConfig, string> = {
  costX: 'cost coin · x',
  costY: 'cost coin · y',
  costScale: 'cost coin · scale',
  tierX: 'tier badge · x',
  tierY: 'tier badge · y',
  tierScale: 'tier badge · scale',
  spellX: 'spell pill · x',
  spellY: 'spell pill · y',
  spellScale: 'spell pill · scale',
  multX: '×N badge · x',
  multY: '×N badge · y',
  multScale: '×N badge · scale',
  multBadge: '×N badge · colour',
  multFont: '×N numeral · colour',
};

export function CardPillsTuner() {
  const [cfg, setCfg] = useState<CardPillsConfig>(getCardPillsConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cardpills');

  const set = (k: CardPillsNumKey, v: number): void => {
    setCardPillsValue(k, v);
    setCfg({ ...getCardPillsConfig() });
  };
  const setColor = (k: CardPillsColorKey, v: string): void => {
    setCardPillsColor(k, v);
    setCfg({ ...getCardPillsConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCardPillsConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCardPillsConfig(); setCfg({ ...getCardPillsConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card Pills <span>dev · live · drag</span></div>
      {CARD_PILLS_KEYS.map((k) => {
        const [min, max, step] = CARD_PILLS_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={CARD_PILLS_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {CARD_PILLS_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name" title={CARD_PILLS_DESC[k]}>{LABELS[k]}</span>
          {/* A native colour input rather than a slider: hue/lightness aren't a single axis, and the swatch
              doubles as the current-value readout. Applies live through the same `--cpl-*` vars. */}
          <input type="color" value={cfg[k]} onChange={(e) => setColor(k, e.target.value)} />
          <span className="sfxmix-val hex">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
