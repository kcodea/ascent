import { useState } from 'react';
import type { QuestObjective } from '@game/core';
import { QUEST_INDEX } from '@game/content';
import { Icon } from './Icon';
import { questObjectiveLines, questObjectiveText, questProgressText, questRewardText } from './questText';
import { useGame, type CombatQuestDelta } from './store';

/** Live combat progress for a quest objective (during the replay), mirroring the reducer's `combatEventCount`. */
function combatDeltaFor(o: QuestObjective, d: CombatQuestDelta | null): number {
  if (!d) return 0;
  switch (o.event) {
    case 'deathrattle': return d.deathrattle;
    case 'friendlyDeath': return d.friendlyDeath;
    case 'rally': return d.rally;
    case 'summonImp': return d.summonImp;
    case 'attack': return o.tribe ? (d.attackByTribe[o.tribe] ?? 0) : d.attack;
    case 'summonCombat': return o.tribe ? (d.summonCombatByTribe[o.tribe] ?? 0) : d.summonCombat;
    case 'slaughter': return o.tribe ? (d.slaughterByTribe[o.tribe] ?? 0) : d.slaughter;
    case 'slaughterKeyword': return d.slaughterKeyword;
    default: return 0;
  }
}

/**
 * Active-quests window (top-left, under the Buffs frame) — the quests you've taken this run + their LIVE
 * objective progress. Mirrors BuffsFrame (collapsible, absolutely positioned, only rendered when non-empty).
 */
export function QuestPanel() {
  const run = useGame((s) => s.run);
  const combatQuestDelta = useGame((s) => s.combatQuestDelta); // live combat progress during the replay (null otherwise)
  const [collapsed, setCollapsed] = useState(false);
  // Only IN-PROGRESS quests live here now — a quest MOVES to a trophy badge above the hero panel (QuestBadges)
  // the moment it completes, where its live ongoing reward state (Shouts used, repeat countdown) is shown.
  const quests = (run.activeQuests ?? []).filter((aq) => !aq.completed && QUEST_INDEX[aq.questId]);
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
            const r = def.reward;
            const charges = run.shoutDoubleCharges ?? 0;
            const repeatTurns = run.pendingQuestRewards?.find((p) => p.questId === aq.questId)?.turnsLeft ?? 0;
            // The right-hand chip: objective progress while IN PROGRESS; once complete, the reward's LIVE ongoing
            // state — Warm Embers' Shouts used ("0/2 used"), Trail Rations' repeat countdown ("↻ 2t"), else a ✓
            // for a one-shot reward that already fired.
            // While a fight replays, fold in the live combat delta so combat objectives tick up in real time
            // (matches the settled tally exactly). Cleared to null at settle, when run progress takes over.
            const liveProgress = aq.completed ? aq.progress : aq.progress + combatDeltaFor(def.objective, combatQuestDelta);
            let chip = questProgressText(liveProgress, def.objective, aq.completed);
            let ongoing = false;
            if (aq.completed) {
              if (r.kind === 'shoutDouble') { chip = `${r.count - charges}/${r.count} used`; ongoing = charges > 0; }
              else if (r.kind === 'grant' && r.repeatInTurns) { ongoing = repeatTurns > 0; chip = ongoing ? `↻ ${repeatTurns}t` : '✓'; }
              else chip = '✓';
            }
            // Live reward text so the panel never prints a stale number. In progress → "objective → reward";
            // once taken → the reward (its effect / ongoing state) is what matters.
            const rewardTxt = questRewardText(r, { completed: aq.completed, shoutCharges: charges, repeatTurns });
            const repeat = def.repeatable ? ' · Repeatable' : '';
            // The Author's Hand + general compound objectives break into one live progress line per part; every
            // other objective stays a single "objective → reward" line.
            const compound = !aq.completed && (def.objective.event === 'authorsHand' || def.objective.event === 'compound');
            return (
              <div className={`quest-row${ongoing ? ' ongoing' : aq.completed ? ' done' : ''}`} key={aq.questId}>
                <div className="quest-row-head">
                  <span className="quest-name">{def.name}</span>
                  <span className="quest-prog">{chip}</span>
                </div>
                <div className="quest-sub">
                  {aq.completed ? (
                    `${rewardTxt}${repeat}`
                  ) : compound ? (
                    <>
                      {questObjectiveLines(def.objective, aq.subProgress, aq.partProgress).map((l, i) => (
                        <div className="quest-objline" key={i}>{l}</div>
                      ))}
                      <div className="quest-objline reward">→ {rewardTxt}{repeat}</div>
                    </>
                  ) : (
                    `${questObjectiveText(def.objective)} → ${rewardTxt}${repeat}`
                  )}
                </div>
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}
