import type { Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { mdBold } from './Card';
import { questRewardText } from './questText';
import { questArt, runeArt } from './art';
import { Icon } from './Icon';

/** Each tribe's emblem glyph — the fallback when a quest has no art (mirrors QuestBadges). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star' };

/**
 * Read-only trophy row for a FINISHED run's snapshot — the completed quests + owned runes the player ended with,
 * as small circular badges (art, or a tribe emblem fallback) with the game's standard floating tooltip showing
 * the name + what it granted. Used in the Hall of Champions + Career so you can see what a champion actually
 * built, not just their board. Renders nothing when the snapshot carries no quests/runes (older saves).
 */
export function RunTrophies({ quests, runes }: { quests?: string[]; runes?: string[] }) {
  const qs = (quests ?? []).map((id) => QUEST_INDEX[id]).filter((q): q is NonNullable<typeof q> => !!q);
  const rs = (runes ?? []).map((id) => RUNE_INDEX[id]).filter((r): r is NonNullable<typeof r> => !!r);
  if (qs.length === 0 && rs.length === 0) return null;
  return (
    <div className="runtrophies" aria-label="Quests and runes at the end of the run">
      {rs.map((rune) => {
        const art = runeArt(rune.id);
        return (
          <div className="runtrophy runetrophy" key={`r-${rune.id}`}>
            <div className="runtrophy-inner">
              {art ? <img className="runtrophy-art" src={art} alt="" aria-hidden /> : <span className="runtrophy-emblem" aria-hidden><Icon name="anvil" /></span>}
            </div>
            <div className="runtrophy-tip" role="tooltip">
              <b>{rune.name}</b>
              <span className="runtrophy-tip-body" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
              <span className="runtrophy-tip-kind">Rune</span>
            </div>
          </div>
        );
      })}
      {qs.map((def) => {
        const art = questArt(def.id);
        return (
          <div className="runtrophy" style={{ ['--c' as string]: def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})` }} key={`q-${def.id}`}>
            <div className="runtrophy-inner">
              {art ? <img className="runtrophy-art" src={art} alt="" aria-hidden /> : <span className="runtrophy-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe]} /></span>}
            </div>
            <div className="runtrophy-tip" role="tooltip">
              <b>{def.name}</b>
              <span className="runtrophy-tip-body">{questRewardText(def.reward, { completed: true })}{def.repeatable ? ' · Repeatable' : ''}</span>
              <span className="runtrophy-tip-kind">Quest</span>
            </div>
          </div>
        );
      })}
    </div>
  );
}
