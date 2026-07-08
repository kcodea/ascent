import type { CSSProperties } from 'react';
import type { QuestDef, Tribe } from '@game/core';
import { Icon } from './Icon';
import { questArt } from './art';
import { questObjectiveText, questRewardText } from './questText';

const TIER_LABEL: Record<QuestDef['tier'], string> = { lesser: 'Lesser', greater: 'Greater', capstone: 'Capstone' };
/** Each tribe's emblem glyph — the canonical set (mirrors Card.tsx's footer icons). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star' };

/**
 * One quest offered in the quest shop — an art-forward, tribe-framed card: a top tribe emblem, crisp full-bleed
 * art, dark objective/reward panels, and a bottom gem. "Bought" for 0 Gold on click; slots into the tavern `.row`.
 */
export function QuestCard({ quest, onBuy }: { quest: QuestDef; onBuy: () => void }) {
  const c = quest.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${quest.tribe})`;
  const art = questArt(quest.id);
  return (
    <button className={`questcard${art ? ' has-art' : ''}`} style={{ '--c': c } as CSSProperties} onClick={onBuy} title={`${quest.name} — take this quest (free)`}>
      {art && <img className="questcard-art" src={art} alt="" aria-hidden />}
      <span className="questcard-emblem" aria-hidden><Icon name={TRIBE_ICON[quest.tribe]} /></span>
      <div className="questcard-head">
        <div className="questcard-tier">{TIER_LABEL[quest.tier]} · {quest.tribe}</div>
        <div className="questcard-name">{quest.name}</div>
      </div>
      <div className="questcard-body">
        <div className="questcard-sect">
          <div className="questcard-lbl"><Icon name="target" /> Objective</div>
          <div className="questcard-txt">{questObjectiveText(quest.objective)}</div>
        </div>
        <div className="questcard-sect reward">
          <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
          <div className="questcard-txt">{questRewardText(quest.reward)}</div>
        </div>
      </div>
      <span className="questcard-gem" aria-hidden />
    </button>
  );
}
