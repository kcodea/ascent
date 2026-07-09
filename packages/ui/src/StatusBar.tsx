import { useEffect, useRef, useState } from 'react';
import { getHero, spellAmplifyBonus } from '@game/sim';
import { CARD_INDEX } from '@game/content';
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
  // Once-per-game powers (Gild) gate on heroPowerSpent; the rest recharge each wave. Fortify can
  // target a warband minion OR a tavern offer, so it's usable whenever ready — no friend required.
  // Gildmaster's Golden Gild also has a whole-game use cap (maxUses) AND needs a "double" (two non-golden
  // copies of a minion across board + hand) to fire — otherwise it's greyed out.
  const withinUses = power.maxUses ? (run.heroPowerUses ?? 0) < power.maxUses : true;
  const doubleAvailable =
    power.kind !== 'goldenGild' ||
    (() => {
      const counts = new Map<string, number>();
      for (const c of [...run.board, ...run.hand]) {
        if (!c.golden && !CARD_INDEX[c.cardId]?.spell) counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
      }
      return [...counts.values()].some((n) => n >= 2);
    })();
  const canHero =
    !isPassive &&
    unlocked &&
    !eotAnimating &&
    withinUses &&
    doubleAvailable &&
    (power.oncePerGame ? !run.heroPowerSpent : run.heroReady) &&
    (!power.cost || run.embers >= power.cost);
  // The big line under the hero name: what tapping the power does *right now*.
  const powerLine = isPassive
    ? power.kind === 'spellAmplify'
      ? `${power.name} · +${spellAmplifyBonus(run.spellsCast)}/+${spellAmplifyBonus(run.spellsCast)} spells`
      : power.kind === 'quest'
        ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.drakkoBuys}/5`}`
        : power.kind === 'questChronos'
          ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.eotMinionBuys ?? 0}/4`}`
          : power.kind === 'collision'
            ? `${power.name} · ${Math.min(5, run.cassenKills + combatEnemyDeaths)}/5`
            : `${power.name} · passive`
    : heroArmed
      ? 'Pick a minion…'
      : !unlocked
        ? `${power.name} · unlocks turn ${unlockWave}`
        : power.kind === 'fortify'
          ? `${power.name} · +${run.tier}/+${run.tier}`
          : power.kind === 'gainMaxMana'
            ? `${power.name} · ${!run.heroReady ? 'used' : run.embers >= (power.cost ?? 0) ? `${power.cost} Gold` : `need ${power.cost} Gold`}`
            : power.kind === 'goldenGild'
              ? `${power.name} · ${!withinUses ? 'spent' : !run.heroReady ? 'used' : !doubleAvailable ? 'no pair' : run.embers >= (power.cost ?? 0) ? `${power.cost} Gold` : `need ${power.cost} Gold`}`
              : power.kind === 'gild'
                ? `${power.name} · ${run.heroPowerSpent ? 'spent' : 'once per game'}`
                : `${power.name} · ${run.heroReady ? 'once per turn' : 'used'}`;
  const powerNote = isPassive
    ? ' Passive — always on.'
    : !unlocked
      ? ` Unlocks on turn ${unlockWave}.`
      : power.kind === 'goldenGild'
        ? !withinUses
          ? ' Used up — twice per game.'
          : !run.heroReady
            ? ' Used this turn.'
            : !doubleAvailable
              ? ' Need two copies of a minion to gild.'
              : ` Click to combine a pair into a Gilded copy.${power.cost ? ` Costs ${power.cost} Gold.` : ''}`
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
          {/* Hero-power button — the ONLY trigger for an active power (clicking the frame does nothing). A PASSIVE
              hero still gets the button (so every hero shows its power art) but it doesn't glow + isn't clickable.
              Placeholder glyph for now; an untargeted power fires on click, a targeted one arms (then aim).
              Wrapped in .hpwrap so the gold-cost badge can sit below the circle without being clipped. */}
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
                if (power.untargeted) dispatch({ type: 'heroPower' });
                else armHero();
              }}
            >
              {heroPowerArt(hero.id) ? <img src={heroPowerArt(hero.id)} alt="" draggable={false} /> : <Icon name="sc" />}
            </button>
            {power.cost ? <span className="hpcost"><Icon name="mana" />{power.cost}</span> : null}
          </div>
          {/* Health as a compact white box beside the hero power — the number is Resolve (+Armor). Replaces the
              old HP bar; keeps the hit-shake + −X float when a wave breaks through. */}
          <div
            className={`hpbox${hit ? ' hit' : ''}`}
            title={`Resolve: ${run.resolve} of ${run.maxResolve}${run.maxArmor ? ` · Armor ${run.armor} of ${run.maxArmor}` : ''}`}
          >
            <Icon name="heart" />
            <span className="hpval">{run.resolve}{run.armor > 0 && <b className="armval" title="Armor — extra effective HP">+{run.armor}</b>}</span>
            {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
          </div>
          <div className="herotip" role="tooltip">
            <b>{power.name}</b> — {power.text}
            {powerNote}
          </div>
        </div>
      </div>
    </div>
  );
}
