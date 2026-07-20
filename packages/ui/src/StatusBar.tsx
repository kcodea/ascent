import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { renameTerms } from './terms';
import { mdBold } from './Card';
import { dragonTamerCostOf, getHero, spellAmplifyBonus } from '@game/sim';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { BuffsFrame } from './BuffsFrame';
import { QuestBadges } from './QuestBadges';
import { gatherRunBuffs } from './runBuffs';
import { sfx } from './sfx';
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
    (tamerCost === undefined || run.embers >= tamerCost);
  // Live power TALLY (owner ask 2026-07-16) — the Avenge-style numerals riding ABOVE the diamond for powers
  // that track a value: recharge/quest progress, cadence countdowns, scaling values, Jenkins's dig tier.
  // Null hides it (e.g. a completed quest fades away by unmounting; Robin with nothing banked shows nothing).
  const powerTally: string | null = (() => {
    switch (power.kind) {
      case 'gild': return run.heroPowerSpent ? `${gildSpent}/40g` : null; // Indy — recharging
      case 'spellAmplify': return `${run.spellsCast % 10}/10`; // Yirin — spells toward the next step
      case 'collision': return `${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`; // Cassen — kills
      case 'quest': return run.heroPowerSpent ? null : `${run.drakkoBuys}/5`; // Drakko — fades away when complete
      case 'questChronos': return run.heroPowerSpent ? null : `${run.eotMinionBuys ?? 0}/4`; // Chronos — same
      case 'sellGold': return (run.bonusEmbersNextTurn ?? 0) > 0 ? `${run.bonusEmbersNextTurn}g` : null; // Robin — banked
      case 'recurringGoldcrafter': return run.wave % 4 === 0 ? 'now' : `${4 - (run.wave % 4)}t`; // Gildmaster — cadence
      case 'scalingGold': return run.heroPowerSpent ? null : `${1 + run.wave}g`; // Bagger Ben — current value
      case 'lesserQuest': return run.wave < 4 ? `${4 - run.wave}t` : null; // Fi — turns to the errand
      case 'runeforge': return run.wave < 7 && !run.heroPowerSpent ? `${7 - run.wave}t` : null; // Runesmith
      case 'epicRuneforge': return run.epicForgeWave != null && run.wave < run.epicForgeWave ? `${run.epicForgeWave - run.wave}t` : null; // Runeguard
      case 'pathfinder': return run.wave < 10 ? `${10 - run.wave}t` : null; // Coran — turns to the capstone
      case 'dynamiteDig': return `Tier ${run.tier}`; // Jenkins — what the dig would discover
      case 'secondHand': return run.wave % 3 === 0 ? 'now' : `${3 - (run.wave % 3)}t`; // Re-Pete — fires when this turn ends / countdown
      case 'fourPeat': return `${Math.min(3, run.gorrBuys?.length ?? 0)}/3`; // Gorr — minion buys this turn
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
  useEffect(() => {
    const was = prevFlashSignal.current;
    prevFlashSignal.current = flashSignal;
    if (!flashSignal || was) return;
    const ms = getHeroPowerBtnConfig().refreshFlash;
    if (ms <= 0) return;
    setRefreshFlash(true);
    const id = window.setTimeout(() => setRefreshFlash(false), ms + 280);
    return () => window.clearTimeout(id);
  }, [flashSignal]);
  // Pill text auto-fits its box (no ellipsis / no tooltip needed — owner note 2026-07-16).
  const heroNameRef = useFitText(hero.name);
  const playerNameRef = useFitText(playerName);
  // When effective HP drops (Armor or Resolve — a wave broke through), shake the chip + float the −X.
  const prevHp = useRef(run.resolve + run.armor);
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  useEffect(() => {
    const prev = prevHp.current;
    const now = run.resolve + run.armor;
    prevHp.current = now;
    if (now < prev) {
      setHit({ amt: prev - now, key: prev });
      const t = window.setTimeout(() => setHit(null), 1100);
      return () => window.clearTimeout(t);
    }
    return undefined;
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
          {/* Player name — a pill eclipsing the top of the hero box (mirrors the opponent name on its frame). */}
          {playerName && <div className="playername" ref={playerNameRef}>{playerName}</div>}
          {/* Run buffs — a collapsible drawer extending RIGHT from the portrait, its tab eclipsing this
              box's right edge (owner rework 2026-07-21; it used to be a separate top-left window). */}
          <BuffsFrame />
          {/* The portrait holds ONLY the hero art; the hero name rides a pill eclipsing its bottom edge (mirrors
              the player-name pill at the top). Health/Armor sits to its right (see `.hpbox` CSS). */}
          <div className="f">
            {/* Buff flash — remounts on `buffFlash` so the one-shot shard+ripple replays each time a run buff
                grows. `aria-hidden`, pointer-events none; sits over the art, under the name pill. */}
            {buffFlash > 0 && <span key={buffFlash} className="herobuff-blast" aria-hidden="true" />}
            {heroArt(hero.id) ? (
              <img className="heroimg" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
            <div className="heroname" ref={heroNameRef}>{hero.name}</div>
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
              className={`heropowerbtn${isPassive ? ' passive' : heroArmed ? ' armed' : canHero ? ' ready' : ''}`}
              disabled={isPassive || (!canHero && !heroArmed)}
              aria-label={`${power.name} — ${renameTerms(power.text).replace(/\*\*/g, '')}`}
              onPointerDown={(e) => {
                // B1: arm on PRESS, not click — so a press-drag-release onto a minion is one continuous
                // gesture (like dragging a card). A quick tap without dragging just arms it, preserving the
                // press-then-click-target flow (the aim line then follows the cursor; see Recruit).
                e.stopPropagation();
                if (isPassive || !canHero || heroArmed) return;
                sfx.pulse(); // the hero-power "pulse" cue, on pressing the button (fire or arm)
                sfx.heroPower(hero.id); // + this hero's own power SFX (heroes/<id>.power.mp3), layered; silent if absent
                if (power.untargeted) dispatch({ type: 'heroPower' });
                else armHero();
              }}
            >
              {/* DIAMOND housing (owner direction 2026-07-16 — same strategy as the End Turn diamond,
                  mirrored to the board's middle-left). Layers, bottom-up: the FULL bronze frame with its
                  dark face intact (the backing the art fades against — the board never peeks through), the
                  power art ON TOP clipped to the face window, and the FACE-cut glow above (drop-shadows
                  follow the inner diamond's alpha; a CSS mask cuts the source pixels back out so only the
                  halo paints — hover shows it, READY/ARMED pin it). All dialed live by the 💠 tuner via
                  --hpb-* vars. */}
              <img className="hpb-glow" src="/frames/heropowerbutton_face.webp" alt="" draggable={false} aria-hidden="true" />
              <img className="hpb-frame" src="/frames/heropowerbutton.webp" alt="" draggable={false} aria-hidden="true" />
              {/* Art sits in a CLIPPING wrapper (the face window stays fixed) so the 💠 tuner's art
                  offset/scale dials move the art INSIDE the window without moving the clip. */}
              {heroPowerArt(hero.id)
                ? <span className="hpb-artwrap" aria-hidden="true"><img className="hpb-art" src={heroPowerArt(hero.id)} alt="" draggable={false} /></span>
                : <Icon name="sc" />}
              {/* The REFRESH FLASH — a one-shot bloom of the face as the power re-arms (never a loop). */}
              {refreshFlash && <img className="hpb-flash" src="/frames/heropowerbutton_face.webp" alt="" draggable={false} aria-hidden="true" />}
            </button>
            {(digCost ?? tamerCost ?? power.cost) ? <span className="hpcost"><span className="costn">{digCost ?? tamerCost ?? power.cost}</span></span> : null}
            {/* Keyed on its text so every change replays the compositor-only bump (the Avenge-tally feel). */}
            {powerTally && <span key={powerTally} className="hpb-tally">{powerTally}</span>}
          </div>
          {/* The power NAME now lives in the pill for passives too (mirrors the active-power pill, e.g. Soren's
              Reclaim); the "Passive"/status detail moves to the hover tip below. */}
          <div className="hplabel">{power.name}</div>
          <div className="herotip" role="tooltip">
            <b>{power.name}</b>{isPassive ? ' · passive' : ''}
            {/* `**word**` = a keyword reference → renders BOLD (mdBold), never raw asterisks. */}
            <span className="herotip-rule" dangerouslySetInnerHTML={{ __html: mdBold(power.text) }} />
            {/* Live status (current magnitude + countdown) on hover — the progress text was removed from the
                always-visible hero box, so it reads here instead. */}
            <span className="herotip-live">{powerStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
