import { memo } from 'react';
import { CARD_INDEX } from '@game/content';
import { spellAttackBonus, spellHealthBonus } from '@game/sim';
import { Card, type CardView } from './Card';
import { ascendProgressText, combatCastGrantText, cryptDrakeText, engraveTallyText, guelProgressText, monkProgressText, scTribeBuffPerPlayedText, scTribeBuffPerSpellText, sergeantText, summonBuffText, summonImproveText, summonScalingText, tallyBuffText, taragosaText, transformProgressText, watcherText } from './cardText';
import { useGame } from './store';
import type { UnitFrame } from './useCombatReplay';

/** Keyword-proc floats (poison/shield/reborn) that bloom big in the card centre, staggered after the
 *  damage number so the two never collide. Damage/buff numbers stay in the HP/stat corner. */
const SYM_KINDS = new Set(['poison', 'shield', 'shieldup', 'reborn', 'rally']);

type Float = { id: number; text: string; kind: string };
interface UnitProps {
  u: UnitFrame;
  side: 'foe' | 'you';
  anim?: string;
  floats?: Float[];
  /** Pulse the trigger medallion this beat — this unit's effect just fired in combat. */
  triggered?: boolean;
  /** Pulse the trigger medallion YELLOW — a Rally fired as this unit attacks (fired mid-lunge, at the
   *  wind-up pause, so it's timed to the strike rather than the beat start). Takes precedence over `triggered`.
   *  A per-fire nonce (not a bool) so a repeat Rally in the same combat restarts the pulse (used as a `key`). */
  rallyPulse?: number;
  /** While a buff tendril flies to this unit, hold its displayed stats at the PRE-buff value (released on strike). */
  statHold?: { atk: number; hp: number };
  /** On the strike, which badge(s) changed → flash them via the `.statflash` class. */
  statFlash?: { atk: boolean; hp: boolean };
}

const sameKeywords = (a: string[], b: string[]): boolean =>
  a === b || (a.length === b.length && a.every((k, i) => k === b[i]));

/** A combat unit — the same Card as recruit, wrapped for animations, floats, and the DS ring. */
function UnitInner({ u, side, anim, floats, triggered, rallyPulse, statHold, statFlash }: UnitProps) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const def = CARD_INDEX[u.cardId];
  const goldMul = u.golden ? 2 : 1;
  // Run-level scalers. For a PLAYER minion these come from the live run (frozen during combat so the text
  // reflects the value the fight used). For an ENEMY minion (side === 'foe') they come from the OPPONENT's
  // captured snapshot (`lastCombat.enemyScalers`) — so an enemy Grim / Taragosa / Watcher / Hoardbreaker /
  // Pack Leader / Runescale reads at the value THAT player had, not ours (mirrors the per-side sim math).
  const foe = side === 'foe';
  const runSpA = useGame((s) => spellAttackBonus(s.run));
  const runSpH = useGame((s) => spellHealthBonus(s.run));
  const runDrTally = useGame((s) => s.run.deathrattlesTriggered);
  const runSpellsThisTurn = useGame((s) => s.run.spellsThisTurn);
  const runPlayedThisTurn = useGame((s) => s.run.playedThisTurn);
  const enemyScalers = useGame((s) => s.run.lastCombat?.enemyScalers);
  const spA = foe ? (enemyScalers?.spellPower.attack ?? 0) : runSpA;
  const spH = foe ? (enemyScalers?.spellPower.health ?? 0) : runSpH;
  const drTally = foe ? (enemyScalers?.deathrattles ?? 0) : runDrTally;
  const spellsThisTurn = foe ? (enemyScalers?.spellsThisTurn ?? 0) : runSpellsThisTurn;
  // Pack Leader's grant: the player counts qualifying plays from the card-id array; the enemy's beast count is
  // pre-computed in its snapshot (the ids aren't carried), so pass the number straight through.
  const beastsPlayed: string[] | number | undefined = foe ? (enemyScalers?.beastsPlayed ?? 0) : runPlayedThisTurn;
  // Combat live text — show current values for minions whose effects scale mid-fight (per-minion accruals)
  // or with frozen run-level scalers (Grim/Guel/Worgen, like Taragosa's spell power). Mirrors the shop chain.
  const liveText = transformProgressText(u.cardId, u.spellProgress ?? 0) // Spirit Pup: live "N to go" spell-transform countdown (seeded from the run tally)
    ?? summonBuffText(u.cardId, u.summonBonus)
    ?? summonImproveText(u.cardId, u.summonBonus, u.golden) // Mama Bear: live "+M/+M per summon" (climbs via improve events)
    ?? summonScalingText(u.cardId, spellsThisTurn, foe ? undefined : runPlayedThisTurn) // Spirit Worgen: per-summon gain + live proc count (recruit-only; enemy shows base)
    ?? scTribeBuffPerPlayedText(u.cardId, u.golden, beastsPlayed) // Pack Leader: live grant from Beasts played this turn (per-side)
    ?? scTribeBuffPerSpellText(u.cardId, u.golden, spellsThisTurn) // Runescale Drake: live Start-of-Combat Dragon buff per spell cast this turn (per-side)
    ?? cryptDrakeText(u.cardId, u.golden, u.attackSeen ?? 0)
    ?? ascendProgressText(u.cardId, u.ascendProgress ?? 0)
    ?? sergeantText(u.cardId, u.golden, u.hpGrantBonus ?? 0)
    ?? tallyBuffText(u.cardId, drTally) // Grim: live "+N/+N" from the Deathrattle tally (per-side)
    ?? guelProgressText(u.cardId, u.golden, u.spellProgress ?? 0) // Guel: live grant + countdown from HIS on-board tally (per-instance, seeded by the snapshot)
    ?? monkProgressText(u.cardId, u.golden, u.summonBonus, u.overflowBonus ?? 0) // Flowing Monk: live grant + overflow countdown (climbs via improve events)
    ?? taragosaText(u.cardId, u.golden, spA, spH)
    ?? combatCastGrantText(u.cardId, u.golden, spA, spH) // Hoardbreaker Drake: live Growth grant (base + spell power) on Slaughter (per-side)
    ?? watcherText(u.cardId, u.golden, spA, spH) // Watcher: live Lantern buff +x/+y (base + spell power, both stats, per-side)
    ?? engraveTallyText(u.cardId, u.permaGain)
    ?? def?.text ?? '';
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2,
    // Buff-tendril: hold the pre-buff value while the tendril flies; on strike, release + flash the changed badge(s).
    attack: statHold?.atk ?? u.attack,
    health: statHold ? statHold.hp : Math.max(0, u.health),
    flashAtk: statFlash?.atk,
    flashHp: statFlash?.hp,
    keywords: u.keywords, golden: u.golden,
    text: liveText,
    // The chain is already golden-aware, so for a golden unit whose live text resolved, feed it to
    // goldenText (which Card renders for goldens) instead of the static printed goldenText.
    goldenText: u.golden && liveText !== (def?.text ?? '') ? liveText : def?.goldenText,
    tier: def?.tier,
    // Two thresholds in combat: green above the *printed* base (it's buffed), red below the *floor* it
    // entered the fight with (it's been damaged/debuffed). So a recruit-buffed 5/5 stays green until
    // it's chipped below 5 — it doesn't flip to red/neutral the instant combat begins.
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
    floorAttack: u.baseAttack, floorHealth: u.baseHealth,
    buffs: u.buffs, // per-source breakdown (recruit + combat) for the right-click inspect panel
  };
  return (
    <div className={cls} data-uid={u.uid}>
      <Card card={view} pulse={triggered} pulseRally={rallyPulse} />
      {floats?.map((f) => (
        <span key={f.id} className={`float ${f.kind}${SYM_KINDS.has(f.kind) ? ' sym' : ''}`}>{f.text}</span>
      ))}
    </div>
  );
}

/**
 * Memoized so an unchanged unit skips re-render on every combat beat. `computeFrame` rebuilds fresh
 * `UnitFrame` objects each beat, so a reference compare always misses — we compare the rendered fields
 * by VALUE. The `floats` prop is stabilized upstream (`useCombatReplay` hands out a shared empty array
 * for float-less units), so a reference compare on it is correct: float-less units stay equal, and a
 * unit that just gained a float gets a new array and re-renders. Result: only the 1–3 units that
 * actually changed in a beat reconcile, instead of the whole board (×2 in dev StrictMode).
 */
export const Unit = memo(UnitInner, (a, b) =>
  a.side === b.side &&
  a.anim === b.anim &&
  a.triggered === b.triggered &&
  a.rallyPulse === b.rallyPulse &&
  a.statHold === b.statHold &&
  a.statFlash === b.statFlash &&
  a.floats === b.floats &&
  a.u.uid === b.u.uid &&
  a.u.attack === b.u.attack &&
  a.u.health === b.u.health &&
  a.u.divineShield === b.u.divineShield &&
  a.u.golden === b.u.golden &&
  a.u.summonBonus === b.u.summonBonus &&
  a.u.attackSeen === b.u.attackSeen &&
  a.u.ascendProgress === b.u.ascendProgress &&
  a.u.hpGrantBonus === b.u.hpGrantBonus &&
  a.u.spellProgress === b.u.spellProgress &&
  a.u.permaGain?.attack === b.u.permaGain?.attack &&
  a.u.permaGain?.health === b.u.permaGain?.health &&
  a.u.name === b.u.name &&
  a.u.cardId === b.u.cardId &&
  a.u.tribe === b.u.tribe &&
  a.u.baseAttack === b.u.baseAttack &&
  a.u.baseHealth === b.u.baseHealth &&
  sameKeywords(a.u.keywords, b.u.keywords),
);
