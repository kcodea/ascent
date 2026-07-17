import { useState } from 'react';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { StrikeFxTuner } from './StrikeFxTuner';
import { CritFxTuner } from './CritFxTuner';
import { SwapFxTuner } from './SwapFxTuner';
import { GustFxTuner } from './GustFxTuner';
import { AuraFxTuner } from './AuraFxTuner';
import { InfuseFxTuner } from './InfuseFxTuner';
import { AimFxTuner } from './AimFxTuner';
import { DragTuner } from './DragTuner';
import { FlipTuner } from './FlipTuner';
import { ShieldTuner } from './ShieldTuner';
import { TrailTuner } from './TrailTuner';
import { SmokeTuner } from './SmokeTuner';
import { ChoreographyPanel } from './ChoreographyPanel';
import { FloatTuner } from './FloatTuner';
import { StepCounterTuner } from './StepCounterTuner';
import { LayoutTuner } from './LayoutTuner';
import { FrameTuner } from './FrameTuner';
import { ChargeGlyphTuner } from './ChargeGlyphTuner';
import { GlowTuner } from './GlowTuner';
import { EndTurnTuner } from './EndTurnTuner';
import { HeroPowerTuner } from './HeroPowerTuner';
import { TavernUpTuner } from './TavernUpTuner';
import { HeroPanelTuner } from './HeroPanelTuner';
import { pixiFx } from './pixiFx';

/**
 * DEV-only Dev Tuning Menu — the single 🛠️ button that replaces the old row of floating tuner buttons.
 * Opens a compact list; each entry toggles one tuner panel (the panels themselves are unchanged: draggable,
 * localStorage-backed). "Test FX" stays a one-shot action. Mounted only in dev (see Game.tsx), so the whole
 * menu — and every tuner — is stripped from production.
 */
const TUNERS = [
  { key: 'layout', label: '📐 Scale & Layout', C: LayoutTuner },
  { key: 'frame', label: '🖼️ Card Frames', C: FrameTuner },
  { key: 'glow', label: '🔆 Hover Glow', C: GlowTuner },
  { key: 'sfx', label: '🎛️ Mixing Desk', C: SfxMixer },
  { key: 'lunge', label: '🗡️ Lunge', C: LungeTuner },
  { key: 'strikefx', label: '💥 Lunge Strike Effects', C: StrikeFxTuner },
  { key: 'critfx', label: '⚡ Critical Strike FX', C: CritFxTuner },
  { key: 'swapfx', label: '🔀 Swap FX (Displacement)', C: SwapFxTuner },
  { key: 'gustfx', label: '💨 Buff Gust FX', C: GustFxTuner },
  { key: 'aurafx', label: '🌀 Aura Wave FX', C: AuraFxTuner },
  { key: 'infusefx', label: '🍖 Fodder Infusion FX', C: InfuseFxTuner },
  { key: 'aimfx', label: '🎯 Hero Aim FX', C: AimFxTuner },
  { key: 'drag', label: '🎴 Drag Feel', C: DragTuner },
  { key: 'flip', label: '🔀 Reposition', C: FlipTuner },
  { key: 'shield', label: '🛡 Shield Place', C: ShieldTuner },
  { key: 'trail', label: '💨 Trail', C: TrailTuner },
  { key: 'smoke', label: '🌫️ Smoke & Dust', C: SmokeTuner },
  { key: 'choreo', label: '🎬 Choreography', C: ChoreographyPanel },
  { key: 'float', label: '🔢 Damage Float', C: FloatTuner },
  { key: 'stepcounter', label: '📈 Step Counter', C: StepCounterTuner },
  { key: 'chargeglyph', label: '⚡ Charge Glyph', C: ChargeGlyphTuner },
  { key: 'endturnbtn', label: '💎 End Turn Button', C: EndTurnTuner },
  { key: 'heropowerbtn', label: '💠 Hero Power Button', C: HeroPowerTuner },
  { key: 'tavernupbtn', label: '🍺 Tavern Up Button', C: TavernUpTuner },
  { key: 'heropanel', label: '🧍 Hero Panel', C: HeroPanelTuner },
] as const;

export function DevMenu() {
  const [open, setOpen] = useState(false);
  const [shown, setShown] = useState<Set<string>>(new Set());

  const toggle = (key: string): void =>
    setShown((s) => {
      const next = new Set(s);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });

  return (
    <>
      <button className="devmenu-btn" onClick={() => setOpen((o) => !o)} title="Dev tuning menu">🛠️</button>
      {open && (
        <div className="devmenu">
          <div className="devmenu-h">Dev Tuning</div>
          {TUNERS.map(({ key, label }) => (
            <button key={key} className={`devmenu-item${shown.has(key) ? ' on' : ''}`} onClick={() => toggle(key)}>
              {label} <span>{shown.has(key) ? '✓' : ''}</span>
            </button>
          ))}
          <button className="devmenu-item" onClick={() => pixiFx.test()}>✨ Test FX <span>▸</span></button>
          <button className="devmenu-item" onClick={() => pixiFx.testCrit()}>⚡ Test Crit <span>▸</span></button>
        </div>
      )}
      {TUNERS.map(({ key, C }) => (shown.has(key) ? <C key={key} /> : null))}
    </>
  );
}
