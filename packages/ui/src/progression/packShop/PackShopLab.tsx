import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { useDraggablePanel } from '../../useDraggablePanel';
import { PACK_LAB_SAMPLES, cancelLabTimers, makeLabOpen, type LabTimers } from '../packOpening/packLabSamples';
import { packDuplicateAether } from '@game/progression';
import { PackShop, type PackShopProps } from './PackShop';
import {
  LAB_GUARANTEE_EVERY, SHOP_LAB_OFFERS, SHOP_LAB_SHELVES, labGuaranteeAfter, labHand, makeLabBuy,
  type LabBuyMode, type LabBuyOpts, type LabState,
} from './shopLabData';

/**
 * THE PACK SHOP LAB (dev only). Mounts the real `PackShop` against a fake catalog, wallet and hand. The knobs set the
 * starting Aether and hand, how long the fake server takes to answer a purchase and what it answers; playing a hand pack
 * runs the real pack opener against a sample result. Wallet and hand live in this panel and survive until Reset.
 */

const MODES: readonly { id: LabBuyMode; label: string }[] = [
  { id: 'ok', label: 'Succeeds' },
  { id: 'insufficient', label: 'Insufficient Aether' },
  { id: 'price_changed', label: 'Price changed' },
  { id: 'guest', label: 'Guest (no account)' },
  { id: 'failed', label: 'Failed' },
  { id: 'never', label: 'Never answers' },
];

const clampInt = (v: number, lo: number, hi: number): number => Math.min(hi, Math.max(lo, Math.floor(v) || 0));

export function PackShopLab(): JSX.Element {
  // The key MUST match DevMenu's, so the panel's own close button works.
  const { panelRef, headerPointerDown, panelStyle } = useDraggablePanel('packshop');
  const [startAether, setStartAether] = useState(2000);
  const [startHand, setStartHand] = useState(4);
  const [delayMs, setDelayMs] = useState(100); // owner 2026-11-26: "make the answer delay 100ms and default it"
  const [mode, setMode] = useState<LabBuyMode>('ok');
  const [reduced, setReduced] = useState(false);
  const [run, setRun] = useState<number | null>(null);
  const [state, setStateRaw] = useState<LabState>({ aether: 0, hand: [] });
  /** The Legendary guarantee: one step down per pack bought, back to 10 when it reaches 0. */
  const [within, setWithin] = useState(LAB_GUARANTEE_EVERY);

  const stateRef = useRef<LabState>(state);
  const setState = useCallback((next: LabState): void => { stateRef.current = next; setStateRaw(next); }, []);
  const optsRef = useRef<LabBuyOpts>({ delayMs, mode });
  optsRef.current = { delayMs, mode };
  // Pending answer timers (purchases and sample opens): cleared on unmount, on close and on reset.
  const timersRef = useRef<LabTimers>(new Set());
  useEffect(() => { const t = timersRef.current; return () => cancelLabTimers(t); }, []);
  const sampleN = useRef(0);

  const buy = useMemo<PackShopProps['buy']>(() => {
    const labBuy = makeLabBuy(() => stateRef.current, setState, () => optsRef.current, timersRef.current, SHOP_LAB_OFFERS);
    const counted = new Set<string>(); // a repeated request id is answered again, never counted again
    return async (offerId, requestId) => {
      const out = await labBuy(offerId, requestId);
      if (out.status === 'ok' && !counted.has(requestId)) { counted.add(requestId); setWithin((w) => labGuaranteeAfter(w, out.packs.length)); }
      return out;
    };
  }, [setState]);

  const open = useCallback<PackShopProps['open']>(async (packId) => {
    const pack = stateRef.current.hand.find((p) => p.packId === packId);
    const sample = PACK_LAB_SAMPLES[sampleN.current++ % PACK_LAB_SAMPLES.length]!;
    const look = pack?.look ?? sample.result.pack;
    const outcome = await makeLabOpen(sample, look, timersRef.current)();
    if (outcome.status === 'ok') {
      const cur = stateRef.current;
      // the duplicates' Aether is refunded, as the real server will (the shop shows it arriving on the way back)
      setState({ aether: cur.aether + packDuplicateAether(outcome.result), hand: cur.hand.filter((p) => p.packId !== packId) });
    }
    return outcome;
  }, [setState]);

  const start = (): void => {
    cancelLabTimers(timersRef.current);
    setState({ aether: clampInt(startAether, 0, 1_000_000), hand: labHand(startHand) });
    setWithin(LAB_GUARANTEE_EVERY);
    setRun((n) => (n ?? 0) + 1);
  };
  const close = (): void => { cancelLabTimers(timersRef.current); setRun(null); };
  const reset = (): void => {
    cancelLabTimers(timersRef.current);
    setState({ aether: clampInt(startAether, 0, 1_000_000), hand: labHand(startHand) });
    setWithin(LAB_GUARANTEE_EVERY);
    setRun((n) => (n === null ? n : n + 1));
  };

  return (
    <div className="sfxmix tunerpanel" ref={panelRef} style={{ minWidth: 380, ...panelStyle }}>
      <div className="sfxmix-h drag" onPointerDown={headerPointerDown}>
        <span aria-hidden="true">🛒</span> <b>Pack Shop</b>
      </div>

      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Starting Aether</span>
        <input type="number" min={0} step={100} value={startAether} aria-label="Starting Aether"
          onChange={(e) => setStartAether(clampInt(Number(e.target.value), 0, 1_000_000))} />
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Starting hand</span>
        <input type="number" min={0} max={80} step={1} value={startHand} aria-label="Starting hand size"
          onChange={(e) => setStartHand(clampInt(Number(e.target.value), 0, 80))} />
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Answer delay (ms)</span>
        <input type="number" min={0} step={100} value={delayMs} aria-label="Answer delay in milliseconds"
          onChange={(e) => setDelayMs(clampInt(Number(e.target.value), 0, 60_000))} />
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Answer</span>
        <select value={mode} aria-label="Purchase answer" onChange={(e) => setMode(e.target.value as LabBuyMode)}>
          {MODES.map((m) => <option key={m.id} value={m.id}>{m.label}</option>)}
        </select>
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Reduced motion</span>
        <input type="checkbox" checked={reduced} aria-label="Reduced motion" onChange={(e) => setReduced(e.target.checked)} />
      </div>
      <div className="sfxmix-row tuner-row">
        <span className="sfxmix-name">Now</span>
        <span className="sfxmix-val">{`${state.aether} Aether, ${state.hand.length} in hand`}</span>
      </div>
      <div className="lunge-btns">
        <button type="button" className="sfxmix-copy" onClick={start}>Open shop</button>
        <button type="button" className="sfxmix-copy" onClick={reset}>Reset</button>
      </div>

      {run !== null && (
        <PackShop
          key={run}
          shelves={SHOP_LAB_SHELVES}
          offers={SHOP_LAB_OFFERS}
          hand={state.hand}
          aether={state.aether}
          guarantee={{ rarity: 'legendary', within }}
          buy={buy}
          open={open}
          reducedMotion={reduced}
          onClose={close}
        />
      )}
    </div>
  );
}
