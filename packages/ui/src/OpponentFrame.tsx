import { getHero, nextOpponent, dominantTribe, THREATS } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/**
 * Top-right intel on the board you'll face when you end the turn: the next opponent's hero portrait + HP,
 * with tavern tier / triples / top tribe on hover. Shows a real captured board when the pool has a
 * wave/power match; otherwise the procedural threat (no hero) as a light telegraph. Recruit-phase only —
 * it previews exactly what `faceOmen` will serve at the current board power, so it firms up as you build.
 */
export function OpponentFrame() {
  const run = useGame((s) => s.run);
  if (run.phase !== 'recruit') return null;
  const snap = nextOpponent(run);

  if (!snap) {
    const threat = THREATS[run.threat];
    return (
      <div className="oppframe threat" title={`Next foe — ${threat.name}`}>
        <span className="opp-l">Next</span>
        <div className="opp-pic"><Icon name="skull" /></div>
        <span className="opp-hp"><Icon name="heart" />?</span>
        <div className="opp-tip" role="tooltip">
          <b>{threat.name}</b>
          <div>A wild board — no intel</div>
        </div>
      </div>
    );
  }

  const hero = getHero(snap.heroId);
  const dom = dominantTribe(snap);
  const art = heroArt(snap.heroId);
  return (
    <div className="oppframe">
      <span className="opp-l">Next</span>
      <div className="opp-pic">
        {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
      </div>
      <span className="opp-hp"><Icon name="heart" />{snap.resolve}</span>
      <div className="opp-tip" role="tooltip">
        <b>{hero.name}</b> — {snap.resolve} HP
        <div>Tavern tier {snap.tier}</div>
        <div>
          {snap.triples} triple{snap.triples === 1 ? '' : 's'}
          {dom ? `, ${dom.count} ${dom.tribe}` : ''}
        </div>
      </div>
    </div>
  );
}
