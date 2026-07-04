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
 * Top-right intel on the board you'll face when you end the turn — deliberately minimal. One card, one
 * left gutter: the author-name pill centered over the top edge, then portrait + hero name with a single
 * stat row (life+armor · tier · wins — one size, life emphasized by color only), a hairline, and the board
 * preview (a grey silhouette per enemy minion, count only) over a quiet one-line comp read ("2 Triples ·
 * 3 Dragons", tribe word tinted). ★ = tier ONLY; triples are text. Falls back to the procedural threat
 * (no hero) when the pool has no match. Shown in recruit AND combat.
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
            <div className="opp-stats"><span className="opp-stat life"><Icon name="heart" />?</span></div>
          </div>
        </div>
        <div className="opp-preview"><div className="opp-compline">A wild board — no intel</div></div>
      </div>
    );
  }

  const hero = getHero(snap.heroId);
  const dom = dominantTribe(snap);
  const art = heroArt(snap.heroId);
  const name = snap.author ?? 'Next Foe';
  const provenance = snap.author
    ? `by ${snap.author}`
    : snap.origin === 'synthetic'
      ? 'Forged board'
      : 'House board';
  return (
    <div className="oppframe" title={`${provenance}${snap.capturedAt ? ` · ${snap.capturedAt}` : ''}`}>
      <div className="opp-plate">
        {/* Author name — a pill centered over the top edge (symmetric, deliberate). */}
        <span className="opp-name">{name}</span>
        <div className="opp-pic">
          {art ? <img src={art} alt={hero.name} draggable={false} /> : <Icon name="anvil" />}
        </div>
        <div className="opp-info">
          <div className="opp-hero">{hero.name}</div>
          {/* One stat row, one size: life(+armor) · tier · wins. Life leads and is colored, not enlarged. */}
          <div className="opp-stats">
            <span className="opp-stat life" title={`Life ${snap.resolve}${snap.armor ? ` · Armor ${snap.armor}` : ''}`}>
              <Icon name="heart" />{snap.resolve}{snap.armor ? <i className="opp-armor">+{snap.armor}</i> : null}
            </span>
            <span className="opp-stat" title="Tavern tier"><Icon name="star" />{snap.tier}</span>
            <span className="opp-stat" title="Wins"><Icon name="crown" />{snap.wins ?? 0}</span>
          </div>
        </div>
      </div>
      {/* Board read — one quiet line: triples + the most-common tribe. Hidden entirely when there's neither. */}
      {(snap.triples > 0 || dom) && (
        <div className="opp-preview">
          <div className="opp-compline">
            {snap.triples > 0 && <span title="Triples formed">{snap.triples} Triple{snap.triples === 1 ? '' : 's'}</span>}
            {snap.triples > 0 && dom && ' · '}
            {dom && (
              <span className="opp-tribe" style={{ '--tc': `var(--t-${dom.tribe})` } as CSSProperties}>
                {dom.count} {tribeLabel(dom.tribe, dom.count)}
              </span>
            )}
          </div>
        </div>
      )}
    </div>
  );
}
