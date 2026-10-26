import { useEffect, useRef, useState } from 'react';
import { createPortal } from 'react-dom';
import type { CSSProperties } from 'react';
import type { Keyword, QuestReward, RuneDef, Tribe } from '@game/core';
import { CARD_INDEX, RUNE_DUP_UNIQUE, runeStacks } from '@game/content';
import { Card, mdBold, type CardView } from './Card';
import { Icon } from './Icon';
import { runeArt } from './art';
import { withImpStats } from './cardText';
import { KeywordDefs } from './KeywordDefs';
import { detectCardKeywords } from './detectCardKeywords';
import { useGame } from './store';
import { liveRuneText } from './runeText';
import { usePlayerRuneLive } from './useRuneLive';
import { rectToStage, stageHost, stageViewport } from './stage';
import { useFitRefPopup, type RefPopupPos } from './useFitRefPopup';
import { isTouchDevice, lastPointerWasTouch } from './touchInput';
import { openRuneInspect } from './runeInspectStore';
import { useSpectate } from './versus/spectate';

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
 *  2026-08-01: a rune that references a card shows it on hover). ONE preview per card (owner report 2026-10-23,
 *  Lantern Keeper: "this doesnt need both previews"): a reward that grants the same card twice (a `grant` now plus
 *  a `recurringGrant` of it, the Rare Goods shape) or names it again in `previewCards` previews it once. Deduped
 *  by id + gilding (a gilded grant is a different-looking card); the grant wins over `previewCards`. */
export function previewIdsOf(rune: Pick<RuneDef, 'reward' | 'previewCards'>): { id: string; golden?: boolean }[] {
  const out: { id: string; golden?: boolean }[] = [];
  for (const x of rewardCardIds(rune.reward)) if (!out.some((y) => y.id === x.id && !!y.golden === !!x.golden)) out.push(x);
  for (const id of rune.previewCards ?? []) if (!out.some((x) => x.id === id)) out.push({ id });
  return out;
}

/** A rune's ACCENT tribe (owner 2026-10-07: rune text follows the tribe colours): its tribe gate's first tribe, the
 *  same `--t-<tribe>` hue a card of that tribe wears. An ungated rune, or one gated to three or more tribes (a
 *  generalist), takes the neutral palette. Shared with the rune rack so a badge and its card agree. */
export function runeAccentTribe(rune: Pick<RuneDef, 'tribes'>): Tribe {
  const t = rune.tribes;
  return t && t.length > 0 && t.length < 3 ? t[0]! : 'neutral';
}

/** Runes carry no badge keywords — one stable empty list so `KeywordDefs`' memo key never churns. */
const NO_KEYWORDS: Keyword[] = [];

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

/** The cards a rune previews (its reward's grants, then `previewCards`), as card views: its hover preview and the
 *  touch RuneInspect. */
export function runeRewardViews(rune: Pick<RuneDef, 'reward' | 'previewCards'>): CardView[] {
  return previewIdsOf(rune).map((x) => cardViewOf(x.id, x.golden)).filter((v): v is CardView => v !== null);
}

/**
 * One rune offered in the Runeforge — a stone-carved, engraved tablet: a rune sigil, the name, its Gold cost, and
 * the effect it grants for the run. Bought for its cost on click (greyed when you can't afford it). A rune that
 * grants a minion (Pillaging → a Pillager) floats a full preview of that card on hover, like QuestCard.
 */
export function RuneCard({ rune, affordable, onBuy, cost, duplicating, pickSfx }: {
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
  /** This card is a real PICK (the forge), so pressing it plays the pick cue instead of the click thock (see
   *  `sfx.pickPress`). Off everywhere a RuneCard is only shown — the Compendium, a preview, the ceremony's clones. */
  pickSfx?: boolean;
}) {
  const shownCost = cost ?? rune.cost;
  const discounted = shownCost < rune.cost;
  // Live "(X/Y)" for the imp-summoning runes (Brood / Broodpit / Finality): base 1/1 + the run's Imp Aura.
  // Plain parens (wrap=false) — rune text renders through `mdBold`, which doesn't process the green {{…}} marker.
  const impAura = useGame((s) => s.run?.impBuff);
  // A self-improving rune the run already grew (a second copy, a re-offer) prints its CURRENT value, never the base
  // (R-RUNE-LIVE-TEXT-01). An unowned rune has no live state and reads exactly as printed.
  const runeLive = usePlayerRuneLive();
  const rewardCards = runeRewardViews(rune);
  // The glossary pills a rune's text raises (Amplified, Equip, Rebirth, …) — the same `KeywordDefs` column a card
  // hover shows, so a term is explained wherever it is printed (owner ask 2026-09-18). Runes carry no badges.
  const kwCard = { keywords: NO_KEYWORDS, text: rune.text };
  const hasDefs = detectCardKeywords(kwCard).length > 0;
  const hasPreview = rewardCards.length > 0 || hasDefs;
  const [tip, setTip] = useState<RefPopupPos | null>(null);
  const timer = useRef<number | null>(null);
  // The estimate below opens the chain; the measured pass re-places it on the REAL width (player report
  // 2026-10-08: the Lasso spell ran off screen when the Rune of Lassoing was the rightmost offer).
  const popRef = useRef<HTMLDivElement | null>(null);
  useFitRefPopup(popRef, tip, setTip);
  const show = (el: HTMLElement): void => {
    if (!hasPreview) return;
    if (timer.current) window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => {
      const r = rectToStage(el.getBoundingClientRect()); // stage px (stage.ts): written as the tip's CSS left/top
      const vp = stageViewport();
      const gap = 10;
      const cardW = r.width * 0.82;
      // The defs column is `min(144px, 25vw)` wide (styles.css) and sits after the cards, zoomed like them.
      const defsW = hasDefs ? Math.min(144, vp.w * 0.25) * 1.52 : 0;
      const tipW = cardW * rewardCards.length + Math.max(0, rewardCards.length - 1) * gap + (hasDefs && rewardCards.length ? gap : 0) + defsW;
      const flip = r.right + gap + tipW > vp.w - 6;
      const left = flip ? Math.max(6, r.left - gap - tipW) : r.right + gap;
      const estH = cardW * 1.34;
      const top = Math.max(6, Math.min(r.top, vp.h - estH - 6));
      setTip({ left, top, origin: flip ? 'right' : 'left', anchorLeft: r.left, anchorRight: r.right, prefTop: r.top });
    }, 220);
  };
  const hide = (): void => {
    if (timer.current) { window.clearTimeout(timer.current); timer.current = null; }
    setTip(null);
  };
  useEffect(() => () => { if (timer.current) window.clearTimeout(timer.current); }, []);

  const art = runeArt(rune.id);
  const accent = runeAccentTribe(rune);
  return (
    <button
      className={`runecard${rune.epic ? ' runecard-epic' : ''}${art ? ' has-art' : ''}${affordable ? '' : ' cantafford'}`}
      data-tribe={accent}
      data-spec={`runecard:${rune.id}`} // the spectator cursor / hover anchor (versus/cursorSpace.ts)
      style={{ '--rt': `var(--t-${accent})` } as CSSProperties}
      // A viewer (a replay, or a spectator hovering the watched player's forge, R-SPECTATE-RUNEHOVER-01) reads, never picks.
      // TOUCH (owner 2026-10-26, R-TOUCH-TAPSELECT-01: "tapping in a discover/etc should select"): a finger TAP on a forge
      // offer buys it, as a click does; a HOLD (the long-press right-click) opens its enlarged view (RuneInspect), whose
      // Pick buys it. So an offer you cannot afford stays pressable on a touch device (to hold and read it), never buyable.
      onClick={pickSfx || affordable ? (e) => {
        if (useGame.getState().replaying) return;
        if (affordable) onBuy(e.currentTarget);
      } : undefined}
      onContextMenu={pickSfx ? (e) => {
        if (!lastPointerWasTouch()) return; // a mouse right-click is unchanged
        e.preventDefault();
        const el = e.currentTarget;
        const viewer = useSpectate.getState().active || useGame.getState().replaying;
        openRuneInspect({ rune, cost, duplicating, affordable: affordable && !viewer, pick: () => { if (el.isConnected) onBuy(el); } });
      } : undefined}
      disabled={!affordable && !(pickSfx && isTouchDevice())}
      data-pick-sfx={pickSfx || undefined}
      onMouseEnter={hasPreview ? (e) => show(e.currentTarget) : undefined}
      onMouseLeave={hasPreview ? hide : undefined}
      aria-label={`${rune.name}: buy for ${shownCost} Gold`}
    >
      {/* THE RUNE CARD (owner 2026-10-07, built only from the game's UI primitives): a tall tribe-tinted card in a gold
          rim whose top half is the rune's FULL art ("i want the top half of this to be the full art, with it blurring
          in a gradient downward"), blurring and fading into the body; then the name, a divider and the rules
          (runeCard.css). `decoding="sync"`: paint the art WITH the card in the same frame (the lock-in clones are new
          image elements; an async decode blinked one empty frame at the hand-off, owner report 2026-08-31). */}
      <span className="runecard-face" aria-hidden>
        <span className="runecard-hero">
          {art
            ? <><img className="rh-blur" src={art} alt="" decoding="sync" /><img className="rh-art" src={art} alt="" decoding="sync" /></>
            : <span className="rh-noart"><Icon name="engrave" /></span>}
        </span>
      </span>
      <span className="runecard-window" aria-hidden />
      <span className={`runecard-cost${discounted ? ' discounted gtip' : ''}`} aria-label={discounted ? `Pivot discount: ${shownCost} Gold, down from ${rune.cost}` : `Costs ${shownCost} Gold`} data-tip={discounted ? `Pivot discount: ${shownCost} Gold, down from ${rune.cost}` : undefined}><span className="costn">{shownCost}</span></span>
      <div className="runecard-head">
        <div className="runecard-name">{rune.name}</div>
        <span className="runecard-divider" aria-hidden />
      </div>
      <div className="runecard-body">
        <div className="runecard-sect">
          {duplicating && !runeStacks(rune) && (
            <div
              className="runecard-nostack gtip"
              aria-description={RUNE_DUP_UNIQUE.has(rune.id)
                ? 'Duplication will copy this, but a second copy of this rune has no additional effect.'
                : 'This rune does not stack. The Duplication copy instead refunds half its cost in Gold plus a free refresh.'}
              data-tip={RUNE_DUP_UNIQUE.has(rune.id)
                ? 'Duplication will copy this, but a second copy of this rune has no additional effect.'
                : 'This rune does not stack. The Duplication copy instead refunds half its cost in Gold plus a free refresh.'}
            >
              {RUNE_DUP_UNIQUE.has(rune.id) ? 'Does not stack' : 'Copy refunds'}
            </div>
          )}
          <div className="runecard-txt" dangerouslySetInnerHTML={{ __html: mdBold(withImpStats(rune.id, liveRuneText(rune.id, rune.text, runeLive), impAura, false)) }} />
        </div>
      </div>
      {!affordable && <div className="runecard-lock">Not enough Gold</div>}
      {tip && hasPreview && createPortal(
        <div className="cardref questref" ref={popRef} style={{ left: tip.left, top: tip.top } as CSSProperties}>
          <div className="cardref-inner" style={{ transformOrigin: `${tip.origin} center` } as CSSProperties}>
            {rewardCards.map((rv, i) => (
              <Card key={`${rv.cardId ?? i}-${i}`} card={rv} forceFull suppressPop plated />
            ))}
            {hasDefs && <KeywordDefs card={kwCard} />}
          </div>
        </div>,
        stageHost(),
      )}
    </button>
  );
}
