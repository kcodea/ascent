import { memo } from 'react';
import { CARD_INDEX } from '@game/content';
import { spellAttackBonus, spellHealthBonus } from '@game/sim';
import { Card, type CardView } from './Card';
import { stepProgress } from './cardText';
import { liveCardText } from './instView';
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
  // Combat live text — the SAME `liveCardText` the shop/board use, so every card reads identically in both phases
  // and any newly-added scaling card is covered automatically (no parallel chain to drift). Per-instance values
  // come from the snapshot (u.*); run-level scalers are per-side (player = the live run, frozen for the fight;
  // enemy = its captured `enemyScalers`); run-wide economy (Steward's last spell, Cling enchant, Soulsman Gold,
  // Eternal Knight's run tally, …) is player-only — an enemy carries no run, so those fall back to base text.
  const run = useGame((s) => s.run);
  const { text: liveText, goldenText: liveGoldenText } = def
    ? liveCardText(u.cardId, {
        tier: run.tier, golden: u.golden,
        spellBonus: spA, spellBonusH: spH,
        frontToBackBonus: foe ? 0 : run.frontToBackBonus, frontToBackBonusH: foe ? 0 : run.frontToBackBonusH,
        spellsThisTurn, spellsCast: foe ? 0 : run.spellsCast, deathrattlesTriggered: drTally,
        clingEnchant: foe ? undefined : run.cardBuffs?.cling,
        fodderConsumed: foe ? undefined : run.fodderConsumedThisTurn,
        undeadBuyAtk: foe ? 0 : run.undeadBuyAtk, soulsmanGold: foe ? 0 : (run.soulsmanGold ?? 0),
        cardBuffs: foe ? undefined : run.cardBuffs,
        spellProgress: u.spellProgress, ascendProgress: u.ascendProgress, summonBonus: u.summonBonus,
        overflowBonus: u.overflowBonus, hpGrantBonus: u.hpGrantBonus, eotBonus: u.eotBonus, eotTick: u.eotTick,
        sellBonus: u.sellBonus, attackSeen: u.attackSeen, permaGain: u.permaGain,
        playedThisTurn: beastsPlayed, squirlScoutBuff: foe ? 0 : run.squirlScoutBuff,
        goldSpent: foe ? 0 : run.goldSpentThisTurn,
        lastSpellName: foe ? undefined : (run.lastSpellCastId ? CARD_INDEX[run.lastSpellCastId]?.name : undefined),
      })
    : { text: '', goldenText: undefined };
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2,
    // Buff-tendril: hold the pre-buff value while the tendril flies; on strike, release + flash the changed badge(s).
    attack: statHold?.atk ?? u.attack,
    health: statHold ? statHold.hp : Math.max(0, u.health),
    flashAtk: statFlash?.atk,
    flashHp: statFlash?.hp,
    keywords: u.keywords, golden: u.golden,
    text: liveText,
    // liveCardText already folds golden-awareness + the golden-variant fallback into its goldenText (Card renders
    // that for goldens), so pass it straight through — same source of truth as the shop.
    goldenText: liveGoldenText ?? def?.goldenText,
    tier: def?.tier,
    // Two thresholds in combat: green above the *printed* base (it's buffed), red below the *floor* it
    // entered the fight with (it's been damaged/debuffed). So a recruit-buffed 5/5 stays green until
    // it's chipped below 5 — it doesn't flip to red/neutral the instant combat begins.
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
    floorAttack: u.baseAttack, floorHealth: u.baseHealth,
    buffs: u.buffs, // per-source breakdown (recruit + combat) for the right-click inspect panel
    // Live step counter (Guel 1/4, Crypt Drake 1/2, …) — ticks mid-fight from the unit's per-instance accruals.
    stepProgress: stepProgress(u.cardId, {
      spellProgress: u.spellProgress, summonBonus: u.summonBonus,
      ascendProgress: u.ascendProgress, attackSeen: u.attackSeen,
      avengeSeen: u.avengeSeen, bleedAttacks: u.bleedAttacks,
    }) ?? undefined,
    // Combat: the counter fades in on each tick and fades out after ~3s (see `.stepcounter.ephemeral`).
    // Shop/recruit paths (instView) leave this undefined so the counter stays persistently visible.
    stepEphemeral: true,
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
  // avengeSeen only ticks on a death (a rare board-reflow beat) — cheap to compare, and it's what
  // restarts the avenge counter's fade-in. (bleedAttacks is the GLOBAL attack count stamped on every
  // unit every attack; comparing it here would re-render the whole board each beat — deliberately left
  // out. A bleed unit's counter still refreshes when that unit re-renders for its own attack/buff.)
  a.u.avengeSeen === b.u.avengeSeen &&
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
