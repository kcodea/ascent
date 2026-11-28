import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties, type KeyboardEvent as ReactKeyboardEvent, type PointerEvent as ReactPointerEvent } from 'react';
import { createPortal } from 'react-dom';
import { aetherShort, saleOff, type BuyPackOutcome, type ClaimRewardOutcome, type CosmeticCategory, type CrateRarity, type OwnedPack, type PackOffer, type PackShelf } from '@game/progression';
import { rectToStage, stageHost, stageViewport, type StageRect } from '../../stage';
import { prefersReducedMotion } from '../CrateOpener';
import { PackOpener, type PackOpenOutcome, type PackQueueItem } from '../packOpening/PackOpener';
import { AetherTally, type AetherTallyHandle } from '../packOpening/AetherTally';
import { packRarityLabel, rarityIconSrc } from '../packOpening/packRarity';
import { packArtFor } from '../packOpening/packArt';
import { packPalette } from '../packOpening/packTextures';
import { AetherIcon } from '../AetherIcon';
import { MenuMedal, type MenuMedalName } from '../../menuIcons';
import { createShopScene, type ScreenRect, type ShopScene } from './shopScene';
import { createShopSounds, type ShopSounds } from './shopSounds';
import { isLoopRack, shopLayout } from './shopLayout';
import { setNavAether } from '../../partyHome/shell/shellStore';
import { NO_ROOM_NOTE, buyKey, buyableIds, counterHasRoom, counterSplit, ownedCount, packGuarantee, packTag, shelfOffers, srLine, startIndex } from './shopModel';
import '../packOpening/packOpening.css';
import './packShop.css';

/** A Category pack's icon: its category's painted Collection medallion (menuIcons.tsx). Board and Music have none yet (their gem stands in). */
const CATEGORY_MEDALS: Partial<Record<CosmeticCategory, MenuMedalName>> = {
  hero_skin: 'heroes', minion_skin: 'minions', emote: 'emotes', card_plate: 'plates',
  title: 'titles', hero_attack: 'attacks', portrait_frame: 'frames', announcer: 'announcers',
};

/**
 * THE PACK SHOP SHELL (spec docs/superpowers/specs/2026-11-25-pack-shop-design.md, sections 4, 6, 7, 14). The Pixi scene
 * (`shopScene.ts`) draws and moves everything; this shell owns the words and the controls: the shelf tabs, the wallet,
 * the tag beside a hovered / focused / selected pack, the words at the counter line, the purchase call, the handoff to
 * `PackOpener`, a visually hidden list mirroring the shelf and the hand, and one polite live region. Mounted by
 * `PackShopEntry` on the server's shop (packs on), and by the Shop Lab on a fake one (dev).
 *
 * NEVER CHARGED TWICE (as the Chest Shop, `CrateShop.tsx`): every purchase attempt sends a request id, kept per
 * `buyKey(offer)` (the offer AND its quote) until a DEFINITE answer: `ok`, or a refusal (`insufficient`,
 * `price_changed`, `sold_out`, `no_room`, `expired`, `guest`). An attempt that threw or answered `failed` may have landed, so a retry of the
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
  /**
   * The pack reward's gauge (owner 2026-11-27: "Every 15 packs purchased gives the player one free Legendary Rarity Pack. it should glow and say 'Click to receive your reward' and when the player clicks it, it sparks and a legendary pack is sent to their counter. if it cant fit, send to their backpack"): its pack's rarity, how many purchases earn one, the purchases toward the next and
   * the rewards waiting. With one waiting it glows and a click claims it.
   */
  reward?: { rarity: CrateRarity; every: number; progress: number; ready: number };
  /** Claim one waiting reward; the packs it answers with join the hand (the counter, or beside it when it is full). */
  claimReward?: (requestId: string) => Promise<ClaimRewardOutcome>;
  buy: (offerId: string, requestId: string) => Promise<BuyPackOutcome>;
  /** Passed straight to `PackOpener`. */
  open: (packId: string) => Promise<PackOpenOutcome>;
  onClose?: () => void;
  reducedMotion?: boolean;
  /** Tests inject a fake. */
  sceneFactory?: typeof createShopScene;
  /** When the shop next refreshes (ms since the epoch, a quote from the server like its prices): the top-left countdown. */
  refreshesAt?: number;
  /** The countdown reached zero: fetch the new day's offers. */
  onRefresh?: () => void;
}

/** "HH:MM:SS" for a span of ms (never negative). */
export function refreshClock(ms: number): string {
  const t = Math.max(0, Math.ceil(ms / 1000));
  const two = (n: number): string => String(n).padStart(2, '0');
  return `${two(Math.floor(t / 3600))}:${two(Math.floor((t % 3600) / 60))}:${two(t % 60)}`;
}

/**
 * THE REFRESH COUNTDOWN (owner 2026-11-27: "there should also be a 'Shop refreshes in: HH:MM:SS' ticker in the top left").
 * Its own component, so its once-a-second tick re-renders only itself, never the shelf. At zero it calls `onDone` once.
 */
function RefreshTicker({ at, onDone }: { at: number; onDone?: () => void }) {
  const [now, setNow] = useState(() => Date.now());
  const doneRef = useRef(onDone);
  doneRef.current = onDone;
  useEffect(() => {
    let fired = false;
    const id = window.setInterval(() => {
      const t = Date.now();
      setNow(t);
      if (!fired && t >= at) { fired = true; doneRef.current?.(); }
    }, 1000);
    return () => window.clearInterval(id);
  }, [at]);
  return (
    <div className="pks-refresh" role="timer" aria-live="off">
      <span className="pks-refresh-words">Shop refreshes in:</span> <span className="pks-refresh-clock">{refreshClock(at - now)}</span>
    </div>
  );
}

/** The pack whose tag is up: `armed` shows its Buy / Open button (a tap, or Enter), else it is only looked at (focus). */
interface Selection { kind: 'shelf' | 'hand'; id: string; rect: StageRect | null; armed: boolean }

const FAILED_NOTE = 'Could not buy the pack. Try again.';
/** The scene's fade at the handoff to the opener and back (also the opener's entry fade). */
export const SHOP_HANDOFF_MS = 200;
/** How long a played pack travels to the opener's pose before the scene hides and the opener mounts (the scene's travel is ~350-450 ms). */
export const SHOP_PLAY_TRAVEL_MS = 420;
/** The gap between the pack and its tag, and the tag's width (stage px) for choosing its side. */
const TAG_GAP = 8;
/** The widest the tag gets (its CSS max-width): used only to keep it on screen. */
const TAG_W = 520;
/** The most pips the reward's gauge draws. */
const GAUGE_PIPS = 15;
/** A claimed reward sparks first; its pack takes its place on the counter this long after (ms). */
export const REWARD_SPARK_LEAD_MS = 260;
/** The spark's rays. */
const SPARK_RAYS = 12;
/** A purchase with no answer by then settles as `failed` (its request id kept), so the shop is never held for good. */
export const BUY_TIMEOUT_MS = 15000;
/** Refusals that are definite: the server did not charge, so the attempt's request id is spent. */
const DEFINITE = new Set(['insufficient', 'price_changed', 'sold_out', 'no_room', 'expired', 'guest']);
/** The offer has left the shelf (the window turned over): the parent swaps in the new offers. */
export const EXPIRED_NOTE = 'That offer has ended. The shop has new packs';

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

/**
 * The tag's place (stage px), centred on its pack: UNDER a shelf pack, in the gap above the counter (owner 2026-11-25:
 * "can you put the description here?"), and OVER a pack in the hand, which has no room under it. Kept on screen.
 */
function tagStyle(r: StageRect | null, kind: 'shelf' | 'hand'): CSSProperties | undefined {
  if (!r) return undefined;
  const vp = stageViewport();
  const left = Math.max(TAG_W / 2 + TAG_GAP, Math.min(vp.w - TAG_W / 2 - TAG_GAP, r.left + r.width / 2));
  if (kind === 'hand') return { left, bottom: vp.h - r.top + TAG_GAP, translate: '-50% 0' };
  // never lower than just under the line the shelf packs stand on (a selected pack's box can be reported from lower down)
  const foot = shopLayout(vp.w, vp.h).floorY + TAG_GAP;
  return { left, top: Math.min(r.top + r.height + TAG_GAP, foot), translate: '-50% 0' };
}

/**
 * The browse tip (owner 2026-11-27: "Hold down right click to browse the shop options. once the player holds right click,
 * have it go away for that entire session"): seen once, it stays away until the game is restarted.
 */
let browseHintSeen = false;

export function PackShop(props: PackShopProps) {
  const { shelves, offers, hand, aether, reward, claimReward, buy, open, onClose, reducedMotion, sceneFactory = createShopScene } = props;
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
  /** The refund's "+N" floating up beside the wallet's gem (owner 2026-11-27: "when the aether is refunded and you return to shop, the ticker goes up, but i want to see the flat +N number float up too, signifying how much was refunded from that entire pack"): the pack's whole refund, at the gem's stage spot. */
  const [refundFloat, setRefundFloat] = useState<{ n: number; key: number; x: number; y: number } | null>(null);
  const [hover, setHover] = useState<{ id: string; rect: StageRect } | null>(null);
  const [sel, setSel] = useState<Selection | null>(null);
  /** The shelf pack being carried (the counter line's words), and whether it is over the line. */
  const [held, setHeld] = useState<string | null>(null);
  const [overLine, setOverLine] = useState(false);
  const [opening, setOpening] = useState<readonly PackQueueItem[] | null>(null);
  /** The opener is fading out over the shop (its `onClose` .. `onClosed`): the shop is already back, not yet usable. */
  const [leaving, setLeaving] = useState(false);
  /** A played pack is travelling to the opener (the shelf and the room are already fading to the opener's backdrop). */
  const [travel, setTravel] = useState(false);
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
  // The counter holds 5 pack types, 8 of each; the rest wait beside it (shopModel.ts `counterSplit`).
  const split = useMemo(() => counterSplit(shownHand), [shownHand]);
  const counterRef = useRef(split.counter); counterRef.current = split.counter;
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
  /**
   * THE MAIN MENU'S NAV BAR STAYS UP (owner 2026-11-26: "the shop experience should still have the main menu nav bar at
   * the top, then the shop specific section needs to be below that"). When the shell's one nav is mounted, the shop
   * stands under it: the nav paints over the shop, the shop's own bar starts at the nav's foot, and the nav's Aether
   * count is the wallet. Found once at mount (null where there is no nav: a game, a test).
   */
  const navRef = useRef<HTMLElement | null>(null);
  const [navH, setNavH] = useState(0);
  const closeRef = useRef(onClose);
  closeRef.current = onClose;
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
  const setTally = useCallback((v: number): void => {
    tallyTargetRef.current = v; tallyRef.current?.setTarget(v);
    if (navRef.current) setNavAether(Math.round(v));
  }, []);
  /** The Aether gem a stream flies to or from: the nav's when the shop stands under it, else the shop's own wallet's. */
  const gemRect = useCallback((): DOMRect | undefined => (
    navRef.current?.querySelector<HTMLElement>('.ph-coin .ph-aether') ?? walletRef.current?.querySelector<HTMLElement>('.pkop-aether-orb')
  )?.getBoundingClientRect(), []);
  /** The wallet's one-shot pulse (transform only), on the nav's count when it is the wallet. */
  const gulp = useCallback((big = false): void => {
    tallyRef.current?.gulp(big);
    const coin = navRef.current?.querySelector<HTMLElement>('.ph-coin');
    if (coin?.animate) coin.animate([{ transform: 'scale(1)' }, { transform: `scale(${big ? 1.22 : 1.12})` }, { transform: 'scale(1)' }], { duration: 260, easing: 'ease-out' });
  }, []);
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
    if (!counterHasRoom(shownHandRef.current, offer.look)) { say(NO_ROOM_NOTE); return; }
    const short = aetherShort(offer, balanceRef.current);
    if (short <= 0) return;
    gulp();
    say(`Need ${short} more Aether`);
  }, [say, gulp]);
  /**
   * A price_changed answer whose new quote has not arrived yet (the offer, and the price it was bought at): "The price
   * changed" is said at once, and the new price once offers arrive that quote it differently (never for the same price).
   */
  const priceWaitRef = useRef<{ id: string; was: number } | null>(null);
  const priceChangedText = (offerId: string): string => {
    const o = offersRef.current.find((x) => x.offerId === offerId);
    if (!o) return 'The price changed';
    return o.price === 0 ? 'The price changed. It is now free' : `The price changed. It is now ${o.price} Aether`;
  };
  useEffect(() => {
    const wait = priceWaitRef.current;
    if (wait === null) return;
    const cur = offers.find((o) => o.offerId === wait.id);
    if (cur && cur.price === wait.was) return; // the same quote again: keep waiting, say nothing
    priceWaitRef.current = null;
    // (an offer that vanished: "The price changed" was already said)
    if (cur) setAnnounce(priceChangedText(wait.id));
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
    // no place for it on the counter: nothing is bought (owner 2026-11-26)
    if (!counterHasRoom(shownHandRef.current, offer.look)) { if (viaScene) sceneRef.current?.buySettled(false); setAnnounce(NO_ROOM_NOTE); return; }
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
            else { say('The price changed'); priceWaitRef.current = { id: offer.offerId, was: offer.price }; }
            break;
          }
          case 'sold_out': say('Sold out'); break;
          // the server's counter was fuller than the one shown (a pack granted meanwhile): the pack goes back, nothing charged
          case 'no_room': say(NO_ROOM_NOTE); break;
          case 'expired': say(EXPIRED_NOTE); break;
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
      const g = gemRect();
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
      scene?.setHand(counterSplit(shownHandOf(handRef.current, nextBought, openedRef.current)).counter);
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

  // ------------------------------------------------------------------ claiming the pack reward

  const claimRef = useRef(claimReward); claimRef.current = claimReward;
  const claimingRef = useRef(false);
  const [claiming, setClaiming] = useState(false);
  /** Bumped per claimed reward: the spark's key, so each claim plays it once. */
  const [spark, setSpark] = useState(0);
  /** The claim's request id, kept until a definite answer (a retry after no answer sends the same one). */
  const claimIdRef = useRef<string | null>(null);
  const claimTimerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  useEffect(() => () => { if (claimTimerRef.current !== null) clearTimeout(claimTimerRef.current); claimTimerRef.current = null; }, []);
  /**
   * Claim one waiting reward: the gauge sparks, then the pack takes its place on the counter (it rises in like a bought
   * pack), or, with no room there, waits beside it with the other packs waiting for space.
   */
  const claim = useCallback((): void => {
    const fn = claimRef.current;
    if (!fn || claimingRef.current || pendingRef.current || openingRef.current || playTimerRef.current !== null) return;
    claimingRef.current = true;
    setClaiming(true);
    setAnnounce('');
    const requestId = claimIdRef.current ?? (claimIdRef.current = mintRequestId());
    const settle = (out: ClaimRewardOutcome): void => {
      claimingRef.current = false;
      if (out.status === 'ok' || out.reason !== 'failed') claimIdRef.current = null;
      if (!mountedRef.current) return;
      setClaiming(false);
      if (out.status !== 'ok') {
        say(out.reason === 'guest' ? 'Sign in to claim rewards' : out.reason === 'none' ? 'No reward waiting' : 'Could not claim the reward. Try again.');
        return;
      }
      if (!reduced) setSpark((n) => n + 1);
      const fits = out.packs.length > 0 && counterHasRoom(shownHandRef.current, out.packs[0]!.look);
      const land = (): void => {
        claimTimerRef.current = null;
        if (!mountedRef.current) return;
        const nextBought = [...boughtRef.current, ...out.packs];
        boughtRef.current = nextBought;
        setBought(nextBought);
        sceneRef.current?.setHand(counterSplit(shownHandOf(handRef.current, nextBought, openedRef.current)).counter);
        const name = out.packs[0]?.look.name ?? 'Pack';
        say(fits ? `${name} received` : `${name} received. No room on the counter, so it waits beside it`);
      };
      if (reduced) land(); else claimTimerRef.current = setTimeout(land, REWARD_SPARK_LEAD_MS);
    };
    let p: Promise<ClaimRewardOutcome>;
    try { p = fn(requestId); } catch (e) { p = Promise.reject(e); }
    Promise.resolve(p).then(settle, () => settle({ status: 'error', reason: 'failed' }));
  }, [reduced, say]);

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
      setTravel(false);
      sceneRef.current?.setVisible(false, SHOP_HANDOFF_MS);
      // ONE pack at a time (owner 2026-11-25: "remove the open next button for now"): the opener is handed only the pack
      // played, so its end screen offers only the way back to the shop
      setOpening([first]);
    };
    // Only a drop on the pedestal makes the scene carry a pack (and no scene, no travel): every other path goes at once.
    if (!viaScene || !sceneRef.current) { mountOpener(); return; }
    // The shop is busy until the opener closes: nothing else may be picked up or bought while the pack travels.
    sceneRef.current.setInputEnabled(false);
    // the bars leave NOW, with the room's fade, not when the opener mounts (owner 2026-11-27: "have them fade out at the same
    // time the other background fades in")
    setTravel(true);
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
    scene?.setHand(counterSplit(shownHandOf(handRef.current, boughtRef.current, openedRef.current)).counter);
    scene?.setVisible(true, SHOP_HANDOFF_MS);
    // Aether that arrived while the opener was up (its duplicates' refund) streams into the wallet now
    const st = streamRef.current;
    if (st.deferred !== null && !st.active) {
      const to = st.deferred, from = tallyTargetRef.current;
      st.deferred = null;
      const g = gemRect();
      if (g && to > from) {
        const gs = rectToStage(g);
        setRefundFloat({ n: Math.round(to - from), key: Date.now(), x: gs.left, y: gs.top + gs.height / 2 });
      }
      if (scene && g && to > from) {
        st.active = true; st.to = to;
        scene.gainAether({ left: g.left, top: g.top, width: g.width, height: g.height }, (frac, done) => {
          if (!st.active) return;
          if (done) { finishStream(); gulp(true); return; }
          const v = from + (to - from) * Math.max(0, Math.min(1, frac));
          if (v > tallyTargetRef.current) { setTally(v); gulp(); }
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
        // A click does nothing more (owner 2026-11-26: "remove the sticky nature of clicking and having the window show up.
        // only have the window show on hover. remove the option to purchase with the click"): a pack is bought by carrying
        // it over the counter line, and its card shows while the pointer is on it.
        void pick; void rect;
      },
    }, sounds);
    sceneRef.current = scene;
    scene.setShelf(shelfRef.current);
    scene.setHand(counterRef.current);
    scene.setAffordable(buyableIds(offersRef.current, balanceRef.current, shownHandRef.current));
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
  useEffect(() => { sceneRef.current?.setHand(split.counter); }, [split]);
  useEffect(() => { sceneRef.current?.setAffordable(buyableIds(offers, balance, shownHand)); }, [offers, balance, shownHand]);

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

  // A press anywhere but the armed card puts it away (owner 2026-11-26: "when clicking away from it, it should automatically close").
  const armedId = sel?.armed ? sel.id : null;
  useEffect(() => {
    if (!armedId) return undefined;
    const away = (e: PointerEvent): void => {
      if (e.target instanceof Element && e.target.closest('.pks-tag')) return;
      setSel((s) => (s && s.armed && s.id === armedId ? null : s));
    };
    document.addEventListener('pointerdown', away, true);
    return () => document.removeEventListener('pointerdown', away, true);
  }, [armedId]);
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


  // The shelf's arrows: only on a shelf longer than the row.
  // (such a shelf is a ring, so both arrows always have somewhere to go)
  const ring = isLoopRack(shelf.length);
  const arrows = { left: ring, right: ring };
  const arrowTop = shopLayout(stageViewport().w, stageViewport().h).shelfY;

  const heldOffer = held ? offers.find((o) => o.offerId === held) : undefined;
  const lineWords = heldOffer ? (() => {
    const t = packTag(heldOffer, balance);
    if (t.soldOut) return 'Sold out';
    // (the price itself is not repeated here: owner 2026-11-26, "when buying a card, this pops up. remove it")
    return t.short > 0 ? `Need ${t.short} more Aether` : null;
  })() : null;

  // The tag: the hovered pack, else the selected / focused one.
  const tagFor = hover && (!sel || sel.id !== hover.id) ? { kind: 'shelf' as const, id: hover.id, rect: hover.rect, armed: false } : sel;
  const tagOffer = tagFor?.kind === 'shelf' ? offers.find((o) => o.offerId === tagFor.id) : undefined;
  const tagPack = tagFor?.kind === 'hand' ? shownHand.find((p) => p.packId === tagFor.id) : undefined;

  // A waiting pack's thumbnail is its PACK (owner 2026-11-26: "instead of just the medallions, show the pack art"): its
  // wrapper, or for a look with no wrapper yet the foil its placeholder pack is painted in.
  const waitingArt = (look: PackOffer['look']) => {
    const src = packArtFor(look);
    if (src) return <img className="pks-waiting-art" src={src} alt="" aria-hidden="true" decoding="sync" draggable={false} />;
    const p = packPalette(look);
    return <span className="pks-waiting-art pks-waiting-foil" aria-hidden="true" style={{ background: `linear-gradient(150deg, ${p.a}, ${p.b} 50%, ${p.c})`, borderColor: p.accent }} />;
  };

  // The card's icon says what the pack promises (packGuarantee): a Rarity pack its rarity's gem, a Category pack its
  // category's Collection medallion, a style pack its own wrapper (owner 2026-11-27: "we need to be more accurate with the
  // thumbnails, now that we have new logic in place for themed packs").
  const guaranteeIcon = (look: PackOffer['look'], cls: string) => {
    const g = packGuarantee(look);
    const medal = g.kind === 'category' ? CATEGORY_MEDALS[g.category] : undefined;
    if (medal) return <MenuMedal name={medal} className={`${cls}-medal`} />;
    const art = g.kind === 'style' ? packArtFor(look) : null;
    if (art) return <img className={`${cls}-medal pks-medal-pack`} src={art} alt="" aria-hidden="true" decoding="sync" draggable={false} />;
    return <img className={`${cls}-medal`} src={rarityIconSrc(look.guaranteedFloor)} alt="" aria-hidden="true" decoding="sync" draggable={false} />;
  };

  const offerCard = (o: PackOffer, withButton: boolean, cls: string) => {
    const t = packTag(o, balance);
    const own = ownedCount(o);
    const full = !t.soldOut && !counterHasRoom(shownHand, o.look);
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
        {/* a themed pack's collection count, top right (owner 2026-11-27: 'we need to add a counter to each of the themed packs that shows how many of the themed cards they have unlocked of the amount available. show it here, have it in the hover tooltip as well as a N/N value. keep it white and the same size as the card packs in stock numbers') */}
        {own && <span className={`${cls}-owned`} aria-label={`${own.owned} of ${own.total} collected`}>{own.text}</span>}
        <div className={`${cls}-head`}>
          {guaranteeIcon(o.look, cls)}
          <div>
            <div className={`${cls}-name`}>{o.look.name}{o.contains > 1 ? ` (${o.contains} packs)` : ''}</div>
            <div className={`${cls}-line`}>{t.floor}</div>
          </div>
        </div>
        <div className={`${cls}-price`}>
          {o.price > 0 && <AetherIcon />}{t.price}
          {saleOff(o) > 0 && <>
            <s className="pks-was" aria-label={`was ${o.fullPrice} Aether`}>{o.fullPrice}</s>
            <span className="pks-off">{`-${saleOff(o)}%`}</span>
          </>}
        </div>
        {!t.soldOut && o.stock !== undefined && <div className="pks-stock">{`${o.stock} left today`}</div>}
        {t.soldOut ? <div className={`${cls}-short`}>Sold out</div> : t.short > 0 && <div className={`${cls}-short`}>{`Need ${t.short} more Aether`}</div>}
        {full && t.short <= 0 && <div className={`${cls}-short`}>Open packs to make room</div>}
        {withButton && (
          <button type="button" className="crate-btn pressable pks-buy" ref={cls === 'pks-tag' ? buyBtnRef : undefined}
                  aria-disabled={pending || t.soldOut || t.short > 0 || full}
                  onClick={() => {
                    if (pending) return;
                    if (t.soldOut || t.short > 0 || full) refuseShort(o); else purchase(o, false);
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

  // The reward's gauge (owner 2026-11-27: "Every 15 packs purchased gives the player one free Legendary Rarity Pack. it should glow and say 'Click to receive your reward' and when the player clicks it, it sparks and a legendary pack is sent to their counter. if it cant fit, send to their backpack"): its rarity's medallion, the words, and a pip per purchase (lit as they count up).
  // With a reward waiting it glows, says so, and the whole gauge is the button that claims it; a claim sparks.
  const rewardReady = !!reward && reward.ready > 0;
  const rewardPack = reward ? `${packRarityLabel(reward.rarity)} Pack` : '';
  const rewardLeft = reward ? Math.max(1, reward.every - reward.progress) : 0;
  const rewardPips = reward ? Math.max(0, Math.min(GAUGE_PIPS, Math.floor(reward.every))) : 0;
  const rewardLit = reward ? (rewardReady ? rewardPips : Math.round((reward.progress / Math.max(1, reward.every)) * rewardPips)) : 0;
  const gauge = reward && (
    <div className={`pks-guarantee r-${reward.rarity}${rewardReady ? ' pks-reward-ready' : ''}${reduced ? ' pks-guarantee-plain' : ''}`} data-testid="pks-reward">
      <img className="pks-guarantee-medal" src={rarityIconSrc(reward.rarity)} alt="" aria-hidden="true" decoding="sync" draggable={false} />
      <div className="pks-guarantee-body">
        <span className="pks-guarantee-words">
          {rewardReady ? 'Click to receive your reward' : `${rewardLeft} more ${rewardLeft === 1 ? 'pack' : 'packs'} for a free ${rewardPack}`}
        </span>
        <span className="pks-pips" aria-hidden="true">
          {Array.from({ length: rewardPips }, (_, i) => <span key={i} className={`pks-pip${i < rewardLit ? '' : ' pks-pip-off'}`} />)}
        </span>
      </div>
      {rewardReady && reward.ready > 1 && <span className="pks-reward-n" aria-hidden="true">{`x${reward.ready}`}</span>}
      {rewardReady && (
        <button type="button" className="pks-reward-claim" disabled={claiming || pending} onClick={claim} data-testid="pks-reward-claim"
                aria-label={`Click to receive your reward: a free ${rewardPack}${reward.ready > 1 ? `, ${reward.ready} waiting` : ''}`} />
      )}
      {spark > 0 && (
        <span key={spark} className="pks-reward-spark" aria-hidden="true">
          <b />
          {Array.from({ length: SPARK_RAYS }, (_, i) => <i key={i} style={{ '--a': `${(360 / SPARK_RAYS) * i}deg` } as CSSProperties} />)}
        </span>
      )}
    </div>
  );

  // Under the opener the shop is inert: nothing in it can be focused, pressed or read until the opener starts to leave.
  // (from the moment a played pack starts its travel: the bars fade with the room, owner 2026-11-27)
  const away = (!!opening || travel) && !leaving;
  // Under the nav: found and measured once; the nav shows the shop's count; a press on a nav destination closes the shop.
  useEffect(() => {
    const host = document.querySelector<HTMLElement>('.ph-navhost');
    if (!host) return undefined;
    navRef.current = host;
    const r = rectToStage(host.querySelector('.ph-top')?.getBoundingClientRect() ?? host.getBoundingClientRect());
    setNavH(Math.round(r.height));
    setNavAether(Math.round(tallyTargetRef.current));
    const onNav = (e: MouseEvent): void => {
      const t = e.target instanceof Element ? e.target : null;
      // the Aether count is the shop's wallet here, not a way into another shop
      if (t?.closest('.ph-coin')) { e.stopPropagation(); e.preventDefault(); return; }
      if (t?.closest('.ph-navtab, .ph-brand')) closeRef.current?.();
    };
    host.addEventListener('click', onNav, true);
    return () => { host.removeEventListener('click', onNav, true); navRef.current = null; setNavAether(null); };
  }, []);
  // The nav paints over the shop, but never over the opener.
  useEffect(() => {
    if (!navH || away) return undefined;
    const html = document.documentElement;
    html.setAttribute('data-pks-shop', '');
    return () => html.removeAttribute('data-pks-shop');
  }, [navH, away]);
  // THE SITE NAV FADES WITH THE BARS (owner 2026-11-27: "the top navigation takes a moment to fade away, can you have them
  // fade out at the same time the other background fades in?"): while the shop is up the nav carries a fade, and while a pack
  // is played it is faded out (packShop.css).
  useEffect(() => {
    if (!navH) return undefined;
    const html = document.documentElement;
    html.setAttribute('data-pks-nav', '');
    return () => html.removeAttribute('data-pks-nav');
  }, [navH]);
  useEffect(() => {
    if (!away) return undefined;
    const html = document.documentElement;
    html.setAttribute('data-pks-navaway', '');
    return () => html.removeAttribute('data-pks-navaway');
  }, [away]);
  // The browse tip leaves for the session the first time the player holds the right button, or turns the wheel, anywhere in
  // the shop (owner 2026-11-27: "in the tooltip about right clicking to drag, also add that you can use the scrollwheel").
  const [browseHint, setBrowseHint] = useState(!browseHintSeen);
  const onBrowsePress = (e: ReactPointerEvent): void => {
    if (e.button !== 2 || browseHintSeen) return;
    browseHintSeen = true;
    setBrowseHint(false);
  };
  const onBrowseWheel = (): void => {
    if (browseHintSeen) return;
    browseHintSeen = true;
    setBrowseHint(false);
  };
  const shop = (
    <div {...(away ? { inert: '', 'aria-hidden': true } : {})} className={`pks${entering && !reduced ? ' pks-enter' : ''}${away ? ' pks-away' : ''}${reduced ? ' pks-still' : ''}${navH ? ' pks-undernav' : ''}`} style={navH ? { '--pks-nav': `${navH}px` } as CSSProperties : undefined} role="dialog" aria-modal="true" aria-label="Pack shop" ref={dialogRef} tabIndex={-1}
         onKeyDown={onArrows} onPointerDownCapture={onBrowsePress} onWheelCapture={onBrowseWheel}>
      <div className="pkop-scrim" aria-hidden />
      {!reduced && <div className="pks-fx" ref={hostRef} aria-hidden />}

      <div className="pks-top">
        {props.refreshesAt !== undefined && <RefreshTicker at={props.refreshesAt} onDone={props.onRefresh} />}
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
          {gauge}
          {/* A shelf of more than five scrolls: an arrow each side steps it one pack (owner 2026-11-26). */}
          {arrows.left && <button type="button" className="pks-arrow pks-arrow-l pressable" style={{ top: arrowTop }} aria-label="Earlier packs" onClick={() => sceneRef.current?.scrollBy(-1)} />}
          {arrows.right && <button type="button" className="pks-arrow pks-arrow-r pressable" style={{ top: arrowTop }} aria-label="More packs" onClick={() => sceneRef.current?.scrollBy(1)} />}
          {browseHint && (arrows.left || arrows.right) && (
            <div className="pks-hint" style={{ top: arrowTop }} data-testid="pks-hint">Hold down right click or use the scroll wheel to browse the shop options.</div>
          )}
          {tagFor && (tagOffer || tagPack) && (
            <div className={`pks-tag${tagFor.rect ? '' : ' pks-tag-dock'}${tagFor.armed ? ' pks-tag-armed' : ''}`} style={tagStyle(tagFor.rect, tagFor.kind)}
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

      {split.waiting.length > 0 && (
        <div className="pks-waiting">
          <div className="pks-waiting-words">Open packs to clear space for your other packs</div>
          <ul className="pks-waiting-row" aria-label="Packs waiting for space">
            {split.waiting.map((w) => (
              <li key={w.key} className="pks-waiting-pack" aria-label={`${w.look.name}, ${w.count}`}>
                {waitingArt(w.look)}
                <span className="pks-waiting-n" aria-hidden="true">{`x${w.count}`}</span>
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
      {refundFloat && createPortal(
        <div key={refundFloat.key} className={`pks-refund${reduced ? ' pks-refund-still' : ''}`} aria-hidden="true"
             style={{ left: refundFloat.x, top: refundFloat.y }} onAnimationEnd={() => setRefundFloat(null)}>
          {`+${refundFloat.n}`}
        </div>,
        stageHost(),
      )}
      {opening && (
        <PackOpener queue={opening} open={open} reducedMotion={reducedMotion} onOpened={(r) => onOpened(r.packId)} entryFadeMs={SHOP_HANDOFF_MS} doneLabel="Return to shop"
                    exitFadeMs={SHOP_HANDOFF_MS} onClose={openerLeaving} onClosed={openerGone} />
      )}
    </>
  );
}
