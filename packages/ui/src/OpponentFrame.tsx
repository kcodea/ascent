import type { CSSProperties } from 'react';
import { getHero, nextOpponent, dominantTribe, THREATS } from '@game/sim';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { heroArt, questArt, runeArt } from './art';
import { Icon } from './Icon';
import { mdBold } from './Card';
import { questRewardText } from './questText';
import { useGame } from './store';

/** Tribe → emblem glyph fallback when a quest has no art yet (mirrors QuestBadges). */
const TRIBE_ICON: Record<string, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown' };

/** Tribe → display label; pluralized by count (Undead is already plural). "3 Dragons", "1 Mech", "5 Undead". */
const TRIBE_LABEL: Record<string, string> = {
  beast: 'Beast', dragon: 'Dragon', mech: 'Mech', undead: 'Undead', demon: 'Demon', neutral: 'Neutral', kobold: 'Kobold',
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
      <div className="oppframe threat">
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
  // The opponent's ACTIVE reward trophies (runes bought + quests completed), captured in the snapshot — shown
  // UNDER the frame, mirroring the player's badges above their own frame. Read-only (no live chip — we only
  // know the opponent's state at capture). Filtered to ids this build still knows.
  const oppRunes = (snap.runes ?? []).filter((id) => RUNE_INDEX[id]);
  const oppQuests = (snap.quests ?? []).filter((id) => QUEST_INDEX[id]);
  const name = snap.author ?? 'Next Foe';
  // (The provenance hover tip — "by <author>" — was retired with the rest of the frame's tooltips,
  //  owner note 2026-07-16.)
  return (
    <div className="oppframe">
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
            <span className="opp-stat life">
              <Icon name="heart" />{snap.resolve}{snap.armor ? <i className="opp-armor">+{snap.armor}</i> : null}
            </span>
            <span className="opp-stat label">Tier {snap.tier}</span>
            <span className="opp-stat label">{snap.wins ?? 0} {(snap.wins ?? 0) === 1 ? 'Win' : 'Wins'}</span>
          </div>
        </div>
      </div>
      {/* Board read — one quiet line: triples + the most-common tribe. Hidden entirely when there's neither. */}
      {(snap.triples > 0 || dom) && (
        <div className="opp-preview">
          <div className="opp-compline">
            {snap.triples > 0 && <span>{snap.triples} Triple{snap.triples === 1 ? '' : 's'}</span>}
            {snap.triples > 0 && dom && ' · '}
            {dom && (
              <span className="opp-tribe" style={{ '--tc': `var(--t-${dom.tribe})` } as CSSProperties}>
                {dom.count} {tribeLabel(dom.tribe, dom.count)}
              </span>
            )}
          </div>
        </div>
      )}
      {/* Opponent's active reward trophies — runes bought + quests completed — a row of circular badges UNDER
          the frame, mirroring the player's completed-quest badges above their own hero panel. */}
      {(oppRunes.length > 0 || oppQuests.length > 0) && (
        <div className="oppbadges">
          {oppRunes.map((id) => {
            const rune = RUNE_INDEX[id]!;
            const rart = runeArt(rune.id);
            return (
              <div className="questbadge runebadge" key={`r:${id}`}>
                {rart
                  ? <img className="questbadge-art" src={rart} alt="" aria-hidden />
                  : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
                <div className="questbadge-tip" role="tooltip">
                  <b>{rune.name}</b>
                  <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
                  <span className="questbadge-tip-state">Rune · active</span>
                </div>
              </div>
            );
          })}
          {oppQuests.map((id) => {
            const def = QUEST_INDEX[id]!;
            const qart = questArt(def.id);
            const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
            return (
              <div className="questbadge" style={{ '--c': c } as CSSProperties} key={`q:${id}`}>
                {qart
                  ? <img className="questbadge-art" src={qart} alt="" aria-hidden />
                  : <span className="questbadge-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe] ?? 'star'} /></span>}
                <div className="questbadge-tip" role="tooltip">
                  <b>{def.name}</b>
                  <span className="questbadge-tip-reward">{questRewardText(def.reward, { completed: true })}{def.repeatable ? ' · Repeatable' : ''}</span>
                  <span className="questbadge-tip-state">Quest · complete</span>
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
