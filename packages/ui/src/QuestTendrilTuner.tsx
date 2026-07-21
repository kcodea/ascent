import { useState } from 'react';
import {
  QUESTTENDRIL_KEYS, QUESTTENDRIL_COLOR_KEYS, QUESTTENDRIL_RANGES,
  getQuestTendrilConfig, resetQuestTendrilConfig, setQuestTendrilValue, type QuestTendrilConfig,
} from './questTendrilConfig';
import { useDraggablePanel } from './useDraggablePanel';
import { testQuestTendril } from './fxTestFire';

/**
 * DEV-only "Quest Tendril" tuner — the gold ribbon a quest/rune End-of-Turn reward throws at the unit it
 * triggers (`questTendrilConfig` → `pixiFx.buffTendril`). Persists to localStorage; edits apply to the NEXT
 * proc, so ▶ Test fires one from the first quest node to the first board minion rather than making you set
 * up an Echoing Roar. "Copy" grabs the JSON to bake as the shipped defaults; "Reset" clears.
 */
const QT_LABELS: Partial<Record<keyof QuestTendrilConfig, string>> = {
  enabled: 'ENABLED (0/1)',
  curve: 'arc bulge (×len)',
  staggerMs: 'stagger ms',
  travelMs: 'travel ms',
  retractMs: 'retract ms',
  wobbleAmp: 'wobble px',
  wobbleFreq: 'wobble waves',
  baseWidth: 'width @ node',
  tipWidth: 'width @ unit',
  coreAlpha: 'core α',
  glowWidth: 'glow width',
  glowAlpha: 'glow α',
  flashSize: 'land flash',
  flashMs: 'flash ms',
  moteCount: 'land motes',
  moteSpeed: 'mote speed',
  moteLife: 'mote life',
  pulseSize: 'node pulse',
  pulseAlpha: 'pulse α',
  pulseMs: 'pulse ms',
  colorCore: 'core',
  colorGlow: 'glow',
  colorFlash: 'flash',
  colorMote: 'motes',
};

export function QuestTendrilTuner() {
  const [cfg, setCfg] = useState<QuestTendrilConfig>(getQuestTendrilConfig());
  const [copied, setCopied] = useState(false);
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('questtendril');

  const set = (k: keyof QuestTendrilConfig, v: number | string): void => {
    setQuestTendrilValue(k, v);
    setCfg({ ...getQuestTendrilConfig() });
  };
  const copy = (): void => {
    void navigator.clipboard?.writeText(JSON.stringify(getQuestTendrilConfig(), null, 2));
    setCopied(true);
    window.setTimeout(() => setCopied(false), 1400);
  };
  const reset = (): void => { resetQuestTendrilConfig(); setCfg({ ...getQuestTendrilConfig() }); };

  const sliderKeys = QUESTTENDRIL_KEYS.filter((k) => !QUESTTENDRIL_COLOR_KEYS.includes(k));

  return (
    <div className="sfxmix lunge" ref={panelRef} style={panelStyle}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>Quest Tendril <span>dev · next proc · drag</span></div>
      {sliderKeys.map((k) => {
        const [min, max, step] = QUESTTENDRIL_RANGES[k]!;
        return (
          <div className="sfxmix-row" key={k}>
            <span className="sfxmix-name">{QT_LABELS[k] ?? k}</span>
            <input type="range" min={min} max={max} step={step} value={cfg[k] as number} onChange={(e) => set(k, Number(e.target.value))} />
            <span className="sfxmix-val">{cfg[k]}</span>
          </div>
        );
      })}
      {QUESTTENDRIL_COLOR_KEYS.map((k) => (
        <div className="sfxmix-row" key={k}>
          <span className="sfxmix-name">{QT_LABELS[k] ?? k}</span>
          <input type="color" value={cfg[k] as string} onChange={(e) => set(k, e.target.value)} />
          <span className="sfxmix-val">{cfg[k]}</span>
        </div>
      ))}
      <div className="lunge-btns">
        <button className="sfxmix-copy" onClick={testQuestTendril} title="Fire a tendril from the first quest node to your first board minion">▶ Test FX</button>
        <button className="sfxmix-copy" onClick={copy}>{copied ? 'Copied!' : 'Copy values'}</button>
        <button className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>
    </div>
  );
}
