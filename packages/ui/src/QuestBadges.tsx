import type { CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { questArt } from './art';
import { questRewardText } from './questText';
import { useGame } from './store';

/** Each tribe's emblem glyph — the fallback when a quest has no art yet (mirrors QuestCard). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star' };

/**
 * Completed-quest trophies — a horizontal row of circular badges sitting ABOVE the hero panel (in the
 * StatusBar). A quest moves here from the QuestPanel the moment it completes; the circle shows its art
 * (or its tribe emblem as a fallback), and hovering floats the reward's LIVE ongoing state — Warm Embers'
 * Shouts remaining, Trail Rations' repeat countdown, else the reward it granted.
 */
export function QuestBadges() {
  const run = useGame((s) => s.run);
  const done = (run.activeQuests ?? []).filter((aq) => aq.completed && QUEST_INDEX[aq.questId]);
  const runes = (run.ownedRunes ?? []).filter((id) => RUNE_INDEX[id]);
  if (done.length === 0 && runes.length === 0) return null;
  return (
    <div className="questbadges">
      {/* Runes bought in the Runeforge — a stone-toned badge sitting alongside completed quests. */}
      {runes.map((id) => {
        const rune = RUNE_INDEX[id]!;
        return (
          <div className="questbadge runebadge" key={id}>
            <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>
            <div className="questbadge-tip" role="tooltip">
              <b>{rune.name}</b>
              <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
              <span className="questbadge-tip-state">Rune · active</span>
            </div>
          </div>
        );
      })}
      {done.map((aq) => {
        const def = QUEST_INDEX[aq.questId]!;
        const r = def.reward;
        const art = questArt(def.id);
        const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
        // The live ongoing chip, mirroring the QuestPanel: Shouts used, repeat countdown, else nothing.
        const charges = run.shoutDoubleCharges ?? 0;
        const repeatTurns = run.pendingQuestRewards?.find((p) => p.questId === aq.questId)?.turnsLeft ?? 0;
        let chip = '';
        let ongoing = false;
        if (r.kind === 'shoutDouble') { chip = `${r.count - charges}/${r.count} used`; ongoing = charges > 0; }
        else if (r.kind === 'grant' && r.repeatInTurns) { ongoing = repeatTurns > 0; if (ongoing) chip = `↻ ${repeatTurns}t`; }
        const rewardTxt = questRewardText(r, { completed: true, shoutCharges: charges, repeatTurns });
        return (
          <div className={`questbadge${ongoing ? ' ongoing' : ''}`} style={{ '--c': c } as CSSProperties} key={aq.questId}>
            {art ? (
              <img className="questbadge-art" src={art} alt="" aria-hidden />
            ) : (
              <span className="questbadge-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe]} /></span>
            )}
            {chip && <span className="questbadge-chip">{chip}</span>}
            <div className="questbadge-tip" role="tooltip">
              <b>{def.name}</b>
              <span className="questbadge-tip-reward">{rewardTxt}{def.repeatable ? ' · Repeatable' : ''}</span>
              {chip && <span className="questbadge-tip-state">{ongoing ? 'Active' : 'Done'} · {chip}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
