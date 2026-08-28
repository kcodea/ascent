/**
 * The registry of every tuner panel's spec — the one place that knows the full set.
 *
 * WHY THIS EXISTS. Each panel owns its own reset, and each reset clears only its own storage key. That is right
 * for tuning one thing, but it makes "put EVERYTHING back to what ships" a chore of opening forty-six panels and
 * pressing Reset in each, which nobody does — so a machine accumulates months of half-finished experiments and
 * you can no longer tell what players actually see.
 *
 * It resets by CALLING each panel's own `reset()`, not by clearing storage keys. That matters: a config module's
 * reset also re-applies its values (pushing CSS custom properties, rewriting a `<style>` override), so the board
 * repaints immediately. Deleting the keys instead would leave every module's in-memory copy live until reload,
 * and would risk taking real save data with it — run state lives under the same `ascent.` prefix.
 *
 * Only the SCHEMA panels are here. `SfxMixer` keeps its own bespoke storage and is deliberately excluded (it is
 * an audio mixing desk, not a look tuner, and wiping someone's levels is not what "reset the tuners" means to
 * anyone). Any panel added to the schema should be added here too.
 */
import { SPEC as AlignArcSpec } from './AlignArcTuner';
import { SPEC as AimFxSpec } from './AimFxTuner';
import { SPEC as AuraFxSpec } from './AuraFxTuner';
import { SPEC as ShopDeathFxSpec } from './ShopDeathFxTuner';
import { SPEC as BookSpec } from './BookTuner';
import { SPEC as BuffDrawerSpec } from './BuffDrawerTuner';
import { SPEC as BuffFxSpec } from './BuffFxTuner';
import { SPEC as CardPillsSpec } from './CardPillsTuner';
import { SPEC as CardPlateSpec } from './CardPlateTuner';
import { SPEC as CardTextSpec } from './CardTextTuner';
import { SPEC as ChargeGlyphSpec } from './ChargeGlyphTuner';
import { SPEC as HeroCeremonySpec } from './HeroCeremonyTuner';
import { SPEC as CleaveFxSpec } from './CleaveFxTuner';
import { SPEC as ConsumeFxSpec } from './ConsumeFxTuner';
import { SPEC as CritFxSpec } from './CritFxTuner';
import { SPEC as DragSpec } from './DragTuner';
import { SPEC as EndTurnSpec } from './EndTurnTuner';
import { SPEC as ExecuteFxSpec } from './ExecuteFxTuner';
import { SPEC as ExecuteSpec } from './ExecuteTuner';
import { SPEC as FlipSpec } from './FlipTuner';
import { SPEC as FloatSpec } from './FloatTuner';
import { SPEC as FlurrySwingSpec } from './FlurrySwingTuner';
import { SPEC as FrameSpec } from './FrameTuner';
import { SPEC as FreezeSpec } from './FreezeTuner';
import { SPEC as GlowSpec } from './GlowTuner';
import { SPEC as HeroBuffFxSpec } from './HeroBuffFxTuner';
import { SPEC as HeroPanelSpec } from './HeroPanelTuner';
import { SPEC as HeroPowerSpec } from './HeroPowerTuner';
import { SPEC as InfuseFxSpec } from './InfuseFxTuner';
import { SPEC as LayoutSpec } from './LayoutTuner';
import { SPEC as LobbyPanelSpec } from './LobbyPanelTuner';
import { SPEC as ModePickSpec } from './ModePickTuner';
import { SPEC as HeroDuelSpec } from './HeroDuelTuner';
import { SPEC as LoadScreenSpec } from './LoadScreenTuner';
import { SPEC as LungeSpec } from './LungeTuner';
import { SPEC as PlateCoalesceSpec } from './PlateCoalesceTuner';
import { SPEC as PlateDissolveSpec } from './PlateDissolveTuner';
import { SPEC as PlateGildSpec } from './PlateGildTuner';
import { SPEC as QuestTendrilSpec } from './QuestTendrilTuner';
import { SPEC as RefreshSpec } from './RefreshTuner';
import { SPEC as RubyPowerFxSpec } from './RubyPowerFxTuner';
import { SPEC as RuneforgeBgSpec } from './RuneforgeBgTuner';
import { SPEC as RuneSheenSpec } from './RuneSheenTuner';
import { SPEC as SmokeSpec } from './SmokeTuner';
import { SPEC as SpellBuffFxSpec } from './SpellBuffFxTuner';
import { SPEC as SpellPowerFxSpec } from './SpellPowerFxTuner';
import { SPEC as StepCounterSpec } from './StepCounterTuner';
import { SPEC as StepProcFxSpec } from './StepProcFxTuner';
import { SPEC as SwapFxSpec } from './SwapFxTuner';
import { SPEC as TavernUpSpec } from './TavernUpTuner';
import { SPEC as TitleVeilSpec } from './titleVeilConfig';
import { SPEC as TrailSpec } from './TrailTuner';
import { SPEC as WardSpec } from './WardTuner';
import { SPEC as WeldFxSpec } from './WeldFxTuner';

import { TUNERS_RESET_EVENT, type TunerSpec } from './tunerSchema';

/** Every schema-driven tuner, in file order. */
export const ALL_TUNER_SPECS: TunerSpec<never>[] = [
  AimFxSpec,
  AuraFxSpec,
  ShopDeathFxSpec,
  BookSpec,
  BuffDrawerSpec,
  BuffFxSpec,
  CardPillsSpec,
  CardPlateSpec,
  CardTextSpec,
  ChargeGlyphSpec,
  HeroCeremonySpec,
  CleaveFxSpec,
  ConsumeFxSpec,
  CritFxSpec,
  DragSpec,
  EndTurnSpec,
  ExecuteFxSpec,
  ExecuteSpec,
  FlipSpec,
  FloatSpec,
  FlurrySwingSpec,
  FrameSpec,
  FreezeSpec,
  GlowSpec,
  AlignArcSpec,
  HeroBuffFxSpec,
  HeroPanelSpec,
  HeroPowerSpec,
  InfuseFxSpec,
  LayoutSpec,
  LobbyPanelSpec,
  ModePickSpec,
  HeroDuelSpec,
  LoadScreenSpec,
  LungeSpec,
  PlateCoalesceSpec,
  PlateDissolveSpec,
  PlateGildSpec,
  QuestTendrilSpec,
  RefreshSpec,
  RubyPowerFxSpec,
  RuneforgeBgSpec,
  RuneSheenSpec,
  SmokeSpec,
  SpellBuffFxSpec,
  SpellPowerFxSpec,
  StepCounterSpec,
  StepProcFxSpec,
  SwapFxSpec,
  TavernUpSpec,
  TitleVeilSpec,
  TrailSpec,
  WardSpec,
  WeldFxSpec,] as unknown as TunerSpec<never>[];

/**
 * Put every tuner back to its shipped values. Returns the number of panels reset, so the caller can say what it
 * just did rather than claiming something vague.
 *
 * Open panels re-read their config on render but have no way to know this happened, so it announces itself and
 * `TunerPanel` listens — otherwise a panel would sit there showing stale numbers next to a board that had
 * already changed under it.
 */
export function resetAllTuners(): number {
  for (const spec of ALL_TUNER_SPECS) spec.reset();
  window.dispatchEvent(new CustomEvent(TUNERS_RESET_EVENT));
  return ALL_TUNER_SPECS.length;
}
