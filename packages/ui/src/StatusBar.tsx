import { useEffect, useLayoutEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { renameTerms } from './terms';
import { Card, mdBold } from './Card';
import { instView } from './instView';
import { dragonTamerCostOf, roundedSpellbookCostOf, buyoutCostOf, allInPayoutOf, exhibitionGrantOf, heroPowerText, commissionOffer, COMMISSION_NAME, COMMISSION_REWARD, COMMISSION_DELAY, getHero, spellAmplifyBonus, spellAttackBonus, spellHealthBonus } from '@game/sim';
import { henchmanOffer } from '@game/sim';
import { CARD_INDEX } from '@game/content';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { BuffsFrame } from './BuffsFrame';
import { QuestBadges } from './QuestBadges';
import { gatherRunBuffs } from './runBuffs';
import { sfx } from './sfx';
import { playDef } from './fx/playDef';
import { useGame } from './store';
import { getHeroPowerBtnConfig } from './heroPowerBtnConfig';
import { pixiFx } from './pixiFx';
import { getAimFxConfig } from './aimFxConfig'; // also reflects the --hpb-* vars at load (side-effect)
import './heroPanelConfig'; // side-effect: reflects the --hpn-* hero-panel transform vars at load

/** Shrink a pill's TEXT to fit its box (owner note 2026-07-16: no ellipsis — "Lord of the Risen" should
 *  fit): after layout, if the text overflows the pill's max-width, scale the font down by the overflow
 *  ratio (one measurement, no loops). Re-fits when the text changes and on window resize (--u shifts). */
function useFitText(text: string) {
  const ref = useRef<HTMLDivElement>(null);
  useLayoutEffect(() => {
    const fit = (): void => {
      const el = ref.current;
      if (!el) return;
      el.style.fontSize = ''; // back to the stylesheet size before measuring
      if (el.scrollWidth > el.clientWidth) {
        // Ratio over the CONTENT box (padding doesn't scale with the font — a whole-box ratio under-shrinks),
        // with a hair of slack for subpixel rounding.
        const cs = getComputedStyle(el);
        const pad = parseFloat(cs.paddingLeft) + parseFloat(cs.paddingRight);
        const base = parseFloat(cs.fontSize);
        el.style.fontSize = `${Math.max(6, base * ((el.clientWidth - pad) / (el.scrollWidth - pad)) * 0.98)}px`;
      }
    };
    fit();
    window.addEventListener('resize', fit);
    return () => window.removeEventListener('resize', fit);
  }, [text]);
  return ref;
}

/** "twice per game" reads better than "2 per game" at the counts we actually use (2 and 3); anything larger
 *  falls back to the numeral rather than inventing English for a case no hero has. */
function usesPerGame(n: number): string {
  return `${n === 1 ? 'once' : n === 2 ? 'twice' : `${n} times`} per game`;
}

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
  const playerName = useGame((s) => s.playerName);
  const heroArmed = useGame((s) => s.heroArmed);
  const armHero = useGame((s) => s.armHero);
  const dispatch = useGame((s) => s.dispatch);
  const eotAnimating = useGame((s) => s.endTurnAnimating);
  const combatEnemyDeaths = useGame((s) => s.combatEnemyDeaths);
  // The hero + its power are data (HEROES registry); the panel renders whatever the run is on.
  const hero = getHero(run.heroId);
  const power = hero.power;
  // HENCHMAN offer (owner spec 2026-08-03): the hero's bound recruit at its decayed price — null for the many
  // heroes with none authored yet, and after the once-per-run buy. PLACEHOLDER SURFACE: a plain chip under the
  // power pill so the mechanic is playable end-to-end; the real presentation is Mike's to design.
  const henchman = run.phase === 'recruit' ? henchmanOffer(run) : null;
  const henchmanDef = henchman ? CARD_INDEX[henchman.cardId] : undefined;
  // Some powers unlock on a later turn (Myra's Encore — turn 3); locked (and unusable) before then.
  const unlockWave = power.unlockWave ?? 1;
  const unlocked = run.wave >= unlockWave;
  // Passive powers (Spellbinder) are always-on — never armed, never "used".
  const isPassive = !!power.passive;
  // Once-per-game powers (Indy's Gild) gate on heroPowerSpent; the rest recharge each wave. Fortify can
  // target a warband minion OR a tavern offer, so it's usable whenever ready — no friend required.
  const withinUses = power.maxUses ? (run.heroPowerUses ?? 0) < power.maxUses : true;
  // Jenkins's Dynamite Dig has an ESCALATING cost (1 Gold + 1 per prior use), not a fixed `power.cost`.
  const digCost = power.kind === 'dynamiteDig' ? (run.heroPowerUses ?? 0) : undefined;
  // Tiff's Dragon Tamer has a SHRINKING cost (5 − a discount per Dragon/spell bought since the last use).
  const tamerCost = power.kind === 'dragonTamer' ? dragonTamerCostOf(run) : undefined;
  // Hunch's Rounded Spellbook also shrinks — 3, −1 per turn since the last use (shared helper, so the coin
  // shows exactly what the reducer charges).
  const bookCost = power.kind === 'roundedSpellbook' ? roundedSpellbookCostOf(run) : undefined;
  // Harlan's Buyout shrinks 1 a turn and re-bases on use — the coin reads the SAME helper the reducer charges,
  // so the price shown can never drift from the price paid (the dynamiteDig / dragonTamer / Hunch pattern).
  const buyCost = power.kind === 'buyout' ? buyoutCostOf(run) : undefined;
  // CROUPIER CIA: her power art is the SUIT that will pay next, not one fixed image — the button is how the
  // player sees which reward they are working toward. Falls back to her plain portrait art if a suit image is
  // ever missing, so a half-wired art folder degrades instead of rendering nothing.
  // Cassen while a commission is in flight: the button is LOCKED but its art must stay bright, because that
  // art is how the player sees which commission is running. Without this the shared "unusable active power"
  // rule dims the art to 10% and the button reads as empty (owner report 2026-08-17).
  const committed = power.kind === 'commission' && !!run.commission;
  const powerRule = heroPowerText(run);
  // …and CASSEN's button wears the art of the commission currently running, reverting to his plain art the
  // moment it matures. Both fall back to the hero's own art if a variant image is missing, so a half-wired
  // folder degrades instead of rendering nothing (there is no CassenHP3 yet).
  const powerArt = power.kind === 'luckySeat' && run.ciaSuit
    ? (heroPowerArt(`cia-${run.ciaSuit}`) ?? heroPowerArt(hero.id))
    : power.kind === 'commission' && run.commission
      ? (heroPowerArt(`cassen-${run.commission.kind}`) ?? heroPowerArt(hero.id))
      : heroPowerArt(hero.id);
  // Gambler's Dice locks for as many turns as it rolled — how many turns remain.
  const diceLock = power.kind === 'dice' ? Math.max(0, (run.heroDiceLockUntil ?? 0) - run.wave) : 0;
  // GAMBLER'S DICE ROLL (owner ask 2026-08-14): the die visibly TUMBLES, then settles on what it rolled.
  // Presentation only — the value comes from gameplay (`heroDiceLockUntil - wave`, the seeded roll the reducer
  // already made). The tumble cycles 1→6 deterministically rather than randomly: it reads identically and
  // keeps the UI free of its own RNG.
  const [diceFace, setDiceFace] = useState<{ n: number; settled: boolean } | null>(null);
  const prevDiceLock = useRef(run.heroDiceLockUntil);
  useEffect(() => {
    const prev = prevDiceLock.current;
    prevDiceLock.current = run.heroDiceLockUntil;
    if (power.kind !== 'dice' || !run.heroDiceLockUntil || run.heroDiceLockUntil === prev) return;
    const rolled = run.heroDiceLockUntil - run.wave;
    if (rolled <= 0) return;
    let tick = 0;
    const id = window.setInterval(() => {
      tick += 1;
      if (tick >= 11) {
        window.clearInterval(id);
        setDiceFace({ n: rolled, settled: true }); // land on the real roll — and STAY PUT
      } else {
        setDiceFace({ n: (tick % 6) + 1, settled: false });
      }
    }, 55);
    return () => window.clearInterval(id); }, [run.heroDiceLockUntil, run.wave, power.kind]);
  // The settled face STAYS UP for the rest of the turn (owner ruling 2026-08-16) — it used to hand the slot
  // back to the lock countdown after 1.1s, which read as the number being taken away. `heroDiceRollWave` is the
  // authority on "this turn", so a reload mid-turn still shows it and the next turn drops it with no explicit
  // clear. Only the tumble itself is local state.
  const diceHeld = power.kind === 'dice' && run.heroDiceRollWave === run.wave ? (run.heroDiceRoll ?? null) : null;
  useEffect(() => { if (diceHeld == null) setDiceFace(null); }, [diceHeld]);
  // HUNCH'S SPELL PREVIEW (owner ask 2026-08-14): hovering the power shows the spell it would hand you. Built
  // through the SHARED `instView`, so the preview prints the spell's LIVE value (spell power et al.) — the
  // card-text rule: never show a base number where the real one is knowable.
  // Cassen: the commission picker is local to this component, which owns the button — no cross-component
  // plumbing for a panel only one hero ever opens.
  const [pickingCommission, setPickingCommission] = useState(false);
  const [pickingFlash, setPickingFlash] = useState(false);
  const [hunchTip, setHunchTip] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const hunchHover = hunchTip !== null;
  /** Place the preview to the SIDE of the power (owner ask 2026-08-14) — the same floating side-popup a minion
   *  hover uses (`.cardref`), portalled to <body> so nothing in the status bar clips it, and flipped to the
   *  left when it would run off the right edge. */
  const showHunchTip = (el: HTMLElement): void => {
    const r = el.getBoundingClientRect();
    const cs = getComputedStyle(document.documentElement);
    const zoom = (parseFloat(cs.getPropertyValue('--inspect-zoom')) || 1) * (parseFloat(cs.getPropertyValue('--z-inspect-s')) || 1);
    const cardW = r.width * zoom * 1.5; // plate footprint, same estimate the card popup uses
    const gap = 10;
    const flip = r.right + gap + cardW > window.innerWidth - 6;
    const estH = cardW * 1.5550; // plate aspect (800x1244)
    setHunchTip({
      left: flip ? Math.max(6, r.left - gap - cardW) : r.right + gap,
      top: Math.max(6, Math.min(r.top - estH / 3, window.innerHeight - estH - 6)),
      origin: flip ? 'right' : 'left',
    });
  };
  const hunchPreview = hunchHover && power.kind === 'roundedSpellbook' && run.lastSpellCastId
    ? instView(
      { uid: 'hunch-preview', cardId: run.lastSpellCastId, tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false },
      run.tier, undefined, spellAttackBonus(run), spellHealthBonus(run), run.spellsThisTurn, run.deathrattlesTriggered,
      run.undeadAttackBonus, run.undeadHealthBonus, run.frontToBackBonus, run.wave, run.spellsCast, undefined, undefined,
      { rubyBonus: run.rubyBonus, impAura: run.impBuff, topTribe: null },
    )
    : null;
  // Indy's Gild recharges after 40 Gold spent since the last use — how much of that 40 is banked so far.
  const gildSpent = power.kind === 'gild' && run.heroPowerSpent && run.indyGildRearmAt != null
    ? Math.max(0, Math.min(40, (run.goldSpent ?? 0) - (run.indyGildRearmAt - 40)))
    : 0;
  const canHero =
    !isPassive &&
    unlocked &&
    !eotAnimating &&
    withinUses &&
    (power.oncePerGame ? !run.heroPowerSpent : run.heroReady) &&
    (!power.cost || run.embers >= power.cost) &&
    (digCost === undefined || run.embers >= digCost) &&
    (tamerCost === undefined || run.embers >= tamerCost) &&
    (bookCost === undefined || run.embers >= bookCost) &&
    (buyCost === undefined || run.embers >= buyCost) &&
    diceLock === 0 && // Gambler: the roll is unusable while its lock runs
    !(power.kind === 'commission' && run.commission); // Cassen: locked until the running commission pays out
  // Live power TALLY (owner ask 2026-07-16) — the Avenge-style numerals riding ABOVE the diamond for powers
  // that track a value: recharge/quest progress, cadence countdowns, scaling values, Jenkins's dig tier.
  // Null hides it (e.g. a completed quest fades away by unmounting; Robin with nothing banked shows nothing).
  const powerTally: string | null = (() => {
    switch (power.kind) {
      case 'gild': return run.heroPowerSpent ? `${gildSpent}/40g` : null; // Indy — recharging
      case 'spellAmplify': return `${(run.spellsCast + (run.fxSpellsCastPreview ?? 0)) % 10}/10`; // Yirin — ticks live as combat casts resolve (fxSpellsCastPreview)
      case 'collision': return `${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`; // Cassen — kills
      case 'quest': return run.heroPowerSpent ? null : `${run.drakkoBuys}/5`; // Drakko — fades away when complete
      case 'questChronos': return run.heroPowerSpent ? null : `${run.eotMinionBuys ?? 0}/4`; // Chronos — same
      case 'sellGold': return (run.bonusEmbersNextTurn ?? 0) > 0 ? `${run.bonusEmbersNextTurn}g` : null; // Robin — banked
      case 'recurringGoldcrafter': return run.wave % 4 === 0 ? 'now' : `${4 - (run.wave % 4)}t`; // Gildmaster — cadence
      case 'scalingGold': return run.heroPowerSpent ? null : `${1 + run.wave}g`; // Bagger Ben — current value
      case 'lesserQuest': return run.wave < 4 ? `${4 - run.wave}t` : null; // Fi — turns to the errand
      case 'runeforge': return run.wave < 5 && !run.heroPowerSpent ? `${5 - run.wave}t` : null; // Runesmith — forge opens turn 5 (was 7; the countdown lagged the retime, owner report 2026-07-31)
      case 'epicRuneforge': return run.epicForgeWave != null && run.wave < run.epicForgeWave ? `${run.epicForgeWave - run.wave}t` : null; // Runeguard
      case 'pathfinder': return run.wave < 10 ? `${10 - run.wave}t` : null; // Coran — turns to the capstone
      case 'dynamiteDig': return `Tier ${run.tier}`; // Jenkins — what the dig would discover
      case 'secondHand': return run.wave % 3 === 0 ? 'now' : `${3 - (run.wave % 3)}t`; // Re-Pete — fires when this turn ends / countdown
      case 'fourPeat': return `${Math.min(3, run.gorrBuys?.length ?? 0)}/3`; // Gorr — minion buys this turn
      case 'dice': return diceLock > 0 ? `${diceLock}t` : null; // Gambler — turns until the roll unlocks
      case 'contraband': return `${(run.refreshCount ?? 0) % 3}/3`; // Pete — refreshes toward the tier-above roll
      case 'archive': return `${(run.archivedTribes?.length ?? 0)}/3`; // Quillen — minions filed toward the Discover
      case 'investment': return `${run.bramInvested ?? 0}/5`; // Bram — Gold banked toward the Gilded payout
      case 'luckySeat': return `${run.ciaEnchantedBought ?? 0}/3`; // Cia — Enchanted buys toward the queued suit (the button art names it)
      case 'exhibition': return `+${exhibitionGrantOf(run)}/+${exhibitionGrantOf(run)}`; // Odelle — the LIVE grant
      case 'allIn': return withinUses ? `${allInPayoutOf(run)}g` : null; // Rascal — what it pays right now
      case 'soulbind': return `${Math.max(0, 3 - (run.heroPowerUses ?? 0))} left`; // Sable — bonds remaining
      // Cassen — turns until the running commission matures. `dueWave` is the turn it PAYS on, so the count is
      // the gap from now; it reads 1 on the turn before it lands and disappears when nothing is running.
      case 'baldgecoin': return `${run.jugglerBuys ?? 0}/3`; // Juggler — minions bought toward the next Coin
      case 'commission': return run.commission ? `${Math.max(0, run.commission.dueWave - run.wave)}t` : null;
      default: return null;
    }
  })();
  // The big line under the hero name: what tapping the power does *right now*.
  const powerLine = isPassive
    ? power.kind === 'spellAmplify'
      ? `${power.name} · +${spellAmplifyBonus(run.spellsCast)}/+${spellAmplifyBonus(run.spellsCast)} · ${run.spellsCast % 10}/10`
      : power.kind === 'quest'
        ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.drakkoBuys}/5`}`
        : power.kind === 'questChronos'
          ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.eotMinionBuys ?? 0}/4`}`
          : power.kind === 'collision'
            ? `${power.name} · ${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`
            : power.kind === 'recurringGoldcrafter'
                ? `${power.name} · ${run.wave % 4 === 0 ? 'this turn' : `in ${4 - (run.wave % 4)}t`}`
                : `${power.name} · passive`
    : heroArmed
      ? 'Pick a minion…'
      : !unlocked
        ? `${power.name} · unlocks turn ${unlockWave}`
        : power.kind === 'fortify'
          ? `${power.name} · +${run.tier}/+${run.tier}`
          : power.kind === 'gainMaxMana'
            ? `${power.name} · ${!run.heroReady ? 'used' : run.embers >= (power.cost ?? 0) ? `${power.cost} Gold` : `need ${power.cost} Gold`}`
            : power.kind === 'gild'
              ? `${power.name} · ${run.heroPowerSpent ? `${gildSpent}/40 Gold` : 'ready'}`
              : power.kind === 'scalingGold'
                  ? `${power.name} · ${run.heroPowerSpent ? 'spent' : `+${1 + run.wave} Gold`}`
                  : power.kind === 'dynamiteDig'
                    ? `${power.name} · ${!run.heroReady ? 'used' : digCost === 0 ? 'FREE' : run.embers >= digCost! ? `${digCost} Gold` : `need ${digCost} Gold`}`
                    : power.kind === 'dragonTamer'
                      ? `${power.name} · ${!run.heroReady ? 'used' : tamerCost === 0 ? 'FREE' : run.embers >= tamerCost! ? `${tamerCost} Gold` : `need ${tamerCost} Gold`}`
                      : power.kind === 'roundedSpellbook'
                        ? `${power.name} · ${!run.heroReady ? 'used' : bookCost === 0 ? 'FREE' : run.embers >= bookCost! ? `${bookCost} Gold` : `need ${bookCost} Gold`}`
                        : power.kind === 'dice' && diceLock > 0
                          ? `${power.name} · locked ${diceLock}t`
                          // A once-per-GAME power must never read "once per turn" (owner report 2026-08-14 — Xerox).
                          : power.oncePerGame
                            ? `${power.name} · ${run.heroPowerSpent ? 'spent' : 'once per game'}`
                            // …and neither must a capped-USES power (Rascal: twice a game, not once a turn —
                            // owner report 2026-08-16). The cap is the headline; the once-per-turn gate is
                            // still enforced, it just isn't what the player needs told.
                            : power.maxUses
                              ? `${power.name} · ${(run.heroPowerUses ?? 0) >= power.maxUses ? 'spent' : usesPerGame(power.maxUses)}`
                              : `${power.name} · ${run.heroReady ? 'once per turn' : 'used'}`;
  // The live status line (current magnitude + countdown) shown ON HOVER, with the leading "Name · " stripped
  // (the name is the tip's header). Reuses the same live computations the old always-visible line did.
  const powerStatus = powerLine.startsWith(`${power.name} · `) ? powerLine.slice(power.name.length + 3) : powerLine;
  // REFRESH FLASH (owner note 2026-07-16, mirroring the End Turn diamond's relight): when the power comes
  // back up for usage the face blooms once. The signal is canHero AND the shop being on screen — a re-arm
  // that lands during combat (the reducer preps next-turn state early) defers its bloom to the moment the
  // shop returns, instead of firing invisibly mid-fight and reading "late"/missed (owner report). Covers
  // every re-arm path: start-of-shop recharge, Indy's Gild mid-shop, re-affording a costed power. One-shot
  // on mount (the layer unmounts after the tuner's `flash · refresh` ms + the 0.2s CSS delay); 0 disables.
  // ACTIVATION BURST (owner ask 2026-07-16): when the power actually FIRES — heroReady flipping
  // true→false mid-recruit (per-turn powers) or heroPowerSpent flipping false→true (once-per-game) —
  // spray sparks in all directions from the diamond. Covers targeted + untargeted paths alike.
  const prevReady = useRef(run.heroReady);
  const prevSpent = useRef(run.heroPowerSpent);
  useEffect(() => {
    const used = (prevReady.current && !run.heroReady) || (!prevSpent.current && run.heroPowerSpent);
    prevReady.current = run.heroReady;
    prevSpent.current = run.heroPowerSpent;
    if (!used || run.phase !== 'recruit') return;
    const el = document.querySelector('.heropowerbtn');
    if (!el) return;
    const r = el.getBoundingClientRect();
    pixiFx.heroPowerBurst(r.left + r.width / 2, r.top + r.height / 2, getAimFxConfig());
  }, [run.heroReady, run.heroPowerSpent, run.phase]);

  const [refreshFlash, setRefreshFlash] = useState(false);
  const flashSignal = canHero && run.phase === 'recruit';
  const prevFlashSignal = useRef(false);
  const flashTimerRef = useRef<number | undefined>(undefined);   // see below — must outlive the effect
  useEffect(() => {
    const was = prevFlashSignal.current;
    prevFlashSignal.current = flashSignal;
    if (!flashSignal || was) return;
    const ms = getHeroPowerBtnConfig().refreshFlash;
    if (ms <= 0) return;
    setRefreshFlash(true);
    /* Clear timer in a REF, not this effect's cleanup: `flashSignal` going true→false inside the hold made the
       cleanup cancel the clear, and the rising-edge guard above then early-returns — so the flash stayed lit
       for good. Same defect as the medallion pulses (#735, #736). */
    if (flashTimerRef.current !== undefined) window.clearTimeout(flashTimerRef.current);
    flashTimerRef.current = window.setTimeout(() => {
      flashTimerRef.current = undefined;
      setRefreshFlash(false);
    }, ms + 280);
  }, [flashSignal]);
  // Pill text auto-fits its box (no ellipsis / no tooltip needed — owner note 2026-07-16).
  const playerNameRef = useFitText(playerName);
  // When effective HP drops (Armor or Resolve — a wave broke through), shake the chip + float the −X.
  const prevHp = useRef(run.resolve + run.armor);
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  const hitTimerRef = useRef<number | undefined>(undefined);   // see below — must outlive the effect
  useEffect(() => {
    const prev = prevHp.current;
    const now = run.resolve + run.armor;
    prevHp.current = now;
    if (now < prev) {
      setHit({ amt: prev - now, key: prev });
      /* Ref timer, same reason as the refresh flash: effective HP moving again inside the 1100ms hold — armor
         gained, Resolve healed — cancelled the clear via the cleanup and took the `now < prev` branch out of
         play, leaving the −X float parked on the chip permanently. */
      if (hitTimerRef.current !== undefined) window.clearTimeout(hitTimerRef.current);
      hitTimerRef.current = window.setTimeout(() => {
        hitTimerRef.current = undefined;
        setHit(null);
      }, 1100);
    }
  }, [run.resolve, run.armor]);

  // Hero-portrait buff FLASH — a blast/shard pop with a small eased ripple whenever ANY run buff grows (spell
  // power, a tribe aura, max Gold, …). Keyed off the SUMMED magnitude of the run-buff rows, so a buff of any
  // kind rising bumps the key and replays the one-shot. Recruit-phase only source (run state, not the combat
  // delta) — combat has its own per-unit FX, and flashing the portrait every beat would be noise. (owner ask
  // 2026-07-21.) One-shot transform/opacity animation, so it never repaints at rest.
  const buffMag = gatherRunBuffs(run).reduce((sum, r) => {
    for (const m of r.value.matchAll(/-?\d+/g)) sum += Math.abs(Number(m[0]));
    return sum;
  }, 0);
  const prevBuffMag = useRef(buffMag);
  const [buffFlash, setBuffFlash] = useState(0);
  // Run-buff rows for the pop-out (folds in live combat gains via `combatBuffs`), plus its open state. The
  // pop-out is toggled by clicking the hero portrait and expands UPWARD out of its top edge.
  const combatBuffs = useGame((s) => s.combatBuffs);
  const buffRows = gatherRunBuffs(run, combatBuffs);
  const [buffsOpen, setBuffsOpen] = useState(false);
  useEffect(() => {
    if (buffMag > prevBuffMag.current) setBuffFlash((n) => n + 1);
    prevBuffMag.current = buffMag;
  }, [buffMag]);

  return (
    <div className="statusbar">
      {/* Completed-quest trophies — a horizontal row of art circles sitting directly above the hero panel. */}
      <QuestBadges />
      <div className="statusrow">
        <div
          className={`hero${isPassive ? ' passive' : canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
        >
          {/* Run buffs pop-out — expands UPWARD out of the portrait's top edge into the empty top-left board
              space when the portrait is clicked, anchored at the bottom so it grows up (owner rework 2026-08-14;
              it used to be a side drawer with a tab). */}
          <BuffsFrame open={buffsOpen} rows={buffRows} />
          {/* The portrait holds the hero art; the PLAYER name rides the bottom pill, and CLICKING it toggles the
              run-buffs pop-out (the up-arrow at its top + the dark hover overlay are the cues). */}
          <div
            className={`f${buffRows.length ? ' hasbuffs' : ''}${buffsOpen ? ' buffsopen' : ''}`}
            onClick={() => { if (buffRows.length) setBuffsOpen((o) => !o); }}
            role={buffRows.length ? 'button' : undefined}
            aria-expanded={buffRows.length ? buffsOpen : undefined}
            aria-label={buffRows.length ? (buffsOpen ? 'Hide run buffs' : 'Show run buffs') : undefined}
          >
            {/* Buff flash — remounts on `buffFlash` so the one-shot shard+ripple replays each time a run buff
                grows. `aria-hidden`, pointer-events none; sits over the art, under the name pill. */}
            {buffFlash > 0 && <span key={buffFlash} className="herobuff-blast" aria-hidden="true" />}
            {heroArt(hero.id) ? (
              <img className="heroimg" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
            {playerName && <div className="heroname" ref={playerNameRef}>{playerName}</div>}
            {/* Buffs affordance — the little arrow at the top of the portrait (only when there are buffs). */}
            {buffRows.length > 0 && <span className="herobuffs-arrow" aria-hidden="true">{buffsOpen ? '▾' : '▴'}</span>}
            {/* Hover affordance — the portrait darkens and spells out the click action (only when there are
                buffs to open; without any, the click is a no-op and there's nothing to explain). */}
            {buffRows.length > 0 && (
              <span className="herohover" aria-hidden="true">
                Click hero portrait to open / close the Buffs Panel
              </span>
            )}
          </div>
          {/* Health as a compact white box under the hero — the number is Resolve (+Armor). Keeps the hit-shake
              + −X float when a wave breaks through. */}
          <div
            className={`hpbox${hit ? ' hit' : ''}`}
            title={`Resolve: ${run.resolve} of ${run.maxResolve}${run.maxArmor ? ` · Armor ${run.armor} of ${run.maxArmor}` : ''}`}
          >
            <Icon name="heart" />
            <span className="hpval">{run.resolve}{run.armor > 0 && <b className="armval" title="Armor — extra effective HP">+{run.armor}</b>}</span>
            {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
          </div>
        </div>
        {/* Hero power — its OWN box to the right of the hero frame, sized up so an ACTIVE power reads as an
            obvious press-me button. The whole box glows (`.ready`) when the power is usable this turn, so it's a
            standing reminder to press it; it firms up (`.armed`) while aiming. A PASSIVE hero's box shows the art
            (dimmed, no glow, not clickable). The button keeps the `.heropowerbtn` class so Recruit's aim line
            still anchors to it. Clicking the frame does nothing — this button is the ONLY trigger. */}
        <div
          className={`heropanel${isPassive ? ' passive' : heroArmed ? ' armed' : canHero ? ' ready' : ''}`}
        >
          <div className="hpwrap">
            <button
              type="button"
              className={`heropowerbtn${isPassive ? ' passive' : heroArmed ? ' armed' : canHero ? ' ready' : ''}${committed ? ' committed' : ''}`}
              disabled={isPassive || (!canHero && !heroArmed)}
              aria-label={`${power.name} — ${renameTerms(powerRule).replace(/\*\*/g, '')}`}
              // Hunch only: reveal the spell this would grant. Cheap — the state is a boolean and the preview
              // is only built while hovering (and only for that hero).
              onPointerEnter={power.kind === 'roundedSpellbook' ? (e) => showHunchTip(e.currentTarget) : undefined}
              onPointerLeave={power.kind === 'roundedSpellbook' ? () => setHunchTip(null) : undefined}
              onPointerDown={(e) => {
                // B1: arm on PRESS, not click — so a press-drag-release onto a minion is one continuous
                // gesture (like dragging a card). A quick tap without dragging just arms it, preserving the
                // press-then-click-target flow (the aim line then follows the cursor; see Recruit).
                e.stopPropagation();
                if (isPassive || !canHero || heroArmed) return;
                sfx.pulse(); // the hero-power "pulse" cue, on pressing the button (fire or arm)
                sfx.heroPower(hero.id); // + this hero's own power SFX (heroes/<id>.power.mp3), layered; silent if absent
                // The authored 'hero-power-spark' FX (FX workbench) from the button's centre on press (owner
                // ask 2026-08-14). Fires when the power is actually used/armed, not on an inert press.
                {
                  const r = e.currentTarget.getBoundingClientRect();
                  const cx = r.left + r.width / 2, cy = r.top + r.height / 2;
                  playDef('hero-power-spark', { source: { x: cx, y: cy }, target: { x: cx, y: cy } });
                }
                // CASSEN: the power is a CHOICE, so pressing it opens a picker rather than firing. It fires
                // when an option is chosen (below). Untargeted, but not immediate.
                // …and it is INERT while one is already running (owner ask 2026-08-16) — the reducer refuses
                // it too, so this just stops the panel opening on a click that could not do anything.
                if (power.kind === 'commission') { if (!run.commission) setPickingCommission(true); }
                else if (power.kind === 'firstOrLast') setPickingFlash(true);
                else if (power.untargeted) dispatch({ type: 'heroPower' });
                else armHero();
              }}
            >
              {/* CIRCLE treatment (owner ask 2026-08-14): the bronze frame png underneath is gone — the button
                  is JUST the hero-power art, clipped to a perfect circle. The ready/armed cue + refresh bloom
                  are now pure-CSS circular glows behind/over the art (no frame pngs), so nothing but the power
                  image shows. The 💠 tuner still moves/scales the art inside the circle via --hpb-art-*. */}
              <span className="hpb-glow" aria-hidden="true" />
              {/* Art sits in a CIRCULAR clipping wrapper so the 💠 tuner's art offset/scale dials move the art
                  INSIDE the circle without moving the clip. */}
              {powerArt
                ? <span className="hpb-artwrap" aria-hidden="true"><img className="hpb-art" src={powerArt} alt="" draggable={false} /></span>
                : <Icon name="sc" />}
              {/* The REFRESH bloom — a one-shot circular flash as the power re-arms (never a loop). */}
              {refreshFlash && <span className="hpb-flash" aria-hidden="true" />}
            </button>
            {(digCost ?? tamerCost ?? bookCost ?? buyCost ?? power.cost) ? <span className="hpcost"><span className="costn">{digCost ?? tamerCost ?? bookCost ?? buyCost ?? power.cost}</span></span> : null}
            {/* Keyed on its text so every change replays the compositor-only bump (the Avenge-tally feel).
                While the Gambler's die tumbles it owns this slot, then hands it back to the countdown. */}
            {diceFace != null
              ? <span key={diceFace.settled ? 'die-final' : `die${diceFace.n}`} className={`hpb-tally hpb-dice${diceFace.settled ? ' settled' : ''}`}>{diceFace.n}</span>
              : diceHeld != null
                ? <span key="die-held" className="hpb-tally hpb-dice settled">{diceHeld}</span>
                : powerTally ? <span key={powerTally} className="hpb-tally">{powerTally}</span> : null}
            {/* CASSEN'S COMMISSION PICKER — reuses the Discover overlay's shell so it reads as the same kind of
          decision, but its options are plain text tiles rather than cards (a commission is not a card). Only
          the OFFERED commissions appear, so the one taken last is absent. */}
      {pickingCommission && createPortal(
        <div className="discover-ov commission-ov" role="dialog" aria-label="Choose a commission">
          <div className="disc-panel">
            <div className="disc-banner"><span className="disp">Choose a Commission</span></div>
            <div className="commission-opts">
              {commissionOffer(run).map((kind) => (
                <button
                  key={kind}
                  type="button"
                  className="questcard has-art"
                  style={{ '--c': 'var(--t-neutral)' } as CSSProperties}
                  onClick={() => { setPickingCommission(false); dispatch({ type: 'heroPower', commission: kind }); }}
                >
                  {heroPowerArt(`cassen-${kind}`) && <img className="questcard-art" src={heroPowerArt(`cassen-${kind}`)} alt="" aria-hidden />}
                  <span className="questcard-emblem" aria-hidden><Icon name="target" /></span>
                  <div className="questcard-head">
                    <div className="questcard-tier">Commission · {COMMISSION_DELAY[kind]} turns</div>
                    <div className="questcard-name">{COMMISSION_NAME[kind]}</div>
                  </div>
                  <div className="questcard-body">
                    <div className="questcard-sect reward">
                      <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
                      <div className="questcard-txt">{COMMISSION_REWARD[kind]}</div>
                    </div>
                  </div>
                  <span className="questcard-gem" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>, document.body)}
      {/* FLASH'S CHOOSE ONE — the SAME markup as Cassen's picker above, so the quest-style treatment in
          styles.css dresses both from one place rather than drifting into two lookalike panels. */}
      {pickingFlash && createPortal(
        <div className="discover-ov commission-ov" role="dialog" aria-label="First or Last">
          <div className="disc-panel">
            <div className="disc-banner"><span className="disp">First or Last</span></div>
            <div className="commission-opts">
              {(['first', 'last'] as const).map((end) => (
                <button
                  key={end}
                  type="button"
                  className="questcard has-art"
                  style={{ '--c': 'var(--t-neutral)' } as CSSProperties}
                  onClick={() => { setPickingFlash(false); dispatch({ type: 'heroPower', flashPick: end }); }}
                >
                  {heroPowerArt(`flash-${end}`) && <img className="questcard-art" src={heroPowerArt(`flash-${end}`)} alt="" aria-hidden />}
                  <span className="questcard-emblem" aria-hidden><Icon name="target" /></span>
                  <div className="questcard-head">
                    <div className="questcard-tier">Claim · next combat</div>
                    <div className="questcard-name">{end === 'first' ? 'First Place' : 'Last Place'}</div>
                  </div>
                  <div className="questcard-body">
                    <div className="questcard-sect reward">
                      <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
                      <div className="questcard-txt">
                        {end === 'first' ? 'A copy of the FIRST minion you kill' : 'A copy of the LAST minion you kill'}
                      </div>
                    </div>
                  </div>
                  <span className="questcard-gem" aria-hidden />
                </button>
              ))}
            </div>
          </div>
        </div>, document.body)}
      {/* Hunch: hovering the power shows the SPELL it would hand you (owner ask 2026-08-14) — you can't
                judge the price without knowing what you're buying. Rendered from the same live view the shop
                uses, so its printed value is the real one. */}
            {hunchPreview && hunchTip && createPortal(
              <div className="cardref" style={{ left: hunchTip.left, top: hunchTip.top }}>
                <div className="cardref-inner" style={{ transformOrigin: `${hunchTip.origin} center` }}>
                  <Card card={hunchPreview} forceFull plated />
                </div>
              </div>,
              document.body,
            )}
          </div>
          {/* The power NAME now lives in the pill for passives too (mirrors the active-power pill, e.g. Soren's
              Reclaim); the "Passive"/status detail moves to the hover tip below. */}
          <div className="hplabel">{power.name}</div>
          {/* HENCHMAN recruit chip — placeholder presentation (see the `henchman` derivation above). */}
          {henchman && henchmanDef && (
            <button
              className="hmn-btn"
              disabled={run.embers < henchman.cost || eotAnimating}
              onClick={() => dispatch({ type: 'buyHenchman' })}
              title={`Recruit ${henchmanDef.name} — your hero's henchman. Costs ${henchman.cost} Gold (gets cheaper every round: win −3, loss −2).`}
            >
              {henchmanDef.name} · {henchman.cost === 0 ? 'FREE' : `${henchman.cost}g`}
            </button>
          )}
          <div className="herotip" role="tooltip">
            <b>{power.name}</b>{isPassive ? ' · passive' : ''}
            {/* `**word**` = a keyword reference → renders BOLD (mdBold), never raw asterisks. */}
            <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(powerRule) }} />
            {/* QUILLEN: the archived TYPES, each in its own tribe colour, with unused slots as "Empty". A
                plain rule string cannot carry per-word colour, so the live state is rendered here instead of
                being folded into the text (owner ask 2026-08-17). */}
            {power.kind === 'archive' && (
              <span className="herotip-types">
                {Array.from({ length: 3 }, (_, i) => {
                  const t = run.archivedTribes?.[i];
                  return (
                    <span
                      key={i}
                      className={`herotip-type${t ? '' : ' empty'}`}
                      style={t ? ({ '--tc': `var(--t-${t})` } as CSSProperties) : undefined}
                    >
                      {t ? t.charAt(0).toUpperCase() + t.slice(1) : 'Empty'}
                    </span>
                  );
                })}
              </span>
            )}
            {/* Live status (current magnitude + countdown) on hover — the progress text was removed from the
                always-visible hero box, so it reads here instead. */}
            <span className="herotip-live">{powerStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
