import type { CSSProperties } from 'react';
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
 * Top-right intel on the board you'll face when you end the turn. A compact plate — author-name pill
 * overlapping the top, hero portrait, hero name with tier ★ + wins 👑 under it, and LIFE(+armor) big in the
 * top-right (the lethal-math number gets the power position) — with a preview strip attached below: one
 * blacked-out silhouette per enemy minion (count only, no stats), a gold triples tag, and the most-common
 * tribe tinted in its tribe hue. ★ means tier ONLY (triples are a text tag) so no icon carries two meanings.
 * Shown in recruit AND combat; falls back to the procedural threat (no hero) when the pool has no match.
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
            <div className="opp-toprow">
              <span className="opp-hero">{threat.name}</span>
              <span className="opp-life"><Icon name="heart" /><span className="opp-hp">?</span></span>
            </div>
            <div className="opp-meta">A wild board — no intel</div>
          </div>
        </div>
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
          <div className="opp-toprow">
            <span className="opp-hero">{hero.name}</span>
            <span className="opp-life" title={`Life ${snap.resolve}${snap.armor ? ` · Armor ${snap.armor}` : ''}`}>
              <Icon name="heart" />
              <span className="opp-hp">{snap.resolve}{snap.armor ? <b className="opp-armor">+{snap.armor}</b> : null}</span>
            </span>
          </div>
          <div className="opp-meta">
            <span className="opp-tier" title="Tavern tier"><Icon name="star" />{snap.tier}</span>
            <span className="opp-wins" title="Wins"><Icon name="crown" />{snap.wins ?? 0}</span>
          </div>
        </div>
      </div>
      {/* Board preview — one strip: a blacked-out silhouette per minion (count only, no identity leaks),
          with the comp tags (triples · top tribe) right-aligned; wraps under only on the widest boards. */}
      <div className="opp-preview">
        <div className="opp-silhouettes" title={`${count} minion${count === 1 ? '' : 's'} on board`}>
          {count > 0
            ? Array.from({ length: count }, (_, i) => <span key={i} className="opp-sil" />)
            : <span className="opp-sil-empty">Empty board</span>}
        </div>
        {(snap.triples > 0 || dom) && (
          <div className="opp-comp">
            {snap.triples > 0 && <span className="opp-tag gold" title="Triples formed">{snap.triples} Triple{snap.triples === 1 ? '' : 's'}</span>}
            {dom && (
              <span
                className="opp-tag tribe"
                style={{ '--tc': `var(--t-${dom.tribe})` } as CSSProperties}
              >
                {dom.count} {tribeLabel(dom.tribe, dom.count)}
              </span>
            )}
          </div>
        )}
      </div>
    </div>
  );
}
