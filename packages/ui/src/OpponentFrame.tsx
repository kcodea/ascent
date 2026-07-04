import { getHero, nextOpponent, dominantTribe, THREATS } from '@game/sim';
import { heroArt } from './art';
import { Icon } from './Icon';
import { useGame } from './store';

/** Tribe → display label; pluralized by count (Undead is already plural). "3 Dragons", "1 Mech", "5 Undead". */
const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral',
};
const tribeLabel = (tribe: string, count: number): string =>
  `${TRIBE_LABEL[tribe] ?? tribe}${count === 1 || tribe === 'undead' ? '' : 's'}`;

/**
 * Top-right intel on the board you'll face when you end the turn. A larger plate names the foe (author pill
 * overlapping the top), shows the hero portrait + tavern tier + wins + life(+armor), and — attached below —
 * a board preview: one blacked-out silhouette per enemy minion (count only, no stats), their triple count,
 * and their most-common tribe ("3 Dragons"). Shown in recruit AND combat; firms up as you build, then names
 * the exact board `faceOmen` serves. Falls back to the procedural threat (no hero) when the pool has no match.
 */
export function OpponentFrame() {
  const run = useGame((s) => s.run);
  if (run.phase !== 'recruit' && run.phase !== 'combat') return null;
  const snap = nextOpponent(run);

  if (!snap) {
    const threat = THREATS[run.threat];
    return (
      <div className="oppframe threat" title={`Next foe — ${threat.name} (a wild board, no intel)`}>
        <div className="opp-plate">
          <span className="opp-name">Next Foe</span>
          <div className="opp-pic"><Icon name="skull" /></div>
          <div className="opp-info">
            <div className="opp-hero">{threat.name}</div>
            <div className="opp-life"><Icon name="heart" />?</div>
          </div>
        </div>
        <div className="opp-preview opp-preview-empty">A wild board — no intel</div>
      </div>
    );
  }

  const hero = getHero(snap.heroId);
  const dom = dominantTribe(snap);
  const art = heroArt(snap.heroId);
  const count = snap.minions.length;
  const name = snap.author ?? 'Next Foe';
  const provenance = snap.author
    ? `by ${snap.author}`
    : snap.origin === 'synthetic'
      ? 'Forged board'
      : 'House board';
  return (
    <div className="oppframe" title={`${provenance}${snap.capturedAt ? ` · ${snap.capturedAt}` : ''}`}>
      <div className="opp-plate">
        {/* Author name as a pill overlapping the plate's top edge. */}
        <span className="opp-name">{name}</span>
        <div className="opp-pic">
          {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
        </div>
        <div className="opp-info">
          <div className="opp-hero">{hero.name}</div>
          <div className="opp-meta">
            <span className="opp-tier" title="Tavern tier"><Icon name="star" />{snap.tier}</span>
            <span className="opp-wins" title="Wins"><Icon name="crown" />{snap.wins ?? 0}</span>
          </div>
          <div className="opp-life" title={`Life ${snap.resolve}${snap.armor ? ` · Armor ${snap.armor}` : ''}`}>
            <Icon name="heart" />
            <span className="opp-hp">{snap.resolve}{snap.armor ? <b className="opp-armor">+{snap.armor}</b> : null}</span>
          </div>
        </div>
      </div>
      {/* Board preview — attached below the plate: a blacked-out silhouette per minion (count only), plus
          triple count + most-common tribe. No stats or card identity leaks. */}
      <div className="opp-preview">
        <div className="opp-silhouettes" title={`${count} minion${count === 1 ? '' : 's'} on board`}>
          {count > 0
            ? Array.from({ length: count }, (_, i) => <span key={i} className="opp-sil" />)
            : <span className="opp-sil-empty">Empty board</span>}
        </div>
        {(snap.triples > 0 || dom) && (
          <div className="opp-comp">
            {snap.triples > 0 && (
              <span className="opp-tag" title="Triples formed"><Icon name="star" />{snap.triples}</span>
            )}
            {dom && <span className="opp-tag opp-tribe">{dom.count} {tribeLabel(dom.tribe, dom.count)}</span>}
          </div>
        )}
      </div>
    </div>
  );
}
