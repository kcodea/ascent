import { useEffect, useRef, useState } from 'react';
import { CONFIG } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
  const heroArmed = useGame((s) => s.heroArmed);
  const armHero = useGame((s) => s.armHero);
  const sellTick = useGame((s) => s.sellTick);
  // Fortify can target a warband minion OR a tavern offer, so it's usable whenever it's
  // ready — no friend on board required (you can buff a shop minion).
  const canHero = run.heroReady;
  // Projected starting Embers for the next two waves (each wave grows maxEmbers by
  // embersPerWave, capped). Base curve only for now — future cards will modify this.
  const nextEmbers = Math.min(CONFIG.embersCap, run.maxEmbers + CONFIG.embersPerWave);
  const afterEmbers = Math.min(CONFIG.embersCap, run.maxEmbers + 2 * CONFIG.embersPerWave);
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
        <div className="chip g">
          <span className="ic"><Icon name="ember" /></span>
          <div>
            <div className="v">{run.embers}</div>
            <div className="l">Embers</div>
          </div>
          {sellTick > 0 && <span className="sellfx" key={sellTick}>+1</span>}
          {/* hover: how many Embers you'll start the next two waves with (cascading up) */}
          <div className="emberproj" role="tooltip">
            <div className="ept">Embers · coming up</div>
            <div className="epr"><span>Wave {run.wave + 2}</span><b><Icon name="ember" />{afterEmbers}</b></div>
            <div className="epr"><span>Wave {run.wave + 1}</span><b><Icon name="ember" />{nextEmbers}</b></div>
          </div>
        </div>

        <div
          className={`hero${canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
          onPointerDown={() => canHero && !heroArmed && armHero()}
        >
          <div className="f">
            {heroArt('warden') ? (
              <img className="heroimg" src={heroArt('warden')} alt="Warden" draggable={false} />
            ) : (
              <Icon name="anvil" />
            )}
          </div>
          <div>
            <div className="nm">Warden</div>
            <div className="pw">{heroArmed ? 'Pick a minion…' : 'Fortify · +1/+1'}</div>
          </div>
          <div className="herotip" role="tooltip">
            <b>Fortify</b> — once per wave, give a minion +1/+1.
            {run.heroReady ? ' Drag onto a minion (or click, then click a minion).' : ' Used this wave.'}
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
