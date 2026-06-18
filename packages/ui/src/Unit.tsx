import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { summonBuffText } from './cardText';
import type { UnitFrame } from './useCombatReplay';

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
    tier: def?.tier,
    baseAttack: (def?.attack ?? 0) * goldMul, baseHealth: (def?.health ?? 0) * goldMul,
  };
  return (
    <div className={cls} data-uid={u.uid} style={lunge ? { transform: lunge, zIndex: 10 } : undefined}>
      <Card card={view} />
      {floats?.map((f) => (
        <span key={f.id} className={`float ${f.kind}`}>{f.text}</span>
      ))}
    </div>
  );
}
