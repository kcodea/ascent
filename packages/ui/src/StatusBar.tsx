import { useEffect, useRef, useState } from 'react';
import { renameTerms } from './terms';
import { getHero, spellAmplifyBonus } from '@game/sim';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { QuestBadges } from './QuestBadges';
import { sfx } from './sfx';
import { useGame } from './store';
import { getHeroPowerBtnConfig } from './heroPowerBtnConfig'; // also reflects the --hpb-* vars at load (side-effect)
import './heroPanelConfig'; // side-effect: reflects the --hpn-* hero-panel transform vars at load

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
  const digCost = power.kind === 'dynamiteDig' ? 1 + (run.heroPowerUses ?? 0) : undefined;
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
    (digCost === undefined || run.embers >= digCost);
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
      case 'lesserQuest': return run.wave < 3 ? `${3 - run.wave}t` : null; // Fi — turns to the errand
      case 'runeforge': return run.wave < 7 && !run.heroPowerSpent ? `${7 - run.wave}t` : null; // Runesmith
      case 'epicRuneforge': return run.epicForgeWave != null && run.wave < run.epicForgeWave ? `${run.epicForgeWave - run.wave}t` : null; // Runeguard
      case 'pathfinder': return run.wave < 10 ? `${10 - run.wave}t` : null; // Coran — turns to the capstone
      case 'dynamiteDig': return `Tier ${run.tier}`; // Jenkins — what the dig would discover
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
            : power.kind === 'pathfinder'
              ? `${power.name} · quests turns 6 & 10`
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
                    ? `${power.name} · ${!run.heroReady ? 'used' : run.embers >= digCost! ? `${digCost} Gold` : `need ${digCost} Gold`}`
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

  return (
    <div className="statusbar">
      {/* Completed-quest trophies — a horizontal row of art circles sitting directly above the hero panel. */}
      <QuestBadges />
      <div className="statusrow">
        <div
          className={`hero${isPassive ? ' passive' : canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
        >
          {/* Player name — a pill eclipsing the top of the hero box (mirrors the opponent name on its frame). */}
          {playerName && <div className="playername" title="You">{playerName}</div>}
          {/* The portrait holds ONLY the hero art; the hero name rides a pill eclipsing its bottom edge (mirrors
              the player-name pill at the top). Health/Armor sits to its right (see `.hpbox` CSS). */}
          <div className="f">
            {heroArt(hero.id) ? (
              <img className="heroimg" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
            <div className="heroname" title={hero.name}>{hero.name}</div>
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
              aria-label={`${power.name} — ${renameTerms(power.text)}`}
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
            {(digCost ?? power.cost) ? <span className="hpcost"><span className="costn">{digCost ?? power.cost}</span></span> : null}
            {/* Keyed on its text so every change replays the compositor-only bump (the Avenge-tally feel). */}
            {powerTally && <span key={powerTally} className="hpb-tally">{powerTally}</span>}
          </div>
          {/* The power NAME now lives in the pill for passives too (mirrors the active-power pill, e.g. Soren's
              Reclaim); the "Passive"/status detail moves to the hover tip below. */}
          <div className="hplabel">{power.name}</div>
          <div className="herotip" role="tooltip">
            <b>{power.name}</b>{isPassive ? ' · passive' : ''}
            <span className="herotip-rule">{renameTerms(power.text)}</span>
            {/* Live status (current magnitude + countdown) on hover — the progress text was removed from the
                always-visible hero box, so it reads here instead. */}
            <span className="herotip-live">{powerStatus}</span>
          </div>
        </div>
      </div>
    </div>
  );
}
