import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { QuestReward, RuneDef } from '@game/core';
import { CARD_INDEX, RUNE_DUP_UNIQUE, runeStacks } from '@game/content';
import { Card, mdBold, type CardView } from './Card';
import { Icon } from './Icon';
import { runeArt } from './art';
import { withImpStats } from './cardText';
import { useGame } from './store';

/** The card ids a rune's reward GRANTS (Pillaging → the Pillager) — for the hover preview. GILDED grants
 *  (Frontline Glory's Gilded Yazzus) are included and marked, so the preview shows the golden card. */
function rewardCardIds(r: QuestReward): { id: string; golden?: boolean }[] {
  switch (r.kind) {
    case 'grant': return [
      ...(r.cards ?? []).map((id) => ({ id })),
      ...(('grantGolden' in r ? r.grantGolden : undefined) ?? []).map((id) => ({ id, golden: true })),
    ];
    case 'recurringGrant': return r.cards.map((id) => ({ id }));
    case 'multi': return r.rewards.flatMap(rewardCardIds);
    default: return [];
  }
}

/** Reward grants first, then `previewCards` — text-referenced cards the reward doesn't grant (owner rule
 *  2026-08-01: a rune that references a card shows it on hover). Deduped by id, grant wins (it may be gilded). */
function previewIdsOf(rune: RuneDef): { id: string; golden?: boolean }[] {
  const out = rewardCardIds(rune.reward);
  for (const id of rune.previewCards ?? []) if (!out.some((x) => x.id === id)) out.push({ id });
  return out;
}

function cardViewOf(id: string, golden = false): CardView | null {
  const def = CARD_INDEX[id];
  if (!def) return null;
  const g = golden ? 2 : 1;
  return {
    name: def.name, cardId: def.id, tribe: def.tribe, tribe2: def.tribe2,
    attack: def.attack * g, health: def.health * g, keywords: [...def.keywords],
    text: golden ? (def.goldenText ?? def.text) : def.text,
    goldenText: def.goldenText, tier: def.tier, spell: def.spell, cost: def.cost, golden,
    baseAttack: def.attack * g, baseHealth: def.health * g,
  };
}

/**
 * One rune offered in the Runeforge — a stone-carved, engraved tablet: a rune sigil, the name, its Gold cost, and
 * the effect it grants for the run. Bought for its cost on click (greyed when you can't afford it). A rune that
 * grants a minion (Pillaging → a Pillager) floats a full preview of that card on hover, like QuestCard.
 */
export function RuneCard({ rune, affordable, onBuy, cost, duplicating }: {
  rune: RuneDef;
  affordable: boolean;
  /** The clicked card's own element comes back with the call so the lock-in ceremony can read its rect at
   *  click time — the forge overlay unmounts the moment the buy resolves, taking the geometry with it. */
  onBuy: (el: HTMLElement | null) => void;
  /** Live price when it differs from the printed one (the forge's pivot discount) — rendered green. */
  cost?: number;
  /** Rune of Duplication is held, so this Epic will be copied on purchase. Runes whose reward cannot express
   *  "more" (a boolean, a whole-object assignment) gain nothing from the copy — say so on the card rather
   *  than letting the player spend the Duplication on a no-op (owner ask 2026-08-06). */
  duplicating?: boolean;
}) {
  const shownCost = cost ?? rune.cost;
  const discounted = shownCost < rune.cost;
  // Live "(X/Y)" for the imp-summoning runes (Brood / Broodpit / Finality): base 1/1 + the run's Imp Aura.
  // Plain parens (wrap=false) — rune text renders through `mdBold`, which doesn't process the green {{…}} marker.
  const impAura = useGame((s) => s.run?.impBuff);
  const rewardCards = previewIdsOf(rune).map((x) => cardViewOf(x.id, x.golden)).filter((v): v is CardView => v !== null);
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

  const art = runeArt(rune.id);
  return (
    <button
      className={`runecard${rune.epic ? ' runecard-epic' : ''}${art ? ' has-art' : ''}${affordable ? '' : ' cantafford'}`}
      onClick={affordable ? (e) => { onBuy(e.currentTarget); } : undefined}
      disabled={!affordable}
      onMouseEnter={hasPreview ? (e) => show(e.currentTarget) : undefined}
      onMouseLeave={hasPreview ? hide : undefined}
      aria-label={`${rune.name} — buy for ${shownCost} Gold`}
    >
      {art && <img className="runecard-art" src={art} alt="" aria-hidden />}
      {/* Gold coin cost, overhanging the top-left corner (like a spell's cost). */}
      <span className={`runecard-cost${discounted ? ' discounted' : ''}`} title={discounted ? `Pivot discount — ${shownCost} Gold (was ${rune.cost})` : `Costs ${shownCost} Gold`}><span className="costn">{shownCost}</span></span>
      <span className="runecard-emblem" aria-hidden><Icon name="sc" /></span>
      <div className="runecard-head">
        <div className="runecard-kicker">{rune.epic ? 'Epic Rune' : 'Rune'}</div>
        <div className="runecard-name">{rune.name}</div>
      </div>
      <div className="runecard-body">
        <div className="runecard-sect">
          {duplicating && !runeStacks(rune) && (
            <div
              className="runecard-nostack"
              title={RUNE_DUP_UNIQUE.has(rune.id)
                ? 'Rune of Duplication will copy this, but a second copy of this rune has no additional effect.'
                : 'This rune does not stack — the Duplication copy instead refunds half its cost in Gold plus a free refresh.'}
            >
              {RUNE_DUP_UNIQUE.has(rune.id) ? 'Does not stack' : 'Copy refunds'}
            </div>
          )}
          <div className="runecard-txt" dangerouslySetInnerHTML={{ __html: mdBold(withImpStats(rune.id, rune.text, impAura, false)) }} />
        </div>
      </div>
      {!affordable && <div className="runecard-lock">Not enough Gold</div>}
      {tip && hasPreview && createPortal(
        <div className="cardref questref" style={{ left: tip.left, top: tip.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${tip.origin} center` } as CSSProperties}>
            {rewardCards.map((rv, i) => (
              <Card key={`${rv.cardId ?? i}-${i}`} card={rv} forceFull suppressPop plated />
            ))}
          </div>
        </div>,
        document.body,
      )}
    </button>
  );
}
