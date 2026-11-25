import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent } from 'react';
import { createPortal } from 'react-dom';
import { aetherShort, type BuyPackOutcome, type CrateRarity, type OwnedPack, type PackOffer, type PackShelf } from '@game/progression';
import { rectToStage, stageHost, stageViewport, type StageRect } from '../../stage';
import { prefersReducedMotion } from '../CrateOpener';
import { PackOpener, type PackOpenOutcome, type PackQueueItem } from '../packOpening/PackOpener';
import { AetherTally, type AetherTallyHandle } from '../packOpening/AetherTally';
import { packRarityLabel, rarityIconSrc } from '../packOpening/packRarity';
import { packArtFor } from '../packOpening/packArt';
import { AetherIcon } from '../AetherIcon';
import { createShopScene, type ScreenRect, type ShopScene } from './shopScene';
import { createShopSounds, type ShopSounds } from './shopSounds';
import { affordableIds, buyKey, packTag, shelfOffers, srLine, startIndex } from './shopModel';
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
 * same quote sends the SAME id. One purchase at a time: while one is pending, another drop goes back, a Buy does
 * nothing, no pack is played and Esc does not close. Behind the opener the shop is `inert` and buys nothing. A purchase with no answer after `BUY_TIMEOUT_MS` settles as `failed` (the id kept); its late answer is
 * ignored.
 *
 * The purchase from a drag: `onDrop('buy')` -> `buy`. On ok, in this order: `payAether` from the wallet gem (measured
 * once, now) with the counter rolling down as the light lands, `buySettled(true)`, then the bought packs join the hand.
 * On a refusal `buySettled(false)` sends the pack back and the reason is announced. A keyboard / tap buy (spec 14.7) has
 * no held pack: the same call, then `payAether` and the hand; never `buySettled`.
 *
 * The hand shown is `hand`, plus packs bought here that the parent has not passed yet (by `packId`), minus packs opened
 * here. Playing a pack hides the scene and mounts `PackOpener` with that pack first and the rest of the hand after it;
 * on its close the hand is updated BEFORE the scene is shown again (or the played pack flashes back into the fan). The
 * way back is a crossfade: the opener's `onClose` starts its exit fade (`exitFadeMs`) and the shop rises under it at
 * once (the scene, the words, the refund stream, focus); its `onClosed` unmounts it and gives the scene its input back.
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

/** The pack whose tag is up: `armed` shows its Buy / Open button (a tap, or Enter), else it is only looked at (focus). */
interface Selection { kind: 'shelf' | 'hand'; id: string; rect: StageRect | null; armed: boolean }

const FAILED_NOTE = 'Could not buy the pack. Try again.';
/** A press and release within this long, on the same pack, with no buy or play, is a tap: it selects the pack. */
const TAP_MS = 250;
/** The scene's fade at the handoff to the opener and back (also the opener's entry fade). */
export const SHOP_HANDOFF_MS = 200;
/** How long a played pack travels to the opener's pose before the scene hides and the opener mounts (the scene's travel is ~350-450 ms). */
export const SHOP_PLAY_TRAVEL_MS = 420;
/** The gap between the pack and its tag, and the tag's width (stage px) for choosing its side. */
const TAG_GAP = 18;
const TAG_W = 300;
/** The most pips the guarantee's gauge draws. */
const GAUGE_PIPS = 10;
/** A purchase with no answer by then settles as `failed` (its request id kept), so the shop is never held for good. */
export const BUY_TIMEOUT_MS = 15000;
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
  const [announce, setAnnounce] = useState('');
  const [hover, setHover] = useState<{ id: string; rect: StageRect } | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  /** The shelf pack being carried (the counter line's words), and whether it is over the line. */
  const [held, setHeld] = useState<string | null>(null);
  const [overLine, setOverLine] = useState(false);
  const [opening, setOpening] = useState<readonly PackQueueItem[] | null>(null);
  /** The opener is fading out over the shop (its `onClose` .. `onClosed`): the shop is already back, not yet usable. */
  const [leaving, setLeaving] = useState(false);
  /**
   * The first mount's entrance: the words start away and are released TWO frames later (a mount from a click flushes its
   * effects before the first paint, so one frame could release them before their away style was ever drawn).
   */
  const [entering, setEntering] = useState(!reduced);
  useEffect(() => {
    if (!entering) return;
    let raf = requestAnimationFrame(() => { raf = requestAnimationFrame(() => setEntering(false)); });
    return () => cancelAnimationFrame(raf);
  }, [entering]);

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
  const playedRef = useRef<string | null>(null);
  const playTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  /** The pending purchase's timeout (`BUY_TIMEOUT_MS`). */
  const buyTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
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

  /**
   * The wallet counter's target. While a purchase is pending or its Aether is streaming, the counter belongs to the
   * stream: it rolls down once, by the stream's progress, never back up. A parent's balance arriving meanwhile (a caller
   * updating its own `aether` on the answer) is kept in `deferred` and applied when the stream is done. `to` is the
   * answered balance the stream rolls toward.
   */
  const tallyTargetRef = useRef(aether);
  const streamRef = useRef<{ active: boolean; deferred: number | null; to: number }>({ active: false, deferred: null, to: aether });
  const setTally = useCallback((v: number): void => { tallyTargetRef.current = v; tallyRef.current?.setTarget(v); }, []);
  /**
   * End the wallet stream: the counter lands on the parent's balance if one arrived meanwhile, else the answered one.
   * Also called when the scene is torn down mid-stream (its flows are cleared and never report `done`), so a stream
   * never stays "in flight" and later balances reach the counter again.
   */
  const finishStream = useCallback((): void => {
    const st = streamRef.current;
    st.active = false;
    const end = st.deferred ?? st.to;
    st.deferred = null;
    setTally(end);
  }, [setTally]);

  // The parent's balance is the truth whenever it changes.
  useEffect(() => {
    balanceRef.current = aether;
    setBalance(aether);
    // (also while the opener is up: a refund from its duplicates is shown arriving once the shop is back)
    if (pendingRef.current || streamRef.current.active || openingRef.current) streamRef.current.deferred = aether;
    else setTally(aether);
  }, [aether, setTally]);

  const say = useCallback((text: string): void => { setAnnounce(text); }, []);
  /**
   * A pack the wallet cannot cover was asked for (a carried pack let go below the line, or its Buy pressed): the wallet
   * pulses once and the shortfall is said (spec 4.4). A sold-out pack only says so.
   */
  const refuseShort = useCallback((offer: PackOffer): void => {
    if (offer.soldOut) { say('Sold out'); return; }
    const short = aetherShort(offer, balanceRef.current);
    if (short <= 0) return;
    tallyRef.current?.gulp();
    say(`Need ${short} more Aether`);
  }, [say]);
  /** A price_changed answer whose new quote has not arrived yet: announced once, when the next offers do. */
  const priceWaitRef = useRef<string | null>(null);
  const priceChangedText = (offerId: string): string => {
    const o = offersRef.current.find((x) => x.offerId === offerId);
    if (!o) return 'The price changed';
    return o.price === 0 ? 'The price changed. It is now free' : `The price changed. It is now ${o.price} Aether`;
  };
  useEffect(() => {
    const id = priceWaitRef.current;
    if (id === null) return;
    priceWaitRef.current = null;
    setAnnounce(priceChangedText(id));
  }, [offers]);

  // ------------------------------------------------------------------ the purchase

  /**
   * After a keyboard / tap purchase answers: keep focus in the dialog. The Buy button keeps it (it is only
   * `aria-disabled` while pending, so it never drops focus); anything else returns focus to the pack's item.
   */
  const keepFocus = useCallback((offerId: string): void => {
    const root = dialogRef.current;
    const active = document.activeElement;
    if (root && active && active !== document.body && root.contains(active)) return;
    for (const el of root?.querySelectorAll<HTMLElement>('[data-offer]') ?? []) if (el.dataset.offer === offerId) el.focus();
  }, []);

  /** Buy `offer`. `viaScene`: the scene is holding the pack at the hand and waits for `buySettled`. */
  const purchase = useCallback((offer: PackOffer, viaScene: boolean): void => {
    // never behind the opener (the shop is inert under it, and nothing is bought until it has gone)
    if (pendingRef.current || playTimerRef.current !== null || openingRef.current) return;
    const key = buyKey(offer);
    let requestId = idsRef.current.get(key);
    if (!requestId) { requestId = mintRequestId(); idsRef.current.set(key, requestId); }
    pendingRef.current = true;
    setPending(true);
    // An empty region in between, so the same outcome twice is still spoken twice.
    setAnnounce('');
    priceWaitRef.current = null;
    // A keyboard / tap buy: nothing may be picked up until it answers.
    if (!viaScene) sceneRef.current?.setInputEnabled(false);
    const settle = (out: BuyPackOutcome): void => {
      pendingRef.current = false;
      if (out.status === 'ok' || DEFINITE.has(out.reason)) idsRef.current.delete(key);
      if (!mountedRef.current) return;
      setPending(false);
      const scene = sceneRef.current;
      const stream = streamRef.current;
      if (!viaScene) scene?.setInputEnabled(true);
      if (out.status !== 'ok') {
        if (viaScene) scene?.buySettled(false);
        // no stream: a balance the parent sent meanwhile shows now
        if (stream.deferred !== null) { const d = stream.deferred; stream.deferred = null; setTally(d); }
        switch (out.reason) {
          case 'insufficient': say(`Need ${aetherShort(offer, out.aether ?? balanceRef.current)} more Aether`); break;
          case 'price_changed': {
            // the new quote may already be here (the parent re-rendered first); else it is announced when it arrives
            const cur = offersRef.current.find((o) => o.offerId === offer.offerId);
            if (!cur || cur.price !== offer.price) say(priceChangedText(offer.offerId));
            else priceWaitRef.current = offer.offerId;
            break;
          }
          case 'sold_out': say('Sold out'); break;
          case 'guest': say('Sign in to buy packs'); break; // the caller's own `buy` shows its sign-in gate
          default: say(FAILED_NOTE);
        }
        if (!viaScene) keepFocus(offer.offerId);
        return;
      }
      // From what the counter shows now (the parent's new balance may already be deferred) to the answer.
      const before = tallyTargetRef.current, after = out.aether;
      balanceRef.current = after;
      setBalance(after);
      // The gem is measured once, here, never per frame.
      const orb = walletRef.current?.querySelector<HTMLElement>('.pkop-aether-orb');
      const g = orb?.getBoundingClientRect();
      stream.to = after;
      const finish = finishStream;
      if (scene && g) {
        stream.active = true;
        scene.payAether({ left: g.left, top: g.top, width: g.width, height: g.height }, offer.offerId, (frac, done) => {
          if (!stream.active) return;
          if (done) { finish(); return; }
          // never back up: a stream's progress only rolls the counter down toward the answer
          const v = before + (after - before) * Math.max(0, Math.min(1, frac));
          if ((after <= before && v < tallyTargetRef.current) || (after > before && v > tallyTargetRef.current)) setTally(v);
        });
      } else finish();
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
    // ONE answer per attempt: the first of the real answer and the shell's timeout. A purchase that never answers would
    // hold the pack and the shop (no Close, no Esc) for good, so after BUY_TIMEOUT_MS it settles as `failed` (the id is
    // kept: a retry sends the same one) and a late answer is ignored.
    let done = false;
    const once = (out: BuyPackOutcome): void => {
      if (done) return;
      done = true;
      if (buyTimerRef.current !== null) { clearTimeout(buyTimerRef.current); buyTimerRef.current = null; }
      settle(out);
    };
    buyTimerRef.current = setTimeout(() => { buyTimerRef.current = null; once({ status: 'error', reason: 'failed' }); }, BUY_TIMEOUT_MS);
    let p: Promise<BuyPackOutcome>;
    try { p = buyRef.current(offer.offerId, requestId); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(once, () => once({ status: 'error', reason: 'failed' }));
  }, [finishStream, keepFocus, say, setTally]);
  useEffect(() => () => { if (buyTimerRef.current !== null) clearTimeout(buyTimerRef.current); buyTimerRef.current = null; }, []);

  // ------------------------------------------------------------------ playing a pack

  /** `viaScene`: the drag-drop on the pedestal, where the scene carries the pack to the opener's pose (so we wait for it). */
  const play = useCallback((packId: string, viaScene = false): void => {
    const all = shownHandRef.current;
    const first = all.find((p) => p.packId === packId);
    // never during a purchase: its answer would pull focus out of the opener
    if (!first || openingRef.current || playTimerRef.current !== null || pendingRef.current) return;
    setSel(null);
    setHover(null);
    // The scene carries the pack to the opener's pose itself; only then does the scene hide and the opener mount.
    const mountOpener = (): void => {
      playTimerRef.current = null;
      playedRef.current = packId;
      sceneRef.current?.setVisible(false, SHOP_HANDOFF_MS);
      // ONE pack at a time (owner 2026-11-25: "remove the open next button for now"): the opener is handed only the pack
      // played, so its end screen offers only the way back to the shop
      setOpening([first]);
    };
    // Only a drop on the pedestal makes the scene carry a pack (and no scene, no travel): every other path goes at once.
    if (!viaScene || !sceneRef.current) { mountOpener(); return; }
    // The shop is busy until the opener closes: nothing else may be picked up or bought while the pack travels.
    sceneRef.current.setInputEnabled(false);
    playTimerRef.current = setTimeout(mountOpener, SHOP_PLAY_TRAVEL_MS);
  }, []);
  useEffect(() => () => { if (playTimerRef.current !== null) clearTimeout(playTimerRef.current); playTimerRef.current = null; }, []);

  const onOpened = useCallback((packId: string): void => {
    const next = new Set(openedRef.current).add(packId);
    openedRef.current = next;
    setOpened(next);
  }, []);

  /** The opener has started to leave (its exit fade): the shop comes back under it. */
  const openerLeaving = useCallback((): void => {
    setLeaving(true);
    const scene = sceneRef.current;
    // The hand as it now stands FIRST, then the scene comes back.
    scene?.setHand(shownHandOf(handRef.current, boughtRef.current, openedRef.current));
    scene?.setVisible(true, SHOP_HANDOFF_MS);
    // Aether that arrived while the opener was up (its duplicates' refund) streams into the wallet now
    const st = streamRef.current;
    if (st.deferred !== null && !st.active) {
      const to = st.deferred, from = tallyTargetRef.current;
      st.deferred = null;
      const orb = walletRef.current?.querySelector<HTMLElement>('.pkop-aether-orb');
      const g = orb?.getBoundingClientRect();
      if (scene && g && to > from) {
        st.active = true; st.to = to;
        scene.gainAether({ left: g.left, top: g.top, width: g.width, height: g.height }, (frac, done) => {
          if (!st.active) return;
          if (done) { finishStream(); tallyRef.current?.gulp(true); return; }
          const v = from + (to - from) * Math.max(0, Math.min(1, frac));
          if (v > tallyTargetRef.current) { setTally(v); tallyRef.current?.gulp(); }
        });
      } else setTally(to);
    }
    // Focus goes back to the hand item that was played, if it is still in the hand, else to the dialog. The shop stops
    // being inert NOW (its render comes after this), or the focus would not land.
    dialogRef.current?.removeAttribute('inert');
    dialogRef.current?.removeAttribute('aria-hidden');
    const played = playedRef.current;
    const item = played && !openedRef.current.has(played)
      ? dialogRef.current?.querySelector<HTMLElement>(`[data-pack="${played}"]`) : null;
    (item ?? dialogRef.current)?.focus();
  }, [finishStream, setTally]);

  /** The opener has faded out: it unmounts, and only now can a pack be picked up or played again. */
  const openerGone = useCallback((): void => {
    setOpening(null);
    setLeaving(false);
    // (a purchase still pending keeps the scene's input off until it answers)
    sceneRef.current?.setInputEnabled(!pendingRef.current);
  }, []);

  // ------------------------------------------------------------------ the scene

  const purchaseRef = useRef(purchase); purchaseRef.current = purchase;
  const refuseShortRef = useRef(refuseShort); refuseShortRef.current = refuseShort;
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
        if (!live || playTimerRef.current !== null) return;
        pickRef.current = { id, at: performance.now() };
        setSel(null);
        setHover(null);
        setHeld(from === 'shelf' ? id : null);
        setOverLine(false);
      },
      onOverLine: (over) => { if (live) setOverLine(over); },
      onShort: (id) => {
        const offer = live ? offersRef.current.find((o) => o.offerId === id) : undefined;
        if (offer) refuseShortRef.current(offer);
      },
      onDrop: (action, id, rect) => {
        if (!live) return;
        const pick = pickRef.current;
        pickRef.current = null;
        setHeld(null);
        setOverLine(false);
        if (action === 'buy') {
          // the shop is busy (a pack travelling, a purchase pending, the opener up): the pack goes back, never stuck
          const offer = offersRef.current.find((o) => o.offerId === id);
          if (!offer || playTimerRef.current !== null || pendingRef.current || openingRef.current) { sceneRef.current?.buySettled(false); return; }
          purchaseRef.current(offer, true);
          return;
        }
        if (action === 'play') { playRef.current(id, true); return; }
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
      // its flows are cleared and never report done: the shell finishes a stream in flight itself
      if (streamRef.current.active) finishStream();
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
    // the scene starts (and restarts on a tab change) on `startIndex`: the featured pack, else a new one, else the middle
    const known = list.findIndex((o) => o.offerId === centreRef.current);
    const from = known >= 0 ? known : startIndex(list);
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
      if (e.key !== 'Escape' || openingRef.current || e.defaultPrevented) return;
      // Esc is the shop's alone (window, capture: heard before the game's own Esc listener, which opens Settings).
      e.preventDefault();
      e.stopPropagation();
      if (e.repeat || playTimerRef.current !== null || pendingRef.current) return;
      onCloseRef.current?.();
    };
    window.addEventListener('keydown', onKey, true);
    return () => window.removeEventListener('keydown', onKey, true);
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
    // the grid card has no pack beside it (the tag does): it stands its pack's art on a little stage of its own
    // (a look with no art yet stands its rarity's medallion there instead)
    const art = cls === 'pks-card' ? packArtFor(o.look) : null;
    return (
      <>
        {cls === 'pks-card' && (
          <div className="pks-card-stage" aria-hidden="true">
            {art
              ? <img className="pks-card-art" src={art} alt="" decoding="sync" draggable={false} />
              : <img className="pks-card-art pks-card-art-medal" src={rarityIconSrc(o.look.guaranteedFloor)} alt="" decoding="sync" draggable={false} />}
          </div>
        )}
        <div className={`${cls}-head`}>
          <img className={`${cls}-medal`} src={rarityIconSrc(o.look.guaranteedFloor)} alt="" aria-hidden="true" decoding="sync" draggable={false} />
          <div>
            <div className={`${cls}-name`}>{o.look.name}{o.contains > 1 ? ` (${o.contains} packs)` : ''}</div>
            <div className={`${cls}-line`}>{t.floor}</div>
          </div>
        </div>
        <div className={`${cls}-price`}>{o.price > 0 && <AetherIcon />}{t.price}</div>
        {t.fresh && (
          <div className={`${cls}-fresh`}>
            {o.newToYou && o.newToYou.total > 0 && (
              <span className="pks-bar" aria-hidden="true"><span style={{ transform: `scaleX(${Math.max(0, Math.min(1, o.newToYou.unowned / o.newToYou.total))})` }} /></span>
            )}
            <span className={`${cls}-line`}>{t.fresh}</span>
          </div>
        )}
        {t.soldOut ? <div className={`${cls}-short`}>Sold out</div> : t.short > 0 && <div className={`${cls}-short`}>{`Need ${t.short} more Aether`}</div>}
        {withButton && (
          <button type="button" className="crate-btn pressable pks-buy" ref={cls === 'pks-tag' ? buyBtnRef : undefined}
                  aria-disabled={pending || t.soldOut || t.short > 0}
                  onClick={() => {
                    if (pending) return;
                    if (t.soldOut || t.short > 0) refuseShort(o); else purchase(o, false);
                  }}>{buyLabel(o)}</button>
        )}
      </>
    );
  };

  const handCount = `${shownHand.length} ${shownHand.length === 1 ? 'pack' : 'packs'}`;
  // each tab wears the art of its shelf's lead pack (the first offer that has art)
  const tabArt = useMemo(() => {
    const out: Record<string, string> = {};
    for (const s of shelves) {
      for (const o of offers) { if (o.shelf !== s.id) continue; const src = packArtFor(o.look); if (src) { out[s.id] = src; break; } }
    }
    return out;
  }, [shelves, offers]);

  // The guarantee's gauge: its rarity's medallion, the words (read as they are), and a pip per pack to go (at most
  // GAUGE_PIPS drawn), so the countdown is seen.
  const gauge = guarantee && (
    <div className={`pks-guarantee${reduced ? ' pks-guarantee-plain' : ''}`}>
      <img className="pks-guarantee-medal" src={rarityIconSrc(guarantee.rarity)} alt="" aria-hidden="true" decoding="sync" draggable={false} />
      <div className="pks-guarantee-body">
        <span className="pks-guarantee-words">{`${packRarityLabel(guarantee.rarity)} guaranteed within ${guarantee.within} ${guarantee.within === 1 ? 'pack' : 'packs'}`}</span>
        <span className={`pks-pips r-${guarantee.rarity}`} aria-hidden="true">
          {Array.from({ length: Math.max(0, Math.min(GAUGE_PIPS, Math.floor(guarantee.within))) }, (_, i) => <span key={i} className="pks-pip" />)}
        </span>
      </div>
    </div>
  );

  // Under the opener the shop is inert: nothing in it can be focused, pressed or read until the opener starts to leave.
  const away = !!opening && !leaving;
  const shop = (
    <div {...(away ? { inert: '', 'aria-hidden': true } : {})} className={`pks${entering && !reduced ? ' pks-enter' : ''}${away ? ' pks-away' : ''}${reduced ? ' pks-still' : ''}`} role="dialog" aria-modal="true" aria-label="Pack shop" ref={dialogRef} tabIndex={-1}
         onKeyDown={onArrows}>
      <div className="pkop-scrim" aria-hidden />
      {!reduced && <div className="pks-fx" ref={hostRef} aria-hidden />}

      <div className="pks-top">
        <div className="pks-tabs" role="tablist" aria-label="Shelves" data-arrows="tabs">
          {shelves.map((s) => (
            <button key={s.id} type="button" role="tab" aria-selected={s.id === activeShelf} tabIndex={s.id === activeShelf ? 0 : -1}
                    className={`pks-tab${s.id === activeShelf ? ' pks-tab-on' : ''}`} data-arrow-item onClick={() => selectTab(s.id)}>
              {tabArt[s.id] && <img className="pks-tab-art" src={tabArt[s.id]} alt="" aria-hidden="true" decoding="sync" draggable={false} />}
              <span className="pks-tab-name">{s.name}</span>
            </button>
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
          <div className="pks-handlabel" aria-hidden>{`Your packs \u00b7 ${shownHand.length}`}</div>
          {gauge}
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
                  <button type="button" data-arrow-item data-pack={p.packId} onClick={() => play(p.packId)}>{`${p.look.name}, Open`}</button>
                </li>
              ))}
            </ul>
          </div>
        </>
      )}

      {reduced && (
        <div className="pks-plain">
          {gauge}
          <ul className="pks-grid" aria-label="Shelf">
            {shelf.map((o) => <li key={o.offerId} className="pks-card">{offerCard(o, true, 'pks-card')}</li>)}
          </ul>
          {shelf.length === 0 && <p className="pks-empty">Nothing on this shelf</p>}
          <div className="pks-handhead">{`Your hand, ${handCount}`}</div>
          <ul className="pks-handrow" aria-label="Your hand">
            {shownHand.map((p) => (
              <li key={p.packId} className="pks-owned">
                <img className={`pks-owned-art${packArtFor(p.look) ? '' : ' pks-owned-medal'}`} src={packArtFor(p.look) ?? rarityIconSrc(p.look.guaranteedFloor)} alt=""
                     aria-hidden="true" decoding="sync" draggable={false} />
                <span className="pks-owned-name">{p.look.name}</span>
                <button type="button" className="crate-btn crate-btn-quiet pressable pks-open" onClick={() => play(p.packId)}>Open</button>
              </li>
            ))}
          </ul>
        </div>
      )}

      <div className="pks-live" role="status">{announce}</div>
      <button type="button" className="crate-btn crate-btn-quiet pressable pks-close" disabled={pending} onClick={() => onClose?.()}>Close</button>
    </div>
  );

  return (
    <>
      {createPortal(shop, stageHost())}
      {opening && (
        <PackOpener queue={opening} open={open} reducedMotion={reducedMotion} onOpened={(r) => onOpened(r.packId)} entryFadeMs={SHOP_HANDOFF_MS} doneLabel="Return to shop"
                    exitFadeMs={SHOP_HANDOFF_MS} onClose={openerLeaving} onClosed={openerGone} />
      )}
    </>
  );
}
