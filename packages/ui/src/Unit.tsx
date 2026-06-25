import { memo } from 'react';
import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { cryptDrakeText, summonBuffText } from './cardText';
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
}

const sameKeywords = (a: string[], b: string[]): boolean =>
  a === b || (a.length === b.length && a.every((k, i) => k === b[i]));

/** A combat unit — the same Card as recruit, wrapped for animations, floats, and the DS ring. */
function UnitInner({ u, side, anim, floats }: UnitProps) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const def = CARD_INDEX[u.cardId];
  const goldMul = u.golden ? 2 : 1;
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2, attack: u.attack, health: Math.max(0, u.health),
    keywords: u.keywords, golden: u.golden,
    // Summon-buff cards (Kennelmaster) show their live magnitude — `summonBonus` can climb
    // mid-fight via Avenge, so the combat card updates too.
    text: summonBuffText(u.cardId, u.summonBonus) ?? cryptDrakeText(u.cardId, u.golden, u.attackSeen ?? 0) ?? def?.text ?? '',
    goldenText: def?.goldenText,
    tier: def?.tier,
    // Two thresholds in combat: green above the *printed* base (it's buffed), red below the *floor* it
    // entered the fight with (it's been damaged/debuffed). So a recruit-buffed 5/5 stays green until
    // it's chipped below 5 — it doesn't flip to red/neutral the instant combat begins.
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
    floorAttack: u.baseAttack, floorHealth: u.baseHealth,
  };
  return (
    <div className={cls} data-uid={u.uid}>
      <Card card={view} />
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
  a.floats === b.floats &&
  a.u.uid === b.u.uid &&
  a.u.attack === b.u.attack &&
  a.u.health === b.u.health &&
  a.u.divineShield === b.u.divineShield &&
  a.u.golden === b.u.golden &&
  a.u.summonBonus === b.u.summonBonus &&
  a.u.attackSeen === b.u.attackSeen &&
  a.u.name === b.u.name &&
  a.u.cardId === b.u.cardId &&
  a.u.tribe === b.u.tribe &&
  a.u.baseAttack === b.u.baseAttack &&
  a.u.baseHealth === b.u.baseHealth &&
  sameKeywords(a.u.keywords, b.u.keywords),
);
