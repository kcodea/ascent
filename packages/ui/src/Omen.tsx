import { makeRng } from '@game/core';
import { THREATS, buildEnemyBoard, mixSeed, TAG, type ThreatId } from '@game/sim';
import { Icon } from './Icon';
import { Sprite } from './Sprite';
import { useGame } from './store';

const THREAT_ICON: Record<ThreatId, string> = {
  venom: 'poison', iron: 'shield', horde: 'cleave', glass: 'sword', undying: 'refresh',
};

export function Omen() {
  const run = useGame((s) => s.run);
  const threat = THREATS[run.threat];
  // Same derivation the reducer uses, so the preview equals the actual fight.
  const enemies = buildEnemyBoard(run.threat, run.wave, makeRng(mixSeed(run.seed, run.wave, TAG.ENEMY)));

  return (
    <div className="omen">
      <div className="osig"><Icon name={THREAT_ICON[run.threat]} /></div>
      <div className="ob">
        <div className="oey">Incoming Omen · Wave {run.wave}</div>
        <div className="onm disp">{threat.name}</div>
        <div className="ode">{threat.description}</div>
        <div className="oc">
          <span className="k">Answered by</span>
          {threat.answeredBy.map((t) => (
            <span className="cc" key={t} style={{ background: `var(--t-${t})` }}>
              {t}
            </span>
          ))}
        </div>
      </div>
      <div className="prev">
        <span className="pl">Enemy board · {enemies.length}</span>
        <div className="pr">
          {enemies.slice(0, 7).map((e, i) => (
            <div className="eu" key={i}>
              {e.keywords?.includes('P') && (
                <span className="pz"><Icon name="poison" /></span>
              )}
              <Sprite name="undead" scale={2} />
              <span className="s">
                {e.attack}/{e.health}
              </span>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}
