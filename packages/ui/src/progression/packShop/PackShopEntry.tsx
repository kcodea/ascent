import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { PACK_REWARD_EVERY, PACK_REWARD_RARITY, packDuplicateAether } from '@game/progression';
import { closePackShopDoor, usePhShell } from '../../partyHome/shell/shellStore';
import { getScreenWipeConfig } from '../../screenWipeConfig';
import { sfx } from '../../sfx';
import { stageHost } from '../../stage';
import { VISTA_DOOR_CLIP, VISTA_DOOR_CLIP_ID } from '../../vistaDoor';
import { PACK_LAB_SAMPLES, cancelLabTimers, makeLabOpen, type LabTimers } from '../packOpening/packLabSamples';
import { PackShop, type PackShopProps } from './PackShop';
import { SHOP_LAB_SHELVES, labNextRefresh, labRewardCount, labShopDay, shopLabOffers, labHand, makeLabBuy, type LabState } from './shopLabData';
import { useLabReward } from './useLabReward';
import { useGame } from '../../store';
import { CrateSignInGate } from '../CrateSignInGate';
import { buyPack, claimPackReward, openPack, packsVisible, refreshPackShop, useProgression } from '../progressionStore';

/**
 * THE WAY INTO THE PACK SHOP FROM THE MENU (owner 2026-11-26: "when clicking shop. i want to use the return to shop
 * transition ... it shows a shop in a meadow and then leaps through the door to the game board, instead of going through
 * the door to the game board, it goes into the shop itself").
 *
 * The nav's Shop tab bumps `packShopDoor` (shellStore). This plays the return trip's VISTA (the same layers, classes and
 * timings as Recruit's: the land rises in, a hold, the dive through the door; styles.css `.wipevista`) over the menu, and
 * mounts the pack shop behind it at the hold, so the dive lands inside the shop.
 *
 * WHICH SHOP IS BEHIND THE DOOR (the pack economy, 2026-12-01): with the server's `packs_enabled` on, the real one
 * (`ServerPackShop`: the `pack_shop` read, and every purchase, opening and reward claim through the server). With it
 * off, a DEV build keeps the Pack Shop lab's fake catalog, wallet and hand (`shopLabData.ts`) for tuning; a production
 * build never mounts this then (the Shop tab is the Chest Shop, `shopTabTarget.ts`).
 */

/** The vista's layers behind the shop, back to front (Recruit's `VISTA_LAYERS`, here as plain CSS pictures). */
const BEHIND = ['sky', 'far', 'mid'] as const;
/** The land has settled this long after the trip starts (Recruit's `VISTA_ARRIVAL_MS`). */
const ARRIVAL_MS = 800;
/** The words in the vista's sky. */
const TITLE = ['To The', 'Shop'] as const;
/**
 * The dive INTO the shop (packShop.css `vistashopdive`, owner 2026-11-27): it eases in and settles slowly with the door's
 * sides on the shop's own doorposts, over DIVE_MS; the picture starts fading FADE_AT_MS in, as the doorway closes on the
 * shop's (owner 2026-11-27: "have the fade out happen sooner with the doorway"), over FADE_MS. Not Recruit's fly-through.
 * The hold before it is 30% shorter than Recruit's (owner 2026-11-27: "make the hold 30% shorter").
 */
const DIVE_MS = 1600;
const FADE_MS = 250; // owner 2026-11-27: the doorway fades "to nothing much faster" (was 650)
const FADE_AT_MS = 350;
/** The hold before the dive: Recruit's, 30% shorter. */
const HOLD_SHARE = 0.7;

type Trip = 'in' | 'held' | 'dive' | 'done';

function ShopDoorTrip({ onCovered, onDone }: { onCovered: () => void; onDone: () => void }) {
  const [step, setStep] = useState<Trip>('in');
  const cfg = getScreenWipeConfig();
  const cb = useRef({ onCovered, onDone });
  cb.current = { onCovered, onDone };
  useEffect(() => {
    const hold = Math.round(cfg.holdOutMs * HOLD_SHARE);
    const timers = [
      window.setTimeout(() => sfx.shopTrip('title'), ARRIVAL_MS - 300),
      window.setTimeout(() => { setStep('held'); cb.current.onCovered(); }, ARRIVAL_MS),
      window.setTimeout(() => sfx.shopTrip('enter'), ARRIVAL_MS + Math.max(0, hold - 580)),
      window.setTimeout(() => { setStep('dive'); }, ARRIVAL_MS + hold),
      window.setTimeout(() => { setStep('done'); cb.current.onDone(); }, ARRIVAL_MS + hold + Math.max(DIVE_MS, FADE_AT_MS + FADE_MS)),
    ];
    return () => { for (const t of timers) window.clearTimeout(t); };
    // one trip per mount
  }, []);
  if (step === 'done') return null;
  const cls = `wipevista shoptrip on ${step === 'in' ? 'in' : step === 'held' ? 'in held' : 'dive'}`;
  return createPortal(
    <div className={cls} aria-hidden="true" style={{ '--wipe-reveal-dur': `${DIVE_MS}ms`, '--shop-fade-ms': `${FADE_MS}ms`, '--shop-fade-at': `${FADE_AT_MS}ms` } as CSSProperties}>
      <svg className="wipevista-defs" width="0" height="0" aria-hidden="true" focusable="false">
        <clipPath id={VISTA_DOOR_CLIP_ID} clipPathUnits="objectBoundingBox"><path clipRule="evenodd" d={VISTA_DOOR_CLIP} /></clipPath>
      </svg>
      <div className="wipevista-dusk" />
      <div className="wipevista-stage">
        <div className="wipevista-masked">
          {BEHIND.map((n) => <div key={n} className={`wipevista-dive wipevista-dive-${n}`}><div className={`wipevista-layer wipevista-${n}`} /></div>)}
          <div className="wipevista-dive wipevista-dive-title"><div className="wipevista-titlebox">
            <div className="wipevista-title wipevs-label"><span>{TITLE[0]}</span><span>{TITLE[1]}</span></div>
          </div></div>
          <div className="wipevista-layer wipevista-shop" />
          <div className="wipevista-layer wipevista-flat" />
        </div>
        {/* no door glow: this trip walks INTO the shop (owner 2026-11-27: "i dont want the door to glow as we move towards it") */}
        <div className="wipevista-doorwrap"><div className="wipevista-doorfill"><div className="wipevista-doordark" /></div></div>
        <div className="wipevista-dive wipevista-dive-fore"><div className="wipevista-layer wipevista-fore" /></div>
      </div>
      <div className="wipevista-flash" />
    </div>,
    stageHost(),
  );
}

const START_AETHER = 2000;
const START_HAND = 4;

/** The pack shop on the lab's fake catalog, wallet and hand (as `PackShopLab` runs it, with its default knobs). */
function LabPackShop({ onClose }: { onClose: () => void }) {
  const [state, setStateRaw] = useState<LabState>(() => ({ aether: START_AETHER, hand: labHand(START_HAND) }));
  const stateRef = useRef(state);
  const setState = useCallback((next: LabState): void => { stateRef.current = next; setStateRaw(next); }, []);
  const lab = useLabReward(stateRef, setState);
  const countReward = lab.count;
  const timersRef = useRef<LabTimers>(new Set());
  useEffect(() => { const t = timersRef.current; return () => cancelLabTimers(t); }, []);
  const sampleN = useRef(0);
  // today's shelves, drawn as the shop opens (the featured window rotates by the day); the daily free pack is taken once
  const [day, setDay] = useState(() => labShopDay());
  // the window's end, read as it opens (and again at each refresh, below)
  const [refreshesAt, setRefreshesAt] = useState(() => labNextRefresh());
  const allOffers = useMemo(() => shopLabOffers(day), [day]);
  const [freeTaken, setFreeTaken] = useState<ReadonlySet<string>>(() => new Set());
  // a limited deal's purchases so far (its stock counts down; at 0 it is sold out)
  const [boughtOf, setBoughtOf] = useState<ReadonlyMap<string, number>>(() => new Map());
  const offers = useMemo(() => allOffers.map((o) => {
    if (freeTaken.has(o.offerId)) return { ...o, soldOut: true };
    if (o.stock === undefined) return o;
    const left = Math.max(0, o.stock - (boughtOf.get(o.offerId) ?? 0));
    return { ...o, stock: left, soldOut: left === 0 || o.soldOut };
  }), [allOffers, freeTaken, boughtOf]);
  const buy = useMemo<PackShopProps['buy']>(() => {
    const labBuy = makeLabBuy(() => stateRef.current, setState, { delayMs: 100, mode: 'ok' }, timersRef.current, allOffers);
    const taken = new Set<string>();
    const counted = new Set<string>();
    return async (offerId, requestId) => {
      const out = await labBuy(offerId, requestId);
      if (out.status === 'ok' && !counted.has(requestId)) { counted.add(requestId); countReward(labRewardCount(allOffers.find((o) => o.offerId === offerId), out.packs.length)); }
      if (out.status === 'ok' && !counted.has(`stock:${requestId}`) && allOffers.find((o) => o.offerId === offerId)?.stock !== undefined) {
        counted.add(`stock:${requestId}`);
        setBoughtOf((m) => new Map(m).set(offerId, (m.get(offerId) ?? 0) + 1));
      }
      if (out.status === 'ok' && allOffers.find((o) => o.offerId === offerId)?.badge === 'free' && !taken.has(offerId)) {
        taken.add(offerId);
        setFreeTaken(new Set(taken));
      }
      return out;
    };
  }, [setState, allOffers, countReward]);
  // the day turned over: the new day's window, and its per-day limits start fresh
  const onRefresh = useCallback(() => {
    const now = new Date();
    // the free pack taken stays taken (its id is the window's, so the next window's pack is a fresh id)
    setDay(labShopDay(now)); setRefreshesAt(labNextRefresh(now)); setBoughtOf(new Map());
  }, []);
  const open = useCallback<PackShopProps['open']>(async (packId) => {
    const pack = stateRef.current.hand.find((p) => p.packId === packId);
    const sample = PACK_LAB_SAMPLES[sampleN.current++ % PACK_LAB_SAMPLES.length]!;
    const outcome = await makeLabOpen(sample, pack?.look ?? sample.result.pack, timersRef.current)();
    if (outcome.status === 'ok') {
      const cur = stateRef.current;
      setState({ aether: cur.aether + packDuplicateAether(outcome.result), hand: cur.hand.filter((p) => p.packId !== packId) });
    }
    return outcome;
  }, [setState]);
  return (
    <PackShop shelves={SHOP_LAB_SHELVES} offers={offers} refreshesAt={refreshesAt} onRefresh={onRefresh} hand={state.hand} aether={state.aether}
      reward={lab.reward} claimReward={lab.claim} buy={buy} open={open} onClose={onClose} />
  );
}

/** The failed state (the read did not answer, or the switch went off under it): one line and the way out. */
const SHOP_FAILED_NOTE = 'The Pack Shop could not be reached. Try again in a moment.';

/**
 * THE PACK SHOP ON THE SERVER (packs on). The shop is read when it opens (and again when its window turns over); a
 * purchase sends the price the shop shows and the shop's request id (one per attempt, reused on its retry, so the
 * server never charges twice); an opening and a reward claim go through the server too. A guest sees everything but
 * spends nothing (R-PROG-AETHER-02): a buy, an opening or a claim shows the sign-in gate and never reaches the server.
 */
export function ServerPackShop({ onClose }: { onClose: () => void }) {
  const state = useProgression((s) => s.packShop);
  const userId = useGame((s) => s.account.userId);
  const anonymous = useGame((s) => s.account.anonymous);
  const anonRef = useRef(anonymous);
  anonRef.current = anonymous;
  const [gate, setGate] = useState(false);
  const closeGate = useCallback((): void => setGate(false), []);
  // Read on open, unless the door's trip already asked (a read in flight is shared, one already back is used).
  useEffect(() => {
    const cur = useProgression.getState().packShop;
    if (!cur || cur.userId !== useGame.getState().account.userId || cur.status === 'failed') void refreshPackShop();
  }, []);
  const mine = state && state.userId === userId ? state : null;
  const shop = mine?.shop ?? null;
  const buy = useCallback<PackShopProps['buy']>(async (offerId, requestId) => {
    if (anonRef.current) { setGate(true); return { status: 'error', reason: 'guest' }; }
    const out = await buyPack(offerId, requestId);
    if (out.status === 'error' && out.reason === 'guest') setGate(true);
    return out;
  }, []);
  const open = useCallback<PackShopProps['open']>(async (packId) => {
    if (anonRef.current) { setGate(true); return { status: 'error', reason: 'guest' }; }
    return openPack(packId);
  }, []);
  const claim = useCallback<NonNullable<PackShopProps['claimReward']>>(async (requestId) => {
    if (anonRef.current) { setGate(true); return { status: 'error', reason: 'guest' }; }
    const out = await claimPackReward(requestId);
    if (out.status === 'error' && out.reason === 'guest') setGate(true);
    return out;
  }, []);
  const onRefresh = useCallback((): void => { void refreshPackShop(); }, []);
  const reward = useMemo(() => (shop ? { rarity: PACK_REWARD_RARITY, every: PACK_REWARD_EVERY, progress: shop.packMeter.progress, ready: shop.packMeter.ready } : undefined), [shop]);
  if (!shop) {
    // Loading: nothing yet (the door's trip covers the wait). Failed: the generic failed state.
    if (mine?.status !== 'failed') return null;
    return (
      <div className="pks pks-failed" role="dialog" aria-modal="true" aria-label="Pack Shop">
        <p className="pks-failed-note" role="alert">{SHOP_FAILED_NOTE}</p>
        <div className="pks-failed-actions">
          <button type="button" className="cv2-btn pressable" onClick={() => { sfx.pulse(); void refreshPackShop(); }}>Try again</button>
          <button type="button" className="colls-quiet pressable quiet" onClick={() => { sfx.tick(); onClose(); }}>Close</button>
        </div>
      </div>
    );
  }
  return (
    <>
      <PackShop shelves={shop.shelves} offers={shop.offers} refreshesAt={shop.nextRefreshAt} onRefresh={onRefresh} hand={shop.packs} aether={shop.aether}
        reward={reward} claimReward={claim} buy={buy} open={open} onClose={onClose} />
      <div className="pks-gatehost"><CrateSignInGate open={gate} onClose={closeGate} /></div>
    </>
  );
}

/** Mounted once by the app shell. Each press of the Shop tab plays the trip and opens the shop behind it. */
export default function PackShopEntry() {
  const packsOn = useProgression(packsVisible);
  const door = usePhShell((s) => s.packShopDoor);
  const [trip, setTrip] = useState(0); // the door count whose trip is playing (0 = none)
  const [shop, setShop] = useState(false);
  // With packs on, the shop's read starts with the trip, so the dive usually lands on a stocked shop.
  useEffect(() => { if (door > 0) { setTrip(door); if (useProgression.getState().packsCapability === 'on') void refreshPackShop(); } }, [door]);
  const close = useCallback((): void => { setShop(false); setTrip(0); closePackShopDoor(); }, []);
  return (
    <>
      {shop && (packsOn ? <ServerPackShop onClose={close} /> : import.meta.env.DEV ? <LabPackShop onClose={close} /> : null)}
      {trip > 0 && <ShopDoorTrip key={trip} onCovered={() => setShop(true)} onDone={() => setTrip(0)} />}
    </>
  );
}
