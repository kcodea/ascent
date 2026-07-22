import { useState } from 'react';
import { SfxMixer } from './SfxMixer';
import { LungeTuner } from './LungeTuner';
import { StrikeFxTuner } from './StrikeFxTuner';
import { CritFxTuner } from './CritFxTuner';
import { FlurrySwingTuner } from './FlurrySwingTuner';
import { SwapFxTuner } from './SwapFxTuner';
import { GustFxTuner } from './GustFxTuner';
import { SpellPowerFxTuner } from './SpellPowerFxTuner';
import { StepProcFxTuner } from './StepProcFxTuner';
import { QuestTendrilTuner } from './QuestTendrilTuner';
import { HeroBuffFxTuner } from './HeroBuffFxTuner';
import { AuraFxTuner } from './AuraFxTuner';
import { WeldFxTuner } from './WeldFxTuner';
import { BuffFxTuner } from './BuffFxTuner';
import { InfuseFxTuner } from './InfuseFxTuner';
import { AimFxTuner } from './AimFxTuner';
import { DragTuner } from './DragTuner';
import { FlipTuner } from './FlipTuner';
import { ShieldTuner } from './ShieldTuner';
import { WardTuner } from './WardTuner';
import { ExecuteTuner } from './ExecuteTuner';
import { ExecuteFxTuner } from './ExecuteFxTuner';
import { TrailTuner } from './TrailTuner';
import { SmokeTuner } from './SmokeTuner';
import { FloatTuner } from './FloatTuner';
import { StepCounterTuner } from './StepCounterTuner';
import { LayoutTuner } from './LayoutTuner';
import { FrameTuner } from './FrameTuner';
import { BookTuner } from './BookTuner';
import { RefreshTuner } from './RefreshTuner';
import { FreezeTuner } from './FreezeTuner';
import { BuffDrawerTuner } from './BuffDrawerTuner';
import { ChargeGlyphTuner } from './ChargeGlyphTuner';
import { GlowTuner } from './GlowTuner';
import { CardPlateTuner } from './CardPlateTuner';
import { EndTurnTuner } from './EndTurnTuner';
import { HeroPowerTuner } from './HeroPowerTuner';
import { TavernUpTuner } from './TavernUpTuner';
import { HeroPanelTuner } from './HeroPanelTuner';
import { pixiFx } from './pixiFx';
import { perfMonitor } from './perfMonitor';

/**
 * DEV-only Dev Tuning Menu — the single 🛠️ button that replaces the old row of floating tuner buttons.
 * Opens a compact list; each entry toggles one tuner panel (the panels themselves are unchanged: draggable,
 * localStorage-backed). "Test FX" stays a one-shot action. Mounted only in dev (see Game.tsx), so the whole
 * menu — and every tuner — is stripped from production.
 */
const TUNERS = [
  { key: 'layout', label: '📐 Scale & Layout', C: LayoutTuner },
  { key: 'frame', label: '🖼️ Card Frames', C: FrameTuner },
  { key: 'book', label: '📖 Compendium Palette', C: BookTuner },
  { key: 'refreshbtn', label: '🔄 Refresh Button', C: RefreshTuner },
  { key: 'freezebtn', label: '❄️ Freeze Button', C: FreezeTuner },
  { key: 'buffdrawer', label: '🧪 Buffs Drawer', C: BuffDrawerTuner },
  { key: 'glow', label: '🔆 Hover Glow', C: GlowTuner },
  { key: 'cardplate', label: '🂠 Card Plate', C: CardPlateTuner },
  { key: 'sfx', label: '🎛️ Mixing Desk', C: SfxMixer },
  { key: 'lunge', label: '🗡️ Lunge', C: LungeTuner },
  { key: 'strikefx', label: '💥 Lunge Strike Effects', C: StrikeFxTuner },
  { key: 'critfx', label: '⚡ Critical Strike FX', C: CritFxTuner },
  { key: 'flurryswing', label: '🌬️ Flurry Swing FX', C: FlurrySwingTuner },
  { key: 'executefx', label: '🩸 Execute Strike', C: ExecuteFxTuner },
  { key: 'swapfx', label: '🔀 Swap FX (Displacement)', C: SwapFxTuner },
  { key: 'gustfx', label: '💨 Buff Gust FX', C: GustFxTuner },
  { key: 'spellpowerfx', label: '✨ Spell Power FX', C: SpellPowerFxTuner },
  { key: 'stepprocfx', label: '🔢 Step Proc FX', C: StepProcFxTuner },
  { key: 'questtendril', label: '🏆 Quest Tendril', C: QuestTendrilTuner },
  { key: 'herobufffx', label: '💥 Hero Buff Flash', C: HeroBuffFxTuner },
  { key: 'aurafx', label: '🌀 Aura Wave FX', C: AuraFxTuner },
  { key: 'weldfx', label: '🔩 Weld FX', C: WeldFxTuner },
  { key: 'bufffx', label: '✨ Buff FX (stat gain)', C: BuffFxTuner },
  { key: 'infusefx', label: '🍖 Fodder Infusion FX', C: InfuseFxTuner },
  { key: 'aimfx', label: '🎯 Hero Aim FX', C: AimFxTuner },
  { key: 'drag', label: '🎴 Drag Feel', C: DragTuner },
  { key: 'flip', label: '🔀 Reposition', C: FlipTuner },
  { key: 'shield', label: '🛡 Shield Place', C: ShieldTuner },
  { key: 'ward', label: '🔵 Ward Dome', C: WardTuner },
  { key: 'execute', label: '🩸 Execute Aura', C: ExecuteTuner },
  { key: 'trail', label: '💨 Trail', C: TrailTuner },
  { key: 'smoke', label: '🌫️ Smoke & Dust', C: SmokeTuner },
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
          {/* the items grid wraps into a NEW COLUMN every 15 rows (grid-auto-flow: column) — overflow columns
              grow to the RIGHT of the first, while the right-anchored panel extends LEFT (see .devmenu-items). */}
          <div className="devmenu-items">
            {TUNERS.map(({ key, label }) => (
              <button key={key} className={`devmenu-item${shown.has(key) ? ' on' : ''}`} onClick={() => toggle(key)}>
                {label} <span>{shown.has(key) ? '✓' : ''}</span>
              </button>
            ))}
            <button
              className="devmenu-item"
              onClick={() => (window as unknown as { __perfHud?: (on?: boolean) => void }).__perfHud?.(!perfMonitor.isRunning)}
              title="Frame-health HUD (also available in the prod build via ?perf=1)"
            >📊 Perf HUD <span>{perfMonitor.isRunning ? '✓' : ''}</span></button>
            <button className="devmenu-item" onClick={() => pixiFx.test()}>✨ Test FX <span>▸</span></button>
            <button className="devmenu-item" onClick={() => pixiFx.testCrit()}>⚡ Test Crit <span>▸</span></button>
            <button className="devmenu-item" onClick={() => pixiFx.testFlurry()}>🌬️ Test Flurry <span>▸</span></button>
          </div>
        </div>
      )}
      {TUNERS.map(({ key, C }) => (shown.has(key) ? <C key={key} /> : null))}
    </>
  );
}
