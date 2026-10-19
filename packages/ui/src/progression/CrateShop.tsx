/**
 * THE CRATE SHOP PICKER (Aether, 2026-10-18; spec docs/superpowers/specs/2026-10-18-aether-crate-shop-design.md). The
 * owner chose a TWO-STEP picker over a grid of every crate ("i want to go in a slightly different direction where you
 * purchase a crate of various rarity floors, but then you can pay additional ammounts to focus it into one or more of
 * the various categories"):
 *
 *   step 1  the TIER: five Gem-plate buttons (Standard .. Ancient), each a rarity floor with its price. Hidden in
 *           milestone mode, where the floor is fixed at Legendary.
 *   step 2  the FOCUS: one chip per enabled category, in catalog order. A category with nothing left for this player at
 *           this floor is a disabled chip ("Nothing left to find here"); ticking every available one is no focus.
 *   quote   the crate's name, its odds (only the rarities it can drop) and how many items are still left to find, then
 *           ONE button: the total, or why it cannot be bought (short balance, sold out). A milestone crate with no focus
 *           is free and just reads Open.
 *
 * Two modes, one component:
 *   shop       Buy charges through `buyCrate` FIRST and opens the theatre only on success, so a price error stays here
 *              in the shop (where the new price is) instead of failing inside the theatre. The theatre then gets an
 *              `open` that answers with the purchase it already has.
 *   milestone  a free Legendary crate earned at every 10th level. Open hands the theatre an `open` that asks the server
 *              with the ticked focus and the fee the player saw (`openCrate(id, focus, fee)`); nothing is charged here.
 *
 * GUESTS (owner 2026-10-18, R-PROG-AETHER-02): a guest earns and sees Aether but never spends it. Every spend click
 * (Buy, and a milestone crate's Open, focused or not) calls `onGuest` (the caller shows `CrateSignInGate`) and never
 * reaches the store. The server does not tell guests apart, so this gate IS the rule's client half.
 *
 * TRUST: every number here is a QUOTE for display. The server prices, charges and rolls; the client only names the tier,
 * the focus and the total it showed (a moved price answers `price_changed`, which the store follows with a re-read).
 *
 * PERFORMANCE (the north star): the state is local (a chip toggle re-renders this panel only, never the Collection
 * grid), the quote and the odds are memoized on (tier, focus, owned, economy), the chips are `memo`'d with stable
 * props, and nothing reads layout. Static paint only.
 */
import { memo, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  COSMETIC_CATEGORIES, COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_TIERS, CRATE_TIER_FLOOR, CRATE_TIER_LABELS, RARITY_LABELS,
  availableFocusCategories, crateLabel, quoteCrate, tierOddsPercent, withStarterCosmetics,
  type CosmeticCategory, type CrateRow, type CrateTier,
} from '@game/progression';
import { useGame } from '../store';
import { sfx } from '../sfx';
import type { CrateQueueItem } from './CrateOpener';
import { aetherBalance, buyCrate, mirrorFor, openCrate, refreshEconomy, useProgression, type CrateOpenOutcome } from './progressionStore';
import { ownedIds } from './collectionModel';
import './collection.css';

export type CrateShopMode = { kind: 'shop' } | { kind: 'milestone'; crate: CrateRow };

export interface CrateShopProps {
  mode: CrateShopMode;
  guest: boolean;
  /** A guest's spend: the caller shows CrateSignInGate. */
  onGuest: () => void;
  /** Hand the theatre a one-crate queue whose `open` resolves to the server's answer. */
  onOpen: (item: CrateQueueItem, open: (crateId: string) => Promise<CrateOpenOutcome>) => void;
}

const EMPTY: readonly string[] = [];

/** Only the categories that can drop at all (the feature flag), in catalog order: the chip row. */
const CHIP_CATEGORIES: readonly CosmeticCategory[] = COSMETIC_CATEGORIES.filter((c) => COSMETIC_CATEGORY_DEFS[c].enabled);

/** The server's refusal codes as player-facing sentences. */
export function buyErrorCopy(reason: string): string {
  if (reason === 'price_changed') return 'Prices just changed. Check the new price.';
  if (reason === 'insufficient_aether') return 'Not enough Aether.';
  if (reason === 'sold_out') return 'Nothing left to find in this crate.';
  return "Couldn't buy that crate. Try again.";
}

const FocusChip = memo(function FocusChip({ cat, on, soldOut, onToggle }: {
  cat: CosmeticCategory; on: boolean; soldOut: boolean; onToggle: (cat: CosmeticCategory) => void;
}): JSX.Element {
  return (
    <button
      type="button" className={`colls-shop-chip${on ? ' on' : ''}`} aria-pressed={on} disabled={soldOut}
      aria-description={soldOut ? 'Nothing left to find here' : undefined} onClick={() => onToggle(cat)}
    >
      {COSMETIC_CATEGORY_DEFS[cat].label}
    </button>
  );
});

export function CrateShop({ mode, guest, onGuest, onOpen }: CrateShopProps): JSX.Element {
  const milestone = mode.kind === 'milestone';
  const economy = useProgression((s) => s.economy);
  const balance = useProgression(aetherBalance);
  const catalogEpoch = useProgression((s) => s.catalogEpoch);
  // OWNED: the same source the Collection's album reads (the live account's mirror, plus every player's starter items).
  const mirror = useProgression((s) => s.mirror);
  const userId = useGame((s) => s.account.userId);
  const me = mirrorFor(userId, mirror);
  const owned = useMemo(() => withStarterCosmetics(me ? ownedIds(me) : EMPTY), [me]);

  const [tier, setTier] = useState<CrateTier>('standard');
  const [ticked, setTicked] = useState<ReadonlySet<CosmeticCategory>>(() => new Set());
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const busyRef = useRef(false);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Fresh prices whenever the shop opens (one cheap read; the server prices the purchase regardless).
  useEffect(() => { void refreshEconomy(); }, []);

  const floor = CRATE_TIER_FLOOR[milestone ? 'legendary' : tier];
  // `catalogEpoch` moves when the server retires an item or a category: the pool re-derives.
  const available = useMemo(() => new Set(availableFocusCategories(owned, floor)), [owned, floor, catalogEpoch]);
  // A tick on a category that sold out at THIS floor (the tier moved) is kept, but not priced and not shown as pressed.
  const focus = useMemo(() => CHIP_CATEGORIES.filter((c) => ticked.has(c) && available.has(c)), [ticked, available]);
  const quote = useMemo(
    () => quoteCrate({ tier, focus: focus.length ? focus : null, owned, economy, milestone }),
    [tier, focus, owned, economy, milestone, catalogEpoch],
  );
  const oddsLine = useMemo(() => {
    const odds = tierOddsPercent(floor);
    return COSMETIC_RARITIES.filter((r) => odds[r] > 0).map((r) => `${RARITY_LABELS[r]} ${odds[r]}%`).join(' · ');
  }, [floor]);

  const pickTier = useCallback((t: CrateTier) => { sfx.pulse(); setTier(t); setError(null); }, []);
  const toggle = useCallback((cat: CosmeticCategory) => {
    sfx.pulse();
    setError(null);
    setTicked((prev) => {
      const next = new Set(prev);
      if (next.has(cat)) next.delete(cat); else next.add(cat);
      return next;
    });
  }, []);

  // The crate's name: a milestone crate keeps its own; a shop crate is its tier, plus the focus while it narrows anything.
  const name = mode.kind === 'milestone'
    ? crateLabel(mode.crate)
    : `${CRATE_TIER_LABELS[tier]} Crate${quote?.focus ? ` · ${focus.map((c) => COSMETIC_CATEGORY_DEFS[c].label).join(', ')}` : ''}`;

  const short = quote ? Math.max(0, quote.total - balance) : 0;
  const free = milestone && quote?.total === 0;
  const label = busy ? 'Buying…'
    : !quote ? 'Sold out'
    : free ? 'Open'
    : short > 0 ? `Need ${short} more Aether`
    : `◆ ${quote.total}`;
  const disabled = busy || !quote || short > 0;
  const ariaLabel = quote && !busy && !free && short === 0 ? `${milestone ? 'Open' : 'Buy'} ${name} for ${quote.total} Aether` : undefined;

  const spend = async (): Promise<void> => {
    if (!quote || busyRef.current) return;
    // GUESTS NEVER SPEND (R-PROG-AETHER-02): the sign-in gate, never the store.
    if (guest) { onGuest(); return; }
    setError(null);
    if (mode.kind === 'milestone') {
      const crate = mode.crate;
      const pick = quote.focus;
      const fee = quote.fee;
      const item: CrateQueueItem = { crateId: crate.crateId, earnedLevel: crate.earnedLevel, ...(crate.source ? { source: crate.source } : {}) };
      onOpen(item, (id) => (pick ? openCrate(id, pick, fee) : openCrate(id)));
      return;
    }
    busyRef.current = true;
    setBusy(true);
    const out = await buyCrate(quote.tier, quote.focus, quote.total);
    busyRef.current = false;
    if (!alive.current) return;
    setBusy(false);
    if (out.status !== 'ok') { setError(buyErrorCopy(out.reason)); return; }
    const result = out.result;
    const item: CrateQueueItem = { crateId: result.crate.crateId, earnedLevel: null, ...(result.crate.source ? { source: result.crate.source } : {}) };
    // Already bought and opened: the theatre plays this answer instead of asking again.
    onOpen(item, () => Promise.resolve({ status: 'ok', result }));
  };

  return (
    <section className={`colls-panel colls-shop${milestone ? ' milestone' : ''}`} aria-label={milestone ? 'Open your milestone crate' : 'Crate Shop'}>
      <div className="colls-shop-head">{milestone ? 'Milestone crate' : 'Crate Shop'}</div>
      {mode.kind === 'shop' && (
        <div className="colls-shop-step">
          <div className="colls-shop-lbl">Pick a crate</div>
          <div className="colls-shop-tiers" role="group" aria-label="Crate">
            {CRATE_TIERS.map((t) => (
              <button
                key={t} type="button" className={`colls-shop-tier r-${CRATE_TIER_FLOOR[t]}${tier === t ? ' on' : ''}`} aria-pressed={tier === t}
                onClick={() => pickTier(t)}
              >
                <span className="colls-shop-tier-name">{CRATE_TIER_LABELS[t]}</span>
                <span className="colls-shop-tier-price">◆ {economy.cratePrice[t]}</span>
              </button>
            ))}
          </div>
        </div>
      )}
      <div className="colls-shop-step">
        <div className="colls-shop-lbl">Focus it <span className="colls-shop-opt">(optional)</span></div>
        <div className="colls-shop-chips" role="group" aria-label="Focus">
          {CHIP_CATEGORIES.map((c) => (
            <FocusChip key={c} cat={c} on={ticked.has(c) && available.has(c)} soldOut={!available.has(c)} onToggle={toggle} />
          ))}
        </div>
      </div>
      <div className="colls-shop-quote">
        <div className="colls-shop-name">{name}</div>
        <div className="colls-shop-odds">{oddsLine}</div>
        <div className="colls-shop-left">{quote ? `${quote.remaining} left to find` : 'Nothing left to find'}</div>
      </div>
      {error && <p className="colls-shop-err" role="alert">{error}</p>}
      <button
        type="button" className={`colls-shop-buy${busy ? ' pressed' : ''}`} disabled={disabled} aria-busy={busy || undefined}
        aria-label={ariaLabel} onClick={() => { void spend(); }}
      >
        {label}
      </button>
    </section>
  );
}
