import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { aetherShort, type BuyPackOutcome, type CrateRarity, type OwnedPack, type PackOffer, type PackShelf } from '@game/progression';
import { rectToStage, stageHost, stageViewport, type StageRect } from '../../stage';
import { prefersReducedMotion } from '../CrateOpener';
import { PackOpener, type PackOpenOutcome, type PackQueueItem } from '../packOpening/PackOpener';
import { AetherTally, type AetherTallyHandle } from '../packOpening/AetherTally';
import { packRarityLabel } from '../packOpening/packRarity';
import { createShopScene, type ScreenRect, type ShopScene } from './shopScene';
import { createShopSounds, type ShopSounds } from './shopSounds';
import { affordableIds, buyKey, packTag, shelfOffers, srLine } from './shopModel';
import '../packOpening/packOpening.css';
import './packShop.css';

/**
 * THE PACK SHOP SHELL (spec docs/superpowers/specs/2026-11-25-pack-shop-design.md, sections 4, 6, 7, 14). The Pixi scene
 * (`shopScene.ts`) draws and moves everything; this shell owns the words and the controls: the shelf tabs, the wallet,
 * the tag beside a hovered / focused / selected pack, the words at the counter line, the purchase call, the handoff to
 * `PackOpener`, a visually hidden list mirroring the shelf and the hand, and one polite live region. Dev-only for now:
 * only the Shop Lab mounts it.
 *
 * NEVER CHARGED TWICE (as the Chest Shop, `CrateShop.tsx`): every purchase attempt sends a request id, kept per
 * `buyKey(offer)` (the offer AND its quote) until a DEFINITE answer: `ok`, or a refusal (`insufficient`,
 * `price_changed`, `sold_out`, `guest`). An attempt that threw or answered `failed` may have landed, so a retry of the
 * same quote sends the SAME id. One purchase at a time: while one is pending, another drop or Buy does nothing and Esc
 * does not close.
 *
 * The purchase from a drag: `onDrop('buy')` -> `buy`. On ok, in this order: `payAether` from the wallet gem (measured
 * once, now) with the counter rolling down as the light lands, `buySettled(true)`, then the bought packs join the hand.
 * On a refusal `buySettled(false)` sends the pack back and the reason is announced. A keyboard / tap buy (spec 14.7) has
 * no held pack: the same call, then `payAether` and the hand; never `buySettled`.
 *
 * The hand shown is `hand`, plus packs bought here that the parent has not passed yet (by `packId`), minus packs opened
 * here. Playing a pack hides the scene and mounts `PackOpener` with that pack first and the rest of the hand after it;
 * on its close the hand is updated BEFORE the scene is shown again (or the played pack flashes back into the fan).
 *
 * Reduced motion, or no Pixi (`onUnavailable`): no scene; a grid of pack cards with Buy buttons and a row of owned packs
 * with Open buttons.
 */

export interface PackShopProps {
  shelves: readonly PackShelf[];
  offers: readonly PackOffer[];
  hand: readonly OwnedPack[];
  aether: number;
  guarantee?: { rarity: CrateRarity; within: number };
  buy: (offerId: string, requestId: string) => Promise<BuyPackOutcome>;
  /** Passed straight to `PackOpener`. */
  open: (packId: string) => Promise<PackOpenOutcome>;
  onClose?: () => void;
  reducedMotion?: boolean;
  /** Tests inject a fake. */
  sceneFactory?: typeof createShopScene;
}

type Announce = { kind: 'text'; text: string } | { kind: 'priceChanged'; offerId: string };
/** The pack whose tag is up: `armed` shows its Buy / Open button (a tap, or Enter), else it is only looked at (focus). */
interface Selection { kind: 'shelf' | 'hand'; id: string; rect: StageRect | null; armed: boolean }

const FAILED_NOTE = 'Could not buy the pack. Try again.';
/** A press and release within this long, on the same pack, with no buy or play, is a tap: it selects the pack. */
const TAP_MS = 250;
/** The scene's fade at the handoff to the opener and back. */
const HANDOFF_FADE_MS = 200;
/** The gap between the pack and its tag, and the tag's width (stage px) for choosing its side. */
const TAG_GAP = 18;
const TAG_W = 300;
/** Refusals that are definite: the server did not charge, so the attempt's request id is spent. */
const DEFINITE = new Set(['insufficient', 'price_changed', 'sold_out', 'guest']);

function mintRequestId(): string {
  const c = (globalThis as { crypto?: { randomUUID?: () => string } }).crypto;
  if (c && typeof c.randomUUID === 'function') return c.randomUUID();
  return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 12)}`;
}

/** The hand shown: the parent's hand, plus packs bought here it does not have yet, minus packs opened here. */
export function shownHandOf(hand: readonly OwnedPack[], bought: readonly OwnedPack[], opened: ReadonlySet<string>): OwnedPack[] {
  const inProp = new Set(hand.map((p) => p.packId));
  return [...hand, ...bought.filter((b) => !inProp.has(b.packId))].filter((p) => !opened.has(p.packId));
}

const buyLabel = (offer: PackOffer): string => (offer.price === 0 ? 'Take for free' : `Buy for ${offer.price} Aether`);

/** The tag's place beside a pack (stage px): to its right, or to its left when the right has no room. */
function tagStyle(r: StageRect | null): CSSProperties | undefined {
  if (!r) return undefined;
  const top = r.top + r.height * 0.12;
  if (r.right + TAG_GAP + TAG_W <= stageViewport().w) return { left: r.right + TAG_GAP, top };
  return { right: stageViewport().w - r.left + TAG_GAP, top };
}

export function PackShop(props: PackShopProps) {
  const { shelves, offers, hand, aether, guarantee, buy, open, onClose, reducedMotion, sceneFactory = createShopScene } = props;
  const [pixiFailed, setPixiFailed] = useState(false);
  const reduced = (reducedMotion ?? prefersReducedMotion()) || pixiFailed;

  const [shelfId, setShelfId] = useState<string>(shelves[0]?.id ?? '');
  const activeShelf = shelves.some((s) => s.id === shelfId) ? shelfId : (shelves[0]?.id ?? '');
  const shelf = useMemo(() => shelfOffers(offers, activeShelf), [offers, activeShelf]);

  /** The balance the shop shows and prices against: the prop, or a purchase's answer until the prop catches up. */
  const [balance, setBalance] = useState(aether);
  const [bought, setBought] = useState<readonly OwnedPack[]>([]);
  const [opened, setOpened] = useState<ReadonlySet<string>>(() => new Set());
  const shownHand = useMemo(() => shownHandOf(hand, bought, opened), [hand, bought, opened]);
  const [pending, setPending] = useState(false);
  const [announce, setAnnounce] = useState<Announce | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: StageRect } | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  /** The shelf pack being carried (the counter line's words), and whether it is over the line. */
  const [held, setHeld] = useState<string | null>(null);
  const [overLine, setOverLine] = useState(false);
  const [opening, setOpening] = useState<readonly PackQueueItem[] | null>(null);

  // Latest values for the scene's handlers and the async purchase.
  const offersRef = useRef(offers); offersRef.current = offers;
  const shelfRef = useRef(shelf); shelfRef.current = shelf;
  const handRef = useRef(hand); handRef.current = hand;
  const boughtRef = useRef(bought);
  const openedRef = useRef(opened);
  const shownHandRef = useRef(shownHand); shownHandRef.current = shownHand;
  const balanceRef = useRef(balance);
  const buyRef = useRef(buy); buyRef.current = buy;
  const onCloseRef = useRef(onClose); onCloseRef.current = onClose;
  const pendingRef = useRef(false);
  const openingRef = useRef(opening); openingRef.current = opening;
  /** Request ids of attempts still waiting for a definite answer, by `buyKey`. */
  const idsRef = useRef(new Map<string, string>());
  const sceneRef = useRef<ShopScene | null>(null);
  const soundsRef = useRef<ShopSounds | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const walletRef = useRef<HTMLDivElement | null>(null);
  const tallyRef = useRef<AetherTallyHandle | null>(null);
  const buyBtnRef = useRef<HTMLButtonElement | null>(null);
  const mountedRef = useRef(true);
  /** The offer on the pedestal (the scene's `onCentre`, moved ahead by keyboard scrolls). */
  const centreRef = useRef<string | null>(null);
  const pickRef = useRef<{ id: string; at: number } | null>(null);
  /** The digit columns the wallet needs: the most it has shown this session (a roll down never loses a column mid-roll). */
  const walletMaxRef = useRef(aether);
  walletMaxRef.current = Math.max(walletMaxRef.current, aether, balance);

  useEffect(() => { mountedRef.current = true; return () => { mountedRef.current = false; }; }, []);

  // The parent's balance is the truth whenever it changes.
  useEffect(() => {
    balanceRef.current = aether;
    setBalance(aether);
    tallyRef.current?.setTarget(aether);
  }, [aether]);

  const say = useCallback((text: string): void => { setAnnounce({ kind: 'text', text }); }, []);

  // ------------------------------------------------------------------ the purchase

  /** Buy `offer`. `viaScene`: the scene is holding the pack at the hand and waits for `buySettled`. */
  const purchase = useCallback((offer: PackOffer, viaScene: boolean): void => {
    if (pendingRef.current) return;
    const key = buyKey(offer);
    let requestId = idsRef.current.get(key);
    if (!requestId) { requestId = mintRequestId(); idsRef.current.set(key, requestId); }
    pendingRef.current = true;
    setPending(true);
    // A keyboard / tap buy: nothing may be picked up until it answers.
    if (!viaScene) sceneRef.current?.setInputEnabled(false);
    const settle = (out: BuyPackOutcome): void => {
      pendingRef.current = false;
      if (out.status === 'ok' || DEFINITE.has(out.reason)) idsRef.current.delete(key);
      if (!mountedRef.current) return;
      setPending(false);
      const scene = sceneRef.current;
      if (!viaScene) scene?.setInputEnabled(true);
      if (out.status !== 'ok') {
        if (viaScene) scene?.buySettled(false);
        switch (out.reason) {
          case 'insufficient': say(`Need ${aetherShort(offer, out.aether ?? balanceRef.current)} more Aether`); break;
          case 'price_changed': setAnnounce({ kind: 'priceChanged', offerId: offer.offerId }); break;
          case 'sold_out': say('Sold out'); break;
          case 'guest': say('Sign in to buy packs'); break; // the caller's own `buy` shows its sign-in gate
          default: say(FAILED_NOTE);
        }
        return;
      }
      const before = balanceRef.current, after = out.aether;
      balanceRef.current = after;
      setBalance(after);
      // The gem is measured once, here, never per frame.
      const orb = walletRef.current?.querySelector<HTMLElement>('.pkop-aether-orb');
      const g = orb?.getBoundingClientRect();
      const tally = tallyRef.current;
      if (scene && g) {
        scene.payAether({ left: g.left, top: g.top, width: g.width, height: g.height }, offer.offerId, (frac, done) => {
          tallyRef.current?.setTarget(done ? after : before + (after - before) * frac);
        });
      } else tally?.setTarget(after);
      if (viaScene) scene?.buySettled(true);
      const nextBought = [...boughtRef.current, ...out.packs];
      boughtRef.current = nextBought;
      setBought(nextBought);
      scene?.setHand(shownHandOf(handRef.current, nextBought, openedRef.current));
      say(offer.contains > 1 ? `Bought ${out.packs.length} packs` : `Bought ${offer.look.name}`);
      if (!viaScene) {
        setSel(null);
        const items = dialogRef.current?.querySelectorAll<HTMLElement>('[data-offer]') ?? [];
        for (const el of items) if (el.dataset.offer === offer.offerId) el.focus();
      }
    };
    let p: Promise<BuyPackOutcome>;
    try { p = buyRef.current(offer.offerId, requestId); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(settle, () => settle({ status: 'error', reason: 'failed' }));
  }, [say]);

  // ------------------------------------------------------------------ playing a pack

  const play = useCallback((packId: string): void => {
    const all = shownHandRef.current;
    const first = all.find((p) => p.packId === packId);
    if (!first || openingRef.current) return;
    setSel(null);
    setHover(null);
    sceneRef.current?.setVisible(false, HANDOFF_FADE_MS);
    setOpening([first, ...all.filter((p) => p.packId !== packId)]);
  }, []);

  const onOpened = useCallback((packId: string): void => {
    const next = new Set(openedRef.current).add(packId);
    openedRef.current = next;
    setOpened(next);
  }, []);

  const closeOpener = useCallback((): void => {
    setOpening(null);
    const scene = sceneRef.current;
    // The hand as it now stands FIRST, then the scene comes back.
    scene?.setHand(shownHandOf(handRef.current, boughtRef.current, openedRef.current));
    scene?.setVisible(true, HANDOFF_FADE_MS);
    dialogRef.current?.focus();
  }, []);

  // ------------------------------------------------------------------ the scene

  const purchaseRef = useRef(purchase); purchaseRef.current = purchase;
  const playRef = useRef(play); playRef.current = play;

  useEffect(() => {
    if (reduced) return;
    const host = hostRef.current;
    if (!host) return;
    let live = true;
    const sounds = (soundsRef.current ??= createShopSounds());
    const stage = (r: ScreenRect): StageRect => rectToStage(r);
    const scene = sceneFactory(host, {
      onUnavailable: () => { if (live && mountedRef.current) setPixiFailed(true); },
      onHover: (id, rect) => {
        if (!live) return;
        setHover(id && rect && offersRef.current.some((o) => o.offerId === id) ? { id, rect: stage(rect) } : null);
      },
      onCentre: (id) => {
        if (!live) return;
        centreRef.current = id;
        // a keyboard-scrolled pack has arrived on the pedestal: its tag follows it there
        setSel((s) => {
          if (!s || s.id !== id || s.kind !== 'shelf') return s;
          const r = sceneRef.current?.rectOf(id);
          return r ? { ...s, rect: stage(r) } : s;
        });
      },
      onPickUp: (from, id) => {
        if (!live) return;
        pickRef.current = { id, at: performance.now() };
        setSel(null);
        setHover(null);
        setHeld(from === 'shelf' ? id : null);
        setOverLine(false);
      },
      onOverLine: (over) => { if (live) setOverLine(over); },
      onDrop: (action, id, rect) => {
        if (!live) return;
        const pick = pickRef.current;
        pickRef.current = null;
        setHeld(null);
        setOverLine(false);
        if (action === 'buy') {
          if (pendingRef.current) return;
          const offer = offersRef.current.find((o) => o.offerId === id);
          if (!offer) { sceneRef.current?.buySettled(false); return; }
          purchaseRef.current(offer, true);
          return;
        }
        if (action === 'play') { playRef.current(id); return; }
        // A quick press and release is a tap: select the pack and show its Buy / Open button.
        if (pick && pick.id === id && performance.now() - pick.at <= TAP_MS) {
          const kind = offersRef.current.some((o) => o.offerId === id) ? 'shelf' : 'hand';
          setSel({ kind, id, rect: stage(rect), armed: true });
        }
      },
    }, sounds);
    sceneRef.current = scene;
    scene.setShelf(shelfRef.current);
    scene.setHand(shownHandRef.current);
    scene.setAffordable(affordableIds(offersRef.current, balanceRef.current));
    return () => {
      live = false;
      scene.destroy();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    // One scene per shop (or per mode change); its handlers read refs.
  }, [reduced]);

  useEffect(() => () => { soundsRef.current?.dispose(); soundsRef.current = null; }, []);

  useEffect(() => { sceneRef.current?.setShelf(shelf); }, [shelf]);
  useEffect(() => { sceneRef.current?.setHand(shownHand); }, [shownHand]);
  useEffect(() => { sceneRef.current?.setAffordable(affordableIds(offers, balance)); }, [offers, balance]);

  // ------------------------------------------------------------------ keyboard, focus, tabs

  const selectTab = useCallback((id: string): void => {
    setShelfId(id);
    setSel(null);
    setHover(null);
    centreRef.current = null;
  }, []);

  /** A shelf pack takes focus: scroll it onto the pedestal and show its tag. */
  const lookAt = useCallback((offerId: string): void => {
    const list = shelfRef.current;
    const to = list.findIndex((o) => o.offerId === offerId);
    const from = Math.max(0, list.findIndex((o) => o.offerId === centreRef.current));
    const scene = sceneRef.current;
    if (scene && to >= 0 && to !== from) { scene.scrollBy(to - from); centreRef.current = offerId; }
    const r = scene?.rectOf(offerId);
    setSel((s) => (s && s.id === offerId && s.armed ? s : { kind: 'shelf', id: offerId, rect: r ? rectToStage(r) : null, armed: false }));
  }, []);

  const arm = useCallback((kind: 'shelf' | 'hand', id: string): void => {
    const r = sceneRef.current?.rectOf(id);
    setSel({ kind, id, rect: r ? rectToStage(r) : null, armed: true });
  }, []);

  const unlook = useCallback((id: string): void => { setSel((s) => (s && s.id === id && !s.armed ? null : s)); }, []);

  // The armed tag's button takes focus (the keyboard's one explicit confirmation).
  useEffect(() => { if (sel?.armed) buyBtnRef.current?.focus(); }, [sel?.armed, sel?.id]);

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      // The opener has its own keys (its Esc closes it, not the shop); a handled key is not ours.
      if (openingRef.current || e.defaultPrevented || e.repeat) return;
      if (e.key === 'Escape') {
        e.preventDefault();
        if (!pendingRef.current) onCloseRef.current?.();
      }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, []);

  /** Arrow keys inside the dialog: along the tabs, the shelf (scrolling the rack) or the hand. */
  const onArrows = (e: ReactKeyboardEvent<HTMLDivElement>): void => {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight') return;
    const step = e.key === 'ArrowRight' ? 1 : -1;
    const t = e.target as HTMLElement;
    const group = t.closest<HTMLElement>('[data-arrows]');
    if (group) {
      const items = [...group.querySelectorAll<HTMLElement>('[data-arrow-item]')];
      const i = items.indexOf(t);
      const next = items[i + step];
      if (i >= 0 && next) { e.preventDefault(); next.focus(); if (group.dataset.arrows === 'tabs') next.click(); }
      return;
    }
    if (!reduced) { e.preventDefault(); sceneRef.current?.scrollBy(step); }
  };

  // ------------------------------------------------------------------ render

  const announceText = !announce ? '' : announce.kind === 'text' ? announce.text : (() => {
    const o = offers.find((x) => x.offerId === announce.offerId);
    if (!o) return 'The price changed';
    return o.price === 0 ? 'The price changed. It is now free' : `The price changed. It is now ${o.price} Aether`;
  })();

  const heldOffer = held ? offers.find((o) => o.offerId === held) : undefined;
  const lineWords = heldOffer ? (() => {
    const t = packTag(heldOffer, balance);
    if (t.soldOut) return 'Sold out';
    return t.short > 0 ? `Need ${t.short} more Aether` : t.price;
  })() : null;

  // The tag: the hovered pack, else the selected / focused one.
  const tagFor = hover && (!sel || sel.id !== hover.id) ? { kind: 'shelf' as const, id: hover.id, rect: hover.rect, armed: false } : sel;
  const tagOffer = tagFor?.kind === 'shelf' ? offers.find((o) => o.offerId === tagFor.id) : undefined;
  const tagPack = tagFor?.kind === 'hand' ? shownHand.find((p) => p.packId === tagFor.id) : undefined;

  const offerCard = (o: PackOffer, withButton: boolean, cls: string) => {
    const t = packTag(o, balance);
    return (
      <>
        <div className={`${cls}-name`}>{o.look.name}{o.contains > 1 ? ` (${o.contains} packs)` : ''}</div>
        <div className={`${cls}-price`}>{t.price}</div>
        <div className={`${cls}-line`}>{t.floor}</div>
        {t.fresh && <div className={`${cls}-line`}>{t.fresh}</div>}
        {t.soldOut ? <div className={`${cls}-short`}>Sold out</div> : t.short > 0 && <div className={`${cls}-short`}>{`Need ${t.short} more Aether`}</div>}
        {withButton && (
          <button type="button" className="crate-btn pressable pks-buy" ref={cls === 'pks-tag' ? buyBtnRef : undefined}
                  disabled={pending || t.soldOut || t.short > 0} onClick={() => purchase(o, false)}>{buyLabel(o)}</button>
        )}
      </>
    );
  };

  const handCount = `${shownHand.length} ${shownHand.length === 1 ? 'pack' : 'packs'}`;

  const shop = (
    <div className={`pks${opening ? ' pks-away' : ''}`} role="dialog" aria-modal="true" aria-label="Pack shop" ref={dialogRef} tabIndex={-1}
         onKeyDown={onArrows}>
      <div className="pkop-scrim" aria-hidden />
      {!reduced && <div className="pks-fx" ref={hostRef} aria-hidden />}

      <div className="pks-top">
        <div className="pks-tabs" role="tablist" aria-label="Shelves" data-arrows="tabs">
          {shelves.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === activeShelf} tabIndex={s.id === activeShelf ? 0 : -1}
                    className={`pks-tab${s.id === activeShelf ? ' pks-tab-on' : ''}`} data-arrow-item onClick={() => selectTab(s.id)}>{s.name}</button>
          ))}
        </div>
        <div className="pks-wallet" ref={walletRef}>
          <AetherTally ref={tallyRef} total={Math.max(1, walletMaxRef.current)} prefix="" initial={aether} shown still={reduced} />
          <span className="pks-sr" data-testid="pks-balance">{`${balance} Aether`}</span>
        </div>
      </div>

      {!reduced && (
        <>
          <div className={`pks-line${overLine ? ' pks-line-lit' : ''}`} aria-hidden>
            {lineWords && <span className={`pks-line-words${heldOffer && packTag(heldOffer, balance).short > 0 ? ' pks-line-short' : ''}`}>{lineWords}</span>}
          </div>
          {guarantee && (
            <div className="pks-guarantee">{`${packRarityLabel(guarantee.rarity)} guaranteed within ${guarantee.within} ${guarantee.within === 1 ? 'pack' : 'packs'}`}</div>
          )}
          {tagFor && (tagOffer || tagPack) && (
            <div className={`pks-tag${tagFor.rect ? '' : ' pks-tag-dock'}${tagFor.armed ? ' pks-tag-armed' : ''}`} style={tagStyle(tagFor.rect)}
                 data-testid="pks-tag">
              {tagOffer && offerCard(tagOffer, tagFor.armed, 'pks-tag')}
              {tagPack && (
                <>
                  <div className="pks-tag-name">{tagPack.look.name}</div>
                  {tagFor.armed && (
                    <button type="button" className="crate-btn pressable pks-open" ref={buyBtnRef} onClick={() => play(tagPack.packId)}>Open</button>
                  )}
                </>
              )}
            </div>
          )}
          {/* What the canvas shows, for a screen reader and the keyboard. */}
          <div className="pks-sr">
            <ul aria-label="Shelf" data-arrows="shelf">
              {shelf.map((o) => (
                <li key={o.offerId}>
                  <button type="button" data-offer={o.offerId} data-arrow-item onFocus={() => lookAt(o.offerId)} onBlur={() => unlook(o.offerId)}
                          onClick={() => arm('shelf', o.offerId)}>{`${srLine(o, balance)}, Buy`}</button>
                </li>
              ))}
            </ul>
            {shelf.length === 0 && <p>Nothing on this shelf</p>}
            <p>{`Your hand, ${handCount}`}</p>
            <ul aria-label="Your hand" data-arrows="hand">
              {shownHand.map((p) => (
                <li key={p.packId}>
                  <button type="button" data-arrow-item onClick={() => play(p.packId)}>{`${p.look.name}, Open`}</button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {reduced && (
        <div className="pks-plain">
          {guarantee && <div className="pks-guarantee pks-guarantee-plain">{`${packRarityLabel(guarantee.rarity)} guaranteed within ${guarantee.within} ${guarantee.within === 1 ? 'pack' : 'packs'}`}</div>}
          <ul className="pks-grid" aria-label="Shelf">
            {shelf.map((o) => <li key={o.offerId} className="pks-card">{offerCard(o, true, 'pks-card')}</li>)}
          </ul>
          {shelf.length === 0 && <p className="pks-empty">Nothing on this shelf</p>}
          <div className="pks-handhead">{`Your hand, ${handCount}`}</div>
          <ul className="pks-handrow" aria-label="Your hand">
            {shownHand.map((p) => (
              <li key={p.packId} className="pks-owned">
                <span className="pks-owned-name">{p.look.name}</span>
                <button type="button" className="crate-btn crate-btn-quiet pressable pks-open" onClick={() => play(p.packId)}>Open</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pks-live" role="status">{announceText}</div>
      <button type="button" className="crate-btn crate-btn-quiet pressable pks-close" disabled={pending} onClick={() => onClose?.()}>Close</button>
    </div>
  );

  return (
    <>
      {createPortal(shop, stageHost())}
      {opening && (
        <PackOpener queue={opening} open={open} reducedMotion={reducedMotion} onOpened={(r) => onOpened(r.packId)} onClose={closeOpener} />
      )}
    </>
  );
}
