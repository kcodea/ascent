import { Fragment, useCallback, useEffect, useLayoutEffect, useMemo, useRef, useState, type CSSProperties, type PointerEvent as ReactPointerEvent } from 'react';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX, referencedCardIds } from '@game/content';
import { CONFIG, isCalibrationRound, getHero, isTribe, magnetizesTo, magnetizeTargets, endOfTurnRepeats, projectEndOfTurnSteps, questEndOfTurnBeats, sellValueOf, spellDisplayText, spellAttackBonus, spellHealthBonus, spellCasts, spellCostReduction, implosionCasts, nextOpponent, lossDamageCap, boardManaBonus, upgradeCostOf, refreshCostOf, type RunState, type ShopCard } from '@game/sim';
import { Card, mdBold, type CardView } from './Card';
import { QuestCard } from './QuestCard';
import { RuneCard } from './RuneCard';
import { combatGains } from './combatGains';
import { instView, liveCardText, type LiveTextParams } from './instView';
import { HudBar } from './HudBar';
import { EndTurnButton } from './EndTurnButton';
import { TavernUpButton } from './TavernUpButton';
import { Icon } from './Icon';
import { sfx, stopAllAudio, resumeAudio, stopTurnCharge } from './sfx';
import { pixiFx, discoverFx } from './pixiFx';
import { getSwapFxConfig } from './swapFxConfig';
import { applyGustLift, getGustFxConfig } from './gustFxConfig';
import { getAuraFxConfig } from './auraFxConfig';
import { applyWeldWiggle, weldCfgFor } from './weldFxConfig';
import { getAimFxConfig } from './aimFxConfig';
import { getInfuseFxConfig } from './infuseFxConfig';
import { fireBuffFx } from './buffFxRender';
import { BUFF_PRESETS, buffPreset } from './buffPresets';
import { PULSE_PRESETS, pulsePreset } from './pulsePresets';
import { ASCEND_PRESETS, ascendPreset } from './ascendPresets';
import { getDragFeel } from './dragFeel';
import { getLayout } from './layoutConfig';
import { getFlipConfig } from './flipConfig';
import { getShieldConfig } from './shieldConfig';
import { getTrailConfig } from './trailConfig';
import gsap from 'gsap';
import { Flip } from 'gsap/Flip';
import { useGame } from './store';
import { Unit } from './Unit';
import { useCombatReplay } from './useCombatReplay';
import { turnClock, useTurnSeconds, useTurnTimeUp } from './turnClock';
import { chargeTune, useChargePreview } from './chargeGlyphTune';
import { ChargeMotes } from './chargeMotes';

gsap.registerPlugin(Flip);

// Shop offers + warband minions are the cards that slide during a drag/reorder (GSAP Flip targets).
const FLIP_SELECTOR = '[data-zone="tavern"] .row .card[data-uid], [data-zone="warband"] .row .card[data-uid]';

// ms to keep a vanished shield bubble alive before fading it — covers a hand→board PLAY (the card unmounts
// from hand then remounts on the board under the same uid), so the bubble resumes INSTANTLY, no fade+regrow.
// MUST also OUTLAST the choreographer's shield-BREAK cue (`auraBreak`, +300ms scaled — score.ts): when a Divine
// Shield is consumed the card loses `.dscard` immediately, but the gold-shatter fires 300ms later. If the grace
// expires first the bubble quietly FADES before the burst can read it (the "shield-break burst not showing" bug).
const SHIELD_CLEAR_GRACE = 420;
// The persistent auras the tracker POSITIONS (bubbles that ride each card), each marked by a CSS class on the
// card and a keyword on the drag view. Combat bursts/breaks/re-forms are the choreographer's (channels/aura.ts,
// fired off the event log) — the tracker here only keeps each aura riding its card and clears it when the card
// leaves. Divine Shield (gold), Reborn (blue wisp). (Taunt is signified by a static grey card border, not a
// Pixi aura — see `.card.taunt` in styles.css — so it's not tracked here.)
type AuraK = 'shield' | 'reborn';
const AURA_CFGS = [
  { kind: 'shield', marker: 'dscard', dragKw: 'DS' },
  { kind: 'reborn', marker: 'reborncard', dragKw: 'R' },
] as const;
const ckey = (kind: string, uid: string): string => `${kind}|${uid}`;
const unkey = (k: string): { kind: AuraK; uid: string } => {
  const i = k.indexOf('|');
  return { kind: k.slice(0, i) as AuraK, uid: k.slice(i + 1) };
};

type DragSource = 'shop' | 'hand' | 'board';
type Zone = 'tavern' | 'warband' | 'hand';

// px the pointer must move before a click becomes a drag — live-tunable via the DEV Drag tuner (dragFeel.ts).
// How far into a card the cursor must reach (fraction of width) before the insertion point
// moves past it — below 0.5 so cards slide out of the way sooner / more sensitively.
const INSERT_FRAC = 0.5; // insert after a card once the *dragged card's centre* passes its midpoint
const TURN_SECONDS = 18; // base round timer; grows +4s/wave (+6s more from round 6 — owner 2026-07-16), capped at 80 — and floored at CHARGE_SECONDS+1, so wave 1 actually kicks off at 21s (see turnSeconds)
const CHARGE_SECONDS = 20; // the charge glyph fills over the final 20s of the turn
const CHARGE_MAX_FEATHER = 24; // % — the reveal feather = this × (1−charge): soft incoming fronts, 0 at completion (no sigil dimming)
const CHARGE_FADEOUT_MS = 450; // when the glyph stops being lit (End Turn / timer end) it fades out over this, not a snap-cut (keep in sync with `.chargeglyph.fading` transition in styles.css)

/** The cast count a spell shows (its ×N badge + cast-spark replay): Implosion resolves 1 + your Demons times
 *  (per-Demon recast, read off the live board), and that whole count is MULTIPLIED by the run-wide spell-recast
 *  multiplier (Nimbus / Ancient Runes / Spell Thesis) — matching what the reducer actually resolves (spellCasts ×
 *  implosionCasts). Every other spell just uses the run-wide `spellCasts` multiplier. `spellCasts` is side-effect
 *  free, so calling it here to preview the count is safe. */
const spellCastCount = (run: Parameters<typeof spellCasts>[0], def: Parameters<typeof spellCasts>[1]): number =>
  def.id === 'implosion' ? spellCasts(run, def) * implosionCasts(run) : spellCasts(run, def);

/** Build the floating drag-card transform with a CONSISTENT function list, so a CSS transition between the
 *  rAF lean and the snap/magslide states interpolates cleanly. tx/ty = top-left offset; rotX/rotY = 3D tilt
 *  deg; `spin` = the static 2D angle (0 = flat, like a card on the table — the lift read comes from the
 *  drop-shadow + scale, not an angle). All dials live in `dragFeel.ts` / the DEV Drag tuner. */
function dragTransform(persp: number, tx: number, ty: number, rotX: number, rotY: number, scale: number, spin: number): string {
  return `perspective(${persp}px) translate(${tx}px, ${ty}px) rotateX(${rotX}deg) rotateY(${rotY}deg) scale(${scale}) rotate(${spin}deg)`;
}

/** Turn countdown (M:SS) as a shop-plaque widget (matches the Gold/Tavern buttons so it reads at a glance).
 *  Subscribes to the clock so ONLY this reads per-second; the plaque + digits turn red in the last 5s. */
function ShopTimer({ label }: { label: string }) {
  const s = Math.max(0, useTurnSeconds());
  return (
    <div className={`statcell time${s <= 5 ? ' low' : ''}`}>
      <span className="sc-l">{label}</span>
      <span className="sc-ic"><Icon name="clock" /></span>
      <span className="sc-v">{Math.floor(s / 60)}:{String(s % 60).padStart(2, '0')}</span>
      <span className="sbtip">Time left this turn — at 0 your actions lock; hit End Turn</span>
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
function tokenRefView(
  id: string,
  cardBuffs?: Record<string, { attack: number; health: number }>,
  impBuff?: { attack: number; health: number },
  spellLive?: { a: number; h: number; ftb: number; ftbH: number; goldSpent: number; goldPouchValue?: number },
): CardView {
  const c = CARD_INDEX[id];
  if (c.spell && spellLive) {
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
      attack: c.attack, health: c.health, keywords: c.keywords,
      text: spellDisplayText(c.id, spellLive.a, spellLive.ftb, spellLive.h, spellLive.goldSpent, spellLive.ftbH, spellLive.goldPouchValue ?? 0),
      tier: c.tier, spell: c.spell, target: c.target,
      baseAttack: c.attack, baseHealth: c.health,
    };
  }
  const cb = id === 'impscrap' ? (impBuff ?? { attack: 0, health: 0 }) : (cardBuffs?.[id] ?? { attack: 0, health: 0 });
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
    attack: c.attack + cb.attack, health: c.health + cb.health,
    keywords: c.keywords, text: c.text, tier: c.tier, spell: c.spell,
    baseAttack: c.attack, baseHealth: c.health,
  };
}

interface ShopViewOpts {
  /** "Freedom" rift: the first minion this turn is free → every minion offer shows a 0-Gold price until one is bought. */
  freeFirstBuy?: boolean;
  spellCostMod?: number;
  cardBuffs?: Record<string, { attack: number; health: number }>;
  spellBonus?: number;
  spellBonusH?: number;
  frontToBackBonus?: number;
  frontToBackBonusH?: number;
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
  tavernAtk?: number;
  tavernHp?: number;
  /** Run-wide Deathrattles triggered this game — so a tavern Grim offer shows its live scaling buff. */
  deathrattlesTriggered?: number;
  /** More run-wide live-text inputs so EVERY scaling offer (Guel, Taragosa, Spirit Worgen, Soulsman, …)
   *  shows its current value in the shop, not just Grim. */
  spellsCast?: number;
  spellsThisTurn?: number;
  soulsmanGold?: number;
  fodderConsumed?: { attack: number; health: number };
  /** Gold spent this turn — Patch Job's live total. */
  goldSpent?: number;
  /** Rune of Pillaging's raised Gold Pouch payout — the pouch shows its live value. */
  goldPouchValue?: number;
  /** Card ids played this turn — Pack Leader / Spirit Worgen per-play scaling. */
  playedThisTurn?: string[];
  /** Squirl Scout's run-wide accrued grant size. */
  squirlScoutBuff?: number;
  /** Name of the most recent spell cast this run — Steward of Spells shows what it copies. */
  lastSpellName?: string;
}

/** Build the LiveTextParams for a shop/Discover OFFER (no per-instance accruals — it isn't owned yet). */
function offerLiveTextParams(golden: boolean, o: ShopViewOpts): LiveTextParams {
  return {
    tier: 1, golden,
    spellBonus: o.spellBonus ?? 0, spellBonusH: o.spellBonusH ?? o.spellBonus ?? 0, frontToBackBonus: o.frontToBackBonus ?? 0,
    spellsThisTurn: o.spellsThisTurn ?? 0, spellsCast: o.spellsCast ?? 0, deathrattlesTriggered: o.deathrattlesTriggered ?? 0,
    clingEnchant: o.cardBuffs?.cling, fodderConsumed: o.fodderConsumed,
    undeadBuyAtk: o.undeadBuyAtk ?? 0, soulsmanGold: o.soulsmanGold ?? 0, cardBuffs: o.cardBuffs,
    goldSpent: o.goldSpent ?? 0, goldPouchValue: o.goldPouchValue ?? 0, playedThisTurn: o.playedThisTurn, squirlScoutBuff: o.squirlScoutBuff,
    lastSpellName: o.lastSpellName,
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
      keywords: c.keywords, text: spellDisplayText(c.id, opts.spellBonus ?? 0, opts.frontToBackBonus ?? 0, opts.spellBonusH ?? opts.spellBonus ?? 0, opts.goldSpent ?? 0, opts.frontToBackBonusH ?? opts.frontToBackBonus ?? 0, opts.goldPouchValue ?? 0),
      cost, costChanged: cost < base, spell: true,
      target: c.target, tier: c.tier, castMult: opts.castMult,
    };
  }
  // Displacement: a stashed minion (held) shows its FULL preserved stats / keywords / golden frame. Its stored
  // stats are already final (golden ones already doubled), so no further folding — it restores intact on buy.
  if (card.held) {
    const h = card.held;
    const lt = liveCardText(c.id, offerLiveTextParams(!!h.golden, opts));
    return {
      name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
      attack: h.attack, health: h.health, keywords: h.keywords,
      text: lt.text, goldenText: lt.goldenText ?? c.goldenText, cost: CONFIG.minionCost, tier: c.tier, golden: h.golden,
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
  const lt = liveCardText(c.id, offerLiveTextParams(!!card.golden, opts));
  // Itemize the buy-time buffs the offer previews (Fortify, run enchant, Staff of Guel, tribe buy-aura) so the
  // tavern inspect shows WHERE the boosted stats come from — the same sources the reducer's buy path records.
  const offerBuffs: { source: string; attack: number; health: number; count: number }[] = [];
  const pushBuff = (source: string, a: number, h: number, count = 1): void => { if (a || h) offerBuffs.push({ source, attack: a, health: h, count }); };
  // Tavern buffs on the offer (Apples / Fortify / Fried Circuits / next-shop) — read their real per-source
  // breakdown when present (so the inspect names the actual source), else fall back to the raw atk/hp total.
  if (card.buffs?.length) for (const b of card.buffs) pushBuff(b.source, b.attack, b.health, b.count);
  else pushBuff('Tavern buff', card.atk ?? 0, card.hp ?? 0);
  pushBuff(c.name, cb.attack, cb.health); // persistent per-card run enchant (Ritualist Fodder, Staff of Guel target…)
  pushBuff('Tavern', tavernAtk, tavernHp);
  pushBuff('Tribe Bond',
    (undead ? (opts.undeadAtk ?? 0) + (opts.undeadBuyAtk ?? 0) : 0) + (beast ? opts.beastBuyAtk ?? 0 : 0) + (magnetic ? opts.magneticBuyAtk ?? 0 : 0),
    (undead ? opts.undeadHp ?? 0 : 0) + (beast ? opts.beastBuyHp ?? 0 : 0) + (magnetic ? opts.magneticBuyHp ?? 0 : 0));
  if (card.golden) pushBuff('Golden Touch', c.attack, c.health); // gilded doubles the base stats
  return {
    name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2,
    attack: (c.attack + addAtk) * goldMul, health: (c.health + addHp) * goldMul,
    keywords: [...c.keywords, ...(card.keywords ?? []).filter((k) => !c.keywords.includes(k))],
    text: lt.text,
    goldenText: lt.goldenText ?? c.goldenText,
    buffs: offerBuffs.length > 0 ? offerBuffs : undefined,
    // Moe's guaranteed Attachment carries a discounted price (`card.cost`) — show it on a green coin.
    // Freedom rift: a minion offer reads FREE (0 Gold, green) until the turn's free buy is spent.
    cost: opts.freeFirstBuy ? 0 : (card.cost ?? CONFIG.minionCost), costChanged: opts.freeFirstBuy || card.cost !== undefined,
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
  const run = useGame((s) => s.run);
  const dispatch = useGame((s) => s.dispatch);
  const heroArmed = useGame((s) => s.heroArmed);
  const compactCards = useGame((s) => s.compactCards);
  const armHero = useGame((s) => s.armHero);
  const setEndTurnAnimating = useGame((s) => s.setEndTurnAnimating);
  // The end-of-turn proc beats are playing (set in endTurn below) — locks every recruit action until done.
  const eotAnimating = useGame((s) => s.endTurnAnimating);
  const setCombatEnemyDeaths = useGame((s) => s.setCombatEnemyDeaths);
  const setCombatQuestDelta = useGame((s) => s.setCombatQuestDelta);
  const setCombatTriggeredQuests = useGame((s) => s.setCombatTriggeredQuests);
  const setCombatCompletedQuests = useGame((s) => s.setCombatCompletedQuests);
  const setCombatBuffs = useGame((s) => s.setCombatBuffs);
  const combatSpeed = useGame((s) => s.combatSpeed);
  const setCombatSpeed = useGame((s) => s.setCombatSpeed);
  // The pre-run hero picker is open while this is set — freeze the round clock until a hero's chosen.
  const heroSelecting = useGame((s) => s.heroChoices !== null);
  // Recruit stays mounted under the title / leaderboard overlays (see Game.tsx), so the round clock must also
  // pause for those — otherwise the timer keeps ticking (and the last-5s `sfx.tick` fires) on the Hall of
  // Champions / title screen, where there's no active turn.
  // Any full-screen overlay pauses the recruit turn timer + logic AND the combat replay (see `paused` below) — so
  // the saved game never ticks / runs "in the background" (and no combat sfx leak) behind the Career, Leaderboard
  // (Hall of Champions + Rankings), Balance Report, Compendium, or title (an exploit + a confusing UX).
  const overlayOpen = useGame((s) => s.showTitle || s.showLeaderboard || s.showRankings || s.showCareer || s.showBook || s.showBalance);
  // Fortify can target a tavern offer too; Gild / Encore act only on your warband.
  const heroPowerKind = getHero(run.heroId).power.kind;
  const heroTargetsTavern = heroPowerKind === 'fortify';
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
  const turnSeconds = Math.max(CHARGE_SECONDS + 1, (Math.min(80, TURN_SECONDS + (run.wave - 1) * 4 + (run.wave >= 6 ? 6 : 0)) + (run.wave >= 12 ? 12 : 0)) * (run.mode === 'practice' ? 3 : 1));

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
  const [aim, setAim] = useState<{ ox: number; oy: number; tx: number; ty: number; onTarget: boolean; targetUid: string | null } | null>(null);
  const [buffedUids, setBuffedUids] = useState<Set<string>>(new Set());
  // Last weld seq the stat-diff watcher has seen — lets it suppress the generic buff cues for the minions a
  // FRESH weld just landed on (the weld has its own pulse + wiggle), without touching any other buff.
  const weldStatSeqRef = useRef<number | undefined>(undefined);
  // Fire the green buff-burst on a specific card for ~0.7s. Used to guarantee the Hero Power (Fortify)
  // always animates its target, independent of the passive stat-diff flash.
  const flashBuffed = useCallback((uid: string): void => {
    setBuffedUids((s) => new Set([...s, uid]));
    window.setTimeout(() => setBuffedUids((s) => {
      const n = new Set(s);
      n.delete(uid);
      return n;
    }), 700);
  }, []);
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
  // Buff Gust — the TAVERN flourish for any shop-time Fodder/Imp buff (owner ask 2026-07-16 ×2:
  // Godfodder's buff pick, Imp Overseer, Maw's End of Turn, Ritualist, Staff of Guel, Rune of Consumption,
  // Bane, …): the violet rush sweeps in from the shop row's flanks, pushed toward the board ends by the
  // `edgeOut` dial. Anchored to the SHOP ROW always (the cue means "the tavern got buffed"), never fired
  // in combat (phase guard + the shop cards simply aren't rendered there).
  const fireTavernGust = useCallback((): void => {
    const st = useGame.getState().run;
    if (!st || st.phase !== 'recruit') return;
    const uids = [...st.shop.map((o) => o.uid), ...(st.spell ? [st.spell.uid] : [])];
    const els = uids.flatMap((uid) => {
      const el = document.querySelector(`[data-uid="${uid}"]`);
      return el ? [el] : [];
    });
    if (els.length === 0) return;
    const rects = els.map((el) => el.getBoundingClientRect());
    pixiFx.buffGust({
      left: Math.min(...rects.map((r) => r.left)),
      right: Math.max(...rects.map((r) => r.right)),
      top: Math.min(...rects.map((r) => r.top)),
      bottom: Math.max(...rects.map((r) => r.bottom)),
    }, getGustFxConfig());
    applyGustLift(els); // lift & settle the row when the gust lands (delayed to the landing internally)
  }, []);
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
  // WELD FX: an Attachment just fused onto a host minion — a quick gold shot-ascension pulse at the host
  // card's centre. For a HAND-PLAYED Magnetic the card's slide-in (`magSlideMs`) has already finished by the
  // time the sim dispatch lands, so the pulse reads as the moment it merges; auto-welds (Banksly/Beatbot)
  // simply pulse when they happen. EoT welds (Combinator / Cling / Money Bot) stamp after the phase flips —
  // those fire from the EoT BEAT instead (see playBeat), while the shop is still on screen.
  // NB: queries the DOM directly rather than via `findEl` — this lives ABOVE findEl's declaration, and a
  // `[findEl]` dep would read it in the temporal dead zone (crashes the screen on the first weld). A weld
  // host is always a board minion, so the warband-scoped selector is sufficient. Mirrors fireFodderInfusion.
  const fireWeldPulse = useCallback((uid: string, kind: 'play' | 'auto'): void => {
    const el = document.querySelector(`[data-zone="warband"] [data-uid="${uid}"]`);
    if (!el) return;
    const r = (el.querySelector('.archbox') ?? el).getBoundingClientRect();
    pixiFx.weldPulse(r.left + r.width / 2, r.top + r.height / 2, weldCfgFor(kind));
    applyWeldWiggle([el]); // the host's physical reaction — replaces the old green buff-burst (🔩 tuner)
  }, []);
  const prevWeldFxSeq = useRef(run.weldFxSeq);
  useEffect(() => {
    const seq = run.weldFxSeq;
    if (seq === undefined || seq === prevWeldFxSeq.current) return;
    prevWeldFxSeq.current = seq; // inits to the current value, so a restored save never re-fires
    const uids = run.weldFxUids;
    if (!uids?.length || run.phase !== 'recruit') return;
    // One weld can land on several minions (a Beatbot mirrors it onto itself) — pulse every one.
    const raf = requestAnimationFrame(() => { for (const uid of uids) fireWeldPulse(uid, run.weldFxKind ?? 'auto'); });
    return () => cancelAnimationFrame(raf);
  }, [run.weldFxSeq, run.weldFxUids, run.weldFxKind, run.phase, fireWeldPulse]);
  // Immediate (mid-shop) triggers arrive via the `buffGustSeq` stamp (one-shot, the swapFxSeq pattern;
  // inits to the current value so a restored save doesn't fire). End-of-Turn triggers (Maw / Ritualist)
  // stamp inside `faceOmen` — by then the phase is combat, so the watcher skips them; their gust fires
  // from the EoT BEAT instead (see playBeat), while the shop is actually on screen.
  const prevBuffGustSeq = useRef(run.buffGustSeq);
  useEffect(() => {
    const seq = run.buffGustSeq;
    if (seq === undefined || seq === prevBuffGustSeq.current) return;
    prevBuffGustSeq.current = seq;
    if (run.phase !== 'recruit') return;
    const raf = requestAnimationFrame(fireTavernGust);
    return () => cancelAnimationFrame(raf);
  }, [run.buffGustSeq, run.phase, fireTavernGust]);
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
  const eotEatKey = useRef(1_000_000); // fodderAnim keys for EoT-beat eats — offset far above the seq-keyed watcher's range
  const prevEatFlashSeq = useRef(run.fodderEatenSeq); // the stat-diff flash's own eat tracker (suppresses the eaters' instant pop)
  const prevFxSeq = useRef(run.recruitFxSeq); // inits to current so it never fires on mount (a resumed save may carry a bumped seq)
  const prevAuraSeq = useRef(run.auraFxSeq ?? 0); // aura-wash FX watcher — same init-to-current contract
  // A brief "End of Turn" banner when the turn ends (recruit → combat), making it clear that
  // end-of-turn effects (Ritualist & co.) just resolved.
  const [endTurnFlash, setEndTurnFlash] = useState(false);
  // Cards a combat Deathrattle just added to the hand (Arcane Weaver → Spirit Fire) — pop them
  // in when they arrive. Snapshot the hand on entering combat; the new uids afterwards are grants.
  const [arrivedUids, setArrivedUids] = useState<Set<string>>(new Set());
  const handBeforeCombatRef = useRef<Set<string>>(new Set());
  // A one-shot flourish under a freshly-played minion whose Battlecry just fired.
  const [battlecryUids, setBattlecryUids] = useState<Set<string>>(new Set());
  const prevBoardUidsRef = useRef<Set<string>>(new Set(run.board.map((c) => c.uid)));
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
  const lossSeqRef = useRef(false);                // guards single-run per combat
  const endTurnPendingRef = useRef(false); // the end-of-turn beat sequence is playing before combat
  // During the End-of-Turn animation, the per-proc stats to *show* on each minion (uid → live stats),
  // so the board's numbers climb one proc at a time. Null outside the animation (show the real stats).
  const [eotAnimStats, setEotAnimStats] = useState<Record<string, { attack: number; health: number }> | null>(null);
  // During the same animation, the PROJECTED cadence tick per uid (eotTick + 1) so a cadence counter
  // (Money Maker / Frontdrake) visibly ticks up on its beat — the reducer only commits eotTick in faceOmen
  // (after the beats), so without this the counter would jump a turn late. Null outside the animation.
  const [eotAnimTick, setEotAnimTick] = useState<Record<string, number> | null>(null);
  // Dragons Karwind just flame-buffed (keyed off run.karwindFlashSeq) — a one-shot flame flash.
  const [karwindFlameUids, setKarwindFlameUids] = useState<Set<string>>(new Set());
  const prevKarwindSeq = useRef(run.karwindFlashSeq);
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
  const [combatStage, setCombatStage] = useState<'closing' | 'fighting'>('closing');
  const fighting = inCombat && combatStage === 'fighting';
  // End-Combat crossfade: 'out' fades every combat unit + FX canvas away together, then the phase swaps and
  // 'in' fades the recruit board + survivors back together — one synchronized two-beat transition (see the CSS
  // `.app.combatout`/`.combatin`), so nothing snaps or staggers when you leave the arena.
  const [combatOutro, setCombatOutro] = useState<null | 'out' | 'in'>(null);
  // Skip-combat uses the SAME crossfade (everything fades out together), but instead of swapping to the shop it
  // freezes the replay, kills all audio, jumps to the resolved board under cover of opacity 0, then fades that
  // final board back in. A replacement one-shot will play in its place later (owner).
  const [skipFade, setSkipFade] = useState<null | 'out' | 'in'>(null);
  const [showLog, setShowLog] = useState(false); // the post-combat Combat Summary overlay
  const [discoverMin, setDiscoverMin] = useState(false); // B2: the Discover overlay is minimized (inspect the board)
  const [questMin, setQuestMin] = useState(false); // the Quest overlay is minimized (inspect the shop rolled behind it)
  const [forgeMin, setForgeMin] = useState(false); // the Runeforge overlay is minimized (inspect the board behind it)
  const [logTab, setLogTab] = useState<'gains' | 'procs' | 'log'>('gains'); // Permanent gains · Procs · blow-by-blow log
  // Per-card stat snapshot (attack + health) for the recruit-phase buff flash + the +X/+X float (declared
  // up here so the combat→recruit transition can re-sync it and avoid a spurious flash on the way back in).
  const prevStatsRef = useRef<Map<string, { a: number; h: number }>>(new Map());
  const prevPhaseRef = useRef(run.phase);
  // Gold floats at the spot a minion was sold (the actual sell value) — fixed-screen, auto-cleared.
  const [sellFloats, setSellFloats] = useState<{ id: number; x: number; y: number; amount: number }[]>([]);
  const sellFloatId = useRef(0);
  // Recruit-phase +X/+X buff floats, keyed by card uid (latest wins; `key` bumps each buff so it remounts +
  // replays its rise). Mirrors the combat buff float — the player reads the actual stat gain in the shop.
  const [statFloats, setStatFloats] = useState<Record<string, { attack: number; health: number; key: number }>>({});
  const statFloatKey = useRef(0);
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
  const replay = useCombatReplay(run.lastCombat, { active: fighting, findEl, combatSpeed, paused: overlayOpen });

  // --- Divine-shield bubbles (Pixi) ------------------------------------------------------------------
  // A persistent golden bubble tracks every shielded card via its `.card.dscard` DOM marker, so the
  // recruit board (shop / hand / warband) and combat share ONE path. When a shield is consumed in combat
  // the card keeps its element but loses `.dscard` → we fire the break burst; a card that simply leaves
  // (sold / dead / unmounted) clears quietly. Positions re-measure on a rAF loop ONLY while something is
  // animating (combat lunges or a drag) — idle shielded units cost nothing (no per-frame layout reads).
  const shieldUidsRef = useRef<Set<string>>(new Set());
  const pendingClearRef = useRef<Map<string, number>>(new Map()); // uid → time (ms) to fade a vanished bubble
  const inCombatRef = useRef(inCombat); inCombatRef.current = inCombat;
  const fightingRef = useRef(fighting); fightingRef.current = fighting;
  const settleUntilRef = useRef(0);     // post-drop window where the bubble keeps tracking the Flip
  // A brief window after a combat↔recruit swap where an aura (shield/reborn) that re-registers appears fully-
  // formed (no form-in snap). Combat re-uids the board, so surviving auras are "new" keys on return and would
  // otherwise replay their grow-in as the shop fades in. A genuine recruit gain falls outside this window.
  // Set in the RENDER BODY (not an effect) so it's live before syncShields' layout effect reads it this render.
  const deployGraceRef = useRef(0);
  const prevInCombatRef = useRef(inCombat);
  if (prevInCombatRef.current !== inCombat) { deployGraceRef.current = performance.now() + 1600; prevInCombatRef.current = inCombat; }
  const prevDragActiveRef = useRef(false);
  // (`dragRef` is declared lower down for spell-targeting and already mirrors `drag`; syncShields reads it.)
  const syncShields = useCallback((): void => {
    const seen = new Set<string>(); // composite keys `${kind} ${uid}` (a unit can carry both auras)
    const now = performance.now();
    // Mid-animation (combat / a live drag / post-drop settle)? Only THEN is a vanished aura possibly
    // mid-remount and worth a grace; otherwise it's gone for good and must clear NOW (no rAF will expire a timer).
    const animating = (): boolean =>
      fightingRef.current || (dragRef.current?.active ?? false) || performance.now() < settleUntilRef.current;
    const d = dragRef.current;
    const dragUid = d?.uid;
    // Shield/reborn auras render on the front canvas, fixed to the viewport, so they take raw viewport coords.
    const set = (
      uid: string, cx: number, cy: number, w: number, h: number, mini: boolean, kind: AuraK,
      track?: (() => { cx: number; cy: number; w: number; h: number; rot: number } | null),
    ): void => pixiFx.setShield(uid, cx, cy, w, h, mini, kind, track, performance.now() < deployGraceRef.current);
    // A live position source for a COMBAT front-aura (shield/reborn): re-measures the card's art square each FX
    // frame so the bubble rides the lunge/recoil transform EXACTLY (no cross-rAF trailing). Combat-only, where
    // auraDy is 0 — so it mirrors the `set` measurement below. null when the card isn't measurable
    // (dying → the burst owns it; mid-remount → keep the last spot).
    const makeTrack = (uid: string, marker: string) =>
      (): { cx: number; cy: number; w: number; h: number; rot: number } | null => {
        const unit = document.querySelector<HTMLElement>(`.unit[data-uid="${uid}"]`);
        const card = unit?.querySelector<HTMLElement>(`.card.${marker}`);
        if (!unit || !card || unit.classList.contains('dying')) return null;
        const el = card.querySelector<HTMLElement>('.archbox') ?? card;
        const r = el.getBoundingClientRect();
        if (r.width === 0) return null;
        // The lunge transform lives on `.unit` (translate + tilt + windup scale). getBoundingClientRect gives the
        // rotated element's AABB (centre stays true, but w/h inflate), so take the UNROTATED size (offsetWidth ×
        // the transform's scale) and read the rotation off the matrix so the aura rides the card's tilt exactly.
        const t = getComputedStyle(unit).transform;
        let rot = 0, sc = 1;
        if (t && t !== 'none') { const m = new DOMMatrixReadOnly(t); rot = Math.atan2(m.b, m.a); sc = Math.hypot(m.a, m.b) || 1; }
        return { cx: r.left + r.width / 2, cy: r.top + r.height / 2, w: el.offsetWidth * sc, h: el.offsetHeight * sc, rot };
      };
    // Recruit cards hang their stat badges BELOW the square art tile, so an aura centred on the art alone reads
    // a touch high vs the full card silhouette. Nudge shield/reborn (recruit only; combat units are a clean
    // square) — the amount is live-tunable via the DEV Shield tuner.
    const auraDy = (h: number): number =>
      inCombatRef.current ? 0 : h * getShieldConfig().recruitDy;
    // PASS 1 — for each aura kind, register + position every marked card; the dragged card follows from drag
    // state (works from ANY source — its CardView keywords say if it has the aura). DURING COMBAT only combat
    // UNITS (`.unit`) get auras, so a frozen shop/hand card can't float its aura over the arena.
    for (const cfg of AURA_CFGS) {
      if (cfg.kind === 'shield' || cfg.kind === 'reborn') continue; // Ward + Reborn are CSS now (Card.tsx `.ward` / `.reborn` stacks); Pixi only fires their combat break/re-form FX + drag sparkles
      const els = document.querySelectorAll<HTMLElement>(
        inCombatRef.current
          ? `.unit .card.${cfg.marker}`
          : `[data-zone] .card.${cfg.marker}, .unit .card.${cfg.marker}`,
      );
      const draggedHas = !!(d?.active && d.view?.keywords?.includes(cfg.dragKw));
      for (const card of els) {
        const uid = card.closest<HTMLElement>('[data-uid]')?.dataset.uid;
        if (!uid || uid === dragUid) continue; // the dragged card is driven from drag state below
        // Measure the square ART region (`.archbox`), not the height:auto `.card`: in the shop a card is taller
        // than its art (centre sits low → the aura looked low); the archbox is the same `--ccw` square everywhere.
        const r = (card.querySelector<HTMLElement>('.archbox') ?? card).getBoundingClientRect();
        if (r.width === 0) continue; // not laid out yet (mid-transition)
        // A DYING combat unit's aura burst is the choreographer's now (channels/aura.ts, off the event log) —
        // don't re-register/re-grow its bubble here or the position-tracker would flicker a fresh bubble back in
        // after the burst destroys it. Skipping drops it from `seen` → PASS 2 (a burst one is already gone, so
        // clearShield no-ops; a non-bursting leaver fades). The burst reads the bubble's last-tracked spot.
        if (inCombatRef.current && card.closest<HTMLElement>('.unit')?.classList.contains('dying')) continue;
        const key = ckey(cfg.kind, uid);
        seen.add(key);
        // In combat, hand the FRONT auras (shield/reborn) a live tracker so they ride the lunge/recoil exactly;
        // recruit keeps the per-render push (no fast transforms to chase there).
        const track = inCombatRef.current ? makeTrack(uid, cfg.marker) : undefined;
        set(uid, r.left + r.width / 2, r.top + r.height / 2 + auraDy(r.height), r.width, r.height, false, cfg.kind, track);
      }
      if (d?.active && dragUid && draggedHas) {
        seen.add(ckey(cfg.kind, dragUid));
        set(dragUid, d.x - d.ox + d.w / 2, d.y - d.oy + d.h / 2 + auraDy(d.h), d.w, d.h, /* mini */ true, cfg.kind);
      }
    }
    // PASS 2 — an aura that vanished from `seen` fades out. Combat BURSTS/BREAKS are the choreographer's now
    // (channels/aura.ts, fired off the event log) — here we only handle a bubble whose CARD LEFT (sold, played
    // hand→board, frozen, unmounted): a brief grace covers a remount under the same uid, else it clears.
    for (const key of shieldUidsRef.current) {
      if (seen.has(key) || pendingClearRef.current.has(key)) continue;
      const { kind, uid } = unkey(key);
      if (animating()) pendingClearRef.current.set(key, now + SHIELD_CLEAR_GRACE); // might remount → brief grace
      else pixiFx.clearShield(uid, kind);
    }
    // PASS 4 — pending clears: resume if the card came back; else hold during the grace, FLUSH when animation ends.
    for (const [key, deadline] of pendingClearRef.current) {
      const { kind, uid } = unkey(key);
      if (seen.has(key)) { pendingClearRef.current.delete(key); continue; }
      if (now >= deadline || !animating()) { pixiFx.clearShield(uid, kind); pendingClearRef.current.delete(key); }
      else seen.add(key);
    }
    shieldUidsRef.current = seen;
  }, []);
  // Reconcile after any render that can change the shielded set or card positions.
  useLayoutEffect(() => {
    syncShields();
    // The first measure can catch a freshly-mounted card mid `cardpop` (scale/translate) — placing its aura
    // slightly askew until the next interaction re-syncs it (the "shield off in shop until you click it" bug).
    // A delayed pass after the pop settles re-measures the resting rect and corrects it.
    const t = window.setTimeout(syncShields, 240);
    return () => window.clearTimeout(t);
  }, [syncShields, run.board, run.hand, run.shop, replay.frame, inCombat, fighting, compactCards]);
  // DEV shield tuner: re-sync live when its slider changes so the bubble moves as you drag (see ShieldTuner).
  useEffect(() => {
    const h = (): void => syncShields();
    window.addEventListener('ascent:shieldcfg', h);
    return () => window.removeEventListener('ascent:shieldcfg', h);
  }, [syncShields]);
  // A drop opens a brief settle window so the bubble keeps tracking the card through its Flip animation.
  useEffect(() => {
    const active = drag?.active ?? false;
    if (prevDragActiveRef.current && !active) settleUntilRef.current = performance.now() + 450; // ≥ clear-grace + Flip
    prevDragActiveRef.current = active;
  }, [drag?.active]);
  // Follow moving units (combat lunges / an active drag / the post-drop settle) frame-by-frame; idle at rest.
  useEffect(() => {
    let raf = 0;
    const tick = (): void => {
      syncShields();
      if (fighting || dragRef.current?.active || performance.now() < settleUntilRef.current) {
        raf = requestAnimationFrame(tick);
      }
    };
    raf = requestAnimationFrame(tick);
    return () => cancelAnimationFrame(raf);
  }, [fighting, drag?.active, syncShields]);
  // Re-measure on resize; clear every bubble when the screen unmounts.
  useEffect(() => {
    const onResize = (): void => syncShields();
    window.addEventListener('resize', onResize);
    return () => {
      window.removeEventListener('resize', onResize);
      for (const key of shieldUidsRef.current) { const { kind, uid } = unkey(key); pixiFx.clearShield(uid, kind); }
      shieldUidsRef.current = new Set();
    };
  }, [syncShields]);
  // Hide every bubble while a board-covering modal is open. Discover / Choose One render at z50 with a
  // translucent backdrop (BELOW the z110 FX canvas), so bubbles for the dimmed board behind would otherwise
  // float in front of the overlay. (Inspect / hero-select / end-of-run sit above the FX canvas already.)
  useEffect(() => {
    // A minimized Discover / Quest overlay leaves the board visible, so keep the behind-card shields showing then.
    const modalCovering = (run.discover && !discoverMin) || (run.questOffer && !questMin) || (run.runeforgeOffer && !forgeMin) || run.chooseOne;
    pixiFx.setShieldsVisible(!modalCovering);
    // The hero portrait / pills / power diamond live OUTSIDE the overlay's backdrop root (their own fixed
    // stacking contexts), so the overlay's backdrop-filter can't blur them — mark the body and let CSS blur
    // + dim them to match the rest of the covered board (owner report 2026-07-16). One-shot filter change.
    document.body.classList.toggle('modalup', !!modalCovering);
    return () => document.body.classList.remove('modalup');
  }, [run.discover, run.chooseOne, discoverMin, run.questOffer, questMin, run.runeforgeOffer, forgeMin]);
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
  // Bridge this fight's live combat quest progress to the store so the QuestPanel ticks combat objectives up as
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
  const { spellAttack: cbA, spellHealth: cbH, gold: cbGold } = replay.combatBuffs;
  useEffect(() => {
    setCombatBuffs(inCombat && !run.combatSettled ? { spellAttack: cbA, spellHealth: cbH, gold: cbGold } : null);
  }, [inCombat, run.combatSettled, cbA, cbH, cbGold, setCombatBuffs]);

  // Entering combat: hold on the "shop closing" intro, then let the enemies arrive
  // and the replay begin. Also flash the "End of Turn" banner (end-of-turn effects just
  // resolved) and snapshot the hand so post-combat grants can be detected.
  useEffect(() => {
    if (!inCombat) {
      setCombatStage('closing');
      setShowLog(false); // close the log when the fight is over
      return;
    }
    handBeforeCombatRef.current = new Set(run.hand.map((c) => c.uid));
    setEotAnimStats(null); // the End-of-Turn climb is done + baked in; combat shows the real units
    setEotAnimTick(null); // projected cadence tick is now committed (faceOmen) — drop the override
    setFodderAnim(null); // never let a lingering Fodder ghost survive into combat + replay on return
    setCombatStage('closing');
    setEndTurnFlash(true);
    const banner = window.setTimeout(() => setEndTurnFlash(false), 850);
    const t = window.setTimeout(() => setCombatStage('fighting'), 480);
    return () => {
      window.clearTimeout(t);
      window.clearTimeout(banner);
    };
  }, [inCombat, run.lastCombat]);

  // A Skip mutes ALL audio (stopAllAudio) and leaves it muted through the resolved-combat screen; un-mute once
  // the fight is left (back to the shop) so the next fight — and the shop — has sound again.
  useEffect(() => {
    if (!inCombat) { resumeAudio(); pixiFx.setVisible(true, 0); } // restore the FX layer after a Skip
  }, [inCombat]);

  // Once the combat replay finishes, settle the outcome (damage + carry-backs) right here in the combat
  // view — so the Resolve hit lands and is visible before the "End Combat" button returns you to the shop.
  // On a LOSS we defer settle to the loss-damage sequence below (so Resolve drops on the blast impact, not
  // instantly); win/draw settle immediately.
  useEffect(() => {
    if (fighting && replay.done && !run.combatSettled && replay.result !== 'lose') dispatch({ type: 'settleCombat' });
  }, [fighting, replay.done, run.combatSettled, replay.result, dispatch]);

  // Leaving the arena: fade EVERYTHING out together (units + FX) for one beat, THEN swap to the shop and fade
  // the recruit board + survivors back in together — a single synchronized crossfade instead of an abrupt
  // snap. `resolveCombat` is deferred to the end of the fade-out so the swap happens under cover of opacity 0.
  const endCombat = useCallback((): void => {
    setCombatOutro((o) => {
      if (o) return o; // already transitioning — ignore a double-click
      window.setTimeout(() => {
        dispatch({ type: 'resolveCombat' });
        setCombatOutro('in');
        window.setTimeout(() => setCombatOutro(null), 260); // clear once the fade-in has played
      }, 200); // fade-out duration (matches the CSS .combatout transition)
      return 'out';
    });
  }, [dispatch]);

  // Skip the replay — the same synchronized fade as End Combat, but it stays IN combat: freeze all motion
  // (GSAP) + kill all audio, hold a beat so everything visibly pauses and fades out together, then jump the
  // replay to the resolved board under cover of opacity 0 and fade that back in. Audio stays muted (a
  // replacement one-shot goes here later); it un-mutes when the fight is left / the next fight begins.
  const skipCombat = useCallback((): void => {
    setSkipFade((s) => {
      if (s) return s; // already skipping
      const FADE = 260, HOLD = 900, IN = 300;
      // Open the aura deploy-grace for the WHOLE skip: the replay jumps to the end, so any reborn / summoned
      // aura on the resolved board appears at once and would replay its form-in snap as the board resolves.
      // While the grace is open, syncShields registers those auras fully-formed (see deployGraceRef → `instant`).
      deployGraceRef.current = performance.now() + FADE + HOLD + IN + 600;
      // Just fade the FX canvas out, jump to the resolved board under cover of opacity 0, then fade the canvas
      // back in. We DON'T touch the aura bubbles: `syncShields` reconciles them on its own throughout — a dead
      // unit's aura clears on its normal grace (which expires DURING the hold, so no orphan lingers to the
      // fade-in), and survivors' auras stay put (no re-register, no re-bloom). Tickers stay live (a paused ticker
      // stalls a bubble's alpha → a pop). GSAP freezes the unit lunges; audio is killed (replacement one-shot TBD).
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
    if (!fighting || !replay.done || replay.result !== 'lose' || lossSeqRef.current) return;
    const run0 = useGame.getState().run;
    if (run0.combatSettled) return;
    lossSeqRef.current = true;

    const survivors = replay.frame.enemy;
    const cap = lossDamageCap(run0.wave);
    const finalDmg = Math.min(run0.lastCombat?.playerDamage ?? 0, cap);
    const oppTier = nextOpponent(run0)?.tier ?? run0.tier; // the just-fought board (wave advances only on Climb On)

    // Counter sits centered above the surviving enemy cards.
    const rectOf = (uid: string): DOMRect | undefined => findEl(uid)?.getBoundingClientRect() ?? undefined;
    const sRects = survivors.map((u) => rectOf(u.uid)).filter((r): r is DOMRect => !!r);
    const cx = sRects.length ? sRects.reduce((s, r) => s + r.left + r.width / 2, 0) / sRects.length : window.innerWidth / 2;
    const topY = sRects.length ? Math.min(...sRects.map((r) => r.top)) : window.innerHeight * 0.3;
    const cy = Math.max(64, topY - 64);

    // Contributions: opponent tier (flies from its intel frame) + each survivor's tier (from its card).
    const oppRect = document.querySelector('.oppframe')?.getBoundingClientRect();
    const contribs: { tier: number; r?: DOMRect; isOpp?: boolean }[] = [
      { tier: oppTier, r: oppRect ?? undefined, isOpp: true },
      ...survivors.map((u) => ({ tier: CARD_INDEX[u.cardId]?.tier ?? 1, r: rectOf(u.uid) })),
    ];
    const rawTotal = contribs.reduce((s, c) => s + c.tier, 0);

    const STAGGER = 130, FLY = 430;
    setLossPos({ x: cx, y: cy });
    setLossPhase('tally');
    setLossCount(0);
    setLossDmg(finalDmg);
    setLossCapped(rawTotal > cap);
    setLossFlyers(contribs.map((c, i) => ({
      id: i, tier: c.tier,
      x: c.r ? c.r.left + c.r.width / 2 : cx,
      y: c.r ? c.r.top + c.r.height / 2 : cy,
      tx: cx, ty: cy, delay: i * STAGGER, isOpp: c.isOpp,
    })));

    const timers: number[] = [];
    let running = 0;
    contribs.forEach((c, i) => {
      timers.push(window.setTimeout(() => { running += c.tier; setLossCount(Math.min(running, cap)); }, i * STAGGER + FLY));
    });
    const tallyEnd = (contribs.length - 1) * STAGGER + FLY + 340;

    timers.push(window.setTimeout(() => {
      setLossPhase('blast');
      setLossFlyers([]);
      // Aim the defeat blast at the HP box in the status bar. (Was `.hprow` — renamed to `.hpbox` in the
      // HP-bar → HP-box redesign, so this always fell through to the guessed corner, visibly wrong under the
      // Esc-menu letterbox / ultrawide where the status bar is offset.)
      const res = document.querySelector('.statusbar .hpbox')?.getBoundingClientRect();
      const tx = res ? res.left + res.width / 2 : window.innerWidth * 0.18;
      const ty = res ? res.top + res.height / 2 : window.innerHeight * 0.92;
      pixiFx.blastBolt(cx, cy, tx, ty);
      timers.push(window.setTimeout(() => {
        pixiFx.damageBurst(tx, ty);
        setLossShake(true);
        window.setTimeout(() => setLossShake(false), 360);
        dispatch({ type: 'settleCombat' }); // Resolve drops here → the StatusBar's −X hit flash fires
      }, pixiFx.blastTravelMs));
    }, tallyEnd));

    timers.push(window.setTimeout(() => setLossPhase('done'), tallyEnd + pixiFx.blastTravelMs + 650));
    return () => timers.forEach((t) => window.clearTimeout(t));
  }, [fighting, replay.done, replay.result, replay.frame, findEl, dispatch]);

  // Reset the loss sequence when leaving combat (ready for the next fight).
  useEffect(() => {
    if (!fighting) { lossSeqRef.current = false; setLossPhase(null); setLossFlyers([]); setLossCount(0); setLossPos(null); setLossShake(false); }
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
      const before = handBeforeCombatRef.current;
      const granted = run.hand.filter((c) => !before.has(c.uid)).map((c) => c.uid);
      if (granted.length > 0) {
        setArrivedUids((s) => new Set([...s, ...granted]));
        window.setTimeout(() => {
          setArrivedUids((s) => {
            const n = new Set(s);
            for (const u of granted) n.delete(u);
            return n;
          });
        }, 1100);
      }
    }
    prevPhaseRef.current = run.phase;
  }, [run.phase]);
  const flipStateRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
  // Hand reorder (drag a hand card sideways): the GSAP Flip state captured at drop, glided by a dedicated
  // layout effect. Separate from the warband/shop FLIP above — the hand's translateY tuck breaks the manual
  // x-tween that path uses, so Flip.from (which preserves the full transform) drives the hand instead.
  const handReorderFlipRef = useRef<ReturnType<typeof Flip.getState> | null>(null);
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
  const dragRef = useRef<DragState | null>(null);
  dragRef.current = drag;
  // Weighted-drag motion: the floating .dragcard lags slightly behind the cursor and tilts toward its
  // motion. Driven by a per-frame rAF that writes the card's transform directly (no React re-render), so it
  // stays compositor-only. `dragCardRef` is the floating node; `dragMotionRef` holds its smoothed position.
  // When the card is snapping back or magnet-sliding, React/CSS own the transform instead (see the JSX).
  const dragCardRef = useRef<HTMLDivElement>(null);
  const dragMotionRef = useRef({ rx: 0, ry: 0, ax: 0, ay: 0 }); // rx/ry = smoothed position; ax/ay = anchor (grab→centre)
  // Touch drags stick to the FINGER (near-1 catch-up), not the mouse-tuned weighted lag: a card trailing the
  // cursor reads as pleasant "weight" with a mouse, but under a fingertip the same lag reads as stutter/low-FPS.
  const dragIsTouchRef = useRef(false);
  const reactDrivesDrag = snapping || magSlide; // these use a CSS transition, not the rAF lean
  const reactDrivesDragRef = useRef(reactDrivesDrag);
  reactDrivesDragRef.current = reactDrivesDrag;

  // A targeted spell only enters "aiming" once it's dragged UP past the play line — down in the hand it's a
  // reorder (see the drop handler), so the targeting reticle stays hidden there. Defined up here (before the
  // drag-motion rAF) so that effect can depend on it: when a spell drops back below the line mid-drag the
  // floating .dragcard REMOUNTS, and the rAF must re-run to position it — otherwise it strands at 0,0 (the
  // top-left "ghost card" bug).
  const castingSpell = !!drag?.active && drag.source === 'hand' && !!drag.view.spell && (drag.view.target === 'friendly' || drag.view.target === 'any') && drag.y < playFloorRef.current;

  // The weighted-drag rAF: while a card is actively dragged (and not snapping/magnet-sliding), smooth the
  // card's render position toward the cursor and tilt it toward its motion, writing the transform straight
  // to the node each frame. The lag-gap (cursor − render pos) drives BOTH the catch-up and the lean, so a
  // fast drag leans hard and a stopped cursor settles flat. Pure compositor transform — no layout reads.
  useLayoutEffect(() => {
    if (!drag?.active) return;
    const el = dragCardRef.current;
    if (!el) return;
    const m = dragMotionRef.current;
    const d0 = dragRef.current;
    if (d0) {
      m.rx = d0.x; m.ry = d0.y;        // start at the cursor so the lift doesn't jump
      m.ax = d0.grabOx; m.ay = d0.grabOy; // anchor starts at the grab point → the card appears where you grabbed
      const f = getDragFeel();
      el.style.transformOrigin = `${m.ax}px ${m.ay}px`;
      el.style.transform = dragTransform(f.perspective, m.rx - m.ax, m.ry - m.ay, 0, 0, f.scale, f.staticRotate); // before-paint, no flash
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
        m.ax += (d.w / 2 - m.ax) * kc;
        m.ay += (d.h / 2 - m.ay) * kc;
      }
      const gx = d.x - m.rx;
      const gy = d.y - m.ry;
      m.rx += gx * k;
      m.ry += gy * k;
      const clamp = (v: number): number => Math.max(-f.tiltMax, Math.min(f.tiltMax, v));
      // Lean INTO the drag direction: each axis tilts by its signed lag-gap (cursor − card). Direction-driven,
      // so left/right (and up/down) lean opposite ways; when the cursor stops the gap closes and it sits flat.
      const rotY = clamp(f.tiltPerPx * f.hLean * gx); // horizontal lean
      const rotX = clamp(f.tiltPerPx * f.vLean * gy); // vertical lean
      el.style.transformOrigin = `${m.ax}px ${m.ay}px`; // pivot tilt/scale around the (recentring) anchor
      el.style.transform = dragTransform(f.perspective, m.rx - m.ax, m.ry - m.ay, rotX, rotY, f.scale, f.staticRotate);
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
  const timeUp = useTurnTimeUp(); // turn timer expired: lock everything but End Turn (flips once/turn — see turnClock)

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
    const el = document.elementFromPoint(x, y)?.closest('[data-zone="tavern"] .card[data-uid]:not(.spellcard)');
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
  const shopViews = useMemo(
    // The spell-display opts (cost mod + bonuses) ride along too, so Spell Cart's spell offers in the minion
    // row read their right cost + value, like the spell slot.
    () => new Map(run.shop.map((o) => [o.uid, shopView(o, { freeFirstBuy: run.rift === 'freedom' && !run.freeBuyUsedThisTurn && !o.held && !CARD_INDEX[o.cardId]?.spell, cardBuffs: run.cardBuffs, tavernAtk: run.tavernBuyBonus.atk, tavernHp: run.tavernBuyBonus.hp, undeadAtk: run.undeadAttackBonus, undeadHp: run.undeadHealthBonus, undeadBuyAtk: run.undeadBuyAtk, beastBuyAtk: run.beastBuyAtk, beastBuyHp: run.beastBuyHp, magneticBuyAtk: run.magneticBuyAtk, magneticBuyHp: run.magneticBuyHp, deathrattlesTriggered: run.deathrattlesTriggered, spellsCast: run.spellsCast, spellsThisTurn: run.spellsThisTurn, soulsmanGold: run.soulsmanGold, fodderConsumed: run.fodderConsumedThisTurn, spellCostMod: spellCostReduction(run), spellBonus, spellBonusH, frontToBackBonus: run.frontToBackBonus, frontToBackBonusH: run.frontToBackBonusH, goldSpent: run.goldSpentThisTurn, goldPouchValue: run.goldPouchValue, playedThisTurn: run.playedThisTurn, squirlScoutBuff: run.squirlScoutBuff, lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined, castMult: CARD_INDEX[o.cardId]?.spell ? spellCastCount(run, CARD_INDEX[o.cardId]!) : undefined })] as const)),
    [run.shop, run.rift, run.freeBuyUsedThisTurn, run.cardBuffs, run.tavernBuyBonus, run.undeadAttackBonus, run.undeadHealthBonus, run.undeadBuyAtk, run.beastBuyAtk, run.beastBuyHp, run.magneticBuyAtk, run.magneticBuyHp, run.deathrattlesTriggered, run.spellsCast, run.spellsThisTurn, run.soulsmanGold, run.fodderConsumedThisTurn, run.spellCostMod, spellBonus, spellBonusH, run.frontToBackBonus, run.board, run.nextSpellMult, run.goldSpentThisTurn, run.goldPouchValue, run.playedThisTurn, run.squirlScoutBuff],
  );
  const spellView = useMemo(
    () => (run.spell ? shopView(run.spell, { spellCostMod: spellCostReduction(run), spellBonus, spellBonusH, frontToBackBonus: run.frontToBackBonus, frontToBackBonusH: run.frontToBackBonusH, goldSpent: run.goldSpentThisTurn, goldPouchValue: run.goldPouchValue, castMult: CARD_INDEX[run.spell.cardId]?.spell ? spellCastCount(run, CARD_INDEX[run.spell.cardId]!) : undefined }) : null),
    [run.spell, run.spellCostMod, spellBonus, spellBonusH, run.frontToBackBonus, run.board, run.nextSpellMult, run.goldSpentThisTurn, run.goldPouchValue],
  );
  // Per-card referenced-card popups (uid → the cards it references). Stable across a drag (only
  // recomputes when the board / shop / hand or the Fodder buff changes), so it preserves the memo.
  const refViewsByUid = useMemo(() => {
    const m = new Map<string, CardView[]>();
    const add = (uid: string, cardId: string): void => {
      // The manual map first (Fodder/Imp cards whose references aren't effect params — e.g. Feed *consumes*
      // Fodder), then every card the effects actually name (summoned tokens, granted/transformed cards) so ANY
      // card that mentions another in its text surfaces it. De-duped, manual order wins.
      const def = CARD_INDEX[cardId];
      const refs = [...new Set([...(CARD_REFERENCES[cardId] ?? []), ...(def ? referencedCardIds(def) : [])])]
        .filter((id) => CARD_INDEX[id]);
      const spellLive = { a: spellBonus, h: spellBonusH, ftb: run.frontToBackBonus, ftbH: run.frontToBackBonusH ?? run.frontToBackBonus, goldSpent: run.goldSpentThisTurn ?? 0, goldPouchValue: run.goldPouchValue };
      if (refs.length) m.set(uid, refs.map((id) => tokenRefView(id, run.cardBuffs, run.impBuff, spellLive)));
    };
    for (const c of run.board) add(c.uid, c.cardId);
    for (const c of run.hand) add(c.uid, c.cardId);
    for (const o of run.shop) add(o.uid, o.cardId);
    return m;
  }, [run.board, run.hand, run.shop, run.cardBuffs, run.impBuff, spellBonus, spellBonusH, run.frontToBackBonus, run.frontToBackBonusH, run.goldSpentThisTurn]);
  // During the End-of-Turn animation the board shows each minion's per-proc stats (`eotAnimStats`),
  // so the numbers visibly tick up as each effect fires; otherwise the real stats.
  const live = useMemo(
    () => ({ undeadBuyAtk: run.undeadBuyAtk, soulsmanGold: run.soulsmanGold ?? 0, cardBuffs: run.cardBuffs, goldSpent: run.goldSpentThisTurn ?? 0, goldPouchValue: run.goldPouchValue, playedThisTurn: run.playedThisTurn, squirlScoutBuff: run.squirlScoutBuff, lastSpellName: run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined, frontToBackBonusH: run.frontToBackBonusH, improveReps: run.runeMastery ? 2 : 1 }),
    [run.undeadBuyAtk, run.soulsmanGold, run.cardBuffs, run.goldSpentThisTurn, run.goldPouchValue, run.playedThisTurn, run.squirlScoutBuff, run.lastSpellCastId, run.frontToBackBonusH, run.runeMastery],
  );
  const boardViews = useMemo(
    () => new Map(run.board.map((m) => [m.uid, instView(m, run.tier, eotAnimStats?.[m.uid], spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs?.cling, run.fodderConsumedThisTurn, { ...live, onBoard: true, eotTickOverride: eotAnimTick?.[m.uid] })] as const)),
    [run.board, run.tier, eotAnimStats, eotAnimTick, spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs, run.fodderConsumedThisTurn, live],
  );
  const handViews = useMemo(
    () => new Map(run.hand.map((m) => [m.uid, instView(m, run.tier, eotAnimStats?.[m.uid], spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs?.cling, run.fodderConsumedThisTurn, CARD_INDEX[m.cardId]?.spell ? { ...live, castMult: spellCastCount(run, CARD_INDEX[m.cardId]!) } : live)] as const)),
    [run.hand, run.tier, eotAnimStats, spellBonus, spellBonusH, run.spellsThisTurn, run.deathrattlesTriggered, run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, run.cardBuffs, run.fodderConsumedThisTurn, live, run.board, run.nextSpellMult],
  );
  // Tavern offers that would complete a triple if bought (you already hold 2 non-golden copies across
  // board + hand) — flagged with a gold glow + floating arrows. Mirrors `checkTriples`' counting.
  const tripleReadyUids = useMemo(() => {
    const counts = new Map<string, number>();
    for (const c of [...run.board, ...run.hand]) {
      if (!c.golden && !CARD_INDEX[c.cardId]?.spell) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
    const out = new Set<string>();
    for (const o of run.shop) {
      if (!CARD_INDEX[o.cardId]?.spell && (counts.get(o.cardId) ?? 0) >= 2) out.add(o.uid);
    }
    return out;
  }, [run.board, run.hand, run.shop]);

  // A single stable pointer-down handler shared by every card: it reads the grabbed card's uid
  // + zone from the DOM and its view from this ref, so the handler's identity never changes
  // mid-drag (a fresh per-card closure would defeat Card's memo). Replaces the old per-card
  // `beginDrag(uid, source, view)` factory.
  const viewsRef = useRef({ shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid });
  viewsRef.current = { shopViews, spellView, boardViews, handViews, spellUid: run.spell?.uid };
  const onCardPointerDown = useCallback(
    (e: ReactPointerEvent): void => {
      if (e.button !== 0 || inCombat || useGame.getState().endTurnAnimating) return; // no dragging in combat / mid end-of-turn
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
      // Grabbing a card mid-buff-flash clears its flash, so it doesn't replay the buff
      // animation when the card re-mounts after the drag (lift-out → drop).
      setBuffedUids((s) => {
        if (!s.has(uid)) return s;
        const n = new Set(s);
        n.delete(uid);
        return n;
      });
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
    playFloorRef.current = wbRect
      ? wbRect.bottom - 0.1 * (tvRect ? wbRect.bottom - tvRect.top : wbRect.height)
      : Infinity;
    // For a spell drag (targeting a friendly minion / any offer), cache the candidate card rects up front:
    // the board/shop don't shift during a spell drag, so targeting hit-tests these instead of elementFromPoint.
    const measureCards = (sel: string): { uid: string; r: DOMRect }[] =>
      [...document.querySelectorAll<HTMLElement>(sel)]
        .map((el) => ({ uid: el.getAttribute('data-uid') ?? '', r: el.getBoundingClientRect() }))
        .filter((c) => c.uid);
    targetRectsRef.current =
      drag.view.spell && (drag.view.target === 'friendly' || drag.view.target === 'any')
        ? {
            board: measureCards('[data-zone="warband"] .row .card[data-uid]'),
            shop: drag.view.target === 'any' ? measureCards('[data-zone="tavern"] .card[data-uid]:not(.spellcard)') : [],
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
    // rAF-throttle the move: a high-Hz pointer (120/144Hz mice, trackpads) fires pointermove far more
    // often than the screen repaints, and each event re-renders Recruit (the live insertion gap + spell
    // line read drag.x/y, so we can't ref them out). Coalesce — keep only the latest position and apply
    // it once per frame, capping re-renders at the refresh rate.
    // Motion-trail bookkeeping: the viewport point of the last wisp emit (null until the drag goes active).
    let trailLast: { x: number; y: number } | null = null;
    let moveRaf = 0;
    let lastMove: PointerEvent | null = null;
    const flushMove = (): void => {
      moveRaf = 0;
      const e = lastMove;
      if (!e) return;
      lastMove = null;
      setDrag((d) => {
        if (!d) return d;
        const active = d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > getDragFeel().threshold;
        return { ...d, x: e.clientX, y: e.clientY, active };
      });
      setOverZone(inSellRegion(e.clientY) ? 'tavern' : inBuyRegion(e.clientY) ? 'hand' : zoneAtCached(e.clientX, e.clientY));
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
    };
    const onMove = (e: PointerEvent): void => {
      lastMove = e;
      if (!moveRaf) moveRaf = requestAnimationFrame(flushMove);
    };
    const onUp = (e: PointerEvent): void => {
      const d = dragRef.current;
      // Recompute "did it move" from the up event too: with the rAF-throttle a flick completed inside one
      // frame may not have flushed `active` yet, but it's still a drag if the pointer cleared the threshold.
      const moved = !!d && (d.active || Math.hypot(e.clientX - d.startX, e.clientY - d.startY) > getDragFeel().threshold);
      if (!d || !moved) {
        document.body.classList.remove('dragging');
        // a click, not a drag — let onClick (hero targeting) handle it
        setDrag(null);
        setOverZone(null);
        return;
      }
      // Resolve the drop zone *before* clearing body.dragging, so the status bar (and
      // hero) stay click-through and a card can land on the hand tucked behind them.
      // A board minion released anywhere above the warband sells (the whole upper screen); a shop card
      // released anywhere below the warband line buys (the whole lower screen).
      const zone = inSellRegion(e.clientY) ? 'tavern' : inBuyRegion(e.clientY) ? 'hand' : zoneAt(e.clientX, e.clientY);
      // Snapshot the row's live positions BEFORE it reflows (and before body.dragging removal snaps their
      // transforms) so a hand-play / board-reorder / shop-reorder commit can FLIP each neighbour from where it
      // actually sits to its final slot — no jump when a fast "land it far over" release outran the throttled
      // preview, and no replay of the dragged card's whole move.
      const handMinionDrop = d.source === 'hand' && !d.view.spell && zone === 'warband';
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
        }, el ? getDragFeel().magSlideMs : 0);
        return;
      }

      const acted = applyDrop(d, zone, e.clientX, e.clientY);
      // Route drag-drop commits through the manual per-card FLIP (see `handPlaySnapRef`) instead of the
      // whole-row Flip.from, which would replay the dragged card's move after the drop. Covers a played hand
      // minion entering the board, a board/shop-offer reorder, AND a SELL / BUY pull-out — each snapshotted its
      // row's live spots above and glides only the cards that actually shifted (the dragged card is excluded,
      // so it never re-slides; on a sell/buy the survivors already sat re-centred, so they barely move).
      if (acted && (handMinionDrop || boardReorderDrop || shopReorderDrop || sellDrop || buyDrop)) handPlaySnapRef.current = true;
      if (acted || d.view.spell) {
        // a spell that misses just ends — it was never lifted from the hand
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
      if (dragRef.current?.view.spell) {
        e.preventDefault();
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
    if (!heroArmed || inCombat) {
      setAim(null);
      return;
    }
    let moved = false;
    // Fortify may buff a tavern offer; Gild / Encore are warband-only (you can't gild or replay an
    // unbought offer), so they only accept warband targets.
    const sel = heroTargetsTavern
      ? '[data-zone="warband"] .row .card[data-uid], [data-zone="tavern"] .row .card[data-uid]'
      : '[data-zone="warband"] .row .card[data-uid]';
    const minionAt = (x: number, y: number): { uid: string } | null => {
      const el = document.elementFromPoint(x, y)?.closest(sel);
      const uid = el?.getAttribute('data-uid');
      if (!uid || uid === run.spell?.uid) return null; // a minion, never the spell
      // Displace can't target a golden (triple) — it never lights up as a valid pick.
      if (heroTargetsNoGolden && run.board.find((c) => c.uid === uid)?.golden) return null;
      return { uid };
    };
    const move = (e: PointerEvent): void => {
      moved = true;
      // Anchor the aim line at the hero-power BUTTON (the thing you pressed to arm), not the hero frame.
      const f = document.querySelector('.statusbar .heropowerbtn') ?? document.querySelector('.statusbar .hero .f');
      if (!f) return;
      const r = f.getBoundingClientRect();
      // The aim point follows the cursor exactly — you can target anywhere on a
      // minion's card (no snap to centre); the hovered minion lights up.
      const target = minionAt(e.clientX, e.clientY);
      setAim({
        ox: r.left + r.width / 2,
        oy: r.top + r.height / 2,
        tx: e.clientX,
        ty: e.clientY,
        onTarget: !!target,
        targetUid: target?.uid ?? null,
      });
    };
    const up = (e: PointerEvent): void => {
      if (!moved) return; // a plain click — stays armed for a follow-up click
      const target = minionAt(e.clientX, e.clientY);
      if (target && !timeUp) {
        dispatch({ type: 'heroPower', uid: target.uid });
        flashBuffed(target.uid); // guarantee the Fortify buff-burst plays on the chosen minion
      } else armHero(); // released without a valid target — snaps back / cancels
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
    return () => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
    };
  }, [heroArmed, heroTargetsTavern, heroTargetsNoGolden, run.board, run.spell?.uid, timeUp, dispatch, armHero, inCombat, flashBuffed]);

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
    if (!def?.targetTribe) return true;
    if (uid === pendingTarget.uid) return false;
    const c = run.board.find((b) => b.uid === uid);
    return c ? isTribe(c, def.targetTribe) : false; // dual-types (Bane = Dragon/Demon) are valid picks
  };
  useEffect(() => {
    if (!pendingTarget || inCombat) {
      setAim(null);
      return;
    }
    // A tribe-restricted Battlecry (Toxin Tender → a friendly Undead, never self) only accepts matching
    // targets; an unrestricted one (no targetTribe) accepts any friendly minion.
    const def = CARD_INDEX[pendingTarget.cardId];
    const valid = (uid: string): boolean => {
      if (!def?.targetTribe) return true;
      if (uid === pendingTarget.uid) return false;
      const c = run.board.find((b) => b.uid === uid);
      return c ? isTribe(c, def.targetTribe) : false; // dual-types (Bane) are valid picks
    };
    const minionAt = (x: number, y: number): { uid: string } | null => {
      const el = document.elementFromPoint(x, y)?.closest('[data-zone="warband"] .row .card[data-uid]');
      const uid = el?.getAttribute('data-uid');
      return uid && valid(uid) ? { uid } : null;
    };
    const move = (e: PointerEvent): void => {
      const origin = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${pendingTarget.uid}"]`);
      if (!origin) return;
      const r = origin.getBoundingClientRect();
      const target = minionAt(e.clientX, e.clientY);
      setAim({
        ox: r.left + r.width / 2,
        oy: r.top + r.height / 2,
        tx: e.clientX,
        ty: e.clientY,
        onTarget: !!target,
        targetUid: target?.uid ?? null,
      });
    };
    const pick = (e: PointerEvent): void => {
      if (e.button !== 0 || timeUp) return;
      const target = minionAt(e.clientX, e.clientY);
      if (target) dispatch({ type: 'battlecryTarget', targetUid: target.uid });
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerdown', pick);
    return () => {
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
    turnClock.set(turnSeconds);
  }, [run.wave, turnSeconds, heroSelecting]);

  // Round timer: count down each recruit turn; at 0 the player is forced into combat (paused while a
  // Discover pick is open, and frozen while the hero picker is open). UI-only — the engine is untimed.
  // A self-scheduling loop (not keyed on `seconds`, which no longer lives in React state): it reads/
  // writes turnClock directly, so ticking never re-renders Recruit. The reset effect above runs first
  // on a new turn (effect order), so the clock is back at full time before this re-schedules.
  useEffect(() => {
    if (run.phase !== 'recruit' || run.discover || run.questOffer || run.runeforgeOffer || heroSelecting || overlayOpen) return;
    let id = 0;
    const tick = (): void => {
      const cur = turnClock.get();
      if (cur <= 0) return; // at 0 the timer just stops — actions lock (except End Turn); no auto-combat
      const next = cur - 1;
      if (next === 0) sfx.turnExplode(); // timer hits 0 — shop locks; syncs with the charge glyph's completion flash
      turnClock.set(next); // (the last-5s tick beeps were retired — the charge-glyph turnCharge cue replaces them)
      id = window.setTimeout(tick, 1000);
    };
    id = window.setTimeout(tick, 1000);
    return () => window.clearTimeout(id);
  }, [run.phase, run.discover, run.questOffer, run.runeforgeOffer, heroSelecting, overlayOpen, run.wave]);

  // Flash a card green AND float its +X/+X when its stats jump in the recruit phase (a buff landed).
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
    }
    // Cards that gained stats, with the exact delta — drives the +X/+X float (board + hand minions).
    const gained: { uid: string; attack: number; health: number }[] = [];
    for (const c of [...run.board, ...run.hand]) {
      const cur = { a: c.attack, h: c.health };
      next.set(c.uid, cur);
      const p = prev.get(c.uid);
      if (!inCombat && p && cur.a + cur.h > p.a + p.h && !eatUids.has(c.uid)) {
        newly.push(c.uid);
        gained.push({ uid: c.uid, attack: cur.a - p.a, health: cur.h - p.h });
      }
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
    // stale jump) but never flash — and wipe any flashes still pending from the End-of-Turn buff that
    // fired at "Face the Omen", so they can't reappear as a phantom green glow next round.
    if (inCombat) {
      setBuffedUids((s) => (s.size ? new Set() : s));
      return;
    }
    if (newly.length === 0) return;
    // The new source→target FX (tendril/descend) already lands on any target captured in `recruitBuffFx` this
    // action — skip the green burst-ring for those so it doesn't double up with the FX; the +X/+X float below
    // still shows on every buffed card regardless.
    const fxTargets = new Set(run.recruitBuffFx.map((e) => e.targetUid));
    // WELD (owner 2026-07-18): an Attachment fusing on gets its OWN cue — the gold pulse + the tunable
    // wiggle — so the generic stat-gain cues (the green burst AND the "+X/+X" float) are suppressed for the
    // minions this weld just landed on. Self-contained seq check: only the render that carries a FRESH weld
    // stamp suppresses, so a later buff on the same minion still floats normally.
    const freshWeld = run.weldFxSeq !== undefined && run.weldFxSeq !== weldStatSeqRef.current;
    weldStatSeqRef.current = run.weldFxSeq;
    const weldedNow = freshWeld ? new Set(run.weldFxUids ?? []) : new Set<string>();
    const burstable = newly.filter((u) => !fxTargets.has(u) && !weldedNow.has(u));
    if (burstable.length > 0) setBuffedUids((s) => new Set([...s, ...burstable]));
    // Float the +X/+X over the buffed board/hand minions (like combat). Keyed so a repeat buff remounts.
    const floatable = gained.filter((g) => !weldedNow.has(g.uid));
    if (floatable.length > 0) {
      const keyed = floatable.map((g) => ({ ...g, key: ++statFloatKey.current }));
      setStatFloats((m) => {
        const n = { ...m };
        for (const g of keyed) n[g.uid] = { attack: g.attack, health: g.health, key: g.key };
        return n;
      });
      window.setTimeout(() => {
        setStatFloats((m) => {
          const n = { ...m };
          for (const g of keyed) if (n[g.uid]?.key === g.key) delete n[g.uid];
          return n;
        });
      }, 1500);
    }
    // Self-clearing timer — deliberately NOT cancelled in cleanup. If it were, a buff quickly followed
    // by another board change (a buy/play, or the phase flip into combat) would cancel the clear and
    // leave the card stuck green. Letting each timer fire guarantees every flash ends on its own.
    window.setTimeout(() => {
      setBuffedUids((s) => {
        if (newly.every((u) => !s.has(u))) return s;
        const n = new Set(s);
        for (const u of newly) n.delete(u);
        return n;
      });
    }, 700);
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
    const fireOne = (ev: RunState['recruitBuffFx'][number]): void => {
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
    events.forEach((ev, i) => {
      if (staggerMs > 0 && i > 0) window.setTimeout(() => fireOne(ev), i * staggerMs);
      else fireOne(ev);
    });
  }, [findEl]);

  // Shop-phase buff FX: when the sim captured buff-others this action (recruitFxSeq bumped), replay them.
  useEffect(() => {
    if (run.recruitFxSeq === prevFxSeq.current) return;
    prevFxSeq.current = run.recruitFxSeq;
    if (run.recruitBuffFx.length === 0) return;
    replayBuffFxEvents(run.recruitBuffFx);
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
    const p = BUFF_PRESETS[buffPreset('', tribe)] ?? BUFF_PRESETS.default!;
    pixiFx.auraWave(
      { x: z.left, y, w: z.width, h },
      { ...getAuraFxConfig(), colorCore: p.colorFlash, colorGlow: p.colorGlow, colorMote: p.colorMote },
    );
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
      return;
    }
    const prev = prevBoardUidsRef.current;
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
    const t = window.setTimeout(() => {
      setBattlecryUids((s) => {
        const n = new Set(s);
        for (const u of fresh) n.delete(u);
        return n;
      });
    }, 760);
    return () => window.clearTimeout(t);
  }, [run.board, inCombat]);

  // Gilded (golden) minion deploys → fire the self-buff pulse ON it — the moment a unit turns gold (played from
  // hand, or formed by a triple on the board). The ref is seeded on first run / re-entry (inCombat) so existing
  // golden minions never re-pulse just from (re)opening the shop; only a genuinely NEW golden uid fires.
  const prevGoldUidsRef = useRef<Set<string> | null>(null);
  useEffect(() => {
    const current = new Set(run.board.filter((c) => c.golden).map((c) => c.uid));
    if (prevGoldUidsRef.current === null || inCombat) { prevGoldUidsRef.current = current; return; }
    const prev = prevGoldUidsRef.current;
    prevGoldUidsRef.current = current;
    const fresh = run.board.filter((c) => c.golden && !prev.has(c.uid));
    for (const c of fresh) {
      const el = findEl(c.uid);
      if (!el) continue;
      const r = (el.querySelector<HTMLElement>('.archbox') ?? el).getBoundingClientRect();
      pixiFx.pulse(r.left + r.width / 2, r.top + r.height / 2, PULSE_PRESETS[pulsePreset(c.cardId, c.tribe)]);
    }
  }, [run.board, inCombat]);

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
    const uids = run.karwindFlash ?? [];
    if (uids.length === 0) return;
    setKarwindFlameUids(new Set(uids));
    const t = window.setTimeout(() => setKarwindFlameUids(new Set()), 520);
    return () => window.clearTimeout(t);
  }, [run.karwindFlashSeq, run.karwindFlash]);

  // The living aim line (owner redesign 2026-07-16): sync the Pixi curved line to whichever targeting
  // gesture is live — the armed hero power / a pending targeted Battlecry (the `aim` state), or a
  // targeted spell being cast from hand (the drag). Replaces the old dotted SVG line; the arch is rolled
  // fresh inside pixiFx each time an aim STARTS.
  useEffect(() => {
    if ((heroArmed || pendingTarget) && aim) {
      pixiFx.setAimLine({ x: aim.ox, y: aim.oy }, { x: aim.tx, y: aim.ty }, aim.onTarget, getAimFxConfig());
    } else if (castingSpell && drag) {
      pixiFx.setAimLine({ x: drag.startX, y: drag.startY }, { x: drag.x, y: drag.y }, !!castTargetUid, getAimFxConfig());
    } else {
      pixiFx.clearAimLine();
    }
    // While the targeter is live, the aim line IS the pointer — hide the OS cursor (restored the moment
    // the aim ends; see styles.css `body.aiming`).
    document.body.classList.toggle('aiming', !!(((heroArmed || pendingTarget) && aim) || (castingSpell && drag)));
  });
  useEffect(() => () => { pixiFx.clearAimLine(); document.body.classList.remove('aiming'); }, []); // never strand the line/cursor on unmount

  // The Fodder-eat choreography (owner redesign 2026-07-16): the ghost card POPS IN hovering above the
  // shop line (fast in, easing to a stop), holds a beat, then CRUMBLES into purple energy (the CSS fade +
  // a source burst) while a tendril whips from it into each Demon that ate it (the Fodder-Infusion ribbon
  // language + the 🍖 tuner's dials); the eater's +X/+X floats as the tendril lands. ~1.2s total.
  // Shared by the per-action watcher below AND the End-of-Turn beat sequence (Abyssal Feeder / Feasting
  // Bogrot consume during `faceOmen`, after the phase flips — the beats replay the projection's events
  // while the shop is still up). Returns a cancel fn (the watcher's effect cleanup).
  const playFodderEat = useCallback((events: NonNullable<RunState['fodderEaten']>, key: number): (() => void) => {
    let raf = 0;
    let tries = 0;
    let t = 0;
    let crumbleT = 0;
    let floatT = 0;
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
        const gx = rr.left + rr.width / 2 + (i - (events.length - 1) / 2) * (w * 0.72);
        // Hover ABOVE the shop line: the ghost's centre sits just over the row's top edge.
        return { fid: ev.fodderId, attack: ev.attack, health: ev.health, x0: gx - w / 2, y0: rr.top - h * 0.62, w, h, eaterUid: ev.eaterUid };
      });
      setFodderAnim({ key: seq, ghosts });
      const CRUMBLE_MS = 620; // when the hover ends and the card breaks into energy (syncs the CSS keyframe's 65%)
      const icfg = getInfuseFxConfig();
      // The crumble: a tendril whips from each ghost into ITS eater — the 🍖 ribbon look, with the source
      // pulse doubling as the card's burst-into-energy.
      crumbleT = window.setTimeout(() => {
        for (const g of ghosts) {
          const from = { x: g.x0 + g.w / 2, y: g.y0 + g.h / 2 };
          const eaterEl = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${g.eaterUid}"]`);
          const er = eaterEl?.getBoundingClientRect();
          const to = er ? { x: er.left + er.width / 2, y: er.top + er.height / 2 } : { x: from.x, y: from.y + 220 };
          pixiFx.buffTendril(from, to, {
            blend: 'add', curve: icfg.curve * 0.6, wobbleAmp: icfg.wobbleAmp, wobbleFreq: icfg.wobbleFreq,
            travelMs: icfg.travelMs, retractMs: icfg.retractMs,
            baseWidth: icfg.baseWidth, tipWidth: icfg.tipWidth, coreAlpha: icfg.coreAlpha,
            glowWidth: icfg.glowWidth, glowAlpha: icfg.glowAlpha,
            flashSize: icfg.flashSize, flashMs: icfg.flashMs,
            moteCount: icfg.moteCount, moteSpeed: icfg.moteSpeed, moteLife: icfg.moteLife,
            pulseSize: icfg.pulseSize, pulseAlpha: icfg.pulseAlpha, pulseMs: icfg.pulseMs,
            colorCore: icfg.colorCore, colorGlow: icfg.colorGlow, colorFlash: icfg.colorCore, colorMote: icfg.colorGlow,
          });
        }
      }, CRUMBLE_MS);
      // Float the eater's +X/+X as the tendril LANDS — summed per eater (one Demon can eat several Fodder).
      const gains = new Map<string, { a: number; h: number }>();
      for (const ev of events) {
        const g = gains.get(ev.eaterUid) ?? { a: 0, h: 0 };
        g.a += ev.gainA;
        g.h += ev.gainH;
        gains.set(ev.eaterUid, g);
      }
      const keyed = [...gains].map(([uid, g]) => ({ uid, attack: g.a, health: g.h, key: ++statFloatKey.current }));
      floatT = window.setTimeout(() => {
        setStatFloats((m) => {
          const n = { ...m };
          for (const k of keyed) n[k.uid] = { attack: k.attack, health: k.health, key: k.key };
          return n;
        });
        // Impact wiggle: the eater physically reacts as the tendril lands (owner ask 2026-07-16) — a quick
        // gulp-pop, WAAPI transform-only with composite: 'add' (stacks on the card's own transforms).
        for (const k of keyed) {
          const el = document.querySelector(`[data-zone="warband"] .row .card[data-uid="${k.uid}"]`);
          try {
            el?.animate([
              { transform: 'translateY(0) scale(1) rotate(0deg)' },
              { transform: 'translateY(-4px) scale(1.06) rotate(-2deg)', offset: 0.25 },
              { transform: 'translateY(1px) scale(0.99) rotate(1.4deg)', offset: 0.55 },
              { transform: 'translateY(0) scale(1) rotate(0deg)' },
            ], { duration: 380, easing: 'ease-in-out', composite: 'add' });
          } catch { /* WAAPI composite unsupported: skip the wiggle rather than clobber the card transform */ }
        }
        window.setTimeout(() => {
          setStatFloats((m) => {
            const n = { ...m };
            for (const k of keyed) if (n[k.uid]?.key === k.key) delete n[k.uid];
            return n;
          });
        }, 1500);
      }, CRUMBLE_MS + icfg.travelMs); // the tendril's arrival
      t = window.setTimeout(() => setFodderAnim(null), 1250); // the card is long gone by here (fodderpop is 0.95s)
    };
    tryShow();
    return () => { if (raf) cancelAnimationFrame(raf); window.clearTimeout(t); window.clearTimeout(crumbleT); window.clearTimeout(floatT); };
  }, []);

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

  // --- Live warband drag: a dragged board minion is *lifted out* of the row entirely
  // (the floating copy IS the card) for the whole drag; the rest physically close up,
  // and an empty drop-slot opens at the live insertion point while over the warband.
  // Dropping lands the card straight into that slot — no post-drop "swap". A played
  // hand card opens the same slot. ---
  // Insertion / hover tracks the dragged card's *centre* (not the raw pointer, which is offset by
  // wherever you grabbed the card) — so the drop slot lands where the card visually sits.
  const dragCx = drag ? drag.x - drag.ox + drag.w / 2 : 0;
  const magHoverTarget = drag?.active && drag.source === 'hand' && drag.view.keywords.includes('M') && overZone === 'warband'
    ? run.board[warbandIndexAt(dragCx)]
    : undefined;
  const wouldMagnetize =
    !!drag?.active &&
    !magSlide && // once the slide starts, the warband settles (no more shove preview)
    !!magHoverTarget &&
    magnetizesTo(drag.view.cardId, magHoverTarget.cardId, magHoverTarget.addedTribes, magHoverTarget.allTribes);
  // Casting a targeted spell from the hand: highlight the friendly minion under the cursor (it's the target),
  // and don't treat it as a board-insertion drag. `castingSpell` itself is defined above (near the drag rAF).
  // The target under the cursor — a board minion, or (for `any` spells) a tavern offer.
  const castTargetUid = castingSpell
    ? boardUidAt(drag!.x, drag!.y) ?? (drag!.view.target === 'any' ? shopUidAt(drag!.x, drag!.y) : null)
    : null;
  const draggingBoard = !!drag?.active && drag.source === 'board';
  const overWarband =
    !!drag?.active &&
    !magSlide &&
    !wouldMagnetize &&
    !drag.view.spell &&
    // A board minion reorders only while actually over the warband row (dragging it up = sell). A HAND minion
    // plays anywhere ABOVE the play floor (see playFloorRef) — it needn't hit the row exactly; the preview
    // tracks the drag there (slot keyed off x). Once the cursor drops below the floor (nearer the hand) the
    // preview clears, signalling a release there cancels the play back to hand.
    ((drag.source === 'board' && overZone === 'warband') ||
      (drag.source === 'hand' && drag.y < playFloorRef.current && run.board.length < CONFIG.boardMax));
  // The dragged card STAYS in the row (rendered invisible via `dimmed`) so its slot holds the row width —
  // that's what stops the neighbours re-centring inward the instant you lift it (the "snap in then back out").
  // The gap moves via per-card slide transforms (see `boardSlide`/`shopSlide`), not by removing the card.
  const displayBoard = run.board;
  const draggingShop = !!drag?.active && drag.source === 'shop';
  const displayShop = run.shop;
  // Vertical lift of the dragged card from its press point — once it clears `collapseY`, it's a pull-OUT
  // (buy / sell / play), not an in-row reorder: the source row closes the hole behind it (cards after the
  // lifted one slide in one slot). This is what makes a card pulled *up* or *down* read as "the gap fills in".
  const dragLiftY = drag?.active ? Math.abs(drag.y - drag.startY) : 0;
  const collapsedLift = dragLiftY > getDragFeel().collapseY;
  // A dragged offer (not the pinned spell) reorders the shop while it stays near the row — but once it's
  // lifted clear (a buy), stop reordering so the collapse takes over (mirrors the warband's sell gesture).
  const overShop = draggingShop && overZone === 'tavern' && !collapsedLift && drag!.uid !== run.spell?.uid;
  const shopGapIndex = overShop ? shopIndexAt(dragCx, drag!.uid) : -1;
  // Where the empty drop-slot opens (insertion index among the displayed cards), or -1.
  // A magnetizing Cling Drone also shoves cards aside (a slot opens beside the target Mech).
  const gapIndex =
    overWarband || wouldMagnetize
      ? warbandIndexAt(dragCx, drag!.source === 'board' ? drag!.uid : undefined)
      : -1;
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
  const overHandReorder = draggingHand && drag!.y >= playFloorRef.current;
  const draggedHandIdx = draggingHand ? run.hand.findIndex((c) => c.uid === drag!.uid) : -1;
  const handGapIndex = overHandReorder ? handIndexAt(dragCx, drag!.uid) : -1;
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
    if (flipStateRef.current) {
      const flipCfg = getFlipConfig();
      const dragging = dragRef.current?.active ?? false;
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
            { x: 0, duration: flipCfg.commitMs / 1000, ease: 'power2.out', clearProps: 'transform,transition' },
          );
        }
      }
      // else: committed with commitMs 0 → snap (no animation); the drag preview already positioned everything.
    }
    flipStateRef.current = Flip.getState(FLIP_SELECTOR);
    // Persist each flipping card's LAYOUT left (offsetLeft — transform-immune, so a capture taken while a
    // prior tween is still mid-flight records the true resting spot) for the NEXT commit's manual FLIP.
    commitRectsRef.current = new Map(
      gsap.utils.toArray<HTMLElement>(FLIP_SELECTOR).map((el) => [el.dataset.uid ?? '', el.offsetLeft]),
    );
  }, [flipKey]);

  // Hand reorder glide: a drag-reorder (applyDrop) captured the fan's pre-move layout into handReorderFlipRef;
  // when the new hand order commits here, Flip.from animates each card from its old slot to its new one. GSAP
  // Flip (not the warband/shop manual x-tween) so the cards keep their translateY tuck through the glide. Only
  // fires when a reorder actually captured a state — a buy/play that also changes the order is left to its own
  // pop-in.
  const handOrderKey = run.hand.map((c) => c.uid).join(',');
  useLayoutEffect(() => {
    const st = handReorderFlipRef.current;
    if (!st) return;
    handReorderFlipRef.current = null;
    // Kill the hand cards' CSS `transition: transform` first (like the warband/shop commit does): on drop the
    // dragged card's slide resets to 0 and the neighbours' slides clear, and if the base transition is live it
    // animates those resets AT THE SAME TIME as this Flip — the two fight and that's the drop judder. Flip owns
    // the settle; restore the transition on complete.
    const targets = gsap.utils.toArray<HTMLElement>('.row.hand .card[data-uid]');
    gsap.set(targets, { transition: 'none' });
    Flip.from(st, {
      duration: getFlipConfig().commitMs / 1000,
      ease: 'power2.out',
      onComplete: () => gsap.set(targets, { clearProps: 'transition' }),
    });
  }, [handOrderKey]);

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
    const t = e.target as HTMLElement;
    if (t.closest('[data-zone] .card')) { sfx.cardTouch(); return; }
    if (heroArmed || drag) return;
    if (t.closest('button, a, input, [role="dialog"], .bar, .shopbar')) return;
    sfx.clickThock();
    pixiFx.clickPuff(e.clientX, e.clientY); // small Pixi dust at the cursor (sibling of the card-landing dust)
  };

  // End Turn → face the Omen. End-of-Turn effects play out *one at a time* on the still-mounted
  // recruit board so the player sees each one fire — and each repeats `chronosRepeats` times when a
  // Chronos is in play (mirrors `applyEndOfTurn`'s per-card-then-repeat order). Each beat flashes the
  // proc flourish under its card plus a tailored effect: Ritualist washes the whole shop purple (it
  // buffs the Fodder there), Combinator electrifies the Mechs it magnetizes onto. Then it faces the
  // Omen. (The effects themselves still *resolve* inside `faceOmen` — this is purely the telegraph.)
  const endTurn = (): void => {
    if (inCombat || endTurnPendingRef.current) return;
    const repeats = endOfTurnRepeats(run);
    type Beat = { uid: string; kind: 'combinator' | 'generic'; targets: string[]; completes: boolean; label?: string; gust?: boolean; infuse?: boolean };
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
      beats.push({ uid: '', kind: 'generic', targets: [], completes: true, label: qb.label });
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
    const total = (s?: { attack: number; health: number }): number => (s ? s.attack + s.health : 0);
    // Pre-animation cadence tick per uid — the counter projects to baseTick+1 when a card's beat fires
    // (eotTick advances once per turn regardless of Chronos repeats), matching what faceOmen commits.
    const baseTick: Record<string, number> = {};
    for (const c of run.board) baseTick[c.uid] = c.eotTick ?? 0;
    if (heroArmed) armHero(); // a stray armed Hero Power shouldn't fire mid-animation
    endTurnPendingRef.current = true;
    setEndTurnAnimating(true); // lock the shop / board / hero power while the beats play
    const BEAT = 760;
    const GAP = 170;
    const playBeat = (i: number): void => {
      if (i >= beats.length) {
        setEotProcUids(new Set());
        setEotPulseUids(new Set());
        setElectrifyUids(new Set());
        endTurnPendingRef.current = false;
        setEndTurnAnimating(false);
        dispatch({ type: 'faceOmen' });
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
      if (b.gust) fireTavernGust(); // Maw / Ritualist: the tavern-buffed rush, timed to the beat (replaced Ritualist's old purple shop-wash)
      if (b.infuse && b.uid) fireFodderInfusion(b.uid); // Maw: send-Fodder tendrils reach the shop on the beat
      if (b.kind === 'combinator') setElectrifyUids(new Set(b.targets));
      // This beat's captured FX from the projection: buff-others tendril/descend out of the firing card
      // (incl. a Hunter reacting to the beat's Attack gain), and Fodder consumes (Abyssal Feeder /
      // Feasting Bogrot) as the full ghost-crumble eat choreography.
      const bfx = beatFx[i];
      if (bfx) {
        // Sequential strikes within the beat: itemized per-z rewards land one descend per step. The
        // stagger shrinks as the event count grows so the whole run always fits inside the beat window.
        if (bfx.buffFx.length > 0) replayBuffFxEvents(bfx.buffFx, Math.min(110, Math.floor((BEAT - 140) / bfx.buffFx.length)));
        if (bfx.eaten.length > 0) playFodderEat(bfx.eaten, ++eotEatKey.current);
        // Auto-welds on this beat (Combinator / Cling Drones / Money Bots) — pulse each host as it fuses.
        for (const uid of bfx.welds) fireWeldPulse(uid, 'auto');
      }
      // Tick the affected minions' stats up to this proc's values + flash whoever just gained.
      const cur = steps[i];
      if (cur) {
        setEotAnimStats(cur);
        const prev = i > 0 ? steps[i - 1]! : baseStats;
        const gained = Object.keys(cur).filter((uid) => total(cur[uid]) > total(prev[uid] ?? baseStats[uid]));
        if (gained.length) {
          setBuffedUids((s) => new Set([...s, ...gained]));
          window.setTimeout(() => setBuffedUids((s) => {
            const n = new Set(s);
            for (const u of gained) n.delete(u);
            return n;
          }), BEAT);
        }
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
      // so their landing dust tucks behind them. Driven off AURA_CFGS so any future aura kind is covered.
      const hasAura = AURA_CFGS.some((c) => el.classList.contains(c.marker));
      if (!hasAura) {
        const prevPos = el.style.position;
        const prevZ = el.style.zIndex;
        el.style.position = 'relative';
        el.style.zIndex = '111'; // above .pixifx (z110) → dust renders behind the card
        window.setTimeout(() => { el.style.position = prevPos; el.style.zIndex = prevZ; }, 850);
      }
      pixiFx.dust(r.left + r.width / 2, r.top + r.height / 2, r.width, r.height, 1, 1.5); // original size, +50% denser cloud
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
      dispatch({ type: 'buy', uid: d.uid });
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
        setSellFloats((f) => [...f, { id, x: fx, y: fy, amount: sellValueOf(card, run) }]); // bartering-aware
        window.setTimeout(() => setSellFloats((f) => f.filter((s) => s.id !== id)), 1000);
      }
      // Sprinkle gold coins out of the Gold counter (the GOLD cell in the info strip up top) to sell the income.
      const goldEl = document.querySelector('.statcell.gold');
      if (goldEl) {
        const gr = goldEl.getBoundingClientRect();
        pixiFx.coins(gr.left + gr.width / 2, gr.top + gr.height * 0.4);
      }
      dispatch({ type: 'sell', uid: d.uid });
      return true;
    }
    // A HAND card (minion OR spell) released DOWN in the hand region REORDERS it — takes precedence over
    // play/cast, so spells reorder too. Lands where the live gap opened (prevHandGapRef, WYSIWYG). The settle
    // Flip is captured here EXCLUDING the dragged card, so it just appears in its new slot — no replay of the
    // drag. A drop on its own slot is a no-op (it settles back in place).
    if (d.source === 'hand' && y >= playFloorRef.current) {
      const from = run.hand.findIndex((c) => c.uid === d.uid);
      const to = prevHandGapRef.current >= 0 ? prevHandGapRef.current : handIndexAt(cx, d.uid);
      if (from >= 0 && from !== to) {
        const els = [...document.querySelectorAll<HTMLElement>('.row.hand .card[data-uid]')].filter((el) => el.dataset.uid !== d.uid);
        handReorderFlipRef.current = Flip.getState(els);
        dispatch({ type: 'reorderHand', uid: d.uid, toIndex: to });
      }
      return true;
    }
    // Cast a spell — playable anywhere from the warband up (incl. the tavern), since spells can't
    // be sold. A targeted spell hits the minion under the cursor, or auto-targets the carry when
    // flung up with no minion under it; an untargeted spell just resolves.
    if (d.source === 'hand' && d.view.spell) {
      const up = zone === 'warband' || zone === 'tavern';
      if (d.view.target === 'friendly' || d.view.target === 'any') {
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
        castSparks(() => sparkAtUid(targetUid, x, y), d.view.cardId); // spark per cast (Yazzus, aimed)
        return true;
      }
      if (up) {
        dispatch({ type: 'play', uid: d.uid });
        castSparks(() => fireSpark(x, y), d.view.cardId);
        return true;
      }
      return false;
    }
    if (d.source === 'hand' && !d.view.spell) {
      // Released UP in the play area (the reorder case, y ≥ play floor, is handled above) → PLAY it if there's
      // room. You needn't hit the warband row exactly; land where the preview's gap was last rendered
      // (WYSIWYG) so neighbours don't rebound. Board full → snap back.
      if (run.board.length >= CONFIG.boardMax) return false;
      const to = prevWarbandGapRef.current >= 0 ? prevWarbandGapRef.current : warbandIndexAt(cx);
      playWithSummonDelay({ type: 'play', uid: d.uid, toIndex: to });
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
      className={`app${compactCards ? ' compactui' : ''}${inCombat ? ' combat' : ''}${fighting ? ' fighting' : ''}${replay.shaking || lossShake ? ' shaking' : ''}${replay.critShaking ? ' shaking-crit' : ''}${
        inCombat && replay.done ? ` done ${replay.result}` : ''
      }${combatOutro === 'out' || skipFade === 'out' ? ' combatout' : combatOutro === 'in' || skipFade === 'in' ? ' combatin' : ''}${
        skipFade === 'out' ? ' combatfrozen' : ''
      }`}
      onPointerDown={onBoardPointerDown}
    >
      {/* Board art on a full-viewport layer behind the 16:9 stage — extends into the margins on off-16:9 monitors
          (see `.boardbg` in styles.css) rather than letterboxing to black. */}
      <div className="boardbg" aria-hidden="true" />
      {/* Charge glyph — the board's etched sigil, anchored to the board midline. Lives HERE (a direct child of
          `.app`, before the zones) rather than inside the warband zone, so the warband layout offset (x/y/scale)
          never moves it; it stays on the board sigil. z:0 + earliest tree position keeps it BEHIND the cards but
          above the board backdrop (see `.chargeglyph` in styles.css). */}
      <ChargeGlyph
        inCombat={inCombat}
        window={Math.min(CHARGE_SECONDS, turnSeconds)}
        paused={!!(run.discover || run.questOffer || run.runeforgeOffer || heroSelecting || overlayOpen)}
        covered={!!(heroSelecting || overlayOpen)}
      />
      <HudBar />

      {!fighting ? (
      <>
      {/* SHOP controls — a labelled row of gold plaque buttons (Gold · Tavern · Reroll · Freeze) framed by
          shopbutton.webp. The turn timer now lives in the header; End Turn is a standalone button (right). */}
      <div className={`shopbar${inCombat ? ' closing' : ''}`}>
        {/* Info plaques (Shop tier + turn Time) as widgets — same plaque language as the action row so they
            read at a glance instead of as loose text. The tier value takes the card tier-badge colour. */}
        {/* Info strip — the turn's read-only stats (Gold · Tier · Setup Time) grouped in one segmented
            plaque. Styled tooltips (.sbtip) replace the native title so hover hints match the dark-pill format. */}
        <div className="statstrip">
          <div className="statcell gold">
            <span className="sc-l">Gold</span>
            <span className="sc-ic"><Icon name="mana" /></span>
            <span className="sc-v">{run.embers}</span>
            {/* Hover: this turn's Gold + the projected START of the next two waves (cascading up, cap-aware). */}
            <div className="sbtip goldtip" role="tooltip">
              <div className="gt-now">Gold · <b>{run.embers}</b> this turn</div>
              <div className="gt-row"><span>Next turn</span><b><Icon name="mana" />{nextTurnGold}</b></div>
              <div className="gt-row"><span>Wave {run.wave + 2}</span><b><Icon name="mana" />{afterNextGold}</b></div>
            </div>
          </div>
          <div className="statcell tier" data-tier={run.tier}>
            <span className="sc-l">Tier</span>
            <span className="sc-v">{run.tier}</span>
            <span className="sbtip">Shop tier — higher tiers offer stronger minions (Upgrade Tavern to raise it)</span>
          </div>
          <ShopTimer label={isCalibrationRound(run.wave) ? 'Setup Time' : 'Time'} />
        </div>
        {/* Action tray — the turn's actions grouped into one control bar (Reroll · Freeze), framed by
            shopbutton.webp. Tavern Up moved onto the board as the standalone STONE button (TavernUpButton,
            mounted below with the End Turn diamond); Reroll/Freeze are queued for the same treatment. */}
        <div className="shoprow actiontray">
          {/* Reroll — free rolls show 0. */}
          <button
            className="shopbtn"
            disabled={(run.freeRolls <= 0 && run.embers < refreshCostOf(run)) || timeUp || eotAnimating || !!run.questOffer || !!run.runeforgeOffer}
            onClick={() => dispatch({ type: 'roll' })}
          >
            <span className="sb-l">Reroll</span>
            <span className="sb-ic"><Icon name="refresh" /></span>
            <span className="sb-v">{run.freeRolls > 0 ? 0 : refreshCostOf(run)}</span>
            <span className="sbtip">{run.freeRolls > 0 ? `Refresh — free (${run.freeRolls} left)` : 'Refresh the tavern'}</span>
          </button>
          {/* Freeze — toggle; tinted blue, filling solid blue while the tavern is frozen. */}
          <button
            className={`shopbtn freeze${run.frozen ? ' on' : ''}`}
            disabled={timeUp || eotAnimating || !!run.questOffer || !!run.runeforgeOffer}
            onClick={() => dispatch({ type: 'freeze' })}
          >
            <span className="sb-l">Freeze</span>
            <span className="sb-ic"><Icon name="freeze" /></span>
            <span className="sbtip">{run.frozen ? 'Frozen — click to unfreeze' : 'Freeze the tavern'}</span>
          </button>
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
      <EndTurnButton
        onEndTurn={endTurn}
        onEndCombat={endCombat}
        combatReady={inCombat && replay.done && (replay.result !== 'lose' || lossPhase === 'done')}
        disabled={inCombat
          ? !(replay.done && (replay.result !== 'lose' || lossPhase === 'done'))
          : eotAnimating || !!run.questOffer || !!run.runeforgeOffer}
        pressed={inCombat || eotAnimating}
        urgent={timeUp && !inCombat}
      />

      {/* Tavern Up — the standalone STONE button on the board's left (replaces the tray plaque; same
          reducer wiring + disabled conditions — a re-skin, not a behavior change). Mounted through BOTH
          phases (owner note 2026-07-16): in combat it's a passive TIER INDICATOR — inert, cost coin hidden,
          art at full strength. The max-tier condition lives in the component (the broken "complete" gem). */}
      <TavernUpButton
        tier={run.tier}
        maxTier={CONFIG.maxTier}
        cost={upgradeCostOf(run)}
        disabled={run.embers < upgradeCostOf(run) || timeUp || eotAnimating || !!run.questOffer || !!run.runeforgeOffer}
        combat={inCombat}
        onUpgrade={() => dispatch({ type: 'upgrade' })}
      />

      {/* Top-middle combat HUD (during the replay) — the Skip button centred near the top of the arena, with
          the replay-speed slider stacked beneath it. */}
      {inCombat && !replay.done && (
        <div className="combathud">
          <button className="combathud-skip" onClick={skipCombat} title="Skip the combat replay">
            <Icon name="sword" /> Skip
          </button>
          <div className="combatspeed" title="Combat replay speed">
            <span className="csl">Speed</span>
            <input
              type="range"
              min={0.5}
              max={5}
              step={0.1}
              value={combatSpeed}
              onChange={(e) => setCombatSpeed(Number(e.target.value))}
              aria-label="Combat replay speed"
            />
            <span className="combatspeed-val">{combatSpeed.toFixed(1)}×</span>
          </div>
        </div>
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
          {fighting ? (
            replay.frame.enemy.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="foe"
                anim={replay.anims[u.uid]}
                floats={replay.floatsFor(u.uid)}
                triggered={replay.triggerUids.has(u.uid)}
                rallyPulse={replay.rallyPulseUids.get(u.uid)}
                statHold={replay.statHoldFor(u.uid)}
                statFlash={replay.statFlashFor(u.uid)}
              />
            ))
          ) : (
          <>
          {displayShop.map((o, i) => (
            <Fragment key={o.uid}>
              {/* Gap opened by sliding the offers (`slideDir`); the dragged offer stays here invisible
                  (`dimmed`) to hold its slot — same model as the warband, no re-centre jerk. */}
              <Card
                uid={o.uid}
                slideDir={shopSlide(i)}
                dimmed={isDragging(o.uid)}
                card={shopViews.get(o.uid)!}
                refCards={refViewsByUid.get(o.uid)}
                dragging={!!drag?.active}
                highlight={(heroArmed && heroTargetsTavern) || (castingSpell && drag?.view.target === 'any')}
                targeted={(heroArmed && heroTargetsTavern && aim?.targetUid === o.uid) || castTargetUid === o.uid}
                buffed={buffedUids.has(o.uid)}
                tripleReady={tripleReadyUids.has(o.uid)}
                suppressPop={returningFromCombat}
                onPointerDown={heroArmed ? undefined : onCardPointerDown}
              />
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
          {inCombat ? (
            replay.frame.player.map((u) => (
              <Unit
                key={u.uid}
                u={u}
                side="you"
                anim={replay.anims[u.uid]}
                floats={replay.floatsFor(u.uid)}
                triggered={replay.triggerUids.has(u.uid)}
                rallyPulse={replay.rallyPulseUids.get(u.uid)}
                statHold={replay.statHoldFor(u.uid)}
                statFlash={replay.statFlashFor(u.uid)}
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
                    slideDir={boardSlide(i)}
                    dimmed={isDragging(m.uid)}
                    card={boardViews.get(m.uid)!}
                    refCards={refViewsByUid.get(m.uid)}
                    dragging={!!drag?.active}
                    highlight={heroArmed || castingSpell || isPendingTarget(m.uid)}
                    targeted={((heroArmed || isPendingTarget(m.uid)) && aim?.targetUid === m.uid) || castTargetUid === m.uid}
                    buffed={buffedUids.has(m.uid)}
                    battlecry={battlecryUids.has(m.uid) || eotProcUids.has(m.uid)}
                    // Medallion: a Battlecry / an officially-firing End-of-Turn pulses (ring); a cadence
                    // card that only ticked this turn (proc'd but not complete) just glows.
                    pulse={battlecryUids.has(m.uid) || eotPulseUids.has(m.uid)}
                    glow={eotProcUids.has(m.uid)}
                    popDelay={summonDelayUids.has(m.uid)}
                    electrify={electrifyUids.has(m.uid) || magTargetUid === m.uid}
                    karwind={karwindFlameUids.has(m.uid) ? (m.cardId === 'bane' || CARD_INDEX[m.cardId]?.keywords.includes('FD') ? 'haze' : 'flame') : false}
                    suppressPop={returningFromCombat}
                    buffFloat={statFloats[m.uid] ?? null}
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
          {run.hand.map((m, i) => {
            // Fan splay: each card tilts ~1.8° more than its neighbour out from the centre (capped at ±7° so a
            // big hand never over-fans; a lone card sits straight). The rotation is applied in CSS via the
            // `--fan-rot` var (see `.row.hand .card` in styles.css); it stays fanned through drags.
            const n = run.hand.length;
            const fanRot = n <= 1 ? 0 : Math.max(-7, Math.min(7, (i - (n - 1) / 2) * 1.8));
            // Disco Dan's Setlist: a card locked until its shop tier is greyed + shows a padlock (and can't be played).
            const locked = !!m.lockedUntilTier && run.tier < m.lockedUntilTier;
            return (
              <Card
                key={m.uid}
                uid={m.uid}
                card={handViews.get(m.uid)!}
                refCards={refViewsByUid.get(m.uid)}
                dragging={!!drag?.active}
                dimmed={isDragging(m.uid)}
                buffed={buffedUids.has(m.uid)}
                buffFloat={statFloats[m.uid] ?? null}
                arrived={arrivedUids.has(m.uid)}
                handSlidePx={handSlide(i) * handSlotWRef.current}
                fanRot={fanRot}
                onPointerDown={onCardPointerDown}
                locked={locked}
                lockLabel={locked ? `Tier ${m.lockedUntilTier}` : undefined}
                forceFull
              />
            );
          })}
          {/* Cards a combat effect just granted, so the hand visibly grows during the fight (they get
              committed to the real hand at `resolveCombat`). */}
          {inCombat && !run.combatSettled && replay.handGrantsShown.map((cardId, i) => (
            <Card key={`grant-${i}`} card={tokenRefView(cardId, run.cardBuffs, run.impBuff)} suppressPop forceFull />
          ))}
        </div>
      </div>

      {/* Loss-damage tally — surviving enemy tiers + the opponent's tier fly up into a damage counter
          above the enemy board (clamped to the round cap), then blast the Resolve bar. */}
      {fighting && lossPhase && lossPos && (
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

      {/* Killing-blow damage numbers for units that died this beat — rendered here, not inside the unit
          (which collapses + is removed), so the number reads + lingers at the spot the minion fell. */}
      {fighting &&
        replay.deathFloats.map((f) => (
          <div key={`death-${f.id}`} className="deathfloat" style={{ left: f.x, top: f.y } as CSSProperties}>
            <span className={`float ${f.kind}`}>{f.text}</span>
          </div>
        ))}

      {/* Gold gained from a sale, floating at the spot the minion was released (the actual sell value). */}
      {sellFloats.map((f) => (
        <div key={`sell-${f.id}`} className="deathfloat" style={{ left: f.x, top: f.y } as CSSProperties}>
          {/* Above-base sells (Hoarder, Trail Forager, Rune of Bartering) float GREEN so the bonus reads. */}
          <span className={`float ${f.amount > 1 ? 'sellup' : 'gold'}`}>+{f.amount}</span>
        </div>
      ))}

      {/* A card a combat effect just granted (Arcane Weaver → Spirit Fire) flies into your hand. */}
      {fighting && replay.handGrant && (() => {
        const def = CARD_INDEX[replay.handGrant.cardId];
        if (!def) return null;
        const view: CardView = {
          name: def.name, cardId: def.id, tribe: def.tribe, tribe2: def.tribe2,
          attack: def.attack, health: def.health, keywords: [...def.keywords], text: def.text,
          tier: def.tier, spell: def.spell, baseAttack: def.attack, baseHealth: def.health,
        };
        return (
          <div className="handgrant" key={replay.handGrant.key} aria-hidden="true">
            <span className="hg-label">To your hand</span>
            <Card card={view} suppressPop />
          </div>
        );
      })()}

      {/* A clear "End of Turn" beat as the turn ends (end-of-turn effects have resolved). */}
      {endTurnFlash && (
        <div className="eotbanner" aria-hidden="true">
          <span className="eot-text">End of Turn</span>
        </div>
      )}

      {drag?.active && !castingSpell && (
        <div
          ref={dragCardRef}
          className={`dragcard${snapping ? ' snap' : ''}${wouldMagnetize ? ' electric' : ''}${magSlide ? ' magslide' : ''}${overWarband && drag.source === 'hand' ? ' willplay' : ''}`}
          style={{
            width: drag.w,
            height: drag.h,
            // Normal drag: the rAF (above) owns `transform` + `transform-origin` (a weighted lag, a recentre
            // onto the cursor, and a tilt-toward-motion), written straight to this node so React re-renders
            // don't fight it. Snap-back / magnet-slide use a CSS transition, so React drives those here — the
            // origin is the card centre (matching the recentred anchor), the durations come from the config.
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
          <Card card={drag.view} forceFull={drag.source === 'hand'} />
        </div>
      )}

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
          return (
            <div
              key={`${fodderAnim.key}-${i}`}
              className="fodderghost"
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
            {run.lastCombat?.odds && (
              <div
                className="logodds"
                title="Estimated from 1000 simulations of this matchup — the actual result was one roll of these odds."
              >
                <div className="oddscap">Outcome odds</div>
                <div className="oddsbar">
                  <span className="ob win" style={{ width: `${run.lastCombat.odds.win * 100}%` }} />
                  <span className="ob draw" style={{ width: `${run.lastCombat.odds.draw * 100}%` }} />
                  <span className="ob lose" style={{ width: `${run.lastCombat.odds.lose * 100}%` }} />
                </div>
                <div className="oddslabels">
                  <span className="ol win">{Math.round(run.lastCombat.odds.win * 100)}% win</span>
                  <span className="ol draw">{Math.round(run.lastCombat.odds.draw * 100)}% draw</span>
                  <span className="ol lose">{Math.round(run.lastCombat.odds.lose * 100)}% loss</span>
                </div>
                {run.lastCombat.odds.lose > 0 && (
                  <div className="oddsavg" title="Average Resolve lost across the losing simulations (round-capped) — what a typical loss of this matchup costs.">
                    Avg damage on loss: <b>{Math.round(run.lastCombat.odds.avgLossDamage * 10) / 10}</b>
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

      {run.chooseOne && (
        <div className="discover-ov" role="dialog" aria-label="Choose One">
          <div className="discover-box">
            <div className="discover-title">
              <b>Choose One</b> — {CARD_INDEX[run.chooseOne.cardId]?.name}
            </div>
            <div className="chooseone-opts">
              {(() => {
                // A golden Choose One doubles each option's effect (gold(self) in the factories) — so show each
                // option's `goldenText` (Wildwood Shaper: +2/+6 / two Strays). The card is on the board (Battlecry
                // Choose One) or in hand (spell Choose One).
                const co = run.chooseOne!;
                const golden = !!(run.board.find((c) => c.uid === co.uid)?.golden ?? run.hand.find((c) => c.uid === co.uid)?.golden);
                return (CARD_INDEX[co.cardId]?.chooseOne ?? []).map((opt, i) => (
                  <button
                    className="chooseopt"
                    key={i}
                    onClick={() => dispatch({ type: 'chooseOne', index: i })}
                    dangerouslySetInnerHTML={{ __html: mdBold(golden ? (opt.goldenText ?? opt.text) : opt.text) }}
                  />
                ));
              })()}
            </div>
          </div>
        </div>
      )}

      {/* One orange button, always in the same fixed spot just below the Discover cards — it toggles between
          Minimize (inspect the board) and Return, so the player can flip back and forth without moving the mouse. */}
      {run.discover && (
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

      {run.discover && !discoverMin && (
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
                const lt = liveCardText(c.id, {
                  tier: run.tier, golden: false, spellBonus, spellBonusH, frontToBackBonus: run.frontToBackBonus, frontToBackBonusH: run.frontToBackBonusH,
                  spellsThisTurn: run.spellsThisTurn, spellsCast: run.spellsCast, deathrattlesTriggered: run.deathrattlesTriggered,
                  clingEnchant: run.cardBuffs?.cling, fodderConsumed: run.fodderConsumedThisTurn,
                  undeadBuyAtk: run.undeadBuyAtk, soulsmanGold: run.soulsmanGold ?? 0, cardBuffs: run.cardBuffs,
                });
                return (
                  <div className="disc-slot" key={`${id}-${i}`} style={{ '--c': `var(--t-${c.tribe})` } as CSSProperties}>
                    <Card
                      card={{ name: c.name, cardId: c.id, tribe: c.tribe, tribe2: c.tribe2, attack: c.attack, health: c.health, keywords: c.keywords, text: lt.text, goldenText: lt.goldenText, tier: c.tier }}
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

      {/* Quest overlay — mirrors the Discover flow: a blurred modal that can be MINIMIZED to inspect the shop
          (rolled up front now) + board, then returned to, so the quest pick is shop-informed. Reuses the
          `.discover-ov` chrome (blur backdrop, panel, gems); the toggle sits in the same fixed spot. */}
      {run.questOffer && (
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
      {run.questOffer && !questMin && (
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

      {/* Runeforge: a stone/engraved shop. Buy ONE of the offered runes (or Skip), then it closes and the shop
          begins. A minimize toggle lets you inspect the board behind it. The Runesmith's turn-6 forge draws the
          normal runeset; a quest can open the higher-power EPIC forge (`runeforgeEpic`) — same UI, Epic label. */}
      {run.runeforgeOffer && (
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
      {run.runeforgeOffer && !forgeMin && (
        <div className={`discover-ov forge-ov${run.runeforgeEpic ? ' forge-epic' : ''}`} role="dialog" aria-label={run.runeforgeEpic ? 'The Epic Runeforge' : 'The Runeforge'}>
          <div className="disc-panel forge-panel">
            <div className="disc-banner forge-banner"><Icon name="anvil" /><span className="disp">{run.runeforgeEpic ? 'Epic Runeforge' : 'Runeforge'}</span></div>
            {/* The player's CURRENT Gold — the runes charge Gold, so the panel must say what's in the purse
                (owner ask 2026-07-16). Re-renders with every buy/re-roll (run.embers). */}
            <div className="forge-gold" title="Your Gold right now"><Icon name="mana" /><b>{run.embers}</b> Gold</div>
            <div className="disc-cards forge-cards">
              {run.runeforgeOffer.map((id, i) => {
                const rune = RUNE_INDEX[id];
                return rune ? (
                  <RuneCard key={id} rune={rune} affordable={run.embers >= rune.cost} onBuy={() => dispatch({ type: 'buyRune', index: i })} />
                ) : null;
              })}
            </div>
            <div className="forge-actions">
              {!run.runeforgeRerolled && (
                <button
                  className="forge-reroll"
                  disabled={run.embers < 2}
                  onClick={() => dispatch({ type: 'rerollRuneforge' })}
                  title={run.embers < 2 ? 'Need 2 Gold to re-roll' : 'Re-roll all three Runes (once)'}
                >
                  <Icon name="refresh" /> Re-roll · <b className="forge-reroll-cost">2 Gold</b>
                </button>
              )}
              <button className="forge-skip" onClick={() => dispatch({ type: 'skipRuneforge' })}>Leave without a Rune</button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}
