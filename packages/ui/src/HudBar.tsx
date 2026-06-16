import { Icon } from './Icon';
import { useGame } from './store';

export function HudBar() {
  const run = useGame((s) => s.run);
  const heroArmed = useGame((s) => s.heroArmed);
  const armHero = useGame((s) => s.armHero);
  const canHero = run.heroReady && run.board.length > 0;
  return (
    <div className="bar">
      <div className="wm disp">ASCENT</div>
      <div className="alt">
        <span className="lbl">Altitude</span>
        <span className="w">WAVE {run.wave}</span>
        <span className="meter">
          <i style={{ width: `${Math.min(100, run.wave * 8)}%` }} />
        </span>
        <span className="lbl">Best {run.best}</span>
      </div>
      <div className="sp" />
      <div className="chip g" title="Embers — your gold this wave. Spend on minions (3), Refresh (1), Tier upgrades.">
        <span className="ic"><Icon name="ember" /></span>
        <div>
          <div className="v">{run.embers}</div>
          <div className="l">Embers</div>
        </div>
      </div>
      <div className="chip h" title="Resolve — your health. Lose it when a wave beats you; at 0 the run ends.">
        <span className="ic"><Icon name="heart" /></span>
        <div>
          <div className="v">{run.resolve}</div>
          <div className="l">Resolve</div>
        </div>
      </div>
      <div
        className={`hero${canHero ? '' : ' spent'}${heroArmed ? ' armed' : ''}`}
        title="Hero Power — Temper: once per wave, give a minion +1/+1. Click, then click a minion."
        onClick={() => canHero && armHero()}
      >
        <div className="f"><Icon name="anvil" /></div>
        <div>
          <div className="nm">Forgewarden</div>
          <div className="pw">{heroArmed ? 'Pick a minion…' : 'Temper · +1/+1'}</div>
        </div>
      </div>
    </div>
  );
}
