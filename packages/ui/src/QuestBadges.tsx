import type { CSSProperties } from 'react';
import type { QuestObjective, Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { questArt, runeArt } from './art';
import { questObjectiveLines, questObjectiveText, questProgressText, questRewardText, questRewardLiveText, type QuestRewardLive } from './questText';
import { useGame, type CombatQuestDelta } from './store';

/** Each tribe's emblem glyph — the fallback when a quest has no art yet (mirrors QuestCard). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star' };


/** Live combat progress for a quest objective during the replay, mirroring the reducer's `combatEventCount`.
 *  Moved here from the retired QuestPanel — a PENDING node must tick its x/y up in real time as the fight
 *  plays, exactly as the old text panel did. */
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
 * Quest nodes — a horizontal row of circular badges sitting ABOVE the hero panel (in the
 * StatusBar). Every taken quest has a node here — dim while pending, lit once it activates; the circle shows its art
 * (or its tribe emblem as a fallback), and hovering floats the reward's LIVE ongoing state — Warm Embers'
 * Shouts remaining, Trail Rations' repeat countdown, else the reward it granted.
 */
export function QuestBadges() {
  const run = useGame((s) => s.run);
  const triggered = useGame((s) => s.combatTriggeredQuests); // ids pulsing this replay beat
  const completedNow = useGame((s) => s.combatCompletedQuests);
  const combatQuestDelta = useGame((s) => s.combatQuestDelta); // live combat progress during the replay (null otherwise) // ids that JUST completed mid-replay (pre-settle)
  // Show a badge once a quest has activated — a one-shot flips `completed`; a REPEATABLE (Hoard Spark, Imp Census,
  // …) never does but bumps `completionCount` on each re-fire, so include those too (they pulse on every re-fire).
  // Also surface quests that complete MID-COMBAT this replay (`completedNow`) — their node appears + lights up the
  // instant the objective crosses, before the quest formally settles as completed.
  // EVERY taken quest gets a node, in ACQUISITION order — a quest keeps its slot as it completes rather than
  // jumping between a text panel and a trophy row (owner rework 2026-07-21, replacing the QuestPanel window).
  // A node is PENDING (dim, showing objective progress) until it activates, then lights up as a trophy.
  const nodes = (run.activeQuests ?? []).filter((aq) => QUEST_INDEX[aq.questId]);
  const runes = (run.ownedRunes ?? []).filter((id) => RUNE_INDEX[id]);
  if (nodes.length === 0 && runes.length === 0) return null;
  const isDone = (aq: (typeof nodes)[number]): boolean =>
    aq.completed || (aq.completionCount ?? 0) > 0 || completedNow.includes(aq.questId);
  return (
    <div className="questbadges">
      {/* Runes bought in the Runeforge — a stone-toned badge sitting alongside completed quests. */}
      {runes.map((id) => {
        const rune = RUNE_INDEX[id]!;
        const art = runeArt(rune.id);
        return (
          // `data-eot-effect` anchors the quest-tendril FX: a recurring End-of-Turn reward that triggers a
          // unit draws its tendril from THIS node. Runes grant those too, so both node kinds carry it.
          <div className="questbadge runebadge" key={id} data-eot-effect={rune.reward?.kind === 'recurringEndOfTurn' ? rune.reward.effect : undefined}>
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
      {nodes.map((aq) => {
        const def = QUEST_INDEX[aq.questId]!;
        const r = def.reward;
        const art = questArt(def.id);
        // ---- PENDING: taken but not yet activated. Dim node + live x/y + the full objective on hover. ----
        if (!isDone(aq)) {
          const cP = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
          // Fold in the live combat delta so combat objectives tick during the replay, exactly as the old panel did.
          const liveProgress = aq.progress + combatDeltaFor(def.objective, combatQuestDelta);
          const total = typeof def.objective.count === 'number' ? def.objective.count : 0;
          const cur = total ? Math.min(total, liveProgress) : 0;
          // Compound objectives (The Author's Hand) have no single count — the tip lists each part's own line.
          const compound = def.objective.event === 'authorsHand' || def.objective.event === 'compound';
          return (
            <div className="questbadge pending" style={{ '--c': cP } as CSSProperties} key={aq.questId}>
              <div className="questbadge-inner">
                {art ? (
                  <img className="questbadge-art" src={art} alt="" aria-hidden />
                ) : (
                  <span className="questbadge-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe]} /></span>
                )}
              </div>
              {total > 0 && (
                <span className="stepcounter questbadge-step" aria-label={`Quest progress ${cur} of ${total}`}>{cur}/{total}</span>
              )}
              <div className="questbadge-tip" role="tooltip">
                <b>{def.name}</b>
                {compound ? (
                  questObjectiveLines(def.objective, aq.subProgress, aq.partProgress).map((l, i) => (
                    <span className="questbadge-tip-reward" key={i}>{l}</span>
                  ))
                ) : (
                  <span className="questbadge-tip-reward">{questObjectiveText(def.objective)}</span>
                )}
                <span className="questbadge-tip-state">
                  → {questRewardText(r, { completed: false, shoutCharges: 0, repeatTurns: 0 })}{def.repeatable ? ' · Repeatable' : ''}
                </span>
                {!compound && <span className="questbadge-tip-state">{questProgressText(liveProgress, def.objective, false)}</span>}
              </div>
            </div>
          );
        }
        // One-shot pulse count: a recruit-phase completion / repeatable re-fire (completionCount, e.g. Hoard Spark
        // buying its 4th Dragon) OR a combat trigger (combatTriggeredQuests, beat-synced). Keyed → fresh pulse per bump.
        const pulse = (aq.completionCount ?? 0) + (aq.completed ? 1 : 0) + (triggered[aq.questId] ?? 0) + (completedNow.includes(aq.questId) ? 1 : 0);
        const c = def.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${def.tribe})`;
        // The live ongoing chip: Shouts used, repeat countdown, else nothing.
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
          <div className={`questbadge${ongoing ? ' ongoing' : ''}`} style={{ '--c': c } as CSSProperties} key={aq.questId} data-eot-effect={r.kind === 'recurringEndOfTurn' ? r.effect : undefined}>
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
