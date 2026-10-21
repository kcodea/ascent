/**
 * THE CHEST SHOP SCREEN (2026-10-20; spec docs/superpowers/specs/2026-10-20-chest-shop-screen-design.md, the approved
 * mockup next to it). The owner moved the shop out of the Collection's sidebar ("i want a shop button that leads to a
 * dedicated full screen experience for selecting the chest and focusing it"): a full-screen mode of the Collection page,
 * top to bottom:
 *
 *   top bar      "◀ Collection" (and Esc) back to the Collection, the title, the Aether wallet.
 *   PICK A CHEST five painted chest cards (`ChestPicture`), each with its live price; hover a card for its guarantee and
 *                its published odds (`tierOddsPercent`). Standard is picked when the screen opens.
 *   FOCUS CHEST  one row per focusable category in the shop's order (`shopFocusCategories`: never Announcers), its count
 *                left to find at the picked chest's floor, and an Off / "✓ On" toggle. A category with nothing left at
 *                this floor keeps its row (the list never reflows), reads 0 and "None left", and is disabled; a tick on
 *                it (made at a lower tier) is kept, but not priced or shown.
 *   YOUR CHEST   the receipt (`focusReceipt`: the first focus carries the cost, each later one its discount, in row
 *                order), the live odds bar (`oddsSlices`: this exact chest's floor, focus and what is still unowned), and
 *                one big button: "Open Chest" with the total, or why it cannot be bought (short balance, sold out).
 *
 * EVERYTHING TICKED is no focus (owner ruling 2026-10-20): free, and the chest can still give an Announcer. The receipt
 * keeps its Focusing rows (they sum to 0) and says so in one line; the odds come from the unfocused pool, Announcers in.
 *
 * Buy charges through `buyCrate` FIRST and opens the theatre only on success, so a price error stays here in the shop
 * (where the new price is) instead of failing inside the theatre. The theatre then gets an `open` that answers with the
 * purchase it already has. After a purchase the player comes back to this screen: same tier, focus cleared.
 *
 * GUESTS (owner 2026-10-18, R-PROG-AETHER-02): a guest earns and sees Aether but never spends it. Every Buy calls
 * `onGuest` (the caller shows `CrateSignInGate`) and never reaches the store. The server does not tell guests apart, so
 * this gate IS the rule's client half. A guest's button stays ENABLED at the price whatever the balance (ruling
 * 2026-10-19): "Need N more Aether" would tell a guest to go earn Aether they still could not spend, when what they need
 * is an account. Only a sold-out chest disables it.
 *
 * ONCE PER CLICK: a fast double click never buys twice (the busy ref, set before the first await). While a purchase
 * runs, `onBusy` tells the caller so it can hold every control that would start a second theatre over the reveal, and
 * this screen holds its own way out (Back is disabled and Esc does nothing until the answer comes).
 *
 * TRUST: every number here is a QUOTE for display. The server prices, charges and rolls; the client only names the tier,
 * the focus and the total it showed (a moved price answers `price_changed`, which the store follows with a re-read). The
 * receipt is built so its rows always add up to the quote's fee (see `receiptRows`), and Total IS `quote.total`.
 *
 * NEVER CHARGED TWICE (final review 2026-10-19): a purchase whose answer never came (a timeout, a network error, a 5xx)
 * may have landed on the server. The screen keeps that attempt's request id, keyed by (tier, canonical focus, total),
 * until a DEFINITE answer (success, or a 4xx refusal: `isDefiniteBuyFailure`), and a retry of the same picks sends the
 * SAME id: a purchase that did land answers `already_opened` with its reward and the reveal plays; one that did not is
 * bought now. Changing the picks drops the kept id. The store re-reads the balance and the crates after such a failure.
 *
 * THE SERVER'S KILL SWITCH: a category or item the server has switched off is not in the shop's pool
 * (`eligibleForCrate` reads `setServerCatalogState`), so it has no row and is not counted or priced. The store's
 * `catalogEpoch` moves whenever that state does; every pool memo below lists it so the pool re-derives.
 *
 * PERFORMANCE (the north star): the state is local (a toggle re-renders this screen only, never the Collection grid),
 * the quote, the odds and the counts are memoized (on the picks, owned, the economy and the catalog state), the cards
 * and the rows are `memo`'d with stable props, and nothing reads layout. Static paint here; the celebrations (Task 4)
 * attach to each card (`.cshop-chest`) and each row / toggle (`.cshop-cat`, `.cshop-toggle`), which stay mounted.
 */
import { memo, useCallback, useEffect, useId, useMemo, useRef, useState, type ReactNode } from 'react';
import {
  COSMETIC_CATEGORY_DEFS, COSMETIC_RARITIES, CRATE_TIERS, CRATE_TIER_FLOOR, CRATE_TIER_LABELS, RARITY_LABELS,
  availableFocusCategories, quoteCrate, tierOddsPercent, withStarterCosmetics,
  type CosmeticCategory, type CosmeticRarity, type CrateQuote, type CrateTier,
} from '@game/progression';
import { useGame } from '../store';
import { sfx } from '../sfx';
import type { CrateQueueItem } from './CrateOpener';
import { CHEST_TIERS, chestTierOf } from './crateFx/chestTiers';
import { warmChestArt } from './crateFx/chestArt';
import {
  aetherBalance, buyCrate, isDefiniteBuyFailure, mintRequestId, mirrorFor, refreshEconomy, useProgression, type CrateOpenOutcome,
} from './progressionStore';
import { ownedIds } from './collectionModel';
import { focusReceipt, leftByCategory, oddsSlices, shopFocusCategories, type OddsSlice, type ReceiptRow } from './chestShopModel';
import { ChestPicture } from './ChestPicture';
import { AetherIcon } from './AetherIcon';
import './collection.css';
import './chestShop.css';

export interface CrateShopProps {
  guest: boolean;
  /** A guest's spend: the caller shows CrateSignInGate. */
  onGuest: () => void;
  /** Hand the theatre a one-crate queue whose `open` resolves to the server's answer. */
  onOpen: (item: CrateQueueItem, open: (crateId: string) => Promise<CrateOpenOutcome>) => void;
  /** A purchase started (true) or ended (false), whether or not this screen is still mounted. */
  onBusy?: (busy: boolean) => void;
  /** Back to the Collection ("◀ Collection", or Esc). Never called while a purchase runs. */
  onBack: () => void;
  /** The page's reduced-motion setting: no one-shots, nothing breathing (the states still read). */
  reducedMotion?: boolean;
}

const EMPTY: readonly string[] = [];

/** The server's refusal codes as player-facing sentences. A failure that is not a definite answer (the purchase may have
 *  landed) says so, and that a retry is safe (it reuses the request id). */
export function buyErrorCopy(reason: string): string {
  if (reason === 'price_changed') return 'Prices just changed. Check the new price.';
  if (reason === 'insufficient_aether') return 'Not enough Aether.';
  if (reason === 'sold_out') return 'Nothing left to find in this chest.';
  if (!isDefiniteBuyFailure(reason)) return "Couldn't confirm that purchase. Try again: you won't be charged twice.";
  return "Couldn't buy that chest. Try again.";
}

/** A purchase's identity for the kept request id: the tier, the canonical focus and the total (a moved price is a new
 *  purchase, not a retry). */
const purchaseKey = (q: { tier: CrateTier; focus: readonly CosmeticCategory[] | null; total: number }): string => `${q.tier}|${q.focus?.join(',') ?? ''}|${q.total}`;

/** "a Rare", "an Epic". */
const article = (word: string): string => (/^[aeiou]/i.test(word) ? 'an' : 'a');

/** The minus sign the receipt's discounts wear (U+2212, not a hyphen or a dash). */
const MINUS = '−';

/**
 * The receipt rows for the picks, held to the quote: `focusReceipt` uses the same floor division as `quoteCrate`, so its
 * rows sum to `quote.fee`; if a future change ever made them drift, the last row absorbs the difference (spec: "the
 * receipt follows `quoteCrate`"), so the rows always add up to what is charged.
 */
function receiptRows(price: number, ticked: readonly CosmeticCategory[], available: number, quote: CrateQuote | null, economy: Parameters<typeof focusReceipt>[0]['economy']): { rows: ReceiptRow[]; noFocus: boolean } | null {
  const r = focusReceipt({ price, ticked, available, economy });
  if (!r || !quote) return r;
  const diff = quote.fee - r.rows.reduce((n, x) => n + x.amount, 0);
  if (diff === 0) return r;
  const rows = r.rows.slice();
  const last = rows[rows.length - 1]!;
  rows[rows.length - 1] = { ...last, amount: last.amount + diff };
  return { ...r, rows };
}

/** One receipt amount: "+400" for the focus cost, "−160" for a discount, plain "0" for nothing (never "−0"). */
function Amount({ value, cost }: { value: number; cost?: boolean }): JSX.Element {
  const sign = value > 0 && cost ? '+' : value < 0 ? MINUS : '';
  return <span className="cshop-amt">{sign}<AetherIcon />{Math.abs(value)}</span>;
}

/** Each tier's hover tip: its guarantee and its published odds (static: they depend only on the floor). */
interface TierTip { guarantee: string; odds: { rarity: CosmeticRarity; pct: number }[] }
const TIER_TIP: Readonly<Record<CrateTier, TierTip>> = Object.fromEntries(
  CRATE_TIERS.map((t) => {
    const floor = CRATE_TIER_FLOOR[t];
    const pct = tierOddsPercent(floor);
    return [t, {
      guarantee: floor === 'common' ? 'Any rarity can drop' : `Guarantees ${RARITY_LABELS[floor]} or better`,
      odds: COSMETIC_RARITIES.filter((r) => pct[r] > 0).map((rarity) => ({ rarity, pct: pct[rarity] })),
    }];
  }),
) as Record<CrateTier, TierTip>;

/** One chest card: the painted chest, its name in its tier colour, its price; the tip below it on hover (and on a tap,
 *  through the `.tt-on` twin). The card is the stable host the pick celebration attaches to. */
const ChestCard = memo(function ChestCard({ tier, price, on, onPick }: {
  tier: CrateTier; price: number; on: boolean; onPick: (t: CrateTier) => void;
}): JSX.Element {
  const tipId = useId();
  const chest = chestTierOf(CRATE_TIER_FLOOR[tier]);
  const tip = TIER_TIP[tier];
  const label = CRATE_TIER_LABELS[tier];
  return (
    <button
      type="button" className={`cshop-chest t-${chest}${on ? ' on' : ''}`} aria-pressed={on} aria-describedby={tipId}
      aria-label={`${label} Chest, ${price} Aether`} onClick={() => onPick(tier)}
    >
      <span className="cshop-chest-fx" aria-hidden="true" />
      <span className="cshop-chest-check" aria-hidden="true">✓</span>
      <span className="cshop-chest-art"><ChestPicture tier={chest} /></span>
      <span className="cshop-chest-name">{label}</span>
      <span className="cshop-gem cshop-chest-price"><AetherIcon />{price}</span>
      <span className="atip cshop-pop" role="tooltip" id={tipId}>
        <span className="atip-title">{label} Chest</span>
        <span className="cshop-guar">{tip.guarantee}</span>
        <span className="cshop-orows">
          {tip.odds.map(({ rarity, pct }) => (
            <span key={rarity} className={`cshop-orow r-${rarity}`}><span className="cshop-orow-name">{RARITY_LABELS[rarity]}</span><span>{pct}%</span></span>
          ))}
        </span>
      </span>
    </button>
  );
});

/** One focus row: the category, its count left to find at this floor, its toggle. The row (and the toggle in it) is the
 *  stable host the toggle-on celebration attaches to. */
const FocusRow = memo(function FocusRow({ cat, left, on, soldOut, onToggle }: {
  cat: CosmeticCategory; left: number; on: boolean; soldOut: boolean; onToggle: (cat: CosmeticCategory) => void;
}): JSX.Element {
  const label = COSMETIC_CATEGORY_DEFS[cat].label;
  return (
    <div className={`cshop-cat${on ? ' on' : ''}${soldOut ? ' out' : ''}`} data-cat={cat}>
      <span className="cshop-cat-name">{label}</span>
      <span className="cshop-cat-left">{left}</span>
      <button
        type="button" className="cshop-toggle" aria-pressed={on} disabled={soldOut} aria-label={`Focus ${label}`}
        aria-description={soldOut ? 'Nothing left to find here' : undefined} onClick={() => onToggle(cat)}
      >
        {soldOut ? 'None left' : on ? <><span className="cshop-ck" aria-hidden="true">✓</span> On</> : 'Off'}
      </button>
    </div>
  );
});

/** One odds slice: the rarity's share, only its percent inside; its tip names the categories it can come from. */
const OddsSeg = memo(function OddsSeg({ slice }: { slice: OddsSlice }): JSX.Element {
  const tipId = useId();
  const name = RARITY_LABELS[slice.rarity];
  return (
    <span
      className={`cshop-seg r-${slice.rarity}`} style={{ flex: `${slice.percent} 1 0` }} tabIndex={0} role="img"
      aria-label={`${name} ${slice.percent}%`} aria-describedby={tipId}
    >
      <span className="cshop-seg-pct">{slice.percent}%</span>
      <span className="atip cshop-pop" role="tooltip" id={tipId}>
        <span className="atip-title">{name} · {slice.percent}%</span>
        <span className="cshop-oddsline">{slice.percent}% chance this chest gives {article(name)} {name}. {slice.count} {name} items left to find:</span>
        <span className="cshop-orows">
          {slice.byCategory.map(({ category, count }) => (
            <span key={category} className="cshop-orow"><span className="cshop-orow-name">{COSMETIC_CATEGORY_DEFS[category].label}</span><span>{count}</span></span>
          ))}
        </span>
      </span>
    </span>
  );
});

const DIVIDER_SRC = `${import.meta.env.BASE_URL}frames/name-divider.webp`;

/** Memoized: the Collection page re-renders on its own state; the shop's props are stable (`useCallback` handlers, the
 *  setState `onBusy`), so those renders skip this screen. */
export const CrateShop = memo(function CrateShop({ guest, onGuest, onOpen, onBusy, onBack, reducedMotion }: CrateShopProps): JSX.Element {
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
  /** The request id of a purchase still waiting for a definite answer, and the picks it was for (see NEVER CHARGED TWICE). */
  const pendingRef = useRef<{ key: string; id: string } | null>(null);
  const alive = useRef(true);
  useEffect(() => { alive.current = true; return () => { alive.current = false; }; }, []);

  // Fresh prices whenever the shop opens (one cheap read; the server prices the purchase regardless).
  useEffect(() => { void refreshEconomy(); }, []);
  // Every chest's art starts loading as the screen opens, so whichever the player buys never opens cold.
  useEffect(() => { for (const t of CHEST_TIERS) warmChestArt(t); }, []);

  // ESC = Back. Registered on `document` in the CAPTURE phase: it runs after the theatre's, the sign-in gate's and the
  // pop-ups' window-capture handlers (which claim Esc and stop it), and BEFORE Game.tsx's window-bubble handler, which
  // would otherwise also toggle the settings menu on the same press. When it acts it claims the key (preventDefault +
  // stopPropagation), so the menu never opens underneath the trip back. It stands aside while a purchase runs (leaving
  // would hide the "Buying…" state of a charge still in flight), while the settings menu, the Minion Book or a card
  // Inspect is open (Game's handler closes those), and for a press something earlier already handled.
  const backRef = useRef(onBack);
  backRef.current = onBack;
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key !== 'Escape' || e.defaultPrevented || busyRef.current) return;
      const st = useGame.getState();
      if (st.settingsOpen || st.showBook || st.inspect) return;
      e.preventDefault();
      e.stopPropagation();
      backRef.current();
    };
    document.addEventListener('keydown', onKey, { capture: true });
    return () => document.removeEventListener('keydown', onKey, { capture: true });
  }, []);

  const floor = CRATE_TIER_FLOOR[tier];
  const price = economy.cratePrice[tier];
  // `catalogEpoch` moves when the server retires an item or a category (`applyServerCatalogState` records the state
  // first, then bumps it): `eligibleForCrate` reads that state, so each memo that lists it re-derives the pool. A
  // category the server switched off leaves the focus list entirely (the Collection hides its tab the same way).
  const cats = useMemo(() => shopFocusCategories(), [catalogEpoch]);
  // `available` is the server's own count (eligibility at this floor, focusable): the receipt and the quote share it.
  const available = useMemo(() => new Set(availableFocusCategories(owned, floor)), [owned, floor, catalogEpoch]);
  const left = useMemo(() => leftByCategory(owned, floor), [owned, floor, catalogEpoch]);
  // A tick on a category that sold out at THIS floor (the tier moved) is kept, but not priced and not shown as pressed.
  // In the shop's row order, which is the receipt's order too.
  const focus = useMemo(() => cats.filter((c) => ticked.has(c) && available.has(c)), [cats, ticked, available]);
  const quote = useMemo(
    () => quoteCrate({ tier, focus: focus.length ? focus : null, owned, economy }),
    [tier, focus, owned, economy, catalogEpoch],
  );
  const receipt = useMemo(
    () => receiptRows(price, focus, available.size, quote, economy),
    [price, focus, available, quote, economy],
  );
  // THE LIVE ODDS of this exact chest (its floor, its canonical focus, what is still unowned). Keyed on the canonical
  // focus as a string so a price move (a new quote object) does not re-derive it.
  const focusKey = quote?.focus?.join(',') ?? '';
  const slices = useMemo(
    () => oddsSlices(owned, floor, focusKey ? (focusKey.split(',') as CosmeticCategory[]) : null),
    [floor, focusKey, owned, catalogEpoch],
  );
  // Changing the picks (or a moved price) drops the request id a failed purchase kept.
  const key = quote ? purchaseKey(quote) : '';
  useEffect(() => { if (pendingRef.current && pendingRef.current.key !== key) pendingRef.current = null; }, [key]);

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
  const back = (): void => { if (busyRef.current) return; sfx.pulse(); onBack(); };

  // The chest's name: its tier, plus the focus while it narrows anything.
  const tierLabel = CRATE_TIER_LABELS[tier];
  const name = `${tierLabel} Chest${quote?.focus ? ` · ${focus.map((c) => COSMETIC_CATEGORY_DEFS[c].label).join(', ')}` : ''}`;

  const short = quote ? Math.max(0, quote.total - balance) : 0;
  // A guest is never "short": every spend is the sign-in gate (ruling 2026-10-19), so the price shows and Buy stays live.
  const needMore = guest ? 0 : short;
  const label: ReactNode = busy ? <span className="cshop-buy-main">Buying…</span>
    : !quote ? <span className="cshop-buy-main">Sold out</span>
    : needMore > 0 ? <span className="cshop-buy-main">Need {needMore} more Aether</span>
    : <><span className="cshop-buy-main">Open Chest</span><span className="cshop-buy-total"><AetherIcon />{quote.total}</span></>;
  const disabled = busy || !quote || needMore > 0;
  const ariaLabel = quote && !busy && needMore === 0
    ? `Buy ${name} for ${quote.total} Aether${guest ? ' (needs an account)' : ''}`
    : undefined;

  const spend = async (): Promise<void> => {
    if (!quote || busyRef.current) return;
    // GUESTS NEVER SPEND (R-PROG-AETHER-02): the sign-in gate, never the store.
    if (guest) { onGuest(); return; }
    setError(null);
    busyRef.current = true;
    setBusy(true);
    onBusy?.(true);
    // A retry of the same picks after an answer that never came reuses that attempt's id (NEVER CHARGED TWICE).
    const pickKey = purchaseKey(quote);
    const requestId = pendingRef.current?.key === pickKey ? pendingRef.current.id : mintRequestId();
    pendingRef.current = { key: pickKey, id: requestId };
    const out = await buyCrate(quote.tier, quote.focus, quote.total, requestId);
    busyRef.current = false;
    // Always: the caller may outlive this screen, and a busy flag left up would hold its controls for good.
    onBusy?.(false);
    // A definite answer (success, or a 4xx refusal) ends this purchase: the next Buy is a new one.
    if ((out.status === 'ok' || isDefiniteBuyFailure(out.reason)) && pendingRef.current?.id === requestId) pendingRef.current = null;
    if (out.status !== 'ok') {
      if (alive.current) { setBusy(false); setError(buyErrorCopy(out.reason)); }
      return;
    }
    // Back on this screen after the reveal: the same tier, the focus cleared (a shop visit usually buys more than one).
    if (alive.current) { setBusy(false); setTicked(new Set()); }
    // SUCCESS IGNORES `alive` on purpose: the server has charged the player, so the reveal must play even when this screen
    // unmounted mid-purchase (the caller's theatre outlives it). Only this screen's own state updates are skipped.
    const result = out.result;
    // The chest it opens as is the tier bought (its floor).
    const item: CrateQueueItem = { crateId: result.crate.crateId, earnedLevel: null, ...(result.crate.source ? { source: result.crate.source } : {}), tier: chestTierOf(CRATE_TIER_FLOOR[quote.tier]) };
    // Already bought and opened: the theatre plays this answer instead of asking again.
    onOpen(item, () => Promise.resolve({ status: 'ok', result }));
  };

  return (
    <section className={`cshop${reducedMotion ? ' cshop-still' : ''}`} aria-label="Chest Shop">
      <div className="cshop-page">
        <div className="cshop-top">
          <button type="button" className="cshop-gem cshop-back" disabled={busy} onClick={back}>◀ Collection</button>
          <h2 className="cshop-title">Chest Shop</h2>
          <span className="cshop-spacer" />
          <div className="cshop-gem cshop-wallet" role="group" aria-label="Aether balance">
            <AetherIcon className="cshop-wallet-gem" />{balance} <small>Aether</small>
          </div>
        </div>

        <div className="cshop-sec-h">
          <span>PICK A CHEST</span>
          <img src={DIVIDER_SRC} alt="" aria-hidden="true" draggable={false} decoding="sync" />
        </div>
        <div className="cshop-chests" role="group" aria-label="Chest">
          {CRATE_TIERS.map((t) => <ChestCard key={t} tier={t} price={economy.cratePrice[t]} on={tier === t} onPick={pickTier} />)}
        </div>

        <div className="cshop-lower">
          <section className="cshop-panel cshop-focus" aria-label="Focus Chest">
            <div className="cshop-panel-h"><span>FOCUS CHEST</span><em>The more categories you select, the cheaper the fee!</em></div>
            <div className="cshop-cats" role="group" aria-label="Focus">
              <div className="cshop-cat cshop-cat-head" aria-hidden="true"><span>CATEGORY</span><span>LEFT TO FIND</span></div>
              {cats.map((c) => (
                <FocusRow key={c} cat={c} left={left.get(c) ?? 0} on={ticked.has(c) && available.has(c)} soldOut={!available.has(c)} onToggle={toggle} />
              ))}
            </div>
          </section>

          <section className="cshop-panel cshop-checkout" aria-label="Your Chest">
            <div className="cshop-panel-h"><span>YOUR CHEST</span></div>
            <div className="cshop-receipt">
              <div className="cshop-line"><span className="cshop-what">{tierLabel} Chest</span><span className="cshop-dots" /><Amount value={price} /></div>
              {receipt && (
                <>
                  <div className="cshop-line cshop-fee"><span className="cshop-what">Focusing</span></div>
                  <div className="cshop-subs">
                    {receipt.rows.map((r, i) => (
                      <div key={r.category} className="cshop-sub">
                        <span className="cshop-what">{COSMETIC_CATEGORY_DEFS[r.category].label}</span><span className="cshop-dots" /><Amount value={r.amount} cost={i === 0} />
                      </div>
                    ))}
                  </div>
                  {receipt.noFocus && <div className="cshop-allnote">Everything ticked: no focus, so any category can drop, Announcers too.</div>}
                </>
              )}
              <div className="cshop-line cshop-total"><span className="cshop-what">Total</span><span className="cshop-dots" /><Amount value={quote?.total ?? price} /></div>
            </div>
            <div className="cshop-odds">
              <h4>ODDS</h4>
              <div className="cshop-bars" role="group" aria-label="Odds">
                {slices.map((s) => <OddsSeg key={s.rarity} slice={s} />)}
              </div>
            </div>
            <div className="cshop-buywrap">
              <button
                type="button" className={`cshop-gem cshop-buy${busy ? ' pressed' : ''}`} disabled={disabled} aria-busy={busy || undefined}
                aria-label={ariaLabel} onClick={() => { void spend(); }}
              >
                {label}
              </button>
              {error && <p className="cshop-err" role="alert">{error}</p>}
            </div>
          </section>
        </div>
      </div>
    </section>
  );
});
