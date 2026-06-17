import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
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
  const view: CardView = {
    name: u.name, cardId: u.cardId, tribe: u.tribe, attack: u.attack, health: Math.max(0, u.health),
    keywords: u.keywords, text: CARD_INDEX[u.cardId]?.text ?? '', tier: CARD_INDEX[u.cardId]?.tier,
    baseAttack: CARD_INDEX[u.cardId]?.attack, baseHealth: CARD_INDEX[u.cardId]?.health,
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
