import type { PackCard } from '@game/progression';
import { RARITY_LABELS } from '@game/progression';
import type { StageRect } from '../../stage';
import { rewardPreview } from '../rewardPreview';

/**
 * PLACEHOLDER card face (Task 7). Shows the reward's name and the server's rarity; Task 8 replaces this component with
 * the real face (art, frame, second-half rotation). `rect` is the card's flat rect in STAGE px (from `rectToStage`);
 * without it the face sits inline (the reduced-motion row).
 */
export function PackCardFace({ card, rect }: { card: PackCard; rect?: StageRect | null }) {
  const label = rewardPreview(card.rewardId).label;
  const style = rect ? { left: rect.left, top: rect.top, width: rect.width, height: rect.height } : undefined;
  return (
    <div className={`pkop-face r-${card.rarity}${rect ? ' pkop-face-abs' : ''}`} style={style} data-testid="pack-face">
      <span className="pkop-face-name">{label.name}</span>
      <span className="pkop-face-rarity">{RARITY_LABELS[card.rarity]}</span>
      {card.duplicate && <span className="pkop-face-dup">{`Duplicate +${card.duplicate.aether} Aether`}</span>}
    </div>
  );
}
