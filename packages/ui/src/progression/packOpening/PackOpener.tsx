import { useCallback, useEffect, useRef, useState, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import { RARITY_LABELS, packDuplicateAether, type PackCard, type PackLook, type PackOpenResult } from '@game/progression';
import { rectToStage, stageHost, type StageRect } from '../../stage';
import { prefersReducedMotion } from '../CrateOpener';
import { rewardPreview } from '../rewardPreview';
import { createPackScene, type PackScene } from './packScene';
import { createPackSounds, type PackSounds } from './packSounds';
import { PackFace, slotBox, warmFaceArt } from './packFaces';
import './packOpening.css';

/**
 * THE PACK OPENER SHELL (spec sections 3, 5, 10). Hosts the Pixi pack scene and drives the opening around it: the
 * phases, the server request (asked at the POP only), the failure reset, the reveal flow and the summary. Dev-only for
 * now: nothing outside the DevMenu mounts it.
 *
 * Ownership: the scene owns the tear, the sleeve, the stack and the first half of each flip; this shell owns the
 * request, the DOM card faces (`packFaces.tsx`: the handoff, the tray, the summary row), the sounds on the DOM side (stamp, aether, summary) and the
 * single `PackSounds` for the theatre. Clicks after the zoom bubble from the canvas to `.pkop-fx`, where `flipNext`
 * decides. Reduced motion: no scene; a sealed pack and an Open button, then the backs in a row with a crossfade.
 */

export type PackOpenOutcome = { status: 'ok'; result: PackOpenResult } | { status: 'error'; reason: string };
export interface PackQueueItem { packId: string; look: PackLook }
export interface PackOpenerProps {
  queue: readonly PackQueueItem[];
  open: (packId: string) => Promise<PackOpenOutcome>;
  onOpened?: (r: PackOpenResult) => void;
  onClose?: () => void;
  reducedMotion?: boolean;
  /** Dev-only clock multiplier (the Pack Lab's slow-mo): scales the scene and the DOM handoff transitions. Default 1. */
  speed?: number;
  /** Tests inject a fake. */
  sceneFactory?: typeof createPackScene;
}
export type PackPhase = 'sealed' | 'tearing' | 'sleeve' | 'zooming' | 'waiting' | 'reveal' | 'summary' | 'error';

const FAIL_NOTE = 'Could not open the pack. Try again.';
const CARD_COUNT = 5;
/** Reveal all: how long the last face stays up before the summary. */
const REVEAL_ALL_HOLD_MS = 600;
/** Reveal all: how often to retry a flip the scene refused (one still in flight). */
const REVEAL_ALL_RETRY_MS = 40;

const cardText = (c: PackCard): string => {
  const name = rewardPreview(c.rewardId).label.name;
  const rarity = RARITY_LABELS[c.rarity];
  return c.duplicate ? `${name}, ${rarity}, duplicate, +${c.duplicate.aether} Aether` : `${name}, ${rarity}, new`;
};

export function PackOpener({ queue, open, onOpened, onClose, reducedMotion, speed = 1, sceneFactory = createPackScene }: PackOpenerProps) {
  const reduced = reducedMotion ?? prefersReducedMotion();
  const [qi, setQi] = useState(0);
  const [phase, setPhaseState] = useState<PackPhase>('sealed');
  const [note, setNote] = useState<string | null>(null);
  const [result, setResult] = useState<PackOpenResult | null>(null);
  const [flipped, setFlipped] = useState(0);
  /** Each revealed card's flat rect at its edge-on handoff (stage px, converted AT the edge event). */
  const [froms, setFroms] = useState<readonly (StageRect | undefined)[]>([]);
  /** The revealed card in the featured slot (null while the next one flips: the previous one has tucked away). */
  const [featured, setFeatured] = useState<number | null>(null);
  const [announce, setAnnounce] = useState('');

  const phaseRef = useRef<PackPhase>('sealed');
  const resultRef = useRef<PackOpenResult | null>(null);
  const flippedRef = useRef(0);
  const poppedRef = useRef(false);
  const closeWantedRef = useRef(false);
  const revealAllRef = useRef(false);
  const reqRef = useRef(0);
  const mountedRef = useRef(true);
  const sceneRef = useRef<PackScene | null>(null);
  const soundsRef = useRef<PackSounds | null>(null);
  const hostRef = useRef<HTMLDivElement | null>(null);
  const slotRef = useRef<HTMLDivElement | null>(null);
  const dialogRef = useRef<HTMLDivElement | null>(null);
  const timerRef = useRef<ReturnType<typeof setInterval> | null>(null);
  /** The result's warmed face art, held until the next pack so the decode is not dropped. */
  const artRef = useRef<HTMLImageElement[]>([]);
  const item = queue[qi];
  const speedRef = useRef(speed);
  speedRef.current = speed;
  const itemRef = useRef(item);
  itemRef.current = item;

  const go = useCallback((p: PackPhase): void => { phaseRef.current = p; setPhaseState(p); }, []);
  const sounds = useCallback((): PackSounds => (soundsRef.current ??= createPackSounds()), []);
  const holdRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const stopTimer = useCallback((): void => {
    if (timerRef.current) { clearInterval(timerRef.current); timerRef.current = null; }
    if (holdRef.current) { clearTimeout(holdRef.current); holdRef.current = null; }
  }, []);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      reqRef.current++;
      stopTimer();
    };
  }, [stopTimer]);

  const goSummary = useCallback((): void => {
    stopTimer();
    revealAllRef.current = false;
    sceneRef.current?.setInputEnabled(false);
    setFeatured(null);
    go('summary');
    sounds().summary();
  }, [go, sounds, stopTimer]);

  /** A failed or malformed answer: back to a fresh sealed pack, nothing consumed. */
  const fail = useCallback((): void => {
    stopTimer();
    revealAllRef.current = false;
    // The scene contract (Task 6): disable input and reset in the SAME synchronous turn.
    sceneRef.current?.setInputEnabled(false);
    sceneRef.current?.resetSealed();
    poppedRef.current = false;
    closeWantedRef.current = false;
    resultRef.current = null;
    flippedRef.current = 0;
    setResult(null);
    setFlipped(0);
    setFroms([]);
    setFeatured(null);
    artRef.current = [];
    setAnnounce('');
    setNote(FAIL_NOTE);
    go('sealed');
  }, [go, stopTimer]);

  /** The server request: only ever started by a pop. */
  const request = useCallback((packId: string): void => {
    const id = ++reqRef.current;
    poppedRef.current = true;
    setNote(null);
    const settle = (out: PackOpenOutcome): void => {
      if (id !== reqRef.current || !mountedRef.current) return;
      if (phaseRef.current === 'summary') return;
      if (out.status !== 'ok') { fail(); return; }
      resultRef.current = out.result;
      setResult(out.result);
      artRef.current = warmFaceArt(out.result.cards);
      sceneRef.current?.setBacks(out.result.cards.map((c) => ({ rarity: c.rarity, guaranteed: c.guaranteed })));
      onOpened?.(out.result);
      if (closeWantedRef.current) { goSummary(); return; }
      if (phaseRef.current === 'waiting' || reduced) go('reveal');
    };
    open(packId).then(settle, () => settle({ status: 'error', reason: 'rejected' }));
  }, [fail, go, goSummary, onOpened, open, reduced]);

  // Read through refs by the scene's handlers, so a parent's new `open` / `onOpened` is honoured.
  const requestRef = useRef(request);
  requestRef.current = request;
  const soundsFn = useRef(sounds);
  soundsFn.current = sounds;

  // The scene: one per pack, destroyed on unmount or when the next pack takes over.
  useEffect(() => {
    if (reduced || !item) return;
    const host = hostRef.current;
    if (!host) return;
    const scene = sceneFactory(host, item.look, CARD_COUNT, soundsFn.current(), {
      onPop: () => { go('tearing'); requestRef.current(itemRef.current!.packId); },
      onStripFree: () => { if (phaseRef.current === 'tearing') go('sleeve'); },
      onSleeveDropped: () => { if (phaseRef.current === 'tearing' || phaseRef.current === 'sleeve') go('zooming'); },
      onZoomed: () => {
        if (phaseRef.current === 'summary' || phaseRef.current === 'sealed') return;
        go(resultRef.current ? 'reveal' : 'waiting');
      },
      onFlipEdge: (index, rect) => {
        const r = resultRef.current;
        const card = r?.cards[index];
        if (!r || !card) return;
        flippedRef.current = index + 1;
        setFlipped(index + 1);
        // Measured NOW (the edge event), so a resize since mount is honoured.
        const from = rectToStage(rect);
        setFroms((prev) => { const next = prev.slice(); next[index] = from; return next; });
        setFeatured(index);
        setAnnounce(cardText(card));
        if (card.duplicate) { soundsFn.current().stamp(); soundsFn.current().aether(); }
        if (revealAllRef.current && flippedRef.current < r.cards.length) flipNextRef.current();
      },
    });
    scene.setSpeed(speedRef.current);
    sceneRef.current = scene;
    return () => {
      scene.destroy();
      if (sceneRef.current === scene) sceneRef.current = null;
    };
    // The scene is per pack; its callbacks read refs updated every render, so the deps are only the pack and the mode.
  }, [reduced, qi]);

  useEffect(() => { speedRef.current = speed; sceneRef.current?.setSpeed(speed); }, [speed]);

  // Declared AFTER the scene effect so its cleanup runs after `scene.destroy()` on unmount.
  useEffect(() => () => { soundsRef.current?.dispose(); soundsRef.current = null; }, []);

  /** Flip the next card (or go to the summary once every card is shown). Returns whether anything happened. */
  const flipNext = useCallback((): boolean => {
    const r = resultRef.current;
    if (phaseRef.current !== 'reveal' || !r) return false;
    if (flippedRef.current >= r.cards.length) { goSummary(); return true; }
    if (reduced) {
      const index = flippedRef.current;
      const card = r.cards[index]!;
      flippedRef.current = index + 1;
      setFlipped(index + 1);
      setAnnounce(cardText(card));
      if (card.duplicate) { sounds().stamp(); sounds().aether(); }
      return true;
    }
    const scene = sceneRef.current;
    if (!scene) return false;
    // Where the face will land: measured now (the click), never per frame.
    const slot = slotRef.current?.getBoundingClientRect();
    const to = slot ? { x: slot.left + slot.width / 2, y: slot.top + slot.height / 2 } : { x: 0, y: 0 };
    const started = scene.flipTop(to);
    // The featured face tucks into the tray while the next card flips in.
    if (started) setFeatured(null);
    return started;
  }, [goSummary, reduced, sounds]);
  const flipNextRef = useRef(flipNext);
  flipNextRef.current = flipNext;

  const revealAll = useCallback((): void => {
    if (phaseRef.current !== 'reveal') return;
    revealAllRef.current = true;
    stopTimer();
    flipNextRef.current();
    timerRef.current = setInterval(() => {
      if (!revealAllRef.current || phaseRef.current !== 'reveal') { stopTimer(); return; }
      const r = resultRef.current;
      if (r && flippedRef.current >= r.cards.length) {
        // Hold the last face so the player sees it, then the summary.
        stopTimer();
        holdRef.current = setTimeout(() => { holdRef.current = null; if (phaseRef.current === 'reveal') goSummary(); }, REVEAL_ALL_HOLD_MS);
        return;
      }
      flipNextRef.current();
    }, REVEAL_ALL_RETRY_MS);
  }, [goSummary, stopTimer]);

  const quickOpen = useCallback((): void => {
    if (phaseRef.current !== 'sealed') return;
    if (reduced) { if (item) { go('zooming'); request(item.packId); } return; }
    sceneRef.current?.quickOpen();
  }, [go, item, reduced, request]);

  const requestClose = useCallback((): void => {
    if (phaseRef.current === 'summary' || !poppedRef.current) { onClose?.(); return; }
    if (resultRef.current) { goSummary(); return; }
    // Popped but no answer yet: the cards are not known. Wait for them, then show the summary.
    closeWantedRef.current = true;
    go('waiting');
  }, [go, goSummary, onClose]);

  const openNext = useCallback((): void => {
    stopTimer();
    revealAllRef.current = false;
    poppedRef.current = false;
    closeWantedRef.current = false;
    resultRef.current = null;
    flippedRef.current = 0;
    reqRef.current++;
    setResult(null);
    setFlipped(0);
    setFroms([]);
    setFeatured(null);
    artRef.current = [];
    setAnnounce('');
    setNote(null);
    go('sealed');
    setQi((n) => n + 1);
    // "Open next" is about to unmount: keep keyboard focus in the dialog.
    dialogRef.current?.focus();
  }, [go, stopTimer]);

  useEffect(() => { dialogRef.current?.focus(); }, []);
  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      const t = e.target as HTMLElement | null;
      if (t && (/^(INPUT|TEXTAREA|SELECT)$/.test(t.tagName) || t.isContentEditable)) return;
      if (e.repeat) return;
      if (e.key === 'Escape') { e.preventDefault(); requestClose(); return; }
      if (e.key !== 'Enter' && e.key !== ' ') return;
      if ((e.target as HTMLElement | null)?.tagName === 'BUTTON') return;
      if (phaseRef.current === 'sealed') { e.preventDefault(); quickOpen(); }
      else if (phaseRef.current === 'reveal') { e.preventDefault(); flipNext(); }
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [flipNext, quickOpen, requestClose]);

  if (!item) return null;
  const hasMore = qi < queue.length - 1;
  const cards = result?.cards ?? [];
  const allFlipped = result !== null && flipped >= cards.length;
  const aetherTotal = result ? packDuplicateAether(result) : 0;
  const showBacks = reduced && result !== null && phase !== 'summary';

  const theatre = (
    <div className="pkop" role="dialog" aria-modal="true" aria-label="Opening a pack" ref={dialogRef} tabIndex={-1}
         style={speed === 1 ? undefined : ({ '--pk-slow': 1 / speed } as CSSProperties)}>
      <div className="pkop-scrim" aria-hidden />
      {!reduced && (
        <div
          className={`pkop-fx${phase === 'summary' ? ' pkop-hidden' : ''}`}
          ref={hostRef}
          aria-hidden
          onClick={() => { if (phaseRef.current === 'reveal') flipNext(); }}
        />
      )}
      <div className="pkop-slot" ref={slotRef} style={slotBox()} aria-hidden />
      {reduced && !result && phase !== 'summary' && <div className="pkop-pack" aria-hidden>{item.look.name}</div>}
      {showBacks && (
        <div className="pkop-row" onClick={() => flipNext()}>
          {cards.map((c, i) => (
            <div key={i} className={`pkop-back r-${c.rarity}${i < flipped ? ' flipped' : ''}`} aria-hidden>
              <span className="pkop-back-mark">{c.guaranteed ? 'Guaranteed' : item.look.name}</span>
              <PackFace card={c} phase="tray" />
            </div>
          ))}
        </div>
      )}
      {(phase === 'summary' || (!reduced && phase === 'reveal')) && cards.length > 0 && (
        <div className="pkop-faces" aria-hidden>
          {cards.map((c, i) => {
            if (phase !== 'summary' && i >= flipped) return null;
            const facePhase = phase === 'summary' ? 'summary' : i === featured ? 'handoff' : 'tray';
            return <PackFace key={i} card={c} phase={facePhase} from={froms[i]} slot={{ index: i, count: cards.length }} />;
          })}
        </div>
      )}

      {phase === 'waiting' && <div className="pkop-note" role="status">Still opening</div>}
      {note && phase === 'sealed' && <div className="pkop-note" role="status">{note}</div>}
      <div className="pkop-live" role="status">{announce}</div>

      {phase === 'summary' && result && (
        <div className="pkop-summary">
          <ul>
            {cards.map((c, i) => <li key={i}>{cardText(c)}</li>)}
          </ul>
          {aetherTotal > 0 && <div className="pkop-summary-total">{`Duplicates: +${aetherTotal} Aether`}</div>}
        </div>
      )}

      <div className="pkop-btns">
        {phase === 'sealed' && (
          <button type="button" className="crate-btn crate-btn-quiet pressable" onClick={quickOpen}>{reduced ? 'Open' : 'Quick open'}</button>
        )}
        {phase === 'reveal' && !allFlipped && (
          <button type="button" className="crate-btn crate-btn-quiet pressable" onClick={revealAll}>Reveal all</button>
        )}
        {phase === 'reveal' && allFlipped && (
          <button type="button" className="crate-btn pressable" onClick={() => goSummary()}>Continue</button>
        )}
        {phase === 'summary' && hasMore && (
          <button type="button" className="crate-btn pressable" onClick={openNext}>Open next</button>
        )}
        {phase === 'summary' && (
          <button type="button" className="crate-btn crate-btn-quiet pressable" onClick={() => onClose?.()}>Done</button>
        )}
      </div>
      {phase !== 'summary' && (
        <button type="button" className="crate-btn crate-btn-quiet pressable pkop-corner" onClick={requestClose}>Close</button>
      )}
    </div>
  );
  return createPortal(theatre, stageHost());
}
