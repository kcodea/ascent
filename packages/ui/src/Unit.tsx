import { memo } from 'react';
import { CARD_INDEX } from '@game/content';
import { spellAttackBonus, spellHealthBonus } from '@game/sim';
import { Card, type CardView } from './Card';
import { ascendProgressText, cryptDrakeText, engraveTallyText, guelProgressText, sergeantText, summonBuffText, summonImproveText, summonScalingText, tallyBuffText, taragosaText } from './cardText';
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
}

const sameKeywords = (a: string[], b: string[]): boolean =>
  a === b || (a.length === b.length && a.every((k, i) => k === b[i]));

/** A combat unit — the same Card as recruit, wrapped for animations, floats, and the DS ring. */
function UnitInner({ u, side, anim, floats, triggered }: UnitProps) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const def = CARD_INDEX[u.cardId];
  const goldMul = u.golden ? 2 : 1;
  // The run's spell power (frozen during combat — the fight hasn't settled) so Taragosa's Growth text reflects
  // the same value the combat used. Primitive selectors → the memoized Unit only re-renders if they change.
  const spA = useGame((s) => spellAttackBonus(s.run));
  const spH = useGame((s) => spellHealthBonus(s.run));
  // Run-level scalers, frozen during combat (read like spell power above) so a Grim / Guel / Spirit Worgen
  // shows the same magnitude the fight used: the run Deathrattle tally, spells cast this run, spells this turn.
  const drTally = useGame((s) => s.run.deathrattlesTriggered);
  const spellsCast = useGame((s) => s.run.spellsCast);
  const spellsThisTurn = useGame((s) => s.run.spellsThisTurn);
  // Combat live text — show current values for minions whose effects scale mid-fight (per-minion accruals)
  // or with frozen run-level scalers (Grim/Guel/Worgen, like Taragosa's spell power). Mirrors the shop chain.
  const liveText = summonBuffText(u.cardId, u.summonBonus)
    ?? summonImproveText(u.cardId, u.summonBonus, u.golden) // Mama Bear: live "+M/+M per summon" (climbs via improve events)
    ?? summonScalingText(u.cardId, spellsThisTurn) // Spirit Worgen: per-summon gain scales with spells cast this turn
    ?? cryptDrakeText(u.cardId, u.golden, u.attackSeen ?? 0)
    ?? ascendProgressText(u.cardId, u.ascendProgress ?? 0)
    ?? sergeantText(u.cardId, u.golden, u.hpGrantBonus ?? 0)
    ?? tallyBuffText(u.cardId, drTally) // Grim: live "+N/+N" from the run Deathrattle tally
    ?? guelProgressText(u.cardId, u.golden, spellsCast) // Guel: live grant + countdown from spells cast this run
    ?? taragosaText(u.cardId, u.golden, spA, spH)
    ?? engraveTallyText(u.cardId, u.permaGain)
    ?? def?.text ?? '';
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2, attack: u.attack, health: Math.max(0, u.health),
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
      <Card card={view} pulse={triggered} />
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
  a.u.permaGain?.attack === b.u.permaGain?.attack &&
  a.u.permaGain?.health === b.u.permaGain?.health &&
  a.u.name === b.u.name &&
  a.u.cardId === b.u.cardId &&
  a.u.tribe === b.u.tribe &&
  a.u.baseAttack === b.u.baseAttack &&
  a.u.baseHealth === b.u.baseHealth &&
  sameKeywords(a.u.keywords, b.u.keywords),
);
