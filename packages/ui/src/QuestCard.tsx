import type { CSSProperties } from 'react';
import type { QuestDef } from '@game/core';
import { Icon } from './Icon';
import { questObjectiveText, questRewardText } from './questText';

const TIER_LABEL: Record<QuestDef['tier'], string> = { lesser: 'Lesser', greater: 'Greater', capstone: 'Capstone' };

/**
 * One quest offered in the quest shop — card-sized (slots into the tavern `.row` like a shop card), tribe-hued,
 * and "bought" for 0 Gold on click. Shows the tier + tribe, the quest name, its objective, and its reward.
 */
export function QuestCard({ quest, onBuy }: { quest: QuestDef; onBuy: () => void }) {
  const c = quest.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${quest.tribe})`;
  return (
    <button className="questcard" style={{ '--c': c } as CSSProperties} onClick={onBuy} title={`${quest.name} — take this quest (free)`}>
      <div className="questcard-cost"><Icon name="mana" /><span>0</span></div>
      <div className="questcard-tier">{TIER_LABEL[quest.tier]} · {quest.tribe}</div>
      <div className="questcard-name">{quest.name}</div>
      <div className="questcard-sect">
        <div className="questcard-lbl"><Icon name="star" /> Objective</div>
        <div className="questcard-txt">{questObjectiveText(quest.objective)}</div>
      </div>
      <div className="questcard-sect reward">
        <div className="questcard-lbl"><Icon name="crown" /> Reward</div>
        <div className="questcard-txt">{questRewardText(quest.reward)}</div>
      </div>
    </button>
  );
}
