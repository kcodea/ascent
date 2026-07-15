import type { CSSProperties } from 'react';
import type { Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { questArt, runeArt } from './art';
import { questRewardText, questRewardLiveText, type QuestRewardLive } from './questText';
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
  const triggered = useGame((s) => s.combatTriggeredQuests); // ids pulsing this replay beat
  // Show a badge once a quest has activated — a one-shot flips `completed`; a REPEATABLE (Hoard Spark, Imp Census,
  // …) never does but bumps `completionCount` on each re-fire, so include those too (they pulse on every re-fire).
  const done = (run.activeQuests ?? []).filter((aq) => (aq.completed || (aq.completionCount ?? 0) > 0) && QUEST_INDEX[aq.questId]);
  const runes = (run.ownedRunes ?? []).filter((id) => RUNE_INDEX[id]);
  if (done.length === 0 && runes.length === 0) return null;
  return (
    <div className="questbadges">
      {/* Runes bought in the Runeforge — a stone-toned badge sitting alongside completed quests. */}
      {runes.map((id) => {
        const rune = RUNE_INDEX[id]!;
        const art = runeArt(rune.id);
        return (
          <div className="questbadge runebadge" key={id}>
            {/* Keyed on the trigger count → remounts and replays the scale-punch bounce (like a unit's self-buff)
                each time this rune's combat effect fires. The glow ring rides inside so it replays in lockstep. */}
            <div className="questbadge-inner" key={triggered[id] ?? 0} data-pulse={triggered[id] ?? 0}>
              {(triggered[id] ?? 0) > 0 && <span className="questbadge-pulse" aria-hidden />}
              {art
                ? <img className="questbadge-art" src={art} alt="" aria-hidden />
                : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
            </div>
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
        // One-shot pulse count: a recruit-phase completion / repeatable re-fire (completionCount, e.g. Hoard Spark
        // buying its 4th Dragon) OR a combat trigger (combatTriggeredQuests, beat-synced). Keyed → fresh pulse per bump.
        const pulse = (aq.completionCount ?? 0) + (aq.completed ? 1 : 0) + (triggered[aq.questId] ?? 0);
        const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
        // The live ongoing chip, mirroring the QuestPanel: Shouts used, repeat countdown, else nothing.
        const charges = run.shoutDoubleCharges ?? 0;
        const repeatTurns = run.pendingQuestRewards?.find((p) => p.questId === aq.questId)?.turnsLeft ?? 0;
        let chip = '';
        let ongoing = false;
        if (r.kind === 'shoutDouble') { chip = `${r.count - charges}/${r.count} used`; ongoing = charges > 0; }
        else if (r.kind === 'grant' && r.repeatInTurns) { ongoing = repeatTurns > 0; if (ongoing) chip = `↻ ${repeatTurns}t`; }
        // A REPEATABLE count-threshold quest (Hoard Spark: buy 4 Dragons) shows its progress toward the NEXT
        // trigger as an X/N counter ABOVE the badge — the same look as the combat avenge tally. `aq.progress`
        // holds the leftover after each fire (see resolveQuestThreshold). Compound objectives have no single count.
        const stepTotal = def.repeatable && typeof def.objective.count === 'number' ? def.objective.count : 0;
        const stepCur = stepTotal ? Math.min(stepTotal, aq.progress ?? 0) : 0;
        const rewardTxt = questRewardText(r, { completed: true, shoutCharges: charges, repeatTurns });
        // The LIVE ongoing magnitude of a scaling/stat reward (current Beast aura, Umbral per-spell grant, the
        // scaling countdown) — folded from the run state so the tooltip shows what it's producing NOW.
        const scaling = (r.kind === 'scalingTribeAura')
          ? (run.questScalingAuras ?? []).find((a) => a.tribe === r.tribe && a.event === r.event)
          : undefined;
        const live: QuestRewardLive = {
          beastAura: { attack: run.beastBuyAtk ?? 0, health: run.beastBuyHp ?? 0 },
          spellsCast: run.spellsCast ?? 0,
          scaling: scaling ? { progress: scaling.progress, per: scaling.per } : undefined,
          denMarkerCount: run.denMarker?.count ?? 0,
        };
        const liveTxt = questRewardLiveText(r, live);
        return (
          <div className={`questbadge${ongoing ? ' ongoing' : ''}`} style={{ '--c': c } as CSSProperties} key={aq.questId}>
            {/* Keyed on the pulse count → remounts + replays the scale-punch bounce (a quest's own "self-buff")
                each time it completes / re-fires / triggers in combat. The glow ring rides inside, in lockstep. */}
            <div className="questbadge-inner" key={pulse} data-pulse={pulse}>
              {pulse > 0 && <span className="questbadge-pulse" aria-hidden />}
              {art ? (
                <img className="questbadge-art" src={art} alt="" aria-hidden />
              ) : (
                <span className="questbadge-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe]} /></span>
              )}
            </div>
            {chip && <span className="questbadge-chip">{chip}</span>}
            {stepTotal > 0 && (
              <span className="stepcounter questbadge-step" aria-label={`Quest progress ${stepCur} of ${stepTotal}`}>{stepCur}/{stepTotal}</span>
            )}
            <div className="questbadge-tip" role="tooltip">
              <b>{def.name}</b>
              <span className="questbadge-tip-reward">{rewardTxt}{def.repeatable ? ' · Repeatable' : ''}</span>
              {liveTxt && <span className="questbadge-tip-state">{liveTxt}</span>}
              {chip && <span className="questbadge-tip-state">{ongoing ? 'Active' : 'Done'} · {chip}</span>}
            </div>
          </div>
        );
      })}
    </div>
  );
}
