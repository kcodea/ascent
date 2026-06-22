import { useEffect, useRef, useState } from 'react';
import { CONFIG, boardManaBonus, getHero, spellAmplifyBonus } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
  const heroArmed = useGame((s) => s.heroArmed);
  const armHero = useGame((s) => s.armHero);
  const sellTick = useGame((s) => s.sellTick);
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
  const canHero = !isPassive && unlocked && (power.oncePerGame ? !run.heroPowerSpent : run.heroReady);
  // The big line under the hero name: what tapping the power does *right now*.
  const powerLine = isPassive
    ? power.kind === 'spellAmplify'
      ? `${power.name} · +${spellAmplifyBonus(run.wave)}/+${spellAmplifyBonus(run.wave)} spells`
      : power.kind === 'quest'
        ? `${power.name} · ${run.heroPowerSpent ? 'complete' : `${run.drakkoBuys}/5`}`
        : `${power.name} · passive`
    : heroArmed
      ? 'Pick a minion…'
      : !unlocked
        ? `${power.name} · unlocks turn ${unlockWave}`
        : power.kind === 'fortify'
          ? `${power.name} · +${run.tier}/+${run.tier}`
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
          ? ' Drag onto a minion (or click, then click a minion).'
          : ' Used this wave.';
  // Projected starting Embers for the next two waves (each wave grows maxEmbers by
  // embersPerWave, capped), plus any board mana income (Money Bot) on top of the cap —
  // assuming the source stays on board.
  const manaBonus = boardManaBonus(run);
  const nextEmbers = Math.min(CONFIG.embersCap, run.maxEmbers + CONFIG.embersPerWave) + manaBonus;
  const afterEmbers = Math.min(CONFIG.embersCap, run.maxEmbers + 2 * CONFIG.embersPerWave) + manaBonus;
  const hpPct = Math.max(0, Math.min(100, (run.resolve / run.maxResolve) * 100));

  // When Resolve drops (a wave broke through), shake the chip + float the −X.
  const prevResolve = useRef(run.resolve);
  const [hit, setHit] = useState<{ amt: number; key: number } | null>(null);
  useEffect(() => {
    const prev = prevResolve.current;
    prevResolve.current = run.resolve;
    if (run.resolve < prev) {
      setHit({ amt: prev - run.resolve, key: prev });
      const t = window.setTimeout(() => setHit(null), 1100);
      return () => window.clearTimeout(t);
    }
    return undefined;
  }, [run.resolve]);

  return (
    <div className="statusbar">
      <div className="statusrow">
        <div className="chip g mana">
          <span className="ic"><Icon name="mana" /></span>
          <div>
            <div className="v">{run.embers}</div>
            <div className="l">Mana</div>
          </div>
          {sellTick > 0 && <span className="sellfx" key={sellTick}>+1</span>}
          {/* hover: how much Mana you'll start the next two waves with (cascading up) */}
          <div className="emberproj" role="tooltip">
            <div className="ept">Mana · coming up</div>
            <div className="epr"><span>Wave {run.wave + 2}</span><b><Icon name="mana" />{afterEmbers}</b></div>
            <div className="epr"><span>Wave {run.wave + 1}</span><b><Icon name="mana" />{nextEmbers}</b></div>
          </div>
        </div>

        <div
          className={`hero${isPassive ? ' passive' : canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
          onPointerDown={() => !isPassive && canHero && !heroArmed && armHero()}
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
          <div className="herotip" role="tooltip">
            <b>{power.name}</b> — {power.text}
            {powerNote}
          </div>
        </div>
      </div>

      {/* Resolve as an HP bar across the bottom: red heart on the left, current health on the right. */}
      <div className={`hprow${hit ? ' hit' : ''}`} aria-label={`Resolve: ${run.resolve} of ${run.maxResolve}`}>
        <span className="ic"><Icon name="heart" /></span>
        <div className="hpbar"><i style={{ width: `${hpPct}%` }} /></div>
        <span className="hpval">{run.resolve}</span>
        {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
      </div>
    </div>
  );
}
