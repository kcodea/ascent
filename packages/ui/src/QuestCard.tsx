import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { QuestDef, QuestReward, Tribe } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { Card, type CardView } from './Card';
import { Icon } from './Icon';
import { questArt } from './art';
import { questObjectiveText, questRewardText } from './questText';

const TIER_LABEL: Record<QuestDef['tier'], string> = { lesser: 'Lesser', greater: 'Greater', capstone: 'Capstone' };
/** Each tribe's emblem glyph — the canonical set (mirrors Card.tsx's footer icons). */
const TRIBE_ICON: Record<Tribe, string> = { beast: 'paw', dragon: 'flame', mech: 'gear', undead: 'skull', demon: 'eye', neutral: 'star' };

/** The specific card ids a reward GRANTS (named minions/spells) — for the hover preview. Random-tribe /
 *  random-filter grants have no fixed card, so they contribute nothing. `multi` recurses into its sub-rewards. */
function rewardCardIds(r: QuestReward): string[] {
  switch (r.kind) {
    case 'grant': return r.cards ?? [];
    case 'recurringGrant': return r.cards;
    case 'multi': return r.rewards.flatMap(rewardCardIds);
    default: return [];
  }
}

/** Build a full CardView from a card def id (base stats; the reward grants a fresh copy). */
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
 * One quest offered in the quest shop — an art-forward, tribe-framed card: a top tribe emblem, crisp full-bleed
 * art, dark objective/reward panels, and a bottom gem. "Bought" for 0 Gold on click; slots into the tavern `.row`.
 * Hovering a quest that grants a named minion/spell floats a full preview of that card (reusing the Card hover
 * popup), so the player sees exactly what they'll get.
 */
export function QuestCard({ quest, onBuy }: { quest: QuestDef; onBuy: () => void }) {
  const c = quest.tribe === 'neutral' ? 'var(--t-neutral)' : `var(--t-${quest.tribe})`;
  const art = questArt(quest.id);
  const rewardCards = rewardCardIds(quest.reward).map(cardViewOf).filter((v): v is CardView => v !== null);
  const hasPreview = rewardCards.length > 0;
  const [tip, setTip] = useState<{ left: number; top: number; origin: 'left' | 'right' } | null>(null);
  const timer = useRef<number | null>(null);
  // Open after a short hover; measured on open so it tracks the card. Floats to the right, flipping left if it
  // would run off-screen — mirrors the Card component's referenced-card popup.
  const show = (el: HTMLElement): void => {
    if (!hasPreview) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = el.getBoundingClientRect();
      const n = rewardCards.length;
      const gap = 10;
      const cardW = r.width * 0.82; // reward previews render at roughly a warband card's width
      const tipW = cardW * n + (n - 1) * gap;
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
      className={`questcard${art ? ' has-art' : ''}`}
      style={{ '--c': c } as CSSProperties}
      onClick={onBuy}
      onMouseEnter={hasPreview ? (e) => show(e.currentTarget) : undefined}
      onMouseLeave={hasPreview ? hide : undefined}
      title={`${quest.name} — take this quest (free)`}
    >
      {art && <img className="questcard-art" src={art} alt="" aria-hidden />}
      <span className="questcard-emblem" aria-hidden><Icon name={TRIBE_ICON[quest.tribe]} /></span>
      <div className="questcard-head">
        <div className="questcard-tier">{TIER_LABEL[quest.tier]} · {quest.tribe}</div>
        <div className="questcard-name">{quest.name}</div>
      </div>
      <div className="questcard-body">
        <div className="questcard-sect">
          <div className="questcard-lbl"><Icon name="target" /> Objective</div>
          <div className="questcard-txt">{questObjectiveText(quest.objective)}</div>
        </div>
        <div className="questcard-sect reward">
          <div className="questcard-lbl"><Icon name="gift" /> Reward</div>
          <div className="questcard-txt">{questRewardText(quest.reward)}{quest.repeatable ? ' · Repeatable' : ''}</div>
        </div>
      </div>
      <span className="questcard-gem" aria-hidden />
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
