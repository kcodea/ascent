import { useCallback, useEffect, useMemo, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { packDuplicateAether } from '@game/progression';
import { closePackShopDoor, usePhShell } from '../../partyHome/shell/shellStore';
import { getScreenWipeConfig } from '../../screenWipeConfig';
import { sfx } from '../../sfx';
import { stageHost } from '../../stage';
import { VISTA_DOOR_CLIP, VISTA_DOOR_CLIP_ID } from '../../vistaDoor';
import { PACK_LAB_SAMPLES, cancelLabTimers, makeLabOpen, type LabTimers } from '../packOpening/packLabSamples';
import { PackShop, type PackShopProps } from './PackShop';
import { LAB_GUARANTEE_EVERY, SHOP_LAB_SHELVES, shopLabOffers, labGuaranteeAfter, labHand, makeLabBuy, type LabState } from './shopLabData';

/**
 * THE WAY INTO THE PACK SHOP FROM THE MENU (owner 2026-11-26: "when clicking shop. i want to use the return to shop
 * transition ... it shows a shop in a meadow and then leaps through the door to the game board, instead of going through
 * the door to the game board, it goes into the shop itself").
 *
 * The nav's Shop tab bumps `packShopDoor` (shellStore). This plays the return trip's VISTA (the same layers, classes and
 * timings as Recruit's: the land rises in, a hold, the dive through the door; styles.css `.wipevista`) over the menu, and
 * mounts the pack shop behind it at the hold, so the dive lands inside the shop.
 *
 * DEV ONLY for now: there is no server for pack purchases yet, so the shop behind the door runs on the Pack Shop lab's
 * fake catalog, wallet and hand (`shopLabData.ts`). Production keeps the crate shop on the Shop tab.
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
const FADE_MS = 650;
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
  const [within, setWithin] = useState(LAB_GUARANTEE_EVERY);
  const stateRef = useRef(state);
  const setState = useCallback((next: LabState): void => { stateRef.current = next; setStateRaw(next); }, []);
  const timersRef = useRef<LabTimers>(new Set());
  useEffect(() => { const t = timersRef.current; return () => cancelLabTimers(t); }, []);
  const sampleN = useRef(0);
  // today's shelves, drawn as the shop opens (the featured window rotates by the day); the daily free pack is taken once
  const allOffers = useMemo(() => shopLabOffers(), []);
  const [freeTaken, setFreeTaken] = useState<ReadonlySet<string>>(() => new Set());
  const offers = useMemo(() => allOffers.map((o) => (freeTaken.has(o.offerId) ? { ...o, soldOut: true } : o)), [allOffers, freeTaken]);
  const buy = useMemo<PackShopProps['buy']>(() => {
    const labBuy = makeLabBuy(() => stateRef.current, setState, { delayMs: 100, mode: 'ok' }, timersRef.current, allOffers);
    const taken = new Set<string>();
    const counted = new Set<string>();
    return async (offerId, requestId) => {
      const out = await labBuy(offerId, requestId);
      if (out.status === 'ok' && !counted.has(requestId)) { counted.add(requestId); setWithin((w) => labGuaranteeAfter(w, out.packs.length)); }
      if (out.status === 'ok' && allOffers.find((o) => o.offerId === offerId)?.badge === 'free' && !taken.has(offerId)) {
        taken.add(offerId);
        setFreeTaken(new Set(taken));
      }
      return out;
    };
  }, [setState, allOffers]);
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
    <PackShop shelves={SHOP_LAB_SHELVES} offers={offers} hand={state.hand} aether={state.aether}
      guarantee={{ rarity: 'legendary', within }} buy={buy} open={open} onClose={onClose} />
  );
}

/** Mounted once by the app shell (dev builds). Each press of the Shop tab plays the trip and opens the shop behind it. */
export default function PackShopEntry() {
  const door = usePhShell((s) => s.packShopDoor);
  const [trip, setTrip] = useState(0); // the door count whose trip is playing (0 = none)
  const [shop, setShop] = useState(false);
  useEffect(() => { if (door > 0) setTrip(door); }, [door]);
  const close = useCallback((): void => { setShop(false); setTrip(0); closePackShopDoor(); }, []);
  return (
    <>
      {shop && <LabPackShop onClose={close} />}
      {trip > 0 && <ShopDoorTrip key={trip} onCovered={() => setShop(true)} onDone={() => setTrip(0)} />}
    </>
  );
}
