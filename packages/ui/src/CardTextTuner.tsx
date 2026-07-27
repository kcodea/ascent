import { useState } from 'react';
import {
  CTX_BLENDS,
  CTX_KEYS,
  CTX_RANGES,
  CTX_DESC,
  getCardTextConfig,
  resetCardTextConfig,
  setCardTextValue,
  type CardTextConfig,
} from './cardTextConfig';
import { useDraggablePanel } from './useDraggablePanel';

/**
 * DEV-only tuner for the card RULES-TEXT box boundaries (`cardTextConfig.ts`) — where the `.drawer` panel
 * sits below the art and how it's inset, plus line spacing. NOT the card title. Values persist to
 * localStorage and apply LIVE via `--ctx-*` CSS vars. "Copy" grabs the JSON to bake as DEFAULTS (and mirror
 * into the styles.css `var(--ctx-*, …)` fallbacks).
 */
const LABELS: Record<keyof CardTextConfig, string> = {
  top: 'box · top',
  padX: 'box · side inset',
  padTop: 'box · pad top',
  padBottom: 'box · pad bottom',
  line: 'text · line height',
  boxW: 'backbox · size',
  boxX: 'backbox · x',
  boxY: 'backbox · y',
  boxA: 'backbox · opacity',
  boxBlend: 'backbox · blend',
};

export function CardTextTuner() {
  const [cfg, setCfg] = useState<CardTextConfig>(getCardTextConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('cardtext');

  const set = (k: keyof CardTextConfig, v: number | string): void => {
    setCardTextValue(k, v);
    setCfg({ ...getCardTextConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getCardTextConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetCardTextConfig(); setCfg({ ...getCardTextConfig() }); };

  return (
    <div className="sfxmix lunge flip" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Card Text <span>dev · live · hand cards</span></div>
      {CTX_KEYS.map((k) => {
        const [min, max, step] = CTX_RANGES[k];
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name" title={CTX_DESC[k]}>{LABELS[k]}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k]} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      <div className="sfxmix-row">
        <span className="sfxmix-name" title={CTX_DESC.boxBlend}>{LABELS.boxBlend}</span>
        <select value={cfg.boxBlend} onChange={(e) => set('boxBlend', e.target.value)}>
          {CTX_BLENDS.map((b) => <option key={b} value={b}>{b}</option>)}
        </select>
        <span className="sfxmix-val" />
      </div>
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
