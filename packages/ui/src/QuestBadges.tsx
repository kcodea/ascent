import { useEffect, useMemo, useState, type CSSProperties } from 'react';
import type { QuestObjective, Tribe } from '@game/core';
import { QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { getHero, type RunState } from '@game/sim';
import { mdBold } from './Card';
import { Icon } from './Icon';
import { questArt, runeArt } from './art';
import { questObjectiveLines, questObjectiveText, questProgressText, questRewardText, questRewardLiveText, questRewardLiveOf } from './questText';
import { questTally, runeCombatTally, runeTally } from './runeTally';
import { useRuneTriggerFx, type RuneSlotPulse } from './runeTriggerFx';
import { useRuneArrivalFx } from './useRuneArrivalFx';
import { arrivalClasses } from './runeArrival';
import { getRuneLockInConfig } from './runeLockInConfig';
import { useGame, type CombatQuestDelta } from './store';
import { playDef } from './fx/playDef';
import { sfx } from './sfx';
import './runeSheenConfig'; // side-effect: reflects the --rsh-* rune-sheen vars at load

// Public-folder art carries the BASE_URL (itch serves from a CDN sub-path; a root-absolute '/frames/…' 404s).
const F = `${import.meta.env.BASE_URL}frames/`;

/** Each tribe's emblem glyph — the fallback when a quest has no art yet (mirrors QuestCard). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star', kobold: 'crown', dwarf: 'anvil', celestial: 'clock' };


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
/** Runes that unlock a THIRD rune — Rune of the Epic Forge (schedules an extra turn-8 epic visit) and Rune of
 *  Duplication (a 3rd badge off the turn-9 epic). Owning either lifts the chains (owner ask 2026-08-19). */
const THIRD_RUNE_UNLOCKERS = ['rune_epic_forge', 'rune_duplication'];

/**
 * Can this run reach a THIRD rune? Most runs get exactly 2 (universal basic forge turn 6 + epic turn 9), so
 * the 3rd slot is LOCKED and wears the chains from the very start of the run. The chains lift only once the run
 * can actually earn a 3rd: a runeforge-native HERO — Runesmith (`runeforge`, turn 5) or Guardian
 * (`epicRuneforge`, turn 8) — or owning a RUNE that enables one (see `THIRD_RUNE_UNLOCKERS`). This is the state
 * flip the "chains unlock" FX will hook.
 */
function canReachThirdRune(run: RunState): boolean {
  const kind = getHero(run.heroId).power.kind;
  if (kind === 'runeforge' || kind === 'epicRuneforge') return true;
  const owned = run.ownedRunes ?? [];
  return THIRD_RUNE_UNLOCKERS.some((id) => owned.includes(id));
}

/** The chains shatter this long AFTER the 3rd-rune condition is met (owner ask 2026-08-19: 1000ms). */
const RUNE_CHAINS_BREAK_MS = 1000;

// The break is a ONE-TIME event per run, persisted so a resume doesn't replay the shatter (FX + sound). Keyed
// by the run identity (`seed:heroId`, the same key that remounts the StatusBar), so a NEW run shows the chains
// again while a reloaded broken run stays broken. Survives page reload; a plain in-memory flag would not.
const CHAINS_BROKEN_KEY = 'ascent.runechainsbroken';
function readRuneChainsBroken(runKey: string): boolean {
  try { return localStorage.getItem(`${CHAINS_BROKEN_KEY}:${runKey}`) === '1'; } catch { return false; }
}
function writeRuneChainsBroken(runKey: string): void {
  try { localStorage.setItem(`${CHAINS_BROKEN_KEY}:${runKey}`, '1'); } catch { /* ignore */ }
}

export function QuestBadges() {
  const run = useGame((s) => s.run);
  const triggered = useGame((s) => s.combatTriggeredQuests); // ids pulsing this replay beat
  const completedNow = useGame((s) => s.combatCompletedQuests);
  const runeArrival = useGame((s) => s.runeArrival); // the rune the lock-in ceremony is handing over
  // The pop's shape is the ceremony's to own — it is the last beat of that sequence, tuned against it in the
  // same panel. Read per render rather than captured, so a dial moved between arrivals takes effect.
  const arrivalVars = useMemo(() => {
    const t = getRuneLockInConfig();
    return { '--rune-pop': `${t.arrivePopMs}ms`, '--rune-pop-scale': `${t.arrivePopScale}` } as CSSProperties;
  }, [runeArrival?.seq]);
  useRuneArrivalFx(runeArrival);
  const combatQuestDelta = useGame((s) => s.combatQuestDelta); // live combat progress during the replay (null otherwise) // ids that JUST completed mid-replay (pre-settle)
  // The chains show at the start of EVERY run (even for a hero that will get a 3rd rune) and BREAK once, 1000ms
  // after the 3rd-rune condition is met — a runeforge hero at run start, or the moment an enabling rune is
  // picked (owner ask 2026-08-19). `chainsBroken` is per-run (localStorage keyed by `runKey`), so it persists a
  // resume without re-shattering, and resets for a new run (StatusBar remounts on `runKey`).
  const runKey = `${run.seed}:${run.heroId}`;
  const canThird = canReachThirdRune(run);
  const [chainsBroken, setChainsBroken] = useState(() => readRuneChainsBroken(runKey));
  useEffect(() => {
    if (!canThird || chainsBroken) return;
    const t = window.setTimeout(() => {
      // Shatter FX at the locked slot (the chains' own screen position), then remove the chains.
      const el = document.querySelector('.questbadges .rune-chains');
      if (el) {
        const r = el.getBoundingClientRect();
        const at = { x: r.left + r.width / 2, y: r.top + r.height / 2 };
        playDef('rune-slot-break', { source: at, target: at, camera: { x: window.innerWidth / 2, y: window.innerHeight / 2 } }, { index: 0 });
      }
      sfx.runeChainBreak();
      writeRuneChainsBroken(runKey);
      setChainsBroken(true);
    }, RUNE_CHAINS_BREAK_MS);
    return () => window.clearTimeout(t);
  }, [canThird, chainsBroken, runKey]);
  // Show a badge once a quest has activated — a one-shot flips `completed`; a REPEATABLE (Hoard Spark, Imp Census,
  // …) never does but bumps `completionCount` on each re-fire, so include those too (they pulse on every re-fire).
  // Also surface quests that complete MID-COMBAT this replay (`completedNow`) — their node appears + lights up the
  // instant the objective crosses, before the quest formally settles as completed.
  // EVERY taken quest gets a node, in ACQUISITION order — a quest keeps its slot as it completes rather than
  // jumping between a text panel and a trophy row (owner rework 2026-07-21, replacing the QuestPanel window).
  // A node is PENDING (dim, showing objective progress) until it activates, then lights up as a trophy.
  // A quest granted by the HERO POWER lives in the power slot instead (owner ask 2026-08-17), so it is
  // filtered out here rather than appearing twice.
  const nodes = (run.activeQuests ?? [])
    .filter((aq) => QUEST_INDEX[aq.questId])
    .filter((aq) => !(run.heroGrantArt?.kind === 'quest' && run.heroGrantArt.id === aq.questId));
  const runes = (run.ownedRunes ?? []).filter((id) => RUNE_INDEX[id]);
  // Indexed against the RENDERED list, not `ownedRunes` — an unknown id is filtered out above, and indexing
  // the two lists differently would shift every class by one from that point on.
  const arrivalCls = arrivalClasses(runes, runeArrival);
  // The rune-trigger flourish fires off the SAME counters the badge bounces on, so the burst and the bounce
  // can never disagree about when a rune went off. Per SLOT, because Rune of Duplication puts one id in
  // `ownedRunes` twice (see `runeTriggerFx.ts`). Built unconditionally — hooks cannot sit behind the early
  // return below — and `useMemo`'d so the effect's dep is stable across the row's frequent re-renders.
  const runeSlots = useMemo<RuneSlotPulse[]>(() => runes.map((id, slot) => {
    const r = RUNE_INDEX[id]!.reward;
    // A recurring End-of-Turn reward proc'ing THIS action, stamped with the per-action seq so a re-proc of
    // the same effect still reads as a change. Mirrors the quest nodes' `procced` fold below.
    const procced = r?.kind === 'recurringEndOfTurn'
      && (run.questTendrilFx ?? []).some((t) => t.effect === r.effect)
      ? (run.questTendrilSeq ?? 0) : 0;
    // `runeProcs` is the SHOP-phase half: a threshold rune paying out mid-shop (Bulk Order every 5 Gold) is
    // neither a combat trigger nor an End-of-Turn tendril, so without this its badge never burst at all
    // (owner report 2026-08-19).
    // `pulse` takes only true COUNTS (combat triggers + shop procs); the End-of-Turn tendril stamp is a
    // global action SEQUENCE and rides `seq`, where any change is exactly one fire. Folding it into `pulse`
    // would make one End-of-Turn proc burst once per intervening action.
    return { slot, id, epic: !!RUNE_INDEX[id]?.epic, pulse: (triggered[id] ?? 0) + (run.runeProcs?.[id] ?? 0), seq: procced };
  }), [runes.join('|'), triggered, run.questTendrilFx, run.questTendrilSeq, run.runeProcs]);
  useRuneTriggerFx(runeSlots);
  // Chains on the LOCKED third rune slot — shown from the very start for EVERY run, until they BREAK (above).
  // The badge row renders for the chains alone, even with no quests and no runes yet.
  const showChains = !chainsBroken;
  if (nodes.length === 0 && runes.length === 0 && !showChains) return null;
  const isDone = (aq: (typeof nodes)[number]): boolean =>
    aq.completed || (aq.completionCount ?? 0) > 0 || completedNow.includes(aq.questId);
  return (
    // `hasrunelock` reserves the rune-row height so the chains sit at a STABLE spot from turn 1 (empty row) all
    // the way to two runes — the row is bottom-anchored and would otherwise grow (and shift the chains) as
    // badges appear.
    <div className={`questbadges${showChains ? ' hasrunelock' : ''}`}>
      {/* Runes bought in the Runeforge — a stone-toned badge sitting alongside completed quests. */}
      {runes.map((id, i) => {
        const rune = RUNE_INDEX[id]!;
        const art = runeArt(rune.id);
        return (
          // `data-eot-effect` anchors the quest-tendril FX: a recurring End-of-Turn reward that triggers a
          // unit draws its tendril from THIS node. Runes grant those too, so both node kinds carry it.
          // Keyed by SLOT, not id alone (audit fix 2026-08-06): Rune of Duplication legitimately puts the
          // same rune id in `ownedRunes` twice, and duplicate keys mis-reconciled the two badges' pulses.
          <div
            className={`questbadge runebadge${arrivalCls[i] ?? ''}`}
            key={`${id}#${i}`}
            data-source-id={id}
            data-eot-effect={rune.reward?.kind === 'recurringEndOfTurn' ? rune.reward.effect : undefined}
            style={arrivalVars}
          >
            {/* Keyed on the trigger count → remounts and replays the scale-punch bounce (like a unit's self-buff)
                each time this rune's combat effect fires. The glow ring rides inside so it replays in lockstep. */}
            <div className="questbadge-inner" key={triggered[id] ?? 0} data-pulse={triggered[id] ?? 0}>
              {(triggered[id] ?? 0) > 0 && <span className="questbadge-pulse" aria-hidden />}
              {art
                ? <img decoding="sync" className="questbadge-art" src={art} alt="" aria-hidden />
                : <span className="questbadge-emblem" aria-hidden><Icon name="sc" /></span>}
            </div>
            {/* LIVE METER (owner ask 2026-08-03) — a rune that fires on a threshold shows how close it is,
                in the same `x/N` language as the Avenge counters on units. Keyed on the text so every change
                replays the compositor-only bump. Null for passive/one-shot runes, which show nothing.
                One `runeTally` call per rune (perf audit 2026-08-06) — this JSX used to call it 5×. */}
            {(() => {
              // Shop meters first; during a replay the COMBAT-LOCAL meters (the rune Avenge class) tick off
              // the live quest delta — the same feed the unit Avenge counters ride (audit 2026-08-06).
              const tally = runeTally(run, rune.id)
                ?? (combatQuestDelta ? runeCombatTally(rune.id, combatQuestDelta.friendlyDeath, combatQuestDelta.summonCombat) : null);
              return tally && (
              <span key={tally} className="qb-tally">{tally}</span>
            ); })()}
            <div className="questbadge-tip" role="tooltip">
              <b>{rune.name}</b>
              <span className="questbadge-tip-reward" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
              {/* Rune badges never showed LIVE reward text — only quests did — so a rune whose payout depends
                  on run state could only ever restate its rule. Rune of Recollection is the case that made it
                  visible: "a copy of the first spell you cast this turn" names no card until you've cast one. */}
              {(() => {
                const rlive = questRewardLiveText(rune.reward, { firstSpellId: run.firstSpellThisTurnId });
                return rlive ? <span className="questbadge-tip-live">{rlive}</span> : null;
              })()}
              <span className="questbadge-tip-state">
                {(() => { const tally = runeTally(run, rune.id); return `Rune · active${tally ? ` · ${tally}` : ''}`; })()}
              </span>
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
                  <img decoding="sync" className="questbadge-art" src={art} alt="" aria-hidden />
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
        // A RECURRING reward firing in the recruit phase (Echoing Roar at End of Turn) is a trigger too, and
        // wasn't pulsing: `triggered` is combat-only, and `completionCount` doesn't move on a re-fire. Fold in
        // this action's tendril procs for THIS reward — `questTendrilSeq` changes per action, so the key
        // changes and the bounce replays on every proc (owner report 2026-07-21).
        const procced = r.kind === 'recurringEndOfTurn'
          && (run.questTendrilFx ?? []).some((t) => t.effect === r.effect)
          ? (run.questTendrilSeq ?? 0) : 0;
        const pulse = (aq.completionCount ?? 0) + (aq.completed ? 1 : 0) + (triggered[aq.questId] ?? 0) + (completedNow.includes(aq.questId) ? 1 : 0) + procced;
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
        const liveTxt = questRewardLiveText(r, questRewardLiveOf(run, r));
        return (
          <div className={`questbadge${ongoing ? ' ongoing' : ''}`} style={{ '--c': c } as CSSProperties} key={aq.questId} data-source-id={aq.questId} data-eot-effect={r.kind === 'recurringEndOfTurn' ? r.effect : undefined}>
            {/* Keyed on the pulse count → remounts + replays the scale-punch bounce (a quest's own "self-buff")
                each time it completes / re-fires / triggers in combat. The glow ring rides inside, in lockstep. */}
            <div className="questbadge-inner" key={pulse} data-pulse={pulse}>
              {pulse > 0 && <span className="questbadge-pulse" aria-hidden />}
              {art ? (
                <img decoding="sync" className="questbadge-art" src={art} alt="" aria-hidden />
              ) : (
                <span className="questbadge-emblem" aria-hidden><Icon name={TRIBE_ICON[def.tribe]} /></span>
              )}
            </div>
            {chip && <span className="questbadge-chip">{chip}</span>}
            {stepTotal > 0 && (
              <span className="stepcounter questbadge-step" aria-label={`Quest progress ${stepCur} of ${stepTotal}`}>{stepCur}/{stepTotal}</span>
            )}
            {/* A completed quest whose REWARD is an ongoing meter (Food for Gold's "every 7 Gold", Bane's
                Presence's "every 3 Shouts") shows how close the next payout is — the same `x/N` the runes and
                the Avenge counters use. Only when `stepTotal` is absent: that slot already holds a REPEATABLE
                quest's objective progress, and two different numbers in one place is worse than neither.
                Keyed on the text so each change replays the compositor-only bump. */}
            {stepTotal === 0 && questTally(run, aq.questId) && (
              <span key={questTally(run, aq.questId)!} className="qb-tally">{questTally(run, aq.questId)}</span>
            )}
            <div className="questbadge-tip" role="tooltip">
              <b>{def.name}</b>
              <span className="questbadge-tip-reward">{rewardTxt}{def.repeatable ? ' · Repeatable' : ''}</span>
              {liveTxt && <span className="questbadge-tip-state">{liveTxt}</span>}
              {chip && <span className="questbadge-tip-state">{ongoing ? 'Active' : 'Done'} · {chip}</span>}
              {questTally(run, aq.questId) && <span className="questbadge-tip-state">Next in {questTally(run, aq.questId)}</span>}
            </div>
          </div>
        );
      })}
      {/* Rune sheen — three glossy discs, each an INDEPENDENT overlay on a rune node (owner ask 2026-08-15:
          separated from the one source image). Placement/size/opacity/blend per disc come from the 💠 Rune
          Sheen tuner (`--rshN-*`); pointer-events off so they never eat a badge hover. Each disc counter-scales
          by 1/--qb-s IN ITS OWN transform (styles.css), so the Quest-nodes Scale slider no longer resizes it —
          and because the counter-scale is on the blended element itself (not an isolating ancestor wrapper), the
          discs still `mix-blend-mode` against the badges behind them. LAST children: absolutely positioned (DOM
          order sets paint order — they ride on top) and keep the badges' `:nth-child` stagger counting from 1. */}
      {runes.length > 0 && [1, 2, 3].map((n) => (
        <img decoding="sync" key={n} className={`rune-sheen rune-sheen-${n}`} src={`${F}rune-sheen-${n}.webp`} alt="" draggable={false} aria-hidden />
      ))}
      {/* CHAINS on the LOCKED third rune slot (owner ask 2026-08-19): shown once the rune row is up but the 3rd
          slot is empty AND out of reach — most runs only ever get 2 (basic forge turn 6, epic turn 9). It clears
          the instant the slot could be filled (a runeforge-native hero / Rune of the Epic Forge) or actually is
          (a 3rd owned rune, e.g. via Duplication). Placement from the 💠 Rune Sheen tuner (`--rch-*`). */}
      {showChains && (
        <img decoding="sync" className="rune-chains" src={`${F}rune-chains.webp`} alt="" draggable={false} aria-hidden />
      )}
    </div>
  );
}
