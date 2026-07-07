import { useState } from 'react';
import { QUEST_INDEX } from '@game/content';
import { Icon } from './Icon';
import { questObjectiveText, questProgressText, questRewardText } from './questText';
import { useGame } from './store';

/**
 * Active-quests window (top-left, under the Buffs frame) — the quests you've taken this run + their LIVE
 * objective progress. Mirrors BuffsFrame (collapsible, absolutely positioned, only rendered when non-empty).
 */
export function QuestPanel() {
  const run = useGame((s) => s.run);
  const [collapsed, setCollapsed] = useState(false);
  const quests = (run.activeQuests ?? []).filter((aq) => QUEST_INDEX[aq.questId]);
  if (quests.length === 0) return null;
  return (
    <div className="questframe">
      <button className="buffs-head" onClick={() => setCollapsed((c) => !c)} title="Active quests">
        <Icon name="star" />
        <span className="buffs-title">Quests</span>
        {collapsed && <span className="buffs-count">{quests.length}</span>}
        <span className="buffs-chev">{collapsed ? '▸' : '▾'}</span>
      </button>
      {!collapsed && (
        <div className="buffs-body">
          {quests.map((aq) => {
            const def = QUEST_INDEX[aq.questId]!;
            return (
              <div className={`quest-row${aq.completed ? ' done' : ''}`} key={aq.questId}>
                <div className="quest-row-head">
                  <span className="quest-name">{def.name}</span>
                  <span className="quest-prog">{questProgressText(aq.progress, def.objective, aq.completed)}</span>
                </div>
                <div className="quest-sub">{questObjectiveText(def.objective)} → {questRewardText(def.reward)}</div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
