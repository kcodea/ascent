import { useEffect, useRef, useState } from 'react';
import { Icon } from './Icon';
import { useGame } from './store';

/** Bottom bar, rooted across the whole round: Embers and Resolve flank the hero. */
export function StatusBar() {
  const run = useGame((s) => s.run);
  const heroArmed = useGame((s) => s.heroArmed);
  const armHero = useGame((s) => s.armHero);
  const sellTick = useGame((s) => s.sellTick);
  const canHero = run.heroReady && run.board.length > 0;

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
      <div className="chip g" title="Embers — your gold this wave. Spend on minions (3), Refresh (1), Tier upgrades.">
        <span className="ic"><Icon name="ember" /></span>
        <div>
          <div className="v">{run.embers}</div>
          <div className="l">Embers</div>
        </div>
        {sellTick > 0 && <span className="sellfx" key={sellTick}>+1</span>}
      </div>

      <div
        className={`hero${canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}${canHero && !heroArmed ? ' ready' : ''}`}
        onPointerDown={() => canHero && !heroArmed && armHero()}
      >
        <div className="f"><Icon name="anvil" /></div>
        <div>
          <div className="nm">Warden</div>
          <div className="pw">{heroArmed ? 'Pick a minion…' : 'Fortify · +1/+1'}</div>
        </div>
        <div className="herotip" role="tooltip">
          <b>Fortify</b> — once per wave, give a minion +1/+1.
          {run.heroReady ? ' Drag onto a minion (or click, then click a minion).' : ' Used this wave.'}
        </div>
      </div>

      <div className={`chip h${hit ? ' hit' : ''}`} title="Resolve — your health. Lose it when a wave beats you; at 0 the run ends.">
        <span className="ic"><Icon name="heart" /></span>
        <div>
          <div className="v">{run.resolve}</div>
          <div className="l">Resolve</div>
        </div>
        {hit && <span className="resfx" key={hit.key}>−{hit.amt}</span>}
      </div>
    </div>
  );
}
