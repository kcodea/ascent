import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { QuestReward, RuneDef } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { Card, mdBold, type CardView } from './Card';
import { Icon } from './Icon';

/** The card ids a rune's reward GRANTS (Pillaging → the Pillager) — for the hover preview. */
function rewardCardIds(r: QuestReward): string[] {
  switch (r.kind) {
    case 'grant': return r.cards ?? [];
    case 'recurringGrant': return r.cards;
    case 'multi': return r.rewards.flatMap(rewardCardIds);
    default: return [];
  }
}

function cardViewOf(id: string): CardView | null {
  const def = CARD_INDEX[id];
  if (!def) return null;
  return {
    name: def.name, cardId: def.id, tribe: def.tribe, tribe2: def.tribe2,
    attack: def.attack, health: def.health, keywords: [...def.keywords], text: def.text,
    goldenText: def.goldenText, tier: def.tier, spell: def.spell, cost: def.cost,
    baseAttack: def.attack, baseHealth: def.health,
  };
}

/**
 * One rune offered in the Runeforge — a stone-carved, engraved tablet: a rune sigil, the name, its Gold cost, and
 * the effect it grants for the run. Bought for its cost on click (greyed when you can't afford it). A rune that
 * grants a minion (Pillaging → a Pillager) floats a full preview of that card on hover, like QuestCard.
 */
export function RuneCard({ rune, affordable, onBuy }: { rune: RuneDef; affordable: boolean; onBuy: () => void }) {
  const rewardCards = rewardCardIds(rune.reward).map(cardViewOf).filter((v): v is CardView => v !== null);
  const hasPreview = rewardCards.length > 0;
  const [tip, setTip] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const timer = useRef<number | null>(null);
  const show = (el: HTMLElement): void => {
    if (!hasPreview) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const gap = 10;
      const cardW = r.width * 0.82;
      const tipW = cardW * rewardCards.length + (rewardCards.length - 1) * gap;
      const flip = r.right + gap + tipW > window.innerWidth - 6;
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const estH = cardW * 1.34;
      const top = Math.max(6, Math.min(r.top, window.innerHeight - estH - 6));
      setTip({ left, top, origin: flip ? 'right' : 'left' });
    }, 220);
  };
  const hide = (): void => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setTip(null);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  return (
    <button
      className={`runecard${affordable ? '' : ' cantafford'}`}
      onClick={affordable ? onBuy : undefined}
      disabled={!affordable}
      onMouseEnter={hasPreview ? (e) => show(e.currentTarget) : undefined}
      onMouseLeave={hasPreview ? hide : undefined}
      aria-label={`${rune.name} — buy for ${rune.cost} Gold`}
    >
      <span className="runecard-sigil" aria-hidden><Icon name="sc" /></span>
      <div className="runecard-head">
        <div className="runecard-name">{rune.name}</div>
        <div className="runecard-cost" title={`Costs ${rune.cost} Gold`}><Icon name="ember" />{rune.cost}</div>
      </div>
      <div className="runecard-body">
        <div className="runecard-txt" dangerouslySetInnerHTML={{ __html: mdBold(rune.text) }} />
      </div>
      {!affordable && <div className="runecard-lock">Not enough Gold</div>}
      {tip && hasPreview && createPortal(
        <div className="cardref questref" style={{ left: tip.left, top: tip.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${tip.origin} center` } as CSSProperties}>
            {rewardCards.map((rv, i) => (
              <Card key={`${rv.cardId ?? i}-${i}`} card={rv} forceFull suppressPop />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </button>
  );
}
