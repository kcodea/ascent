import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { summonBuffText } from './cardText';
import type { UnitFrame } from './useCombatReplay';

/** Keyword-proc floats (poison/shield/reborn) that bloom big in the card centre, staggered after the
 *  damage number so the two never collide. Damage/buff numbers stay in the HP/stat corner. */
const SYM_KINDS = new Set(['poison', 'shield', 'shieldup', 'reborn', 'rally']);

/** A combat unit — the same Card as recruit, wrapped for animations, floats, and the DS ring. */
export function Unit({
  u, side, anim, floats, lunge,
}: {
  u: UnitFrame;
  side: 'foe' | 'you';
  anim?: string;
  floats?: { id: number; text: string; kind: string }[];
  /** Inline transform that slides the attacker into its target. */
  lunge?: string;
}) {
  const cls = ['unit', side, u.divineShield ? 'ds' : '', anim ?? ''].filter(Boolean).join(' ');
  const def = CARD_INDEX[u.cardId];
  const goldMul = u.golden ? 2 : 1;
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, tribe2: def?.tribe2, attack: u.attack, health: Math.max(0, u.health),
    keywords: u.keywords, golden: u.golden,
    // Summon-buff cards (Kennelmaster) show their live magnitude — `summonBonus` can climb
    // mid-fight via Avenge, so the combat card updates too.
    text: summonBuffText(u.cardId, u.summonBonus) ?? def?.text ?? '',
    goldenText: def?.goldenText,
    tier: def?.tier,
    // Two thresholds in combat: green above the *printed* base (it's buffed), red below the *floor* it
    // entered the fight with (it's been damaged/debuffed). So a recruit-buffed 5/5 stays green until
    // it's chipped below 5 — it doesn't flip to red/neutral the instant combat begins.
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
    floorAttack: u.baseAttack, floorHealth: u.baseHealth,
  };
  return (
    <div className={cls} data-uid={u.uid} style={lunge ? { transform: lunge, zIndex: 10 } : undefined}>
      <Card card={view} />
      {floats?.map((f) => (
        <span key={f.id} className={`float ${f.kind}${SYM_KINDS.has(f.kind) ? ' sym' : ''}`}>{f.text}</span>
      ))}
    </div>
  );
}
