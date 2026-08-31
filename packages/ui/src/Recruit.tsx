import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent, type TransitionEvent as ReactTransitionEvent } from 'react';
import { CARD_INDEX, EQUIPMENT_INDEX, QUEST_INDEX, RUNE_INDEX, referencedCardIds } from '@game/content';
import { compileTimeline } from './choreographer/compileTimeline';
import { normalizePresentationBatch } from './choreographer/adapters/presentationBatchAdapter';
import { createTimelinePlayer, runTimeline } from './choreographer/livePlayer';
import { presentConsequence, type PresenterContext } from './choreographer/consequencePresenters';
import { shippedBeatConfig } from './choreographer/beatConfig';
import { draftToEngine } from './beatLab/labSchedule';
import type { BeatPolicyOverrides, BeatTimingOverrides } from './beatLab/beatTiming';
import type { CompiledBeat } from './choreographer/timelineTypes';
import type { ConsequenceEvent, Keyword } from '@game/core';
import { ALE_IDS } from '@game/core';

/**
 * CHOREOGRAPHER PR 4 — opt into the authoritative End-of-Turn player.
 *
 * DEV-only and OFF by default: the legacy projection path still carries FX the new presenters have not
 * inherited yet (Fodder consumes, quest tendrils, weld rings, the Ruby cascade), so flipping the default
 * before those migrate would be a visible regression. Blueprint PR 4 keeps both paths for comparison; PR 5
 * deletes the old one once the side-by-side checklist passes.
 *
 *   localStorage.setItem('ascent.choreo', '1')   // then reload
 */
const CHOREO_EOT = (() => {
  // Opt-OUT, not opt-in (owner sign-off 2026-08-13: "end of turn seems right with the fixes in place").
  // `ascent.choreo = '0'` restores the legacy projection without a rebuild — a rollback valve for a
  // regression found in the wild, kept for one release and removed with the legacy path itself.
  try { return localStorage.getItem('ascent.choreo') !== '0'; } catch { return true; }
})();
// Dev-only breadcrumb so it is unambiguous WHICH End-of-Turn path a session is running.
if (import.meta.env.DEV) {
  (window as unknown as { __choreoEot?: boolean }).__choreoEot = CHOREO_EOT;
}
import { chooseBothText } from './cardText';
import { playerOpponent, alignmentsOf, boardHasCelestial, chooseBothActive, chooseBothStateOf, type ChooseBothState, chooseOneNeedsChoice, computeCombatOdds, type CombatOdds, rubyCastCount, rubyStatBonus, CONFIG, RIFTS, hasTier7Access, maxTierFor, conjuredStats, cardBuff, getHero, isTribe, magnetizesTo, magnetizeTargets, endOfTurnRepeats, projectEndOfTurnSteps, questEndOfTurnBeats, sellValueWithBonus, spellDisplayText, spellAttackBonus, spellHealthBonus, spellCasts, spellCostReduction, implosionCasts, dragonflameCasts, nextOpponent, lossDamageCap, playerLossDamage, minionCostOf, heroOfferPrice, dominantBoardTribe, effectiveTargetTribe, boardManaBonus, upgradeCostOf, nextRefreshCostOf, poolOf, type RunState, type ShopCard, type CardBuff, type BoardCard, type BoardSnapshot, gildCopiesNeeded, activePowers, gateUses, runeStacksOf } from '@game/sim';
import { createPortal } from 'react-dom';
import { setCardId, setCardStats, toggleCardKeyword, setEnemyStats, setEnemyCardId, toggleEnemyKeyword, removeEnemy } from './sandboxEdit';
import { UnitEditor } from './UnitEditor';
import { Card, mdBold, type CardView } from './Card';
import { heroPowerArt, heroArt, equipmentBranchArtFor } from './art';
import { beginDragTrace, cancelDragTrace, endDragTrace, sampleDragTrace } from './replay/dragTrace';
import { SYM_KINDS } from './choreo/channels/float';
import { stabilizeViewMap, stabilizeRefMap, stabilizeView } from './cardViewEqual';
import { deriveDragDecision, dragDecisionEqual, computeCastingSpell, type DragGeo, type DragDecision } from './dragDecision';
import { QuestCard } from './QuestCard';
import { RuneCard } from './RuneCard';
import { RuneLockIn, type RuneLockInCard } from './RuneLockIn';
import { captureRuneLockIn } from './runeLockInCapture';
import { getRuneLockInConfig, stretchLockIn } from './runeLockInConfig';
import { combatGains } from './combatGains';
import { instView, liveCardText, type LiveTextParams } from './instView';
import { getSpellBuffFxConfig } from './spellBuffFxConfig';
import { fireSpellBuff, fireSpellBuffOnHandSpells, fireSpellBuffOnHandRubies } from './spellBuffFx';
import { HudBar } from './HudBar';
import { LobbyPanel } from './LobbyPanel';
import { CombatOpponent } from './CombatOpponent';
import { playHeroStrike } from './choreo/heroStrike';
import { getHeroDuelConfig } from './heroDuelConfig';
import { EndTurnButton } from './EndTurnButton';
import { RiftButton } from './RiftButton';
import { RefreshButton } from './RefreshButton';
import { FreezeButton } from './FreezeButton';
import { TavernUpButton } from './TavernUpButton';
import { GoldPill } from './GoldPill';
import { Icon } from './Icon';
import { sfx, stopAllAudio, resumeAudio, stopTurnCharge } from './sfx';
import { pixiFx, discoverFx } from './pixiFx';
import { FxUnderSlot } from './PixiFxLayer';
import { perfMonitor } from './perfMonitor';
import { getSwapFxConfig } from './swapFxConfig';
import { getSpellPowerFxConfig, floatSpellPowerNumber } from './spellPowerFxConfig';
import { getRubyPowerFxConfig, floatRubyPowerNumber } from './rubyPowerFxConfig';
import { getQuestTendrilConfig, tendrilCfgFor } from './questTendrilConfig';
import { getAuraFxConfig } from './auraFxConfig';
import { applyWeldWiggle, weldCfgFor, weldLandMs } from './weldFxConfig';
import { waveGapFor, coalesceBuffFxByTarget, getBuffFxConfig } from './buffFxConfig';
import { useCiaEnchantedFx } from './useCiaEnchantedFx';
import { useChooseBothFx } from './useChooseBothFx';
import { getAimFxConfig } from './aimFxConfig';
import { getInfuseFxConfig } from './infuseFxConfig';
import { getConsumeFxConfig } from './consumeFxConfig';
import { consumeTransform } from './fx/consumeTransform';
import { playPlateDissolve } from './plateDissolve';
import { playPlateCoalesce } from './plateCoalesce';
import { playPlateGild } from './plateGild';
import { playBuySlide, type BuyFrom } from './buySlide';
import { fireBuffFx } from './buffFxRender';
import { buffPreset, wavePalette } from './buffPresets';
import { ASCEND_PRESETS, ascendPreset } from './ascendPresets';
import { getDragFeel } from './dragFeel';
import { getLayout } from './layoutConfig';
import { getFlipConfig } from './flipConfig';
import { getTrailConfig } from './trailConfig';
import { cardFxScale } from './fx/cardScale';
import { playDef, canPlayDefs } from './fx/playDef';
import { getShopDeathFxConfig } from './shopDeathFxConfig';
import { getEquipFxConfig } from './equipFxConfig';
import { anchorsForUnits } from './fx/combatAnchors';
import { rubyLandHolds } from './choreo/channels/rubyLanded';
import { captureRecruitSeqs, recruitMomentsSince, recruitSeqsOf, selfBuffMoment, shoutMoment, spellCastMoment } from './choreo/recruitMoments';
import { runRecruitMomentCues } from './choreo/recruitCues';
import { bindingFor } from './choreo/bindings';
import { scheduleLands, waves as asWaves } from './fx/land';
import { holdStat, releaseStat } from './fx/statHold';
import { fodderGainHolds, type FodderGain } from './fx/fodderGains';
import { applyFloatSpeed, getFloatConfig } from './floatConfig';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGame } from './store';
import { gateBlocks as tutorialGateBlocks, notifyGateNudge as notifyTutorialGateNudge } from './tutorial/gateBus';
import { Unit } from './Unit';
import { useCombatReplay } from './useCombatReplay';
import { turnClock, useTurnSeconds, useTurnTimeUp } from './turnClock';
import { chargeTune, useChargePreview } from './chargeGlyphTune';
import { ChargeMotes } from './chargeMotes';
import { wipeFx } from './wipeFx';

gsap.registerPlugin(Flip);

// A stable empty keyword-overlay map, so the End-of-Turn keyword projection has a referentially-constant idle
// value (no new Map() each render when nothing is projected).
/** RISE, in the shop (owner ruling 2026-08-28) — the body dies and re-forms, so it must NOT dissolve. A short
 *  bloom marks the death; the return then arrives as an ordinary summon. Screen blend + a warm glow, the same
 *  language the ascend flash speaks, so a re-forming body reads as a return rather than as a kill. */
const RISE_BURST = { flashSize: 150, flashMs: 320, flashAlpha: 0.75, colorGlow: '#ffd27f', blend: 'screen' as const };

const EMPTY_KW: ReadonlyMap<string, ReadonlySet<string>> = new Map();
const EMPTY_TRANSFORMS: ReadonlyMap<string, string> = new Map();

// Shop offers + warband minions are the cards that slide during a drag/reorder (GSAP Flip targets).
const FLIP_SEL_TAVERN = '[data-zone="tavern"] .row .card[data-uid]';
const FLIP_SEL_WARBAND = '[data-zone="warband"] .row .card[data-uid]';
const FLIP_SELECTOR = `${FLIP_SEL_TAVERN}, ${FLIP_SEL_WARBAND}`;

// SANDBOX ONLY: excludes the pinned-opponent cards (`sbfoe-N`, rendered in the tavern row when
// `sbTavernShowsEnemy` is on) from any selector that resolves an arbitrary DOM point/rect to a `data-uid`
// destined for a dispatch, a drag, or a spell/hero-power target. Those cards are edited through their own
// popover (`onSbEnemyPointerDown`), never through the real shop's interaction paths — a selector that can
// still reach one is a bug (see the Fortify hero-power leak this constant was extracted to fix in one place
// instead of three). A no-op outside the sandbox: no element ever carries this uid prefix in a normal run.
const SB_FOE_EXCLUDE = ':not([data-uid^="sbfoe-"])';

/** Fodder-keyword card ids — a constant of the card corpus, computed once so `cardBuffsLive` doesn't walk
 *  the whole CARD_INDEX on every shop action (perf audit 2026-08-06). */
const FODDER_CARD_IDS: readonly string[] = Object.values(CARD_INDEX)
  .filter((d) => d.keywords.includes('FD'))
  .map((d) => d.id);

// The card-marker classes for a persistent aura — Ward (gold dome) and Reborn (blue wisps), both drawn by CSS
// (Card.tsx `.ward` / `.reborn` stacks). Used to spot an aura-wearing card so its landing dust tucks behind it.
// Combat bursts/breaks/re-forms are the choreographer's (channels/aura.ts, fired off the event log). (Taunt is
// signified by a static grey card border, not an aura — see `.card.taunt` in styles.css — so it's not here.)
const AURA_MARKERS = ['dscard', 'reborncard'] as const;

/** How far into a gem's own effect its number lands. `land.at` is when the effect STARTS; the dust takes a
 *  moment to look like it seated, and the number should arrive with the seating rather than the launch.
 *  Per-cue rather than per-def: a def that wants the number tied to a specific beat of its own motion says
 *  so with a `react` layer, which claims the hold (`claimStat`) and takes the clock over entirely. */
const RUBY_DELIVER_OFFSET_MS = 120;

/** How long a gemmed SHOP offer holds its pre-Ruby badge before rolling up — timed to the shop-gem VOLLEY
 *  landing, not the board cascade. One release for the whole shop (the effect is one spanning play), a touch
 *  later than the board's 120ms so the numbers move just as the gems arrive. Owner-set 2026-08-11. */
const SHOP_RUBY_DELIVER_MS = 200;

/** Delay between the cursor volley and each Edward Keg-hands echo of a buff-ale cast (owner-set 2026-08-12). */
const SPELLCAST_EDWARD_ECHO_MS = 80;

/**
 * A card's RESTING centre in viewport coordinates — where it will BE once the layout settles, not where it
 * happens to be drawn right now.
 *
 * `getBoundingClientRect()` includes the element's own transform, and a card mid-FLIP carries a transform
 * pinning it at its OLD slot while it tweens to the new one. Anchoring an effect to that rect puts the effect
 * where the card just was: owner report 2026-08-02 — playing Frenzied Excavator shifts every minion along, and
 * the Ruby detonations all fired at the pre-shift positions.
 *
 * `offsetLeft`/`offsetTop` are LAYOUT positions and transform-immune — the same property the manual FLIP in
 * this file already relies on for its baseline capture ("transform-immune, so a capture taken while a prior
 * tween is still mid-flight records the true resting spot"). So the effect can fire IMMEDIATELY and still land
 * on the destination, rather than having to wait out the slide.
 *
 * When nothing is animating the plain rect is exact and cheaper to reason about, so that path is kept for the
 * common case; the layout arithmetic only runs when a transform is actually in play.
 *
 * Returns null for an element that isn't laid out (no offset parent — `display:none`, or detached).
 */
function restingCenterOf(el: HTMLElement): { x: number; y: number } | null {
  const transform = getComputedStyle(el).transform;
  if (transform === 'none' || transform === '') {
    const r = el.getBoundingClientRect();
    return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
  }
  const parent = el.offsetParent as HTMLElement | null;
  if (!parent) return null;
  const p = parent.getBoundingClientRect();
  return { x: p.left + el.offsetLeft + el.offsetWidth / 2, y: p.top + el.offsetTop + el.offsetHeight / 2 };
}

type DragSource = 'shop' | 'hand' | 'board';

type Zone = 'tavern' | 'warband' | 'hand';

/** How long the End Turn button stays inert at the start of a recruit round (owner ask 2026-07-27) — long
 *  enough that a double-click meant for the previous round can't skip the new one, short enough that a player
 *  who genuinely wants to end instantly barely notices. */
const END_TURN_LOCK_MS = 2000; // 5000 → 2000 (owner re-tune 2026-07-31: the long lock outstayed its welcome)
// px the pointer must move before a click becomes a drag — live-tunable via the DEV Drag tuner (dragFeel.ts).
// How far into a card the cursor must reach (fraction of width) before the insertion point
// moves past it — below 0.5 so cards slide out of the way sooner / more sensitively.
const INSERT_FRAC = 0.5; // insert after a card once the *dragged card's centre* passes its midpoint
const TURN_SECONDS = 18; // base round timer; grows +4s/wave (+6s more from round 6 — owner 2026-07-16), capped at 80 — and floored at CHARGE_SECONDS+1, so wave 1 actually kicks off at 21s (see turnSeconds)
const CHARGE_SECONDS = 20;
/** The strike's own window (wind-up + lunge + recoil) before the tuner's Settle is added — the outer bound for
 *  the cleanup timer. The lunge's timeline is speed-scaled; the beats around it live in the ⚔️ Hero Duel tuner. */
const STRIKE_BASE = 1500;
/** The tally def's ribbon travel (ms) — the burst fires at its end. Keep in sync with `tallyanimation1.json`
 *  (the ribbon layer's `travelMs` and the burst layer's `at`). The pill buffs when the tally lands here. */
const TALLY_TRAVEL_MS = 800; // the charge glyph fills over the final 20s of the turn
const CHARGE_MAX_FEATHER = 24; // % — the reveal feather = this × (1−charge): soft incoming fronts, 0 at completion (no sigil dimming)
const CHARGE_FADEOUT_MS = 450; // when the glyph stops being lit (End Turn / timer end) it fades out over this, not a snap-cut (keep in sync with `.chargeglyph.fading` transition in styles.css)

/** The cast count a spell shows (its ×N badge + cast-spark replay): Implosion resolves 1 + your Demons times
 *  (per-Demon recast, read off the live board), and that whole count is MULTIPLIED by the run-wide spell-recast
 *  multiplier (Nimbus / Ancient Runes / Spell Thesis) — matching what the reducer actually resolves (spellCasts ×
 *  implosionCasts). Every other spell just uses the run-wide `spellCasts` multiplier. `spellCasts` is side-effect
 *  free, so calling it here to preview the count is safe. */
const spellCastCount = (run: Parameters<typeof spellCasts>[0], def: Parameters<typeof spellCasts>[1]): number =>
  // A RUBY has its own count (Prismcaster's per-Ruby recasts × a live Grimoire charge) and does NOT route
  // through `spellCasts` — it isn't a Shop Spell. Reading `spellCasts` for one showed no badge at all, which is
  // what the owner reported (2026-07-24). `rubyCastCount` is the same helper the reducer casts with.
  def.ruby ? rubyCastCount(run) :
  def.id === 'implosion' ? spellCasts(run, def) * implosionCasts(run) :
  def.id === 'sp_dragonflame' ? spellCasts(run, def) * dragonflameCasts(run) : // ×N badge: 1 + your Dragons
  spellCasts(run, def);

/** Build the floating drag-card transform with a CONSISTENT function list, so a CSS transition between the
 *  rAF lean and the snap/magslide states interpolates cleanly. tx/ty = top-left offset; rotX/rotY = 3D tilt
 *  deg; `spin` = the static 2D angle (0 = flat, like a card on the table — the lift read comes from the
 *  drop-shadow + scale, not an angle). All dials live in `dragFeel.ts` / the DEV Drag tuner. */
function dragTransform(persp: number, tx: number, ty: number, rotX: number, rotY: number, scale: number, spin: number): string {
  return `perspective(${persp}px) translate(${tx}px, ${ty}px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale}) rotate(${spin}deg)`;
}

/** Turn countdown (M:SS) as a shop-plaque widget (matches the Gold/Tavern buttons so it reads at a glance).
 *  Subscribes to the clock so ONLY this reads per-second; the plaque + digits turn red in the last 5s. */
function ShopTimer({ practice }: { practice?: boolean }) {
  const s = Math.max(0, useTurnSeconds());
  const practiceTimer = useGame((st) => st.practiceTimer);
  const setPracticeTimer = useGame((st) => st.setPracticeTimer);
  return (
    <div className={`statcell time${s <= 5 ? ' low' : ''}`} aria-label="Time left this turn">
      <span className="sc-ic"><Icon name="clock" /></span>
      <span className="sc-v">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
      {/* PRACTICE only — practice is the unscored mode, so letting the player slow the clock costs nothing.
          Deliberately absent in scored runs: the turn timer is part of the challenge there. `stopPropagation`
          on the pointer keeps a click on the select from reaching the board's drag handler. */}
      {practice && (
        <select
          className="timermult"
          value={practiceTimer}
          onChange={(e) => setPracticeTimer(Number(e.target.value))}
          onPointerDown={(e) => e.stopPropagation()}
          aria-label="Practice shop timer speed"
        >
          {[1, 2, 3, 4].map((m) => <option key={m} value={m}>{m}×</option>)}
        </select>
      )}
      <span className="sbtip">
        {practice
          ? 'Time left this turn. Practice only: pick 1–4× to lengthen the shop timer (1× matches a scored run).'
          : 'Time left this turn — at 0 your actions lock; hit End Turn'}
      </span>
    </div>
  );
}

/** The end-of-turn CHARGE GLYPH turn timer — the board's etched sigil charging with white-hot blue energy over the
 *  final `window` seconds, building from BOTH sides inward along the midline conduit and filling the centre sigil
 *  LAST, completing exactly as the clock hits 0. Anchored to the measured board midline (`--charge-y`); replaces the
 *  burning rope. Hidden during combat. (Pixi motes + the converging-front flare layer on top — added at wire-in.)
 *
 *  Timing is 100% synced to the turn clock: the charge window is the ACTUAL turn length (`min(CHARGE_SECONDS,
 *  turnSeconds)`, so short early-wave turns calibrate correctly, not a fixed 20s), and a rAF interpolates WITHIN
 *  each integer second from the wall-clock moment it began — so charge starts at 0 on the first lit second and hits
 *  1 EXACTLY as the clock reaches 0. Writes `--charge` (0→1) straight to the box ref each frame + the core-bloom
 *  opacity to its ref (no per-frame React render), only while lit + unpaused — the heavy card tree is never touched
 *  (the clock lives in an external store; see turnClock.ts). The wipe/reveal is a compositor-friendly custom-prop
 *  write; the mask does the both-sides-in fill. */
function ChargeGlyph({ inCombat, window: chargeWindow, paused, covered }: { inCombat: boolean; window: number; paused: boolean; covered: boolean }) {
  const seconds = Math.max(0, useTurnSeconds());
  const preview = useChargePreview();          // dev tuner force-shows + scrubs the glyph; null in normal play
  const boxRef = useRef<HTMLDivElement>(null);
  const coreRef = useRef<HTMLDivElement>(null);
  const canvasRef = useRef<HTMLCanvasElement>(null);
  const chargeRef = useRef(0);                  // the live charge (0→1), read by the motes loop each frame
  const tickAtRef = useRef(0);
  // `covered` = a full-screen surface (title / hero select / career / compendium / leaderboard / balance) is
  // hiding the game — the glyph must not be lit behind it: Recruit stays mounted across EVERY phase, so on the
  // MAIN MENU the wave-1 clock (18s ≤ the 20s window) had it lighting invisibly and firing the ~30s charge-build
  // swell at players sitting on the title (owner-reported). Unlit-when-covered kills the sound (via the fade
  // path's stopTurnCharge), the invisible paint, and the motes rAF. Mid-run POPUPS (Discover / quest / forge)
  // are NOT covered — the board stays visible behind them, so the glyph stays lit and merely pauses.
  const lit = preview != null || (!inCombat && !covered && seconds <= chargeWindow);
  // Keep the glyph mounted for a short fade-out when it stops being lit (End Turn pressed / timer ends → combat)
  // instead of snapping to null. `mounted` holds the DOM through the fade; `fading` drives the opacity→0 transition
  // (the paint/motes rAFs are gated on `lit`, so during the fade the glyph freezes at its last frame and just fades).
  const [mounted, setMounted] = useState(lit);
  const [fading, setFading] = useState(false);
  useEffect(() => {
    // Perf-log correlator (audit 2026-08-06): the glyph window is a HYPOTHESIS for shop sluggishness (its
    // blend mode + per-frame mask writes disqualify compositor-only animation). These marks bracket the lit
    // window in the frame timeline, so an exported slow session shows whether bad frames cluster inside it —
    // measurement before surgery, per the perf doctrine.
    perfMonitor.mark(lit ? 'chargeglyph:lit' : 'chargeglyph:out');
    if (lit) { setMounted(true); setFading(false); return; }
    if (!mounted) return;                 // already unmounted — nothing to fade
    setFading(true);                       // lit → unlit while on screen: begin the fade-out
    stopTurnCharge();                      // + fade the long charge-build sound out alongside the visual (it's a
                                           // fire-and-forget clip that would otherwise keep playing under combat)
    const t = window.setTimeout(() => { setMounted(false); setFading(false); }, CHARGE_FADEOUT_MS);
    return () => window.clearTimeout(t);
  }, [lit, mounted]);
  // If the whole component unmounts mid-charge (a new run remounts Recruit via its runKey), the long build clip
  // must die with it — the fade path above only runs while mounted.
  useEffect(() => () => stopTurnCharge(), []);

  // Stamp wall-clock time whenever the integer second changes OR we resume from a pause, so the rAF interpolates
  // the sub-second fraction from the exact instant this second began — keeping the charge locked to real time.
  useEffect(() => { tickAtRef.current = performance.now(); }, [seconds, paused, lit]);

  // Fire the "charge begins" cue ONCE per LIGHT — edge-triggered on `lit` going false→true, which uniformly
  // covers every entry: the clock ticking down into the window, a fresh turn resetting already inside it (short
  // early waves), and a covering surface (title / hero select) closing onto an in-window clock. It can never fire
  // behind the main menu (covered → unlit), and a mid-shop pause (Discover etc.) doesn't flip `lit`, so it never
  // re-fires there. `seconds > 0` keeps a re-light at a dead clock (e.g. menu closed after time-up) silent, and
  // the dev preview's forced light is excluded.
  const prevLitRef = useRef(false);
  useEffect(() => {
    const was = prevLitRef.current;
    prevLitRef.current = lit;
    if (lit && !was && preview == null && seconds > 0) sfx.turnCharge();
  }, [lit, preview, seconds]);

  useEffect(() => {
    if (!lit) return;
    // Paint --charge + the core-bloom opacity for a fill fraction (0→1). Core stays dark until bloomAt, then eases
    // in as t² up to coreMax (both live-tunable via chargeTune).
    const paint = (charge: number): void => {
      chargeRef.current = charge;
      if (boxRef.current) {
        boxRef.current.style.setProperty('--charge', charge.toFixed(4));
        boxRef.current.style.setProperty('--feather', (CHARGE_MAX_FEATHER * (1 - charge)).toFixed(2) + '%'); // soft fronts → 0 at completion
      }
      if (coreRef.current) {
        const t = charge <= chargeTune.bloomAt ? 0 : (charge - chargeTune.bloomAt) / (1 - chargeTune.bloomAt);
        coreRef.current.style.opacity = (t * t * chargeTune.coreMax).toFixed(3);
      }
    };
    if (preview != null) { paint(preview); return; } // dev preview: pin to the forced charge (no clock)
    // Live: a rAF interpolates WITHIN each integer second so the fill hits 1 EXACTLY as the clock reaches 0.
    let raf = 0;
    const draw = (): void => {
      const within = paused ? 0 : Math.min(1, (performance.now() - tickAtRef.current) / 1000);
      const elapsed = Math.min(chargeWindow, (chargeWindow - seconds) + within);
      paint(chargeWindow > 0 ? Math.max(0, Math.min(1, elapsed / chargeWindow)) : 0);
      raf = requestAnimationFrame(draw);
    };
    raf = requestAnimationFrame(draw);
    return () => cancelAnimationFrame(raf);
  }, [lit, seconds, paused, chargeWindow, preview]);

  // Motes: a light 2D-canvas particle layer co-located with the glyph (z:0, behind the cards — the main Pixi canvas
  // is z110, the wrong layer). A continuous rAF (started once per charge session, keyed on `lit`) reads the live
  // charge from chargeRef and drives the engine: white-hot motes onto the lit shape, gathering into the mandala + a
  // flash at completion. Glyph/canvas rects are measured ONCE at start (never per frame — perf north star). Runs
  // only while lit; the card tree is never touched. Tuned in fx/turn-glyph-motes-preview.html (see chargeMotes.ts).
  useEffect(() => {
    if (!lit) return;
    const canvas = canvasRef.current, glyph = boxRef.current;
    if (!canvas || !glyph) return;
    const engine = new ChargeMotes(canvas);
    const gr = glyph.getBoundingClientRect(), cr = canvas.getBoundingClientRect();
    const glyphCssW = gr.width, glyphCssH = gr.height;
    engine.resize(cr.width, cr.height, Math.min(window.devicePixelRatio || 1, 2));
    engine.reset();
    let raf = 0, last = performance.now();
    const loop = (t: number): void => {
      engine.frame(chargeRef.current, glyphCssW, glyphCssH, t - last);
      last = t;
      raf = requestAnimationFrame(loop);
    };
    raf = requestAnimationFrame(loop);
    return () => cancelAnimationFrame(raf);
  }, [lit]);

  // Render the moment `lit` is true — `mounted` only HOLDS the DOM through the fade-out. `mounted` alone lags one
  // commit behind `lit` (it's set by an effect), and gating the render on it meant the `[lit]`-keyed motes/paint
  // effects fired BEFORE the canvas/glyph existed on any re-light where the glyph had been away (turn 2+, where it
  // lights mid-shop) — the motes engine grabbed null refs and never started. Turn 1 escaped only because the very
  // first render seeded `mounted` from an already-true `lit`.
  if (!lit && !mounted) return null;
  return (
    <>
      <div className={`chargeglyph${fading ? ' fading' : ''}`} ref={boxRef} title={`${seconds}s left`} aria-hidden="true">
        <div className="masked charge-base" />
        <div className="masked charge-fill" />
        <div className="masked charge-core" ref={coreRef} />
      </div>
      <canvas className={`charge-motes${fading ? ' fading' : ''}`} ref={canvasRef} aria-hidden="true" />
    </>
  );
}

/** Cards that reference another card → hovering shows it as a popup. The token a card summons /
 *  creates, or the Fodder it buffs / consumes (so the player can read what it does, and see the
 *  *current* buffed Fodder for Ritualist & co). */
const CARD_REFERENCES: Record<string, string[]> = {
  alley: ['stray'], shaper: ['stray'], pack: ['pup'], brood: ['impscrap'], combinator: ['cling', 'moneybot', 'betterbot'],
  feed: ['fred'], ritualist: ['fred', 'impscrap'], maw: ['fred'],
  // Imp summoners / buffers — the popup shows the Imp token at its current buffed stats. Cards that touch
  // both Fodder and Imps (Ritualist, Bane, Fodder Feeder) reference both.
  impking: ['impscrap'], fodderfeeder: ['fred', 'impscrap'], bane: ['fred', 'impscrap'],
};
/** A referenced token/spell card view. A referenced SPELL (a caster's Growth / Lantern) folds in the run's live
 *  spell power via `spellLive`, so hovering the caster shows the spell's CURRENT value — the reason the caster's
 *  own text no longer restates it. A token folds in its persistent buff: Fodder ('fred') gets Ritualist's buff,
 *  the Imp token ('impscrap') the run-wide `impBuff` — so each popup shows the token's current stats. */
export function tokenRefView( // exported for tokenRefView.test.ts (bug 86340900 regression)
  id: string,
  cardBuffs?: Record<string, { attack: number; health: number }>,
  impBuff?: { attack: number; health: number },
  spellLive?: { a: number; h: number; ftb: number; ftbH: number; goldSpent: number; goldPouchValue?: number; tier?: number; growthBonus?: number },
  rubyBonus?: { attack: number; health: number },
  /** The Rubies on the minion whose popup this is (+ its gild) — sizes the Gemheart Golem preview. */
  ownerRuby?: { attack: number; health: number; golden?: boolean },
): CardView {
  const c = CARD_INDEX[id];
  // GEMHEART GOLEM: its stats come from the Rubies on the minion that summons it, so previewing a flat 1/1
  // was a lie about what you'd get (owner 2026-08-06: "the gemheart golem preview should show the stats it
  // will have from that unit"). Mirrors `deathrattleSummonRubyStats` exactly: (1 + owner's Ruby tally) × the
  // owner's gild. `ownerRuby` is absent everywhere except the referenced-card popup, so every other caller
  // keeps the printed token.
  if (id === 'gemheart-shard' && ownerRuby) {
    const g = ownerRuby.golden ? 2 : 1;
    const a = (c.attack + ownerRuby.attack) * g;
    const h = (c.health + ownerRuby.health) * g;
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, universalTribe: !!c.universalTribe,
      attack: a, health: h, keywords: c.keywords, tier: c.tier, text: c.text,
      baseAttack: c.attack, baseHealth: c.health, // so the Ruby-fed gain reads green against the printed 1/1
    };
  }
  // A RUBY previews at what it is worth RIGHT NOW — base 1/1 plus the run's accrued `rubyBonus` (owner
  // 2026-07-25: hovering a card that mentions Rubies should show the Ruby at its current value). Handled
  // before the generic spell branch because a Ruby is flagged `spell` but has no spell-power text of its own.
  if (c.ruby) {
    const a = c.attack + (rubyBonus?.attack ?? 0);
    const h = c.health + (rubyBonus?.health ?? 0);
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, universalTribe: !!c.universalTribe,
      attack: a, health: h, keywords: c.keywords, tier: c.tier,
      // The Ruby's own text has to read live too, or the preview would promise "+1/+1" while granting +3/+3.
      // Same helper the shop's spell slot uses, so the two surfaces can't disagree.
      text: spellDisplayText(c.id, 0, 0, 0, 0, 0, 0, { rubyBonus }),
      spell: c.spell, ruby: true, target: c.target,
      baseAttack: c.attack, baseHealth: c.health, // so the gain reads green against the printed 1/1
    };
  }
  if (c.spell && spellLive) {
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe,
      attack: c.attack, health: c.health, keywords: c.keywords,
      // `rubyBonus` rides along so a previewed Veinstorm (Storm Chaser's hover) prints the LIVE Ruby value —
      // this path fed the Ruby branch above but starved the spell branch, so Veinstorm previewed at +1/+1
      // while the real cast paid more (owner report 2026-08-08).
      // `growthBonus` rides along too, so Mushy's referenced-Growth popup (and the combat fly-in) prints the
      // Rune of Living Growth-improved value — this chain starved it while the shop/spell-slot chains threaded
      // it, so the popup promised the base +1/+1 (player report 2026-08-27, bug 86340900).
      text: spellDisplayText(c.id, spellLive.a, spellLive.ftb, spellLive.h, spellLive.goldSpent, spellLive.ftbH, spellLive.goldPouchValue ?? 0, { tier: spellLive.tier, rubyBonus, growthBonus: spellLive.growthBonus }),
      tier: c.tier, spell: c.spell, target: c.target,
      baseAttack: c.attack, baseHealth: c.health,
    };
  }
  const cb = id === 'impscrap' ? (impBuff ?? { attack: 0, health: 0 }) : (cardBuffs?.[id] ?? { attack: 0, health: 0 });
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe,
    attack: c.attack + cb.attack, health: c.health + cb.health,
    keywords: c.keywords, text: c.text, tier: c.tier, spell: c.spell,
    baseAttack: c.attack, baseHealth: c.health,
  };
}

/**
 * The view for a card a combat effect is CONJURING into your hand — the previews that play during the
 * replay (the fly-in card and the growing hand). Stats come from `conjuredStats`, the same sim helper the
 * reducer settles the real card with, so what flies to your hand is what lands in it.
 *
 * It used to build these previews from base stats + the per-card enchant only, while the reducer also
 * added the creation-time tribe auras — so a Chorus Engine Attachment flew in looking base and then
 * visibly jumped once combat ended (owner report 2026-07-19). Don't recompute these by hand.
 */
function conjuredView(cardId: string, run: RunState): CardView | null {
  const def = CARD_INDEX[cardId];
  if (!def) return null;
  // FULLY LIVE (owner report 2026-08-06: "combat granted spells do not show current values until after
  // combat"). This builder used to pass `undefined` for the live spell state, so tokenRefView fell through
  // to the STATIC def text — every spell-power-scaled grant (Growth, the Ales, Staff of Guel, …) and every
  // scaling granted minion flew in at base and snapped live only at settle. Rubies alone were fixed this way
  // on 2026-08-04 (`run.rubyBonus` below); this finishes the job for everything else.
  const spellLive = {
    a: spellAttackBonus(run), h: spellHealthBonus(run),
    ftb: run.frontToBackBonus, ftbH: run.frontToBackBonusH ?? run.frontToBackBonus,
    goldSpent: run.goldSpentThisTurn ?? 0, goldPouchValue: run.goldPouchValue, tier: run.tier,
    growthBonus: run.growthBonus,
  };
  const base = tokenRefView(cardId, run.cardBuffs, run.impBuff, spellLive, run.rubyBonus);
  // Spells carry no stats to aura — with `spellLive` threaded, tokenRefView's view is now right for them.
  if (def.spell) return base;
  // A granted MINION reads like a shop offer of itself: the full live-text chain, not the printed base.
  const lt = liveCardText(cardId, offerLiveTextParams(false, liveOptsFromRun(run), cardId));
  return { ...base, text: lt.text, ...conjuredStats(run, def) };
}

interface ShopViewOpts {
  /** Juggler: his Gold Pouches also buff the board, so the card must print that. */
  juggler?: boolean;
  /** "Freedom" rift: the first minion this turn is free → every minion offer shows a 0-Gold price until one is bought. */
  freeFirstBuy?: boolean;
  /** END-OF-TURN animation: the running shop-buff delta this offer has accumulated across the beats so far
   *  (Moira re-firing Market Tormentor / Contract Butcher's Shout). Added to the DISPLAYED stats so the number
   *  ticks up in real time on the beat, rather than jumping only after the phase commits (owner ask 2026-08-12).
   *  In effective (post-golden, display) terms — it comes straight from `offerBuyStats` deltas. */
  eotBuff?: { attack: number; health: number };
  spellCostMod?: number;
  cardBuffs?: Record<string, { attack: number; health: number }>;
  spellBonus?: number;
  spellBonusH?: number;
  frontToBackBonus?: number;
  frontToBackBonusH?: number;
  growthBonus?: number;
  undeadAtk?: number;
  undeadHp?: number;
  /** Deathswarmer / Forsaken Weaver / Karthus run-wide "+Attack to your Undead" — baked into the stats
   *  on buy, so the tavern shows it too ("wherever they are"), matching what the offer becomes once bought. */
  undeadBuyAtk?: number;
  /** Squirl Scout / Scrap Herald run-wide buy auras — previewed on a matching offer so it shows its bought stats. */
  beastBuyAtk?: number;
  beastBuyHp?: number;
  magneticBuyAtk?: number;
  magneticBuyHp?: number;
  /** How many times a spell offer will cast right now (Nimbus doubling / Yazzus) — drives the "×N" badge. */
  castMult?: number;
  /** The run-wide shop buy-bonus a purchased minion inherits: the PERMANENT `tavernBuyBonus` PLUS the
   *  per-turn `tavernBuyBonusTurn` layer (Rune of the Merchant's Chorus, Night Market Horror). Both are
   *  folded by the caller, exactly as `offerBuyStats` folds them — the shop row and the buy must agree, and
   *  omitting the per-turn half meant a shop that promised +2/+2 and rendered the printed base (owner report
   *  2026-08-20). */
  tavernAtk?: number;
  tavernHp?: number;
  /** Run-wide Deathrattles triggered this game — so a tavern Grim offer shows its live scaling buff. */
  deathrattlesTriggered?: number;
  /** More run-wide live-text inputs so EVERY scaling offer (Guel, Taragosa, Spirit Worgen, Soulsman, …)
   *  shows its current value in the shop, not just Grim. */
  spellsCast?: number;
  spellsThisTurn?: number;
  soulsmanGold?: number;
  /** The run's Imp Aura (run-wide "Improve your Imps by +A/+H") — Chef Raag's offer shows its live grant. */
  impAura?: { attack: number; health: number };
  /** Rubies cast this run — the other half of the spell umbrella Vaultkeeper/Herzog read. */
  rubyCasts?: number;
  fodderConsumed?: { attack: number; health: number };
  /** Gold spent this turn — Patch Job's live total. */
  goldSpent?: number;
  /** Gold spent across the whole RUN — Ancient Wanderer's live "+A/+H" (a different meter from the per-turn
   *  `goldSpent` above; the card names which one it means). */
  goldSpentRun?: number;
  /** Rune of Pillaging's raised Gold Pouch payout — the pouch shows its live value. */
  goldPouchValue?: number;
  /** Card ids played this turn — Pack Leader / Spirit Worgen per-play scaling. */
  playedThisTurn?: string[];
  /** Squirl Scout's run-wide accrued grant size. */
  squirlScoutBuff?: number;
  conductorBuff?: number;
  /** Dwarven Ales cast this turn — Drunken Oaf's offer shows how many times it will actually repeat. */
  alesThisTurn?: number;
  /** Name of the most recent spell cast this run — Steward of Spells shows what it copies. */
  lastSpellName?: string;
  firstSpellThisTurnName?: string;
  lastSpellThisTurnName?: string;
  topTribe?: string | null;
  /** Live minion price (Rune of Cadence's armed discount folded in); falls back to the config default. */
  minionCost?: number;
  /** The run's Ruby bonus (Set 2) — Veinstorm shows the live Ruby stat line it grants the shop. */
  rubyBonus?: { attack: number; health: number };
  /** Whether this run can actually reach Tier 7 — Beyond the Summit only promises it when true. */
  tier7Access?: boolean;
  /** The run's tavern tier — Lantern Light's shop-slot text scales with it (audit 2026-08-06: the slot was
   *  the ONE surface not passing it, so the spell read base there and live everywhere else). */
  tier?: number;
  /** The run state the (Both) predicate reads — a Choose One offer whose branches are already all enabled
   *  prints (Both) in the tavern too, not a choice the shop is lying about. Built ONLY by
   *  `chooseBothStateOf`: every field is required there precisely so a surface cannot drop one, which is how
   *  the Prismatic Pick's charge went unpainted (owner report 2026-08-31). */
  chooseBothState?: ChooseBothState;
}

/** ShopViewOpts assembled from a raw RunState — the live-text inputs for surfaces that preview a card the
 *  player does NOT own yet (hand-grant fly-ins, Discover options). One builder so no surface can drop a
 *  field again: the 2026-08-06 audit found the grant previews passing NOTHING (static def text until combat
 *  settled — the owner's report) and Discover passing 11 of 30 params. */
function liveOptsFromRun(run: RunState): ShopViewOpts {
  return {
    cardBuffs: run.cardBuffs, undeadBuyAtk: run.undeadBuyAtk, deathrattlesTriggered: run.deathrattlesTriggered,
    spellsCast: run.spellsCast, spellsThisTurn: run.spellsThisTurn, soulsmanGold: run.soulsmanGold,
    impAura: run.impBuff, rubyCasts: run.rubyCasts, fodderConsumed: run.fodderConsumedThisTurn,
    spellBonus: spellAttackBonus(run), spellBonusH: spellHealthBonus(run),
    // The combat replay's display-only escalation preview folds in, so a Quil/Sporebat/Mammoth casting
    // Front to Back moves the HELD card's number as the cast happens rather than at settle (owner 2026-08-07).
    frontToBackBonus: run.frontToBackBonus + (run.fxEscalationPreview?.attack ?? 0),
    growthBonus: run.growthBonus,
    frontToBackBonusH: run.frontToBackBonusH + (run.fxEscalationPreview?.health ?? 0),
    goldSpent: run.goldSpentThisTurn, goldSpentRun: run.goldSpent, goldPouchValue: run.goldPouchValue, playedThisTurn: run.playedThisTurn,
    squirlScoutBuff: run.squirlScoutBuff, conductorBuff: run.conductorBuff, alesThisTurn: run.alesCastThisTurn,
    lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined,
    firstSpellThisTurnName: run.firstSpellThisTurnId ? CARD_INDEX[run.firstSpellThisTurnId]?.name : undefined,
    lastSpellThisTurnName: run.lastSpellThisTurnId ? CARD_INDEX[run.lastSpellThisTurnId]?.name : undefined,
    topTribe: dominantBoardTribe(run), rubyBonus: rubyStatBonus(run), tier7Access: hasTier7Access(run),
    tier: run.tier,
    chooseBothState: chooseBothStateOf(run),
  };
}

/** (Both) for an OFFER: the shared predicate, given only what a shop card knows (its gilded flag + the run
 *  flags the offer builders already carry). One call site per surface, never a re-implementation of the rule. */
function offerChoosesBoth(cardId: string, golden: boolean, o: ShopViewOpts): boolean {
  return chooseBothActive(o.chooseBothState ?? {}, { golden }, CARD_INDEX[cardId]);
}

/** Build the LiveTextParams for a shop/Discover OFFER (no per-instance accruals — it isn't owned yet). */
function offerLiveTextParams(golden: boolean, o: ShopViewOpts, cardId?: string): LiveTextParams {
  return {
    tier: o.tier ?? 1, golden,
    spellBonus: o.spellBonus ?? 0, spellBonusH: o.spellBonusH ?? o.spellBonus ?? 0, frontToBackBonus: o.frontToBackBonus ?? 0,
    spellsThisTurn: o.spellsThisTurn ?? 0, spellsCast: o.spellsCast ?? 0, deathrattlesTriggered: o.deathrattlesTriggered ?? 0,
    clingEnchant: o.cardBuffs?.cling, fodderConsumed: o.fodderConsumed,
    undeadBuyAtk: o.undeadBuyAtk ?? 0, soulsmanGold: o.soulsmanGold ?? 0, cardBuffs: o.cardBuffs, impAura: o.impAura, rubyCasts: o.rubyCasts,
    goldSpent: o.goldSpent ?? 0, goldSpentRun: o.goldSpentRun ?? 0, goldPouchValue: o.goldPouchValue ?? 0, playedThisTurn: o.playedThisTurn, squirlScoutBuff: o.squirlScoutBuff, conductorBuff: o.conductorBuff, alesThisTurn: o.alesThisTurn,
    lastSpellName: o.lastSpellName, firstSpellThisTurnName: o.firstSpellThisTurnName, lastSpellThisTurnName: o.lastSpellThisTurnName, topTribe: o.topTribe, rubyBonus: o.rubyBonus, tier7Access: o.tier7Access,
    chooseBoth: cardId ? offerChoosesBoth(cardId, golden, o) : false,
  };
}
function shopView(card: ShopCard, opts: ShopViewOpts = {}): CardView {
  const c = CARD_INDEX[card.cardId];
  if (c.spell) {
    // A tavern spell: its own (modifiable) cost + a tier pill, no stat footer. Its value text
    // reflects active spell bonuses (Spellbinder + Front to Back's escalation) so it shows what
    // it'll actually grant right now.
    // Spell cost reflects the FULL live reduction (stored spellCostMod + Lazarus's board-presence aura),
    // matching the reducer's buy path (`spellCostReduction`). When it's actually cheaper than the printed
    // cost, flag `costChanged` so the coin renders on a green "discount" box (Lazarus on board → green price).
    const base = c.cost ?? 0;
    const cost = Math.max(0, base - (opts.spellCostMod ?? 0));
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, attack: 0, health: 0,
      // A shop SPELL renders from `spellDisplayText`, not `liveCardText` — so the (Both) rendering has to be
      // applied here too, or a Facetwright's Choice under its rune would read "Choose One:" in the tavern and
      // (Both) everywhere else. Same predicate, same helper.
      keywords: c.keywords, text: (offerChoosesBoth(c.id, false, opts) ? chooseBothText(c.id, false) : null) ?? spellDisplayText(c.id, opts.spellBonus ?? 0, opts.frontToBackBonus ?? 0, opts.spellBonusH ?? opts.spellBonus ?? 0, opts.goldSpent ?? 0, opts.frontToBackBonusH ?? opts.frontToBackBonus ?? 0, opts.goldPouchValue ?? 0, { rubyBonus: opts.rubyBonus, playedThisTurn: opts.playedThisTurn, topTribe: opts.topTribe as never, tier: opts.tier, growthBonus: opts.growthBonus, juggler: opts.juggler }),
      cost, costChanged: cost < base, spell: true,
      chooseBothKey: offerChoosesBoth(c.id, false, opts) ? card.uid : undefined, // (Both) marker hook
      target: c.target, tier: c.tier, castMult: opts.castMult,
    };
  }
  // Displacement: a stashed minion (held) shows its FULL preserved stats / keywords / golden frame. Its stored
  // stats are already final (golden ones already doubled), so no further folding — it restores intact on buy.
  if (card.held) {
    const h = card.held;
    const lt = liveCardText(c.id, offerLiveTextParams(!!h.golden, opts, c.id));
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe,
      attack: h.attack, health: h.health, keywords: h.keywords,
      text: lt.text, goldenText: lt.goldenText ?? c.goldenText, cost: opts.minionCost ?? CONFIG.minionCost, tier: c.tier, golden: h.golden,
      baseAttack: c.attack, baseHealth: c.health,
    };
  }
  // A minion offer — fold in the per-offer buff (Fortify hero power), the persistent per-card run buff
  // (Ritualist's Fodder), Staff of Guel's run-wide tavern-buy buff, and the Lantern of Souls aura on
  // Undead — so a buffed offer reads its new stats (green) and carries the baked ones in when bought.
  const cb = opts.cardBuffs?.[c.id] ?? { attack: 0, health: 0 };
  // Matches the buy path's `isUndead` (reducer): primary/second tribe OR a universalTribe card.
  const undead = c.tribe === 'undead' || c.tribe2 === 'undead' || !!c.universalTribe;
  const beast = c.tribe === 'beast' || c.tribe2 === 'beast' || !!c.universalTribe; // Squirl Scout aura preview
  const magnetic = c.keywords.includes('M'); // Scrap Herald aura preview
  // Fodder carries Staff of Guel through its run-wide enchant (cb), not the buy-buff, so don't fold the
  // tavern-buy bonus onto a Fodder offer too (the reducer's buy path skips it the same way).
  const fodder = c.keywords.includes('FD');
  const tavernAtk = fodder ? 0 : opts.tavernAtk ?? 0;
  const tavernHp = fodder ? 0 : opts.tavernHp ?? 0;
  // Veinstorm's run-wide Ruby grant — same rails and same Fodder exclusion as the tavern buy bonus.
  // Preview the run-wide buy auras a fresh minion inherits (Undead/Beast Attack, Magnetic +atk/+hp) so the
  // offer already reads the stats it'll buy in at — the reducer's buy path bakes exactly these.
  const addAtk = (card.atk ?? 0) + cb.attack + tavernAtk
    + (undead ? (opts.undeadAtk ?? 0) + (opts.undeadBuyAtk ?? 0) : 0)
    + (beast ? opts.beastBuyAtk ?? 0 : 0) + (magnetic ? opts.magneticBuyAtk ?? 0 : 0);
  const addHp = (card.hp ?? 0) + cb.health + tavernHp
    + (undead ? opts.undeadHp ?? 0 : 0) + (beast ? opts.beastBuyHp ?? 0 : 0) + (magnetic ? opts.magneticBuyHp ?? 0 : 0);
  // Golden Touch: a gilded offer shows doubled stats + the golden frame (offer stores base + a flag; the buy
  // bakes the doubling in, mirrored here for display).
  const goldMul = card.golden ? 2 : 1;
  // Every scaling offer (Grim, Guel, Taragosa, Spirit Worgen, …) shows its live value in the tavern, not just
  // on the board — the same live-text chain the board uses (instView), via the shared liveCardText.
  const lt = liveCardText(c.id, offerLiveTextParams(!!card.golden, opts, c.id));
  // Itemize the buy-time buffs the offer previews (Fortify, run enchant, Staff of Guel, tribe buy-aura) so the
  // tavern inspect shows WHERE the boosted stats come from — the same sources the reducer's buy path records.
  const offerBuffs: { source: string; attack: number; health: number; count: number }[] = [];
  const pushBuff = (source: string, a: number, h: number, count = 1): void => { if (a || h) offerBuffs.push({ source, attack: a, health: h, count }); };
  // Tavern buffs on the offer (Apples / Fortify / Fried Circuits / next-shop) — read their real per-source
  // breakdown when present (so the inspect names the actual source), else fall back to the raw atk/hp total.
  if (card.buffs?.length) for (const b of card.buffs) pushBuff(b.source, b.attack, b.health, b.count);
  else pushBuff('Tavern buff', card.atk ?? 0, card.hp ?? 0);
  pushBuff(c.name, cb.attack, cb.health); // persistent per-card run enchant (Ritualist Fodder, Staff of Guel target…)
  pushBuff('Tavern', tavernAtk, tavernHp); // Veinstorm — itemized as Rubies, which is what it now is
  pushBuff('Tribe Bond',
    (undead ? (opts.undeadAtk ?? 0) + (opts.undeadBuyAtk ?? 0) : 0) + (beast ? opts.beastBuyAtk ?? 0 : 0) + (magnetic ? opts.magneticBuyAtk ?? 0 : 0),
    (undead ? opts.undeadHp ?? 0 : 0) + (beast ? opts.beastBuyHp ?? 0 : 0) + (magnetic ? opts.magneticBuyHp ?? 0 : 0));
  if (card.golden) pushBuff('Golden Touch', c.attack, c.health); // gilded doubles the base stats
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe,
    chooseBothKey: offerChoosesBoth(c.id, !!card.golden, opts) ? card.uid : undefined, // (Both) marker hook
    attack: (c.attack + addAtk) * goldMul + (opts.eotBuff?.attack ?? 0), health: (c.health + addHp) * goldMul + (opts.eotBuff?.health ?? 0),
    keywords: [...c.keywords, ...(card.keywords ?? []).filter((k) => !c.keywords.includes(k))],
    text: lt.text,
    goldenText: lt.goldenText ?? c.goldenText,
    buffs: offerBuffs.length > 0 ? offerBuffs : undefined,
    // Moe's guaranteed Attachment carries a discounted price (`card.cost`) — show it on a green coin.
    // Freedom rift: a minion offer reads FREE (0 Gold, green) until the turn's free buy is spent.
    cost: opts.freeFirstBuy ? 0 : (card.cost ?? opts.minionCost ?? CONFIG.minionCost), costChanged: opts.freeFirstBuy || card.cost !== undefined || (opts.minionCost !== undefined && opts.minionCost < CONFIG.minionCost),
    tier: c.tier, golden: card.golden,
    baseAttack: c.attack * goldMul, baseHealth: c.health * goldMul,
  };
}

interface DragState {
  uid: string;
  source: DragSource;
  view: CardView;
  ox: number; oy: number; // anchor offset within the card — set to the CENTRE so the card rides centred on
                          // the cursor once dragging (all drop/insertion math is `x - ox + w/2` = cursor).
  grabOx: number; grabOy: number; // the ACTUAL grab point within the card — the floating card starts here
                                  // (no pickup pop) then smoothly recentres to the cursor over the first frames.
  w: number; h: number; // the source card's size, so the floating card matches exactly
  startX: number; startY: number; // pointer position at press
  x: number; y: number; // current pointer
  active: boolean; // crossed the drag threshold (vs a click)
}

export function Recruit() {
  // Render RATE of the biggest component in the app, surfaced to the perf HUD. This is the instrument that
  // was missing when hero-power aiming turned out to re-render the whole tree on every pointermove: the
  // capture showed a long task with no hotspot, because nothing measured React. A number here makes that
  // class of bug self-evident instead of requiring a code read.
  perfMonitor.count('recruit renders');
  // Render+commit COST (not just rate): captured at render-body start, recorded in the earliest post-commit
  // layout effect below as `render:recruit`. This is the piece `measure()` structurally can't reach — React
  // reconciliation happens after setState — and the leading hypothesis for the late-game weld-fanout hitch
  // (the tree grows with the board, so each of the ~90 renders/sec during a drag costs more). Placed before the
  // Flip layout effect so it excludes Flip (timed separately). No-op cost when the monitor is off.
  const renderStart = performance.now();
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const heroArmed = useGame((s) => s.heroArmed);
  const compactCards = useGame((s) => s.compactCards);
  const armHero = useGame((s) => s.armHero);
  const setEndTurnAnimating = useGame((s) => s.setEndTurnAnimating);
  // CHOREOGRAPHER PR 4 — the prepared-once End-of-Turn transaction (see `playEndOfTurnAuthoritative`).
  const preparePresentationAction = useGame((s) => s.preparePresentationAction);
  const commitPresentationAction = useGame((s) => s.commitPresentationAction);
  // The end-of-turn proc beats are playing (set in endTurn below) — locks every recruit action until done.
  const eotAnimating = useGame((s) => s.endTurnAnimating);
  const setCombatEnemyDeaths = useGame((s) => s.setCombatEnemyDeaths);
  const setCombatQuestDelta = useGame((s) => s.setCombatQuestDelta);
  const setCombatTriggeredQuests = useGame((s) => s.setCombatTriggeredQuests);
  const setCombatCompletedQuests = useGame((s) => s.setCombatCompletedQuests);
  const setCombatBuffs = useGame((s) => s.setCombatBuffs);
  // Tutorial always plays combat at 1× — a first-time player should watch each effect at its authored pace,
  // never a sped-up blur (and the coaching's Predict/Confirm beats are timed to normal speed).
  const rawCombatSpeed = useGame((s) => s.combatSpeed);
  const combatSpeed = run.mode === 'tutorial' ? 1 : rawCombatSpeed;
  const combatRampUp = useGame((s) => s.combatRampUp);
  // Tutorial always plays at a flat 1× (see above), so it never ramps either.
  const rampEnabled = run.mode !== 'tutorial' && combatRampUp;
  // Keep the combat CSS animations in step with the speed slider. Beat holds divide by combatSpeed but CSS
  // durations are fixed seconds, so at higher speeds an animation outlived the beat that gates it:
  //  - floats were yanked while still fully bright (`floatup` holds opacity 1 until 80%) above ~1.07×;
  //  - DEATH animations were cut mid-fade above ~1.31× (the dying unit unmounts when its beat advances) —
  //    i.e. the blink returned at speed. `--combat-speed` divides every `.unit.dying*` duration + delay
  //    (see styles.css), so the animation and its hold shrink together and the ratio is speed-invariant.
  useEffect(() => {
    applyFloatSpeed(combatSpeed);
    document.documentElement.style.setProperty('--combat-speed', String(combatSpeed > 0 ? combatSpeed : 1));
  }, [combatSpeed]);
  // The pre-run hero picker is open while this is set — freeze the round clock until a hero's chosen.
  const heroSelecting = useGame((s) => s.heroChoices !== null);
  // Recruit stays mounted under the title / leaderboard overlays (see Game.tsx), so the round clock must also
  // pause for those — otherwise the timer keeps ticking (and the last-5s `sfx.tick` fires) on the Hall of
  // Champions / title screen, where there's no active turn.
  // Any full-screen overlay pauses the recruit turn timer + logic AND the combat replay (see `paused` below) — so
  // the saved game never ticks / runs "in the background" (and no combat sfx leak) behind the Career, Leaderboard
  // (Hall of Champions + Rankings), Balance Report, Compendium, or title (an exploit + a confusing UX).
  // The DEV FX workbench is deliberately NOT in this list. Its rail mode exists precisely to watch the fight
  // play under the panel, and `overlayOpen` would freeze the replay the moment the workbench opened. Don't
  // "complete" the list by adding it.
  // `bugReportOpen` rides the same expression (bug reporter PR 1, blueprint §4.1/§4.2): opening the Ctrl+B
  // reporter pauses the recruit clock AND the combat replay through this one path — and it is deliberately
  // NOT in the clock-reset effect's deps below, so open/close resumes from the exact displayed second
  // instead of resetting the turn.
  const overlayOpen = useGame((s) => s.showTitle || s.showLeaderboard || s.showRankings || s.showCareer || s.showBook || s.showBalance || s.bugReportOpen);
  // Subscribed alone (not just via `overlayOpen`) so the clock-reset effect can key on the title→play flip: a
  // resumed run does NOT change wave/turnSeconds, so without this the reset never fires and the turn is stuck at
  // 0 (owner Save & Quit bug 2026-08-24). Only the true title screen sets this — opening the Book mid-run doesn't.
  const showTitle = useGame((s) => s.showTitle);
  // Fortify can target a tavern offer too; Gild / Encore act only on your warband.
  // The ARMED slot's wielded power (Mimic's disguise / Void's pair — `activePowers`), not the native hero's:
  // the aim-target rules below must describe the power that will actually fire.
  const heroArmedSlot = useGame((s) => s.heroArmedSlot);
  const equipArmed = useGame((s) => s.equipArmed);
  const armEquipment = useGame((s) => s.armEquipment);
  const heroPowerKind = (activePowers(run)[heroArmedSlot] ?? activePowers(run)[0]!).kind;
  // Quillen's Archive files a friendly OR a Shop minion, so it accepts tavern picks like Fortify does.
  // Sable's Soulbind: the two bound ends wear a ring for the turn the bond is live. Expired by wave, exactly as
  // the reducer + combat read it, so the mark can never outlast the bond it is drawing.
  // Cia's enchanted foil is rendered through the SHARED Pixi layer, not per-card CSS — the controller only
  // needs to know which offers are enchanted, and owns all the per-frame work itself.
  // Drop every enchanted uid the instant combat begins so `useCiaEnchantedFx` tears its looping emitters down
  // AT ONCE (hard teardown, no fade) — otherwise the offers keep `enchanted` through the fight and the loops
  // bleed enchant particles onto the shared overlay during combat (owner ask 2026-08-21). They come back when
  // the shop returns (phase leaves 'combat' and the enchanted offers repopulate this list).
  const enchantedUids = useMemo(
    () => (run.phase === 'combat' ? [] : run.shop.filter((o) => o.enchanted).map((o) => o.uid)),
    [run.shop, run.phase],
  );
  useCiaEnchantedFx(enchantedUids);
  const soulboundUids = useMemo(
    () => (run.sableBond && run.sableBond.wave === run.wave ? new Set([run.sableBond.a, run.sableBond.b]) : new Set<string>()),
    [run.sableBond, run.wave],
  );
  // Albus's Empowerment targets a Shop offer ONLY (it upgrades what's for sale, never your board).
  const heroTargetsTavern = heroPowerKind === 'fortify' || heroPowerKind === 'archive' || heroPowerKind === 'empowerment';
  const heroTargetsTavernOnly = heroPowerKind === 'empowerment';
  // Darah's Displace can't target a golden minion (you can't trade away a triple) — excluded as a valid pick.
  const heroTargetsNoGolden = heroPowerKind === 'displace';
  // The active +X/+X bonus to stat-granting spells (Spellbinder, etc.) — so spell cards show their
  // real value. One source of truth shared with the reducer's cast math.
  const spellBonus = spellAttackBonus(run);
  const spellBonusH = spellHealthBonus(run);

  // Round timer grows +4s each wave, capped at 80s. (Recruit now stays mounted across
  // combat, so the per-wave reset is an effect keyed on the wave — see below.) Practice gives 3× the clock.
  // Floored at CHARGE_SECONDS+1 (21s) so NO turn ever STARTS inside the charge window — the glyph then always
  // lights by the clock TICKING across the threshold, the one battle-tested path. Wave 1's base 18s sat inside
  // the 20s window, forcing a light-at-shop-mount special case whose swell mis-fired (owner: round 1 kicks off
  // at 21s instead). Only wave 1 changes: wave 2+ (22s+) and practice (×3) already start above the window.
  // Rounds 6+ get a flat +6s on top of the +4s/wave ramp, and rounds 12–17 a further +12s ON TOP OF the
  // 80s cap (owner 2026-07-16 ×2): late boards have the most to think about. w12 80s, w13 84s … w15+ 92s.
  // Sandbox (Scene Builder): a huge fixed clock so the turn never times out while you build.
  // Practice's shop timer is a PLAYER CHOICE (owner 2026-07-25): the dropdown beside the clock picks 1-4x, with
  // 1x being exactly the scored mode's clock. Was a fixed 3x, which is still the default so existing practice
  // runs feel unchanged. Scored modes always run at 1x — the multiplier is never consulted outside practice.
  const practiceTimer = useGame((st) => st.practiceTimer);
  // Tutorial + sandbox get an effectively-infinite clock: a first-time player should never be rushed while
  // reading a lesson (blueprint §6.4: "Timer — Disabled"), and the sandbox is a dev rig.
  const turnSeconds = run.sandbox || run.mode === 'tutorial' ? 99999 : Math.max(CHARGE_SECONDS + 1, (Math.min(80, TURN_SECONDS + (run.wave - 1) * 4 + (run.wave >= 6 ? 6 : 0)) + (run.wave >= 12 ? 12 : 0)) * (run.mode === 'practice' ? practiceTimer : 1));

  // Projected STARTING Gold for the next two waves (the Gold-cell hover) — cap-aware, folding in board mana
  // income (Money Bot) and the one-turn Hoarder/Robin bank (into Wave+1 only, since it's consumed then).
  // Mirrors the reducer's turn-start `embers` formula (see reducer.ts ~1039).
  const goldManaBonus = boardManaBonus(run);
  const maxGoldBonus = run.maxGoldBonus ?? 0; // Shop License's permanent above-cap bonus
  const nextTurnGold =
    Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + CONFIG.embersPerWave)) + maxGoldBonus + goldManaBonus + (run.bonusEmbersNextTurn ?? 0);
  const afterNextGold =
    Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + 2 * CONFIG.embersPerWave)) + maxGoldBonus + goldManaBonus;

  const [drag, setDrag] = useState<DragState | null>(null);
  const [overZone, setOverZone] = useState<Zone | null>(null);
  // Height (px) of the sell region = top of screen → top of the warband. Measured when a board-minion
  // drag begins, so the whole upper screen can act as one big "drop to sell" zone.
  const [sellTop, setSellTop] = useState(0);
  // Same idea for the buy zone: top of the warband → bottom of screen, measured when a shop-card drag begins.
  const [buyTop, setBuyTop] = useState(0);
  const [snapping, setSnapping] = useState(false);
  const [magSlide, setMagSlide] = useState(false); // a Magnetic card sliding into its Mech
  const [magTargetUid, setMagTargetUid] = useState<string | null>(null); // the Mech being merged into (crackles)
  // Only the hovered TARGET is React state — the aim line's coordinates are pushed straight into Pixi by
  // the rAF-coalesced move handlers, so pointer movement no longer re-renders this component.
  const [aimTargetUid, setAimTargetUid] = useState<string | null>(null);
  // SANDBOX ONLY: which board minion the unit editor is open on, and the rect it is seated under. Held as a
  // uid + rect rather than an element so a re-render (a stat edit is a re-render) can't leave a stale node.
  const sbEditMode = useGame((s) => s.sbEditMode);
  const [sbEditing, setSbEditing] = useState<{ uid: string; rect: DOMRect } | null>(null);
  // SANDBOX ONLY: the toggle that swaps the tavern row from shop offers to the board pinned for the coming
  // fight, and the same index+rect pattern as `sbEditing` for whichever pinned enemy slot is being edited.
  const sbTavernShowsEnemy = useGame((s) => s.sbTavernShowsEnemy);
  const [sbEditingFoe, setSbEditingFoe] = useState<{ index: number; rect: DOMRect } | null>(null);
  // SANDBOX ONLY: this combat phase is a RE-WATCH of an already-resolved fight, not a fight awaiting
  // resolution. Every combat EXIT below has to branch on it — the whole contract of "run it again" is that
  // it re-runs the animation and nothing else, and the shared exits all resolve a combat.
  const sandboxReplay = useGame((s) => s.sandboxReplay) && run.sandbox === true;
  const exitReplay = useGame((s) => s.exitReplay);
  // Hand spells / Rubies whose printed value just went up — they play the grow/shrink + spark blast (see the
  // spell-buff watcher below). `prevSpellSigRef` is the last rendered value signature per hand-card uid.
  // The burst state itself lives in `spellBuffFx.ts`, NOT here — any phase or surface has to be able to start
  // this cue (end of turn, start of combat, a mid-combat Echo/Avenge), and state owned by Recruit could only
  // ever be started by Recruit. Cards subscribe to that store directly; this component just detects the buffs
  // it can see and calls `fireSpellBuff`.
  const prevSpellSigRef = useRef<Map<string, string>>(new Map());
  // Last phase the spell-buff watcher saw — lets it skip the single render where the phase flips (see below).
  // Named apart from the stat-diff watcher's own `prevPhaseRef`, which exists lower down for the same class of
  // reason (suppressing a spurious flash across the combat↔recruit transition) but tracks its own cadence.
  const spellBuffPhaseRef = useRef(run.phase);
  // Last weld seq the stat-diff watcher has seen — lets it suppress the generic buff cues for the minions a
  // FRESH weld just landed on (the weld has its own ring + wiggle), without touching any other buff.
  const weldStatSeqRef = useRef<number | undefined>(undefined);
  // A one-shot spark burst at a screen point, fired when a spell is cast.
  const [spark, setSpark] = useState<{ x: number; y: number; key: number } | null>(null);
  const sparkKeyRef = useRef(0);
  // Channeling the Devourer: a stat "projectile" flung from the devoured minion to its random recipient.
  const [devourBolt, setDevourBolt] = useState<
    { fromX: number; fromY: number; toUid: string; attack: number; health: number; key: number } | null
  >(null);
  const devourBoltRef = useRef<HTMLDivElement>(null);
  // Animate the Devourer bolt: the +A/+B mote arcs from the devoured minion to its recipient, then bursts
  // (a spark on arrival). The recipient's stats already jumped on cast — the bolt sells the transfer.
  useEffect(() => {
    if (!devourBolt) return;
    const el = devourBoltRef.current;
    if (!el) return;
    const recip = document.querySelector(`[data-zone="warband"] .row.warband .card[data-uid="${devourBolt.toUid}"]`);
    const r = recip?.getBoundingClientRect();
    const toX = r ? r.left + r.width / 2 : devourBolt.fromX;
    const toY = r ? r.top + r.height / 2 : devourBolt.fromY;
    const tl = gsap.timeline({
      onComplete: () => {
        sparkKeyRef.current += 1;
        const k = sparkKeyRef.current;
        setSpark({ x: toX, y: toY, key: k });
        window.setTimeout(() => setSpark((s) => (s?.key === k ? null : s)), 600);
        setDevourBolt(null);
      },
    });
    tl.fromTo(
      el,
      { x: devourBolt.fromX, y: devourBolt.fromY, xPercent: -50, yPercent: -50, scale: 0.5, opacity: 0 },
      { opacity: 1, scale: 1, duration: 0.12, ease: 'power2.out' },
    )
      .to(el, { x: toX, y: toY, duration: 0.32, ease: 'power2.in' })
      .to(el, { scale: 1.5, opacity: 0, duration: 0.12, ease: 'power1.in' });
    return () => {
      tl.kill();
    };
  }, [devourBolt]);
  // Chaos hero power: when a Chaos Attachment is granted (every 5th turn), fly the new hand token in from the
  // hero portrait. One-shot, keyed off `chaosGrantSeq` (like fodderEatenSeq); inits to the current value so it
  // doesn't fire on mount (the game-start token is just there).
  const prevChaosSeq = useRef(run.chaosGrantSeq);
  useEffect(() => {
    const seq = run.chaosGrantSeq;
    if (seq === undefined || seq === prevChaosSeq.current) return;
    prevChaosSeq.current = seq;
    const uid = run.chaosGrantUid;
    if (!uid) return;
    const card = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
    const portrait = document.querySelector('.heroimg');
    if (!card || !portrait) return;
    const c = card.getBoundingClientRect();
    const p = portrait.getBoundingClientRect();
    const dx = p.left + p.width / 2 - (c.left + c.width / 2);
    const dy = p.top + p.height / 2 - (c.top + c.height / 2);
    const tween = gsap.from(card, {
      x: dx, y: dy, scale: 0.2, opacity: 0, rotate: -20, duration: 0.55, ease: 'back.out(1.4)',
      onComplete: () => gsap.set(card, { clearProps: 'all' }), // hand back to its CSS-driven transforms
    });
    return () => { tween.kill(); };
  }, [run.chaosGrantSeq, run.chaosGrantUid]);
  // ale-bubbles (Set 2, Dwarves): a Dwarf GENERATED a Dwarven Ale in the SHOP — Brunni (End of Turn), Tapkeeper
  // (on Gold spent), Doubletap Brewer (Shout). Burst `ale-bubbles` from the generating unit's warband card.
  // One-shot, keyed off `aleGrantSeq` (inits to current so a restored save doesn't fire); the rect is read one
  // frame late so React has committed. Combat-generated ales are fired by the choreographer (score.ts), not here.
  const prevAleSeq = useRef(run.aleGrantSeq);
  useEffect(() => {
    const seq = run.aleGrantSeq;
    if (seq === prevAleSeq.current) return;
    prevAleSeq.current = seq;
    if (!canPlayDefs() || run.aleGranted.length === 0) return;
    const sources = Array.from(new Set(run.aleGranted.map((e) => e.sourceUid))); // one burst per generating unit
    const raf = requestAnimationFrame(() => {
      for (const uid of sources) {
        const el = document.querySelector<HTMLElement>(`[data-zone="warband"] .row .card[data-uid="${uid}"]`);
        if (!el) continue; // the unit left the board (e.g. sold) before the frame — skip silently
        const r = el.getBoundingClientRect();
        const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        playDef('ale-bubbles', { source: p, target: p }, { uids: { source: uid, target: uid } });
      }
    });
    return () => cancelAnimationFrame(raf);
  }, [run.aleGrantSeq]);
  // Displacement swap (Darah's power / the spell): fire the circular swap-arrows FX between the two NEW
  // cards (the arrival on the board, the displaced offer in the tavern). Keyed off `swapFxSeq` (one-shot,
  // the chaosGrantSeq pattern; inits to the current value so a restored save doesn't fire). The rects are
  // read one frame late so React has committed both new cards first.
  const prevSwapFxSeq = useRef(run.swapFxSeq);
  useEffect(() => {
    const seq = run.swapFxSeq;
    if (seq === undefined || seq === prevSwapFxSeq.current) return;
    prevSwapFxSeq.current = seq;
    const boardUid = run.swapFxBoardUid, shopUid = run.swapFxShopUid;
    if (!boardUid || !shopUid) return;
    const raf = requestAnimationFrame(() => {
      const b = document.querySelector(`[data-uid="${boardUid}"]`);
      const t = document.querySelector(`[data-uid="${shopUid}"]`);
      if (!b || !t) return;
      const br = b.getBoundingClientRect(), tr = t.getBoundingClientRect();
      pixiFx.swapArc(
        { x: br.left + br.width / 2, y: br.top + br.height / 2 },
        { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 },
        getSwapFxConfig(),
      );
    });
    return () => cancelAnimationFrame(raf);
  }, [run.swapFxSeq, run.swapFxBoardUid, run.swapFxShopUid]);
  // NB: the quest tendril is fired from the END-OF-TURN BEAT LOOP (see `endTurn` below), NOT from a reducer
  // signal. `questTendrilFx` is still stamped in the sim and still drives the NODE PULSE in QuestBadges, but
  // the ribbon itself has to be drawn while the board is still on screen: the End-of-Turn commit (`faceOmen`)
  // only lands after every beat has played and the phase has flipped, so an effect keyed off the committed
  // state ran too late to find its target and drew nothing.
  // Spell Power — SPELL POWER JUST WENT UP in the shop, from any source and by any amount (Cinderwing
  // Matron's Shout, a quest reward, a rune…): rising pink/purple/gold arrows + a mote blast, and the GAIN
  // floats up once they land. Keyed off `spellPowerFxSeq`, the same one-shot dedupe as swapFx; inits to the
  // current value so a restored save never fires on load. Anchored to the shop row — the cue means "your
  // spells got stronger", which is a tavern-wide fact rather than one card's.
  const prevSpellPowerSeq = useRef(run.spellPowerFxSeq);
  useEffect(() => {
    const seq = run.spellPowerFxSeq;
    if (seq === undefined || seq === prevSpellPowerSeq.current) return;
    prevSpellPowerSeq.current = seq;
    const gainA = run.spellPowerFxAtk ?? 0;
    const gainH = run.spellPowerFxHp ?? 0;
    // The End-of-Turn commit (`faceOmen`) bumps this too, AFTER the beats have already played the per-proc
    // flourish — that late bump is the Start-of-Combat pop the owner saw. The beats own End of Turn now, so
    // skip the committed signal for that action and let the shop paths (a cast, a buy) keep it.
    if (run.spellPowerFxUid === undefined && run.phase !== 'recruit') return;
    const uid = run.spellPowerFxUid;
    const raf = requestAnimationFrame(() => {
      // Over the CARD that caused the gain (owner ask 2026-07-21) — read a frame late so React has committed
      // it to the board. A sourceless gain (quest reward, rune tick) has no uid, and a card that LEAVES play
      // as it resolves won't be found, so both fall back to the shop row rather than firing nowhere.
      const el = (uid && document.querySelector(`[data-uid="${uid}"]`))
        ?? document.querySelector('[data-zone="tavern"]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      pixiFx.spellPower(x, y, getSpellPowerFxConfig());
      floatSpellPowerNumber(x, y - r.height * 0.3, gainA, gainH);
    });
    return () => cancelAnimationFrame(raf);
  }, [run.spellPowerFxSeq, run.spellPowerFxAtk, run.spellPowerFxHp, run.spellPowerFxUid]);
  // RUBY POWER FX (owner ask 2026-07-24) — the Ruby-side twin of the effect above, on the same one-shot seq
  // contract. `rubyPowerFxSeq` is stamped from the reducer's `rubyBonus` before/after delta, so this one effect
  // covers the shop, End of Turn AND the combat carry-back (Veinbreaker's Avenge settles onto `rubyBonus`).
  // Guarded like the spell-power twin: a SOURCELESS bump outside the shop is the combat CARRY-BACK, which the
  // mid-combat narration beat has already shown — firing it again is the end-of-combat double-play the owner
  // reported. A sourced bump (a card you played) still fires in any phase.
  const prevRubyPowerSeq = useRef(run.rubyPowerFxSeq);
  useEffect(() => {
    const seq = run.rubyPowerFxSeq;
    if (seq === undefined || seq === prevRubyPowerSeq.current) return;
    prevRubyPowerSeq.current = seq;
    const gainA = run.rubyPowerFxAtk ?? 0;
    const gainH = run.rubyPowerFxHp ?? 0;
    const uid = run.rubyPowerFxUid;
    if (uid === undefined && run.phase !== 'recruit') return;
    const raf = requestAnimationFrame(() => {
      // Over the card that caused it when there is one; otherwise over the player's HAND, because that's where
      // the Rubies that just got stronger actually are (the spell-power twin falls back to the tavern instead,
      // which is the right anchor for ITS "your spells got stronger" read but the wrong one here).
      const el = (uid && document.querySelector(`[data-uid="${uid}"]`))
        ?? document.querySelector('.row.hand .card.rubycard')
        ?? document.querySelector('.row.hand')
        ?? document.querySelector('[data-zone="tavern"]');
      if (!el) return;
      const r = el.getBoundingClientRect();
      const x = r.left + r.width / 2;
      const y = r.top + r.height / 2;
      pixiFx.rubyPower(x, y, getRubyPowerFxConfig());
      floatRubyPowerNumber(x, y - r.height * 0.3, gainA, gainH);
      // The held Rubies themselves also play the spell-buff cue, so the "these cards got stronger" read is on
      // the cards and not only in the flourish. Fires through the shared bus, hence any phase.
      fireSpellBuffOnHandRubies(useGame.getState().run.hand);
    });
    return () => cancelAnimationFrame(raf);
  }, [run.rubyPowerFxSeq, run.rubyPowerFxAtk, run.rubyPowerFxHp, run.rubyPowerFxUid]);
  // RUBY LANDED FX (owner ask 2026-08-01) — the shop half of the Ruby-landed cue: a detonation on each minion a
  // Ruby was just played on. Distinct from the Ruby POWER cue above, which fires when your Rubies get stronger
  // and deliberately never fires per cast; this one is per cast and says nothing about strength, so a card that
  // does both (Crownvein) correctly shows both reads.
  //
  // Covers every recruit source at once — your drag from hand, a board-wide Shout, an End-of-Turn mint — because
  // `rubyLandedFxUids` is derived in the reducer from a `rubiesOnThisTurn` delta rather than stamped per play
  // site. The combat half is the `rubyFx` cue channel, off the `ruby` flag on the buff event.
  const prevRubyLandedSeq = useRef(run.rubyLandedFxSeq);
  /** The Veinstorm shop-gem HOLD's own guard — the offers withhold their pre-Ruby badge on `veinstormFxSeq`,
   *  a different signal from the per-card cascade's `rubyLandedFxSeq`, so it needs its own advance. */
  const prevVeinstormHoldSeq = useRef(run.veinstormFxSeq);
  /** The recruit-cue runner's own counter snapshot — see `recruitMoments.ts`. Separate from
   *  `prevRubyLandedSeq`, which the stat-HOLD effect below owns and advances on its own schedule. */
  const prevRecruitSeqs = useRef(recruitSeqsOf(run));
  /** Live `run` for the cue runner's lookups, so the effect below can depend on the two counters
   *  alone. Assigned every render (a property write, no effect) — see `combatSpeedRef`. */
  const runRef = useRef(run);
  runRef.current = run;
  /**
   * WITHHOLD the stat change so the gem's effect can deliver it (`fx/statHold.ts`) — the shop half of what
   * `score.ts` does for combat.
   *
   * `useLayoutEffect`, not `useEffect`, and that is the entire reason this is its own effect rather than two
   * lines inside the cue below. A layout effect runs after the commit but BEFORE the browser paints; a
   * normal effect runs after. Holding in a normal effect would let the new number paint for one frame and
   * then jump backwards to the old one before rolling — visibly worse than not withholding at all.
   *
   * The per-gem amount is derived rather than carried: `RubyLandedFx` reports `{uid, count}` only, but each
   * minion's `Ruby` CardBuff records the TOTAL that source contributed and how many times, so
   * `total / count` is the per-gem value. Derived UI-side deliberately — the alternative is a new field on
   * `RubyLandedFx`, which is `packages/sim` and the other side of the ownership seam.
   *
   * Anything unusable (no board entry, no Ruby buff yet, a zero count) simply does not hold: the badge shows
   * the truth immediately, which is exactly today's behaviour and the safe direction.
   *
   * No authored layer is required to release this hold. `fx/statHold.ts`'s shared rAF ticker drives every
   * hold whose origin is not `effect`, so a `cue` hold delivers itself on schedule whether or not a `react`
   * layer is armed for `ruby-gem-apply` — unlike the `effect`-origin holds `score.ts` places, which really
   * do need their layer to fire. If a carrying `react` layer IS armed later, it CLAIMS this hold
   * (`claimStat`) as it spawns, which promotes it to `effect` and takes the ticker off it — so the authored
   * timing wins over the automatic floor rather than racing it.
   *
   * Each RECIPIENT is withheld until its own gem, not until the reducer tick. `rubyLandHolds` groups the
   * same `rubyLandSchedule` the fire effect below reads back into one entry per uid, so the number and the
   * dust cannot drift — alignment is structural rather than maintained. Without this, an Excavator dropping
   * gems one at a time across the board moved all seven numbers simultaneously, which visibly proves to the
   * player that the effect is not what is causing them. (Within one recipient's own stack the number still
   * reveals as a single step, not gem by gem — `rubyLandHolds`'s doc comment explains why that's correct
   * rather than a shortfall.)
   */
  useLayoutEffect(() => {
    const seq = run.rubyLandedFxSeq;
    if (seq === undefined || seq === prevRubyLandedSeq.current) return;
    // Advance the guard NOW, so this fires exactly once per Ruby event. The deps include `run.board` (the
    // buff lookup below reads it), so without this line every later board change — buy, sell, freeze, any
    // gem, any action — re-enters and re-places the SAME hold. `holdStat` carries the unrevealed remainder
    // and restarts the roll (see `fx/statHold.ts`), so a re-placed hold grows without bound and the badge
    // collapses toward 0 and rolls on every action. That regressed in #947, which replaced the old cue
    // effect that used to own this advance and deleted the line with it; the two are decoupled now (the
    // recruit-moments runner below keys off `prevRecruitSeqs`), so this effect owns its own guard outright.
    prevRubyLandedSeq.current = seq;
    const lands = run.rubyLandedFx ?? [];
    // Per-gem holds on the cascade's own clock (the sweep the eye follows). `buffOf` reads the board, so a
    // board minion's gem withholds and rolls; a lone Ruby on a shop offer finds no board buff, is skipped, and
    // its badge shows immediately (unchanged behaviour). Veinstorm-gemmed offers are NOT in `lands` at all —
    // the sim routes them to the span, whose own hold effect below withholds them on volley timing.
    const buffOf = (uid: string): CardBuff | undefined =>
      run.board.find((c) => c.uid === uid)?.buffs?.find((b) => b.source === 'Ruby');
    for (const hold of rubyLandHolds(lands, buffOf)) {
      holdStat(hold.uid, { attack: hold.attack, health: hold.health },
        { origin: 'cue', startAt: hold.at + RUBY_DELIVER_OFFSET_MS });
    }
  }, [run.rubyLandedFxSeq, run.rubyLandedFx, run.board]);

  /**
   * THE VEINSTORM SHOP-GEM HOLD — the offers show their PRE-Ruby stats, then roll up together ~200ms in, as
   * the single spanning volley lands. Its own effect (not folded into the cascade above) because it keys off
   * a different signal (`veinstormFxSeq`, not `rubyLandedFxSeq`) and reveals as a VOLLEY, not a cascade: every
   * gemmed offer releases at the same `SHOP_RUBY_DELIVER_MS`, no per-recipient `at`.
   *
   * The withheld amount is the EXACT Ruby value Veinstorm added this action, carried on the signal — uniform
   * across every gemmed offer, so each badge shows precisely its pre-Veinstorm number. (Deriving it from the
   * offer's Ruby buff would only be the average — off on an offer that already carried a Ruby before the cast.)
   * A `cue` hold outranks the intrinsic hold `Card` would place on the value change, so it supersedes the
   * instant roll (see `fx/statHold.ts`'s ranks). Own-seq guard, so it fires once per Veinstorm, not per action.
   */
  useLayoutEffect(() => {
    const seq = run.veinstormFxSeq;
    if (seq === undefined || seq === prevVeinstormHoldSeq.current) return;
    prevVeinstormHoldSeq.current = seq;
    const vf = run.veinstormFx;
    if (!vf) return;
    for (const uid of vf.uids) {
      holdStat(uid, { attack: vf.attack, health: vf.health }, { origin: 'cue', startAt: SHOP_RUBY_DELIVER_MS });
    }
  }, [run.veinstormFxSeq, run.veinstormFx]);

  /**
   * THE SHOP CUE RUNNER — what used to be ~35 lines of bespoke React per shop effect (diff a counter, wait a
   * frame, walk a cascade, measure each card, `playDef` a HARDCODED id) is now one loop over
   * `recruitMomentsSince`, with WHICH def plays coming from `bindings.json`.
   *
   * That is the point rather than the line saving: a shop effect is now re-bindable from the workbench, like
   * a combat one. Moments are still DERIVED from the counters the reducer already emits — see
   * `recruitMoments.ts` for why emission stays out of `reducer.ts` for now.
   */
  useEffect(() => {
    // MEASURED, not argued: "this body does not run on unrelated dispatches" is a claim about a count, so a
    // `?perf=1` capture reads `recruit:moment scan` against `recruit renders` (line ~643) and sees it directly.
    // Both are no-ops when the monitor is off. See docs/performance.md §5.
    perfMonitor.count('recruit:moment scan');
    const cur = runRef.current;
    const moments = recruitMomentsSince(cur, prevRecruitSeqs.current);
    captureRecruitSeqs(cur, prevRecruitSeqs.current);   // in place — no allocation on the per-action path
    if (moments.length === 0) return;
    perfMonitor.count('recruit:moment fired', moments.length);
    // The synchronous half of a real moment — binding lookup + cascade scheduling — on the clock, so
    // "a moment costs one `bindingFor` lookup more than the old code" is a hotspot line, not a belief.
    const stops = perfMonitor.measure('recruit:moment cues', () => moments.map((m) => runRecruitMomentCues(m, {
      // Read through the REF, not a captured `run`: a cascade outlives the action that started it, so a card
      // sold or tripled mid-sweep should resolve against the board as it is THEN, not as it was at dispatch.
      cardIdOf: (uid) => runRef.current.board.find((c) => c.uid === uid)?.cardId ?? null,
      measure: (uid) => {
        const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
        return el ? restingCenterOf(el) : null;
      },
      // The gem sound. On a board `rubyLanded` cascade this fires per gem, matching the sweep the eye sees;
      // on a `shopRubied` span the cue calls it ONCE, so the whole shop volley is a single gem sound.
      onLand: m.kind === 'rubyLanded' || m.kind === 'shopRubied' ? () => sfx.gemApply() : undefined,
    })));
    return () => { for (const stop of stops) stop(); };
    // ONLY the moment counters. Depending on `run` would re-run this on every dispatch — buy, sell, freeze,
    // refresh, drop — to discover it had nothing to do, which is strictly worse than the per-effect code it
    // replaced (that watched its own seq). The board is read through `runRef` instead, so it is not a dep.
    // `veinstormFxSeq` is here because Veinstorm now bumps ONLY it (its gemmed offers were pulled out of
    // `rubyLandedFx`), so without it the shop-gem span would never fire.
    // `shopBuffAllFxSeq` likewise: the run-wide shop buff has its own counter (diffed off `tavernBuyBonus`),
    // so without it here the shop-wide aura would never fire.
  }, [run.rubyLandedFxSeq, run.recruitFxSeq, run.veinstormFxSeq, run.shopBuffAllFxSeq]);
  // RUNE-BUFF-UNIT: any minion a rune buffed this SHOP action gets the `rune-buff-unit` sparkle, on the unit
  // (owner ask 2026-08-19). The sim diffs each minion's rune-buff total (`runeBuffFxUnits`), so this fires for
  // every rune that buffs a unit with no per-rune wiring. Measured on the next frame — a stat change re-renders
  // the card, so its box is only trustworthy after layout. Combat + End-of-Turn rune buffs ride their own paths.
  useEffect(() => {
    const uids = run.runeBuffFxUnits;
    if (!uids || uids.length === 0 || !canPlayDefs()) return;
    const raf = requestAnimationFrame(() => {
      const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
      for (const uid of uids) {
        const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
        const at = el ? restingCenterOf(el) : null;
        if (!at) continue; // minion left the DOM (sold/tripled) before paint
        playDef('rune-buff-unit', { target: at, camera }, { uids: { target: uid } });
      }
    });
    return () => cancelAnimationFrame(raf);
    // Only the seq — depending on the uid array would re-run on unrelated renders.
  }, [run.runeBuffFxSeq]);
  // Buff Gust — the TAVERN flourish for any shop-time Fodder/Imp buff (owner ask 2026-07-16 ×2:
  // Godfodder's buff pick, Imp Overseer, Maw's End of Turn, Ritualist, Staff of Guel, Rune of Consumption,
  // Bane, …): the violet rush sweeps in from the shop row's flanks, pushed toward the board ends by the
  // `edgeOut` dial. Anchored to the SHOP ROW always (the cue means "the tavern got buffed"), never fired
  // Fodder Infusion — "the unit is SENDING Fodder into the shop" (owner ask 2026-07-16): organic violet
  // tendrils reach from the queuing unit (Maw / Godfodder / Soulfeeder / Korok / Burial Imp) up to the
  // shop line, striking just BELOW the row (never wrapping the shop cards), each with a strike flash +
  // motes and one "sending" pulse at the source. Composed from the existing `pixiFx.buffTendril` ribbons —
  // `count` of them fanned across `spreadFrac` of the row's width, staggered, curves alternating sides.
  const fireFodderInfusion = useCallback((sourceUid: string): void => {
    const st = useGame.getState().run;
    if (!st || st.phase !== 'recruit') return;
    const srcEl = document.querySelector(`[data-uid="${sourceUid}"]`);
    if (!srcEl) return; // source already left the DOM (a consumed Burial Imp) — skip gracefully
    const sr = srcEl.getBoundingClientRect();
    const from = { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 };
    const rowRects = [...st.shop.map((o) => o.uid), ...(st.spell ? [st.spell.uid] : [])].flatMap((uid) => {
      const el = document.querySelector(`[data-uid="${uid}"]`);
      return el ? [el.getBoundingClientRect()] : [];
    });
    if (rowRects.length === 0) return;
    const left = Math.min(...rowRects.map((r) => r.left));
    const right = Math.max(...rowRects.map((r) => r.right));
    const bottom = Math.max(...rowRects.map((r) => r.bottom));
    const cfg = getInfuseFxConfig();
    const cx = (left + right) / 2;
    const span = (right - left) * cfg.spreadFrac;
    for (let i = 0; i < cfg.count; i++) {
      const f = cfg.count === 1 ? 0.5 : i / (cfg.count - 1); // 0..1 across the fan
      const to = { x: cx - span / 2 + span * f, y: bottom + cfg.endYOff };
      const launch = (): void => pixiFx.buffTendril(from, to, {
        blend: 'add',
        curve: cfg.curve * (i % 2 === 0 ? 1 : -1) * (1 + Math.floor(i / 2) * 0.35), // alternate + widen → the branch look
        wobbleAmp: cfg.wobbleAmp, wobbleFreq: cfg.wobbleFreq,
        travelMs: cfg.travelMs, retractMs: cfg.retractMs,
        baseWidth: cfg.baseWidth, tipWidth: cfg.tipWidth, coreAlpha: cfg.coreAlpha,
        glowWidth: cfg.glowWidth, glowAlpha: cfg.glowAlpha,
        flashSize: cfg.flashSize, flashMs: cfg.flashMs,
        moteCount: cfg.moteCount, moteSpeed: cfg.moteSpeed, moteLife: cfg.moteLife,
        // The "sending" pulse fires once, on the first tendril only (a triple-pulse reads as flicker).
        pulseSize: i === 0 ? cfg.pulseSize : 0, pulseAlpha: cfg.pulseAlpha, pulseMs: i === 0 ? cfg.pulseMs : 0,
        colorCore: cfg.colorCore, colorGlow: cfg.colorGlow, colorFlash: cfg.colorCore, colorMote: cfg.colorGlow,
      });
      if (i === 0 || cfg.staggerMs === 0) launch();
      else window.setTimeout(launch, i * cfg.staggerMs);
    }
  }, []);
  const prevFodderSendSeq = useRef(run.fodderSendSeq);
  useEffect(() => {
    const seq = run.fodderSendSeq;
    if (seq === undefined || seq === prevFodderSendSeq.current) return;
    prevFodderSendSeq.current = seq;
    const uid = run.fodderSendUid;
    if (!uid || run.phase !== 'recruit') return; // EoT stamps (Maw) land in combat — the beat fires those
    const raf = requestAnimationFrame(() => fireFodderInfusion(uid));
    return () => cancelAnimationFrame(raf);
  }, [run.fodderSendSeq, run.fodderSendUid, run.phase, fireFodderInfusion]);
  // WELD FX: an Attachment fusing onto a host — a ring eases in and converges on the card, then lands with
  // a flash + rising sparks, and the card wiggles ON the landing. For a HAND-PLAYED Magnetic the card's
  // slide-in has already finished by the time the sim dispatch lands, so the ring converges as it merges;
  // auto-welds (Banksly/Beatbot) just play at their own moment. EoT welds (Combinator / Cling / Money Bot)
  // stamp after the phase flips — those fire from the EoT BEAT instead (see playBeat).
  // NB: queries the DOM directly rather than via `findEl` — this lives ABOVE findEl's declaration, and a
  // `[findEl]` dep would read it in the temporal dead zone (crashes the screen on the first weld).
  //
  // BATCHED, and it has to stay that way: a single weld can land on up to a warband's worth of hosts at
  // once (golden Banksly + Beatbot mirrors + Cling Drones), and the naive shape — measure a card, animate
  // it, measure the next — interleaves a layout READ with a style WRITE per host, forcing a synchronous
  // reflow every iteration (`docs/performance.md`: cache the reads). So: measure ALL of them, then fire
  // ALL of them. One reflow per batch instead of N. `weldCfgFor` is hoisted for the same reason — it
  // rebuilds a 30-field object and is identical for every host in the batch.
  const fireWeldFxBatch = useCallback((uids: readonly string[], kind: 'play' | 'auto'): void => {
    if (uids.length === 0) return;
    // Timed as `fx:weldBatch` — the prime suspect for the Banksly/Beatbot weld-fanout hitch: N getBoundingClientRect
    // reads + N Pixi rings + N WAAPI wiggles in one frame. Cheap here → the fanout cost is React/Flip, not FX.
    perfMonitor.measure('fx:weldBatch', () => {
      const hosts: { el: Element; x: number; y: number }[] = [];
      for (const uid of uids) {
        const el = document.querySelector(`[data-zone="warband"] [data-uid="${uid}"]`);
        if (!el) continue;
        const r = (el.querySelector('.archbox') ?? el).getBoundingClientRect(); // READ pass — no writes yet
        hosts.push({ el, x: r.left + r.width / 2, y: r.top + r.height / 2 });
      }
      if (hosts.length === 0) return;
      const cfg = weldCfgFor(kind);
      const land = weldLandMs();
      for (const h of hosts) pixiFx.weldPulse(h.x, h.y, cfg); // WRITE pass
      applyWeldWiggle(hosts.map((h) => h.el), land); // the card reacts to the IMPACT, not the ring appearing
    });
  }, []);
  const prevWeldFxSeq = useRef(run.weldFxSeq);
  useEffect(() => {
    const seq = run.weldFxSeq;
    if (seq === undefined || seq === prevWeldFxSeq.current) return;
    prevWeldFxSeq.current = seq; // inits to the current value, so a restored save never re-fires
    const uids = run.weldFxUids;
    const kind = run.weldFxKind ?? 'auto';
    if (!uids?.length || run.phase !== 'recruit') return;
    // One weld can land on several minions (a Beatbot mirrors it onto itself) — animate every one.
    const raf = requestAnimationFrame(() => fireWeldFxBatch(uids, kind));
    return () => cancelAnimationFrame(raf);
  }, [run.weldFxSeq, run.phase, fireWeldFxBatch]);
  // Tavern-Fodder consume: a ghost Fred pops in the tavern and swirls into the eater Demon.
  // The ghost carries the Fodder's *effective* stats (attack/health) so a Ritualist-buffed
  // Fred shows e.g. 3/3, not the 1/1 base.
  const [fodderAnim, setFodderAnim] = useState<
    {
      key: number;
      ghosts: { fid: string; attack: number; health: number; x0: number; y0: number; w: number; h: number; eaterUid: string }[];
    } | null
  >(null);
  const prevFodderSeq = useRef(run.fodderEatenSeq);
  const prevShopEatSeq = useRef(run.shopEatenSeq); // Set 2's shop-minion consume — its own channel (see state.ts)
  const eotEatKey = useRef(1_000_000); // fodderAnim keys for EoT-beat eats — offset far above the seq-keyed watcher's range
  const prevEatFlashSeq = useRef(run.fodderEatenSeq); // the stat-diff flash's own eat tracker (suppresses the eaters' instant pop)
  const prevFxSeq = useRef(run.recruitFxSeq); // inits to current so it never fires on mount (a resumed save may carry a bumped seq)
  // The buffed minions an ale cast is visualizing this action, so the generic buff tendril is suppressed for
  // them (same rule as `rubyOwned` below). Keyed by `recruitFxSeq` so it only applies to that one action.
  const spellCastOwnedRef = useRef<{ seq: number; uids: Set<string> }>({ seq: -1, uids: new Set() });
  const prevAuraSeq = useRef(run.auraFxSeq ?? 0); // aura-wash FX watcher — same init-to-current contract
  // A brief "End of Turn" banner when the turn ends (recruit → combat), making it clear that
  // end-of-turn effects (Ritualist & co.) just resolved.
  const [endTurnFlash, setEndTurnFlash] = useState(false);
  // A one-shot flourish under a freshly-played minion whose Battlecry just fired.
  const [battlecryUids, setBattlecryUids] = useState<Set<string>>(new Set());
  // Per-uid clear timers for that flourish. In a ref, not the effect's cleanup, so a hold survives the next
  // board change — see the battlecry effect for what cancelling them cost.
  const bcTimersRef = useRef<Map<string, number>>(new Map());
  // Lazily seeded (perf audit 2026-08-06): `useRef(expr)` evaluates its argument on EVERY render and throws
  // it away after the first — two .map() arrays + two Sets per render, at drag frame rate. The null-guard
  // runs the construction exactly once, with the same first-render seed.
  const prevBoardUidsRef = useRef<Set<string> | null>(null);
  prevBoardUidsRef.current ??= new Set(run.board.map((c) => c.uid));
  // COALESCE watcher state. A card that appears in hand from nowhere gets the arcane materialise; see the
  // effect below for what's deliberately excluded (buys, gilds, Refrain bounces).
  const prevHandUidsRef = useRef<Set<string> | null>(null);
  prevHandUidsRef.current ??= new Set(run.hand.map((c) => c.uid));
  const prevTriplesRef = useRef<number>(run.triplesMade ?? 0);
  /* Set at the `buy` dispatch: a bought card was already visible in the tavern, so it is acquired rather
     than conjured. It gets its own shop→hand slide (`buySlide`) instead of the arcane coalesce, so this
     carries the release point the slide starts from (owner ruling 2026-07-22).

     It holds the HAND uid, resolved from the store right after the dispatch — NOT the shop uid that was
     dragged. A buy mints a fresh `b<n>` uid for the hand copy (`reducer.ts` `case 'buy'`), so matching on
     the shop uid never matched anything and every bought card still coalesced (owner report 2026-07-23).

     A uid rather than a bare flag, too: as a flag it discarded every fresh card in the commit, so anything
     a buy ALSO conjures in the same tick lost its coalesce — Dupes, Gorr's Four Peat, the Drakko and
     Chronos quest rewards, the Spellslinging gold drip. */
  const buyPendingRef = useRef<{ uid: string; from: BuyFrom } | null>(null);
  /* Set at a drag-drop that PLACES a minion on the board or REARRANGES one (board / hand / shop reorder).
     The dragged card is excluded from the settle FLIP (it appears at its committed slot with no glide — see
     `handFlipRef`'s `uid !== d.uid`), so it's ours to slide the last stretch home from where you released
     it, using the same `buySlide` motion a buy uses but 30% faster (owner call 2026-07-24). Carries the
     card's uid (kept across a play/reorder, unlike a buy which mints a new one), the row selector to find it
     in, and the release box. Buy + sell are deliberately NOT set here: buy has its own slide, sell removes
     the card. */
  const placePendingRef = useRef<{ uid: string; sel: string; from: BuyFrom } | null>(null);
  /* cardIds whose in-combat coalesce actually played (see the hand-grant watcher), so the settle-side
     coalesce suppresses exactly those and nothing else. Consumed one-per-card by the coalesce watcher as
     the grants land in the real hand, which happens at `settleCombat` on a win but not until
     `resolveCombat` on a loss — matching there rather than at the phase flip is what keeps both paths
     single-fire. On a SKIPPED replay nothing renders mid-fight, so this stays empty and those grants
     coalesce on arrival instead of losing their effect entirely. */
  const grantPlayedRef = useRef<string[]>([]);
  // How many hand-grant previews have already materialised (index into `handPreviews`).
  const grantsShownRef = useRef(0);
  /* cardIds an End-of-Turn BEAT has granted to hand so far, appended one beat at a time. `faceOmen` commits
     every End-of-Turn grant in a single dispatch after the LAST beat, so the whole batch used to appear at
     once, after every pulse had already fired. Showing the projection's per-beat grants (`EotStepFx.handGrants`)
     as the beats run puts each card's arrival on its own pulse (owner ask 2026-07-27); the real cards replace
     them at `faceOmen`, and `grantPlayedRef` keeps them from materialising twice. */
  const [eotGrants, setEotGrants] = useState<string[]>([]);
  // GAMBLE'S DIE (owner ask 2026-08-15): the spell plays the SAME tumble the Gambler's hero power does, at the
  // point you released it, and the card it won is WITHHELD from the hand until the final number lands. The pull
  // itself already resolved in the reducer (deterministic/replayable) — this is purely when you get to see it.
  const [gambleDie, setGambleDie] = useState<{ n: number; settled: boolean; x: number; y: number } | null>(null);
  const [gambleHold, setGambleHold] = useState<string | null>(null);
  const pointerRef = useRef({ x: 0, y: 0 });
  useEffect(() => {
    const onMove = (e: PointerEvent): void => { pointerRef.current = { x: e.clientX, y: e.clientY }; };
    window.addEventListener('pointermove', onMove, { passive: true });
    window.addEventListener('pointerdown', onMove, { passive: true });
    return () => { window.removeEventListener('pointermove', onMove); window.removeEventListener('pointerdown', onMove); };
  }, []);
  const prevGambleSeq = useRef(run.gambleRoll?.seq);
  useEffect(() => {
    const seq = run.gambleRoll?.seq;
    const prev = prevGambleSeq.current;
    prevGambleSeq.current = seq;
    if (!seq || seq === prev) return;
    const tier = run.gambleRoll!.tier;
    const { x, y } = pointerRef.current;               // where the spell was released
    if (run.gambleWonUid) setGambleHold(run.gambleWonUid); // hold the prize back until the die lands
    let tick = 0;
    let settle = 0;
    // The Gambler's exact cadence: 11 ticks x 55ms, then the landed face holds ~1.1s.
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= 11) {
        window.clearInterval(id);
        setGambleDie({ n: tier, settled: true, x, y });
        setGambleHold(null);                            // the number has landed — award the card NOW
        settle = window.setTimeout(() => setGambleDie(null), 1100);
      } else {
        setGambleDie({ n: (tick % 6) + 1, settled: false, x, y });
      }
    }, 55);
    return () => { window.clearInterval(id); window.clearTimeout(settle); setGambleHold(null); };
  }, [run.gambleRoll?.seq, run.gambleRoll?.tier, run.gambleWonUid]);
  const gambleHand = gambleHold ? run.hand.filter((c) => c.uid !== gambleHold) : run.hand;
  // Minions summoned to the BOARD during End-of-Turn playback (Moira re-firing a summoner) — injected into the
  // rendered board on their beat so they arrive in real time, replaced by the real cards at commit (same uid).
  const [eotSummons, setEotSummons] = useState<{ uid: string; cardId: string; index?: number }[]>([]);
  // Keywords gained on board minions during End-of-Turn playback — overlaid so the pip shows on the beat.
  const [eotKeywords, setEotKeywords] = useState<ReadonlyMap<string, ReadonlySet<string>>>(EMPTY_KW);
  // uid -> the card it BECAME this End of Turn (Skybound Ascendant's tier-up), so the swap renders on the beat.
  const [eotTransforms, setEotTransforms] = useState<ReadonlyMap<string, string>>(EMPTY_TRANSFORMS);
  // The same flourish under minions whose End-of-Turn effect just procced (as the turn ends).
  const [eotProcUids, setEotProcUids] = useState<Set<string>>(new Set());
  // Subset of eotProcUids whose effect OFFICIALLY fired this beat (cadence paid off / non-cadence EOT) —
  // these pulse the medallion (ring); progress-only ticks (in eotProcUids but not here) just glow.
  const [eotPulseUids, setEotPulseUids] = useState<Set<string>>(new Set());
  const discoverBurstRef = useRef<HTMLDivElement>(null); // mount point for the discover burst FX layer
  // Tokens summoned by a battlecry this play — their card mount-pop is held ~0.2s so the trigger pulse
  // reads first, THEN the token appears (e.g. Alleycat's pulse → Stray pops in just after).
  const [summonDelayUids, setSummonDelayUids] = useState<Set<string>>(new Set());
  // Loss-damage sequence: on a defeat, surviving enemy tiers + the opponent's tier fly up into a damage
  // counter above the enemy board, then a Pixi bolt blasts it into the Resolve bar (which drops on impact).
  const [lossPhase, setLossPhase] = useState<null | 'tally' | 'blast' | 'done'>(null);
  const [lossCount, setLossCount] = useState(0);   // the damage tally as it climbs
  const [lossDmg, setLossDmg] = useState(0);       // final (capped) damage
  const [lossCapped, setLossCapped] = useState(false); // raw total exceeded the round cap
  const [lossPos, setLossPos] = useState<{ x: number; y: number } | null>(null); // counter screen pos
  const [lossFlyers, setLossFlyers] = useState<{ id: number; tier: number; x: number; y: number; tx: number; ty: number; delay: number; isOpp?: boolean }[]>([]);
  const [lossShake, setLossShake] = useState(false); // screen shake on the blast impact
  const lossSeqRef = useRef(false);
  /** The post-combat hero-strike sequence's timers. Held in a REF, not in the effect's closure, because the
   *  effect's deps (`replay.frame`) keep changing after the replay ends — a cleanup tied to those deps tore the
   *  in-flight strike down mid-swing (measured: the pill appeared, then died ~1s early and the blow never
   *  landed). `lossSeqRef` already guarantees the sequence starts once; these are cleared when combat actually
   *  ends, and on unmount. */
  const seqTimersRef = useRef<number[]>([]);
  /** Monotonic strike counter — keys the red damage-taken number so it remounts + replays its pop each swing. */
  const lossSeqSeqRef = useRef(0);                // guards single-run per combat
  const endTurnPendingRef = useRef(false); // the end-of-turn beat sequence is playing before combat
  /** +padding between the LAST End-of-Turn beat and the combat curtain (owner ask 2026-08-29) — the final
   *  proc gets a breath before the blue sweeps. Turns with NO beats skip it (their fast paths dispatch
   *  immediately, so an empty turn still cuts straight to the curtain). */
  const EOT_COMBAT_PAD_MS = 500;
  const eotPadFiredRef = useRef(false); // once-guard: the unmount safety net's finish() must not double-schedule
  // CHOREOGRAPHER PR 4: cancels the authoritative player's rAF loop and force-commits, so unmounting
  // mid-animation can never strand a prepared transaction with End Turn locked.
  const eotCancelRef = useRef<null | (() => void)>(null);
  // Fodder-eat choreography raised from End-of-Turn beats: a monotonic key per play, and the cancel fns so
  // an unmount mid-animation cannot strand a running crumble.
  const eotFodderSeqRef = useRef(0);
  const eotFodderCleanupRef = useRef<(() => void)[]>([]);
  // If the recruit screen goes away while the authoritative timeline is playing, stop the loop and DELIVER
  // the rest — which commits the prepared action. The blueprint's rule is that failure or skip must never
  // softlock End Turn (§5.6); because the state was already resolved, finishing early lands exactly the same
  // run as watching it play out.
  useEffect(() => () => {
    eotCancelRef.current?.();
    eotCancelRef.current = null;
    for (const stop of eotFodderCleanupRef.current) stop();
    eotFodderCleanupRef.current = [];
  }, []);
  // During the End-of-Turn animation, the per-proc stats to *show* on each minion (uid → live stats),
  // so the board's numbers climb one proc at a time. Null outside the animation (show the real stats).
  const [eotAnimStats, setEotAnimStats] = useState<Record<string, { attack: number; health: number }> | null>(null);
  // During the same animation, the running SHOP-offer buff delta per offer uid — so a shop minion buffed by an
  // End-of-Turn effect (Moira re-firing Market Tormentor / Contract Butcher) shows its stats climb in real time
  // on the beat, not jump only after the phase commits (owner ask 2026-08-12). Null outside the animation.
  const [eotShopStats, setEotShopStats] = useState<Record<string, { attack: number; health: number }> | null>(null);
  // Shop offers CONSUMED during the End-of-Turn animation (Bob Blart's Consume) — hidden from the row on the
  // eater's beat so they visibly leave in real time, instead of snapping out only at commit (owner report
  // 2026-08-14). Cleared when the animation completes; the committed state has already removed them by then.
  const [eotConsumedUids, setEotConsumedUids] = useState<ReadonlySet<string>>(new Set());
  // A consumed SHOP minion's slot is HELD OPEN (an invisible placeholder) until its ghost has been pulled into
  // the eater, so the survivors reflow AFTER the card leaves rather than the instant the consume commits (owner
  // ask 2026-08-17). `heldConsume` is the eaten uids + their pre-removal slot index; `heldConsumeSeq` gates the
  // derive-during-render that seeds it from `run.shopEaten`. Declared here (not by the shop row below) because
  // `displayShop` reads it. The paired `shopRectsRef` snapshot (whose `cur` still holds the pre-removal layout
  // while the slot is held) supplies the index + the ghost's launch rect.
  const [heldConsume, setHeldConsume] = useState<{ uid: string; index: number }[]>([]);
  const [heldConsumeSeq, setHeldConsumeSeq] = useState(run.shopEatenSeq);
  // Double-buffered snapshot of each shop card's centre + size, keyed by uid. A consumed shop minion is spliced
  // from `run.shop` (and the DOM) in the SAME commit that fires its eat cue, so by the time `playFodderEat` runs
  // the card is gone and its slot can't be measured — which is why the ghost used to spawn at the row centre.
  // Layout effects run BEFORE passive effects, so on the consume commit this swaps `cur`→`prev` (capturing the
  // pre-removal layout) BEFORE the seq-watcher (a passive effect) reads it to find the eaten card's real slot.
  // While the slot is HELD (flipKey unchanged), this effect does not run, so `cur` still holds the pre-removal
  // layout — the launch read below falls back to `cur` for exactly that case.
  const shopRectsRef = useRef<{ prev: Map<string, { cx: number; cy: number; w: number; h: number }>; cur: Map<string, { cx: number; cy: number; w: number; h: number }> }>({ prev: new Map(), cur: new Map() });
  // During the same animation, the PROJECTED cadence tick per uid (eotTick + 1) so a cadence counter
  // (Money Maker / Frontdrake) visibly ticks up on its beat — the reducer only commits eotTick in faceOmen
  // (after the beats), so without this the counter would jump a turn late. Null outside the animation.
  const [eotAnimTick, setEotAnimTick] = useState<Record<string, number> | null>(null);
  // Dragons Karwind just flame-buffed (keyed off run.karwindFlashSeq) — a one-shot flame flash.
  const [karwindFlameUids, setKarwindFlameUids] = useState<Set<string>>(new Set());
  // The flame's clear timer, held in a ref so a dispatch can't cancel it — see the Karwind effect.
  const karwindTimerRef = useRef<number | undefined>(undefined);
  const prevKarwindSeq = useRef(run.karwindFlashSeq);
  // A trigger-medallion pulse on the BUFFER (Karwind) when its effect fires. A bound source's flame flash is
  // suppressed in favour of its authored ring on the buffed Dragons — but the buffer itself then had no
  // on-card cue that it triggered, so its medallion pulses instead (owner ask 2026-08-11). Own set + ref so
  // it only touches `pulse`, never the battlecry sigil, and clears independently of the flame.
  const [karwindPulseUids, setKarwindPulseUids] = useState<Set<string>>(new Set());
  // The subset of the above whose proc was a CRIT (Karwind's 20% double): their medallion pulses RED instead
  // of white. Split from `karwindPulseUids` so a card is in exactly one, and cleared by the same timer.
  const [karwindCritPulseUids, setKarwindCritPulseUids] = useState<Set<string>>(new Set());
  const karwindPulseTimerRef = useRef<number | undefined>(undefined);
  // A purple wash over the whole shop when Ritualist's End-of-Turn buffs the Fodder there.
  // Mechs being electrified as Combinator magnetizes Cling Drones onto them (End of Turn).
  const [electrifyUids, setElectrifyUids] = useState<Set<string>>(new Set());

  // --- In-place combat. Instead of swapping to a separate arena screen, the fight
  // plays out on this same board: the shop "closes" (the tavern offers, controls,
  // timer, rope and hand animate away), then the enemy team "arrives" where the
  // tavern was — the warband, hero frame, HUD (ASCENT/wave/tribes/mute) never move.
  // `combatStage` sequences the intro (close → fight); the replay engine runs once
  // the enemies have arrived. After the fight, the warband plays a reset animation. ---
  const inCombat = run.phase === 'combat';
  // END-TURN SOFT LOCK (owner ask 2026-07-27). For the first few seconds of a recruit round the End Turn
  // button is inert, so the second half of a double-click that ended the LAST round can't immediately end the
  // new one. Keyed on the wave so it re-arms every round, and only while the shop is up — in combat the button
  // is the "end combat" control and gating it would strand the player.
  const [roundSettled, setRoundSettled] = useState(false);
  useEffect(() => {
    if (inCombat) { setRoundSettled(true); return; }
    setRoundSettled(false);
    const t = window.setTimeout(() => setRoundSettled(true), END_TURN_LOCK_MS);
    return () => window.clearTimeout(t);
  }, [run.wave, inCombat]);
  const [combatStage, setCombatStage] = useState<'closing' | 'fighting'>('closing');
  const fighting = inCombat && combatStage === 'fighting';
  // BOARD WIPE — a TWO-STAGE full-scene CURTAIN (owner ask 2026-08-28). The first version clipped only the
  // background layer, so everything the phase flip animates (the lobby rail sliding away, the opponent
  // portrait dropping in, the shop closing) played in plain view WHILE the wipe swept — the owner asked for
  // the wipe to swallow those instead. So the curtain (`.wipecurtain`, the boot splash's dark-blue gradient,
  // z ABOVE the whole in-app scene, below the Pixi FX canvas) BLOOMS RADIALLY out of the End Turn gem over
  // EVERYTHING (owner ask 2026-08-29 — the gem as a portal), holds a beat at full blue while the scene
  // settles underneath (and the combat backdrop snaps in, no clip animation of its own any more), then a
  // LINEAR sweep carries the reveal (entry R→L, exit L→R — the hybrid, owner ask 2026-08-29). Leaving
  // combat runs the same choreography (bloom from the End Combat gem → swap back → linear reveal). Sweeps
  // advance on the curtain's clip-path transitionend (+ a backstop timer); holds advance on their own timer.
  // A run RESUMED mid-combat initialises straight to 'combat' (curtain parked, combat backdrop shown).
  // HYBRID geometry (owner ask 2026-08-29): COVERS are radial blooms out of the gem; REVEALS are the
  // linear sweeps (entry reveal R→L, exit reveal L→R). circle() and inset() can't interpolate, but no
  // transition ever crosses shapes: the circle→inset switch happens during the fully-covered hold
  // (`.full.settle`, transition:none — both values are full cover, so the swap is invisible), and the
  // inset→circle switch happens between empty parked states (both cover nothing). The one wrinkle is the
  // EXIT bloom: it must START from the zero circle, but combat parks the curtain on the reveal's inset
  // sliver — so `primeOut` snaps it to the zero circle for one frame before `coverOut` launches.
  // `chargeIn` is the ENTRY's anticipation beat (owner ask 2026-08-29, the gem "charge-up tell"): the
  // curtain stays parked while wipeFx spirals motes into the gem, then the bloom erupts. The EXIT reuses
  // `primeOut` for the same tell — it already parks the zero circle, so it just holds for the charge
  // duration instead of one frame.
  type WipeState = 'idle' | 'chargeIn' | 'coverIn' | 'coveredIn' | 'revealIn' | 'combat' | 'primeOut' | 'coverOut' | 'coveredOut' | 'revealOut';
  const [wipe, setWipe] = useState<WipeState>(() => (run.phase === 'combat' ? 'combat' : 'idle'));
  // Per-STAGE sweep duration + the full-blue hold between stages — single source: the CSS var below is set
  // FROM WIPE_MS, and the backstop timer derives from it (+150ms margin), so retuning here can never strand
  // the state machine mid-sweep.
  const WIPE_MS = 450;
  // ENTRY holds long enough to read the NOW FACING announcement on the blue; EXIT has no announcement and
  // stays snappy.
  const WIPE_HOLD_IN_MS = 900;
  const WIPE_HOLD_OUT_MS = 700;
  // The gem tell's length (both directions) — long enough to read as anticipation, short enough not to lag
  // the transition.
  const WIPE_CHARGE_MS = 260;
  const wipeSweeping = wipe === 'coverIn' || wipe === 'revealIn' || wipe === 'coverOut' || wipe === 'revealOut';
  const wipeExiting = wipe === 'primeOut' || wipe === 'coverOut' || wipe === 'coveredOut' || wipe === 'revealOut';
  // GEM ORIGIN — measured ONCE at the start of each cover sweep (a one-shot layout read, not per-frame;
  // see CLAUDE.md perf rules), then handed to the CSS as `--wipe-cx/--wipe-cy/--wipe-r`. The radius is the
  // distance to the farthest viewport corner, so `.full` provably covers the whole screen from any anchor.
  // The gem element (`.etb-gembox` inside `.etbwrap`) is the same control in both directions — End Turn on
  // entry, End Combat on exit — so both blooms erupt from the same diamond.
  const [wipeOrigin, setWipeOrigin] = useState<{ cx: number; cy: number; r: number } | null>(null);
  const wipeOriginRef = useRef<{ cx: number; cy: number; r: number } | null>(null);
  useLayoutEffect(() => {
    // Both tells precede their bloom, so measuring here commits the vars (and the ref the FX reads)
    // before `coverIn`/`coverOut` launches.
    if (wipe !== 'chargeIn' && wipe !== 'primeOut') return;
    const vw = window.innerWidth, vh = window.innerHeight;
    let cx = vw * 0.84, cy = vh * 0.62; // fallback ≈ where the gem sits on the stage
    const gem = document.querySelector('.etbwrap .etb-gembox') ?? document.querySelector('.etbwrap');
    if (gem) {
      const b = gem.getBoundingClientRect();
      cx = b.left + b.width / 2; cy = b.top + b.height / 2;
    }
    const r = Math.ceil(Math.hypot(Math.max(cx, vw - cx), Math.max(cy, vh - cy)));
    wipeOriginRef.current = { cx, cy, r };
    setWipeOrigin({ cx, cy, r });
  }, [wipe]);
  // WIPE FX — the above-curtain Pixi layer (see wipeFx.ts). Warmed once on mount so the async Pixi init
  // is long done before the first combat; each state fires its one-shot as it begins. A decisive combat
  // snaps the machine to 'idle' — clear() kills any in-flight motes so nothing drifts over the end screen.
  useEffect(() => {
    wipeFx.warm();
    // Warm the exit splash's shop vignette too (the foe face is boot-loaded by the title screen; this one
    // has no other loader, and a first-exit pop-in on the blue would read as a blip).
    new Image().src = `${import.meta.env.BASE_URL}return-to-shop.webp`;
  }, []);
  useEffect(() => {
    const o = wipeOriginRef.current;
    if (wipe === 'idle') { wipeFx.clear(); return; }
    if (!o) return;
    if (wipe === 'chargeIn' || wipe === 'primeOut') wipeFx.charge(o.cx, o.cy, WIPE_CHARGE_MS + 80);
    else if (wipe === 'coverIn') wipeFx.bloom(o.cx, o.cy, o.r, WIPE_MS);
    else if (wipe === 'coverOut') { wipeFx.bloom(o.cx, o.cy, o.r, WIPE_MS); wipeFx.inhale(o.cx, o.cy, o.r, WIPE_MS + 200); }
  }, [wipe]);
  const wipeVars = {
    '--wipe-dur': `${WIPE_MS}ms`,
    ...(wipeOrigin ? { '--wipe-cx': `${wipeOrigin.cx}px`, '--wipe-cy': `${wipeOrigin.cy}px`, '--wipe-r': `${wipeOrigin.r}px` } : {}),
  } as CSSProperties;
  const wipeTimeoutRef = useRef<number | undefined>(undefined);
  const advanceWipe = useCallback((): void => {
    setWipe((w) => (w === 'coverIn' ? 'coveredIn' : w === 'revealIn' ? 'combat' : w === 'coverOut' ? 'coveredOut' : w === 'revealOut' ? 'idle' : w));
  }, []);
  // Hold timers (the beat at full blue) + the sweep backstop live in one effect keyed on the state.
  useEffect(() => {
    if (wipe === 'coveredIn' || wipe === 'coveredOut') {
      const t = window.setTimeout(() => setWipe(wipe === 'coveredIn' ? 'revealIn' : 'revealOut'), wipe === 'coveredIn' ? WIPE_HOLD_IN_MS : WIPE_HOLD_OUT_MS);
      return () => window.clearTimeout(t);
    }
    // The tell beats: the zero-circle park is committed by this render; the charge FX plays on the gem,
    // then the bloom launches (a timer, not rAF, so a background tab can't stall the machine).
    if (wipe === 'chargeIn' || wipe === 'primeOut') {
      const t = window.setTimeout(() => setWipe(wipe === 'chargeIn' ? 'coverIn' : 'coverOut'), WIPE_CHARGE_MS);
      return () => window.clearTimeout(t);
    }
    if (!wipeSweeping) return undefined;
    wipeTimeoutRef.current = window.setTimeout(advanceWipe, WIPE_MS + 400);
    return () => window.clearTimeout(wipeTimeoutRef.current);
  }, [wipe, wipeSweeping, advanceWipe]);
  useEffect(() => {
    // A DECISIVE combat exits to the END SCREEN (gameover/victory), not the shop — no curtain, no
    // "returning to shop" announcement (owner ask 2026-08-28). Snap the machine home; the end screen
    // covers the scene itself.
    if (!inCombat && run.phase !== 'recruit') { setWipe('idle'); return; }
    if (inCombat) setWipe((w) => (w === 'idle' || w === 'primeOut' || w === 'coverOut' || w === 'coveredOut' || w === 'revealOut' ? 'chargeIn' : w));
    else setWipe((w) => (w === 'combat' || w === 'chargeIn' || w === 'coverIn' || w === 'coveredIn' || w === 'revealIn' ? 'primeOut' : w));
    // (The wipe once fired a Pixi streak def here — retired 2026-08-28 when the curtain moved ABOVE the FX
    // canvas so it sweeps over scene FX like the End-Turn gem smoke; a def on that canvas would play
    // invisibly behind the blue. The CSS `.wipefront` glow carries the front's look. The `board-wipe` def
    // stays committed in the workbench for a future dedicated above-curtain layer.)
  }, [inCombat]);
  // What each element wears per state. Covers wear `full` (the bloom, circle geometry); the holds wear
  // `full settle` (which ALSO swaps the clip to the full-cover inset, transition:none — the invisible
  // shape change that lets the reveal run linear); `gone` is the entry reveal's R→L retreat (parked
  // through combat), `gone rtl` the exit reveal's L→R retreat; base and `primeOut` park on the zero
  // circle, ready for the next bloom.
  const curtainClass = `wipecurtain${
    wipe === 'coveredIn' || wipe === 'coveredOut' ? ' full settle'
    : wipe === 'coverIn' || wipe === 'coverOut' ? ' full'
    : wipe === 'revealIn' || wipe === 'combat' ? ' gone'
    : wipe === 'revealOut' ? ' gone rtl' : ''
  }${wipeExiting ? ' exit' : ''}`;
  const combatBgShown = wipe === 'coveredIn' || wipe === 'revealIn' || wipe === 'combat' || wipe === 'primeOut' || wipe === 'coverOut';
  // COMBAT UNITS render on the staged window too (owner ask 2026-08-29): the warband's recruit-cards→Unit
  // swap and the enemy row's arrival both happen while the curtain fully hides the board, so the entry
  // reveal exposes BOTH armies already standing (they hold ~300ms before the first attack — see the
  // combatStage settle), and the shop cards stay untouched in view while the entry cover sweeps.
  const combatUnitsShown = inCombat && combatBgShown;
  // Publish the staged window so components OUTSIDE this file (the foe portrait, a portal) can key their
  // combat entrance/exit on "the curtain is hiding me" instead of the raw phase — see store.combatStaged.
  // The same window drives the `.app.staged` class (the lobby rail's slide-away) below.
  const setCombatStaged = useGame((s) => s.setCombatStaged);
  useEffect(() => { setCombatStaged(combatBgShown); }, [combatBgShown, setCombatStaged]);
  // SHOP OVERLAYS WAIT FOR THE CURTAIN (owner ask 2026-08-28) — the Runeforge / quest / power / Discover /
  // Choose One / scout offers exist in run state the instant combat resolves, but their overlays must not
  // open over the exit curtain: hold their RENDER (state is untouched — the shop timer's pause already keys
  // on the offers' existence, so nothing ticks while held) until the reveal sweep finishes, the same way
  // the start-of-combat beat waits for the entry reveal.
  const overlaysHeld = !inCombat && wipe !== 'idle';
  const onWipeEnd = useCallback((e: ReactTransitionEvent<HTMLDivElement>): void => {
    if (e.propertyName !== 'clip-path') return;
    window.clearTimeout(wipeTimeoutRef.current);
    advanceWipe();
  }, [advanceWipe]);
  // End-Combat crossfade: 'out' fades every combat unit + FX canvas away together, then the phase swaps and
  // 'in' fades the recruit board + survivors back together — one synchronized two-beat transition (see the CSS
  // `.app.combatout`/`.combatin`), so nothing snaps or staggers when you leave the arena.
  // RETIRED as End Combat's exit (owner ask 2026-08-29 — the curtain covers the leave; see `endCombat`).
  // The `.combatout`/`.combatin` classes live on, driven only by `skipFade` (Skip stays in combat and still
  // crossfades). Kept as a const so the className derivation below reads unchanged.
  const combatOutro: null | 'out' | 'in' = null;
  // Skip-combat uses the SAME crossfade (everything fades out together), but instead of swapping to the shop it
  // freezes the replay, kills all audio, jumps to the resolved board under cover of opacity 0, then fades that
  // final board back in. A replacement one-shot will play in its place later (owner).
  const [skipFade, setSkipFade] = useState<null | 'out' | 'in'>(null);
  const [showLog, setShowLog] = useState(false); // the post-combat Combat Summary overlay
  // DEFERRED odds (perf audit 2026-08-01, owner call): faceOmen no longer runs the 200-sim probe on the End
  // Turn click — it stashes `lastCombat.oddsInput` and this effect runs the probe in idle time once the
  // combat is mounted. Keyed on the lastCombat OBJECT (a new fight is a new object), and it also covers a
  // resumed mid-combat run (oddsInput is serialized with the save). Legacy saves with baked odds short-cut.
  const [combatOdds, setCombatOdds] = useState<CombatOdds | null>(null);
  useEffect(() => {
    const lc = run.lastCombat;
    setCombatOdds(lc?.odds ?? null); // legacy pre-deferral saves carry odds inline
    if (!lc?.oddsInput || lc.odds) return;
    const input = lc.oddsInput;
    let cancelled = false;
    const compute = (): void => {
      if (cancelled) return;
      const odds = perfMonitor.measure('odds:deferred', () => computeCombatOdds(input, run.seed, run.wave));
      if (!cancelled) setCombatOdds(odds);
    };
    // rIC waits for a quiet frame during the combat intro; the timeout stops a busy replay starving it.
    let idleId = 0; let timerId = 0;
    if (typeof requestIdleCallback === 'function') idleId = requestIdleCallback(compute, { timeout: 1500 });
    else timerId = window.setTimeout(compute, 250);
    return () => {
      cancelled = true;
      if (idleId && typeof cancelIdleCallback === 'function') cancelIdleCallback(idleId);
      if (timerId) window.clearTimeout(timerId);
    };
  }, [run.lastCombat, run.seed, run.wave]);
  const [discoverMin, setDiscoverMin] = useState(false); // B2: the Discover overlay is minimized (inspect the board)
  const [questMin, setQuestMin] = useState(false); // the Quest overlay is minimized (inspect the shop rolled behind it)
  const [forgeMin, setForgeMin] = useState(false);

  /**
   * RUNE LOCK-IN CEREMONY (owner ask 2026-08-29) — the short flourish after a rune is bought.
   *
   * Held HERE rather than inside the forge overlay because the overlay is exactly what disappears: buying
   * clears `runeforgeOffer`, so anything owned by that subtree unmounts with it. This state outlives the
   * forge, which is what lets the ceremony play after the thing it is about is gone.
   */
  const [lockIn, setLockIn] = useState<RuneLockInCard[] | null>(null);
  /** See the store field: set only by `replayPlayer`, never by live play. */
  const runeLockInCue = useGame((st) => st.runeLockInCue);
  /** Dev-only slow-motion for the demo — the real ceremony always plays at its authored speed. */
  const [lockInSlow, setLockInSlow] = useState(1);
  /**
   * DEV handle so the ceremony can be replayed without reaching a rune wave — the same shape as
   * `window.__perfHud` / `window.__pixiFx`. Tuning a 1.4s sequence by playing to the Runeforge each time is
   * the kind of friction that means it never gets tuned.
   */
  const lockInDemoRef = useRef<((slow?: number) => void) | null>(null);
  const startRuneLockIn = useCallback((el: HTMLElement | null, chosenIndex: number): void => {
    const run = useGame.getState().run;
    if (!el || !run.runeforgeOffer) return;
    // Measure EVERY card once, now — the row is about to stop existing. Shared with the REPLAY path
    // (`captureRuneLockIn`) so a replayed ceremony is measured exactly as a live one is; two copies of this
    // would drift, and the drift would show as the cards jumping on the ceremony's first frame.
    const cards = captureRuneLockIn(run.runeforgeOffer, run.runeforgeDiscounts, chosenIndex, el);
    if (cards) { setLockInSlow(1); setLockIn(cards); }
  }, []);

  // Publish the demo: three real runes laid out where the forge puts them, middle one chosen.
  useEffect(() => {
    lockInDemoRef.current = (slow = 1): void => {
      const ids = Object.keys(RUNE_INDEX).slice(0, 3);
      // RuneCard's own natural size, so the preview is laid out like the real forge row rather than at an
      // invented size. Measured from a live card; the real ceremony never guesses — it reads each card's rect.
      const w = 159;
      const h = 257;
      const gap = 28;
      const x0 = window.innerWidth / 2 - (w * 3 + gap * 2) / 2;
      const y = window.innerHeight / 2 - h / 2;
      const cards = ids.map((id, i) => ({
        rune: RUNE_INDEX[id]!,
        cost: RUNE_INDEX[id]!.cost,
        rect: { x: x0 + i * (w + gap), y, w, h },
        // The LEFT card, not the middle one. The middle card of a centred row is already AT the screen centre,
        // so choosing it makes the travel delta zero — the preview showed the grow and the clamp and hid the
        // one thing the ceremony is mostly about. An off-centre pick exercises the real path.
        chosen: i === 0,
      }));
      setLockInSlow(Math.max(1, slow));
      setLockIn(cards);
    };
    const win = window as unknown as { __runeLockIn?: (slow?: number) => void };
    win.__runeLockIn = (slow) => lockInDemoRef.current?.(slow);
    return () => { delete (window as unknown as { __runeLockIn?: (slow?: number) => void }).__runeLockIn; };
  }, []); // the Runeforge overlay is minimized (inspect the board behind it)
  const [logTab, setLogTab] = useState<'gains' | 'procs' | 'log'>('gains'); // Permanent gains · Procs · blow-by-blow log
  // Per-card stat snapshot (attack + health) for the recruit-phase buff flash (declared up here so the
  // combat→recruit transition can re-sync it and avoid a spurious flash on the way back in).
  const prevStatsRef = useRef<Map<string, { a: number; h: number }>>(new Map());
  const prevPhaseRef = useRef(run.phase);
  // Gold floats at the spot a minion was sold (the actual sell value) — fixed-screen, auto-cleared.
  const [sellFloats, setSellFloats] = useState<{ id: number; x: number; y: number; amount: number }[]>([]);
  const sellFloatId = useRef(0);
  // True on the single render where we flip combat → recruit (prevPhaseRef is updated later, in the
  // layout effect). The warband cards mount on exactly this render, so passing it as `suppressPop`
  // makes them skip the mount-pop (no jiggle) while cards played later still pop normally.
  const returningFromCombat = prevPhaseRef.current === 'combat' && run.phase === 'recruit';
  const findEl = useCallback(
    (uid: string): Element | null =>
      document.querySelector(
        `[data-zone="warband"] [data-uid="${uid}"], [data-zone="tavern"] [data-uid="${uid}"]`,
      ),
    [],
  );
  /** Echoes already played by the LEAD below — skipped when their batch arrives, so one Echo is one burst. */
  const preFiredEchoRef = useRef<Set<string>>(new Set());
  /** Set when a death cue fires, consumed by the commit FLIP below: the survivors hold before sliding
   *  into the dead minion's slot, so the death reads before the board rearranges (owner 2026-08-28). */
  const shiftHoldRef = useRef(0);

  /**
   * THE SHOP'S TWO-STEP DEATH — the landing half (owner design 2026-08-28: "the minion should be coded to
   * literally land as if it was played, but then the immediate next action is that it is destroyed").
   *
   * The reducer LANDS the body and stops, leaving `pendingDeath`. The board therefore really holds it, and it
   * renders through the ordinary arrival path — no projection, no held state, nothing special. This effect is
   * the pause: it lets that landing sit on screen for one beat, then dispatches the death.
   *
   * Deliberately dumb and unskippable-safe: the reducer settles the same pending death on ANY next action, so
   * if this timer is cut short by a click, a route change, or an unmount, the outcome is identical — the
   * player just does not see the pause. That is what keeps a real intermediate game state safe.
   */
  const pendingDeathUid = run.pendingDeath?.uid;
  useEffect(() => {
    if (!pendingDeathUid) return;
    const cfg = getShopDeathFxConfig();
    const ms = Math.max(0, cfg.landingMs);
    // THE ECHO LEAD (owner 2026-08-28: "trigger slightly earlier"). A negative `echoDelayMs` fires the skull
    // BEFORE the destruction, while the body is still on the board — so the departure lands INTO the burst
    // instead of following it. This is the only place a lead can happen: once the death commits, the moment
    // has passed. The uid is recorded so the cue effect does not fire the same Echo again a beat later.
    const lead = Math.min(ms, Math.max(0, -cfg.echoDelayMs));
    const timers: number[] = [];
    if (lead > 0 && cfg.echoEnabled) {
      timers.push(window.setTimeout(() => {
        const el = findEl(pendingDeathUid);
        if (!el) return; // gone early (an interrupting action settled the death) — the cue effect covers it
        const r = el.getBoundingClientRect();
        preFiredEchoRef.current.add(pendingDeathUid);
        pixiFx.deathrattle(r.left + r.width / 2 + cfg.offsetX, r.top + r.height / 2 + cfg.offsetY, r.width * cfg.sizeScale);
      }, ms - lead));
    }
    if (ms <= 0) { dispatch({ type: 'resolveShopDeath' }); return () => timers.forEach(window.clearTimeout); }
    timers.push(window.setTimeout(() => dispatch({ type: 'resolveShopDeath' }), ms));
    return () => timers.forEach(window.clearTimeout);
  }, [pendingDeathUid, dispatch, findEl]);

  /**
   * EQUIP / RE-EQUIP CUES (owner handoff 2026-08-28) — a body granting its Equipment.
   *
   * Rides the per-action scratch channel every other shop FX uses, NOT a beat: only End of Turn plays beats,
   * so a Start-of-Turn re-equip beat would be recorded and never performed (owner decision, after that gap was
   * found). One cue per SOURCE BODY in board order — duplicates collapse into one selector entry but each
   * source still announces itself, which is what the handoff asks for.
   *
   * THREE things fire, and their relative timing is the owner's to dial (⚙ Equip FX tuner): the authored
   * `equipment-spark` def on the SOURCE, the same def on the SLOT as the icon lands, and the metallic clang.
   * The CSS ring underneath is the always-on floor — authored defs do not ship in production, so without it
   * an equip would be silent and invisible there.
   *
   * Kept BRISK by construction: everything is fired together (staggered per source), not queued behind the
   * player. Nothing here gates gameplay — the state has already committed.
   */
  const prevEquipFxSeq = useRef(run.equipFxSeq);
  useLayoutEffect(() => {
    const seq = run.equipFxSeq;
    if (seq === undefined || seq === prevEquipFxSeq.current) return;
    prevEquipFxSeq.current = seq; // advance FIRST — exactly once per action
    const cues = run.equipFx ?? [];
    if (cues.length === 0) return;
    const cfg = getEquipFxConfig(); // read at FIRE TIME, so a tuner edit applies to the next equip
    // Where the icon lands. Absent (no second slot rendered yet) → the source half still plays.
    const slotEl = document.querySelector<HTMLElement>('.equipslot .heropowerbtn');
    const slotR = slotEl?.getBoundingClientRect();
    const slot = slotR ? { x: slotR.left + slotR.width / 2, y: slotR.top + slotR.height / 2 } : null;
    const timers: number[] = [];
    const retire: Array<() => void> = [];
    // USING an Equipment is its own shape: the Equipment's authored def travels FROM the slot TO what it was
    // cast on (owner 2026-08-28), with the clip the Equipment names. Handled before the grant cues below
    // because it shares nothing with them but the channel.
    for (const cue of cues) {
      if (cue.kind !== 'use') continue;
      const eq = cue.equipmentId ? EQUIPMENT_INDEX[cue.equipmentId] : undefined;
      if (!eq) continue;
      // A CHOOSE ONE Equipment already announced itself when its prompt opened (see the effect below), which
      // is the moment that reads as pressing it. Playing again here would be two flourishes for one press —
      // and the second would land on a screen that has moved on to the result.
      if (eq.chooseOne?.length) continue;
      const tEl = cue.targetUid ? findEl(cue.targetUid) : null;
      const tR = tEl?.getBoundingClientRect();
      // No target (an untargeted Equipment) → the effect plays ON the slot rather than travelling nowhere.
      const to = tR ? { x: tR.left + tR.width / 2, y: tR.top + tR.height / 2 } : slot;
      if (eq.useFxId && slot && to && canPlayDefs()) {
        const fire = (): void => {
          const stop = playDef(
            eq.useFxId!,
            { source: slot, target: to, cursor: to },
            { uids: { source: null, target: cue.targetUid ?? null } },
          );
          if (stop) retire.push(stop);
        };
        if (cfg.useDelayMs > 0) timers.push(window.setTimeout(fire, cfg.useDelayMs)); else fire();
      }
      if (eq.useSfxId && cfg.useSfxOn) sfx.equipmentUse(eq.useSfxId, cfg.useSfxDelayMs);
    }
    cues.filter((c) => c.kind !== 'use').forEach((cue, i) => {
      const el = findEl(cue.uid);
      const r = el?.getBoundingClientRect();
      const from = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : null;
      // A REBUILD fires one cue per surviving source, so it is staggered and (by default) quieter than a
      // fresh equip — a full spark per source every turn is a lot of screen for a bookkeeping step.
      const isRe = cue.kind === 'reequip';
      const base = i * cfg.staggerMs;
      // Both halves carry the SOURCE uid. The slot burst plays at a button rather than on a card, but it is
      // still ABOUT that minion's equip — so a react layer bound to the source fires for either half, which
      // is what `uids` is for. The target is the unit only where the burst actually sits on one.
      const spark = (at: { x: number; y: number } | null, delay: number, onUnit: boolean): void => {
        if (!at || !canPlayDefs()) return;
        if (isRe && !cfg.reequipSparkOn) return;
        const fire = (): void => {
          const stop = playDef(
            'equipment-spark',
            { source: at, target: at, cursor: at },
            { uids: { source: cue.uid, target: onUnit ? cue.uid : null } },
          );
          // `playDef` hands back a retire fn — called on cleanup so a route change mid-burst leaves nothing.
          if (stop) retire.push(stop);
        };
        if (delay > 0) timers.push(window.setTimeout(fire, delay)); else fire();
      };
      if (cfg.sourceOn) spark(from, base + cfg.sourceDelayMs, true);
      if (cfg.slotOn) spark(slot, base + cfg.slotDelayMs, false);
      // The clang is scheduled on the AUDIO clock (see `sfx.equipClang`), so it cannot drift from the visual.
      if (cfg.sfxOn && (!isRe || cfg.reequipSparkOn)) sfx.equipClang(base + cfg.sfxDelayMs);
      // The CSS ring stays as the always-on floor: it reads even in production, where authored defs do not
      // ship (`canPlayDefs()` is false), so an equip is never silent-and-invisible.
      for (const at of [from, slot]) {
        if (!at) continue;
        const n = document.createElement('div');
        n.className = `equipflash${isRe ? ' reequip' : ''}`;
        n.style.left = `${at.x}px`;
        n.style.top = `${at.y}px`;
        n.style.animationDelay = `${base}ms`;
        document.body.appendChild(n);
        retire.push(() => n.remove());
      }
    });
    const sweep = window.setTimeout(() => { for (const f of retire.splice(0)) f(); }, 1600);
    return () => {
      window.clearTimeout(sweep);
      for (const t of timers) window.clearTimeout(t);
      for (const f of retire.splice(0)) f();
    };
  }, [run.equipFxSeq, run.equipFx, findEl]);

  /**
   * SHOP DEATH + ECHO CUES (owner ask 2026-08-28) — the shop's answer to combat's death visuals.
   *
   * The shop has no beat playback (only End of Turn plays beats), so these ride the same per-action scratch
   * channel every other shop FX uses. The vocabulary is COMBAT'S, deliberately: the same event should not look
   * like two different things depending on the phase.
   *
   *   · an Echo TRIGGERED    → `pixiFx.deathrattle` — the painted skull-shatter. From ANY source: a shop
   *                             destroy, Ossuary Rite, Rune of the Reliquary, a Gravetwin's copy.
   *   · a body DIED          → the authored `death-dissolve` def.
   *   · a body that is RISING → neither: it re-forms rather than dissolving.
   *
   * POSITION. A dead body is already off the board by the time this runs, so `findEl` cannot find it. The
   * cache below keeps the last known centre of every board card; this effect reads it BEFORE the refresh
   * effect (declared after it, so it runs after) overwrites it with the new layout.
   */
  const lastCentreRef = useRef<Map<string, { x: number; y: number; w: number }>>(new Map());
  const prevShopFxSeq = useRef(run.shopFxSeq);
  useLayoutEffect(() => {
    const seq = run.shopFxSeq;
    if (seq === undefined || seq === prevShopFxSeq.current) return;
    prevShopFxSeq.current = seq; // advance FIRST — fires exactly once per action, like the Ruby cue above
    const cues = run.shopDeathFx ?? [];
    const cfg = getShopDeathFxConfig(); // read at FIRE TIME, so a tuner edit applies to the next death
    // WHICH BODIES DIED THIS ACTION. An Echo belonging to a dying body must play WHERE THE CARD WAS (owner
    // 2026-08-28) — so for those we go straight to the last-known centre and never consult the live DOM,
    // where the uid is either absent or, after a Rise, a DIFFERENT body standing in its place.
    const dying = new Set(cues.filter((f) => f.kind === 'death').map((f) => f.uid));
    // Hold the row for the NEXT commit's slide. Set here rather than in the FLIP effect because only
    // this one knows a death happened; the FLIP effect sees an ordinary board change.
    if (dying.size > 0) shiftHoldRef.current = Math.max(0, cfg.shiftDelayMs);
    for (const fx of cues) {
      const cached = lastCentreRef.current.get(fx.uid);
      const live = dying.has(fx.uid) ? null : findEl(fx.uid);
      const base = live
        ? (() => { const r = live.getBoundingClientRect(); return { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width }; })()
        : cached;
      if (!base) continue;
      const at = { x: base.x + cfg.offsetX, y: base.y + cfg.offsetY, w: base.w * cfg.sizeScale };
      const fire = (): void => {
        if (fx.kind === 'echo') { pixiFx.deathrattle(at.x, at.y, at.w); return; }
        if (fx.rise) { pixiFx.flashBloom(at.x, at.y, RISE_BURST); return; }
        if (!canPlayDefs()) return;
        const anchors = anchorsForUnits(null, fx.uid);
        if (anchors) playDef('death-dissolve', anchors, { uids: { source: null, target: fx.uid } });
      };
      if (fx.kind === 'echo' && preFiredEchoRef.current.delete(fx.uid)) continue; // the lead already played it
      if (fx.kind === 'echo' && !cfg.echoEnabled) continue;
      if (fx.kind === 'death' && !cfg.deathEnabled) continue;
      const delay = fx.kind === 'echo' ? cfg.echoDelayMs : cfg.deathDelayMs;
      if (delay > 0) window.setTimeout(fire, delay); else fire();
    }
  }, [run.shopFxSeq, run.shopDeathFx, findEl]);

  /**
   * Refresh the last-known-centre cache. Declared AFTER the cue effect on purpose: React runs layout effects
   * in declaration order, so the cue above still sees the PREVIOUS layout — which is the only place a body
   * that just died still has a position. Reads at most a board's worth of rects, once per render (never per
   * frame), and skips entirely mid-drag where renders are frequent and nothing is dying.
   */
  useLayoutEffect(() => {
    if (dragRef.current?.active) return;
    const next = new Map<string, { x: number; y: number; w: number }>();
    for (const el of document.querySelectorAll<HTMLElement>(FLIP_SEL_WARBAND)) {
      const uid = el.dataset.uid;
      if (!uid) continue;
      const r = el.getBoundingClientRect();
      next.set(uid, { x: r.left + r.width / 2, y: r.top + r.height / 2, w: r.width });
    }
    lastCentreRef.current = next;
  });

  const replay = useCombatReplay(run.lastCombat, { active: fighting, findEl, combatSpeed, paused: overlayOpen, rampEnabled });

  // DEV (proc harness): publish the live replay's `seekTo` on a window handle so the FX workbench's rail-mode
  // harness can jump the fight to a moment. NOT a prop and NOT a store field, deliberately:
  //   - a prop is impossible — the workbench is mounted from `DevMenu`, a SIBLING of `Recruit` under `Game`,
  //     so there is no ancestor that can see this replay to thread it through;
  //   - the store is the repo's hottest shared file (see CLAUDE.md's chokepoint list) and this is a dev-only
  //     callback with no business in shipped run state.
  // Same shape as the existing `window.__perfHud` / `window.__pixiFx` dev handles. Published through a ref so
  // the effect runs once per mount rather than re-registering on every combat frame (`seekTo` is a fresh
  // closure each render); the handle is deleted on unmount, so a stale `Recruit` can never be seeked.
  const seekToRef = useRef(replay.seekTo);
  seekToRef.current = replay.seekTo;
  useEffect(() => {
    if (!import.meta.env.DEV) return;
    const w = window as unknown as { __fxSeek?: (index: number) => void };
    w.__fxSeek = (index: number) => seekToRef.current(index);
    return () => { delete w.__fxSeek; };
  }, []);

  /**
   * (BOTH) MARKER — which cards the owner-authored `choose-one-both` loop rides right now.
   *
   * The keys are the `data-choose-both` values the card views stamp (see `CardView.chooseBothKey`), gathered
   * from the three surfaces the owner named: an OPEN DISCOVER's options, the HAND, and the SHOP. Priority
   * order matters — `useChooseBothFx` keeps only the first `CHOOSE_BOTH_FX_CAP` — so the surface the player is
   * actually looking at comes first.
   *
   * This is also the PAUSE: an empty list tears every loop down. Combat, and any board-covering overlay that
   * is not the Discover itself, yield `[]` rather than leaving emitters spending frames behind a backdrop
   * (the same hard-teardown rule `useCiaEnchantedFx` follows when the fight starts).
   */
  const chooseBothKeys = useMemo(() => {
    if (run.phase === 'combat' || inCombat) return [];
    // The Discover overlay OWNS the screen — and its own options are exactly what must be marked there.
    if (run.discover?.length && !discoverMin) {
      return run.discover.map((id, i) => (chooseBothActive(run, undefined, CARD_INDEX[id]) ? `disc:${i}` : null)).filter((k): k is string => !!k);
    }
    // Any other overlay covering the board: nothing to mark, and nothing worth animating underneath it.
    if (run.chooseOne || run.questOffer || run.powerOffer || run.runeforgeOffer || run.scoutedNextOpponent?.length || heroSelecting || overlayOpen) return [];
    const hand = run.hand.filter((c) => chooseBothActive(run, c, CARD_INDEX[c.cardId])).map((c) => c.uid);
    const shop = run.shop.filter((o) => chooseBothActive(run, o, CARD_INDEX[o.cardId])).map((o) => o.uid);
    return [...hand, ...shop];
  }, [run, inCombat, discoverMin, heroSelecting, overlayOpen]);
  useChooseBothFx(chooseBothKeys);

  // A board-covering modal is open (Discover / Choose One / a quest or runeforge offer / a scouted board).
  useEffect(() => {
    // A minimized Discover / Quest overlay leaves the board visible, so it doesn't count as covering.
    const modalCovering = !overlaysHeld && ((run.discover && !discoverMin) || (run.questOffer && !questMin) || run.powerOffer || (run.runeforgeOffer && !forgeMin) || run.chooseOne || (run.scoutedNextOpponent?.length ?? 0) > 0);
    // The hero portrait / pills / power diamond live OUTSIDE the overlay's backdrop root (their own fixed
    // stacking contexts), so the overlay's backdrop-filter can't blur them — mark the body and let CSS blur
    // + dim them to match the rest of the covered board (owner report 2026-07-16). One-shot filter change.
    document.body.classList.toggle('modalup', !!modalCovering);
    return () => document.body.classList.remove('modalup');
  }, [run.discover, run.chooseOne, discoverMin, run.questOffer, run.powerOffer, questMin, run.runeforgeOffer, forgeMin, overlaysHeld]);
  // B2: each Discover opens expanded — reset the minimized flag whenever the pending Discover changes.
  useEffect(() => { setDiscoverMin(false); }, [run.discover]);
  // Each quest offer opens expanded too — reset the minimized flag when the offer changes.
  useEffect(() => { setQuestMin(false); }, [run.questOffer]);
  useEffect(() => { setForgeMin(false); }, [run.runeforgeOffer]);
  // Bridge the live enemy-death count to the store so the StatusBar's Cassen counter ticks up during the
  // replay. Zero it once the combat is SETTLED (not just when we leave combat): at replay's end settleCombat
  // banks the kills into run.cassenKills, so continuing to add the live count too would double-show them
  // (e.g. 1 kill briefly reading 2/5 on the End-Combat screen).
  useEffect(() => {
    setCombatEnemyDeaths(inCombat && !run.combatSettled ? replay.enemyDeaths : 0);
  }, [inCombat, run.combatSettled, replay.enemyDeaths, setCombatEnemyDeaths]);
  // Bridge this fight's live combat quest progress to the store so quest NODES tick combat objectives up as
  // the replay plays. Cleared to `null` once SETTLED — settleCombat folds the tally into the run's quest
  // progress, so the panel then reads it from there (adding the live delta too would briefly double-count).
  useEffect(() => {
    setCombatQuestDelta(inCombat && !run.combatSettled ? replay.questDelta : null);
  }, [inCombat, run.combatSettled, replay.questDelta, setCombatQuestDelta]);
  // Pulse the completed-quest / owned-rune badges as their combat effects fire during the replay (empty otherwise).
  useEffect(() => {
    setCombatTriggeredQuests(inCombat && !run.combatSettled ? replay.triggeredQuests : {});
  }, [inCombat, run.combatSettled, replay.triggeredQuests, setCombatTriggeredQuests]);
  // Quests that COMPLETE mid-replay — surface them to QuestBadges so their node appears + lights up live (before
  // the quest formally settles as completed). Empty out of combat.
  useEffect(() => {
    setCombatCompletedQuests(inCombat && !run.combatSettled ? replay.completedQuests : []);
  }, [inCombat, run.combatSettled, replay.completedQuests, setCombatCompletedQuests]);
  // Bridge this fight's live run-buff gains (spell power, max Gold) to the store so the Buffs window ticks up
  // in sync with the replay. Cleared to `null` once combat is SETTLED — settleCombat folds the gains into the
  // run state, so the row then reads them from there (adding the live delta too would briefly double-count).
  const { spellAttack: cbA, spellHealth: cbH, rubyAttack: cbRA, rubyHealth: cbRH, gold: cbGold, auras: cbAuras } = replay.combatBuffs;
  // A compact signature of the per-aura map so the effect re-runs when ANY aura row ticks (the map is a fresh
  // object each beat, so we key on its contents, not its reference).
  const cbAuraSig = JSON.stringify(cbAuras);
  useEffect(() => {
    setCombatBuffs(inCombat && !run.combatSettled ? { spellAttack: cbA, spellHealth: cbH, rubyAttack: cbRA, rubyHealth: cbRH, gold: cbGold, auras: cbAuras } : null);
  }, [inCombat, run.combatSettled, cbA, cbH, cbRA, cbRH, cbGold, cbAuraSig, setCombatBuffs]);

  // Entering combat: hold on the "shop closing" intro, then let the enemies arrive
  // and the replay begin. Also flash the "End of Turn" banner (end-of-turn effects just
  // resolved) and snapshot the hand so post-combat grants can be detected.
  useEffect(() => {
    if (!inCombat) {
      setCombatStage('closing');
      setShowLog(false); // close the log when the fight is over
      return;
    }
    grantsShownRef.current = 0;   // a fresh fight — no hand-grant preview has materialised yet
    grantPlayedRef.current = [];
    setEotAnimStats(null); // the End-of-Turn climb is done + baked in; combat shows the real units
    setEotAnimTick(null); // projected cadence tick is now committed (faceOmen) — drop the override
    setEotShopStats(null); // shop-buff climb is committed too — the real offers now carry it
    setFodderAnim(null); // never let a lingering Fodder ghost survive into combat + replay on return
    setHeldConsume([]); // and never carry a held (invisible) consumed slot into combat / the next shop
    setCombatStage('closing');
    setEndTurnFlash(true);
    const banner = window.setTimeout(() => setEndTurnFlash(false), 850);
    return () => {
      window.clearTimeout(banner);
    };
  }, [inCombat, run.lastCombat]);
  // START OF COMBAT waits for the CURTAIN, not a fixed 480ms (owner ask 2026-08-28): with the two-stage
  // wipe, the old timer let the opening beats play while the scene was still covered/being revealed. The
  // enemies arrive and the replay begins only once the reveal sweep has fully exposed the arena
  // (`wipe === 'combat'`). A mid-combat resume initialises the wipe there, so it starts immediately.
  useEffect(() => {
    if (!(inCombat && wipe === 'combat')) return undefined;
    // +800ms settle AFTER the reveal (owner ask 2026-08-29): the armies stand on the exposed arena for a
    // breath before the first attack, instead of the fight igniting the frame the curtain clears.
    const t = window.setTimeout(() => setCombatStage('fighting'), 800);
    return () => window.clearTimeout(t);
  }, [inCombat, wipe]);

  // A Skip mutes ALL audio (stopAllAudio) and leaves it muted through the resolved-combat screen; un-mute once
  // the fight is left (back to the shop) so the next fight — and the shop — has sound again.
  useEffect(() => {
    if (!inCombat) { resumeAudio(); pixiFx.setVisible(true, 0); } // restore the FX layer after a Skip
  }, [inCombat]);

  // Once the combat replay finishes, settle the outcome (damage + carry-backs) right here in the combat
  // view — so the Resolve hit lands and is visible before the "End Combat" button returns you to the shop.
  // BOTH decisive outcomes defer settle to the hero-strike sequence below, so the health lands on the blow
  // (owner ask 2026-08-25 — this eager settle on wins is exactly what kept the player's hero from ever
  // striking: the sequence guards on `combatSettled`, and this fired first). Only a DRAW — no winner, no
  // swing — settles immediately.
  useEffect(() => {
    if (fighting && replay.done && !run.combatSettled && replay.result === 'draw') dispatch({ type: 'settleCombat' });
  }, [fighting, replay.done, run.combatSettled, replay.result, dispatch]);

  // REPLAY VIEWER (v2): bridge the arena's animation-done flag to the store, so the replay player knows when
  // a spectated fight has finished playing and it's safe to advance to the next frame. During playback the
  // live `dispatch` is swallowed (the player owns state), so the combat→shop step can't ride the normal
  // auto-settle path above — this is how the player learns.
  const spectating = useGame((st) => st.replaying);
  useEffect(() => {
    if (spectating) useGame.setState({ combatReplayDone: replay.done });
  }, [spectating, replay.done]);

  // Leaving the arena: fade EVERYTHING out together (units + FX) for one beat, THEN swap to the shop and fade
  // the recruit board + survivors back in together — a single synchronized crossfade instead of an abrupt
  // snap. `resolveCombat` is deferred to the end of the fade-out so the swap happens under cover of opacity 0.
  // Leaving the arena rides the CURTAIN, not the old `combatout` unit crossfade (owner ask 2026-08-29: the
  // armies no longer fade — they simply stand until the blue sweeps over them). The click starts the exit
  // cover sweep IMMEDIATELY, while the phase is still combat; the actual resolve is deferred to the moment
  // the curtain reaches full cover (`coveredOut` — see the wipe hold effect), so the combat→shop swap always
  // happens out of sight. `wipeExitRef` carries the pending exit across that gap and doubles as the
  // double-click guard. (`skipFade` still uses the old crossfade classes — Skip stays in combat.)
  const wipeExitRef = useRef(false);
  const endCombat = useCallback((): void => {
    if (wipeExitRef.current) return; // already leaving — ignore a double-click
    wipeExitRef.current = true;
    setWipe('primeOut'); // one parked-circle frame, then the exit bloom (see the wipe hold effect)
  }, []);
  useEffect(() => {
    if (wipe !== 'coveredOut' || !wipeExitRef.current) return;
    wipeExitRef.current = false;
    // The old `combatout` crossfade also faded the FX canvas; without it, long-lived combat particles could
    // outlive the fight and drift over the revealed shop. Kill them here, out of sight under the full blue.
    pixiFx.clearParticles();
    // SANDBOX REPLAY: leave the phase, resolve NOTHING. `resolveCombat`'s own guard is only
    // `phase === 'combat' && lastCombat` — it does not re-check `combatSettled` — so dispatching it here
    // would settle the lobby round and run `advanceCombat` a SECOND time for a fight already resolved:
    // wave +1, embers refilled, a fresh opponent served, and the board you authored stranded a wave back.
    // The replay must be a pure animation, so its exit is a pure phase flip (see store `exitReplay`).
    if (sandboxReplay) exitReplay();
    else dispatch({ type: 'resolveCombat' });
  }, [wipe, dispatch, sandboxReplay, exitReplay]);

  // Skip the replay — the same synchronized fade as End Combat, but it stays IN combat: freeze all motion
  // (GSAP) + kill all audio, hold a beat so everything visibly pauses and fades out together, then jump the
  // replay to the resolved board under cover of opacity 0 and fade that back in. Audio stays muted (a
  // replacement one-shot goes here later); it un-mutes when the fight is left / the next fight begins.
  const skipCombat = useCallback((): void => {
    setSkipFade((s) => {
      if (s) return s; // already skipping
      const FADE = 260, HOLD = 900, IN = 300;
      // Just fade the FX canvas out, jump to the resolved board under cover of opacity 0, then fade the canvas
      // back in. Auras are CSS (Card.tsx `.ward` / `.reborn`), so they come and go with their cards — nothing to
      // reconcile here. Tickers stay live (a paused ticker stalls a particle's alpha → a pop). GSAP freezes the
      // unit lunges; audio is killed (replacement one-shot TBD).
      stopAllAudio();
      gsap.globalTimeline.pause();
      pixiFx.clearParticles();
      pixiFx.setVisible(false, FADE); // fade the FX canvas out with the board
      window.setTimeout(() => {
        gsap.globalTimeline.resume();
        replay.skip(); // resolved board; its auras reconcile (dead clear, survivors persist) invisibly during the hold
        pixiFx.clearParticles();
      }, FADE);
      window.setTimeout(() => {
        pixiFx.clearParticles();
        pixiFx.setVisible(true, IN); // fade the settled board's auras back in with it
        setSkipFade('in');
      }, FADE + HOLD);
      window.setTimeout(() => setSkipFade(null), FADE + HOLD + IN);
      return 'out';
    });
  }, [replay]);

  // Loss-damage sequence — runs ONCE when a defeat's replay finishes. Surviving enemy tiers + the
  // opponent's tavern tier fly up into a damage counter above the enemy board (clamped to the round cap),
  // then a Pixi bolt blasts it into the Resolve bar, which drops on impact. We read `run` fresh (not via
  // deps) so the mid-sequence settleCombat (which mutates run) can't re-fire this effect + clear the timers.
  useEffect(() => {
    // BOTH outcomes now drive this (owner ask 2026-08-25): the winner's hero strikes the loser, so a WIN plays
    // the sequence in the opposite direction. A draw has no winner, so nothing swings.
    if (!fighting || !replay.done || lossSeqRef.current) return;
    if (replay.result !== 'lose' && replay.result !== 'win') return;
    const run0 = useGame.getState().run;
    if (run0.combatSettled) return;
    lossSeqRef.current = true;
    // A SKIP mutes all audio to cut the replay short (stopAllAudio), and it stays muted until the fight is left
    // — which used to silence THIS whole post-combat sequence too (owner report 2026-08-25: skipped combat has
    // no duel sound). The replay is over by here, so its purpose is served: un-mute so the tally / pill / lunge
    // SFX play whether or not the fight was skipped. A no-op when nothing suspended it.
    resumeAudio();

    // The tally flies from the WINNER's surviving board — theirs on a loss, YOURS on a win (owner ask
    // 2026-08-25: a win must tally and strike exactly like a loss does).
    const won = replay.result === 'win';
    const survivors = won ? replay.frame.player : replay.frame.enemy;
    const cap = lossDamageCap(run0.wave);
    // `playerLossDamage` is the same function the settle uses — the player takes COMBAT DAMAGE ONLY (owner
    // ruling 2026-08-04), and sharing one definition is what stops the counter drifting from the hit again.
    const finalDmg = run0.lobby && run0.mode !== 'practice' && run0.lastCombat
      ? playerLossDamage(run0.lobby, run0.lastCombat)
      : Math.min(run0.lastCombat?.playerDamage ?? 0, cap);
    const oppTier = nextOpponent(run0)?.tier ?? run0.tier; // the just-fought board (wave advances only on Climb On)
    // The blow the WINNER lands. On a loss that is what the player takes (`finalDmg`); on a win it is what the
    // foe takes — the sim's mirror of the same formula, capped the same way (see `simulate`'s `enemyDamage`).
    const strikeDmg = replay.result === 'win'
      ? Math.min(run0.lastCombat?.enemyDamage ?? 0, cap)
      : finalDmg;

    // The tally always sits at the CENTRE OF THE BOARD (owner ask 2026-08-25), whichever side won — it tallies
    // the minion damage there, then the projectile flies to the appropriate hero's attack pill.
    const rectOf = (uid: string): DOMRect | undefined => findEl(uid)?.getBoundingClientRect() ?? undefined;
    const boardRect = document.querySelector('.app')?.getBoundingClientRect();
    const cx = boardRect ? boardRect.left + boardRect.width / 2 : window.innerWidth / 2;
    const cy = boardRect ? boardRect.top + boardRect.height / 2 : window.innerHeight / 2;

    // Contributions: opponent tier (flies from its intel frame) + each survivor's tier (from its card).
    //
    // Taken from the FIGHT's own breakdown when it has one (owner report 2026-08-08: the counter read 11
    // while Resolve dropped by more). Deriving them here from `nextOpponent()` and the replay's final frame
    // meant the animation and the hit were computed from different inputs — a procedural fallback, a
    // snapshot without a tier, or a body still shown mid-death is enough to make them disagree. The sim's
    // numbers are what actually land, so they are what the counter tallies; the local derivation stays only
    // as a fallback for a combat recorded before this field existed (a saved run mid-defeat).
    const oppRect = document.querySelector('.oppframe')?.getBoundingClientRect();
    const bd = run0.lastCombat?.damageBreakdown;
    // A WIN has no `damageBreakdown` — the sim only records one for the side that LOST — so its contributions
    // are derived: your tavern tier plus each of your surviving minions, which is the same formula `simulate`
    // uses for `enemyDamage`. The loss path keeps using the sim's own breakdown, which stays authoritative.
    const contribs: { tier: number; r?: DOMRect; isOpp?: boolean }[] = won
      ? [
        { tier: run0.tier, r: document.querySelector('.statusbar .hero .f')?.getBoundingClientRect() ?? undefined, isOpp: true },
        ...survivors.map((u) => ({ tier: CARD_INDEX[u.cardId]?.tier ?? 1, r: rectOf(u.uid) })),
      ]
      : bd
      ? [
        { tier: bd.oppTier, r: oppRect ?? undefined, isOpp: true },
        // Pair each real tier with a surviving card's rect where one exists, purely so the numbers fly from
        // somewhere sensible; the VALUES are the sim's, never the DOM's.
        ...bd.survivorTiers.map((tier, i) => ({ tier, r: rectOf(survivors[i]?.uid ?? '') })),
      ]
      : [
        { tier: oppTier, r: oppRect ?? undefined, isOpp: true },
        ...survivors.map((u) => ({ tier: CARD_INDEX[u.cardId]?.tier ?? 1, r: rectOf(u.uid) })),
      ];
    const rawTotal = contribs.reduce((s, c) => s + c.tier, 0);

    // THE HERO STRIKE (owner ask 2026-08-25). The winner "gains the attack": their pill shows their BASE tier
    // damage in YELLOW from the start; the TALLY is only the REST — the minion (survivor) damage — so pill +
    // tally add up to the full damage WITHOUT double-counting the tier the pill already shows (owner ask
    // 2026-08-25). When the tally lands the pill buffs to full and flips GREEN (a buffed minion reads green);
    // only then does the hero wind up and lunge, dropping the loser's health with a minion's motion / FX / sounds.
    const playerWon = won;
    const side: 'player' | 'opp' = playerWon ? 'player' : 'opp';
    const fullDmg = strikeDmg;
    // Base = the attacker's tavern tier (the formula's leading term, contribs[0]); the tally is contribs[1..].
    const baseTier = Math.min(contribs[0]?.tier ?? 1, fullDmg);
    const buffAmount = Math.max(0, fullDmg - baseTier);
    const tallyContribs = contribs.slice(1);   // drop the base-tier term — it is already worn on the pill

    // Every beat below is tunable live (⚔️ Hero Duel). Read once per sequence, so a mid-swing slider change
    // never retimes a swing that is already in the air.
    const duel = getHeroDuelConfig();
    const STAGGER = duel.tallyStagger, FLY = duel.tallyFly;
    setLossPos({ x: cx, y: cy });
    setLossPhase('tally');
    setLossCount(0);
    setLossDmg(buffAmount);
    setLossCapped(rawTotal > cap);
    setLossFlyers(tallyContribs.map((c, i) => ({
      id: i, tier: c.tier,
      x: c.r ? c.r.left + c.r.width / 2 : cx,
      y: c.r ? c.r.top + c.r.height / 2 : cy,
      tx: cx, ty: cy, delay: i * STAGGER, isOpp: c.isOpp,
    })));

    const timers = seqTimersRef.current;
    let running = 0;
    tallyContribs.forEach((c, i) => {
      timers.push(window.setTimeout(() => { running += c.tier; setLossCount(Math.min(running, buffAmount)); }, i * STAGGER + FLY));
    });
    const tallyEnd = tallyContribs.length ? (tallyContribs.length - 1) * STAGGER + FLY + 340 : 220;

    const strikeSeq = (lossSeqSeqRef.current += 1);
    const setPill = useGame.getState().setHeroAtkPill;
    setPill({ side, amount: baseTier, buffed: false });
    // Retire the pill with a FADE (owner ask 2026-08-25): flag it `leaving` so CSS animates it out, then unmount.
    const fadePillOut = (): void => {
      const cur = useGame.getState().heroAtkPill;
      if (cur) setPill({ ...cur, leaving: true });
      timers.push(window.setTimeout(() => setPill(null), 260));
    };   // the yellow base pill rides the hero from tally start
    // HERO-DUEL SFX, scheduled from the SEQUENCE START so their tuner offsets can pull them EARLIER (negative)
    // or later (positive) than the natural cue — travel fires at the launch (tallyEnd), the pill-add at the
    // landing (tallyEnd + the def's travel). Clamped to >= 0 so a big negative just fires at the start.
    // The tally-COUNTER sound plays as the numbers begin to climb (sequence start + its signed offset).
    timers.push(window.setTimeout(() => sfx.tallyCounter(duel.sfxCounterVol), Math.max(0, duel.sfxCounterDelay)));
    timers.push(window.setTimeout(() => sfx.tallyTravel(duel.sfxTravelVol), Math.max(0, tallyEnd + duel.sfxTravelDelay)));
    timers.push(window.setTimeout(() => sfx.attackPillAdd(duel.sfxAddVol), Math.max(0, tallyEnd + TALLY_TRAVEL_MS + duel.sfxAddDelay)));
    timers.push(window.setTimeout(() => sfx.tallyImpact(duel.sfxImpactVol), Math.max(0, tallyEnd + TALLY_TRAVEL_MS + duel.sfxImpactDelay)));

    timers.push(window.setTimeout(() => {
      // Dissolve the centre tally into particles that fly to the ATTACKER's portrait ("gaining the attack").
      setLossPhase('blast');   // the centre number launches (fades) and does NOT re-show (see the render guard)
      setLossFlyers([]);
      // Fly to the ATTACK PILL (owner ask 2026-08-25), not the portrait centre — the damage is "gained" INTO the
      // pill. Only one `.hero-atk` exists at a time (the attacker's). Fall back to the portrait if it's missing.
      const pillEl = document.querySelector('.hero-atk');
      const pr = pillEl?.getBoundingClientRect();
      const aRect0 = document.querySelector(playerWon ? '.statusbar .hero .herolunge' : '.combatopp-body')?.getBoundingClientRect();
      const ax = pr ? pr.left + pr.width / 2 : (aRect0 ? aRect0.left + aRect0.width / 2 : cx);
      const ay = pr ? pr.top + pr.height / 2 : (aRect0 ? aRect0.top + aRect0.height / 2 : cy);
      // Play the AUTHORED def (ribbon travels source→pill, then a burst on the pill) instead of the old bolt.
      playDef('tallyanimation1', { source: { x: cx, y: cy }, target: { x: ax, y: ay } });
      // WHEN the tally lands on the pill (after the def's ~800ms travel): buff the pill to full + GREEN (it
      // re-pops on the value change), play the pill-add sound, and the pill sheens (via its `buffed` remount).
      timers.push(window.setTimeout(() => {
        setLossPhase('done');   // centre number gone for good — never returns to the board
        setPill({ side, amount: fullDmg, buffed: fullDmg > baseTier });
      }, TALLY_TRAVEL_MS));

      // The portraits: the player's own in the status bar, the foe's the frame that dropped in for the fight.
      const playerEl = document.querySelector('.statusbar .hero .herolunge');
      const oppEl = document.querySelector('.combatopp-body');
      const attacker = playerWon ? playerEl : oppEl;
      const defender = playerWon ? oppEl : playerEl;
      const setDmg = useGame.getState().setHeroDmgTaken;
      const land = (): void => {
        setLossShake(true);
        window.setTimeout(() => setLossShake(false), 360);
        // The struck hero does NOT react (owner ruling) — the Pixi FX + the health drop carry the blow. Pop the
        // RED damage-taken number in the centre of the DEFENDER (the side NOT attacking).
        setDmg({ side: playerWon ? 'opp' : 'player', amount: strikeDmg, seq: strikeSeq });
        // The FOE's shown health drops HERE too when the player struck it — the mirror of the player's own live
        // drop (which `settleCombat` applies to the run). Its lobby seat settles later, at resolveCombat.
        if (playerWon) useGame.getState().setOppDmgDealt(strikeDmg);
        dispatch({ type: 'settleCombat' }); // player's own health drops HERE, on the blow landing
      };
      // Raise ONLY the attacking side above the other portrait for the swing (see `.duel-attacker-*`), which
      // ALSO fades that side's own name/health — attacker-only, the struck hero keeps its pills up (owner ask).
      const appEl = document.body;
      const zClass = playerWon ? 'duel-attacker-player' : 'duel-attacker-opp';
      const dropZ = (): void => { appEl?.classList.remove(zClass); };
      // Wind up AFTER the pill has buffed (particles landed + pillHold), so the green full-damage pill reads
      // before the lunge carries it into the loser.
      timers.push(window.setTimeout(() => {
        appEl?.classList.add(zClass);
        const tl = attacker && defender
          ? playHeroStrike({ attacker, defender, damage: strikeDmg * duel.impactPower, combatSpeed: combatSpeed * duel.strikeSpeed, onImpact: land })
          : null;
        // No portraits to swing (a non-lobby run has no foe frame) → still land the consequence on time.
        if (!tl) { land(); dropZ(); }
        // CHAIN onto the timeline's own onComplete (playLunge's cleanup — clearProps transform/zIndex — lives
        // there); replacing it left the attacker at inline z-index 12, painted over its name/health after settle.
        else {
          const lungeDone = tl.eventCallback('onComplete');
          tl.eventCallback('onComplete', () => { lungeDone?.(); dropZ(); timers.push(window.setTimeout(() => fadePillOut(), duel.settleMs)); });
        }
      }, TALLY_TRAVEL_MS + duel.pillHold));
    }, tallyEnd));

    timers.push(window.setTimeout(() => { if (useGame.getState().heroAtkPill) fadePillOut(); useGame.getState().setHeroDmgTaken(null); setLossPhase('done'); }, tallyEnd + pixiFx.blastTravelMs + duel.pillHold + STRIKE_BASE + duel.settleMs));
    // NO cleanup here on purpose: this effect re-runs whenever `replay.frame` ticks, and tearing the timers
    // down on those re-runs killed the swing mid-flight. The sequence is short, self-completing and
    // single-entry (`lossSeqRef`); its timers are cleared when combat ends (below) and on unmount.
  }, [fighting, replay.done, replay.result, replay.frame, findEl, dispatch]);

  // Unmount safety for the strike's timers (leaving the run mid-sequence).
  useEffect(() => () => { seqTimersRef.current.forEach((t) => window.clearTimeout(t)); seqTimersRef.current = []; }, []);

  // Reset the loss sequence when leaving combat (ready for the next fight).
  useEffect(() => {
    if (!fighting) { seqTimersRef.current.forEach((t) => window.clearTimeout(t)); seqTimersRef.current = []; document.body.classList.remove('duel-attacker-player', 'duel-attacker-opp', 'duel-striking'); useGame.getState().setHeroDmgTaken(null); useGame.getState().setOppDmgDealt(0); lossSeqRef.current = false; setLossPhase(null); setLossFlyers([]); setLossCount(0); setLossPos(null); setLossShake(false); useGame.getState().setHeroAtkPill(null); }
  }, [fighting]);

  // Returning to recruit after a fight. The warband re-mounts (it was combat Units) and re-enters
  // via the base `cardpop` — a single mount animation, so it can't re-fire from a class toggle (the
  // old `resetting`/`boardreset` toggle flashed twice: once on mount, again when the class cleared).
  // Here we only (a) pop in any cards a combat Deathrattle added to the hand, and (b) re-sync the
  // stat snapshot so the green buff-flash doesn't spuriously fire on the cards coming back in.
  // useLayoutEffect so the snapshot is synced before the buff-flash passive effect reads it.
  useLayoutEffect(() => {
    if (prevPhaseRef.current === 'combat' && run.phase === 'recruit') {
      prevPhaseRef.current = run.phase;
      const snap = new Map<string, { a: number; h: number }>();
      for (const c of [...run.board, ...run.hand]) snap.set(c.uid, { a: c.attack, h: c.health });
      prevStatsRef.current = snap;
      // The gold `cardarrive` flash used to fire here for everything that appeared across the combat.
      // Retired 2026-07-22: the coalesce is the arrival announcement now, and a combat-granted card was
      // getting BOTH — materialising mid-fight, then flashing gold again on the way back to the shop.
      //
      // Nothing replaces it here. Suppressing the second materialise for cards the combat granted is the
      // coalesce watcher's own job now (it consumes `grantPlayedRef` as they land), because the grants hit
      // the real hand at `settleCombat` — while the phase is still 'combat' — so a skip set built at this
      // flip was always one dispatch too late (owner report 2026-07-27).
    }
    prevPhaseRef.current = run.phase;
  }, [run.phase]);

  /* ---------------------------------------------------------------- ARCANE COALESCE (card generated)
     A card that appears in hand FROM NOWHERE materialises out of arcane dust. Watching the hand's uid set
     per render is what makes this universal: there are 25 `hand.push` sites across the sim, and hooking each
     would guarantee we miss some. One diff catches them all, then we subtract the things that aren't
     generations:

       - BUYS. Flagged at the dispatch (`buyPendingRef`). A bought card was already visible in the tavern —
         acquired, not conjured — and gets its own shop→hand transition instead (owner ruling 2026-07-22).
       - GILDS / triples. Detected by `run.triplesMade` ticking in the same commit. NB `card.golden` is NOT
         a valid test: a gilded Discover pick and quest `grantGolden` rewards both arrive golden and ARE
         generations, so filtering on it would wrongly suppress them.
       - REFRAIN BOUNCES, where a played minion returns to hand. The uid was on the BOARD last render, so
         it's a return rather than something new.

       - COMBAT GRANTS that already materialised mid-fight, in the hand row, via the watcher below. They
         reach the REAL hand later (at `settleCombat` on a win, `resolveCombat` on a loss) and would
         otherwise materialise a second time there. `grantPlayedRef` is a cardId list, so the match is
         consumed one-per-card and stays correct when the same card is granted twice. */
  useLayoutEffect(() => {
    const prevHand = prevHandUidsRef.current!; // seeded at render (the ??= above) — never null in effects
    const prevBoard = prevBoardUidsRef.current!;
    const tripled = (run.triplesMade ?? 0) > prevTriplesRef.current;
    const bought = buyPendingRef.current;
    prevTriplesRef.current = run.triplesMade ?? 0;
    buyPendingRef.current = null;
    const granted = grantPlayedRef.current;
    /* Exclusions are PER CARD, not per commit. A blanket `bought`/`tripled` return threw away every fresh
       card in that tick, so anything conjured alongside a buy or a triple silently lost its effect. */
    const fresh = run.hand.filter((c) => {
      if (prevHand.has(c.uid) || prevBoard.has(c.uid)) return false;
      if (bought && c.uid === bought.uid) return false;             // the card you bought — it slides in
      if (tripled && c.golden) return false;                        // the gild owns its own card
      const g = granted.indexOf(c.cardId);
      if (g >= 0) { granted.splice(g, 1); return false; }           // already materialised mid-fight
      return true;
    });
    // The bought card slides into its slot from where you released it, instead of materialising.
    if (bought) {
      const el = document.querySelector<HTMLElement>(`[data-zone="hand"] .card[data-uid="${bought.uid}"]`);
      if (el) playBuySlide(bought.from, el);
    }
    prevHandUidsRef.current = new Set(run.hand.map((c) => c.uid));
    /* ---- GILD: three become one ----------------------------------------------------------------
       Fires on the same `triplesMade` tick the coalesce uses to EXCLUDE gilds, so the two can never both
       claim a card. The new gilded card is normally in hand, but lands on the BOARD when the hand is full,
       so both are searched. */
    if (tripled && run.phase === 'recruit') {
      const goldUid = [...run.hand, ...run.board]
        .find((c) => c.golden && !prevHand.has(c.uid) && !prevBoard.has(c.uid))?.uid;
      const el = goldUid
        ? document.querySelector<HTMLElement>(`.row .card[data-uid="${goldUid}"]`)
        : null;
      if (el) {
        /* The effect opens with the copies already gathered centre screen, so all it needs is HOW MANY were
           consumed and where the gilded card lives. Take that from the SIM'S OWN RULE — `checkTriples` pulls
           `runeTwinGilding ? 2 : 3` — rather than counting the uids that disappeared this commit.

           Counting them undercounts by exactly one, every time you complete a triple by BUYING the third
           copy: that copy arrived and was consumed inside the same commit, so it was never in a previous
           render's uid set and never shows up as "gone". Three cards became two, and the right-hand flyer
           was missing (owner report 2026-07-23). */
        const dest = el.getBoundingClientRect();
        // Two-copy gilds (Twin-Gilding rune OR Midas) fly 2 copies, not 3 — mirror the sim's `need` rule at
        // reducer.ts (`runeTwinGilding || midasTouch`), or Midas showed a phantom third flyer.
        const twoCopyGild = run.runeTwinGilding || getHero(run.heroId).power.kind === 'midasTouch';
        if (dest.width > 0) playPlateGild(dest, el, twoCopyGild ? 2 : 3);
      }
    }

    if (!fresh.length) return;
    /* Deliberately NOT gated on `run.phase`. END-OF-TURN grants (Money Maker, Crypt Scribe, Steward of
       Spells, the Chaos token) land while the phase has ALREADY flipped to combat — see the sibling comment
       on the Maw stamp effect above — so a `phase === 'recruit'` guard silently dropped every one of them
       (owner report 2026-07-22). They were then invisible on the way back too, because the pre-combat hand
       snapshot is taken after they land, so the flip doesn't see them as granted either.
       The real gate is whether the card is actually on screen, which the element lookup below does. Combat
       grants can't double-fire here: the filter above consumed them out of `grantPlayedRef`. */
    for (const c of fresh) {
      const card = document.querySelector<HTMLElement>(`[data-zone="hand"] .card[data-uid="${c.uid}"]`);
      if (!card) continue;
      const plate = card.querySelector<HTMLElement>('.cardplate');
      const r = (plate ?? card).getBoundingClientRect();
      if (r.width > 0) playPlateCoalesce(r, card);
    }
  });

  /* Cards showing in the hand row that the run state doesn't own yet — rendered after the real hand so it
     visibly grows at the moment the effect fires, rather than when the dispatch that commits them lands.
     Two sources, and they can't overlap: End-of-Turn beats (still `recruit`, cleared as `faceOmen` flips the
     phase) and in-combat grants. Filtered against CARD_INDEX — a grant of an id the index doesn't know (a
     card-data typo: Big Huggies once granted the empty string) used to throw inside the map and
     white-screen the whole Recruit tree. A bad grant should show nothing, not take down the game.

     CAPPED AT THE HAND LIMIT. A preview is a promise that the card is yours, and the sim only keeps grants
     while there's room — `settleCombat` / the End-of-Turn commit walk the grant list in order and drop
     everything past `CONFIG.handMax`. Without the same cap here the hand visibly overflowed past 10 during
     the replay and then snapped back as combat ended (owner report 2026-07-27). Same first-N rule as the
     reducer, so the cards that materialise are exactly the ones that survive the commit — and a hand that is
     already full shows (and coalesces) nothing at all for the rest of the round. */
  const handRoom = Math.max(0, CONFIG.handMax - run.hand.length);
  const handPreviews = useMemo(
    () => (inCombat && !run.combatSettled ? replay.handGrantsShown : eotGrants)
      .filter((id) => !!CARD_INDEX[id])
      .slice(0, handRoom),
    [inCombat, run.combatSettled, replay.handGrantsShown, eotGrants, handRoom],
  );

  /* In-combat grants (Deathrattle / Rally / Avenge / quest) and End-of-Turn grants alike. The hand visibly
     grows as each one arrives, so the card materialises out of arcane dust RIGHT THERE, identical to a
     shop-phase conjure.

     It used to coalesce on the mid-screen "To your hand" flyer instead, which played as a materialise in
     the middle of the screen, then the card warping into hand a beat later, then a THIRD appearance as the
     settle-side coalesce re-fired on the real card (owner report 2026-07-27). The flyer keeps its labelled
     announcement; the coalesce belongs where the card lands.

     Preview grants are the only cards in the hand row with no `data-uid`, which is how they're addressed;
     the index is tracked so a batch that reveals several at once (a Skipped replay) materialises each of
     them exactly once. The list emptying just resets the index, so it re-arms for the next fight/turn. */
  useLayoutEffect(() => {
    const prev = grantsShownRef.current;
    grantsShownRef.current = handPreviews.length;
    if (handPreviews.length <= prev) return;
    const els = document.querySelectorAll<HTMLElement>('.row.hand > .card:not([data-uid])');
    for (let i = prev; i < handPreviews.length; i++) {
      const el = els[i];
      if (!el) continue;   // committed in the same commit — the settle-side coalesce covers it instead
      const plate = el.querySelector<HTMLElement>('.cardplate');
      const r = (plate ?? el).getBoundingClientRect();
      if (r.width > 0) {
        playPlateCoalesce(r, el);
        grantPlayedRef.current.push(handPreviews[i]!);   // so it doesn't materialise again as it commits
      }
    }
  }, [handPreviews, inCombat, run.combatSettled]);

  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  // Hand reorder (drag a hand card sideways): the GSAP Flip state captured at drop, glided by a dedicated
  // layout effect. Separate from the warband/shop FLIP above — the hand's translateY tuck breaks the manual
  // x-tween that path uses, so Flip.from (which preserves the full transform) drives the hand instead.
  const handReorderFlipRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  // Set true for the ONE commit in which the reorder-Flip above handles a drag-reorder, so the make-room
  // `--hand-glide` effect stands down that commit. Both effects key off `handOrderKey` and would otherwise BOTH
  // fire on a reorder (the drag is already null by the layout phase, so `--hand-glide`'s drag guard misses),
  // re-sliding the neighbours a whole slot on top of the Flip — the "the slide repeats after I let go" bug.
  const reorderGlidedRef = useRef(false);
  // Each hand card's LAYOUT x (offsetLeft) as of the previous commit — the make-room glide's "from". Layout,
  // not a rect, so no transform (hover zoom, drag slide, live glide) can ever leak into it.
  const handLeftsRef = useRef<Map<string, number>>(new Map());
  // Prior-frame left edges (uid → x) of every flipping card, for the commit-branch manual FLIP (a SELL /
  // effect reposition glides survivors from here → their new slot; symmetric where GSAP Flip was not).
  const commitRectsRef = useRef<Map<string, number> | null>(null);
  // Set true when a hand card is just PLAYED onto the board, so the next FLIP commit SNAPS instead of running
  // GSAP. A played card is a NEW element entering the flex row: GSAP Flip doesn't take it out of flow, so it
  // fights the reflow (siblings close, then the new card shoves them back open = a jolt). The neighbours are
  // already parted to their final spots by the drag, so we let the card just pop in (CSS `popin`) and hold.
  const handPlaySnapRef = useRef(false);
  // Neighbours' visual left-edges captured at the instant of a hand-play drop (before the row reflows), so the
  // commit can FLIP each one from exactly where it sat to its final slot — no teleport if the release point
  // outran the rAF-throttled live preview (the "land it far over and a card jumps" bug).
  const handFlipRef = useRef<Map<string, number> | null>(null);
  // Which row (warband or tavern) the captured `handFlipRef` rects belong to — so the commit FLIPs the right
  // row. A board/hand drop targets the warband; a shop-offer reorder targets the tavern.
  const handFlipSelRef = useRef<string | null>(null);
  // The Y (viewport px) below which releasing a dragged HAND minion cancels back to hand instead of playing —
  // the "minimum play height". Measured once per drag (see the drag effect); Infinity until then = play anywhere.
  const playFloorRef = useRef(Infinity);
  // A SPELL arms on its own, LOWER line (closer to the hand) than a minion's play floor — so casting doesn't
  // need a long drag up. Set alongside playFloor from the live `spellLine` knob. Fallback = playFloor.
  const spellFloorRef = useRef(Infinity);
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  /**
   * The EXACT live pointer position during a drag, updated on every pointermove.
   *
   * `drag.x/y` in React state is deliberately COARSE (see the decision gate in `flushMove`): it only
   * advances when a layout DECISION changes, because every update re-renders this component.
   * Anything that must track the cursor smoothly — the floating card's transform, the spell aim line, the
   * motion trail — reads this ref instead, so it stays frame-exact without costing a render.
   */
  const dragPosRef = useRef<{ x: number; y: number } | null>(null);
  /** Mirrors the render's `castingSpell` / `castTargetUid` so `flushMove` can keep the spell aim line exact
   *  (it runs every frame; the render now only runs on the quantum). Written during render, read per frame. */
  const castAimRef = useRef<{ casting: boolean; onTarget: boolean }>({ casting: false, onTarget: false });
  // Weighted-drag motion: the floating .dragcard lags slightly behind the cursor and tilts toward its
  // motion. Driven by a per-frame rAF that writes the card's transform directly (no React re-render), so it
  // stays compositor-only. `dragCardRef` is the floating node; `dragMotionRef` holds its smoothed position.
  // When the card is snapping back or magnet-sliding, React/CSS own the transform instead (see the JSX).
  const dragCardRef = useRef<HTMLDivElement>(null);
  // The inner tilt wrapper. The 3D dive (rotateX/rotateY) lives HERE so it pivots about the card's OWN centre,
  // decoupled from the outer's big position translate — otherwise the perspective foreshortens that translate
  // and the card slides sideways instead of pitching cleanly (see `.dragtilt` in styles.css).
  const dragTiltRef = useRef<HTMLDivElement>(null);
  const dragMotionRef = useRef({ rx: 0, ry: 0, ax: 0, ay: 0, vx: 0, vy: 0 }); // rx/ry = smoothed pos; ax/ay = anchor (grab→centre); vx/vy = smoothed travel (drives the dive)
  // Touch drags stick to the FINGER (near-1 catch-up), not the mouse-tuned weighted lag: a card trailing the
  // cursor reads as pleasant "weight" with a mouse, but under a fingertip the same lag reads as stutter/low-FPS.
  const dragIsTouchRef = useRef(false);
  const reactDrivesDrag = snapping || magSlide; // these use a CSS transition, not the rAF lean
  const reactDrivesDragRef = useRef(reactDrivesDrag);
  reactDrivesDragRef.current = reactDrivesDrag;
  // `magSlide` mirrored into a ref so `flushMove`'s decision gate (whose effect captures values at drag-start)
  // reads the LIVE value — a magnet slide can begin mid-drag, and it suppresses the magnetize/insertion preview.
  const magSlideRef = useRef(magSlide);
  magSlideRef.current = magSlide;

  // A targeted spell only enters "aiming" once it's dragged UP past the play line — down in the hand it's a
  // reorder (see the drop handler), so the targeting reticle stays hidden there. Defined up here (before the
  // drag-motion rAF) so that effect can depend on it: when a spell drops back below the line mid-drag the
  // floating .dragcard REMOUNTS, and the rAF must re-run to position it — otherwise it strands at 0,0 (the
  // top-left "ghost card" bug).
  /**
   * Does the DRAGGED card still owe a Choose One decision? Such a card never enters aim mode: it is dragged up
   * like an untargeted spell and the aim picker opens after the branch is picked (owner ruling 2026-08-28).
   * A card whose branches are already settled — a Gilded Orivax, a Veinbreaker under its rune — keeps aiming
   * straight from the drag, because there is no question to ask.
   */
  const dragAsksChoiceFirst = useMemo(
    () => (drag ? chooseOneNeedsChoice(run, run.hand.find((c) => c.uid === drag.uid), CARD_INDEX[drag.view.cardId]) : false),
    [drag, run],
  );
  const castingSpell = computeCastingSpell(drag, drag ? drag.y : 0, spellFloorRef.current, dragAsksChoiceFirst);
  // The move-flush rAF runs outside render, so it reads the same answer through a ref.
  const asksFirstRef = useRef(dragAsksChoiceFirst);
  asksFirstRef.current = dragAsksChoiceFirst;

  // The weighted-drag rAF: while a card is actively dragged (and not snapping/magnet-sliding), smooth the
  // card's render position toward the cursor (OUTER element) and dive it toward its motion (INNER `.dragtilt`).
  // The card's per-frame travel feeds a smoothed velocity; the dive pitches the LEADING edge toward the board,
  // one uniform gain on both axes, settling flat when the cursor stops. Pure compositor transforms — no layout
  // reads. Position and tilt live on SEPARATE elements so the perspective never foreshortens the big position
  // translate (which slid the card sideways instead of pitching it).
  useLayoutEffect(() => {
    if (!drag?.active) return;
    const el = dragCardRef.current;
    const tiltEl = dragTiltRef.current;
    if (!el) return;
    const m = dragMotionRef.current;
    const d0 = dragRef.current;
    // OUTER = position only: a plain 2D translate + `zoom` lift, and it carries the `perspective` PROPERTY so
    // the inner dive foreshortens about the card centre (NOT baked into this translate → no slide). A flat
    // `staticRotate` rides here too. LIFT via CSS `zoom` (a crisp LAYOUT scale), NOT `transform: scale` — a
    // 3D-transformed layer rasterises at 1× and a scale upscales that one texture, blurring the card; `zoom`
    // re-rasterises at the enlarged size. Because zoom also scales the translate, divide it by the lift.
    const writePos = (f: ReturnType<typeof getDragFeel>): void => {
      el.style.setProperty('zoom', String(f.scale));
      el.style.perspective = `${f.perspective}px`;
      el.style.transformOrigin = `${m.ax}px ${m.ay}px`;
      el.style.transform = `translate(${m.rx / f.scale - m.ax}px, ${m.ry / f.scale - m.ay}px) rotate(${f.staticRotate}deg)`;
    };
    if (d0) {
      m.rx = d0.x; m.ry = d0.y;        // start at the cursor so the lift doesn't jump
      m.ax = d0.grabOx; m.ay = d0.grabOy; // anchor starts at the grab point → the card appears where you grabbed
      m.vx = 0; m.vy = 0;              // no dive on the first frame
      writePos(getDragFeel());
      if (tiltEl) tiltEl.style.transform = 'rotateX(0deg) rotateY(0deg)'; // flat before-paint, no flash
    }
    let raf = 0;
    let last = performance.now();
    const tick = (now: number): void => {
      const dt = Math.min(48, now - last);
      last = now;
      raf = requestAnimationFrame(tick);
      const d = dragRef.current;
      if (!d || reactDrivesDragRef.current) return; // snap/magslide → React+CSS own the transform
      const f = getDragFeel();
      // On touch, override the mouse-tuned weighted lag with a near-instant catch-up so the card tracks the
      // fingertip (trailing under a finger reads as stutter, not weight). Mouse keeps the dialed `follow`.
      const follow = dragIsTouchRef.current ? Math.max(f.follow, 0.9) : f.follow;
      const k = follow >= 1 ? 1 : 1 - Math.pow(1 - follow, dt / 16.667); // frame-rate-independent catch-up
      // recentre the anchor from the grab point toward the card centre — but only once the pointer has dragged
      // `recenterAfter` px from the grab point, and at its own (slower) `recenter` rate so the glide reads.
      if (Math.hypot(d.x - d.startX, d.y - d.startY) >= f.recenterAfter) {
        const kc = f.recenter >= 1 ? 1 : 1 - Math.pow(1 - f.recenter, dt / 16.667);
        // Hand cards hang from a lower point (`handGrabY`, near their stat badges); shop/board ride centred.
        const tgtY = d.source === 'hand' ? d.h * f.handGrabY : d.h / 2;
        m.ax += (d.w / 2 - m.ax) * kc;
        m.ay += (tgtY - m.ay) * kc;
      }
      // Chase the EXACT pointer, not the coarse committed state — `drag.x/y` only advances in quantum steps
      // (each one is a re-render), so following it here would make the card visibly stair-step.
      const live = dragPosRef.current ?? d;
      const gx = live.x - m.rx;
      const gy = live.y - m.ry;
      const stepX = gx * k;   // the card's ACTUAL per-frame travel (how far m.rx moves this frame)
      const stepY = gy * k;
      m.rx += stepX;
      m.ry += stepY;
      // Smoothed travel velocity = EMA of the per-frame step. `tiltEase` = 1 → tracks it raw (dive follows the
      // motion and snaps flat the instant the cursor stops); lower = a softer build/settle. This is the
      // "distance travelled" signal that drives the dive.
      const ek = f.tiltEase >= 1 ? 1 : 1 - Math.pow(1 - f.tiltEase, dt / 16.667);
      m.vx += (stepX - m.vx) * ek;
      m.vy += (stepY - m.vy) * ek;
      const clamp = (v: number): number => Math.max(-f.tiltMax, Math.min(f.tiltMax, v));
      // Dive: the LEADING edge dips toward the board, one uniform gain for both axes (screen y is down+):
      //   south (vy>0) → rotX<0 → bottom edge recedes → bottom corners pinch; east (vx>0) → rotY>0 → right recedes.
      const rotX = clamp(-f.tiltGain * m.vy);
      const rotY = clamp(f.tiltGain * m.vx);
      writePos(f);
      if (tiltEl) tiltEl.style.transform = `rotateX(${rotX}deg) rotateY(${rotY}deg)`;
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
    // `castingSpell` too: it gates whether the .dragcard is mounted, so when it flips the effect must re-run to
    // (re)bind the freshly-mounted node and write its transform before paint (no top-left flash / stranding).
  }, [drag?.active, castingSpell]);
  // Cached board/shop card rects for spell targeting — populated at drag-start (the board is static
  // during a spell drag: a spell doesn't open an insertion gap), so boardUidAt/shopUidAt hit-test
  // arithmetic instead of calling elementFromPoint every frame. Null outside a spell drag.
  const targetRectsRef = useRef<{ board: { uid: string; r: DOMRect }[]; shop: { uid: string; r: DOMRect }[] } | null>(null);
  // Cached warband/shop insertion slots (resting left + width per card), populated at drag-start. The row
  // CONTAINERS don't move during a drag — only the cards shift (via GSAP Flip) — so the insertion index can
  // be counted against the cached resting midpoints instead of calling getBoundingClientRect on every card
  // every frame. That live read was the last drag path still forcing a synchronous reflow per frame (a
  // read-after-Flip-write thrash); arithmetic against the cache removes it. Null outside a drag.
  const insertRectsRef = useRef<{ warband: { uid: string; left: number; width: number }[]; shop: { uid: string; left: number; width: number }[]; hand: { uid: string; left: number; width: number }[] } | null>(null);
  // Hand cards OVERLAP (negative margin), so their slot spacing isn't the card width — measure it once per
  // drag (consecutive cached lefts) and multiply the per-card slot offset by it to make the parting gap match.
  const handSlotWRef = useRef(0);
  // Last frame's reorder gap index (warband / shop). A reorder swap must trigger against each neighbour's
  // CURRENT (shifted) position, and that depends on where the gap currently is — hence we carry it frame to
  // frame. -1 = not reordering yet (falls back to the dragged card's home slot).
  const prevWarbandGapRef = useRef(-1);
  const prevShopGapRef = useRef(-1);
  const prevHandGapRef = useRef(-1);
  /**
   * WATCHING, not playing (owner report 2026-08-30: *"the buttons in game like end turn, freeze, and refresh
   * etc should not be clickable as a viewer in a replay ... it looks weird and causes bugs"*).
   *
   * The reducer was already safe — `dispatch` swallows every action while `replaying` — so nothing a viewer
   * clicked ever changed the run. What still happened was all the PRESENTATION around the click: the button
   * pressed and played its sound, a card started a drag, the hero power armed and waited for a target that
   * would never resolve. A control that depresses and does nothing reads as broken, and an armed hero power
   * with no way to fire it is the "bug" in the report.
   *
   * So the board goes inert as a whole (a `viewing` class, see `.app.viewing` in styles.css) rather than
   * `disabled` being threaded through two dozen controls — one gate cannot be forgotten by the next control
   * somebody adds. HOVER is deliberately left alive: reading a card mid-replay is the point of watching one.
   */
  const viewing = useGame((st) => !!st.replaySession);

  const timeUp = useTurnTimeUp(); // turn timer expired: lock everything but End Turn (flips once/turn — see turnClock)

  // TIMER-0 CRASH SNAPSHOT (owner ask 2026-08-24). The autosave only writes at PHASE boundaries; a run sitting
  // at 0 seconds is mid-recruit with the board LOCKED, no boundary crossed, so a CRASH there (not a graceful
  // quit, which `flushSave` already covers on tab-hide/close) would resume from the previous round and lose
  // this round's shopping. Flushing the exact locked board the instant the timer expires closes that gap.
  // `timeUp` flips once per turn, so this fires at most once a round — well off the per-action hitch path.
  // Recruit-only: during combat the clock is irrelevant and the run is mid-replay.
  useEffect(() => {
    if (timeUp && !inCombat && !run.sandbox) useGame.getState().flushSave();
  }, [timeUp, inCombat, run.sandbox]);

  const zoneAt = (x: number, y: number): Zone | null => {
    const el = document.elementFromPoint(x, y)?.closest('[data-zone]');
    return (el?.getAttribute('data-zone') as Zone) ?? null;
  };
  const hitCachedUid = (cards: { uid: string; r: DOMRect }[], x: number, y: number): string | null => {
    for (const { uid, r } of cards) if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return uid;
    return null;
  };
  /** The uid of the board minion under a point (for spell / battlecry targeting), or null. */
  const boardUidAt = (x: number, y: number): string | null => {
    const cached = targetRectsRef.current;
    if (cached) return hitCachedUid(cached.board, x, y);
    const el = document.elementFromPoint(x, y)?.closest('[data-zone="warband"] .row .card[data-uid]');
    return el?.getAttribute('data-uid') ?? null;
  };
  /** The uid of the tavern minion offer under a point (for `any` spell targeting — e.g. Shatter onto an
   *  offer to buff it pre-buy), or null. Excludes the pinned spell offer. */
  const shopUidAt = (x: number, y: number): string | null => {
    const cached = targetRectsRef.current;
    if (cached) return hitCachedUid(cached.shop, x, y);
    const el = document.elementFromPoint(x, y)?.closest(`[data-zone="tavern"] .card[data-uid]:not(.spellcard)${SB_FOE_EXCLUDE}`);
    return el?.getAttribute('data-uid') ?? null;
  };
  // Insertion index in the warband, from the pointer's x against the cards' centres.
  // `excludeUid` drops the dragged card from the count when *reordering* a board minion
  // (it's still in the DOM, so without this a rightward drag overshoots by one).
  // Count how many cached slot-midpoints the pointer x has passed (the insertion index).
  const indexFromSlots = (slots: { uid: string; left: number; width: number }[], x: number, excludeUid?: string): number => {
    let i = 0;
    for (const c of slots) {
      if (c.uid === excludeUid) continue;
      if (x > c.left + c.width * INSERT_FRAC) i++;
    }
    return i;
  };
  // Reorder insertion index that measures against each neighbour's CURRENT (shifted) position, not its resting
  // slot. As you drag a card aside, its neighbour slides a whole slot to make room; the swap-back trigger must
  // follow the neighbour's NEW spot — otherwise (measuring resting midpoints) you'd have to drag ~half a card
  // OUT to open the gap but only a sliver BACK to close it (the reported asymmetry). With the gap currently at
  // `prevGap`, the p-th non-dragged card sits in slot (p < prevGap ? p : p+1); count those whose centre is < x.
  const reorderIndexFromSlots = (
    slots: { uid: string; left: number; width: number }[],
    x: number,
    excludeUid: string,
    prevGap: number,
  ): number => {
    const g = prevGap >= 0 ? prevGap : Math.max(0, slots.findIndex((s) => s.uid === excludeUid));
    let p = 0;
    let count = 0;
    for (const c of slots) {
      if (c.uid === excludeUid) continue;
      const slot = slots[p < g ? p : p + 1] ?? c;
      if (x > slot.left + slot.width * INSERT_FRAC) count++;
      p++;
    }
    return count;
  };
  const warbandIndexAt = (x: number, excludeUid?: string): number => {
    const cached = insertRectsRef.current;
    if (cached)
      return excludeUid
        ? reorderIndexFromSlots(cached.warband, x, excludeUid, prevWarbandGapRef.current)
        : indexFromSlots(cached.warband, x);
    const cards = [...document.querySelectorAll<HTMLElement>('[data-zone="warband"] .row .card[data-uid]')];
    let i = 0;
    for (const c of cards) {
      if (c.getAttribute('data-uid') === excludeUid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width * INSERT_FRAC) i++;
    }
    return i;
  };
  // Insertion index among the shop's *minion* offers (the spell stays pinned at the end).
  const shopIndexAt = (x: number, excludeUid?: string): number => {
    const cached = insertRectsRef.current;
    if (cached)
      return excludeUid
        ? reorderIndexFromSlots(cached.shop, x, excludeUid, prevShopGapRef.current)
        : indexFromSlots(cached.shop, x);
    const cards = [...document.querySelectorAll<HTMLElement>('[data-zone="tavern"] .row .card[data-uid]')].filter(
      (c) => c.getAttribute('data-uid') !== run.spell?.uid,
    );
    let i = 0;
    for (const c of cards) {
      if (c.getAttribute('data-uid') === excludeUid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width * INSERT_FRAC) i++;
    }
    return i;
  };
  // Insertion index in the HAND from the drag x (for reordering) — counts cached slot midpoints the cursor
  // passed (against the live gap, so swaps trigger symmetrically), excluding the dragged card. Result is the
  // index in the post-removal array (matches the reducer's splice). Mirrors shopIndexAt.
  const handIndexAt = (x: number, excludeUid?: string): number => {
    const cached = insertRectsRef.current;
    if (cached?.hand)
      return excludeUid
        ? reorderIndexFromSlots(cached.hand, x, excludeUid, prevHandGapRef.current)
        : indexFromSlots(cached.hand, x);
    const cards = [...document.querySelectorAll<HTMLElement>('.row.hand .card[data-uid]')];
    let i = 0;
    for (const c of cards) {
      if (c.getAttribute('data-uid') === excludeUid) continue;
      const r = c.getBoundingClientRect();
      if (x > r.left + r.width * INSERT_FRAC) i++;
    }
    return i;
  };

  // Stable per-card view objects, keyed by uid. Recompute only when the underlying run data
  // changes — during a drag nothing dispatches, so `run.*` refs are stable and these stay
  // cached, which is what lets the memoized Card skip re-render on every pointermove.
  // Heckbinder's Fodder aura is LIVE (it applies while the card is on board), so it sits OUTSIDE the
  // permanent `run.cardBuffs` enchant map. The sim folds the two together in `cardBuff()`, but the UI was
  // passing the RAW map straight through — so a Fodder card whose only buff came from Heckbinder displayed
  // its base stats with no highlight (owner report). Rebuild the map through `cardBuff()` itself rather than
  // re-deriving the aura here, so the display can't drift from what the card is actually created with.
  // Perf (audit 2026-08-06): the Fodder-card id list is a constant of the card corpus — computed once at
  // module scope (see FODDER_CARD_IDS) instead of walking the whole CARD_INDEX (an Object.values allocation
  // over every card in the game) inside this memo. And the memo keys on the two run fields it actually
  // reads — cardBuffs (the enchant map) and board (what Heckbinder's live aura derives from) — not the whole
  // `run`, which has a fresh identity after EVERY action and forced this to recompute on each buy/roll/sell.
  const cardBuffsLive = useMemo(() => {
    const out: Record<string, { attack: number; health: number }> = { ...(run.cardBuffs ?? {}) };
    for (const id of FODDER_CARD_IDS) {
      const b = cardBuff(run, id);
      if (b.attack !== 0 || b.health !== 0) out[id] = b;
    }
    return out;
    // (deps are exact: cardBuff(run, id) reads only state.cardBuffs + state.board — verified in recruit.ts)
  }, [run.cardBuffs, run.board]);

  // Value-stability caches (perf, fix #1): the reducer `structuredClone`s the run every dispatch, so these
  // view memos rebuild fresh objects for EVERY card each action — defeating `Card`'s memo, so all cards
  // re-render on every buy/play/sell/roll. Each cache holds the previous render's view objects; the
  // `stabilize*` helpers reuse an object when its displayed content is unchanged, restoring the memo bailout so
  // only the card that actually changed re-renders. The returned map IS the next cache (current uids only, no
  // leak). See `cardViewEqual.ts`.
  /**
   * The run flags that decide (Both) — the ONE object every offer surface passes to `chooseBothActive`.
   *
   * The tavern row and the spell slot build their opts as long inline literals, and this field was simply not
   * in either of them, so a shop Veinbreaker under Rune of the Unbroken Vein printed "Choose One:" and wore no
   * marker while the copy in hand read (Both) (owner report 2026-08-28). Named and hoisted so a THIRD surface
   * is a one-word addition rather than another thing to remember.
   *
   * A future global arm — "your next Choose One triggers both" — belongs in `chooseBothActive` alongside the
   * two rune flags, and every surface reading this object lights up at once with no further wiring.
   */
  const bothState = useMemo(
    () => chooseBothStateOf(run),
    [run.runeFacetwright, run.runeUnbrokenVein, run.chooseBothCharges],
  );
  const shopViewCache = useRef(new Map<string, CardView>());
  const spellViewCache = useRef<CardView | null>(null);
  const refViewCache = useRef(new Map<string, CardView[]>());
  const boardViewCache = useRef(new Map<string, CardView>());
  const handViewCache = useRef(new Map<string, CardView>());
  const shopViews = useMemo(
    // The spell-display opts (cost mod + bonuses) ride along too, so Spell Cart's spell offers in the minion
    // row read their right cost + value, like the spell slot.
    () => {
      const fresh = new Map(run.shop.map((o) => [o.uid, shopView(o, { freeFirstBuy: (run.rift === 'freedom' || !!run.questFreeFirstBuy) && !run.freeBuyUsedThisTurn && !o.held && !CARD_INDEX[o.cardId]?.spell, cardBuffs: cardBuffsLive, tavernAtk: run.tavernBuyBonus.atk + (run.tavernBuyBonusTurn?.atk ?? 0), tavernHp: run.tavernBuyBonus.hp + (run.tavernBuyBonusTurn?.hp ?? 0), undeadAtk: run.undeadAttackBonus, undeadHp: run.undeadHealthBonus, undeadBuyAtk: run.undeadBuyAtk, beastBuyAtk: run.beastBuyAtk, beastBuyHp: run.beastBuyHp, magneticBuyAtk: run.magneticBuyAtk, magneticBuyHp: run.magneticBuyHp, deathrattlesTriggered: run.deathrattlesTriggered, spellsCast: run.spellsCast, spellsThisTurn: run.spellsThisTurn, soulsmanGold: run.soulsmanGold, impAura: run.impBuff, rubyCasts: run.rubyCasts, fodderConsumed: run.fodderConsumedThisTurn, spellCostMod: spellCostReduction(run, CARD_INDEX[o.cardId]), spellBonus, spellBonusH, frontToBackBonus: run.frontToBackBonus, frontToBackBonusH: run.frontToBackBonusH, growthBonus: run.growthBonus, goldSpent: run.goldSpentThisTurn, goldPouchValue: run.goldPouchValue, playedThisTurn: run.playedThisTurn, squirlScoutBuff: run.squirlScoutBuff, conductorBuff: run.conductorBuff, alesThisTurn: run.alesCastThisTurn, lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined, firstSpellThisTurnName: run.firstSpellThisTurnId ? CARD_INDEX[run.firstSpellThisTurnId]?.name : undefined, lastSpellThisTurnName: run.lastSpellThisTurnId ? CARD_INDEX[run.lastSpellThisTurnId]?.name : undefined, topTribe: dominantBoardTribe(run), minionCost: heroOfferPrice(run, o) ?? Math.max(0, minionCostOf(run) - gateUses(run.cadenceMinionOff)), juggler: getHero(run.heroId).power.kind === 'baldgecoin', castMult: CARD_INDEX[o.cardId]?.spell || CARD_INDEX[o.cardId]?.ruby ? spellCastCount(run, CARD_INDEX[o.cardId]!) : undefined, eotBuff: eotShopStats?.[o.uid], chooseBothState: bothState })] as const));
      shopViewCache.current = stabilizeViewMap(fresh, shopViewCache.current);
      return shopViewCache.current;
    },
    // DEP COMPLETENESS (owner report 2026-08-19: an Imp Overseer's live "(X/Y)" froze). Nine values were READ
    // above but missing here — `impBuff` (the Imp Aura the summoned-Imp stats print), `rubyCasts`,
    // `growthBonus`, `frontToBackBonusH`, the three spell-name ids, `cadenceMinionOff` and `tier`. In ordinary
    // play the omission is MASKED: the reducer `structuredClone`s the run every action, so `run.shop`'s
    // identity changes and this memo rebuilds anyway. It only bites when one of these moves while the shop
    // identity does not — which is exactly what a live-verified repro showed (board read the new Imp stats,
    // the shop row stayed on the old ones). Listing them makes the memo honest rather than relying on that
    // incidental rebuild; `stabilizeViewMap` keeps the `Card` bailout, so the added deps cost nothing when the
    // rendered content is unchanged.
    [run.shop, run.rift, run.questFreeFirstBuy, run.freeBuyUsedThisTurn, run.cardBuffs, run.tavernBuyBonus, run.tavernBuyBonusTurn, run.undeadAttackBonus, run.undeadHealthBonus, run.undeadBuyAtk, run.beastBuyAtk, run.beastBuyHp, run.magneticBuyAtk, run.magneticBuyHp, run.deathrattlesTriggered, run.spellsCast, run.spellsThisTurn, run.soulsmanGold, run.fodderConsumedThisTurn, run.spellCostMod, spellBonus, spellBonusH, run.frontToBackBonus, run.board, run.nextSpellExtraCasts, run.goldSpentThisTurn, run.goldPouchValue, run.playedThisTurn, run.squirlScoutBuff, run.conductorBuff, run.alesCastThisTurn, run.frankClearanceTurn, eotShopStats, run.impBuff, run.rubyCasts, run.growthBonus, run.frontToBackBonusH, run.lastSpellCastId, run.firstSpellThisTurnId, run.lastSpellThisTurnId, run.cadenceMinionOff, run.tier, bothState],
  );
  const spellView = useMemo(
    () => {
      const fresh = run.spell ? shopView(run.spell, { spellCostMod: spellCostReduction(run, CARD_INDEX[run.spell.cardId]), spellBonus, spellBonusH, frontToBackBonus: run.frontToBackBonus, frontToBackBonusH: run.frontToBackBonusH, growthBonus: run.growthBonus, goldSpent: run.goldSpentThisTurn, goldPouchValue: run.goldPouchValue, rubyBonus: rubyStatBonus(run), tier7Access: hasTier7Access(run), playedThisTurn: run.playedThisTurn, castMult: CARD_INDEX[run.spell.cardId]?.spell || CARD_INDEX[run.spell.cardId]?.ruby ? spellCastCount(run, CARD_INDEX[run.spell.cardId]!) : undefined, chooseBothState: bothState }) : null;
      spellViewCache.current = stabilizeView(fresh, spellViewCache.current);
      return spellViewCache.current;
    },
    [run.spell, run.spellCostMod, spellBonus, spellBonusH, run.frontToBackBonus, run.board, run.nextSpellExtraCasts, run.goldSpentThisTurn, run.goldPouchValue],
  );
  // Per-card referenced-card popups (uid → the cards it references). Stable across a drag (only
  // recomputes when the board / shop / hand or the Fodder buff changes), so it preserves the memo.
  const refViewsByUid = useMemo(() => {
    const m = new Map<string, CardView[]>();
    const add = (uid: string, cardId: string, owner?: { buffs?: { source: string; attack: number; health: number }[]; golden?: boolean }): void => {
      // The manual map first (Fodder/Imp cards whose references aren't effect params — e.g. Feed *consumes*
      // Fodder), then every card the effects actually name (summoned tokens, granted/transformed cards) so ANY
      // card that mentions another in its text surfaces it. De-duped, manual order wins.
      const def = CARD_INDEX[cardId];
      // …plus a DERIVED rule: any card whose text talks about Rubies previews the Ruby itself, at its live
      // value (owner 2026-07-25). Derived rather than hand-listed so a new Ruby card can never be forgotten —
      // there are ~20 of them across the Kobold line and the list would rot on the first one added.
      const mentionsRuby = !!def && !def.ruby && /\bRub(y|ies)\b/i.test(`${def.text} ${def.goldenText ?? ''}`);
      const refs = [...new Set([
        ...(CARD_REFERENCES[cardId] ?? []),
        ...(def ? referencedCardIds(def) : []),
        ...(mentionsRuby ? ['ruby'] : []),
      ])].filter((id) => CARD_INDEX[id]);
      const spellLive = { a: spellBonus, h: spellBonusH, ftb: run.frontToBackBonus, ftbH: run.frontToBackBonusH ?? run.frontToBackBonus, goldSpent: run.goldSpentThisTurn ?? 0, goldPouchValue: run.goldPouchValue, tier: run.tier, growthBonus: run.growthBonus };
      // `cardBuffsLive`, NOT `run.cardBuffs` — the raw map holds only the PERMANENT enchants, so a Fodder
      // token previewed here printed 3/3 while the shop card next to it showed 6/6, dropping Heckbinder's
      // live `fodderAura` (owner report 2026-07-21). Every surface that prints a buffed stat routes through
      // `cardBuff()`; this popup was the last raw reader.
      const or = owner?.buffs?.find((b) => b.source === 'Ruby');
      const ownerRuby = { attack: or?.attack ?? 0, health: or?.health ?? 0, golden: owner?.golden };
      if (refs.length) m.set(uid, refs.map((id) => tokenRefView(id, cardBuffsLive, run.impBuff, spellLive, run.rubyBonus, ownerRuby)));
    };
    for (const c of run.board) add(c.uid, c.cardId, c);
    for (const c of run.hand) add(c.uid, c.cardId, c);
    for (const o of run.shop) add(o.uid, o.cardId, o);
    refViewCache.current = stabilizeRefMap(m, refViewCache.current); // reuse unchanged ref-popup arrays (memo bailout)
    return refViewCache.current;
  }, [run.board, run.hand, run.shop, cardBuffsLive, run.impBuff, spellBonus, spellBonusH, run.frontToBackBonus, run.frontToBackBonusH, run.goldSpentThisTurn, run.rubyBonus, run.growthBonus]);
  // During the End-of-Turn animation the board shows each minion's per-proc stats (`eotAnimStats`),
  // so the numbers visibly tick up as each effect fires; otherwise the real stats.
  const live = useMemo(
    () => ({ undeadBuyAtk: run.undeadBuyAtk, soulsmanGold: run.soulsmanGold ?? 0, cardBuffs: cardBuffsLive, impAura: run.impBuff, rubyCasts: run.rubyCasts, goldSpent: run.goldSpentThisTurn ?? 0, goldSpentRun: run.goldSpent, goldPouchValue: run.goldPouchValue, playedThisTurn: run.playedThisTurn, squirlScoutBuff: run.squirlScoutBuff, conductorBuff: run.conductorBuff, alesThisTurn: run.alesCastThisTurn, lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined, firstSpellThisTurnName: run.firstSpellThisTurnId ? CARD_INDEX[run.firstSpellThisTurnId]?.name : undefined, lastSpellThisTurnName: run.lastSpellThisTurnId ? CARD_INDEX[run.lastSpellThisTurnId]?.name : undefined, topTribe: dominantBoardTribe(run), frontToBackBonusH: run.frontToBackBonusH, improveReps: run.runeMastery ? 1 + runeStacksOf(run, 'rune_mastery') : 1, rubyBonus: rubyStatBonus(run), tier7Access: hasTier7Access(run), grimoireCharged: (run.grimoireMult ?? 0) > 1, runeMammoth: !!run.questFlags?.runeMammoth, runeFlags: { matriarch: !!run.runeMatriarch, brokerage: !!run.runeBrokerage, livingTreasure: !!run.questFlags?.runeLivingTreasure }, chooseBothState: chooseBothStateOf(run) }),
    // `run.board` is a dep because `topTribe` is derived from it — without it the memo held the stale tribe
    // (and the stale spell names) until some other dep happened to move (audit find, live-verified 2026-07-31).
    // `cardBuffsLive` is the value actually consumed (not raw `run.cardBuffs`) — listing it explicitly was an
    // audit find 2026-08-06: coverage was previously incidental via the board dep.
    [run.undeadBuyAtk, run.soulsmanGold, cardBuffsLive, run.goldSpentThisTurn, run.goldSpent, run.goldPouchValue, run.playedThisTurn, run.squirlScoutBuff, run.conductorBuff, run.alesCastThisTurn, run.lastSpellCastId, run.firstSpellThisTurnId, run.lastSpellThisTurnId, run.board, run.frontToBackBonusH, run.runeMastery, run.runeStacks, run.rubyBonus, run.grimoireMult, run.questFlags?.runeMammoth, run.runeMatriarch, run.runeBrokerage, run.questFlags?.runeLivingTreasure, run.runeFacetwright, run.runeUnbrokenVein, run.impBuff],
  );
  // The board as RENDERED during End-of-Turn playback: the real board, plus any minion summoned this beat
  // (Moira re-firing a summoner) injected as a synthetic card, plus keywords granted this beat overlaid so the
  // pip shows on the beat. GUARDED: with nothing projected this is `run.board` by identity, so normal play (and
  // the memo below) is byte-identical — the injection only activates during an EoT that summons / grants a kw.
  const displayBoard = useMemo<BoardCard[]>(() => {
    if (!eotSummons.length && !eotKeywords.size && !eotTransforms.size) return run.board;
    const withKw = run.board.map((m) => {
      // TRANSFORMED THIS BEAT (Skybound Ascendant): swap the identity IN PLACE, keeping the uid and slot, so
      // the new card is rendered from the frame its beat lands rather than snapping in at the commit. Stats
      // are NOT taken from the new def — `eotAnimStats` already carries the projected absolute values (the
      // base-stat change arrived as this beat's `statsChanged`), so reading them here would double-count.
      const became = eotTransforms.get(m.uid);
      const def = became && became !== m.cardId ? CARD_INDEX[became] : undefined;
      const base = def ? { ...m, cardId: def.id, tribe: def.tribe, keywords: [...new Set([...m.keywords, ...def.keywords])] as Keyword[] } : m;
      const add = eotKeywords.get(m.uid);
      if (!add || add.size === 0 || [...add].every((k) => base.keywords.includes(k as Keyword))) return base;
      return { ...base, keywords: [...new Set([...base.keywords, ...add])] as Keyword[] };
    });
    // SPLICED at each summon's committed slot (an Imp arrives ADJACENT to its summoner) rather than appended —
    // appending flashed every arrival right-most, then the commit "corrected" it (owner report 2026-08-20).
    // Summons arrive in delivery order carrying their committed board index, so sequential splices reproduce
    // the committed order; a summon without an index (legacy batch) still appends.
    const out: BoardCard[] = [...withKw];
    for (const s of eotSummons) {
      if (run.board.some((c) => c.uid === s.uid)) continue; // once committed, the real card takes over
      const def = CARD_INDEX[s.cardId];
      const ghost = { uid: s.uid, cardId: s.cardId, tribe: def?.tribe ?? 'neutral', attack: def?.attack ?? 0, health: def?.health ?? 0, keywords: [...(def?.keywords ?? [])], golden: false } as BoardCard;
      out.splice(s.index !== undefined ? Math.min(s.index, out.length) : out.length, 0, ghost);
    }
    return out;
  }, [run.board, eotSummons, eotKeywords, eotTransforms]);
  // `view:board` / `view:hand` (perf export): building the per-card view + live text for every board/hand card.
  // Memoized, but rebuilds whenever `run.board`/`run.hand` identity changes — i.e. every dispatch (buy/play/weld).
  // If a heavily-attached late-game board makes these dominate a fanout frame, this is where it shows.
  const boardViews = useMemo(
    () => perfMonitor.measure('view:board', () => {
      const fresh = new Map(displayBoard.map((m) => [m.uid, instView(m, run.tier, eotAnimStats?.[m.uid], spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs?.cling, run.fodderConsumedThisTurn, { ...live, onBoard: true, eotTickOverride: eotAnimTick?.[m.uid] })] as const));
      boardViewCache.current = stabilizeViewMap(fresh, boardViewCache.current);
      return boardViewCache.current;
    }),
    [displayBoard, run.tier, eotAnimStats, eotAnimTick, spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs, run.fodderConsumedThisTurn, live],
  );
  const handViews = useMemo(
    () => perfMonitor.measure('view:hand', () => {
      const fresh = new Map(run.hand.map((m) => [m.uid, instView(m, run.tier, eotAnimStats?.[m.uid], spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs?.cling, run.fodderConsumedThisTurn, CARD_INDEX[m.cardId]?.spell || CARD_INDEX[m.cardId]?.ruby ? { ...live, castMult: spellCastCount(run, CARD_INDEX[m.cardId]!) } : live)] as const));
      handViewCache.current = stabilizeViewMap(fresh, handViewCache.current);
      return handViewCache.current;
    }),
    [run.hand, run.tier, eotAnimStats, spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs, run.fodderConsumedThisTurn, live, run.board, run.nextSpellExtraCasts],
  );
  // SPELL BUFF cue (owner 2026-07-23): when a hand SPELL or Ruby gets stronger, grow/shrink it and blast
  // sparks outward, so the player sees exactly which cards a spell buff touched. A spell's stats never
  // change (it's a 0/1 card) — its printed VALUE is the thing that moves — so we diff the rendered live text
  // (plus stats, which is what moves on a Ruby) per uid. That catches every scaling source at once (spell power,
  // Front to Back's escalation, the Ruby stat line, Rune of Pillaging's pouch, …) without enumerating them, and
  // picks up future ones for free. Only cards ALREADY in hand can fire it, so drawing a card never flashes.
  useEffect(() => {
    const next = new Map<string, string>();
    const changed: string[] = [];
    for (const [uid, v] of handViews) {
      if (!v.spell && !v.ruby) continue; // minions keep the existing green buff flash
      const sig = `${v.text}|${v.attack}/${v.health}`;
      next.set(uid, sig);
      const prev = prevSpellSigRef.current.get(uid);
      if (prev !== undefined && prev !== sig) changed.push(uid);
    }
    prevSpellSigRef.current = next;
    // This watcher owns SHOP-PHASE buffs only. End of Turn and mid-combat are driven from their BEATS instead
    // (the EoT beat runner below, and the `sc` narration handler in `useCombatReplay`), because run state
    // doesn't move at the moment those buffs happen — it moves at the commit, which is too late to read as
    // "this card just got stronger".
    //
    // That split is what fixes the double-play (owner report 2026-07-24: "cards play an additional buffed
    // animation at the end of combat if they were buffed mid-combat"). A mid-combat gain is announced once, on
    // its beat; then `settleCombat` applies the carry-back — while the phase is STILL `combat` — and the
    // printed text finally changes, which this diff would otherwise fire on a second time.
    //
    // So: fire only in steady-state recruit. Skipping the phase-FLIP renders matters too, in both directions —
    // a card's printed text can legitimately differ between phases, so diffing across a flip would flash the
    // whole hand for no buff at all. Signatures above are recorded on every render regardless, so the baseline
    // stays current and a real shop buff on the very next render fires normally.
    const phaseFlipped = spellBuffPhaseRef.current !== run.phase;
    spellBuffPhaseRef.current = run.phase;
    if (phaseFlipped || run.phase !== 'recruit' || changed.length === 0) return;
    fireSpellBuff(changed);
  }, [handViews, run.phase]);
  // DEV: the ✨ Spell Buff tuner's Test button fires the cue on every spell / Ruby currently in hand, so the
  // effect can be dialed without waiting for a real buff. It goes through the SAME `fireSpellBuff` the real
  // watcher uses, so mashing Test exercises the retrigger/restart path exactly as a rapid buff chain would.
  useEffect(() => {
    if (!import.meta.env.DEV) return undefined;
    const w = window as { __spellBuffTest?: () => void };
    w.__spellBuffTest = (): void => {
      fireSpellBuff([...handViews].filter(([, v]) => v.spell || v.ruby).map(([uid]) => uid));
    };
    return () => { delete w.__spellBuffTest; };
  }, [handViews]);
  // `render:recruit` (perf export): render body + React reconciliation + DOM commit for THIS render — the delta
  // from `renderStart` (top of the component) to this earliest post-commit layout effect. No deps → every commit.
  // Defined ahead of the Flip effect so it excludes Flip's cost. This is the number that goes up late-game.
  useLayoutEffect(() => { perfMonitor.record('render:recruit', performance.now() - renderStart); });
  // Tavern offers that would complete a Gild if bought — flagged with a gold glow + floating arrows. Mirrors
  // `checkTriples`' counting AND its threshold: the copies needed is 3 normally but 2 under Rune of Twin
  // Gilding or Midas' Touch, so the number you must already hold is `need - 1`. This was hardcoded to 2, so a
  // Midas player (who Gilds at 2) saw NO highlight on the duplicate that would complete it (owner 2026-08-21).
  const tripleReadyUids = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of [...run.board, ...run.hand]) {
      // Mirrors the reducer's `checkTriples` eligibility (spells/Rubies/`noTriple` never combine) so the shop
      // can't light up a "this completes a triple" pip for a combine that will never happen.
      const cd = CARD_INDEX[c.cardId];
      if (!c.golden && !cd?.spell && !cd?.ruby && !cd?.noTriple) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
    const out = new Set<string>();
    for (const o of run.shop) {
      const cd = CARD_INDEX[o.cardId];
      if (!cd?.spell && !cd?.ruby && !cd?.noTriple && (counts.get(o.cardId) ?? 0) >= gildCopiesNeeded(run) - 1) out.add(o.uid);
    }
    return out;
  }, [run.board, run.hand, run.shop, run.heroId, run.runeTwinGilding]);

  // A single stable pointer-down handler shared by every card: it reads the grabbed card's uid
  // + zone from the DOM and its view from this ref, so the handler's identity never changes
  // mid-drag (a fresh per-card closure would defeat Card's memo). Replaces the old per-card
  // `beginDrag(uid, source, view)` factory.
  const viewsRef = useRef({ shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid });
  viewsRef.current = { shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid };
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent): void => {
      if (e.button !== 0 || inCombat || useGame.getState().endTurnAnimating) return; // no dragging in combat / mid end-of-turn
      // A REPLAY VIEWER may not drag. The buy/sell it would produce is swallowed by `dispatch` anyway, so the
      // only thing a drag could do here is pick a card up and put it back — while fighting the playback that
      // owns the board. Read live from the store: this callback's deps do not include the session.
      if (useGame.getState().replaying) return;
      // Edit mode claims the click outright: a bare pointerdown on a board card otherwise starts a drag, and a
      // drag that begins under an open editor would move the card you are editing. Read sbEditMode/run LIVE
      // from the store (not the component-scope `sbEditMode`/`run` closed over here) — this callback's deps
      // are [timeUp, inCombat], so those closures can be stale by the time a click lands (same reasoning as
      // the Disco Dan `liveRun` read just below).
      {
        const { sbEditMode: liveEditMode, run: liveRun } = useGame.getState();
        if (liveEditMode && liveRun.sandbox) {
          const editEl = (e.currentTarget as HTMLElement).closest('[data-uid]');
          const editUid = editEl?.getAttribute('data-uid');
          if (editUid !== null && editUid !== undefined && liveRun.board.some((c) => c.uid === editUid)) {
            e.preventDefault();
            e.stopPropagation();
            setSbEditing({ uid: editUid, rect: (editEl as HTMLElement).getBoundingClientRect() });
            return;
          }
        }
      }
      const el = e.currentTarget as HTMLElement;
      const uid = el.dataset.uid;
      if (!uid) return;
      const zone = el.closest('[data-zone]')?.getAttribute('data-zone');
      const source: DragSource = zone === 'warband' ? 'board' : zone === 'hand' ? 'hand' : 'shop';
      // Disco Dan: a Setlist card is locked in hand until you reach its shop tier — it can't be dragged out
      // or played (the reducer also refuses the play). Read the LIVE run from the store (not this callback's
      // closed-over `run`, which is only refreshed on [timeUp, inCombat]): so an upgrade unlocks the card the
      // SAME turn, and a stale run left over from a previous hero can't false-lock a uid-colliding card
      // (both runs start uidSeq at 0, so a fresh buy can share a locked Setlist card's uid).
      if (source === 'hand') {
        const liveRun = useGame.getState().run;
        const hc = liveRun.hand.find((c) => c.uid === uid);
        if (hc?.lockedUntilTier && liveRun.tier < hc.lockedUntilTier) return;
        // Brackus's Summit pick: same guard on the GOLD meter (the reducer also rejects it, this stops the drag).
        if (hc?.lockedUntilGoldSpent && (liveRun.goldSpent ?? 0) < hc.lockedUntilGoldSpent) return;
      }
      // When the timer's up you can still REORDER your board, but not play / buy / sell — so allow a board
      // drag through, block hand + shop drags.
      if (timeUp && source !== 'board') return;
      const v = viewsRef.current;
      const view =
        source === 'board'
          ? v.boardViews.get(uid)
          : source === 'hand'
            ? v.handViews.get(uid)
            : uid === v.spellUid
              ? v.spellView ?? undefined
              : v.shopViews.get(uid);
      if (!view) return;
      const r = el.getBoundingClientRect();
      // The floating card renders at its FULL, untransformed size — but a hand card is scaled down by the fan
      // (~0.9) and tucked, so `getBoundingClientRect` returns the SCALED box. Sizing the wrapper from that made
      // it smaller than the `<Card>` inside, so the art box overflowed and the text drawer sat off-centre. Use
      // the layout size (`offsetWidth/Height`, which ignore transforms) for the wrapper, and take the grab
      // point as a scale-invariant FRACTION of the rect mapped onto the full size. For an untransformed
      // board/shop card `offsetWidth === r.width`, so this is a no-op there.
      const w = el.offsetWidth || r.width;
      const h = el.offsetHeight || r.height;
      const fracX = r.width ? (e.clientX - r.left) / r.width : 0.5;
      const fracY = r.height ? (e.clientY - r.top) / r.height : 0.5;
      // capture the pointer so move/up keep firing even if it leaves the window or races
      // ahead of the floating card — events still bubble to the window listeners.
      try { el.setPointerCapture(e.pointerId); } catch { /* unsupported / detached */ }
      dragIsTouchRef.current = e.pointerType !== 'mouse'; // touch/pen → snap to the finger (see dragIsTouchRef)
      // REPLAY V2 drag-path capture ("1:1 hands"): the grab point opens the trace. Capture is the product
      // (DEV + prod alike); guarded off during playback, where input is inert anyway. One push, no layout.
      if (!useGame.getState().replaying) beginDragTrace(view.cardId, e.clientX, e.clientY);
      setDrag({
        uid, source, view,
        ox: w / 2, oy: h / 2,                        // anchor = centre → the card rides centred on the cursor
        grabOx: fracX * w, grabOy: fracY * h,        // where you actually grabbed (recentre starts here), full-size
        w, h,
        startX: e.clientX, startY: e.clientY,
        x: e.clientX, y: e.clientY,
        active: false,
      });
    },
    [timeUp, inCombat],
  );

  useEffect(() => {
    if (!drag) return;
    // The sell region is the whole upper screen — everything above the warband. A board minion released
    // anywhere up there sells (not just over the tavern box). `source`/`view` are fixed for the drag.
    // Cache the zone geometry once per drag: the zone *containers* hold their position while dragging
    // (only the cards inside them shift), so we can hit-test the pointer against cached rects instead of
    // calling elementFromPoint / getBoundingClientRect every frame — both force a synchronous layout,
    // the main source of drag micro-stutter.
    // Dev Layout Lab "Buy/Sell zones": nudge the sell/buy boundaries (both the overlay + the drop hit-test).
    // getLayout() is a cheap singleton read (defaults → 0 in prod, so a no-op there). Read once per drag start.
    const zoneCfg = getLayout();
    const wbTop = (document.querySelector('[data-zone="warband"]')?.getBoundingClientRect().top ?? 0) + (zoneCfg.sellZoneY ?? 0);
    // The board's horizontal midline (background divider): the .app's vertical centre, since the board art is
    // cover-centred so its centre split maps there. Buying requires releasing a shop card BELOW this line.
    const appR = document.querySelector('.app')?.getBoundingClientRect();
    const midlineY = (appR ? appR.top + appR.height / 2 : wbTop) + (zoneCfg.buyZoneY ?? 0);
    const zoneRects = [...document.querySelectorAll<HTMLElement>('[data-zone]')].map((el) => ({
      zone: el.getAttribute('data-zone') as Zone,
      r: el.getBoundingClientRect(),
    }));
    const zoneAtCached = (x: number, y: number): Zone | null => {
      for (const { zone, r } of zoneRects) {
        if (x >= r.left && x <= r.right && y >= r.top && y <= r.bottom) return zone;
      }
      return null;
    };
    // Minimum play height for a HAND minion: release above this line plays it, below (nearer the hand) cancels
    // back to hand. Sit it 10% of the play area (tavern top → warband bottom) up from the warband's bottom, so
    // the low band by the hand no longer counts as playable. Fallback = Infinity (play anywhere) if unmeasured.
    const wbRect = zoneRects.find((z) => z.zone === 'warband')?.r;
    const tvRect = zoneRects.find((z) => z.zone === 'tavern')?.r;
    const handRect = zoneRects.find((z) => z.zone === 'hand')?.r;
    playFloorRef.current = wbRect
      ? wbRect.bottom - 0.1 * (tvRect ? wbRect.bottom - tvRect.top : wbRect.height)
      : Infinity;
    // Spells arm on a lower line: slide it from the warband's bottom (spellLine 0) down toward the hand's top
    // (spellLine 1) — higher = less drag to cast. Falls back to the minion play floor if the hand is unmeasured.
    spellFloorRef.current = wbRect && handRect
      ? wbRect.bottom + getDragFeel().spellLine * (handRect.top - wbRect.bottom)
      : playFloorRef.current;
    // For a spell drag (targeting a friendly minion / any offer), cache the candidate card rects up front:
    // the board/shop don't shift during a spell drag, so targeting hit-tests these instead of elementFromPoint.
    const measureCards = (sel: string): { uid: string; r: DOMRect }[] =>
      [...document.querySelectorAll<HTMLElement>(sel)]
        .map((el) => ({ uid: el.getAttribute('data-uid') ?? '', r: el.getBoundingClientRect() }))
        .filter((c) => c.uid);
    targetRectsRef.current =
      (drag.view.spell || drag.view.ruby) && (drag.view.target === 'friendly' || drag.view.target === 'any')
        ? {
            board: measureCards('[data-zone="warband"] .row .card[data-uid]'),
            shop: drag.view.target === 'any' ? measureCards(`[data-zone="tavern"] .card[data-uid]:not(.spellcard)${SB_FOE_EXCLUDE}`) : [],
          }
        : null;
    // Cache the resting insertion slots (left + width) for the reorder/magnetize gap, so warbandIndexAt/
    // shopIndexAt count cached midpoints instead of forcing a getBoundingClientRect reflow every frame.
    const measureSlots = (sel: string): { uid: string; left: number; width: number }[] =>
      [...document.querySelectorAll<HTMLElement>(sel)]
        .map((el) => {
          const r = el.getBoundingClientRect();
          return { uid: el.getAttribute('data-uid') ?? '', left: r.left, width: r.width };
        })
        .filter((c) => c.uid);
    // Measure the hand slots directly — rotated fan rects and all. Each card's rotation pivots near its centre,
    // so the axis-aligned bbox stays centred on the card and the slot midpoints match the flat centres within a
    // pixel or two. (Flattening the fan first to "clean up" the rects would transition them back on removal —
    // the cards visibly flatten then re-fan on every pickup, the jiggle we're avoiding.)
    const handSlots = measureSlots('.row.hand .card[data-uid]');
    insertRectsRef.current = {
      warband: measureSlots('[data-zone="warband"] .row .card[data-uid]'),
      shop: measureSlots('[data-zone="tavern"] .row .card[data-uid]').filter((c) => c.uid !== run.spell?.uid),
      hand: handSlots,
    };
    // Hand slot spacing = the gap between consecutive card lefts (they overlap, so it's < card width). Used to
    // size the reorder parting so cards shift exactly one slot. Falls back to the card width for a 1-card hand.
    handSlotWRef.current = handSlots.length >= 2 ? handSlots[1]!.left - handSlots[0]!.left : handSlots[0]?.width ?? 0;
    // Fresh drag → no prior gap yet; the index fns fall back to the dragged card's home slot for frame one.
    prevWarbandGapRef.current = -1;
    prevShopGapRef.current = -1;
    prevHandGapRef.current = -1;
    const inSellRegion = (y: number): boolean => drag.source === 'board' && !drag.view.spell && !timeUp && y < wbTop;
    if (drag.source === 'board' && !drag.view.spell) setSellTop(wbTop);
    if (drag.source === 'shop') setBuyTop(midlineY);
    // Buying: a shop card released BELOW the board's midline (the background divider) buys it — the whole lower
    // half (warband row + hand). Above the line it snaps back, so a card hovered up by the offers won't buy.
    const inBuyRegion = (y: number): boolean => drag.source === 'shop' && y > midlineY;
    // Move handling has TWO rates, deliberately.
    //
    // rAF-coalescing alone caps re-renders at the REFRESH rate — which is 60/s on a 60Hz panel but 240/s on
    // a 240Hz one, so a high-refresh monitor quadruples React's work for the identical drag. That showed up
    // in the 2026-07-19 capture as buckets of 100-388 `recruit renders`/sec, and a 74ms long task whose only
    // measured hotspot was a 0.4ms reducer call (i.e. it was all React).
    //
    // So: VISUALS run frame-exact off `dragPosRef` (card transform, aim line, trail — none of them need a
    // render), while the React STATE only advances once the pointer has moved far enough to change a layout
    // decision. Every derived value the render computes from the position — the insertion slot, the magnet
    // hover target, the cast target, the lift threshold, the drop zone — changes at CARD-scale distances
    // (~100px), so an 8px quantum is imperceptible (~3ms of travel) while cutting renders several-fold.
    // Motion-trail bookkeeping: the viewport point of the last wisp emit (null until the drag goes active).
    let trailLast: { x: number; y: number } | null = null;
    let moveRaf = 0;
    let lastMove: PointerEvent | null = null;
    // The position/zone last pushed into React state — the baseline the quantum is measured against.
    let committed: { x: number; y: number } | null = null;
    let lastZone: Zone | null = null;
    // The geometry hit-tests the decision needs — same in-component closures the render passes, so `flushMove`'s
    // gate and the render can't diverge. They read the per-drag rect cache populated just above.
    const gateGeo: DragGeo = { warbandIndexAt, shopIndexAt, handIndexAt, boardUidAt, shopUidAt };
    const flushMove = (): void => { perfMonitor.measure('drag:flushMove', () => {
      moveRaf = 0;
      const e = lastMove;
      if (!e) return;
      lastMove = null;
      const d0 = dragRef.current;
      const willBeActive = !!d0 && (d0.active || Math.hypot(e.clientX - d0.startX, e.clientY - d0.startY) > getDragFeel().threshold);
      // The spell aim line follows the cursor EXACTLY (every frame), even though the state behind it only
      // advances on the decision gate — otherwise the line would visibly step.
      if (castAimRef.current.casting && d0) {
        pixiFx.setAimLine({ x: d0.startX, y: d0.startY }, { x: e.clientX, y: e.clientY }, castAimRef.current.onTarget, getAimFxConfig());
      }
      const zone = inSellRegion(e.clientY) ? 'tavern' : inBuyRegion(e.clientY) ? 'hand' : zoneAtCached(e.clientX, e.clientY);
      // Re-render only when a VISIBLE decision changes — not on every quantum of travel. The dragged card, aim
      // line and trail all ride `dragPosRef` frame-exact, so a `setDrag` only ever buys the DECISION-driven
      // layer: the drop-gap slides, the magnetize/cast highlights, and the aim reticle. Those change at CARD
      // scale (~100px) or on an aim/zone crossing — comparing the decision at the exact cursor to the one still
      // shown (from the last committed point) drops the ~10-20× no-op renders the old 8px position-quantum made
      // (the late-game drag/APM hitch). Zone + active are kept as explicit terms: `overZone` also drives the
      // sell/buy-zone glow + `canDropHand`, and the active flip must never be delayed.
      const decOf = (x: number, y: number, z: Zone | null): DragDecision =>
        deriveDragDecision({
          drag: d0, x, y, overZone: z, magSlide: magSlideRef.current, playFloor: playFloorRef.current, spellFloor: spellFloorRef.current,
          collapseY: getDragFeel().collapseY, boardMax: CONFIG.boardMax, board: run.board, spellUid: run.spell?.uid, geo: gateGeo,
          asksChoiceFirst: asksFirstRef.current,
        });
      const shownDec = committed ? decOf(committed.x, committed.y, lastZone) : null;
      const decisionChanged =
        !shownDec ||
        !dragDecisionEqual(decOf(e.clientX, e.clientY, zone), shownDec) ||
        computeCastingSpell(d0, e.clientY, spellFloorRef.current, asksFirstRef.current)
          !== computeCastingSpell(d0, committed!.y, spellFloorRef.current, asksFirstRef.current);
      if (decisionChanged || willBeActive !== (d0?.active ?? false) || zone !== lastZone) {
        committed = { x: e.clientX, y: e.clientY };
        lastZone = zone;
        setDrag((d) => (d ? { ...d, x: e.clientX, y: e.clientY, active: willBeActive } : d));
        setOverZone(zone);
      }
      // Wind-whoosh trail: distance-gated wisps behind the dragged card (gold for Divine Shield, blue for Reborn).
      const dNow = dragRef.current;
      if (dNow?.active) {
        const cx = e.clientX; // the card rides centred on the cursor (ox/oy are the centre)
        const cy = e.clientY;
        if (!trailLast) trailLast = { x: cx, y: cy };
        const tdx = cx - trailLast.x;
        const tdy = cy - trailLast.y;
        if (Math.hypot(tdx, tdy) >= getTrailConfig().emitSpacing) {
          const kw = dNow.view.keywords;
          const variant = kw.includes('DS') ? 'gold' : kw.includes('R') ? 'blue' : 'wind';
          pixiFx.trail(cx, cy, tdx, tdy, variant);
          trailLast = { x: cx, y: cy };
        }
      } else {
        trailLast = null;
      }
    }); };
    const onMove = (e: PointerEvent): void => {
      dragPosRef.current = { x: e.clientX, y: e.clientY }; // exact, every event — the visual layers read this
      sampleDragTrace(e.clientX, e.clientY); // replay drag-path capture — self-throttled to ~30 Hz, no layout
      lastMove = e;
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    };
    const onUp = (e: PointerEvent): void => {
      dragPosRef.current = null; // this drag is over — never let its last point bleed into the next one
      const d = dragRef.current;
      // Recompute "did it move" from the up event too: with the rAF-throttle a flick completed inside one
      // frame may not have flushed `active` yet, but it's still a drag if the pointer cleared the threshold.
      const moved = !!d && (d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > getDragFeel().threshold);
      if (!d || !moved) {
        cancelDragTrace(); // a click, not a drag — nothing to replay
        document.body.classList.remove('dragging');
        // a click, not a drag — let onClick (hero targeting) handle it
        setDrag(null);
        setOverZone(null);
        return;
      }
      // REPLAY V2 drag-path capture: close the trace at the release point, BEFORE the drop resolves — the
      // drop's dispatch (same tick, or the magnetic-merge slide ~260 ms later) takes it; a drop that
      // dispatches nothing just leaves it to go stale (takeDragTrace discards it).
      endDragTrace(e.clientX, e.clientY);
      // Resolve the drop zone *before* clearing body.dragging, so the status bar (and
      // hero) stay click-through and a card can land on the hand tucked behind them.
      // A board minion released anywhere above the warband sells (the whole upper screen); a shop card
      // released anywhere below the warband line buys (the whole lower screen).
      const zone = inSellRegion(e.clientY) ? 'tavern' : inBuyRegion(e.clientY) ? 'hand' : zoneAt(e.clientX, e.clientY);
      // Snapshot the row's live positions BEFORE it reflows (and before body.dragging removal snaps their
      // transforms) so a hand-play / board-reorder / shop-reorder commit can FLIP each neighbour from where it
      // actually sits to its final slot — no jump when a fast "land it far over" release outran the throttled
      // preview, and no replay of the dragged card's whole move.
      const handMinionDrop = d.source === 'hand' && !d.view.spell && !d.view.ruby && zone === 'warband';
      const boardReorderDrop = d.source === 'board' && zone === 'warband';
      const shopReorderDrop = d.source === 'shop' && zone === 'tavern' && d.uid !== run.spell?.uid;
      // A SELL (board→tavern) re-centres the WARBAND; a BUY (shop→hand) re-centres the TAVERN. During the
      // pull-out drag the source row already slid its survivors to the closed-gap (re-centred) spots via
      // boardSlide/shopSlide, so snapshot their LIVE positions here too and route them through the same
      // drop-time FLIP as a reorder. The commit then glides each survivor from where it visually sits (already
      // re-centred) → its final slot ≈ zero motion — instead of the commit-branch FLIP snapping them back to
      // the full-row layout and re-sliding (the reported "replay the sliding motion after a sell/buy").
      const sellDrop = d.source === 'board' && zone === 'tavern' && !d.view.spell && !timeUp;
      const buyDrop = d.source === 'shop' && zone === 'hand';
      const flipZoneSel =
        handMinionDrop || boardReorderDrop || sellDrop
          ? '[data-zone="warband"] .row .card[data-uid]'
          : shopReorderDrop || buyDrop
            ? '[data-zone="tavern"] .row .card[data-uid]'
            : null;
      if (flipZoneSel) {
        const m = new Map<string, number>();
        document.querySelectorAll<HTMLElement>(flipZoneSel).forEach((el) => {
          const uid = el.dataset.uid;
          // Exclude the dragged card itself on a reorder: it rode the drag overlay, so its in-row element still
          // sits at its OLD slot. Capturing it would make the commit FLIP replay the whole move (the "swap
          // replays after the drop" bug). Left out → it just appears at its committed slot with no slide.
          if (uid && uid !== d.uid) m.set(uid, el.getBoundingClientRect().left);
        });
        handFlipRef.current = m;
        handFlipSelRef.current = flipZoneSel; // remember which row to FLIP when the commit lands
      }
      document.body.classList.remove('dragging'); // cursor reverts on release

      // Magnetic merge: a Magnetic minion dropped onto a friendly minion sharing one of its tribes
      // first "lands", then slides in (left→right) with electricity, and only then merges.
      const magIdx =
        d.source === 'hand' && d.view.keywords.includes('M') && zone === 'warband'
          ? warbandIndexAt(e.clientX - d.ox + d.w / 2)
          : -1;
      const magMech = magIdx >= 0 ? run.board[magIdx] : undefined;
      if (magMech && magnetizesTo(d.view.cardId, magMech.cardId, magMech.addedTribes, magMech.allTribes)) {
        const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${magMech.uid}"]`);
        if (el) {
          const r = el.getBoundingClientRect();
          setMagSlide(true); // the drone shrinks straight into the Mech…
          setMagTargetUid(magMech.uid); // …and the Mech crackles as it absorbs it
          setDrag((cur) => (cur ? { ...cur, x: r.left + r.width / 2, y: r.top + r.height / 2 } : cur));
        }
        window.setTimeout(() => {
          dispatch({ type: 'play', uid: d.uid, toIndex: magIdx }); // reducer merges into the Mech (stats pop)
          setMagSlide(false);
          setDrag(null);
          setOverZone(null);
          // let the Mech keep crackling a beat past the merge, then settle on the green buff flash
          window.setTimeout(() => setMagTargetUid(null), 120);
          // Commit `magWeldLeadMs` BEFORE the slide ends so the weld ring starts while the card is still
          // finishing its shrink. Previously the dispatch waited for the full slide, so the card vanished,
          // then nothing happened for a dispatch + commit + rAF, and only THEN did the ring appear — a dead
          // beat in the middle of a ~640ms sequence, which is what read as janky when playing Attachments.
        }, el ? Math.max(0, getDragFeel().magSlideMs - getDragFeel().magWeldLeadMs) : 0);
        return;
      }

      const acted = applyDrop(d, zone, e.clientX, e.clientY);
      // Route drag-drop commits through the manual per-card FLIP (see `handPlaySnapRef`) instead of the
      // whole-row Flip.from, which would replay the dragged card's move after the drop. Covers a played hand
      // minion entering the board, a board/shop-offer reorder, AND a SELL / BUY pull-out — each snapshotted its
      // row's live spots above and glides only the cards that actually shifted (the dragged card is excluded,
      // so it never re-slides; on a sell/buy the survivors already sat re-centred, so they barely move).
      if (acted && (handMinionDrop || boardReorderDrop || shopReorderDrop || sellDrop || buyDrop)) handPlaySnapRef.current = true;
      // Slide the DRAGGED card the last stretch into its committed slot (the settle FLIP excludes it, so it
      // would otherwise teleport). Same motion as a buy, 30% faster. Only place/reorder — a buy runs its own
      // slide, a sell removes the card. The release box is the live `.dragcard` rect (its true visual spot,
      // lag included), captured before `setDrag(null)` unmounts it below.
      if (acted && (handMinionDrop || boardReorderDrop || shopReorderDrop) && flipZoneSel) {
        const dc = document.querySelector<HTMLElement>('.dragcard');
        const b = dc?.getBoundingClientRect();
        if (b && b.width > 0) {
          placePendingRef.current = { uid: d.uid, sel: flipZoneSel, from: { x: b.left, y: b.top, w: b.width, h: b.height } };
        }
      }
      if (acted || d.view.spell || d.view.ruby) {
        // a spell / Ruby that misses just ends — it was never lifted from the hand
        setDrag(null);
        setOverZone(null);
      } else {
        // invalid drop — snap the card cleanly + quickly back to its original slot. The card rides CENTRED on
        // the cursor, so aim its centre at the slot centre (press point − grab offset + half-card).
        setSnapping(true);
        setDrag((cur) => (cur ? { ...cur, x: cur.startX - cur.grabOx + cur.w / 2, y: cur.startY - cur.grabOy + cur.h / 2 } : cur));
        window.setTimeout(() => {
          setSnapping(false);
          setDrag(null);
          setOverZone(null);
        }, getDragFeel().snapMs);
      }
    };
    // Right-click while aiming a spell cancels it (snaps back to the hand).
    const onCtx = (e: MouseEvent): void => {
      if (dragRef.current?.view.spell || dragRef.current?.view.ruby) {
        e.preventDefault();
        cancelDragTrace(); // an aborted aim never labels a later action
        setDrag(null);
        setOverZone(null);
      }
    };
    window.addEventListener('pointermove', onMove);
    window.addEventListener('pointerup', onUp);
    window.addEventListener('pointercancel', onUp);
    window.addEventListener('contextmenu', onCtx);
    return () => {
      if (moveRaf) cancelAnimationFrame(moveRaf);
      targetRectsRef.current = null;
      insertRectsRef.current = null;
      window.removeEventListener('pointermove', onMove);
      window.removeEventListener('pointerup', onUp);
      window.removeEventListener('pointercancel', onUp);
      window.removeEventListener('contextmenu', onCtx);
    };
  }, [drag?.uid]);

  // Drive the closed-fist cursor strictly off drag state, so it can never get
  // stranded on (the bug where the grab cursor stuck after the first drag).
  useEffect(() => {
    if (!drag?.active) return;
    document.body.classList.add('dragging');
    return () => document.body.classList.remove('dragging');
  }, [drag?.active]);

  // Align the charge glyph to the board's midline (the background divider) at any resolution/aspect. The glyph is
  // a direct child of `.app` (NOT the warband zone), so it's independent of the warband layout offset (x/y/scale) —
  // it sticks to the board sigil no matter how the warband cards are repositioned. `--charge-y` = the offset from
  // `.app`'s top down to its vertical centre (where the cover-centred board's split lands), set on `.app` so the
  // glyph inherits it. A ResizeObserver re-measures on window / letterbox / resolution changes.
  useLayoutEffect(() => {
    const app = document.querySelector<HTMLElement>('.app');
    if (!app) return;
    const update = (): void => {
      const ar = app.getBoundingClientRect();
      // The art divider sits a touch above the exact centre, so bias the anchor up a smidge to land on it. The
      // bias must SCALE with the stage (19 reference px = the tuned 14px at the owner's 0.745-scale stage) —
      // fixed px rode proportionally higher on a short phone stage ("rope too high", owner's mobile test).
      app.style.setProperty('--charge-y', `${ar.height / 2 - 19 * (ar.height / 1440)}px`);
    };
    update();
    const ro = new ResizeObserver(update);
    ro.observe(app);
    return () => ro.disconnect();
  }, [inCombat]);

  // Hero Power targeting: arm by pressing the hero, then drag a glowing line to a minion
  // and release on it. Fortify targets "a minion" — your warband OR a tavern offer (not the
  // tavern spell); a tavern buff rides in when the offer is bought. Release off a minion to
  // cancel; a plain click stays armed for a follow-up click.
  useEffect(() => {
    if ((!heroArmed && !equipArmed) || inCombat) {
      setAimTargetUid(null);
      return;
    }
    let moved = false;
    // Fortify may buff a tavern offer; Gild / Encore are warband-only (you can't gild or replay an
    // unbought offer), so they only accept warband targets.
    const sel = equipArmed
      ? '[data-zone="warband"] .row .card[data-uid]' // Bloodpot (and every Equipment so far) buffs YOUR board
      : heroTargetsTavernOnly
      ? `[data-zone="tavern"] .row .card[data-uid]${SB_FOE_EXCLUDE}` // Albus upgrades the SHOP, never your board
      : heroTargetsTavern
        ? `[data-zone="warband"] .row .card[data-uid], [data-zone="tavern"] .row .card[data-uid]${SB_FOE_EXCLUDE}`
        : '[data-zone="warband"] .row .card[data-uid]';
    const minionAt = (x: number, y: number): { uid: string } | null => {
      const el = document.elementFromPoint(x, y)?.closest(sel);
      const uid = el?.getAttribute('data-uid');
      if (!uid || uid === run.spell?.uid) return null; // a minion, never the spell
      // Displace can't target a golden (triple) — it never lights up as a valid pick.
      if (heroTargetsNoGolden && run.board.find((c) => c.uid === uid)?.golden) return null;
      return { uid };
    };
    // ANCHOR: measured ONCE per aim. The hero-power button cannot move while you're aiming, so re-reading
    // its rect on every pointermove was pure waste (and the same "cache the reads" rule the drag path
    // already follows via `insertRectsRef`).
    //
    // ...and it must be the button that is ACTUALLY ARMED. `.statusbar .heropowerbtn` matches the FIRST power
    // button in document order, which is always the hero's native one — so aiming Equipment drew its line out
    // of the hero power instead (owner report 2026-08-28). Three buttons can exist at once now (native, a
    // second power, Equipment), so the anchor is chosen from what is armed rather than from what is first.
    const anchorSel = equipArmed
      ? '.statusbar .equipslot .heropowerbtn'
      : heroArmedSlot === 1
        ? '.statusbar .heropanel2 .heropowerbtn'
        : '.statusbar .heropanel:not(.heropanel2):not(.equipslot) .heropowerbtn';
    const anchorEl = document.querySelector(anchorSel)
      // Fall back to the first button, then the hero frame — an anchor is better than no aim line at all.
      ?? document.querySelector('.statusbar .heropowerbtn')
      ?? document.querySelector('.statusbar .hero .f');
    if (!anchorEl) return;
    const ar = anchorEl.getBoundingClientRect();
    const ox = ar.left + ar.width / 2;
    const oy = ar.top + ar.height / 2;

    // The aim line is drawn by PIXI, not React — so the cursor coordinates never need to be React state.
    // Only `targetUid` does (it drives the `targeted` highlight on a card). Previously every pointermove
    // called setAim() with a fresh object, re-rendering the largest component in the app at pointer rate
    // (well above 60Hz on a gaming mouse). Now: coordinates go straight to pixiFx, and we setState ONLY
    // when the hovered target actually changes — which is a handful of times per aim instead of hundreds.
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    let lastUid: string | null = null;
    const flush = (): void => {
      raf = 0;
      const pt = pending;
      pending = null;
      if (!pt) return;
      const target = minionAt(pt.x, pt.y);
      const uid = target?.uid ?? null;
      pixiFx.setAimLine({ x: ox, y: oy }, { x: pt.x, y: pt.y }, !!target, getAimFxConfig());
      if (uid !== lastUid) {
        lastUid = uid;
        setAimTargetUid(uid); // rare — only when you cross onto/off a different minion
      }
    };
    const move = (e: PointerEvent): void => {
      moved = true;
      // rAF-coalesced: a 1000Hz mouse still produces at most one update per frame.
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const up = (e: PointerEvent): void => {
      if (!moved) return; // a plain click — stays armed for a follow-up click
      const target = minionAt(e.clientX, e.clientY);
      if (target && !timeUp) {
        // EQUIPMENT and a hero power share the aim gesture but are different actions — and different usage
        // budgets. Whichever is armed is the one that fires; arming either clears the other (see the store).
        if (equipArmed) dispatch({ type: 'activateEquipment', targetUid: target.uid });
        else dispatch({ type: 'heroPower', uid: target.uid, slot: useGame.getState().heroArmedSlot }); // Void: fire the ARMED slot's power
        // The authored 'hero-power-target' FX at the targeted unit (owner ask 2026-08-14). Feed the click
        // point to source/target AND cursor — the def anchors on `cursor`, which is ORIGIN if unsupplied.
        const p = { x: e.clientX, y: e.clientY };
        // THE AUCTIONEER'S PULSE has its own authored effect + clip (owner 2026-08-30), and it plays INSTEAD
        // of the generic spark rather than on top of it: `auctioneer-hp` is four layers of particles and two
        // shockwaves, and stacking the generic burst under that reads as two effects fired by accident.
        //
        // Anchored on the MINION, not on the pointer. The owner's ask is "played on the target minion" and
        // the def's own layers all anchor `target`, so the click point — which can land anywhere on a card,
        // including its corner — is the wrong origin. `minionAt` already found the element, so its rect gives
        // the true centre for free.
        const isAuctioneer = !equipArmed && useGame.getState().run.heroId === 'myra';
        if (isAuctioneer) {
          // The same selector `minionAt` used to FIND it, so the two cannot disagree about what a targetable
          // minion is. Falls back to the click point if the card has gone (it cannot have, on this frame —
          // but an FX is never worth a crash).
          const el = document.querySelector<HTMLElement>(`[data-zone="warband"] .row .card[data-uid="${target.uid}"]`);
          const r = el?.getBoundingClientRect();
          const c = r ? { x: r.left + r.width / 2, y: r.top + r.height / 2 } : p;
          // The UID travels too, not just the point (see `playDefUids.test.ts`). Every layer here is Pixi
          // today, which needs only coordinates — but a def that omits the uid keeps working right up until
          // someone adds a `react` layer to it, and then animates nobody. That defect shipped three times in
          // one day, which is why the guard exists; passing it costs nothing.
          playDef('auctioneer-hp', { source: c, target: c, cursor: c }, { uids: { target: target.uid } });
          sfx.auctioneerPower();
        } else {
          playDef('hero-power-target', { source: p, target: p, cursor: p });
        }
      } else if (equipArmed) armEquipment(); // released on nothing — cancels, spending no Gold and no use
      else armHero(); // released without a valid target — snaps back / cancels
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [heroArmed, equipArmed, armEquipment, heroArmedSlot, heroTargetsTavern, heroTargetsTavernOnly, heroTargetsNoGolden, run.board, run.spell?.uid, timeUp, dispatch, armHero, inCombat]);

  // Targeted Battlecry (Toxin Tender): once the minion is played it sits on the board with a pending
  // target — aim a glowing line from it to a friendly minion and click to grant the keyword (mirrors
  // the Hero Power). Clicking off any warband minion is ignored (keep aiming); ending the turn first
  // auto-resolves on the carry in the reducer, so the play is never stranded.
  const pendingTarget = run.pendingTarget;
  // Which board minions are valid picks for the pending targeted Battlecry — all friends for an
  // unrestricted pick (no targetTribe), or only the required tribe (never self) for a restricted one
  // (Toxin Tender → Undead).
  const isPendingTarget = (uid: string): boolean => {
    if (!pendingTarget) return false;
    const def = CARD_INDEX[pendingTarget.cardId];
    // Common Ground: the SECOND pick can't be the first minion (averaging with itself is a no-op).
    if (pendingTarget.spell && uid === pendingTarget.spellFirstUid) return false;
    // `targetNotSelf` (Graverobber) excludes the source from an otherwise-unrestricted pick.
    if (def?.targetNotSelf && uid === pendingTarget.uid) return false;
    // Runes can LIFT a tribe restriction (Rune of Open Appetite frees the Appetite Agent's aim), so the aim UI
    // asks the same helper the reducer's target check does. Reading `def.targetTribe` here directly would let
    // the UI refuse a pick the reducer would have accepted — the rune would half-apply and read as broken.
    const aimTribe = effectiveTargetTribe(run, def);
    if (!aimTribe) return true;
    if (uid === pendingTarget.uid) return false;
    const c = run.board.find((b) => b.uid === uid);
    return c ? isTribe(c, aimTribe) : false; // dual-types (Bane = Dragon/Demon) are valid picks
  };
  useEffect(() => {
    if (!pendingTarget || inCombat) {
      setAimTargetUid(null);
      return;
    }
    // A tribe-restricted Battlecry (Toxin Tender → a friendly Undead, never self) only accepts matching
    // targets; an unrestricted one (no targetTribe) accepts any friendly minion.
    const def = CARD_INDEX[pendingTarget.cardId];
    const valid = (uid: string): boolean => {
      if (pendingTarget.spell && uid === pendingTarget.spellFirstUid) return false; // Common Ground: not the first pick
      if (def?.targetNotSelf && uid === pendingTarget.uid) return false; // Graverobber: never itself
      if (!def?.targetTribe) return true;
      if (uid === pendingTarget.uid) return false;
      const c = run.board.find((b) => b.uid === uid);
      return c ? isTribe(c, def.targetTribe) : false; // dual-types (Bane) are valid picks
    };
    // An `any` Choose One (Crest of the Climb) may land on a TAVERN offer as well as a warband minion — the
    // reducer's target pool says so, so the picker has to offer it, or choosing "+4 Attack" would silently
    // narrow the spell to the board (it could always hit an offer when the drag did the aiming).
    const aimsTavern = pendingTarget.deferredPlay && def?.target === 'any';
    const minionAt = (x: number, y: number): { uid: string } | null => {
      const el = document.elementFromPoint(x, y)?.closest('[data-zone="warband"] .row .card[data-uid]');
      const uid = el?.getAttribute('data-uid');
      if (uid && valid(uid)) return { uid };
      const offer = aimsTavern ? shopUidAt(x, y) : null;
      return offer ? { uid: offer } : null;
    };
    // Same treatment as the hero-power aim: anchor measured once (the source card can't move while you
    // aim), coordinates driven straight into Pixi, and React state touched only when the target changes.
    // Common Ground's source is a SPELL in HAND (not a board minion), so fall back to the hand card as the
    // aim origin — otherwise the picker never activates and the second target can't be chosen.
    const originEl = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${pendingTarget.uid}"]`)
      ?? document.querySelector(`[data-zone="hand"] .card[data-uid="${pendingTarget.uid}"]`);
    if (!originEl) return;
    const orr = originEl.getBoundingClientRect();
    const ox = orr.left + orr.width / 2;
    const oy = orr.top + orr.height / 2;
    let raf = 0;
    let pending: { x: number; y: number } | null = null;
    let lastUid: string | null = null;
    const flush = (): void => {
      raf = 0;
      const pt = pending;
      pending = null;
      if (!pt) return;
      const target = minionAt(pt.x, pt.y);
      const uid = target?.uid ?? null;
      pixiFx.setAimLine({ x: ox, y: oy }, { x: pt.x, y: pt.y }, !!target, getAimFxConfig());
      if (uid !== lastUid) { lastUid = uid; setAimTargetUid(uid); }
    };
    const move = (e: PointerEvent): void => {
      pending = { x: e.clientX, y: e.clientY };
      if (!raf) raf = requestAnimationFrame(flush);
    };
    const pick = (e: PointerEvent): void => {
      if (e.button !== 0 || timeUp) return;
      const target = minionAt(e.clientX, e.clientY);
      if (target) { dispatch({ type: 'battlecryTarget', targetUid: target.uid }); return; }
      // CLICK AWAY = CANCEL, but only for a DEFERRED Choose One aim (owner ruling 2026-08-28): nothing has
      // been played, so the card simply returns to hand untouched. An ordinary battlecry aim still ignores the
      // click and keeps aiming — its body is already on the board, so there is nothing clean to back out to.
      if (pendingTarget.deferredPlay) dispatch({ type: 'cancelChoice' });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', pick);
    return () => {
      if (raf) cancelAnimationFrame(raf);
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerdown', pick);
    };
  }, [pendingTarget, timeUp, dispatch, inCombat, run.board]);

  // Reset the round clock at the start of each recruit wave, and whenever the hero picker opens or
  // closes (so wave 1 always begins at full time the moment a hero is chosen — even on a fresh run
  // that died on wave 1, where run.wave doesn't change). Recruit stays mounted across combat now.
  // The clock lives in an external store (turnClock), NOT React state, so its per-second tick
  // re-renders only the tiny ring/rope subscribers — never the heavy card tree. See turnClock.ts.
  // Layout effect so the clock is full BEFORE the first paint (the store starts at 0 — without this the
  // first frame would flash "0" / a locked board until a passive effect ran).
  useLayoutEffect(() => {
    // Behind the title the clock is hidden and paused (via overlayOpen); the resumed value is applied the moment
    // showTitle flips back to false on Continue — this effect keys on showTitle precisely so that flip fires it.
    if (showTitle) return;
    // A resume hands us the exact seconds the turn was quit with (owner ask 2026-08-24); consume it one-shot.
    // Otherwise (a fresh turn / new run) open at full time.
    const resume = useGame.getState().pendingResumeSeconds;
    if (resume != null) {
      turnClock.set(resume);
      useGame.getState().clearPendingResume();
    } else {
      turnClock.set(turnSeconds);
    }
  }, [run.wave, turnSeconds, heroSelecting, showTitle]);

  /**
   * REPLAY PACING for the shop clock (owner report 2026-08-30: *"speed doesnt change the time's speed"*).
   *
   * The countdown below is the one clock in the game that free-ran on wall time: a literal
   * `setTimeout(tick, 1000)`. Playback speed scales how fast FRAMES advance, so at 3x a recorded turn went by
   * in a third of the time while the timer on screen still counted one second per real second — the replay
   * and its own clock disagreeing on how long the turn was.
   *
   * Dividing the tick by the speed keeps them telling the same story. Live play has no `replaySession`, so
   * the divisor is 1 and nothing about the real game's timing changes.
   */
  const replaySpeed = useGame((st) => st.replaySession?.speed ?? 1);
  const tickMs = (): number => 1000 / Math.max(0.1, replaySpeed);

  // Round timer: count down each recruit turn; at 0 the player is forced into combat (paused while a
  // Discover pick is open, and frozen while the hero picker is open). UI-only — the engine is untimed.
  // A self-scheduling loop (not keyed on `seconds`, which no longer lives in React state): it reads/
  // writes turnClock directly, so ticking never re-renders Recruit. The reset effect above runs first
  // on a new turn (effect order), so the clock is back at full time before this re-schedules.
  useEffect(() => {
    // `pendingTarget` (a battlecry aim) and `chooseOne` are forced mid-play decisions that lock the rest of the
    // board, exactly like a Discover — so the timer must pause for them too. It didn't for `pendingTarget`, and
    // because the UI also blocks the target pick once `timeUp`, the timer expiring mid-aim left the player
    // unable to pick AND (before the reducer fix) unable to End Turn: a hard softlock (owner report 2026-07-22).
    if (run.phase !== 'recruit' || run.discover || run.questOffer || run.powerOffer || run.runeforgeOffer || run.pendingTarget || run.chooseOne || run.scoutedNextOpponent?.length || heroSelecting || overlayOpen) return;
    let id = 0;
    const tick = (): void => {
      const cur = turnClock.get();
      if (cur <= 0) return; // at 0 the timer just stops — actions lock (except End Turn); no auto-combat
      const next = cur - 1;
      if (next === 0) sfx.turnExplode(); // timer hits 0 — shop locks; syncs with the charge glyph's completion flash
      turnClock.set(next); // (the last-5s tick beeps were retired — the charge-glyph turnCharge cue replaces them)
      id = window.setTimeout(tick, tickMs());
    };
    id = window.setTimeout(tick, tickMs());
    return () => window.clearTimeout(id);
  }, [run.phase, run.discover, run.questOffer, run.powerOffer, run.runeforgeOffer, run.pendingTarget, run.chooseOne, heroSelecting, overlayOpen, run.wave, replaySpeed]);

  // Detect a self-buff (a minion's own stats jump in the recruit phase) and fire its self-buff cue. The
  // readout itself is the badge's own job now — see the cut below.
  useEffect(() => {
    const prev = prevStatsRef.current;
    const next = new Map<string, { a: number; h: number }>();
    const newly: string[] = [];
    // A fresh Fodder eat this action: the EATERS' reaction is choreographed to the consume tendril's
    // ARRIVAL (the wiggle + delayed float) — suppress the instant stat-diff flash/float for them, or the
    // Demon pops twice (once now, once when the tendril lands — owner bug report 2026-07-16).
    const eatUids = new Set<string>();
    if (run.fodderEatenSeq !== prevEatFlashSeq.current) {
      prevEatFlashSeq.current = run.fodderEatenSeq;
      for (const ev of run.fodderEaten ?? []) eatUids.add(ev.eaterUid);
      for (const ev of run.shopEaten ?? []) eatUids.add(ev.eaterUid); // shop consumes suppress the pop the same way
    }
    // Only WHICH cards gained is needed now, not by how much: the exact delta used to feed the +X/+X float,
    // and the badge carries that itself since the float was cut (see below).
    for (const c of [...run.board, ...run.hand]) {
      const cur = { a: c.attack, h: c.health };
      next.set(c.uid, cur);
      const p = prev.get(c.uid);
      if (!inCombat && p && cur.a + cur.h > p.a + p.h && !eatUids.has(c.uid)) newly.push(c.uid);
    }
    // Tavern offers can be buffed too (the hero power can Fortify a shop minion) —
    // track their effective stats (base + the stored offer buff) so they flash as well.
    for (const o of run.shop) {
      const base = CARD_INDEX[o.cardId];
      if (!base) continue;
      const cur = { a: base.attack + (o.atk ?? 0), h: base.health + (o.hp ?? 0) };
      next.set(o.uid, cur);
      const p = prev.get(o.uid);
      if (!inCombat && p && cur.a + cur.h > p.a + p.h) newly.push(o.uid);
    }
    prevStatsRef.current = next;
    // While the combat arena is up, keep the baseline synced (so re-entering recruit doesn't read a
    // stale jump) but never cue — a self-buff cue firing for the End-of-Turn buff that landed at
    // "Face the Omen" would be invisible with the arena covering the board anyway.
    if (inCombat) {
      return;
    }
    if (newly.length === 0) return;
    // The new source→target FX (tendril/descend) already lands on any target captured in `recruitBuffFx` this
    // action — skip the self-buff cue for those so it doesn't double up with the FX.
    const fxTargets = new Set(run.recruitBuffFx.map((e) => e.targetUid));
    // WELD (owner 2026-07-18): an Attachment fusing on gets its OWN cue — the converging ring + wiggle — so
    // the generic self-buff cue is suppressed for the minions this weld just landed on. Self-contained seq
    // check: only the render carrying a FRESH weld stamp suppresses, so a LATER buff on the same minion
    // cues normally.
    const freshWeld = run.weldFxSeq !== undefined && run.weldFxSeq !== weldStatSeqRef.current;
    weldStatSeqRef.current = run.weldFxSeq;
    const weldedNow = freshWeld ? new Set(run.weldFxUids ?? []) : new Set<string>();
    const burstable = newly.filter((u) => !fxTargets.has(u) && !weldedNow.has(u));
    // The pulse channel = shop SELF-buffs (a minion buffing itself — Ashscribe): `captureBuffFx` skips them (no
    // source→target pair for a tendril) so they land here rather than in `recruitBuffFx`. Played through the
    // bound self-buff def — default `self-buff-gold`, card-overridable via `cards.<id>.minionSelfBuffed` — via
    // the SAME recruit cue runner rubyLanded/minionBuffed use, so combat and shop show the same self-buff
    // effect. One moment per self-buffer, keyed by its own card. Only fires when defs can play (headless / the
    // FX overlay not yet ready silently skips it — there is no generic fallback cue anymore). Fire-and-forget
    // like the other recruit cues (no teardown collected).
    if (burstable.length > 0 && canPlayDefs()) {
      for (const uid of burstable) {
        const cardId = runRef.current.board.find((c) => c.uid === uid)?.cardId;
        if (!cardId) continue;
        runRecruitMomentCues(selfBuffMoment(uid, cardId), {
          cardIdOf: (u) => runRef.current.board.find((c) => c.uid === u)?.cardId ?? null,
          measure: (u) => {
            const el = document.querySelector<HTMLElement>(`[data-uid="${u}"]`);
            return el ? restingCenterOf(el) : null;
          },
        });
      }
    }
    // CUT (owner, 2026-08-04): the recruit-phase "+X/+X" float is gone, for the same reason the COMBAT one
    // went in `choreo/channels/float.ts` — the stat badge now carries its own change, withholding the new
    // number and rolling to it (`fx/statHold.ts`, and `Card`'s intrinsic roll for buffs nobody authored).
    // A float saying "+2/+2" beside a badge counting 4→6 is two things asking for the eye, in the same
    // place, at the same moment, saying the same thing. The generic green card-flash that used to draw the
    // eye here (`.cardbuff`) is retired too — the self-buff cue above and the badge's own roll carry that job.
  }, [run.board, run.hand, run.shop, inCombat, run.recruitBuffFx]);

  // Replay a batch of captured buff-other events as source→target tendrils (living minion) or descends
  // (spell / Deathrattle / sourceless), using the same renderer as combat. Shared by the per-action watcher
  // below AND the End-of-Turn beat sequence (whose events come from the projection, since the real commit
  // lands after the phase flips — see `projectEndOfTurnSteps`).
  // `staggerMs` > 0 plays the events SEQUENTIALLY (one strike per step) — the EoT beats use it so a
  // per-z reward (Blueprint Cache's +2/+2 per Attachment) reads as N hits landing one after another,
  // not one simultaneous burst. Rects are measured at fire time (inside the timeout) so a late strike
  // still lands on the card's current position.
  const replayBuffFxEvents = useCallback((events: RunState['recruitBuffFx'], staggerMs = 0): void => {
    // Itemized per-z rewards tag their events with `fxWave` — every event in a wave fires TOGETHER (so all
    // the Mechs pulse at once) and the stagger applies only BETWEEN waves. Untagged events keep the old
    // per-event behaviour.
    const fireOne = (ev: RunState['recruitBuffFx'][number]): void => {
      // AN AUTHORED DEF REPLACES THE STOCK CUE (owner ruling 2026-08-11).
      //
      // A bound card plays its def through `runRecruitMomentCues` off the SAME `recruitBuffFx` entries this
      // loop draws tendrils from, so before this every bound card got both — Karwind rang AND threw a ribbon,
      // which reads as two effects for one event and is not what anyone authored.
      //
      // The rule is general rather than a Karwind special case: binding a def to a moment IS the statement
      // "I have authored what this looks like", so the default stops. Same shape as combat's `claimDamageFx`,
      // which suppresses the stock hit-burst for units a bound def covers.
      //
      // Keyed on the SOURCE card and `minionBuffed` — exactly the pair `runRecruitMomentCues` resolves for
      // this event (see its `bindingCard`), so the two can never disagree about whether a def is playing.
      if (bindingFor(ev.sourceCardId, 'minionBuffed')) return;
      const tEl = findEl(ev.targetUid);
      if (!tEl) return;
      const tr = tEl.getBoundingClientRect();
      const target = { x: tr.left + tr.width / 2, y: tr.top + tr.height / 2 };
      const sEl = ev.sourceUid ? findEl(ev.sourceUid) : null;
      const sr = sEl?.getBoundingClientRect();
      fireBuffFx({
        source: sr ? { x: sr.left + sr.width / 2, y: sr.top + sr.height / 2 } : undefined,
        target,
        cardId: ev.sourceCardId, tribe: ev.sourceTribe,
        sourceless: ev.kind !== 'minion' || !sEl,
      });
    };
    // Collapse K Brightwing tendrils to one per target before grouping — see `coalesceBuffFxByTarget`. This is
    // the fix for the "many Brightwings slow it down" jank: K×(M−1) ribbons → M−1, presentation-only.
    const coalesced = coalesceBuffFxByTarget(events);
    const waves = new Map<number, RunState['recruitBuffFx']>();
    coalesced.forEach((ev, i) => {
      const key = ev.fxWave ?? -1 - i; // untagged → its own wave, preserving per-event stagger
      const list = waves.get(key) ?? [];
      list.push(ev);
      waves.set(key, list);
    });
    // Cap the wave COUNT, not just the total duration — an Attachment build can produce ~30 waves, at which
    // point the per-wave gap collapses to a strobe.
    // Scheduled by `scheduleLands` like every other traversal — the tendrils are WAVES in the vocabulary's
    // terms: members of a wave land together, and `gap` spaces wave from wave. The group CAP that used to be
    // used to be a separate `coalesceWaves` is now `maxGroups`, so an Attachment build's ~30 waves collapse rather than
    // strobing. Events are indexed so a land can find the event it belongs to (a land carries a uid, and a
    // wave can hold several events for different targets).
    const ordered = [...waves.keys()].sort((a, b) => a - b).map((k) => waves.get(k)!);
    const byUid = new Map(coalesced.map((ev) => [ev.targetUid, ev]));
    for (const land of scheduleLands(
      asWaves(ordered.map((wave) => wave.map((ev) => ({ uid: ev.targetUid })))),
      { gap: staggerMs, maxGroups: getBuffFxConfig().waveMaxCount },
    )) {
      const ev = byUid.get(land.uid);
      if (!ev) continue;
      if (land.at <= 0) fireOne(ev);
      else window.setTimeout(() => fireOne(ev), land.at);
    }
  }, [findEl]);

  // Shop-phase buff FX: when the sim captured buff-others this action (recruitFxSeq bumped), replay them.
  useEffect(() => {
    if (run.recruitFxSeq === prevFxSeq.current) return;
    prevFxSeq.current = run.recruitFxSeq;
    if (run.recruitBuffFx.length === 0) return;
    // A Ruby landing owns its own cue (`ruby-gem-apply`), so the generic buff tendril is suppressed for the
    // cards it hit THIS action — otherwise a Frenzied Excavator draws seven tendrils under seven detonations
    // and neither read survives (owner ask 2026-08-02). Correlated by uid rather than by tagging the buff
    // event, because "was this stat gain a Ruby" is already answered by the Ruby signal the same action
    // computes; a second source of that truth could disagree with the first.
    // An ale's authored cast trail (Step 3 above) owns the same "the ale draws it, not the generic tendril"
    // rule as a Ruby land — claimed via `spellCastOwnedRef`, keyed by THIS action's `recruitFxSeq` so a stale
    // claim from a previous action never suppresses an unrelated buff wave.
    const rubyOwned = new Set((run.rubyLandedFx ?? []).map((l) => l.uid));
    const aleOwned = spellCastOwnedRef.current.seq === run.recruitFxSeq ? spellCastOwnedRef.current.uids : new Set<string>();
    const owned = (rubyOwned.size > 0 || aleOwned.size > 0) ? new Set<string>([...rubyOwned, ...aleOwned]) : null;
    const events = owned ? run.recruitBuffFx.filter((e) => !owned.has(e.targetUid)) : run.recruitBuffFx;
    if (events.length === 0) return;
    replayBuffFxEvents(events);
  }, [run.recruitFxSeq]);

  // AURA WAVE: a run-wide tribe-aura channel rose this action (auraFxSeq bumped) — bloom a tribe-colored wave
  // from the board CENTRE out to both edges. It's a GLOBAL cue (the aura touched the whole board), so it fires
  // over the board region regardless of which cards match (the old per-card wash showed nothing when no matching
  // card was on screen). Full board width from the zone, vertical band hugging the card row. Colors come from the
  // tribe's tendril palette so the aura language matches the tribe's buff language.
  const fireAuraWave = useCallback((tribe: NonNullable<RunState['auraFx']>[number]['tribe']): void => {
    const zoneEl = document.querySelector('[data-zone="warband"]');
    if (!zoneEl) return;
    const z = zoneEl.getBoundingClientRect();
    if (z.width < 8 || z.height < 8) return;
    const rr = zoneEl.querySelector('.row.warband')?.getBoundingClientRect();
    const y = rr && rr.height > 4 ? rr.top : z.top;
    const h = rr && rr.height > 4 ? rr.height : z.height;
    // Wave colours come from WAVE_PALETTES, not the tendril preset: the wave blends ADDITIVELY, where a
    // dark tendril colour contributes almost no light (see buffPresets.ts).
    pixiFx.auraWave({ x: z.left, y, w: z.width, h }, { ...getAuraFxConfig(), ...wavePalette(buffPreset('', tribe)) });
  }, []);
  useEffect(() => {
    if ((run.auraFxSeq ?? 0) === prevAuraSeq.current) return;
    prevAuraSeq.current = run.auraFxSeq ?? 0;
    if (inCombat) return;
    for (const entry of run.auraFx ?? []) fireAuraWave(entry.tribe);
  }, [run.auraFxSeq]);

  // A freshly-played minion with a Battlecry gets a one-shot flourish beneath it. Diff the
  // board's uids; a new card whose def has an onPlay effect (or Choose One) just fired its
  // Battlecry. (Summoned tokens like Strays have no onPlay, so they don't flash.)
  useEffect(() => {
    if (inCombat) {
      prevBoardUidsRef.current = new Set(run.board.map((c) => c.uid));
      // Drop any pending holds on the way into a fight — the flourish belongs to the shop, and a timer that
      // outlives the phase would clear a uid that the next recruit phase has legitimately re-flagged.
      for (const t of bcTimersRef.current.values()) window.clearTimeout(t);
      bcTimersRef.current.clear();
      return;
    }
    const prev = prevBoardUidsRef.current!; // seeded at render (the ??= above) — never null in effects
    const fresh = run.board
      .filter((c) => {
        if (prev.has(c.uid)) return false;
        const def = CARD_INDEX[c.cardId];
        return !!def && (def.effects.some((e) => e.on === 'onPlay') || (def.chooseOne?.length ?? 0) > 0);
      })
      .map((c) => c.uid);
    prevBoardUidsRef.current = new Set(run.board.map((c) => c.uid));
    if (fresh.length === 0) return;
    setBattlecryUids((s) => new Set([...s, ...fresh]));
    sfx.triggerPulse(); // a Battlecry officially fires → the medallion pulse cue (deduped)
    // The SAME signal, published as a bindable moment. `fresh` is already "a minion whose Shout just fired",
    // which is the source `recruitMoments.ts` requires before a kind may exist — this adds no new detection,
    // it names the one that was already driving the medallion.
    //
    // ONE MOMENT PER MINION, each naming its own card as the source: two different minions played in the same
    // action must each resolve their own binding, and a single moment carrying both recipients would make the
    // second silently take the first's effect.
    for (const uid of fresh) {
      const cardId = run.board.find((c) => c.uid === uid)?.cardId ?? null;
      if (cardId === null) continue;
      runRecruitMomentCues(
        shoutMoment(uid, cardId),
        {
          cardIdOf: (u) => runRef.current.board.find((c) => c.uid === u)?.cardId ?? null,
          measure: (u) => {
            const el = document.querySelector<HTMLElement>(`[data-uid="${u}"]`);
            return el ? restingCenterOf(el) : null;
          },
        },
      );
    }
    /* The 760ms clear is PER UID and must outlive this effect's next run. It used to be a single timeout
       cancelled by the effect's own cleanup — and the deps are `[run.board, inCombat]`, so ANY board change
       inside that window (a buff writing a new array, a sell, a reorder) killed the clear and left the minion
       flagged in `battlecryUids` forever. That is what produced the errant reorder pulses the owner reported:
       the medallion keeps `.pulsing`, and React moving a keyed child on a warband reorder re-inserts its DOM
       node — which RESTARTS the CSS animation. So a long-dead Battlecry flashed again every time you shuffled
       cards past it. Same defect, and same fix, as the combat medallion hold (#735). */
    for (const uid of fresh) {
      const prevT = bcTimersRef.current.get(uid);
      if (prevT !== undefined) window.clearTimeout(prevT);
      bcTimersRef.current.set(uid, window.setTimeout(() => {
        bcTimersRef.current.delete(uid);
        setBattlecryUids((s) => {
          if (!s.has(uid)) return s;
          const n = new Set(s);
          n.delete(uid);
          return n;
        });
      }, 760));
    }
  }, [run.board, inCombat]);

  // (Removed 2026-08-06, owner call: the golden-deploy self-buff PULSE. It fired `pixiFx.pulse` — the same
  // "this unit was just empowered" flourish combat uses — on every new golden uid landing on the board, even
  // though a deploy buffs nothing. It read as a phantom buff. It was invisible to the 2026-08-04 repro attempt
  // because that probe checked DOM classes and this was a canvas draw. Golden deploys now land quietly.)

  // Shop-phase TRANSFORM flash: a board card whose cardId changed IN PLACE (uid stable) just transformed — Spirit
  // Pup → Spirit Worgen on its 10th spell (`spellCastTransform` keeps the uid, swaps cardId). Bloom the SAME ascend
  // flash combat uses, at the card's slot, so a shop transform reads as dramatically as a combat one. Gated to a def
  // that can actually morph (spellCastTransform / ascendInto) so a triple / golden / Magnetic merge never false-fires.
  const prevBoardCardIdsRef = useRef<Map<string, string> | null>(null);
  useEffect(() => {
    const current = new Map(run.board.map((c) => [c.uid, c.cardId]));
    if (prevBoardCardIdsRef.current === null || inCombat) { prevBoardCardIdsRef.current = current; return; }
    const prev = prevBoardCardIdsRef.current;
    prevBoardCardIdsRef.current = current;
    for (const c of run.board) {
      const was = prev.get(c.uid);
      if (!was || was === c.cardId) continue;
      const wasDef = CARD_INDEX[was];
      if (!wasDef || !(wasDef.effects.some((e) => e.do === 'spellCastTransform') || wasDef.ascendInto)) continue;
      const el = findEl(c.uid);
      if (!el) continue;
      const r = (el.querySelector<HTMLElement>('.archbox') ?? el).getBoundingClientRect();
      const cfg = ASCEND_PRESETS[ascendPreset(c.cardId, c.tribe)];
      pixiFx.flashBloom(r.left + r.width / 2, r.top + r.height / 2, {
        flashSize: cfg.flashSize, flashMs: cfg.flashMs, flashAlpha: cfg.flashAlpha, colorGlow: cfg.colorGlow, blend: 'screen',
      });
    }
  }, [run.board, inCombat]);

  /**
   * AN EQUIPMENT'S CHOOSE ONE OPENED → its authored flourish, over the window (owner ask 2026-08-31:
   * "this effect should play WHEN the choose one happens ... on top of the choose one immediately").
   *
   * Keyed on the Equipment id rather than on a sequence number, because the prompt IS the event: it appears
   * exactly once per press and cannot repeat without closing first. The ref is what makes a re-render during
   * the open prompt a no-op.
   *
   * Fired immediately — no tuner delay. The prompt is a decision the player is about to make, so a flourish
   * that arrives after they have started reading is late by definition.
   *
   * The def carries `slot: 'above'`, which is what puts it over the z160 overlay; a camera-anchored def
   * needs no staged anchors (`playDef` fills the viewport centre in), but the centre is passed for source and
   * target too so a future layer on another anchor still lands somewhere sensible rather than in the corner.
   */
  const prevChooseOneEq = useRef<string | undefined>(undefined);
  useEffect(() => {
    const eqId = run.chooseOne?.equipmentId;
    if (eqId === prevChooseOneEq.current) return;
    prevChooseOneEq.current = eqId;
    if (!eqId) return;
    const eq = EQUIPMENT_INDEX[eqId];
    if (!eq) return;
    const c = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
    if (eq.useFxId && canPlayDefs()) playDef(eq.useFxId, { source: c, target: c, cursor: c, camera: c });
    if (eq.useSfxId && getEquipFxConfig().useSfxOn) sfx.equipmentUse(eq.useSfxId);
  }, [run.chooseOne?.equipmentId]);

  // Discover opened → erupt the golden magic burst on the overlay's behind-the-cards FX layer. Fired once
  // the burst app has initialised (attach resolves immediately if already created).
  useEffect(() => {
    if (!run.discover) return;
    const el = discoverBurstRef.current;
    if (!el) return;
    void discoverFx.attach(el).then(() => discoverFx.discoverBurst(window.innerWidth / 2, window.innerHeight / 2));
  }, [run.discover]);

  // Karwind flame flash: when a Battlecry triggers Karwind, flame the Dragons it buffed (~0.9s).
  useEffect(() => {
    if (run.karwindFlashSeq === prevKarwindSeq.current) return;
    prevKarwindSeq.current = run.karwindFlashSeq;
    // AN AUTHORED DEF REPLACES THE STOCK CUE (owner ruling 2026-08-11) — the same rule the tendril loop uses,
    // now covering the flame flash. This flash is a SECOND stock visual for the same buff Karwind's authored
    // `flame-ring` now plays, so a bound card threw both. It is NOT gated on `karwind` by id, because
    // `onBattlecryBuffTribe` (which stamps this flash) is also a set-2 Dragon's effect, and THAT card is
    // unbound and must keep its flash. So the discriminator is the binding: suppress the flash on any Dragon a
    // BOUND source buffed this action, reading the source attribution `recruitBuffFx` already carries. A
    // Dragon buffed only by an unbound source keeps its flame.
    // Karwind buffs EVERY Dragon including itself, and flashes all of them — so `karwindFlash` holds both the
    // buffed others AND Karwind's own uid. `flame-ring` (a buff-OTHER binding) plays only on the others, so
    // both have to be suppressed by hand or Karwind keeps flaming ITSELF red. `recruitBuffFx` gives me each:
    // its `targetUid`s are the buffed others, its `sourceUid` is the buffer. Suppress a flash uid that is
    // either — for any BOUND source. (A bound Karwind alone on the board buffs only itself, emits no
    // buff-other event, so its lone self-flash survives — acceptable, since flame-ring plays on no one then.)
    const bound = (e: { sourceCardId: string }): boolean =>
      e.sourceCardId !== '' && bindingFor(e.sourceCardId, 'minionBuffed') !== null;
    const authored = new Set<string>();
    const authoredSources = new Set<string>();
    for (const e of run.recruitBuffFx ?? []) {
      if (!bound(e)) continue;
      authored.add(e.targetUid);
      if (e.sourceUid !== undefined) { authored.add(e.sourceUid); authoredSources.add(e.sourceUid); }
    }
    // The buffer's medallion pulse — the retained "it triggered" cue now its flame is suppressed. Fired here,
    // BEFORE the flame's own early-return: a bound Karwind suppresses every flame, so `uids` below can be
    // empty, and gating the pulse on that would silence the very case this exists for.
    if (authoredSources.size > 0) {
      // `karwindCritUid` is the uid of the body whose buff DOUBLED this proc — that one pulses RED, the rest
      // white. Split so a card is in exactly one set (crit wins in Card.tsx's class chain regardless, but a
      // clean split keeps the two props honest).
      const critUid = run.karwindCritUid;
      setKarwindCritPulseUids(new Set([...authoredSources].filter((u) => u === critUid)));
      setKarwindPulseUids(new Set([...authoredSources].filter((u) => u !== critUid)));
      sfx.triggerPulse();
      if (karwindPulseTimerRef.current !== undefined) window.clearTimeout(karwindPulseTimerRef.current);
      karwindPulseTimerRef.current = window.setTimeout(() => {
        karwindPulseTimerRef.current = undefined;
        setKarwindPulseUids(new Set());
        setKarwindCritPulseUids(new Set());
      }, 760); // matches the battlecry medallion hold
    }
    const uids = (run.karwindFlash ?? []).filter((u) => !authored.has(u));
    if (uids.length === 0) return;
    setKarwindFlameUids(new Set(uids));
    /* The 520ms clear lives in a REF, not this effect's cleanup. `run.karwindFlash` is in the deps and the
       reducer `structuredClone`s state on every dispatch (reducer.ts), so that array gets a fresh identity on
       EVERY action — this effect re-runs constantly, and a cleanup-owned timer was cancelled by the next
       dispatch. The seq guard above then early-returns, so nothing rescheduled it and the flames stuck on
       until the next Karwind proc. Same defect as the two medallion pulses (#735, #736). */
    if (karwindTimerRef.current !== undefined) window.clearTimeout(karwindTimerRef.current);
    karwindTimerRef.current = window.setTimeout(() => {
      karwindTimerRef.current = undefined;
      setKarwindFlameUids(new Set());
    }, 520);
  }, [run.karwindFlashSeq, run.karwindFlash, run.karwindCritUid]);

  // KARWIND'S DOUBLE TRIGGER (owner 2026-08-07) — float a crit-style "2x" over the proccer when its 20% roll
  // comes up. Rides `karwindFlashSeq` (the same bump the flame flash already uses) rather than a seq of its
  // own, because a crit is always accompanied by a flame flash — the state field only says WHETHER this bump
  // was a crit, and which body to draw over. Read a frame late for the same reason the gain flourishes are:
  // React must have committed the card before its rect can be measured.
  useEffect(() => {
    const uid = run.karwindCritUid;
    if (!uid) return;
    const raf = requestAnimationFrame(() => {
      const el = document.querySelector(`[data-uid="${uid}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      // ABOVE the card, not on it: Karwind's own flame flash floods the card's top edge with red at exactly
      // the moment this fires, and the crit palette is crimson — drawn on the body it had no contrast at all.
      pixiFx.procCritText(r.left + r.width / 2, r.top - r.height * 0.10, '2x');
    });
    return () => cancelAnimationFrame(raf);
  }, [run.karwindFlashSeq, run.karwindCritUid]);

  // The living aim line (owner redesign 2026-07-16): sync the Pixi curved line to whichever targeting
  // gesture is live — the armed hero power / a pending targeted Battlecry (the `aim` state), or a
  // targeted spell being cast from hand (the drag). Replaces the old dotted SVG line; the arch is rolled
  // fresh inside pixiFx each time an aim STARTS.
  // The hero-power / Battlecry paths now push their own coordinates straight into Pixi from their
  // rAF-coalesced move handlers, so this effect no longer drives them — it only owns the SPELL-drag line
  // and the teardown, and it carries a dep array (it previously ran on EVERY render, re-writing
  // `document.body.classList` each time).
  const aimingNow = !!((heroArmed || equipArmed || pendingTarget) || (castingSpell && drag));
  useEffect(() => {
    if (castingSpell && drag) {
      // Use the exact live position, not the quantised state, so this render-time placement agrees with the
      // per-frame update in `flushMove` (otherwise the line would flick back 8px on every commit).
      const lp = dragPosRef.current ?? { x: drag.x, y: drag.y };
      pixiFx.setAimLine({ x: drag.startX, y: drag.startY }, lp, !!castTargetUid, getAimFxConfig());
    } else if (!heroArmed && !equipArmed && !pendingTarget) {
      pixiFx.clearAimLine(); // no targeting gesture of any kind is live
    }
    // While the targeter is live, the aim line IS the pointer — hide the OS cursor (restored the moment
    // the aim ends; see styles.css `body.aiming`).
    document.body.classList.toggle('aiming', aimingNow);
    // `castTargetUid` is deliberately NOT a dep: it's declared further down the component, so naming it here
    // would evaluate it during render and hit the TDZ (the effect BODY reads it fine — that runs after).
    // It's derived from `drag` anyway, which is a dep, so every change that matters already re-runs this.
  }, [aimingNow, heroArmed, equipArmed, pendingTarget, castingSpell, drag]);
  useEffect(() => () => { pixiFx.clearAimLine(); document.body.classList.remove('aiming'); }, []); // never strand the line/cursor on unmount

  // The Fodder-eat choreography (owner redesign 2026-07-16): the ghost card POPS IN hovering above the
  // shop line (fast in, easing to a stop), holds a beat, then CRUMBLES into purple energy (the CSS fade +
  // a source burst) while a tendril whips from it into each Demon that ate it (the Fodder-Infusion ribbon
  // language + the 🍖 tuner's dials); the eater wiggles as the tendril lands, and its badge delivers the
  // gain on that same arrival (the hold is placed elsewhere — see `holdFodderGains`). ~1.2s total.
  // Shared by the per-action watcher below AND the End-of-Turn beat sequence (Abyssal Feeder / Feasting
  // Bogrot consume during `faceOmen`, after the phase flips — the beats replay the projection's events
  // while the shop is still up). Returns a cancel fn (the watcher's effect cleanup).
  const playFodderEat = useCallback((events: NonNullable<RunState['fodderEaten']>, key: number): (() => void) => {
    let raf = 0;
    let startRaf = 0;
    let tries = 0;
    let t = 0;
    const tweens: gsap.core.Tween[] = [];
    const eaterAnims: Animation[] = [];
    const seq = key;
    // Measure + play once the tavern row is actually in the DOM. If it isn't yet (a consume that procs
    // before the shop has laid out / mid-transition), RETRY on the next frames instead of bailing — the
    // old code marked the seq seen and returned, so that consume's anim was lost forever (never replays).
    const tryShow = (): void => {
      const rowEl = document.querySelector('[data-zone="tavern"] .row');
      if (!rowEl || !rowEl.getClientRects().length) {
        if (tries++ < 40) raf = requestAnimationFrame(tryShow); // ~0.65s of frames for the tavern to mount
        return;
      }
      const rr = rowEl.getBoundingClientRect();
      const sample = rowEl.querySelector('.card')?.getBoundingClientRect();
      const w = sample?.width ?? rr.height * 0.752;
      const h = sample?.height ?? rr.height;
      const ghosts = events.map((ev, i) => {
        // Start from the eaten card's OWN slot — its pre-removal centre, captured in `shopRectsRef.prev` — so it
        // flies out of where it sat rather than from the row centre. A shop-minion consume carries the offer's
        // `uid`; a Fodder token has none, and an unmeasured slot (a consume before the shop laid out) also misses:
        // both fall back to the original fanned row-centre, hovering just above the shop line.
        const uid = (ev as { uid?: string }).uid;
        // `prev` after a swap (the no-hold path), else `cur` — which still holds the pre-removal layout while
        // the slot is held (that commit left `flipKey` unchanged, so the snapshot effect never swapped).
        const snap = uid ? (shopRectsRef.current.prev.get(uid) ?? shopRectsRef.current.cur.get(uid)) : undefined;
        const gw = snap?.w ?? w;
        const gh = snap?.h ?? h;
        const x0 = snap ? snap.cx - gw / 2 : rr.left + rr.width / 2 + (i - (events.length - 1) / 2) * (w * 0.72) - w / 2;
        const y0 = snap ? snap.cy - gh / 2 : rr.top - h * 0.62;
        return { fid: ev.fodderId, attack: ev.attack, health: ev.health, x0, y0, w: gw, h: gh, eaterUid: ev.eaterUid };
      });
      setFodderAnim({ key: seq, ghosts });
      // The consume "gulp" — fired ONCE per consume action (not per ghost), and `sfx.consume` itself de-dupes
      // across actions on one beat via a short cooldown, so several simultaneous consumes play a single gulp.
      sfx.consume();
      // The consume (owner redesign 2026-08-16): each ghost SHAKES in place, then TAFFY-stretches toward its
      // eater and is PULLED in as it collapses + fades — a GSAP timeline driving `consumeTransform` + a
      // decaying shake (transform/opacity only). The old Pixi `buffTendril` is replaced by the workshop-
      // authored `consume-pull` particle def (smoke at the eater + three point-gravity burst rings sucked in),
      // fired at the SAME instant each ghost's timeline starts. Every value is read LIVE from the 🍖 tuner.
      const cfg = getConsumeFxConfig();
      // Who reacts as the pull lands — summed per eater (one Demon can eat several Fodder). The eater's stat
      // WITHHOLD is deliberately NOT placed here (see `holdFodderGains`): it must ride the commit that raises
      // the value, and this function can run ~0.65s late off its retry loop.
      const keyed = fodderGainHolds(events);
      // Wait until the ghosts are actually mounted (queryable by `data-gidx`), then fire the def + start the
      // per-ghost taffy timeline. A SINGLE rAF races React's commit — `setFodderAnim` above only schedules a
      // render, so on the consume frame the ghost isn't in the DOM yet and the query returns null; with no CSS
      // fallback animation (fodderpop was removed) that left the ghost frozen. Retry across frames until it
      // mounts, then run the launch once.
      let startTries = 0;
      const startConsume = (): void => {
        if (!document.querySelector('.fodderghost[data-gidx="0"]')) {
          if (startTries++ < 30) startRaf = requestAnimationFrame(startConsume);
          return;
        }
        ghosts.forEach((g, i) => {
          const from = { x: g.x0 + g.w / 2, y: g.y0 + g.h / 2 };  // ghost centre — the bands' source point
          const eaterEl = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${g.eaterUid}"]`);
          const er = eaterEl?.getBoundingClientRect();
          const to = er ? { x: er.left + er.width / 2, y: er.top + er.height / 2 } : { x: from.x, y: from.y + 220 };
          // The authored `consume-pull` particles fire from the ghost into ITS eater — smoke gathers at the
          // eater while three burst rings are sucked in by point-gravity — at t=0 of the ghost's pull.
          playDef(
            'consume-pull',
            { source: from, target: to, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } },
            { uids: { source: g.eaterUid, target: g.eaterUid } },
          );
          const el = document.querySelector<HTMLElement>(`.fodderghost[data-gidx="${i}"]`);
          if (!el) return;
          // Anchor the TOP so `scaleY` elongates the ghost DOWNWARD (bottom leads) and the collapse shrinks it
          // toward the eater. The tilt + pull are measured from this TOP-CENTRE PIVOT to the eater's CENTRE, so
          // the card's centreline aims at the eater's card centre (owner ask 2026-08-18) — not off its top,
          // which is what a centre-referenced aim did against a top pivot.
          el.style.transformOrigin = '50% 0%';
          const pivot = { x: g.x0 + g.w / 2, y: g.y0 };
          const shakePhase = Math.max(1e-6, cfg.shakePhase); // shake length — independent of the pull (`lag`)
          const fadeDenom = Math.max(1e-6, 1 - cfg.fadeStart);
          const tw = gsap.to(el, {
            duration: cfg.durationMs / 1000,
            ease: 'none',
            onUpdate: function () {
              const tp = this.progress();
              const tf = consumeTransform(pivot, to, tp, cfg);
              // Decaying jitter over the shake phase, layered on the deterministic taffy transform.
              const s = tp < shakePhase ? 1 - tp / shakePhase : 0;
              const jx = s * cfg.shakeAmp * Math.sin(tp * cfg.shakeFreq * Math.PI * 2);
              const jy = s * cfg.shakeAmp * Math.cos(tp * cfg.shakeFreq * Math.PI * 2 * 1.3);
              el.style.transform = `translate(${tf.tx + jx}px, ${tf.ty + jy}px) rotate(${tf.rotDeg}deg) scale(${tf.scaleX}, ${tf.scaleY})`;
              el.style.opacity = String(tp < cfg.fadeStart ? 1 : (1 - tp) / fadeDenom);
            },
            onComplete: () => { el.style.opacity = '0'; },
          });
          tweens.push(tw);
        });
        // The CONSUMING minion SWELLS across the whole eat, then SNAPS back to true size with a little recoil
        // bounce as the ghost is pulled in (owner ask 2026-08-18) — replacing the old end-of-pull gulp-pop.
        // Scale-only, `composite: 'add'` so it stacks on the card's own transforms; fires once, synced to the
        // pull start (this runs on the frame the ghosts mount). Every value is read LIVE from the 🍖 tuner.
        if (cfg.eaterGrowAmount > 0) {
          // The swell takes `growLength` of the eat to peak; the recoil bounce ALWAYS gets its own fixed tail
          // AFTER that — so it stays visible even at growLength = 1 (grow the whole eat, then bounce), instead
          // of being crushed into the leftover sliver (owner report 2026-08-18). Total runs a touch past the
          // eat by that tail, which reads as "swallowed, then settles".
          const growMs = cfg.durationMs * Math.max(0.02, Math.min(1, cfg.eaterGrowLength));
          const recoilMs = Math.max(180, cfg.durationMs * 0.3); // guaranteed window for the bounce
          const total = growMs + recoilMs;
          const g0 = growMs / total;                 // offset where the swell peaks
          const u1 = g0 + (1 - g0) * 0.45;            // undershoot below true size (the recoil)
          const u2 = g0 + (1 - g0) * 0.75;            // small overshoot back up
          for (const k of keyed) {
            const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${k.uid}"]`);
            if (!el) continue;
            try {
              eaterAnims.push(el.animate([
                { transform: 'scale(1)', offset: 0, easing: 'cubic-bezier(0.35, 0, 0.45, 1)' },        // slow swell
                { transform: `scale(${1 + cfg.eaterGrowAmount})`, offset: g0, easing: 'cubic-bezier(0.7, 0, 0.25, 1)' }, // snap down
                { transform: `scale(${1 - cfg.eaterRecoil})`, offset: u1, easing: 'ease-out' },        // undershoot (recoil)
                { transform: `scale(${1 + cfg.eaterRecoil * 0.4})`, offset: u2, easing: 'ease-in-out' }, // tiny overshoot
                { transform: 'scale(1)', offset: 1 },                                                   // settle to true size
              ], { duration: total, composite: 'add' }));
            } catch { /* WAAPI composite unsupported: skip the swell rather than clobber the card transform */ }
          }
        }
      };
      startRaf = requestAnimationFrame(startConsume);
      t = window.setTimeout(() => setFodderAnim(null), cfg.durationMs + 150); // the ghost is gone by here
    };
    tryShow();
    return () => {
      if (raf) cancelAnimationFrame(raf);
      if (startRaf) cancelAnimationFrame(startRaf);
      window.clearTimeout(t);
      for (const tw of tweens) tw.kill();
      for (const a of eaterAnims) { try { a.cancel(); } catch { /* already finished */ } }
    };
  }, []);

  /**
   * WITHHOLD each eater's gain until the tendril reaches it (`fx/statHold.ts`) — the fodder sibling of the
   * ruby cascade's hold above, and placed under the same rule: **in the commit that raises the value**.
   *
   * That rule is the whole reason this is a separate function called from layout effects rather than two
   * lines inside `playFodderEat`. A hold is a DELTA subtracted from whatever the badge currently shows, so a
   * commit that applies the hold without the raise prints `old − gain` — a number strictly below anything
   * the minion has ever had, on the readout players buy and position from. `playFodderEat` is reached from a
   * passive effect (after paint) and from the End-of-Turn beat loop (before its `setEotAnimStats`), and its
   * DOM-retry loop can fire up to ~0.65s late — long enough that `Card`'s intrinsic roll for the same change
   * has already finished and been deleted, so the hold would land fresh, with the full delta, on a badge
   * already showing the new number, and snap it backwards for about a second.
   *
   * `startAt` is measured from THIS commit rather than from when the ghost happened to render. In the normal
   * case those are the same frame and the number lands exactly on the tendril; in the rare late-layout case
   * the number keeps its own honest schedule and the ribbon arrives after it. Losing the sync is the
   * acceptable half of that trade — printing a wrong number is not.
   */
  const holdFodderGains = useCallback((gains: readonly FodderGain[]): void => {
    // Release each eater's gain PART-WAY through the consume pull. The old timing was the infuse-tendril's
    // arrival (~0.9s) — decoupled from the shorter taffy eat, so the badge lagged well behind the animation
    // (owner report 2026-08-18). At 0.8 of the consume's `durationMs` the number climbs into place as the ghost
    // is drawn in and the eater gulps, instead of popping after it's all over.
    const startAt = getConsumeFxConfig().durationMs * 0.8;
    for (const g of gains) holdStat(g.uid, { attack: g.attack, health: g.health }, { origin: 'cue', startAt });
  }, []);

  // The mid-shop consume's raise arrives on `run.board` in the same commit as the seq bump, so the hold goes
  // in from a LAYOUT effect keyed on that seq — before paint, and before the passive watcher below runs.
  // Its own prev-seq ref, because the watcher's is bookkeeping for the choreography, not for this.
  const prevFodderHoldSeq = useRef(run.fodderEatenSeq);
  useLayoutEffect(() => {
    if (run.fodderEatenSeq === prevFodderHoldSeq.current) return;
    prevFodderHoldSeq.current = run.fodderEatenSeq;
    holdFodderGains(fodderGainHolds(run.fodderEaten ?? []));
  }, [run.fodderEatenSeq, run.fodderEaten, holdFodderGains]);

  const prevShopEatHoldSeq = useRef(run.shopEatenSeq);
  useLayoutEffect(() => {
    if (run.shopEatenSeq === prevShopEatHoldSeq.current) return;
    prevShopEatHoldSeq.current = run.shopEatenSeq;
    holdFodderGains(fodderGainHolds(run.shopEaten ?? []));
  }, [run.shopEatenSeq, run.shopEaten, holdFodderGains]);

  /**
   * The End-of-Turn beat loop's raise is `setEotAnimStats`, not `run.board`, so its hold cannot ride either
   * seq above. The beat stashes what it is about to raise and this drains it in the commit that raises it.
   *
   * Stash-then-drain rather than holding beside `setEotAnimStats` directly, because the two updates travel
   * different lanes: a hold reaches React through `useSyncExternalStore` (sync) and `eotAnimStats` through
   * `useState` (default). React is free to commit the sync one alone, and that commit is the one that prints
   * `old − gain`. A layout effect on `eotAnimStats` can only run in a commit that already carries the raise.
   */
  const pendingFodderHolds = useRef<FodderGain[] | null>(null);
  useLayoutEffect(() => {
    const pending = pendingFodderHolds.current;
    if (pending === null) return;
    pendingFodderHolds.current = null;
    holdFodderGains(pending);
  }, [eotAnimStats, holdFodderGains]);

  // Tavern Fodder was auto-eaten mid-shop (fodderEatenSeq bumped) — play the eat choreography.
  useEffect(() => {
    if (run.fodderEatenSeq === prevFodderSeq.current) return;
    prevFodderSeq.current = run.fodderEatenSeq;
    const events = run.fodderEaten ?? [];
    if (events.length === 0) return;
    return playFodderEat(events, run.fodderEatenSeq);
    // Keyed on the seq ONLY: `run.fodderEaten` gets a fresh array ref every action, so including it
    // would re-run this effect (and its cleanup) on unrelated actions, stranding the ghost. The seq only
    // changes when Fodder is actually eaten, so the snapshot read of `run.fodderEaten` here is current.
  }, [run.fodderEatenSeq]);

  // A SHOP MINION was consumed (Set 2's Demons) — its own sequence, so it can't be confused with a Fodder eat.
  // Shares `playFodderEat`'s choreography for now: the payload shapes match, and the owner's plan is a distinct
  // animation later — this split is what makes that possible without disturbing the Fodder cue.
  useEffect(() => {
    if (run.shopEatenSeq === prevShopEatSeq.current) return;
    prevShopEatSeq.current = run.shopEatenSeq;
    const events = (run.shopEaten ?? []).map((e) => ({ ...e, fodderId: e.cardId }));
    if (events.length === 0) return;
    return playFodderEat(events, run.shopEatenSeq);
  }, [run.shopEatenSeq]);

  // RELEASE the held consumed slots (see `heldConsume` above) once the ghost has been pulled into the eater —
  // matched to the taffy pull's own clock (`getConsumeFxConfig().durationMs`). Dropping them here changes
  // `flipKey`, which fires the committed-move FLIP branch and glides the survivors closed from where they were
  // holding. Keyed on the array ref: seeding it re-arms the timer, clearing it (to `[]`) re-runs to a no-op.
  useEffect(() => {
    if (!heldConsume.length) return;
    const timer = window.setTimeout(() => setHeldConsume([]), getConsumeFxConfig().durationMs);
    return () => window.clearTimeout(timer);
  }, [heldConsume]);

  // --- Live warband drag: a dragged board minion is *lifted out* of the row entirely
  // (the floating copy IS the card) for the whole drag; the rest physically close up,
  // and an empty drop-slot opens at the live insertion point while over the warband.
  // Dropping lands the card straight into that slot — no post-drop "swap". A played
  // hand card opens the same slot. ---
  // Everything the drag draws as the pointer moves — the drop-gap indices, the magnetize/cast highlights, the
  // lift state — is derived by the pure `deriveDragDecision` (see dragDecision.ts for the full rationale of
  // each rule: centre-tracking, the play floor, magnetize suppression, the collapse lift). The SAME function
  // backs `flushMove`'s re-render gate, so the state we render here and the decision that decides whether to
  // re-render can never disagree. The dragged card's own transform/aim/trail bypass this (ref-driven, frame-exact).
  const dragGeo: DragGeo = { warbandIndexAt, shopIndexAt, handIndexAt, boardUidAt, shopUidAt };
  const dragDecision = deriveDragDecision({
    drag,
    x: drag ? drag.x : 0,
    y: drag ? drag.y : 0,
    overZone,
    magSlide,
    playFloor: playFloorRef.current,
    spellFloor: spellFloorRef.current,
    collapseY: getDragFeel().collapseY,
    boardMax: CONFIG.boardMax,
    asksChoiceFirst: dragAsksChoiceFirst,
    board: run.board,
    spellUid: run.spell?.uid,
    geo: dragGeo,
  });
  const { wouldMagnetize, castTargetUid, overWarband, collapsedLift, shopGapIndex, gapIndex, handGapIndex } = dragDecision;
  castAimRef.current = { casting: castingSpell, onTarget: !!castTargetUid };
  const draggingBoard = !!drag?.active && drag.source === 'board';
  // The dragged card STAYS in the row (rendered invisible via `dimmed`) so its slot holds the row width —
  // that's what stops the neighbours re-centring inward the instant you lift it (the "snap in then back out").
  // The gap moves via per-card slide transforms (see `boardSlide`/`shopSlide`), not by removing the card.
  // CELESTIAL alignment, one read per render, shared by every board card below. Gated on a Celestial being
  // present so an ordinary board computes nothing. The arc itself is a CHILD of each card (see Card.tsx), so
  // this only decides the COLOUR — position is the card's own business, which is what fixed "they hate being
  // moved" (owner 2026-08-06). Recruit-phase only: alignment locks at combat start, and until the locked
  // read is wired the arcs stand down in combat rather than showing a value deaths would falsify.
  const boardAligns = useMemo(
    () => (boardHasCelestial(displayBoard) ? alignmentsOf(displayBoard) : undefined),
    [displayBoard],
  );
  const draggingShop = !!drag?.active && drag.source === 'shop';
  // HOLD the consumed slot open (Part 2 of the consume-slide). The sim splices the eaten offer from `run.shop`
  // in the same commit that bumps `shopEatenSeq`, so a naive `displayShop` loses the slot immediately and FLIP
  // reflows the survivors AT ONCE. Instead, on the commit that raises the seq we derive the eaten uids + their
  // pre-removal slot index (read from `shopRectsRef.cur`, still the pre-removal layout at this point in render)
  // and re-inject an invisible placeholder at that index — so `flipKey` is byte-identical to the pre-consume
  // frame and nothing reflows. A timer (below) clears `heldConsume` once the ghost has been pulled into the
  // eater (the taffy's `durationMs`), and only THEN does the slot drop and the survivors glide closed. Derive-
  // during-render (not an effect) is required: a passive effect would run AFTER the FLIP layout effect had
  // already animated the reflow.
  if (run.shopEatenSeq !== heldConsumeSeq) {
    setHeldConsumeSeq(run.shopEatenSeq);
    const order = [...shopRectsRef.current.cur.keys()];
    const fresh = (run.shopEaten ?? [])
      .map((e) => ({ uid: e.uid, index: order.indexOf(e.uid) }))
      .filter((h) => h.index >= 0);
    if (fresh.length) setHeldConsume((prev) => {
      const seen = new Set(prev.map((h) => h.uid));
      return [...prev, ...fresh.filter((h) => !seen.has(h.uid))];
    });
  }
  const heldUids = heldConsume.length ? new Set(heldConsume.map((h) => h.uid)) : null;
  let displayShop = eotConsumedUids.size ? run.shop.filter((o) => !eotConsumedUids.has(o.uid)) : run.shop;
  if (heldConsume.length) {
    const arr = [...displayShop];
    for (const h of [...heldConsume].sort((a, b) => a.index - b.index)) {
      if (!arr.some((o) => o.uid === h.uid)) arr.splice(Math.min(h.index, arr.length), 0, { uid: h.uid } as (typeof run.shop)[number]);
    }
    displayShop = arr;
  }
  // SANDBOX ONLY: the pinned opponent board (if any) for the CURRENT wave, and the click handler that opens
  // the unit editor on one of its slots. Mirrors `sbEditing`'s uid+rect pattern, but keyed by index — a
  // `BoardSnapshot`'s minions are a plain array with no uid of their own.
  const sbEnemySnap: BoardSnapshot | null = run.servedBoards?.[run.wave] ?? null;
  const applyFoe = (next: BoardSnapshot): void => {
    // Never persist a zero-minion pin: an empty served board ends combat before it starts, which reads as a
    // broken rig rather than an authored one. `removeEnemy` already refuses at one minion, so this is
    // belt-and-braces against any future caller of `applyFoe` that isn't as careful.
    if (next.minions.length === 0) return;
    const liveRun = useGame.getState().run;
    useGame.setState({ run: { ...liveRun, servedBoards: { ...(liveRun.servedBoards ?? {}), [liveRun.wave]: next } } });
  };
  const onSbEnemyPointerDown = (e: React.PointerEvent): void => {
    // Read live: this handler is recreated every render (not a useCallback), so `sbEditMode`/`run` ARE
    // fresh here — but the live read is kept anyway to match the one established pattern in this file
    // (`onCardPointerDown`'s own live read a few thousand lines up) rather than have two conventions for
    // the same problem.
    const { sbEditMode: liveEditMode, run: liveRun } = useGame.getState();
    if (!liveEditMode || !liveRun.sandbox) return;
    const el = (e.currentTarget as HTMLElement).closest('[data-uid]');
    const foeUid = el?.getAttribute('data-uid') ?? '';
    const index = Number(foeUid.replace('sbfoe-', ''));
    if (!Number.isInteger(index) || index < 0) return;
    e.preventDefault();
    e.stopPropagation();
    setSbEditingFoe({ index, rect: (el as HTMLElement).getBoundingClientRect() });
  };
  // The spell stays rendered (dimmed) while being bought — like a minion offer — so the row keeps its width and
  // the offers slide to fill its slot. So it's always "shown" for FLIP-key purposes until the buy commits.
  const spellShown = run.spell?.uid ?? '';
  // Per-card slide offset (in slots) that opens the drop gap by shifting the cards themselves. A CSS
  // `transition: transform` (while dragging) glides these — the pre-emptive "make room" animation.
  const draggedBoardIdx = draggingBoard ? run.board.findIndex((m) => m.uid === drag!.uid) : -1;
  const boardSlide = (i: number): number => {
    if (draggingBoard) {
      if (gapIndex < 0) {
        // Not reordering within the warband. Once lifted vertically clear of the row, close the gap. The row
        // loses a card (N → N-1) and RE-CENTERS, so every survivor moves a HALF slot toward centre — cards
        // before the lifted one shift right (+0.5), cards after shift left (-0.5). (The mirror of a hand-play
        // insert.) A full-slot shift would fling them all the way to the lifted card's spot — the reported bug.
        if (collapsedLift && draggedBoardIdx >= 0)
          return i === draggedBoardIdx ? 0 : i < draggedBoardIdx ? 0.5 : -0.5;
        return 0;
      }
      // Reordering an existing minion: the dragged card holds its slot (invisible). Every OTHER card shifts by
      // a whole slot only when the gap crosses it — so nothing moves until the card is dragged clear.
      if (i === draggedBoardIdx) return 0;
      const p = i < draggedBoardIdx ? i : i - 1;      // its index among the non-dragged cards
      return (p < gapIndex ? p : p + 1) - i;          // its index once the dragged card reinserts at the gap
    }
    if (gapIndex < 0) return 0;
    // Playing a new card from hand: open a half-slot gap each side at the insertion point.
    return i < gapIndex ? -0.5 : 0.5;
  };
  // The spell is pinned at the END of the shop row, so buying it collapses like removing the last offer: treat
  // its index as the row length, and every minion offer (all before it) recentres a half slot to fill the gap.
  const draggedShopIdx = draggingShop
    ? drag!.uid === run.spell?.uid
      ? run.shop.length
      : run.shop.findIndex((o) => o.uid === drag!.uid)
    : -1;
  const shopSlide = (i: number): number => {
    if (!draggingShop) return 0;
    if (shopGapIndex < 0) {
      // Buying: dragged up/down out of the shop far enough — close the gap the offer leaves behind. Same as the
      // warband: the row loses a card and re-centres, so survivors move a HALF slot toward centre (+0.5 before,
      // -0.5 after), not a full slot to the bought card's old spot.
      if (collapsedLift && draggedShopIdx >= 0)
        return i === draggedShopIdx ? 0 : i < draggedShopIdx ? 0.5 : -0.5;
      return 0;
    }
    if (i === draggedShopIdx) return 0;
    const p = i < draggedShopIdx ? i : i - 1;
    return (p < shopGapIndex ? p : p + 1) - i;
  };
  // Hand reorder slide (mirror of shopSlide). Reorder mode = the dragged HAND card sits DOWN in the hand
  // region (its centre below the play line), not lifted up to play/cast — then the gap opens at the drop
  // index and every OTHER hand card shifts one slot when the gap crosses it. `handSlidePx` (in the JSX)
  // multiplies this by the measured overlap spacing so the fan parts by exactly one slot.
  const draggingHand = !!drag?.active && drag.source === 'hand';
  const draggedHandIdx = draggingHand ? run.hand.findIndex((c) => c.uid === drag!.uid) : -1;
  // `handGapIndex` (the drop slot for a hand reorder) comes from `deriveDragDecision` above.
  const handSlide = (i: number): number => {
    if (!draggingHand || handGapIndex < 0 || i === draggedHandIdx) return 0;
    const p = i < draggedHandIdx ? i : i - 1;
    return (p < handGapIndex ? p : p + 1) - i;
  };
  // FLIP key tracks row composition + order AND the live drop-slot index, so cards slide smoothly *as the
  // gap moves during a drag* (not just on drop). GSAP Flip animates this robustly — it reads in a batch,
  // uses GPU transforms, and blends interruptions natively, so rapid gap moves don't storm the way the old
  // hand-rolled FLIP did (which is why that one had to be limited to discrete changes).
  const flipKey =
    displayShop.map((o) => o.uid).join(',') + '|' + spellShown + '|' + shopGapIndex + '|' +
    displayBoard.map((m) => m.uid).join(',') + '|' + gapIndex + '|' + (collapsedLift ? '1' : '0');
  // Snapshot each shop card's centre + size (declared above, near the consume state that also reads it).
  useLayoutEffect(() => {
    const cur = new Map<string, { cx: number; cy: number; w: number; h: number }>();
    for (const el of document.querySelectorAll<HTMLElement>('[data-zone="tavern"] .card[data-uid]')) {
      const uid = el.dataset.uid;
      if (!uid) continue;
      const r = el.getBoundingClientRect();
      if (r.width === 0) continue; // an unlaid-out / hidden card measures at the corner — skip it
      cur.set(uid, { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: r.width, h: r.height });
    }
    shopRectsRef.current = { prev: shopRectsRef.current.cur, cur };
  }, [flipKey]);
  // Carry each row's live gap to the next frame so `reorderIndexFromSlots` can place neighbours at their
  // CURRENT (shifted) spots (symmetric swap thresholds). Only while actually reordering (gap >= 0).
  useEffect(() => {
    if (gapIndex >= 0) prevWarbandGapRef.current = gapIndex;
  }, [gapIndex]);
  useEffect(() => {
    if (shopGapIndex >= 0) prevShopGapRef.current = shopGapIndex;
  }, [shopGapIndex]);
  useEffect(() => {
    if (handGapIndex >= 0) prevHandGapRef.current = handGapIndex;
  }, [handGapIndex]);

  // FLIP via GSAP. `flipStateRef` holds the layout state captured at the end of the *previous* run (the
  // cards' old spots); after React commits the new order, `Flip.from` animates each card from there to its
  // fresh spot. Newly-mounted cards (a freshly bought/played card) aren't in the prior state, so they pop
  // in (cardpop) instead of sliding from nowhere; removed cards (sold) just leave. GSAP clears its own
  // transforms on complete and manages interruptions, so a fast drag blends rather than flinging cards.
  useLayoutEffect(() => {
   // Timed as `layout:flip` (perf export): GSAP Flip animation + the two forced reflows + the per-commit
   // Flip.getState / commitRects rebuild (O(cards) offsetLeft reads). Runs every commit — a heavy branch here
   // is the fanout-frame cost that's neither the sim nor the weld FX.
   perfMonitor.measure('layout:flip', () => {
    // WHICH ROW CAN MOVE. Only one row re-lays-out during a drag: the warband when its drop gap is open, the
    // tavern when the shop's is. Capturing/animating BOTH doubled the most expensive thing in the shop phase
    // for a row that provably cannot have moved. Outside a drag (a buy, a sell, a commit) either row can
    // change, so the full selector stands.
    //
    // Switching selectors mid-drag is safe: `Flip.from` simply ignores elements absent from the captured
    // state, and an absent element is one that did not move — which is the same outcome it had before.
    // (Perf capture 2026-08-06: `layout:flip` was 4,511 ms of 5,010 ms measured — 90% of all work, ~9.2 ms
    // per call against a 4.17 ms budget at 240 Hz, firing ~50×/s during a drag.)
    // Consumed once: the hold applies to the single commit that follows the death, never to later ones.
    const shiftHold = shiftHoldRef.current;
    shiftHoldRef.current = 0;
    const draggingNow = dragRef.current?.active ?? false;
    const flipSel = !draggingNow ? FLIP_SELECTOR
      : gapIndex >= 0 && shopGapIndex < 0 ? FLIP_SEL_WARBAND
        : shopGapIndex >= 0 && gapIndex < 0 ? FLIP_SEL_TAVERN
          : FLIP_SELECTOR;
    if (flipStateRef.current) {
      const flipCfg = getFlipConfig();
      const dragging = draggingNow;
      if (dragging) {
        // The PRE-EMPTIVE slide: as the drag crosses a slot boundary, the drop slot moves and the cards glide
        // to make room (dragMs = the slide duration). The cards' CSS `transition: transform` is off for the
        // whole drag (body.dragging rule in styles.css) so GSAP's transform animation isn't masked.
        Flip.from(flipStateRef.current, { duration: flipCfg.dragMs / 1000, ease: 'power2.out' });
      } else if (handPlaySnapRef.current) {
        // A drag-drop just committed (a hand card landed, or a board / shop card was reordered). We do a MANUAL
        // FLIP on the settled row's cards only (never a full Flip.from — for a hand-play the freshly played card
        // is an entering element GSAP would jolt; for a reorder the dragged card would replay its whole move). All
        // exclude the dragged/played card from the captured rects, so it just appears at its committed slot while
        // its neighbours glide from where they sat. First kill the base `.card { transition: transform 0.12s }`
        // so the slideDir→0 reset is instant (else it animates the reset over the reflow = a rebound). Then, for
        // any neighbour whose real pre-commit spot (captured at drop) differs from its final slot — i.e. the
        // release outran the throttled preview — glide it from there to home so it settles instead of jumping.
        handPlaySnapRef.current = false;
        const rects = handFlipRef.current;
        handFlipRef.current = null;
        const sel = handFlipSelRef.current ?? '[data-zone="warband"] .row .card[data-uid]';
        handFlipSelRef.current = null;
        const targets = gsap.utils.toArray<HTMLElement>(sel);
        gsap.set(targets, { transition: 'none' });
        void document.body.offsetWidth; // reflow so transform:0 is the instant baseline (no rebound)
        for (const el of targets) {
          const uid = el.dataset.uid;
          const old = uid ? rects?.get(uid) : undefined;
          const delta = old === undefined ? 0 : old - el.getBoundingClientRect().left;
          if (Math.abs(delta) < 0.5) {
            el.style.transition = ''; // static card (or the new one) — restore its base transition
            continue;
          }
          gsap.fromTo(
            el,
            { x: delta },
            { x: 0, duration: flipCfg.commitMs / 1000, ease: 'power2.out', clearProps: 'transform,transition' },
          );
        }
        // The dragged card itself now sits at its committed slot (excluded from the FLIP above). Slide IT the
        // last stretch from where you released it — same motion as a buy, 30% faster. WAAPI transform, so it
        // doesn't fight the neighbours' GSAP x-tween. Runs here (not a separate effect) to guarantee it fires
        // AFTER the card is at its final slot in this same commit.
        const place = placePendingRef.current;
        placePendingRef.current = null;
        if (place) {
          const card = document.querySelector<HTMLElement>(
            place.sel.replace('[data-uid]', `[data-uid="${place.uid}"]`),
          );
          if (card) playBuySlide(place.from, card, 0.7);
        }
      } else if (flipCfg.commitMs > 0) {
        // A COMMITTED move with NO drag (a SELL / buy-back, a summoned token, an effect repositioning) — opt-in
        // via commitMs > 0. We do a MANUAL per-card FLIP off `commitRectsRef` (the prior frame's left edges)
        // rather than GSAP's `Flip.from`: on a REMOVAL that re-centers the row, Flip's auto-matching glided the
        // right survivor while teleporting the left one (the reported "janky shuffle") — a manual delta→0 tween
        // is symmetric by construction. Kill `.card`'s transform-transition first so the delta seed is instant.
        const targets = gsap.utils.toArray<HTMLElement>(FLIP_SELECTOR);
        const olds = commitRectsRef.current;
        gsap.set(targets, { transition: 'none' });
        void document.body.offsetWidth; // reflow so the transform baseline is instant (no CSS rebound)
        for (const el of targets) {
          const uid = el.dataset.uid;
          const old = uid ? olds?.get(uid) : undefined;
          // `offsetLeft` = the pure LAYOUT position (transform-immune). getBoundingClientRect would fold in any
          // in-flight tween transform on this card, seeding a wrong delta — which made the leftmost card snap
          // while its neighbour glided. offsetLeft compares like-for-like against the persisted old value.
          const delta = old === undefined ? 0 : old - el.offsetLeft;
          if (Math.abs(delta) < 0.5) { el.style.transition = ''; continue; } // unmoved (or new) card — restore base
          gsap.fromTo(
            el,
            { x: delta },
            {
              x: 0, duration: flipCfg.commitMs / 1000, ease: 'power2.out', clearProps: 'transform,transition',
              // A DEATH holds the row still for a beat first (owner 2026-08-28) — the survivors seed at their
              // old offsets and simply wait there, so the gap stays open under the animation playing over it.
              // Zero for every other commit, which is `gsap`'s default and the behaviour this always had.
              ...(shiftHold > 0 ? { delay: shiftHold / 1000 } : {}),
            },
          );
        }
      }
      // else: committed with commitMs 0 → snap (no animation); the drag preview already positioned everything.
    }
    // `simple: true` is GSAP's documented fast path: it skips the rotation/scale/skew accounting, which is
    // the expensive half of a state capture (a `getComputedStyle` read per element on top of the rect). These
    // rows only ever TRANSLATE horizontally, and `body.dragging` neutralises the hover `scale(1.06)` for the
    // whole drag (styles.css), so there is no rotation or scale for the full path to account for.
    flipStateRef.current = Flip.getState(flipSel, { simple: true });
    // Persist each flipping card's LAYOUT left (offsetLeft — transform-immune, so a capture taken while a
    // prior tween is still mid-flight records the true resting spot) for the NEXT commit's manual FLIP.
    // Scoped with the same selector: a card in the row that could not move is absent, and the commit branch
    // reads an absent uid as delta 0 — "did not move" — which is exactly right.
    commitRectsRef.current = new Map(
      gsap.utils.toArray<HTMLElement>(flipSel).map((el) => [el.dataset.uid ?? '', el.offsetLeft]),
    );
   });
  }, [flipKey]);

  // Hand reorder glide: a drag-reorder (applyDrop) captured the fan's pre-move layout into handReorderFlipRef;
  // when the new hand order commits here, Flip.from animates each card from its old slot to its new one. GSAP
  // Flip (not the warband/shop manual x-tween) so the cards keep their translateY tuck through the glide. Only
  // fires when a reorder actually captured a state — a buy/play that also changes the order is left to its own
  // pop-in.
  const handOrderKey = run.hand.map((c) => c.uid).join(',');
  useLayoutEffect(() => {
    // Kill the hand cards' CSS `transition: transform` first (like the warband/shop commit does): on drop the
    // dragged card's slide resets to 0 and the neighbours' slides clear, and if the base transition is live it
    // animates those resets AT THE SAME TIME as this Flip — the two fight and that's the drop judder. Flip owns
    // the settle; restore the transition on complete.
    const glide = (st: ReturnType<typeof Flip.getState>): void => {
      const targets = gsap.utils.toArray<HTMLElement>('.row.hand > .card');
      gsap.set(targets, { transition: 'none' });
      Flip.from(st, {
        duration: getFlipConfig().commitMs / 1000,
        ease: 'power2.out',
        onComplete: () => gsap.set(targets, { clearProps: 'transition' }),
      });
    };
    /* A drag-REORDER is Flip's: it captures at drop time, while `body.dragging` neutralises the `:hover`
       rule, so its measurement can't be polluted (styles.css). Everything else goes through the CSS
       `--hand-glide` channel below — never Flip — because a capture taken outside a drag WOULD see that
       hover `scale(1.06)`, and Flip morphs width/height from what it measures (see the 2026-07-28 devlog). */
    const st = handReorderFlipRef.current;
    if (!st) return;
    handReorderFlipRef.current = null;
    reorderGlidedRef.current = true; // this commit's hand motion is the Flip's — the `--hand-glide` effect below stands down
    glide(st);
  }, [handOrderKey]);

  /* ---- MAKE ROOM / CLOSE THE GAP when the hand's card count changes (owner ask 2026-07-27) -------------
     A buy, a play, a cast — anything that adds or removes a hand card — re-centres the fan, and every other
     card would blink to its new slot. Seed each survivor with the delta back to where it just sat, then
     release it to 0 so the row's own `transition: transform` carries it home.

     Measured with **`offsetLeft`, not a rect**: offsetLeft is the pure LAYOUT position and is immune to any
     transform — the hover zoom, the drag's make-room slide, an in-flight glide. That is the whole reason
     this replaced the Flip version, which measured rects and baked the hover scale into layout width. (The
     warband's commit FLIP documents the same offsetLeft-vs-rect reasoning.)

     Skipped mid-drag: the drag owns the row's motion through `handSlidePx`, and the pre-emptive slide has
     already opened the gap. On the drop commit the drag is over, and because offsetLeft ignored the slide
     transforms the delta we seed is exactly where the card visually sits — so it continues rather than
     snapping back. Entering cards have no previous position and are skipped; `playBuySlide` owns those. */
  useLayoutEffect(() => {
    // A drag-REORDER is the Flip effect's job (it already glided these cards from their captured spots). Both
    // effects key off `handOrderKey`; the Flip effect runs first and sets this flag so we don't ALSO seed a
    // full-slot make-room glide here — which would replay the slide a second time after release. Reset it
    // unconditionally so a later count-change (buy/play) still glides normally.
    const glidedByFlip = reorderGlidedRef.current;
    reorderGlidedRef.current = false;
    if (inCombat || dragRef.current?.active || glidedByFlip) return;
    const prev = handLeftsRef.current;
    const els = [...document.querySelectorAll<HTMLElement>('.row.hand > .card[data-uid]')];
    const moved: HTMLElement[] = [];
    for (const el of els) {
      const old = prev.get(el.dataset.uid ?? '');
      if (old === undefined) continue;                 // just arrived — not ours to move
      const d = old - el.offsetLeft;
      if (Math.abs(d) < 0.5) continue;                 // didn't move
      el.style.setProperty('transition', 'none');      // seed instantly, or the seed itself animates
      el.style.setProperty('--hand-glide', `${d}px`);
      moved.push(el);
    }
    if (moved.length === 0) return;
    void document.body.offsetWidth;                    // commit the seed before releasing it
    for (const el of moved) {
      el.style.removeProperty('transition');           // hand the motion back to the CSS transition
      el.style.setProperty('--hand-glide', '0px');
    }
    // Deliberately NO cleanup timer: the var settles at `0px`, which is what the default already resolves
    // to, so leaving it inline is inert. A timer here would be one more hold to leak (see the 2026-07-27
    // stuck-cue audit).
  }, [handOrderKey, inCombat]);

  /* Every hand card's layout x, refreshed each commit for the glide above. Declared AFTER it so that within
     one commit the glide reads the PREVIOUS frame's positions and this then overwrites them. One forced
     layout over at most `CONFIG.handMax` cards — the same shape as the warband's `commitRectsRef`. */
  useLayoutEffect(() => {
    if (inCombat) { handLeftsRef.current.clear(); return; }
    perfMonitor.measure('layout:handglide', () => {
      const next = new Map<string, number>();
      for (const el of document.querySelectorAll<HTMLElement>('.row.hand > .card[data-uid]')) {
        next.set(el.dataset.uid ?? '', el.offsetLeft);
      }
      handLeftsRef.current = next;
    });
  });

  // Pop a one-shot spark burst at a screen point (when a spell resolves).
  const fireSpark = (x: number, y: number): void => {
    sparkKeyRef.current += 1;
    const key = sparkKeyRef.current;
    setSpark({ x, y, key });
    window.setTimeout(() => setSpark((s) => (s?.key === key ? null : s)), 600);
  };

  // Root-level press feedback (cosmetic; never blocks the real handlers). Two cases:
  //  • pressing any shop / hand / board card → a soft "card touch", fired here (not in the card's own
  //    handler) so it plays AT ANY TIME — even when the timer's up, the hero is armed, or end-of-turn is
  //    animating, all of which detach the card's drag handler.
  //  • a primary click on the *empty table* (no card/control) → the click "thock" + a tiny dust puff.
  const onBoardPointerDown = (e: React.PointerEvent<HTMLDivElement>): void => {
    if (e.button !== 0) return;
    if (viewing) return;   // replay viewer — no card touch cue, no drag, no click thock (see `viewing`)
    const t = e.target as HTMLElement;
    if (t.closest('[data-zone] .card')) { sfx.cardTouch(); return; }
    if (heroArmed || equipArmed || drag) return;
    if (t.closest('button, a, input, [role="dialog"], .bar, .shopbar')) return;
    sfx.clickThock();
    // Small dust at the cursor (sibling of the card-landing dust) — the authored `click-puff` def. Feed the
    // click point to source/target AND cursor so the def emits at the click whichever anchor it declares
    // (it uses `cursor`, which resolves to ORIGIN if not supplied — the "puff fires in the corner" bug).
    const p = { x: e.clientX, y: e.clientY };
    playDef('click-puff', { source: p, target: p, cursor: p });
  };

  /**
   * CHOREOGRAPHER PR 4 — End of Turn driven by the AUTHORITATIVE event batch (blueprint §21 PR 4).
   *
   * The difference from the legacy path below is not cosmetic. Legacy *projects* what the reducer is about to
   * do (`projectEndOfTurnSteps`), animates that projection on two hardcoded constants, and only then
   * dispatches `faceOmen` — two models of one turn, which is why Beat Lab timing could never reach the screen.
   *
   * Here: resolve once → compile the emitted batch → play it → commit the state that was already resolved.
   * The board keeps rendering `before`; each value appears when its delivery marker fires, never sooner.
   *
   * Returns false if it cannot run (nothing emitted), so the caller falls back to legacy rather than
   * softlocking End Turn — the blueprint's hard failure rule (§5.6).
   */
  const playEndOfTurnAuthoritative = (): boolean => {
    const prepared = preparePresentationAction({ type: 'faceOmen' });
    if (!prepared) return false; // could not prepare at all — let the caller fall back rather than stall
    if (!prepared.batch) {
      // Nothing emitted: an early turn with no End-of-Turn content. There is nothing to animate, so commit
      // straight through. The legacy path would reach the same place, having also found no beats to play.
      commitPresentationAction();
      return true;
    }
    // CHOREOGRAPHER PR 10: compile with the COMMITTED config, so a beat tuned in the tool and committed to
    // `beat-defaults.json` actually paces the live game. Without this the compiler used its defaults and
    // authored timings were written to a file nothing read — the last piece of "my edits do nothing".
    // PR 19: when the Beat Lab's LIVE toggle is on, the UNCOMMITTED session draft layers on top — tune a
    // beat, close the Lab, end a real turn, judge. DEV only, explicit opt-in, banner shown while active
    // (blueprint §15: "live gameplay must not silently use unsaved draft values").
    const liveDraft = import.meta.env.DEV && useGame.getState().beatDraftLive ? useGame.getState().beatDraft : null;
    const converted = liveDraft
      ? draftToEngine(liveDraft.timings as BeatTimingOverrides, liveDraft.policies as BeatPolicyOverrides)
      : null;
    const timeline = compileTimeline(normalizePresentationBatch(prepared.batch), {
      config: shippedBeatConfig(),
      ...(converted ? { draft: converted.draft, modeDraft: converted.modeDraft } : {}),
    });
    if (import.meta.env.DEV && timeline.diagnostics.length) {
      // Surfaced, not swallowed: a diagnostic here is a real coverage gap, and the whole point of this pivot
      // is that such gaps stop being invisible.
      console.info('[choreographer] End-of-Turn diagnostics', timeline.diagnostics);
    }
    if (import.meta.env.DEV) {
      console.info(`[choreographer] authoritative End of Turn — ${timeline.beats.length} beats, ${timeline.consequenceDeliveries.length} deliveries, ${Math.round(timeline.durationMs)}ms`);
    }
    // Nothing emitted (an early turn with no End-of-Turn content) — commit straight through rather than
    // holding a lock for an empty animation.
    if (timeline.beats.length === 0) { commitPresentationAction(); return true; }

    // Absolute stat floor the projection's deltas are applied to — the board as it looks right now.
    const baseStats: Record<string, { attack: number; health: number }> = {};
    for (const c of [...run.board, ...run.hand]) baseStats[c.uid] = { attack: c.attack, health: c.health };

    if (heroArmed) armHero(); // a stray armed Hero Power must not fire mid-animation
    if (equipArmed) armEquipment(); // …and a stray armed Equipment likewise
    eotPadFiredRef.current = false;
    endTurnPendingRef.current = true;
    setEndTurnAnimating(true); // interaction lock (§12.5): shop, board, hero power and End Turn all disabled
    setEotShopStats(null);

    /**
     * CHOREOGRAPHER PR 5 — the FX surface the presenters draw through. Every entry is an EXISTING helper;
     * what changes is who decides to call it. Legacy decided by scanning card definitions for factory ids
     * (which is how a second card raising spell power played no cue at all — owner report 2026-07-28);
     * here the emitted consequence says what happened, so any card producing it animates, including ones
     * not written yet.
     */
    const centreOf = (uid: string): { x: number; y: number } | null => {
      const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
      if (!el) return null;
      const r = el.getBoundingClientRect();
      return { x: r.left + r.width / 2, y: r.top + r.height / 2 };
    };
    const presenterCtx: PresenterContext = {
      // The generic green burst is retired (`.cardbuff`) — this beat has no unauthored fallback cue anymore,
      // so a stat gain with no authored def plays nothing. Kept as a no-op (rather than removed) so
      // `PresenterContext` stays satisfied; the registry still calls `ctx.statGain(...)`.
      statGain: () => {},
      selfBuff: (uid) => {
        // A self-buff on this beat plays the authored self-buff def, mirroring the per-action `minionSelfBuffed`
        // path: routed through the same recruit cue runner, keyed by the minion's own card so a card override
        // applies. Only fires when defs can play — there is no generic fallback cue anymore.
        const cardId = runRef.current.board.find((c) => c.uid === uid)?.cardId;
        if (cardId && canPlayDefs()) {
          runRecruitMomentCues(selfBuffMoment(uid, cardId), {
            cardIdOf: (u) => runRef.current.board.find((c) => c.uid === u)?.cardId ?? null,
            measure: (u) => { const el = document.querySelector<HTMLElement>(`[data-uid="${u}"]`); return el ? restingCenterOf(el) : null; },
          });
        }
      },
      rubyLanded: (uid, count) => {
        runRecruitMomentCues(
          { kind: 'rubyLanded', recipients: [{ uid, count }] },
          {
            cardIdOf: (u) => runRef.current.board.find((c) => c.uid === u)?.cardId ?? null,
            measure: (u) => { const el = document.querySelector<HTMLElement>(`[data-uid="${u}"]`); return el ? restingCenterOf(el) : null; },
            onLand: () => sfx.gemApply(),
          },
        );
      },
      spellPower: (sourceUid, attack, health) => {
        const at = sourceUid ? centreOf(sourceUid) : null;
        if (at) {
          pixiFx.spellPower(at.x, at.y, getSpellPowerFxConfig());
          floatSpellPowerNumber(at.x, at.y - 30, attack, health);
        }
        fireSpellBuffOnHandSpells(runRef.current.hand); // the held spells whose printed values just rose
      },
      impAura: () => fireAuraWave('demon'),
      rubyAura: (sourceUid, attack, health) => {
        // "Your Rubies gain +X" landing on its beat — the ruby twin of `spellPower` above, reusing the exact
        // FX the legacy `rubyPowerFxSeq` watcher plays. Anchor over the source card, else a held Ruby, else the
        // hand row (where the Rubies that just grew actually are). Before this, a proc that only raised ruby
        // STRENGTH (Deepvein via Moira) emitted nothing and showed no beat (owner report 2026-08-14).
        const el = (sourceUid && document.querySelector(`[data-uid="${sourceUid}"]`))
          ?? document.querySelector('.row.hand .card.rubycard')
          ?? document.querySelector('.row.hand')
          ?? document.querySelector('[data-zone="tavern"]');
        if (el) {
          const r = el.getBoundingClientRect();
          const x = r.left + r.width / 2, y = r.top + r.height / 2;
          pixiFx.rubyPower(x, y, getRubyPowerFxConfig());
          floatRubyPowerNumber(x, y - r.height * 0.3, attack, health);
        }
        fireSpellBuffOnHandRubies(runRef.current.hand);
      },
      cardGranted: (cardId, _uid, sourceUid) => {
        // The hand preview is driven by the projection; arrival FX lands with the commit. The one thing that
        // must play HERE (while the board is still on screen) is ale-bubbles for a Dwarf's End-of-Turn Ale —
        // Brunni. The reactive `aleGrantSeq` watcher can't reach it: that only bumps at the `faceOmen` commit,
        // by which point the phase has flipped and the warband card is gone. Fire from the granting UNIT; a
        // rune/quest ale grant has no `sourceUid` and is skipped (bubbles are a unit effect).
        if (!sourceUid || !canPlayDefs() || !ALE_IDS.includes(cardId)) return;
        const el = document.querySelector<HTMLElement>(`[data-zone="warband"] .row .card[data-uid="${sourceUid}"]`);
        if (!el) return;
        const r = el.getBoundingClientRect();
        const p = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        playDef('ale-bubbles', { source: p, target: p }, { uids: { source: sourceUid, target: sourceUid } });
      },
      cardSummoned: () => { /* board arrivals animate through the existing summon path */ },
      cardDestroyed: (uid, zone, cardId, rise) => {
        // A shop offer consumed on its beat (Bob Blart's End of Turn) leaves the row NOW — so the minion
        // disappears as the eater procs, not at commit (owner report 2026-08-14). The crumble choreography
        // rides the paired `fodderEaten` consequence (below); this is just the departure.
        if (zone === 'shop' && uid) { setEotConsumedUids((s) => new Set([...s, uid])); return; }
        // A BOARD minion destroyed in the shop — Graverobber's meal, Funeral on Loan's borrowed body vacating
        // after its Echo. Until 2026-08-28 nothing was emitted for this at all, so the body simply was not
        // there once the phase committed: no window, no animation, the "immediate and janky" the owner
        // reported. The visual vocabulary is COMBAT'S, deliberately — the same death should not read as two
        // different events depending on which phase it happened in:
        //   · has an Echo  → the painted skull-shatter (`pixiFx.deathrattle`),
        //   · no Echo      → the authored `death-dissolve` def,
        //   · rising       → NEITHER: the body re-forms, so it must not dissolve. It gets the aura burst, and
        //                    its return rides the ordinary summon path as a fresh body.
        if (zone !== 'board' || !uid) return;
        const el = findEl(uid);
        if (!el) return;
        const r = el.getBoundingClientRect();
        if (rise) {
          pixiFx.flashBloom(r.left + r.width / 2, r.top + r.height / 2, RISE_BURST);
          return;
        }
        const hasEcho = !!cardId && !!CARD_INDEX[cardId]?.effects?.some((e) => e.on === 'onDeath');
        if (hasEcho) { pixiFx.deathrattle(r.left + r.width / 2, r.top + r.height / 2, r.width); return; }
        if (!canPlayDefs()) return;
        const a = anchorsForUnits(null, uid); // no source: the anchors fold onto the dying unit
        if (a) playDef('death-dissolve', a, { uids: { source: null, target: uid } });
      },
      shopBuffed: () => { /* the shop climb is driven by the projection's shopStats */ },
      resourceChanged: () => { /* HUD counters read the projection */ },
      counterChanged: () => { /* weld rings still legacy-only — see the PR 5 gap list */ },
      cardTransformed: (uid, toCardId) => {
        // CHOREOGRAPHER: a shop-phase transform now plays ON ITS BEAT (owner report 2026-08-20 — Skybound
        // Ascendant's tier-up "should happen in real time"). The swap itself rides the projection
        // (`eotTransforms` → `displayBoard`); this is the flourish, the SAME ascend flash the commit-time
        // watcher and combat both bloom, anchored on the transforming slot.
        const el = findEl(uid);
        if (!el) return;
        const r = (el.querySelector<HTMLElement>('.archbox') ?? el).getBoundingClientRect();
        const cfg = ASCEND_PRESETS[ascendPreset(toCardId, CARD_INDEX[toCardId]?.tribe ?? 'neutral')];
        pixiFx.flashBloom(r.left + r.width / 2, r.top + r.height / 2, {
          flashSize: cfg.flashSize, flashMs: cfg.flashMs, flashAlpha: cfg.flashAlpha, colorGlow: cfg.colorGlow, blend: 'screen',
        });
      },
      keywordChanged: () => { /* keyword pips render from the projection */ },
      // ── PR 6: the beat-level sequences, now event-derived rather than hardcoded per effect ──
      questTendril: (kind, sourceId, targetUid, index) => {
        if (!getQuestTendrilConfig().enabled) return;
        // Anchored by the rune/quest ID (`data-source-id`, added alongside this) rather than by the effect
        // name legacy matched on — so EVERY rune/quest reward that lands on a unit draws its ribbon, not the
        // two effects that were spelled out in the UI.
        const nodeEl = document.querySelector(`.questbadges [data-source-id="${sourceId}"]`);
        const unitEl = document.querySelector(`[data-uid="${targetUid}"]`);
        if (!nodeEl || !unitEl) return;
        const nr = nodeEl.getBoundingClientRect();
        const ur = unitEl.getBoundingClientRect();
        pixiFx.buffTendril(
          { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2 },
          { x: ur.left + ur.width / 2, y: ur.top + ur.height / 2 },
          tendrilCfgFor(index % 2 === 0 ? 1 : -1), // alternate the arc so a wave of ribbons stays readable
        );
      },
      // The buff-gust EFFECT was removed 2026-08-17 (owner: old, and ~half of all jank). The CUE stays on the
      // presenter surface so the beat keeps its shape and a replacement can be dropped straight in.
      tavernGust: () => { /* no effect authored — see docs/devlog 2026-08-17 */ },
      weldPulse: (hostUid) => {
        const at = centreOf(hostUid);
        if (at) pixiFx.weldPulse(at.x, at.y, weldCfgFor('auto'));
      },
      fodderEaten: (meal) => {
        // CHOREOGRAPHER PR 11 — the crumble now plays ON ITS BEAT. Until the `fodderEaten` consequence
        // existed this was the last End-of-Turn visual stuck on the commit path, because a `cardDestroyed`
        // carries only a target and the choreography needs the whole meal (who ate what, and the gain).
        // `playFodderEat` already speaks exactly this shape, so the presenter just hands it the event.
        const entry = { eaterUid: meal.eaterUid, fodderId: meal.fodderId, attack: meal.attack, health: meal.health, gainA: meal.gainAttack, gainH: meal.gainHealth };
        // Withhold the eater's badge gain until the tendril lands, matching the legacy choreography.
        holdFodderGains(fodderGainHolds([entry]));
        eotFodderCleanupRef.current.push(playFodderEat([entry], ++eotFodderSeqRef.current));
      },
    };
    const beatsById = new Map<string, CompiledBeat>();

    const player = createTimelinePlayer(timeline, {
      onConsequence: (delivery) => {
        const beat = beatsById.get(delivery.beatId);
        if (beat) presentConsequence({ consequence: delivery.consequence.payload as ConsequenceEvent, beat, ctx: presenterCtx });
      },
      onBeatActivate: (beat) => {
        beatsById.set(beat.id, beat); // indexed here so a consequence can always resolve its source beat
        // Only a beat with a card instance can light a medallion; rune/quest beats animate via their rail.
        const uid = beat.source.uid;
        setEotProcUids(uid ? new Set([uid]) : new Set());
        setEotPulseUids(uid && beat.mode === 'ownBeat' ? new Set([uid]) : new Set());
        if (beat.mode === 'ownBeat') sfx.triggerPulse(); else sfx.triggerGlow();
        if (uid) {
          const card = run.board.find((c) => c.uid === uid);
          if (card) setEotAnimTick((prev) => ({ ...(prev ?? {}), [uid]: (card.eotTick ?? 0) + 1 }));
        }
      },
      onProjection: (p) => {
        // Board + hand: absolute values = the pre-End-of-Turn floor plus everything delivered SO FAR. This is
        // the mechanism that makes a buff appear on its beat instead of the moment End Turn is pressed.
        const stats: Record<string, { attack: number; health: number }> = {};
        for (const [uid, floor] of Object.entries(baseStats)) {
          const d = p.boardStats.get(uid) ?? p.handStats.get(uid);
          stats[uid] = d ? { attack: floor.attack + d.attack, health: floor.health + d.health } : floor;
        }
        setEotAnimStats(stats);
        if (p.shopStats.size) {
          const shop: Record<string, { attack: number; health: number }> = {};
          for (const [uid, d] of p.shopStats) shop[uid] = { attack: d.attack, health: d.health };
          setEotShopStats(shop);
        }
        // Hand grants (conjures) preview in the hand; board summons (Moira re-firing a summoner) inject onto
        // the board — split by zone so a summon no longer wrongly shows as a hand card.
        setEotGrants(p.grantedCards.filter((g) => g.zone === 'hand').map((g) => g.cardId));
        setEotSummons(p.grantedCards.filter((g) => g.zone === 'board').map((g) => ({ uid: g.uid, cardId: g.cardId, index: g.index })));
        setEotKeywords(p.keywordChanges.size ? new Map([...p.keywordChanges].map(([u, s]) => [u, new Set(s)])) : EMPTY_KW);
        setEotTransforms(p.transformedCards.size ? new Map(p.transformedCards) : EMPTY_TRANSFORMS);
      },
      onComplete: () => {
        // Same +pad as the legacy path's completion (see EOT_COMBAT_PAD_MS). Once-guarded because the
        // unmount safety net's `finish()` can re-deliver completion while the pad timer is pending.
        if (eotPadFiredRef.current) return;
        eotPadFiredRef.current = true;
        window.setTimeout(() => {
        setEotProcUids(new Set());
        setEotPulseUids(new Set());
        setElectrifyUids(new Set());
        endTurnPendingRef.current = false;
        setEndTurnAnimating(false);
        // Dropped in the SAME commit that puts the real cards in hand, or both lists render for a frame.
        setEotGrants([]);
        setEotSummons([]);       // the real summoned cards are on run.board after commit
        setEotKeywords(EMPTY_KW); // the real keywords are on run.board after commit
        setEotTransforms(EMPTY_TRANSFORMS); // the real (transformed) cards are on run.board after commit
        eotCancelRef.current = null;
        eotFodderCleanupRef.current = []; // the crumbles have played; their cleanups are spent
        commitPresentationAction();
        // The shop-consume crumble + eater-gain hold already played on their beats (the `fodderEaten` presenter);
        // advance both legacy commit-time watchers' refs past the now-committed seq so they don't replay them.
        // Mid-shop consumes (not the authoritative EoT) still animate — those bump the seq outside this path.
        const committedShopEatSeq = useGame.getState().run.shopEatenSeq;
        prevShopEatSeq.current = committedShopEatSeq;
        prevShopEatHoldSeq.current = committedShopEatSeq;
        setEotConsumedUids(new Set());
        }, EOT_COMBAT_PAD_MS);
      },
    });

    const cancel = runTimeline(player, { speed: 1 });
    // Unmount safety net (§5.6): cancel the loop and COMMIT — never leave End Turn locked with a prepared
    // action stranded. `finish()` delivers everything remaining, so a skip lands the same state as watching.
    eotCancelRef.current = () => { cancel(); player.finish(); };
    return true;
  };

  // End Turn → face the Omen. End-of-Turn effects play out *one at a time* on the still-mounted
  // recruit board so the player sees each one fire — and each repeats `chronosRepeats` times when a
  // Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat order). Each beat flashes the
  // proc flourish under its card plus a tailored effect: Ritualist washes the whole shop purple (it
  // buffs the Fodder there), Combinator electrifies the Mechs it magnetizes onto. Then it faces the
  // Omen. (The effects themselves still *resolve* inside `faceOmen` — this is purely the telegraph.)
  const endTurn = (): void => {
    if (inCombat || endTurnPendingRef.current) return;
    // TUTORIAL gate: a guided step can block ending the turn (e.g. before a minion is bought). The choreographed
    // End-of-Turn path commits through `commitPresentationAction`, NOT `dispatch` (where the gate normally
    // lives), so check it here at the single End Turn entry — covering both the authoritative and legacy paths.
    const gate = tutorialGateBlocks({ type: 'faceOmen' }, run);
    if (gate.blocked) { if (gate.reason) notifyTutorialGateNudge(gate.reason); return; }
    // CHOREOGRAPHER PR 4: the authoritative path. Resolve End of Turn ONCE, animate the emitted batch through
    // the shared compiler + player, then commit the already-resolved state. Legacy stays the default until the
    // owner has compared them side by side (blueprint PR 4 keeps both, PR 5 deletes the old one).
    if (CHOREO_EOT && playEndOfTurnAuthoritative()) return;
    const repeats = endOfTurnRepeats(run);
    type Beat = { uid: string; kind: 'combinator' | 'generic'; targets: string[]; completes: boolean; label?: string; gust?: boolean; infuse?: boolean; eotEffect?: string };
    const beats: Beat[] = [];
    for (const card of run.board) {
      const def = CARD_INDEX[card.cardId];
      if (!def?.effects.some((e) => e.on === 'endOfTurn')) continue;
      const kind: Beat['kind'] = card.cardId === 'combinator' ? 'combinator' : 'generic';
      // A cadence End-of-Turn effect (Frontdrake: every `every` turns) only *officially* fires on its due
      // turn — other turns it just ticks toward it (progress → glow only). Non-cadence EOT effects fire
      // every turn (→ pulse every turn). `completes` drives glow-vs-pulse + the trigger sound.
      const cadence = def.effects.find(
        (e) => e.on === 'endOfTurn' && typeof e.params?.every === 'number' && e.params.every > 1,
      );
      const every = (cadence?.params?.every as number | undefined) ?? 1;
      const completes = !cadence || (((card.eotTick ?? 0) + 1) % every === 0);
      // Combinator welds onto 2 *random* friendly Mechs each proc — derive the exact same uids the
      // reducer will (shared seeded picker), so the electrify highlights the Mechs that actually get
      // buffed. Computed per proc (r), since each repeat picks a fresh random pair.
      const slot = run.board.indexOf(card);
      // Fodder/Imp-buffing End-of-Turn effects (Maw's +1/+1, Ritualist's escalating grant) fire the tavern
      // gust ON THEIR BEAT — the faceOmen stamp lands after the phase flips to combat, so the watcher
      // (correctly) skips it; the beat is when the buff visibly happens in the shop.
      const gust = completes && def.effects.some((e) => e.on === 'endOfTurn' && (e.do === 'battlecryBuffFodder' || e.do === 'buffFodderImpsImproving'));
      // Fodder-QUEUEING End-of-Turn effects (Maw's "add a Fodder to your next shop") reach the infusion
      // tendrils on their beat too — same shop-visible timing rationale as the gust.
      const infuse = completes && def.effects.some((e) => e.on === 'endOfTurn' && (e.do === 'addTavernFodder' || e.do === 'addFodderNextShops'));
      for (let r = 0; r < repeats; r++) {
        const targets =
          kind === 'combinator' ? magnetizeTargets(run.board, card.uid, 2, run.seed, run.wave, slot, r) : [];
        beats.push({ uid: card.uid, kind, targets, completes, gust, infuse });
      }
    }
    // Quest/rune recurring End-of-Turn REWARDS (Rune of Spending, Rune of Action, Echoing Roar, …) fire AFTER
    // the warband's own effects (matching `applyEndOfTurn`) and were previously invisible. Append a beat per
    // (effect × repeat) — the stat climb is auto-derived from the projection diff below, so no source card is
    // needed; the beat just anchors the flourish/label on whatever minion(s) actually gain.
    for (const qb of questEndOfTurnBeats(run)) {
      // `qb.uid` when the reward HAS a source card (Rune of Lasting Cadence: each beat is one minion's Rally,
      // so the proc flourish + pulse belong on that minion). Sourceless rewards keep '' and descend.
      beats.push({ uid: qb.uid ?? '', kind: 'generic', targets: [], completes: true, label: qb.label, eotEffect: qb.effect });
    }
    if (beats.length === 0) {
      dispatch({ type: 'faceOmen' });
      return;
    }
    // Per-proc cumulative stats (aligned 1:1 with `beats`) so the board's numbers visibly climb as each
    // effect fires — then `faceOmen` bakes the same totals in for real. The pre-EoT stats are the floor.
    // `fx` carries each beat's captured buff-others + Fodder consumes (also 1:1 with `beats`) — the real
    // commit lands inside `faceOmen` AFTER the phase flips, so the beats are the only place to show them.
    const { steps, fx: beatFx } = projectEndOfTurnSteps(run);
    const baseStats: Record<string, { attack: number; health: number }> = {};
    for (const c of [...run.board, ...run.hand]) baseStats[c.uid] = { attack: c.attack, health: c.health };
    // Pre-animation cadence tick per uid — the counter projects to baseTick+1 when a card's beat fires
    // (eotTick advances once per turn regardless of Chronos repeats), matching what faceOmen commits.
    const baseTick: Record<string, number> = {};
    for (const c of run.board) baseTick[c.uid] = c.eotTick ?? 0;
    if (heroArmed) armHero(); // a stray armed Hero Power shouldn't fire mid-animation
    if (equipArmed) armEquipment();
    endTurnPendingRef.current = true;
    setEndTurnAnimating(true); // lock the shop / board / hero power while the beats play
    setEotShopStats(null); // fresh shop-buff climb for this turn (drained + baked when combat starts)
    const BEAT = 760;
    const GAP = 170;
    const playBeat = (i: number): void => {
      if (i >= beats.length) {
        // The whole completion block is DEFERRED by the pad so the previews still drop in the SAME commit
        // `faceOmen` puts the real cards in hand (the two lists would otherwise both render for a frame and
        // the hand would visibly double). The board stays locked through the pad (endTurnAnimating holds).
        window.setTimeout(() => {
          setEotProcUids(new Set());
          setEotPulseUids(new Set());
          setElectrifyUids(new Set());
          endTurnPendingRef.current = false;
          setEndTurnAnimating(false);
          setEotGrants([]);
          dispatch({ type: 'faceOmen' });
        }, EOT_COMBAT_PAD_MS);
        return;
      }
      const b = beats[i]!;
      setEotProcUids(new Set([b.uid]));
      setEotPulseUids(b.completes ? new Set([b.uid]) : new Set()); // pulse only when it officially fires
      // Tick this card's cadence counter up (projected) in lock-step with its beat — so Money Maker /
      // Frontdrake visibly climbs 1/2 → 2/2 as the medallion fires, not a turn later. (No-op for uids
      // without a cadence counter; '' quest beats carry no source card.)
      if (b.uid && baseTick[b.uid] !== undefined) {
        const projected = baseTick[b.uid]! + 1;
        setEotAnimTick((prev) => ({ ...(prev ?? {}), [b.uid]: projected }));
      }
      // Medallion cue: officially firing → the energy-release pulse; progress-only (cadence ticked but
      // didn't fire, e.g. Frontdrake's countdown) → the softer glow cue.
      if (b.completes) sfx.triggerPulse();
      else sfx.triggerGlow();
      // SPELL POWER — fired from the BEAT, for the same reason as the tendril below: the End-of-Turn commit
      // lands after the phase flips, so the reducer-keyed signal played at Start of Combat instead of on the
      // proc (owner report 2026-07-21 — Aeon Guard). Driving it here puts the flourish on the unit, at its
      // moment, once PER PROC — a Chronos-repeated End of Turn now pops once per beat.
      if (b.uid) {
        const bd = CARD_INDEX[run.board.find((c) => c.uid === b.uid)?.cardId ?? ''];
        const gold = run.board.find((c) => c.uid === b.uid)?.golden ? 2 : 1;
        // SPELL POWER raised on this beat. Driven by the PROJECTION's measured delta, not by matching a
        // factory id: this used to test `eff.do === 'battlecryBuffSpellPower'`, which is Aeon Guard's factory
        // and nobody else's — so Void Curator, which raises the same channel through
        // `endOfTurnBuffSpellsAndImps`, played no cue at all (owner report 2026-07-28). Reading the delta means
        // any card that moves spell power at End of Turn animates, including ones not written yet.
        //
        // Still beat-driven rather than state-driven: `faceOmen` commits after every beat has played and flips
        // the phase as it lands, so a state-driven cue arrives at Start of Combat instead of on the proc.
        const spGain = beatFx[i]?.spellPower;
        if (spGain) {
          const el = document.querySelector(`[data-uid="${b.uid}"]`);
          if (el) {
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            pixiFx.spellPower(cx, cy, getSpellPowerFxConfig());
            floatSpellPowerNumber(cx, cy - r.height * 0.3, spGain.attack, spGain.health);
            // …and pop the held SPELLS, whose printed values this proc just raised.
            fireSpellBuffOnHandSpells(run.hand);
          }
        }
        // IMP AURA washed on this beat (Void Curator). The action-level wash watcher is gated on the run still
        // being in recruit AFTER the action, and End of Turn flips to combat — so an End-of-Turn imp buff never
        // washed. The board is still on screen during the beats, so it plays here.
        if (beatFx[i]?.impAura) fireAuraWave('demon');
        // RUBY strength raised at End of Turn — same beat-driven treatment, so it's already wired for whenever
        // a card grants it on an End of Turn (no shipped card does today; `rubyStatGain` is Shout/cast-only).
        for (const eff of bd?.effects ?? []) {
          if (eff.on !== 'endOfTurn' || eff.do !== 'rubyStatGain') continue;
          const gA = Number(eff.params?.attack ?? 0) * gold;
          const gH = Number(eff.params?.health ?? 0) * gold;
          if (gA <= 0 && gH <= 0) continue;
          const el = document.querySelector(`[data-uid="${b.uid}"]`);
          if (!el) continue;
          const r = el.getBoundingClientRect();
          const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
          pixiFx.rubyPower(cx, cy, getRubyPowerFxConfig());
          floatRubyPowerNumber(cx, cy - r.height * 0.3, gA, gH);
          fireSpellBuffOnHandRubies(run.hand);
        }
      }
      // QUEST TENDRIL — fired from the BEAT, not from reducer state. The End-of-Turn commit (`faceOmen`)
      // lands only after every beat has played and the phase has flipped, so a reducer-driven signal arrives
      // when the board is already gone — which is why this never showed at End of Turn while ▶ Test worked
      // (owner report 2026-07-21). Driving it here also gives the per-proc timing: one ribbon per beat.
      if (b.eotEffect && getQuestTendrilConfig().enabled) {
        // Resolve the unit this reward hits, mirroring `runRecurringEndOfTurn`'s pick.
        const targetUid = b.eotEffect === 'triggerLeftmostShout'
          ? run.board.find((c) => { const d = CARD_INDEX[c.cardId]; return !!d && d.effects.some((e) => e.on === 'onPlay'); })?.uid
          : b.eotEffect === 'triggerLeftmostEcho'
            ? run.board.find((c) => CARD_INDEX[c.cardId]?.effects.some((e) => e.on === 'onDeath'))?.uid
            : undefined;
        const nodeEl = document.querySelector(`.questbadges [data-eot-effect="${b.eotEffect}"]`);
        const unitEl = targetUid ? document.querySelector(`[data-uid="${targetUid}"]`) : null;
        if (nodeEl && unitEl) {
          const nr = nodeEl.getBoundingClientRect();
          const ur = unitEl.getBoundingClientRect();
          pixiFx.buffTendril(
            { x: nr.left + nr.width / 2, y: nr.top + nr.height / 2 },
            { x: ur.left + ur.width / 2, y: ur.top + ur.height / 2 },
            tendrilCfgFor(i % 2 === 0 ? 1 : -1),
          );
        }
      }
      // `b.gust` still rides the beat (Maw / Ritualist) but has no effect authored since the buff gust was
      // removed 2026-08-17. Left in place so a replacement needs no re-plumbing.
      if (b.infuse && b.uid) fireFodderInfusion(b.uid); // Maw: send-Fodder tendrils reach the shop on the beat
      if (b.kind === 'combinator') setElectrifyUids(new Set(b.targets));
      // This beat's captured FX from the projection: buff-others tendril/descend out of the firing card
      // (incl. a Hunter reacting to the beat's Attack gain), and Fodder consumes (Abyssal Feeder /
      // Feasting Bogrot) as the full ghost-crumble eat choreography.
      const bfx = beatFx[i];
      if (bfx) {
        // Itemized per-z rewards land one WAVE per step (every eligible minion inside a wave fires
        // together), paced by the ✨ Buff FX tuner's minimum wave gap rather than beat ÷ event-count —
        // the old formula compressed a big board into an unreadable smear (owner 2026-07-18).
        if (bfx.buffFx.length > 0) {
          // Targets that took a RUBY this beat get the gem cascade below instead of the generic descend —
          // the same "authored replaces stock" rule the shop's `rubyOwned` filter applies (owner 2026-08-12).
          const rubied = new Set((bfx.ruby ?? []).map((l) => l.uid));
          const evts = rubied.size > 0 ? bfx.buffFx.filter((e) => !rubied.has(e.targetUid)) : bfx.buffFx;
          if (evts.length > 0) {
            const waveCount = new Set(evts.map((e, k) => e.fxWave ?? -1 - k)).size;
            replayBuffFxEvents(evts, waveGapFor(Math.min(waveCount, getBuffFxConfig().waveMaxCount)));
          }
        }
        if (bfx.eaten.length > 0) playFodderEat(bfx.eaten, ++eotEatKey.current);
        // Cards this beat grants to hand arrive ON the beat — each coalesces beside the pulse that produced
        // it, instead of the whole turn's batch materialising at once when `faceOmen` finally commits.
        if (bfx.handGrants.length > 0) setEotGrants((g) => [...g, ...bfx.handGrants]);
        // Auto-welds on this beat (Combinator / Cling Drones / Money Bots) — ring each host as it fuses.
        fireWeldFxBatch(bfx.welds, 'auto');
        // Shop offers this beat grew (a Moira re-firing Market Tormentor's Shout at End of Turn; Soul Defiler's
        // buy-bonus) — a green burst + "+A/+H" float on each, so the shop buff plays out while the shop is still
        // on screen instead of landing silently after the phase flips to combat (owner report 2026-08-11).
        if (bfx.shopBuff?.length) {
          // Tick the DISPLAYED shop-offer stats up on THIS beat (accumulated across beats), so the number climbs
          // in real time as the Shout re-fires — not just a float over a static number (owner ask 2026-08-12).
          setEotShopStats((prev) => {
            const next = { ...(prev ?? {}) };
            for (const sb of bfx.shopBuff!) {
              const cur = next[sb.uid] ?? { attack: 0, health: 0 };
              next[sb.uid] = { attack: cur.attack + sb.attack, health: cur.health + sb.health };
            }
            return next;
          });
          // The stat change creates an intrinsic "hold" (Card shows the OLD number until a roll/FX drains it).
          // Board minions' holds drain via their buff-FX descend; a shop offer has none, so its hold would sit
          // through the whole animation and the number would appear to change only after End of Turn (owner
          // report 2026-08-12). Release the hold once the new stats have committed (double rAF: after the render
          // + the layout effect that CREATES the hold), so the printed number lands on the beat under the float.
          const buffedUidList = bfx.shopBuff.map((sb) => sb.uid);
          requestAnimationFrame(() => requestAnimationFrame(() => { for (const u of buffedUidList) releaseStat(u); }));
          for (const sb of bfx.shopBuff) {
            const el = document.querySelector(`[data-zone="tavern"] .card[data-uid="${sb.uid}"]`);
            if (!el) continue;
            const r = el.getBoundingClientRect();
            const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
            pixiFx.spellPower(cx, cy, getSpellPowerFxConfig());
            floatSpellPowerNumber(cx, cy - r.height * 0.3, sb.attack, sb.health);
          }
        }
        // RUBIES this beat played onto board minions (Rune of the Lapidary) — fire the SAME bound gem cascade
        // the shop plays, ON the beat: the reducer-keyed cue only advances when `faceOmen` commits, after the
        // phase has flipped and the board elements are gone (owner report 2026-08-12). The board is still on
        // screen during the beats, so this is where the gems can land.
        if (bfx.ruby?.length) {
          runRecruitMomentCues(
            { kind: 'rubyLanded', recipients: bfx.ruby.map((l) => ({ uid: l.uid, count: l.count })) },
            {
              cardIdOf: (uid) => runRef.current.board.find((c) => c.uid === uid)?.cardId ?? null,
              measure: (uid) => {
                const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
                return el ? restingCenterOf(el) : null;
              },
              onLand: () => sfx.gemApply(),
            },
          );
        }
        // RUNE-BUFF-UNIT this beat (Spending, Action, Lassoing, …): the sparkle on each minion a rune buffed
        // at End of Turn, on the beat — like the gems, the action-level cue can't (the board is gone once
        // `faceOmen` commits). `bfx.runeBuffUnits` is the sim's per-beat source-label diff.
        if (bfx.runeBuffUnits?.length && canPlayDefs()) {
          const camera = { x: window.innerWidth / 2, y: window.innerHeight / 2 };
          for (const uid of bfx.runeBuffUnits) {
            const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
            const at = el ? restingCenterOf(el) : null;
            if (at) playDef('rune-buff-unit', { target: at, camera }, { uids: { target: uid } });
          }
        }
        // The RUN-WIDE shop buff this beat produced (Soul Defiler, Display Curator) — the shop-wide aura, on
        // the beat, for the same reason the gems are here: the action-level cue only advances once `faceOmen`
        // commits, by which time the phase has flipped and the shop is gone. `shopBuffAll` is the
        // `tavernBuyBonus` delta specifically, so a Moira-re-fired Market Tormentor growing ONE offer keeps
        // its per-offer float above and does not summon the whole-shop aura.
        if (bfx.shopBuffAll) {
          runRecruitMomentCues(
            {
              kind: 'shopBuffAll',
              recipients: runRef.current.shop.map((o) => ({ uid: o.uid, count: 1 })),
              attack: bfx.shopBuffAll.attack,
              health: bfx.shopBuffAll.health,
            },
            {
              cardIdOf: () => null, // kind-level binding only — the moment is the shop, not a card
              measure: (uid) => {
                const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`);
                return el ? restingCenterOf(el) : null;
              },
            },
          );
        }
      }
      // Tick the affected minions' stats up to this proc's values + flash whoever just gained.
      const cur = steps[i];
      if (cur) {
        // Withhold the eaters' gains for THIS raise, drained by the layout effect that watches
        // `eotAnimStats` — see `pendingFodderHolds`. Inside the `if (cur)` deliberately: with no raise there
        // is nothing to withhold, and a hold stashed against a raise that never comes would be applied by
        // whatever beat raised next, against a number it has nothing to do with.
        if (bfx && bfx.eaten.length > 0) pendingFodderHolds.current = fodderGainHolds(bfx.eaten);
        setEotAnimStats(cur);
      }
      // End-of-turn cue: every proc plays the glow sound. For a glow-only beat this is the SAME sound the
      // medallion cue above just fired for the same card — the built-in dedup collapses them to one play.
      sfx.triggerGlow();
      window.setTimeout(() => {
        setEotProcUids(new Set());
        setEotPulseUids(new Set());
        setElectrifyUids(new Set());
        window.setTimeout(() => playBeat(i + 1), GAP);
      }, BEAT);
    };
    playBeat(0);
  };
  // Spark on a targeted minion's card centre (falls back to the drop point).
  const sparkAtUid = (uid: string, fx: number, fy: number): void => {
    const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${uid}"]`);
    if (el) {
      const r = el.getBoundingClientRect();
      fireSpark(r.left + r.width / 2, r.top + r.height / 2);
    } else fireSpark(fx, fy);
  };
  // Yazzus replays the cast: fire the spell's spark once per resolution (2× / 3× when golden — AIMED
  // spells only, matching `spellCasts`), staggered, so a doubled cast visibly procs more than once.
  const castSparks = (fn: () => void, cardId: string): void => {
    const def = CARD_INDEX[cardId];
    const n = def ? spellCastCount(useGame.getState().run, def) : 1;
    fn();
    for (let i = 1; i < n; i++) window.setTimeout(fn, i * 200);
  };

  // A tavern spell cast plays its AUTHORED def from the release point (the `cursor` anchor) when one is bound,
  // and SUPPRESSES the generic spark for it — the same "authored replaces stock" rule the buff/Karwind paths
  // follow. Unbound spells keep today's spark (Yazzus re-fire included). A BUFF ale (Champion's/Defensive/
  // Bloody) additionally carries the minions it buffed THIS action as trail targets, so the def fans out
  // cursor→minion instead of firing once at the point, and claims them for the buff-FX suppression filter
  // (Step 4 below) so the generic tendril pop doesn't ALSO play on top of the authored trail.
  const fireSpellCastFx = (cardId: string, pt: { x: number; y: number }): void => {
    if (!bindingFor(cardId, 'spellCast')) { castSparks(() => fireSpark(pt.x, pt.y), cardId); return; }
    const st = useGame.getState().run;
    // The minions this cast buffed THIS action are the trail targets (leftmost / 3 randoms); distinct uids.
    const targets = Array.from(new Set(st.recruitBuffFx.map((e) => e.targetUid)));
    if (targets.length > 0) spellCastOwnedRef.current = { seq: st.recruitFxSeq, uids: new Set(targets) };
    const recipients = targets.map((uid) => ({ uid, count: 1 }));
    const ctx = {
      cardIdOf: (uid: string) => runRef.current.board.find((c) => c.uid === uid)?.cardId ?? null,
      measure: (uid: string) => { const el = document.querySelector<HTMLElement>(`[data-uid="${uid}"]`); return el ? restingCenterOf(el) : null; },
    };
    // Base volley: from the cursor (release point).
    runRecruitMomentCues(spellCastMoment(cardId, pt, recipients), ctx);
    // EDWARD KEG-HANDS echo: Edward (`dw_edward`) makes Ales trigger twice (three times gilded) — the sim already
    // re-ran the buff, but we dedupe the targets, so the repeat would be invisible. Re-fire the SAME fan-out from
    // Edward's card: 1 extra volley for ×2, 2 for ×3 (gilded), each 80ms after the last. Gated on `recipients`
    // (only buff ales have minion targets) — and Edward only multiplies Ales, and only Ales carry a spellCast
    // binding, so recipients + Edward ⟺ an Ale Edward doubled. Edward's position is measured at echo time (inside
    // the timeout), so it survives Edward himself being re-rendered by the buff.
    const edwards = targets.length > 0 ? st.board.filter((c) => c.cardId === 'dw_edward') : [];
    const echoes = edwards.length > 0 ? (edwards.some((e) => e.golden) ? 2 : 1) : 0;
    const edwardUid = edwards[0]?.uid;
    for (let i = 1; i <= echoes; i++) {
      window.setTimeout(() => {
        const el = edwardUid ? document.querySelector<HTMLElement>(`[data-uid="${edwardUid}"]`) : null;
        const center = el ? restingCenterOf(el) : null;
        if (!center) return; // Edward left the board (sold/tripled), or isn't laid out, before the echo — skip cleanly
        runRecruitMomentCues(spellCastMoment(cardId, center, recipients), ctx);
      }, i * SPELLCAST_EDWARD_ECHO_MS);
    }
  };

  // The hand-card backplate's exit: it imprints as a glowing arcane WIREFRAME of itself, then burns off to
  // blue dust. Fires on RELEASE and runs on its own clock, deliberately NOT bounded by the ~200ms FLIP
  // flight — a dissolve clamped to the flight reads as a blink. The effect itself lives in `plateDissolve.ts`
  // (owner-authored in fx/plate-dissolve-preview.html); this is only the trigger.
  const platePuff = (): void => {
    // Measure the plate on the LIVE drag card — `applyDrop` runs before `setDrag(null)`, so it is still
    // mounted here. `playPlateDissolve` then builds its own detached layers on <body> at that rect, so the
    // effect survives React unmounting the drag card underneath it.
    // No `pixiFx.dust` any more: the plate's exit is arcane now, and a tan dirt puff from the same instant
    // muddied it. `puffOnBoard` still throws that dust when the MINION seats, which is what it was for.
    const src = document.querySelector<HTMLElement>('.dragcard .cardplate');
    if (!src) return;
    playPlateDissolve(src.getBoundingClientRect());
  };

  // A puff of dry-dirt dust ringing a card that just landed on / moved across the board. We wait for the
  // GSAP Flip (0.18s) to settle, then measure the card's *landed* rect by uid — so the dust follows where
  // the card actually ends up (e.g. snapping back to the middle), not where it was dropped. The card is
  // briefly raised above the FX canvas (.pixifx z110) so the dust renders BEHIND it, escaping out from
  // under every side. `.app` isn't a stacking context, so a z-index on the card wins over the overlay.
  const puffOnBoard = (uid: string): void => {
    window.setTimeout(() => {
      const el = document.querySelector<HTMLElement>(`[data-zone="warband"] .row.warband .card[data-uid="${uid}"]`);
      if (!el) return;
      const r = el.getBoundingClientRect();
      // A card with a persistent AURA (divine-shield bubble OR reborn wisp) must keep that aura in FRONT, so
      // we DON'T raise it above the FX canvas — doing so would hide the aura + its coalesce/pop behind the
      // card for the dust's lifetime (the "effect flickers behind the card on placement" bug). The dust just
      // renders over the card instead (subtle tan puffs; barely noticeable). Aura-free cards raise as before
      // so their landing dust tucks behind them. Driven off AURA_MARKERS so any future aura kind is covered.
      const hasAura = AURA_MARKERS.some((m) => el.classList.contains(m));
      if (!hasAura) {
        const prevPos = el.style.position;
        const prevZ = el.style.zIndex;
        el.style.position = 'relative';
        el.style.zIndex = '111'; // above .pixifx (z110) → dust renders behind the card
        window.setTimeout(() => { el.style.position = prevPos; el.style.zIndex = prevZ; }, 850);
      }
      // The authored `landing-dust` def: sized to this card (`scale`) and, as the hand-written call did with
      // its `density` argument, +50% denser here than the combat-summon poof (`intensity`).
      const c = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
      playDef('landing-dust', { source: c, target: c },
        { scale: cardFxScale(r.width), intensity: 1.5, uids: { source: uid, target: uid } });
    }, 200); // after the Flip settles, so the rect is the resting slot, not mid-slide
  };

  // Dispatch a `play` and, if it summoned token(s) (new board minions other than the played card), hold
  // their mount-pop ~0.2s so the trigger pulse reads first and the token appears right after. Runs
  // synchronously, so the delay flag is set in the same React batch as the dispatch — before the token's
  // card mounts (a post-render detection would be too late; the pop would already have played).
  const playWithSummonDelay = (action: { type: 'play'; uid: string; toIndex?: number; targetUid?: string }): void => {
    const before = new Set(run.board.map((c) => c.uid));
    dispatch(action);
    const tokens = useGame.getState().run.board.filter((c) => !before.has(c.uid) && c.uid !== action.uid).map((c) => c.uid);
    if (tokens.length === 0) return;
    setSummonDelayUids((s) => new Set([...s, ...tokens]));
    window.setTimeout(() => setSummonDelayUids((s) => {
      const n = new Set(s);
      for (const u of tokens) n.delete(u);
      return n;
    }), 600);
  };

  const applyDrop = (d: DragState, zone: Zone | null, x: number, y: number): boolean => {
    // Insertion uses the dragged card's centre (not the raw drop pointer), matching the live preview.
    const cx = x - d.ox + d.w / 2;
    if (d.source === 'shop' && zone === 'hand') {
      // The hand copy is a NEW uid, so read it back off the store rather than assuming the shop one carries
      // over. Synchronous, like `playWithSummonDelay` above — the dispatch has already reduced by here, and
      // the card's own layout effect (which plays the slide) runs after this commit.
      const s0 = useGame.getState().run;
      const before = new Set(s0.hand.map((c) => c.uid));
      const triples0 = s0.triplesMade ?? 0;
      dispatch({ type: 'buy', uid: d.uid });
      const s1 = useGame.getState().run;
      const added = s1.hand.find((c) => !before.has(c.uid));
      /* Nothing added = the buy was refused (Gold, hand full).
         Triples ticked = this buy COMPLETED A TRIPLE, and `checkTriples` runs inside the same `buy` action:
         the copy you bought was consumed on the spot and the only new hand card is the GILDED one. Sliding
         that card would hand the gild's own card two owners — and worse, the slide's `opacity: 1 !important`
         would cancel the gild's hide, so the gilded card sat in hand from the first frame and its flight home
         had nothing left to deliver (owner report 2026-07-23). The gild owns that moment; no slide. */
      if (added && (s1.triplesMade ?? 0) === triples0) {
        buyPendingRef.current = { uid: added.uid, from: { x: x - d.ox, y: y - d.oy, w: d.w, h: d.h } };
      }
      return true;
    }
    // A shop offer dropped back in the tavern reorders it (so it lands where you drop it,
    // like the warband, instead of snapping back). The spell stays pinned at the end.
    if (d.source === 'shop' && zone === 'tavern' && d.uid !== run.spell?.uid) {
      // Land it exactly where the preview showed the gap (last rendered), not at a freshly recomputed release
      // point — otherwise a fast drop resolves a different slot than the neighbours opened for, so they visibly
      // reverse (the "rebound"). Fall back to the release point only if no gap was rendered.
      dispatch({ type: 'reorderShop', uid: d.uid, toIndex: prevShopGapRef.current >= 0 ? prevShopGapRef.current : shopIndexAt(cx, d.uid) });
      return true;
    }
    // Sell a *board* minion by dropping it on the tavern. A minion must be played to the board first
    // before it can be sold — a hand minion flung up to the tavern just snaps back to the hand (it
    // falls through to the invalid-drop snap-back below). Spells are never sold (cast/play gesture).
    if (d.source === 'board' && zone === 'tavern' && !d.view.spell && !timeUp) {
      // Float the actual Gold gained at the spot the minion was released (not over the Gold counter).
      const card = run.board.find((c) => c.uid === d.uid);
      if (card) {
        const id = ++sellFloatId.current;
        const fx = x - d.ox + d.w / 2, fy = y - d.oy + d.h / 2;
        setSellFloats((f) => [...f, { id, x: fx, y: fy, amount: sellValueWithBonus(card, run) }]); // bartering- AND Quick-Sale-aware
        window.setTimeout(() => setSellFloats((f) => f.filter((s) => s.id !== id)), 1000);
      }
      // Sprinkle gold coins out of the GOLD PILL (bottom-right of the board — the gold moved off the top
      // strip, so the old `.statcell.gold` no longer exists and the burst fired nowhere). The authored
      // `coin` def; feed the pill's centre to source/target/cursor so it emits there whatever anchor it uses.
      const goldEl = document.querySelector('.goldpill');
      if (goldEl) {
        const gr = goldEl.getBoundingClientRect();
        const g = { x: gr.left + gr.width / 2, y: gr.top + gr.height / 2 };
        playDef('coin', { source: g, target: g, cursor: g });
      }
      dispatch({ type: 'sell', uid: d.uid });
      return true;
    }
    // A HAND card (minion OR spell) released DOWN in the hand region REORDERS it — takes precedence over
    // play/cast, so spells reorder too. Lands where the live gap opened (prevHandGapRef, WYSIWYG). The settle
    // Flip is captured here EXCLUDING the dragged card, so it just appears in its new slot — no replay of the
    // drag. A drop on its own slot is a no-op (it settles back in place). Spells use their own LOWER line, so
    // they only reorder when dropped down near the hand — lifted a little clear of it already arms the cast.
    if (d.source === 'hand' && y >= (d.view.spell || d.view.ruby ? spellFloorRef.current : playFloorRef.current)) {
      const from = run.hand.findIndex((c) => c.uid === d.uid);
      const to = prevHandGapRef.current >= 0 ? prevHandGapRef.current : handIndexAt(cx, d.uid);
      if (from >= 0 && from !== to) {
        const els = [...document.querySelectorAll<HTMLElement>('.row.hand .card[data-uid]')].filter((el) => el.dataset.uid !== d.uid);
        handReorderFlipRef.current = Flip.getState(els);
        dispatch({ type: 'reorderHand', uid: d.uid, toIndex: to });
      }
      return true;
    }
    // Cast a spell — playable anywhere above the (low) spell line, since spells can't be sold. A targeted
    // spell hits the minion under the cursor; an untargeted spell just resolves once it's above the line.
    if (d.source === 'hand' && (d.view.spell || d.view.ruby)) {
      const up = y < spellFloorRef.current;
      // CHOOSE ONE ASKS FIRST (owner ruling 2026-08-28: "drag the spell up, then choose one, then target a
      // minion to buff"). A targeted Choose One is therefore dragged up like an UNTARGETED spell — the drop
      // needs no target at all; the prompt opens, and the aim picker takes over once a branch is chosen. Only
      // when the card will not ask (`chooseBothActive`) does it keep aiming from the drag.
      const asksFirst = chooseOneNeedsChoice(run, run.hand.find((c) => c.uid === d.uid), CARD_INDEX[d.view.cardId]);
      if ((d.view.target === 'friendly' || d.view.target === 'any') && !asksFirst) {
        // Explicit drop only: release squarely over a friendly minion (or, for `any` spells like Shatter,
        // a tavern offer). No auto-target in empty space (that silently buffed a random minion — felt broken).
        const targetUid = boardUidAt(x, y) ?? (d.view.target === 'any' ? shopUidAt(x, y) : null);
        if (!targetUid) return false; // not on a valid target → snap back to hand, no cast
        // Tier-gated spells (Eyes of Aresmar: ≤T4) only land on a valid-tier friendly BOARD minion —
        // otherwise snap back WITHOUT consuming the spell (a >T4 minion, or a tavern offer, isn't legal).
        const maxTier = CARD_INDEX[d.view.cardId]?.targetMaxTier;
        if (maxTier !== undefined) {
          const tCard = run.board.find((c) => c.uid === targetUid);
          const tTier = tCard ? CARD_INDEX[tCard.cardId]?.tier : undefined;
          if (tTier === undefined || tTier > maxTier) return false; // invalid target → snap back, no cast
        }
        // Displacement: can't trade away a golden (triple). A golden target → snap back WITHOUT consuming the spell.
        if (CARD_INDEX[d.view.cardId]?.targetNoGolden && run.board.find((c) => c.uid === targetUid)?.golden) return false;
        if (d.view.cardId === 'devour') {
          // Capture the devoured minion's centre BEFORE the cast removes it, then fling its stats over.
          const el = document.querySelector(`[data-zone="warband"] .row.warband .card[data-uid="${targetUid}"]`);
          const r = el?.getBoundingClientRect();
          const fromX = r ? r.left + r.width / 2 : x;
          const fromY = r ? r.top + r.height / 2 : y;
          dispatch({ type: 'play', uid: d.uid, targetUid });
          const fx = useGame.getState().run.devourFx;
          if (fx) {
            sparkKeyRef.current += 1;
            setDevourBolt({ fromX, fromY, toUid: fx.toUid, attack: fx.attack, health: fx.health, key: sparkKeyRef.current });
          }
          return true;
        }
        dispatch({ type: 'play', uid: d.uid, targetUid });
        if (bindingFor(d.view.cardId, 'spellCast')) fireSpellCastFx(d.view.cardId, { x, y });
        else castSparks(() => sparkAtUid(targetUid, x, y), d.view.cardId); // spark per cast (Yazzus, aimed)
        return true;
      }
      if (up) {
        dispatch({ type: 'play', uid: d.uid });
        // A Choose One that is about to open its prompt casts nothing yet — firing the cast FX here would
        // flash a spell that has not resolved (and would fire again on the real cast).
        if (!asksFirst) fireSpellCastFx(d.view.cardId, { x, y }); // authored def if bound; else the generic spark
        return true;
      }
      return false;
    }
    if (d.source === 'hand' && !d.view.spell && !d.view.ruby) {
      // Released UP in the play area (the reorder case, y ≥ play floor, is handled above) → PLAY it if there's
      // room. You needn't hit the warband row exactly; land where the preview's gap was last rendered
      // (WYSIWYG) so neighbours don't rebound. Board full → snap back.
      if (run.board.length >= CONFIG.boardMax) return false;
      const to = prevWarbandGapRef.current >= 0 ? prevWarbandGapRef.current : warbandIndexAt(cx);
      playWithSummonDelay({ type: 'play', uid: d.uid, toIndex: to });
      platePuff(); // plate dissolves from the release point, on its own clock
      puffOnBoard(d.uid); // dust around the minion where it lands
      return true;
    }
    if (d.source === 'board' && zone === 'warband') {
      const to = prevWarbandGapRef.current >= 0 ? prevWarbandGapRef.current : warbandIndexAt(cx, d.uid);
      dispatch({ type: 'reposition', uid: d.uid, toIndex: to });
      puffOnBoard(d.uid); // dust around the minion at its landed slot
      return true;
    }
    return false;
  };

  const isDragging = (uid: string): boolean => drag?.active === true && drag.uid === uid;
  // A shop card over the hand will buy it — glow the hand to confirm the drop target.
  const canDropHand = !!drag?.active && drag.source === 'shop' && overZone === 'hand';

  return (
    <div
      className={`app${run.lobby ? ' lobby' : ''}${compactCards ? ' compactui' : ''}${inCombat ? ' combat' : ''}${combatBgShown ? ' staged' : ''}${fighting ? ' fighting' : ''}${replay.shaking || lossShake ? ' shaking' : ''}${replay.critShaking ? ' shaking-crit' : ''}${
        inCombat && replay.done ? ` done ${replay.result}` : ''
      }${combatOutro === 'out' || skipFade === 'out' ? ' combatout' : combatOutro === 'in' || skipFade === 'in' ? ' combatin' : ''}${
        skipFade === 'out' ? ' combatfrozen' : ''
      }${viewing ? ' viewing' : ''}`}
      onPointerDown={onBoardPointerDown}
    >
      {/* Board art on a full-viewport layer behind the 16:9 stage — extends into the margins on off-16:9 monitors
          (see `.boardbg` in styles.css) rather than letterboxing to black. */}
      <div className="boardbg" aria-hidden="true" />
      {/* COMBAT board layer — a second `.boardbg` painting the combat art. No clip animation of its own any
          more: it snaps in/out while the CURTAIN below fully hides the swap (see the wipe state machine).
          Tree position after `.boardbg` keeps it painting above the shop art, below every zone. */}
      <div className={`boardbg boardbg--combat${combatBgShown ? ' shown' : ''}`} aria-hidden="true" />
      {/* The CURTAIN + its glowing front: PORTALED TO BODY at z105 — the hero panel (.statusbar z40), the
          foe portrait (.combatopp, a body portal itself, z42/z100), and the eot banner (z95) all live
          OUTSIDE `.app` in their own fixed stacking contexts, so an in-app curtain could never cover them
          (owner report 2026-08-28: both hero panels floated over the blue). z105 beats them all and stays
          below the Pixi FX canvas (z110), so the streak rides the blue. The curtain's clip-path transition
          is the sanctioned one-shot kind. */}
      {createPortal(<>
      <div className={curtainClass} aria-hidden="true" onTransitionEnd={onWipeEnd} style={wipeVars}>
        {/* NOW FACING — the versus announcement on the blue (owner ask 2026-08-28). A child of the curtain,
            so its clip-path carries it: the cover sweep reveals the splash and the reveal sweep wipes it
            away, no timing of its own. Entry only (the exit curtain is a plain blue beat), lobby runs only
            (practice/tutorial have no foe seat to announce). */}
        {(wipe === 'coverIn' || wipe === 'coveredIn' || wipe === 'revealIn') && run.lobby && (() => {
          const foe = playerOpponent(run.lobby);
          if (!foe?.seat) return null;
          return (
            <div className="wipevs">
              <div className="wipevs-label">Now Facing</div>
              <img className="wipevs-face" src={heroArt(foe.seat.heroId)} alt="" draggable={false} />
              <div className="wipevs-name">{foe.seat.label}</div>
            </div>
          );
        })()}
        {/* The exit curtain's own announcement (owner ask 2026-08-28; shop vignette added 2026-08-30) —
            the same format as NOW FACING, with the shop art in the circle instead of a foe portrait. */}
        {wipeExiting && (
          <div className="wipevs">
            <div className="wipevs-label">Returning to Shop</div>
            <img className="wipevs-face" src={`${import.meta.env.BASE_URL}return-to-shop.webp`} alt="" draggable={false} />
          </div>
        )}
      </div>
      {/* TWO glow fronts for the hybrid: the RING rides the bloom's seam on covers (grows with the circle,
          parked snapped at base otherwise), and the vertical BAR rides the linear reveals — parked at the
          launch edge during each hold (entry reveal runs R→L so it parks RIGHT during coveredIn; exit
          reveal runs L→R from its LEFT home). Opacity rides `sweeping` on both, so parking is invisible. */}
      <div className={`wipefront${wipe === 'coverIn' || wipe === 'coverOut' ? ' grow sweeping' : ' snap'}`} aria-hidden="true" style={wipeVars} />
      <div className={`wipebar${
        wipe === 'revealIn' ? ' rtl go sweeping'
        : wipe === 'revealOut' ? ' go sweeping'
        : wipe === 'coveredIn' ? ' rtl snap'
        : ' snap'}`} aria-hidden="true" style={wipeVars} />
      </>, document.body)}
      {/* Charge glyph — the board's etched sigil, anchored to the board midline. Lives HERE (a direct child of
          `.app`, before the zones) rather than inside the warband zone, so the warband layout offset (x/y/scale)
          never moves it; it stays on the board sigil. z:0 + earliest tree position keeps it BEHIND the cards but
          above the board backdrop (see `.chargeglyph` in styles.css). */}
      <ChargeGlyph
        inCombat={inCombat}
        window={Math.min(CHARGE_SECONDS, turnSeconds)}
        paused={!!(run.discover || run.questOffer || run.powerOffer || run.runeforgeOffer || run.pendingTarget || run.chooseOne || run.scoutedNextOpponent?.length || heroSelecting || overlayOpen)}
        covered={!!(heroSelecting || overlayOpen)}
      />
      {/* UNDER-CARD FX canvas — the host for `slot: 'under'` effect defs. Position in this child list is
          load-bearing (above `.boardbg`, below every zone); see `FxUnderSlot` for why it can't live beside
          `.pixifx` outside `.app`. */}
      <FxUnderSlot />
      <HudBar />
      {/* LOBBY RAIL — the 8-seat table down the right edge of the stage. A direct child of `.app` (not the HUD
          bar) so it can be anchored to the STAGE height and run tall beside the board, instead of hanging off
          the top-right corner where it had to stay short and wide. */}
      {run.lobby && <LobbyPanel lobby={run.lobby} />}
      {/* The foe's face for the duel — drops onto the Refresh button's anchor while the rail slides away
          (owner ask 2026-08-25). Self-gates on lobby + combat. Also the lunge target for the hero strike. */}
      <CombatOpponent />

      {!fighting ? (
      <>
      {/* SHOP controls — a labelled row of gold plaque buttons (Gold · Tavern · Reroll · Freeze) framed by
          shopbutton.webp. The turn timer now lives in the header; End Turn is a standalone button (right). */}
      <div className={`shopbar${inCombat ? ' closing' : ''}`}>
        {/* Info plaques (Shop tier + turn Time) as widgets — same plaque language as the action row so they
            read at a glance instead of as loose text. The tier value takes the card tier-badge colour. */}
        {/* Info strip — the turn's read-only stats (Gold · Tier · Setup Time) grouped in one segmented
            plaque. Styled tooltips (.sbtip) replace the native title so hover hints match the dark-pill format. */}
        {/* Gold moved to a standalone glass pill bottom-right of the board; Tier moved onto the Tavern Up stone
            (owner ask 2026-08-11). The top strip now carries only the turn timer. */}
        {/* The turn timer is hidden entirely in the tutorial — a first-time player is never on the clock
            (`turnSeconds` is already effectively infinite there; this just removes the misleading countdown). */}
        {run.mode !== 'tutorial' && (
          <div className="statstrip">
            <ShopTimer practice={run.mode === 'practice'} />
          </div>
        )}
        {/* Action tray — the turn's actions grouped into one control bar (Reroll · Freeze), framed by
            shopbutton.webp. Tavern Up moved onto the board as the standalone STONE button (TavernUpButton,
            mounted below with the End Turn diamond); Reroll/Freeze are queued for the same treatment. */}
        <div className="shoprow actiontray">
          {/* The Reroll tray plaque was replaced by the standalone REFRESH crystal, stage-pinned top-centre
              (see <RefreshButton/> below) — same reducer wiring, so nothing about rolling changed. */}
          {/* Freeze moved out of the tray to the board's TOP-RIGHT, opposite the Tavern stone — see
              <FreezeButton/> below. Same reducer wiring; only the placement changed. */}
        </div>
      </div>
      </>
      ) : (
        <div className="combatctl">
          {/* Post-combat actions stay centred. During the replay the Skip button + speed slider live in the
              top-right combat HUD (below) instead, so the arena stays clear. */}
          {/* Empty spacer — End Combat lives on the diamond and Summary is a glass pill above it (below);
              the .combatctl footprint stays so the enemy warband keeps its vertical spot. */}
          <div className="cbtns" />
        </div>
      )}

      {/* End Turn — the standalone DIAMOND button on the board's middle-right (de-coupled from the shop
          tray, owner direction 2026-07-16). Mounted through BOTH phases: the lit gem during recruit, the
          pressed (dim) gem from the click all the way through the combat screen. Keyed off `inCombat` (the
          phase itself), NOT `fighting` (which waits for the intro), so the art swap is IMMEDIATE on the
          click. Once the replay finishes it doubles as END COMBAT (a loss holds it until the loss-damage
          blast lands, same as the old button) — clicking relights it with a clean shine, no strike. */}
      {/* Summary — a small glass pill pinned ABOVE the End Combat diamond (same stage anchor + --etb-x/y
          offsets, so it rides the tuner's position); fades in floating up like the diamond's tooltip. */}
      {inCombat && replay.done && (
        <button className="combatsummary" onClick={() => { setLogTab('gains'); setShowLog(true); }}>
          <Icon name="battlecry" />
          Summary
        </button>
      )}
      {/* RIFT — the purple swirling plaque directly above the diamond, mounted only while this run has a
          pinned rift and only in the SHOP phase (in combat that slot belongs to the Summary pill). Reads
          run.rift, never the live registry, so a replayed run still shows the rift it was played under. */}
      {!inCombat && run.rift && RIFTS[run.rift] && (
        <RiftButton rift={RIFTS[run.rift]} />
      )}
      {/* A LOSS normally holds End Combat until the loss-damage blast has landed (`lossPhase === 'done'`).
          In a sandbox REPLAY that sequence never runs at all — it early-returns on `run.combatSettled`,
          which is `true` throughout a replay by design — so `lossPhase` stays null forever and the gate
          below would leave no enabled way out of the phase (Skip unmounts once the replay is done).
          Nothing is being waited on, so nothing is held. */}
      <EndTurnButton
        onEndTurn={endTurn}
        onEndCombat={endCombat}
        combatReady={inCombat && replay.done && (sandboxReplay || replay.result !== 'lose' || lossPhase === 'done')}
        disabled={inCombat
          ? !(replay.done && (sandboxReplay || replay.result !== 'lose' || lossPhase === 'done'))
          : eotAnimating || !!run.questOffer || !!run.powerOffer || !!run.runeforgeOffer || !roundSettled}
        pressed={inCombat || eotAnimating}
        urgent={timeUp && !inCombat}
      />

      {/* Tavern Up — the standalone STONE button on the board's left (replaces the tray plaque; same
          reducer wiring + disabled conditions — a re-skin, not a behavior change). Mounted through BOTH
          phases (owner note 2026-07-16): in combat it's a passive TIER INDICATOR — inert, cost coin hidden,
          art at full strength. The max-tier condition lives in the component (the broken "complete" gem). */}
      {/* Freeze — pinned TOP-RIGHT, opposite the Tavern stone. NOT gated on `timeUp` (owner 2026-07-21):
          freezing after the clock runs out is a legitimate last action — the shop is still on screen until
          the End-of-Turn animation starts, and the reducer never gated it, only this button did.
          Hidden during combat like the other shop controls (owner ask 2026-08-29) — gated on the curtain's
          staged window so it vanishes and returns under the blue. */}
      {!combatBgShown && (
      <FreezeButton
        frozen={!!run.frozen}
        disabled={eotAnimating || !!run.questOffer || !!run.powerOffer || !!run.runeforgeOffer}
        combat={inCombat}
        onFreeze={() => dispatch({ type: 'freeze' })}
      />
      )}
      {/* Refresh — the standalone crystal pinned TOP-CENTRE, replacing the tray's Reroll plaque. It used to
          stay mounted through combat as inert furniture (owner ask 2026-08-17), but the foe portrait now
          drops onto this very anchor and the owner asked for it GONE during the fight (2026-08-29). Gated on
          the curtain's staged window — not the raw phase — so it vanishes and returns under the blue, never
          in view. */}
      {/* `nextRefreshCostOf`, not `refreshCostOf`: the pill prints what THIS roll charges, folding banked
          free rolls AND Rune of Window Shopping's first-3-free allowance (bug 3abab276 — the pill kept
          showing 1 while the rune paid). Same helper gates `disabled`, so a free roll stays clickable at
          0 Gold, matching the reducer's charge order exactly. */}
      {!combatBgShown && (
      <RefreshButton
        cost={nextRefreshCostOf(run)}
        freeRolls={run.freeRolls}
        disabled={run.embers < nextRefreshCostOf(run) || timeUp || eotAnimating || !!run.questOffer || !!run.powerOffer || !!run.runeforgeOffer}
        combat={inCombat}
        onRefresh={() => dispatch({ type: 'roll' })}
      />
      )}
      {/* Tavern stone + Gold — hidden during combat with the rest of the shop furniture (owner ask
          2026-08-29, superseding the 2026-07-16 "passive tier indicator" and 2026-08-17 "gold in both
          phases" rulings): with the curtain staging every entrance/exit, the combat scene keeps only the
          fight's own controls. Both gate on the staged window so they swap under the blue. */}
      {!combatBgShown && (
      <TavernUpButton
        tier={run.tier}
        maxTier={maxTierFor(run.rift)} // Summit raises the ceiling to 7
        cost={upgradeCostOf(run)}
        disabled={run.embers < upgradeCostOf(run) || timeUp || eotAnimating || !!run.questOffer || !!run.powerOffer || !!run.runeforgeOffer}
        combat={inCombat}
        onUpgrade={() => dispatch({ type: 'upgrade' })}
      />
      )}
      {!combatBgShown && (
      <GoldPill gold={run.embers} nextTurnGold={nextTurnGold} afterNextGold={afterNextGold} wave={run.wave} />
      )}

      {/* Skip the combat replay — pinned ABOVE the End Turn / End Combat diamond (owner move 2026-08-11; it was
          a top-centre HUD, and the replay-speed slider moved to the Esc menu's Combat section). */}
      {inCombat && !replay.done && (
        <button className="combathud-skip" onClick={skipCombat} title="Skip the combat replay">
          <Icon name="sword" /> Skip
        </button>
      )}

      {/* Sell zone — the whole screen above the warband lights up while dragging a board minion, and
          releasing anywhere in it sells (handled by inSellRegion in the drop handler). */}
      {drag?.active && drag.source === 'board' && !drag.view.spell && !timeUp && (
        <div className={`sellzone${overZone === 'tavern' ? ' on' : ''}`} style={{ height: sellTop } as CSSProperties} aria-hidden="true" />
      )}

      {/* Buy zone — mirror of the sell zone: the whole screen *below* the warband lights up while dragging
          a shop card, and releasing anywhere in it buys (handled by inBuyRegion in the drop handler). */}
      {drag?.active && drag.source === 'shop' && (
        <div className={`buyzone${overZone === 'hand' ? ' on' : ''}`} style={{ top: buyTop } as CSSProperties} aria-hidden="true" />
      )}

      <div className={`zone${run.frozen && !inCombat ? ' frozen' : ''}`} data-zone="tavern">
        <div className="row">
          {combatUnitsShown ? (
            replay.visibleFrame.enemy.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="foe"
                anim={replay.anims[u.uid]}
                triggered={replay.triggerUids.has(u.uid)}
                rallyPulse={replay.rallyPulseUids.get(u.uid)}
                watcherPulse={replay.watcherPulseUids.get(u.uid)}
                framePulse={replay.framePulseUids.get(u.uid)}
              />
            ))
          ) : sbTavernShowsEnemy && run.sandbox ? (
            /* SANDBOX: the board pinned for the coming fight, shown in the row enemies actually occupy — so
               the on-screen distance an effect travels here is the distance it will travel in the real fight.
               Gated on `run.sandbox` (belt-and-braces alongside the store flag) and nested INSIDE the
               non-fighting branch, so a live combat can never be affected by this toggle. */
            (sbEnemySnap?.minions ?? []).map((m, i) => (
              <Card
                key={`sbfoe-${i}`}
                uid={`sbfoe-${i}`}
                card={{
                  name: CARD_INDEX[m.cardId]?.name ?? m.cardId,
                  cardId: m.cardId,
                  tribe: CARD_INDEX[m.cardId]?.tribe ?? 'neutral',
                  attack: m.attack,
                  health: m.health,
                  keywords: m.keywords ?? [],
                  golden: m.golden ?? false,
                  text: CARD_INDEX[m.cardId]?.text ?? '',
                  tier: CARD_INDEX[m.cardId]?.tier,
                }}
                onPointerDown={sbEditMode ? onSbEnemyPointerDown : undefined}
              />
            ))
          ) : (
          <>
          {displayShop.map((o, i) => (
            <Fragment key={o.uid}>
              {/* Gap opened by sliding the offers (`slideDir`); the dragged offer stays here invisible
                  (`dimmed`) to hold its slot — same model as the warband, no re-centre jerk. */}
              {heldUids?.has(o.uid) ? (
                // A just-consumed slot, held open (invisible, opacity 0 via `dragsrc`) so the survivors don't
                // reflow until the ghost has been pulled into the eater. `.card.compact` gives it the exact slot
                // width; `data-uid` keeps FLIP counting it, so `flipKey` is unchanged and nothing moves yet.
                <div className="card compact dragsrc" data-uid={o.uid} aria-hidden="true" />
              ) : (
              <Card
                uid={o.uid}
                slideDir={shopSlide(i)}
                dimmed={isDragging(o.uid)}
                card={shopViews.get(o.uid)!}
                refCards={refViewsByUid.get(o.uid)}
                dragging={!!drag?.active}
                highlight={(heroArmed && heroTargetsTavern) || (castingSpell && drag?.view.target === 'any')}
                targeted={(heroArmed && heroTargetsTavern && aimTargetUid === o.uid) || castTargetUid === o.uid}
                tripleReady={tripleReadyUids.has(o.uid)}
                contraband={o.contraband}
                enchanted={o.enchanted}
                suppressPop={returningFromCombat}
                onPointerDown={heroArmed ? undefined : onCardPointerDown}
              />
              )}
            </Fragment>
          ))}
          {run.spell && (
            <Card
              key={run.spell.uid}
              uid={run.spell.uid}
              dimmed={draggingShop && drag!.uid === run.spell.uid}
              card={spellView!}
              dragging={!!drag?.active}
              onPointerDown={heroArmed ? undefined : onCardPointerDown}
            />
          )}
          </>
          )}
        </div>
      </div>

      <div className={`zone${overWarband || wouldMagnetize ? ' dropok' : ''}`} data-zone="warband">
        <div className="row warband">
          {combatUnitsShown ? (
            replay.visibleFrame.player.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="you"
                anim={replay.anims[u.uid]}
                triggered={replay.triggerUids.has(u.uid)}
                rallyPulse={replay.rallyPulseUids.get(u.uid)}
                watcherPulse={replay.watcherPulseUids.get(u.uid)}
                framePulse={replay.framePulseUids.get(u.uid)}
              />
            ))
          ) : (
            <>
              {displayBoard.map((m, i) => (
                <Fragment key={m.uid}>
                  {/* No drop-slot element: the gap is opened by shifting the cards via `slideDir` (a CSS
                      transition glides it). The dragged card stays here rendered invisible (`dimmed`) so its
                      slot holds the row width — no re-centre jerk on pickup. */}
                  <Card
                    uid={m.uid}
                    align={boardAligns?.[i]}
                    slideDir={boardSlide(i)}
                    dimmed={isDragging(m.uid)}
                    card={boardViews.get(m.uid)!}
                    refCards={refViewsByUid.get(m.uid)}
                    dragging={!!drag?.active}
                    highlight={heroArmed || castingSpell || isPendingTarget(m.uid)}
                    targeted={((heroArmed || isPendingTarget(m.uid)) && aimTargetUid === m.uid) || castTargetUid === m.uid}
                    soulbound={soulboundUids.has(m.uid)}
                    battlecry={battlecryUids.has(m.uid) || eotProcUids.has(m.uid)}
                    // Medallion: a Battlecry / an officially-firing End-of-Turn pulses (ring); a cadence
                    // card that only ticked this turn (proc'd but not complete) just glows.
                    pulse={battlecryUids.has(m.uid) || eotPulseUids.has(m.uid) || karwindPulseUids.has(m.uid)}
                    pulseCrit={karwindCritPulseUids.has(m.uid) ? run.karwindFlashSeq : undefined}
                    glow={eotProcUids.has(m.uid)}
                    popDelay={summonDelayUids.has(m.uid)}
                    electrify={electrifyUids.has(m.uid) || magTargetUid === m.uid}
                    karwind={karwindFlameUids.has(m.uid) ? (m.cardId === 'bane' || CARD_INDEX[m.cardId]?.keywords.includes('FD') ? 'haze' : 'flame') : false}
                    suppressPop={returningFromCombat}
                    onPointerDown={heroArmed || pendingTarget ? undefined : onCardPointerDown}
                  />
                </Fragment>
              ))}
            </>
          )}
        </div>
      </div>

      <div
        className={`zone${canDropHand ? ' dropok' : ''}`}
        data-zone="hand"
      >
        <div className="row hand">
          {gambleHand.map((m, i) => {
            // Fan splay: each card tilts ~1.8° more than its neighbour out from the centre (capped at ±7° so a
            // big hand never over-fans; a lone card sits straight). The rotation is applied in CSS via the
            // `--fan-rot` var (see `.row.hand .card` in styles.css); it stays fanned through drags.
            const n = gambleHand.length;
            const fanRot = n <= 1 ? 0 : Math.max(-7, Math.min(7, (i - (n - 1) / 2) * 1.8));
            // Locked cards are greyed + padlocked (and can't be played). TWO meters feed this:
            // Disco Dan's Setlist locks until a SHOP TIER, Brackus's Summit until a run GOLD SPEND — the
            // label shows whichever applies, with the gold one counting down so the wait is legible.
            const goldSpent = run.goldSpent ?? 0;
            const tierLocked = !!m.lockedUntilTier && run.tier < m.lockedUntilTier;
            const goldLocked = !!m.lockedUntilGoldSpent && goldSpent < m.lockedUntilGoldSpent;
            // Hourglass Reserve's pick is "locked in hand until next turn" (`lockedUntilWave`). The reducer
            // already refuses to play it, but this lock was missing here — so it was functionally locked while
            // still LOOKING playable (owner 2026-07-24). It now wears the same greyed padlock treatment as
            // Disco Dan's tier lock and Brackus's gold lock.
            const waveLocked = !!m.lockedUntilWave && run.wave < m.lockedUntilWave;
            const locked = tierLocked || goldLocked || waveLocked;
            const lockLabel = tierLocked
              ? `Tier ${m.lockedUntilTier}`
              : goldLocked
                ? `${m.lockedUntilGoldSpent! - goldSpent} Gold`
                : waveLocked
                  ? 'Next turn'
                  : undefined;
            return (
              <Card
                key={m.uid}
                uid={m.uid}
                card={handViews.get(m.uid)!}
                refCards={refViewsByUid.get(m.uid)}
                dragging={!!drag?.active}
                dimmed={isDragging(m.uid)}
                handSlidePx={handSlide(i) * handSlotWRef.current}
                fanRot={fanRot}
                onPointerDown={onCardPointerDown}
                locked={locked}
                lockLabel={lockLabel}
                forceFull
                plated
              />
            );
          })}
          {/* Cards an End-of-Turn beat or a combat effect just granted, so the hand grows at the moment the
              effect fires (the real commit lands later, at `faceOmen` / `settleCombat`). See `handPreviews`. */}
          {handPreviews.map((cardId, i) => (
            /* `plated` to match the real hand cards exactly — the preview is swapped for the committed card,
               and an unplated preview made that swap read as a flicker. */
            <Card key={`grant-${i}`} card={conjuredView(cardId, run) ?? tokenRefView(cardId, cardBuffsLive, run.impBuff, undefined, run.rubyBonus)} suppressPop forceFull plated />
          ))}
        </div>
      </div>

      {/* Loss-damage tally — surviving enemy tiers + the opponent's tier fly up into a damage counter
          above the enemy board (clamped to the round cap), then blast the Resolve bar. */}
      {fighting && (lossPhase === 'tally' || lossPhase === 'blast') && lossPos && (   /* hidden once launched — no re-show on the board (owner 2026-08-25) */
        <div
          className={`lossdmg${lossPhase === 'blast' ? ' launch' : ''}`}
          style={{ left: lossPos.x, top: lossPos.y } as CSSProperties}
          aria-hidden="true"
        >
          <div className="lossdmg-n">{lossCount}</div>
          <div className="lossdmg-l">{lossCapped && lossCount >= lossDmg ? 'Max Damage' : 'Damage'}</div>
        </div>
      )}
      {fighting && lossFlyers.map((f) => (
        <div
          key={`lossfly-${f.id}`}
          className={`lossfly${f.isOpp ? ' opp' : ''}`}
          style={{ left: f.x, top: f.y, '--tx': `${f.tx - f.x}px`, '--ty': `${f.ty - f.y}px`, animationDelay: `${f.delay}ms` } as CSSProperties}
          aria-hidden="true"
        >
          +{f.tier}
        </div>
      ))}

      {/* Start-of-Combat bolts fly from caster to target (measured in the replay). */}
      {fighting &&
        replay.projectiles.map((p) => (
          <span
            key={`proj-${p.id}`}
            className={p.kind === 'blast' ? 'proj blast' : 'proj'}
            style={{ left: p.x, top: p.y, '--dx': `${p.dx}px`, '--dy': `${p.dy}px` } as CSSProperties}
          />
        ))}

      {/* ── Combat damage numbers, PORTALLED TO <body> ────────────────────────────────────────────────
          Damage numbers, keyword glyphs and the max-Gold pill used to render as children of their `<Unit>`,
          where the Pixi FX canvas covered them (the owner's "death-dissolve plays over the damage number"
          report). TWO nested stacking traps caused that, and the fix has to clear BOTH:

            1. `.unit` is its own stacking context in combat (`.attacking` z8, `.struck` z12, `.reborn` z14),
               so an in-unit float's `z-index: 25` only ordered it against its own card — globally it painted
               at 8/12/14, under `.pixifx` (z110). No canvas z-index can fix that from inside the unit: pick
               20 and it covers the number on a struck unit; pick 7 and every effect drops under the unit.
            2. `.app` is itself `position: relative; z-index: 1` and a SIBLING of `.pixifx` under `#root` —
               so nothing rendered anywhere inside `.app` can beat the canvas either, at any z-index. (Browser-
               verified: an anchor at z112 inside `.app` still lost the `elementFromPoint` test to `.pixifx`;
               the same node appended to <body> won it.)

          Hence the portal: these overlays mount beside `.pixifx` in the ROOT stacking context, where
          `.floatanchor`/`.deathfloat` (z112) genuinely outrank it. Same house pattern as `Card`'s hover
          reveal. They're `pointer-events: none`, so nothing about input changes.

          Each `.floatanchor` reproduces the unit's card box (centre + footprint SNAPSHOT at spawn — see
          `spawnFloats`), so every per-kind CSS rule and both keyframes still resolve against a card-sized box
          exactly as they did inside the unit. */}
      {gambleDie && createPortal(
        <div
          className={`gambledie${gambleDie.settled ? ' settled' : ''}`}
          style={{ left: gambleDie.x, top: gambleDie.y }}
          aria-hidden="true"
        >{gambleDie.n}</div>,
        document.body,
      )}
      {fighting &&
        createPortal(
          <>
            {replay.floats.map((f) => {
              const sym = SYM_KINDS.has(f.kind);
              // Random-but-STABLE splash tilt (owner ask 2026-08-27, dev "Random rotation" toggle): a
              // deterministic angle hashed from the float's own id, so it never re-rolls on re-render (which
              // would visibly spin the burst) and never touches Math.random. Damage floats only.
              let splashStyle: CSSProperties | undefined;
              if (f.kind === 'dmg') {
                const fc = getFloatConfig();
                if (fc.rotRandom) {
                  const s = String(f.id);
                  let h = 0;
                  for (let i = 0; i < s.length; i++) h = (h * 31 + s.charCodeAt(i)) | 0;
                  const deg = ((((h >>> 0) % 2001) / 1000) - 1) * fc.rotRange; // −range..+range
                  splashStyle = { '--dmg-splash-rot': `${deg.toFixed(1)}deg` } as CSSProperties;
                }
              }
              return (
                <div
                  key={`float-${f.id}`}
                  className={`floatanchor${sym ? ' symanchor' : ''}`}
                  style={{ left: f.x, top: f.y, width: f.w, height: f.h } as CSSProperties}
                  aria-hidden="true"
                >
                  <span className={`float ${f.kind}${sym ? ' sym' : ''}${f.climb ? ' climb' : ''}`} style={splashStyle}>{f.text}</span>
                </div>
              );
            })}
            {/* Killing-blow numbers for units that died this beat — never inside the unit (which collapses +
                is removed), so the number reads + lingers at the spot the minion fell. */}
            {replay.deathFloats.map((f) => (
              <div key={`death-${f.id}`} className="deathfloat" style={{ left: f.x, top: f.y } as CSSProperties} aria-hidden="true">
                <span className={`float ${f.kind}`}>{f.text}</span>
              </div>
            ))}
          </>,
          document.body,
        )}

      {/* Gold gained from a sale, floating at the spot the minion was released (the actual sell value).
          Deliberately NOT portalled with the combat numbers above: this is the shop, where the only thing on
          the FX canvas is the sell-coin sprinkle — which is meant to read as coins spilling AROUND the pill,
          not as something burying a damage number. Moving it would be churn for a defect nobody has. */}
      {sellFloats.map((f) => (
        <div key={`sell-${f.id}`} className="deathfloat" style={{ left: f.x, top: f.y } as CSSProperties}>
          {/* Above-base sells (Hoarder, Trail Forager, Rune of Bartering) float GREEN so the bonus reads. */}
          <span className={`float ${f.amount > 1 ? 'sellup' : 'gold'}`}>+{f.amount}</span>
        </div>
      ))}

      {/* The mid-screen "To your hand" flyer used to live here. Retired 2026-07-27: the granted card now
          materialises IN THE HAND on the very beat its effect procs, so the flyer showed a second copy of the
          same card, at the same instant, in the middle of the screen — the duplicate announcement the owner
          asked us to get rid of. `replay.handGrant` and the `.handgrant` CSS are kept, so restoring this is
          just putting the block back. */}

      {/* A clear "End of Turn" beat as the turn ends (end-of-turn effects have resolved). */}
      {endTurnFlash && (
        <div className="eotbanner" aria-hidden="true">
          <span className="eot-text">End of Turn</span>
        </div>
      )}

      {/* Portaled to <body> so the floating drag copy escapes `.app`'s stacking context (`.app` is
          `position:relative; z-index:1`). Board furniture at the ROOT level — the `.statusbar` at z-index 40,
          which holds the hero portrait, hero power and rune badges — otherwise painted OVER the dragcard, so a
          dragged minion frame / card plate slid BEHIND them (owner report 2026-08-20). At root, the dragcard's
          own z-index 115 wins over all that furniture while still sitting below the modal overlays (460+). It is
          `position:fixed` and positioned in viewport coords by the rAF, so the DOM move doesn't shift it, and
          the layout vars it reads (`--u`/`--ccw`/…) are defined on `:root`, so they still resolve under body. */}
      {drag?.active && !castingSpell && createPortal((
        <div
          ref={dragCardRef}
          className={`dragcard${snapping ? ' snap' : ''}${wouldMagnetize ? ' electric' : ''}${magSlide ? ' magslide' : ''}${overWarband && drag.source === 'hand' ? ' willplay' : ''}${drag.source === 'hand' ? ' fromhand' : ''}`}
          style={{
            width: drag.w,
            height: drag.h,
            // Normal drag lifts via `zoom` (crisp), written by the rAF — leave it undefined here so React
            // doesn't fight it. The React-driven release animations (snap / magnet-slide) keep `transform:
            // scale`, so force zoom back to 1 for them or the rAF's leftover zoom would stack (double-size).
            zoom: reactDrivesDrag ? 1 : undefined,
            // Normal drag: the rAF (above) owns this OUTER's `transform` + `transform-origin` (position: a
            // weighted lag + recentre onto the cursor) and its `perspective`, while the dive lives on the inner
            // `.dragtilt`. Written straight to the nodes so React re-renders don't fight them. Snap-back /
            // magnet-slide use a CSS transition, so React drives those here — the origin is the card centre
            // (matching the recentred anchor), the durations come from the config.
            transformOrigin: reactDrivesDrag ? `${drag.w / 2}px ${drag.h / 2}px` : undefined,
            transform: magSlide
              ? dragTransform(getDragFeel().perspective, drag.x - drag.ox, drag.y - drag.oy, 0, 0, 0.06, 0)
              : snapping
                ? dragTransform(getDragFeel().perspective, drag.x - drag.ox, drag.y - drag.oy, 0, 0, getDragFeel().scale, getDragFeel().staticRotate)
                : undefined,
            transitionDuration: magSlide ? `${getDragFeel().magSlideMs}ms` : snapping ? `${getDragFeel().snapMs}ms` : undefined,
            // accelerate + fade fully out as it shrinks in, so it vanishes cleanly into the Mech
            opacity: magSlide ? 0 : 1,
          }}
        >
          {/* Inner tilt layer: the rAF writes rotateX/rotateY here (dive about the card's own centre). During
              snap/magnet-slide React flattens it so the frozen last-frame rotation clears. */}
          <div className="dragtilt" ref={dragTiltRef} style={{ transform: reactDrivesDrag ? 'none' : undefined }}>
            {/* Grab-shrink layer — eases the hover→held size change (hand drags only). Its own layer so the
                one-shot scale can't fight the rAF's position/tilt writes above. See `.dragshrink` in styles.css. */}
            <div className="dragshrink">
              <Card card={drag.view} forceFull={drag.source === 'hand'} plated={drag.source === 'hand'} />
            </div>
          </div>
        </div>
      ), document.body)}

      {/* The targeting line (hero power / targeted Battlecry / targeted spell) is the LIVING Pixi curve
          now — synced in the aim-line effect above; the old dotted SVG render retired (owner 2026-07-16). */}

      {/* Targeted-Battlecry prompt: a played Toxin Tender waits for you to pick the friendly minion
          its grant lands on (click a warband minion; ending the turn auto-targets the carry). */}
      {pendingTarget && !inCombat && (
        <div className="targetprompt" aria-live="polite">
          Choose a minion for {CARD_INDEX[pendingTarget.cardId]?.name ?? 'this'}&rsquo;s Battlecry
        </div>
      )}

      {/* Spell spark: a one-shot radiating burst where a cast spell resolved. */}
      {spark && (
        <div className="spellspark" key={spark.key} style={{ left: spark.x, top: spark.y }} aria-hidden="true">
          <span className="ss-flash" />
          {[18, 70, 128, 162, 215, 268, 305, 340].map((a) => (
            <span className="ss-ray" key={a} style={{ '--a': `${a}deg` } as CSSProperties} />
          ))}
        </div>
      )}

      {/* Channeling the Devourer — the devoured minion's stats fly to a random friend as a glowing mote. */}
      {devourBolt && (
        <div className="devourbolt" key={devourBolt.key} ref={devourBoltRef} aria-hidden="true">
          +{devourBolt.attack}/+{devourBolt.health}
        </div>
      )}

      {/* Tavern Fodder: a ghost Fred pops in the tavern (showing its *eaten* stats — buffed by
          Ritualist if applicable), wreathed in purple swirls, then drifts into the Demon that ate it. */}
      {!inCombat &&
        fodderAnim?.ghosts.map((g, i) => {
          const def = CARD_INDEX[g.fid];
          if (!def) return null;
          const view: CardView = {
            name: def.name, cardId: def.id, tribe: def.tribe, attack: g.attack, health: g.health,
            keywords: def.keywords, text: def.text, tier: def.tier,
            baseAttack: def.attack, baseHealth: def.health, // so a buffed Fred reads its gain in green
          };
          const showStats = getConsumeFxConfig().showStats;
          return (
            <div
              key={`${fodderAnim.key}-${i}`}
              className={`fodderghost${showStats ? '' : ' nostats'}`}
              data-gidx={i}
              style={{ left: g.x0, top: g.y0, width: g.w, height: g.h } as CSSProperties}
              aria-hidden="true"
            >
              <Card card={view} />
            </div>
          );
        })}

      {showLog && (
        <div className="logov" role="dialog" aria-label="Combat log" onClick={() => setShowLog(false)}>
          <div className="logbox" onClick={(e) => e.stopPropagation()}>
            <div className="logtitle">
              Combat Summary <span className={`logverdict ${replay.result ?? ''}`}>{replay.result === 'win' ? 'Victory' : replay.result === 'lose' ? 'Defeat' : 'Draw'}</span>
            </div>
            {combatOdds && (
              <div
                className="logodds"
                title="Estimated from repeated simulations of this matchup — the actual result was one roll of these odds."
              >
                <div className="oddscap">Outcome odds</div>
                <div className="oddsbar">
                  <span className="ob win" style={{ width: `${combatOdds.win * 100}%` }} />
                  <span className="ob draw" style={{ width: `${combatOdds.draw * 100}%` }} />
                  <span className="ob lose" style={{ width: `${combatOdds.lose * 100}%` }} />
                </div>
                <div className="oddslabels">
                  <span className="ol win">{Math.round(combatOdds.win * 100)}% win</span>
                  <span className="ol draw">{Math.round(combatOdds.draw * 100)}% draw</span>
                  <span className="ol lose">{Math.round(combatOdds.lose * 100)}% loss</span>
                </div>
                {combatOdds.lose > 0 && (
                  <div className="oddsavg" title="Average Health lost across the losing simulations (round-capped) — what a typical loss of this matchup costs.">
                    Avg damage on loss: <b>{Math.round(combatOdds.avgLossDamage * 10) / 10}</b>
                  </div>
                )}
              </div>
            )}
            <div className="logtabs">
              <button className={`logtab${logTab === 'gains' ? ' active' : ''}`} onClick={() => setLogTab('gains')}>Gains</button>
              <button className={`logtab${logTab === 'procs' ? ' active' : ''}`} onClick={() => setLogTab('procs')}>Procs</button>
              <button className={`logtab${logTab === 'log' ? ' active' : ''}`} onClick={() => setLogTab('log')}>Log</button>
            </div>
            {logTab === 'gains' ? (
              <div className="loglines">
                <div className="loggainhead">What you keep from this fight</div>
                {(() => {
                  const gains = combatGains(run.lastCombat);
                  return gains.length === 0 ? (
                    <div className="logline">No lasting gains this fight.</div>
                  ) : (
                    gains.map((g, i) => <div className="loggain" key={i}>{g}</div>)
                  );
                })()}
              </div>
            ) : logTab === 'procs' ? (
              <div className="loglines">
                {replay.procs.map((s, i) => (
                  <div className={`logsum ${s.kind}`} key={i}>{s.text}</div>
                ))}
              </div>
            ) : (
              <div className="loglines">
                {replay.fullLog.length === 0 ? (
                  <div className="logline">No blows were struck.</div>
                ) : (
                  replay.fullLog.map((line, i) => (
                    <div className={`logline ${line.kind}`} key={i}>{line.text}</div>
                  ))
                )}
              </div>
            )}
            <button className="btn big" onClick={() => setShowLog(false)}>Close</button>
          </div>
        </div>
      )}

      {!overlaysHeld && run.chooseOne && (
        // CLICK OUTSIDE THE OPTIONS = CANCEL (owner ruling 2026-08-28): the card returns to hand untouched.
        // Nothing was committed when it was played, so this is a pure no-op in the reducer — no effects, no
        // Gold, no triggers, no RNG. The handler is on the BACKDROP and checks `currentTarget`, so a click
        // that lands on the panel (or on an option card) is never a cancel. Escape does the same.
        <div
          className="discover-ov" role="dialog" aria-label="Choose One" tabIndex={-1}
          onPointerDown={(e) => { if (!(e.target as Element).closest('.disc-slot')) dispatch({ type: 'cancelChoice' }); }}
          onKeyDown={(e) => { if (e.key === 'Escape') dispatch({ type: 'cancelChoice' }); }}
        >
          {/* Reuses the DISCOVER chrome (transparent panel, dark-glass banner, card row) rather than the old
              bespoke cream text-buttons — a Choose One is the same kind of decision as a Discover, so the
              player picks a CARD, not a paragraph (owner 2026-07-24). Each option renders the real card with
              only that branch's text printed, so what you click is exactly what lands on your board. */}
          <div className="disc-panel">
            <div className="disc-banner"><span className="disp">Choose One</span></div>
            <div className="disc-sub">{(run.chooseOne.equipmentId ? EQUIPMENT_INDEX[run.chooseOne.equipmentId]?.name : CARD_INDEX[run.chooseOne.cardId]?.name)} · click away to cancel</div>
            <div className="disc-cards">
              {(() => {
                // A golden Choose One doubles each option's effect (gold(self) in the factories) — so show each
                // option's `goldenText` (Wildwood Shaper: +2/+6 / two Strays). The card is on the board (Battlecry
                // Choose One) or in hand (spell Choose One).
                const co = run.chooseOne!;
                // AN EQUIPMENT'S CHOOSE ONE (Prismatic Pick): there is no card behind the prompt, so each
                // option is drawn as the SOURCE MINION wearing that branch's text — the Artificer's own art
                // and name, which is what the player is looking at when they press the Equipment button. The
                // gilded wording follows the GRANT's version, not a board instance: a gilded Artificer can be
                // sold and its Equipment kept, and the Pick stays gilded.
                if (co.equipmentId) {
                  const eq = EQUIPMENT_INDEX[co.equipmentId];
                  if (!eq?.chooseOne?.length) return null;
                  const grant = run.equipment?.available.find((g) => g.equipmentId === co.equipmentId);
                  const gilded = grant?.version === 'gilded';
                  // The source may have been sold — the Equipment outlives it within the turn — so fall back
                  // to the Equipment's own identity rather than assuming a body is still standing.
                  const srcUid = grant?.sourceUids.find((u) => run.board.some((b) => b.uid === u));
                  const src = CARD_INDEX[run.board.find((b) => b.uid === srcUid)?.cardId ?? ''];
                  return eq.chooseOne.map((opt, i) => (
                    <div className="disc-slot" key={i} style={{ '--c': `var(--t-${src?.tribe ?? 'neutral'})` } as CSSProperties}>
                      <Card
                        card={{
                          // Each branch wears its OWN illustration (owner 2026-08-31), passed explicitly
                          // because the art is the Equipment's, not the card's — see `equipmentBranchArtFor`
                          // for why an Equipment numbers every branch instead of reusing its icon for the first.
                          artUrl: equipmentBranchArtFor(eq.id, i),
                          name: eq.name, cardId: src?.id ?? eq.id, tribe: src?.tribe ?? 'neutral',
                          universalTribe: false, golden: gilded,
                          attack: src?.attack ?? 0, health: src?.health ?? 0, keywords: [],
                          tier: src?.tier ?? 1, spell: false, ruby: false,
                          text: gilded ? (opt.goldenText ?? opt.text) : opt.text,
                          goldenText: opt.goldenText ?? opt.text,
                        }}
                        forceFull
                        plated
                        onClick={() => dispatch({ type: 'chooseOne', index: i })}
                      />
                    </div>
                  ));
                }
                const c = CARD_INDEX[co.cardId];
                if (!c) return null;
                const inst = run.board.find((x) => x.uid === co.uid) ?? run.hand.find((x) => x.uid === co.uid);
                const golden = !!inst?.golden;
                return (c.chooseOne ?? []).map((opt, i) => (
                  <div className="disc-slot" key={i} style={{ '--c': `var(--t-${c.tribe})` } as CSSProperties}>
                    <Card
                      // The option's own text IS the card's text here — the whole point of showing two cards is
                      // that each reads as the thing it would become. Stats come from the live instance when
                      // there is one (a played minion may already be buffed), else the printed base.
                      card={{
                        name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe,
                        golden, attack: inst?.attack ?? c.attack, health: inst?.health ?? c.health,
                        keywords: inst?.keywords ?? c.keywords, tier: c.tier, spell: !!c.spell, ruby: !!c.ruby,
                        text: golden ? (opt.goldenText ?? opt.text) : opt.text,
                        goldenText: opt.goldenText ?? opt.text,
                        // Each option previews the ART it would become, not just its text — the picture is half
                        // of what's being chosen (owner 2026-07-25).
                        chosenOption: i,
                      }}
                      // `forceFull` regardless of the compact-cards preference: on every other surface the text
                      // drawer is optional detail you can hover for, but here the two texts ARE the decision —
                      // a Choose One with both drawers collapsed is two identical portraits.
                      forceFull
                      // `plated` so the option wears the same carved stone plate it has in hand / the Compendium
                      // (owner ask 2026-08-19) — a Choose One is picking the real card, so it should look like one.
                      plated
                      onClick={() => dispatch({ type: 'chooseOne', index: i })}
                    />
                  </div>
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* One orange button, always in the same fixed spot just below the Discover cards — it toggles between
          Minimize (inspect the board) and Return, so the player can flip back and forth without moving the mouse. */}
      {!overlaysHeld && run.discover && (
        <button
          className="disc-toggle"
          onClick={() => setDiscoverMin((m) => !m)}
          title={discoverMin ? 'Return to your Discover' : 'Inspect your board, then return to choose'}
        >
          {discoverMin
            ? <><Icon name="up" /> Return to Discover · {run.discover.length} options</>
            : <><Icon name="eye" /> Minimize</>}
        </button>
      )}

      {!overlaysHeld && run.discover && !discoverMin && (
        <div className="discover-ov" role="dialog" aria-label="Discover a card">
          {/* WebGL burst layer — sits behind the cards (z0) but above the overlay's dark backdrop, so the
              golden magic reads white-hot without covering the UI. Driven by discoverFx (see the effect). */}
          <div className="disc-burst" ref={discoverBurstRef} aria-hidden="true" />
          <div className="disc-panel">
            <span className="disc-gem disc-gem-top" aria-hidden="true" />
            <div className="disc-banner"><span className="disp">Discover</span></div>
            <div className="disc-cards">
              {run.discover.map((id, i) => {
                const c = CARD_INDEX[id];
                // A Discover option shows its CURRENT value too (Grim's +32/+32, Guel's live grant, …) — the
                // same live-text chain the shop + board use.
                // The FULL live param set (audit 2026-08-06: this surface passed 11 of 30 params, so a
                // dozen scaling cards read base only in Discover). Built by the same builders as every other
                // offer surface, plus the overlay-only extras (rune notes, the tier ceiling).
                const lt = liveCardText(c.id, {
                  ...offerLiveTextParams(false, { ...liveOptsFromRun(run), cardBuffs: cardBuffsLive }),
                  runeMammoth: !!run.questFlags?.runeMammoth,
                  runeFlags: { matriarch: !!run.runeMatriarch, brokerage: !!run.runeBrokerage, livingTreasure: !!run.questFlags?.runeLivingTreasure },
                  // (Both): a Discovered Choose One the run already makes do both reads as (Both) here too —
                  // the option row is where you decide to take it, so it must not promise a choice it won't ask.
                  chooseBoth: chooseBothActive(run, undefined, c),
                  maxTier: maxTierFor(run.rift),
                });
                return (
                  <div className="disc-slot" key={`${id}-${i}`} style={{ '--c': `var(--t-${c.tribe})` } as CSSProperties}>
                    <Card
                      // `spell`/`ruby` are carried so a discovered SPELL renders as a spell — the type pill in
                      // place of the Attack/Health badges (owner 2026-07-24: spells were showing a meaningless
                      // 0/1 here). Every other surface passes these through `instView`; this panel builds its
                      // card view by hand, which is how they got dropped.
                      card={{ name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe, attack: c.attack, health: c.health, keywords: c.keywords, text: lt.text, goldenText: lt.goldenText, tier: c.tier, spell: !!c.spell, ruby: !!c.ruby,
                        // (Both) marker hook — a Discover option has no uid, so it is keyed by its slot.
                        chooseBothKey: chooseBothActive(run, undefined, c) ? `disc:${i}` : undefined }}
                      onClick={() => dispatch({ type: 'discover', index: i })}
                    />
                  </div>
                );
              })}
            </div>
            <span className="disc-gem disc-gem-bot" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Farseer's Report — a read-only Discover-style reveal of the next opponent's scouted minions, at their
          actual stats (green above the printed base; golden treatment for a triple). No pick; the Close button
          sits where the Discover MINIMIZE toggle usually is (`.disc-toggle`, fixed). Reuses the `.discover-ov` chrome. */}
      {!overlaysHeld && run.scoutedNextOpponent && run.scoutedNextOpponent.length > 0 && (
        <button className="disc-toggle" onClick={() => dispatch({ type: 'closeScout' })} title="Close the scout">
          <Icon name="eye" /> Close
        </button>
      )}
      {!overlaysHeld && run.scoutedNextOpponent && run.scoutedNextOpponent.length > 0 && (
        <div className="discover-ov" role="dialog" aria-label="Scouted minions">
          <div className="disc-panel">
            <span className="disc-gem disc-gem-top" aria-hidden="true" />
            <div className="disc-banner"><span className="disp">Scouted</span></div>
            <div className="disc-cards">
              {run.scoutedNextOpponent.map((m, i) => {
                const c = CARD_INDEX[m.cardId];
                if (!c) return null;
                // Effective base = the CardDef stats, doubled for a golden — so a plain golden reads gold (not
                // green), while any minion buffed ABOVE its base reads green.
                const mul = m.golden ? 2 : 1;
                return (
                  <div className="disc-slot" key={`${m.cardId}-${i}`} style={{ '--c': `var(--t-${c.tribe})` } as CSSProperties}>
                    <Card card={{ name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, universalTribe: !!c.universalTribe, golden: !!m.golden, attack: m.attack, health: m.health, baseAttack: c.attack * mul, baseHealth: c.health * mul, keywords: c.keywords, text: c.text, goldenText: c.goldenText, tier: c.tier, buffs: m.buffs }} />
                  </div>
                );
              })}
            </div>
            <span className="disc-gem disc-gem-bot" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Quest overlay — mirrors the Discover flow: a blurred modal that can be MINIMIZED to inspect the shop
          (rolled up front now) + board, then returned to, so the quest pick is shop-informed. Reuses the
          `.discover-ov` chrome (blur backdrop, panel, gems); the toggle sits in the same fixed spot. */}
      {!overlaysHeld && run.questOffer && (
        <button
          className="disc-toggle quest-toggle"
          onClick={() => setQuestMin((m) => !m)}
          title={questMin ? 'Return to the quest offer' : 'Inspect the shop, then return to choose a quest'}
        >
          {questMin
            ? <><Icon name="up" /> Return to Quests · {run.questOffer.length} options</>
            : <><Icon name="eye" /> Inspect the shop</>}
        </button>
      )}
      {!overlaysHeld && run.questOffer && !questMin && (
        <div className="discover-ov quest-ov" role="dialog" aria-label="Choose a quest">
          <div className="disc-panel quest-ov-panel">
            <span className="disc-gem disc-gem-top" aria-hidden="true" />
            <div className="disc-banner"><span className="disp">Quest Shop</span></div>
            <div className="disc-sub">Choose a quest to begin the turn</div>
            <div className="disc-cards quest-ov-cards">
              {run.questOffer.map((id, i) => {
                const q = QUEST_INDEX[id];
                return q ? <QuestCard key={id} quest={q} onBuy={() => dispatch({ type: 'buyQuest', index: i })} /> : null;
              })}
            </div>
            <span className="disc-gem disc-gem-bot" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* HERO-POWER DISCOVER (Mimic every turn / Void's turn-4 pair): pick one of two hero powers. Modelled on
          the Quest Shop overlay — same panel chrome, but the "cards" are power plaques (art + name + rule).
          Mandatory: no minimize, no skip — the reducer blocks everything else while it is open. */}
      {!overlaysHeld && run.powerOffer && (
        <div className="discover-ov quest-ov power-ov" role="dialog" aria-label="Choose a hero power">
          <div className="disc-panel quest-ov-panel">
            <span className="disc-gem disc-gem-top" aria-hidden="true" />
            <div className="disc-banner"><span className="disp">{run.powerOffer.slot === 'mimic' ? 'Mimicry' : run.powerOffer.slot === 'shifter' ? 'Power Shifter' : 'Twin Voids'}</span></div>
            <div className="disc-sub">
              {run.powerOffer.slot === 'mimic'
                ? 'Choose a hero power to wield this turn'
                : run.powerOffer.slot === 'shifter'
                  ? 'Choose a hero power — it replaces your current one for the rest of the run'
                  : run.powerOffer.slot === 'void1'
                    ? 'Choose your FIRST hero power — kept for the rest of the run'
                    : 'Choose your SECOND hero power — kept for the rest of the run'}
            </div>
            <div className="disc-cards power-ov-cards">
              {run.powerOffer.heroIds.map((hid, i) => {
                const h = getHero(hid);
                const art = heroPowerArt(hid);
                return (
                  <button key={hid} className="powerpick pressable" onClick={() => { sfx.pulse(); dispatch({ type: 'pickPower', index: i }); }}>
                    <span className="powerpick-art">
                      {art ? <img src={art} alt="" draggable={false} /> : <span className="powerpick-glyph" aria-hidden>✦</span>}
                    </span>
                    <span className="powerpick-name disp">{h.power.name}</span>
                    <span className="powerpick-hero">{h.name}</span>
                    <span className="powerpick-text" dangerouslySetInnerHTML={{ __html: mdBold(h.power.text) }} />
                  </button>
                );
              })}
            </div>
            <span className="disc-gem disc-gem-bot" aria-hidden="true" />
          </div>
        </div>
      )}

      {/* Runeforge: a stone/engraved shop. Buy ONE of the offered runes (or Skip), then it closes and the shop
          begins. A minimize toggle lets you inspect the board behind it. The Runesmith's turn-6 forge draws the
          normal runeset; a quest can open the higher-power EPIC forge (`runeforgeEpic`) — same UI, Epic label. */}
      {!overlaysHeld && run.runeforgeOffer && (
        <button
          className="disc-toggle forge-toggle"
          onClick={() => setForgeMin((m) => !m)}
          title={forgeMin ? 'Return to the Runeforge' : 'Inspect the board, then return to the forge'}
        >
          {forgeMin
            ? <><Icon name="up" /> Return to the {run.runeforgeEpic ? 'Epic Runeforge' : 'Runeforge'} · {run.runeforgeOffer.length} runes</>
            : <><Icon name="eye" /> Inspect the board</>}
        </button>
      )}
      {/* The lock-in ceremony. Outside the forge's own gate on purpose — it plays AFTER `runeforgeOffer`
          clears, which is precisely when the forge is gone. */}
      {lockIn && (
        <RuneLockIn
          cards={lockIn}
          onDone={() => { setLockIn(null); }}
          timing={lockInSlow === 1 ? undefined : stretchLockIn(getRuneLockInConfig(), lockInSlow)}
        />
      )}
      {/* The same ceremony, armed by PLAYBACK rather than by a click (`replayPlayer` measured the forge row
          the instant before the frame that cleared it). Kept as a second mount rather than merged into the
          state above so the two paths cannot interfere: a live ceremony is never interrupted by a scrub, and
          clearing the cue is the player's business, not this component's local state. */}
      {runeLockInCue && (
        <RuneLockIn
          key={`cue:${runeLockInCue.find((c) => c.chosen)?.rune.id ?? 'x'}`}
          cards={runeLockInCue}
          onDone={() => { useGame.setState({ runeLockInCue: null }); }}
        />
      )}
      {!overlaysHeld && run.runeforgeOffer && !forgeMin && (
        <div className={`discover-ov forge-ov${run.runeforgeEpic ? ' forge-epic' : ''}`} role="dialog" aria-label={run.runeforgeEpic ? 'The Epic Runeforge' : 'The Runeforge'}>
          <div className="disc-panel forge-panel">
            <div className="disc-banner forge-banner"><Icon name="anvil" /><span className="disp">{run.runeforgeEpic ? 'Epic Runeforge' : 'Runeforge'}</span></div>
            {/* The player's CURRENT Gold — the runes charge Gold, so the panel must say what's in the purse
                (owner ask 2026-07-16). Re-renders with every buy/re-roll (run.embers). */}
            <div className="forge-gold" title="Your Gold right now"><Icon name="mana" /><b>{run.embers}</b> Gold</div>
            <div className="disc-cards forge-cards">
              {run.runeforgeOffer.map((id, i) => {
                const rune = RUNE_INDEX[id];
                if (!rune) return null;
                // The pivot discount (aligned array, seeded at draw): a rune that doesn't follow the board can
                // arrive cheaper — the buy path charges the same number.
                const liveCost = Math.max(0, rune.cost - (run.runeforgeDiscounts?.[i] ?? 0));
                return (
                  <RuneCard
                    key={id} rune={rune} cost={liveCost} affordable={run.embers >= liveCost}
                    duplicating={!!run.runeDuplication && !!run.runeforgeEpic}
                    onBuy={(el) => {
                      // CAPTURE BEFORE DISPATCH. The buy clears `runeforgeOffer`, so this overlay unmounts on
                      // the same frame — after that there is nothing on screen to measure. The ceremony
                      // re-renders clones at these exact rects, which is why the handover is invisible.
                      startRuneLockIn(el, i);
                      dispatch({ type: 'buyRune', index: i });
                    }}
                  />
                );
              })}
            </div>
            <div className="forge-actions">
              {!run.runeforgeRerolled && !run.runeforgeRerollUsed && (
                <button
                  className="forge-reroll"
                  onClick={() => dispatch({ type: 'rerollRuneforge' })}
                  title="Re-roll the offered Runes — free, once per game (spending it here forfeits the other forge's re-roll)"
                >
                  <Icon name="refresh" /> Re-roll · <b className="forge-reroll-cost">Free</b>
                </button>
              )}
              <button className="forge-skip" onClick={() => dispatch({ type: 'skipRuneforge' })}>Leave without a Rune</button>
            </div>
          </div>
        </div>
      )}

      {/* SANDBOX ONLY: the unit editor popover, opened by the click intercept in onCardPointerDown. Every
          apply reads and writes the LIVE store run rather than this render's `run` — a stat edit is itself a
          re-render, so a stale closure here could otherwise drop a fast second keystroke's edit. */}
      {sbEditMode && sbEditing !== null && (() => {
        const card = run.board.find((c) => c.uid === sbEditing.uid);
        if (card === undefined) return null; // it left the board under us — close rather than crash
        const apply = (compute: (liveBoard: typeof run.board) => typeof run.board): void => {
          const liveRun = useGame.getState().run;
          useGame.setState({ run: { ...liveRun, board: compute(liveRun.board) } });
        };
        return (
          <UnitEditor
            value={{ cardId: card.cardId, attack: card.attack, health: card.health, keywords: card.keywords }}
            anchor={sbEditing.rect}
            cards={poolOf(run).buyable.map((c) => ({ id: c.id, name: c.name }))}
            onChange={(patch) => {
              if (patch.cardId !== undefined) {
                const cardId = patch.cardId;
                apply((liveBoard) => setCardId(liveBoard, card.uid, cardId, (id) => CARD_INDEX[id]));
              } else {
                apply((liveBoard) => setCardStats(liveBoard, card.uid, patch));
              }
            }}
            onToggleKeyword={(kw) => apply((liveBoard) => toggleCardKeyword(liveBoard, card.uid, kw))}
            onClose={() => setSbEditing(null)}
          />
        );
      })()}

      {/* SANDBOX ONLY: the unit editor popover for the pinned opponent, opened by `onSbEnemyPointerDown`.
          `applyFoe` re-reads the live store (see its definition above) for the same stale-closure reason as
          the player editor's `apply`. */}
      {sbEditMode && sbEditingFoe !== null && sbEnemySnap !== null && sbEnemySnap.minions[sbEditingFoe.index] !== undefined && (() => {
        const m = sbEnemySnap.minions[sbEditingFoe.index]!;
        const i = sbEditingFoe.index;
        return (
          <UnitEditor
            value={{ cardId: m.cardId, attack: m.attack, health: m.health, keywords: m.keywords ?? [] }}
            anchor={sbEditingFoe.rect}
            cards={poolOf(run).buyable.map((c) => ({ id: c.id, name: c.name }))}
            onChange={(patch) => {
              const liveSnap = useGame.getState().run.servedBoards?.[useGame.getState().run.wave] ?? sbEnemySnap;
              if (patch.cardId !== undefined) {
                const cardId = patch.cardId;
                applyFoe(setEnemyCardId(liveSnap, i, cardId, (id) => CARD_INDEX[id]));
              } else {
                applyFoe(setEnemyStats(liveSnap, i, patch));
              }
            }}
            onToggleKeyword={(kw) => {
              const liveSnap = useGame.getState().run.servedBoards?.[useGame.getState().run.wave] ?? sbEnemySnap;
              applyFoe(toggleEnemyKeyword(liveSnap, i, kw));
            }}
            onRemove={() => {
              const liveSnap = useGame.getState().run.servedBoards?.[useGame.getState().run.wave] ?? sbEnemySnap;
              applyFoe(removeEnemy(liveSnap, i));
              setSbEditingFoe(null);
            }}
            onClose={() => setSbEditingFoe(null)}
          />
        );
      })()}
    </div>
  );
}
