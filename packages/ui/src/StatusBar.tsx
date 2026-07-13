import { useEffect, useRef, useState } from 'react';
import { getHero, spellAmplifyBonus } from '@game/sim';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { QuestBadges } from './QuestBadges';
import { sfx } from './sfx';
import { useGame } from './store';

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
  const powerNote = isPassive
    ? power.kind === 'spellAmplify'
      ? ` Passive — your spells gain +${spellAmplifyBonus(run.spellsCast)}/+${spellAmplifyBonus(run.spellsCast)}. ${run.spellsCast % 10}/10 spells cast toward the next +1/+1.`
      : power.kind === 'recurringGoldcrafter'
        ? ` Passive — a Goldcrafter arrives in your hand every 4 turns${run.wave % 4 === 0 ? ' (one this turn)' : ` (next in ${4 - (run.wave % 4)})`}.`
        : ' Passive — always on.'
    : !unlocked
      ? ` Unlocks on turn ${unlockWave}.`
      : power.kind === 'gild'
        ? run.heroPowerSpent
          ? ` Recharging — ${gildSpent}/40 Gold spent since your last Gild.`
          : ' Drag onto a friendly minion (or click, then click it). Refreshes after you spend 40 Gold.'
        : power.kind === 'scalingGold'
          ? run.heroPowerSpent
            ? ' Already used this game.'
            : ` Click to gain ${1 + run.wave} Gold — the payout grows +1 each turn you wait. One use per game.`
        : power.oncePerGame
          ? run.heroPowerSpent
            ? ' Already used this game.'
            : ' Drag onto a friendly minion (or click, then click it). One use per game.'
          : run.heroReady
            ? power.untargeted
              ? ` Click to use.${power.cost ? ` Costs ${power.cost} Gold.` : ''}`
              : ' Drag onto a minion (or click, then click a minion).'
            : ' Used this wave.';
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
      {/* Player name — a small white box above the hero panel (mirrors the opponent name, top-right). */}
      {playerName && <div className="playername" title="You">{playerName}</div>}
      {/* Completed-quest trophies — a horizontal row of art circles sitting directly above the hero panel. */}
      <QuestBadges />
      <div className="statusrow">
        <div
          className={`hero${isPassive ? ' passive' : canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
        >
          <div className="f">
            {heroArt(hero.id) ? (
              <img className="heroimg" src={heroArt(hero.id)} alt={hero.name} draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
          </div>
          <div className="htxt">
            <div className="nm">{hero.name}</div>
            <div className="pw">{powerLine}</div>
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
              aria-label={`${power.name} — ${power.text}`}
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
              {heroPowerArt(hero.id) ? <img src={heroPowerArt(hero.id)} alt="" draggable={false} /> : <Icon name="sc" />}
            </button>
            {(digCost ?? power.cost) ? <span className="hpcost"><span className="costn">{digCost ?? power.cost}</span></span> : null}
          </div>
          <div className="hplabel">{isPassive ? 'Passive' : power.name}</div>
          <div className="herotip" role="tooltip">
            <b>{power.name}</b> — {power.text}
            {powerNote}
          </div>
        </div>
      </div>
    </div>
  );
}
