import { useEffect, useRef, useState } from 'react';
import { CONFIG, boardManaBonus, getHero, spellAmplifyBonus } from '@game/sim';
import { heroArt, heroPowerArt } from './art';
import { Icon } from './Icon';
import { sfx } from './sfx';
import { useGame } from './store';

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
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
  const canHero =
    !isPassive &&
    unlocked &&
    !eotAnimating &&
    (power.oncePerGame ? !run.heroPowerSpent : run.heroReady) &&
    (!power.cost || run.embers >= power.cost);
  // The big line under the hero name: what tapping the power does *right now*.
  const powerLine = isPassive
    ? power.kind === 'spellAmplify'
      ? `${power.name} · +${spellAmplifyBonus(run.wave)}/+${spellAmplifyBonus(run.wave)} spells`
      : power.kind === 'quest'
        ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.drakkoBuys}/5`}`
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
            : power.kind === 'gild'
              ? `${power.name} · ${run.heroPowerSpent ? 'spent' : 'once per game'}`
              : `${power.name} · ${run.heroReady ? 'once per turn' : 'used'}`;
  const powerNote = isPassive
    ? ' Passive — always on.'
    : !unlocked
      ? ` Unlocks on turn ${unlockWave}.`
      : power.oncePerGame
        ? run.heroPowerSpent
          ? ' Already used this game.'
          : ' Drag onto a friendly minion (or click, then click it). One use per game.'
        : run.heroReady
          ? power.untargeted
            ? ` Click to use.${power.cost ? ` Costs ${power.cost} Gold.` : ''}`
            : ' Drag onto a minion (or click, then click a minion).'
          : ' Used this wave.';
  // Projected starting Embers for the next two waves (each wave grows maxEmbers by
  // embersPerWave, capped), plus any board mana income (Money Bot) on top of the cap —
  // assuming the source stays on board.
  const manaBonus = boardManaBonus(run);
  // Hoarder's Battlecry banks Gold for next turn only — fold it into the Wave+1 projection (not Wave+2).
  const nextEmbers = Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + CONFIG.embersPerWave)) + manaBonus + (run.bonusEmbersNextTurn ?? 0);
  const afterEmbers = Math.max(run.maxEmbers, Math.min(CONFIG.embersCap, run.maxEmbers + 2 * CONFIG.embersPerWave)) + manaBonus;
  // The HP bar shows Resolve + Armor stacked over a shared capacity (maxResolve + maxArmor), so Armor reads as
  // the extra HP layer on top: the red Resolve fill, then the steel Armor fill, then the empty track.
  const hpCap = Math.max(1, run.maxResolve + run.maxArmor);
  const hpPct = Math.max(0, Math.min(100, (run.resolve / hpCap) * 100));
  const armPct = Math.max(0, Math.min(100, (run.armor / hpCap) * 100));

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
      <div className="statusrow">
        <div className="chip g mana">
          <span className="ic"><Icon name="mana" /></span>
          <div>
            <div className="v">{run.embers}</div>
            <div className="l">Gold</div>
          </div>
          {/* hover: how much Gold you'll start the next two waves with (cascading up) */}
          <div className="emberproj" role="tooltip">
            <div className="ept">Gold · coming up</div>
            <div className="epr"><span>Wave {run.wave + 2}</span><b><Icon name="mana" />{afterEmbers}</b></div>
            <div className="epr"><span>Wave {run.wave + 1}</span><b><Icon name="mana" />{nextEmbers}</b></div>
          </div>
        </div>

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
          <div className="herotip" role="tooltip">
            <b>{power.name}</b> — {power.text}
            {powerNote}
          </div>
        </div>
      </div>

      {/* Resolve as an HP bar across the bottom: red heart on the left, current health on the right. Armor
          (when the hero has any) stacks as a steel segment on top of the red Resolve fill. */}
      <div className={`hprow${hit ? ' hit' : ''}`} aria-label={`Resolve: ${run.resolve} of ${run.maxResolve}${run.maxArmor ? ` · Armor ${run.armor} of ${run.maxArmor}` : ''}`}>
        <span className="ic"><Icon name="heart" /></span>
        <div className="hpbar">
          <i style={{ width: `${hpPct}%` }} />
          {run.maxArmor > 0 && <i className="arm" style={{ width: `${armPct}%` }} />}
        </div>
        <span className="hpval">{run.resolve}{run.armor > 0 && <b className="armval" title="Armor — extra effective HP">+{run.armor}</b>}</span>
        {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
      </div>
    </div>
  );
}
