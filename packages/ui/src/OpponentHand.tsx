import { memo, useCallback, useEffect, useLayoutEffect, useMemo, useRef, type CSSProperties } from 'react';
import { createPortal } from 'react-dom';
import type { CombatEvent } from '@game/core';
import { playerOpponent, type BoardSnapshot } from '@game/sim';
import { useGame } from './store';
import { opponentSkins, seatCosmetics } from './skins/skins';
import { cardPlateLookOf } from './cardPlate/cardPlateLook';
import { publicArt } from './phoneArt';
import { stageHost, toStage } from './stage';
import { setHandSummonSource, type HandSummonOrigin, type HandSummonSource } from './handSummonFx';
import { playPlateCoalesce } from './plateCoalesce';
import {
  EMPTY_START_HAND, oppHandBackSrc, oppHandFan, oppHandSignature, oppStartHand, opponentHandCards,
  type OppHandCard, type OppStartHand,
} from './oppHandModel';

/**
 * THE OPPONENT'S HAND, face down (owner ask 2026-10-23, R-OPP-HAND-01): "add an opponent's hand area to the left of
 * their runes. it should show their card plate they have equipped, but without the minions text or art, so it is
 * 'hidden.'", and "show when opponents get cards added to hand in real time as well".
 *
 * Each card is ONE picture: the foe's equipped card plate whole (the plate's Collection composite), else the standard
 * plate. No art, no name, no text, no stats, and no card id anywhere in the DOM: the only thing the screen learns is
 * the count, which the log already tells. It sits to the left of the foe's runes for the fight (player view, a
 * spectator, Versus and replays all mount `Recruit`'s combat), in a compact fan sized under the player's hand.
 *
 *  - A card granted mid-fight (an enemy `toHand`) is appended and materialises with the same arcane coalesce the
 *    player's own combat grants use (the mirror, R-SYMMETRY-01).
 *  - A copy summoned from a card greys it for the fight (as the player's does); the summon itself lifts off THAT card
 *    (`handSummonFx` 'enemy' source, registered here while mounted) and lands with the shared lift-and-land.
 *
 * PERF: one memo'd component; it re-renders when the hand changes (the list is interned by signature, so a beat that
 * changes nothing hands the cards the same array), each card a memo'd node with one decoded image element (the same src for
 * every card, decoded once). Positions are the independent `translate` / `rotate` properties, so a re-fan on a grant
 * eases on the compositor. Rects are read only when a summon launches or a grant lands, never per frame. Nothing loops.
 */

const STANDARD_BACK = publicArt('frames/cardplate-standard.webp');
/** The fan, in stage px at the reference scale (CSS multiplies by `--scale`). Ten cards span `MAX_SPAN`. */
export const OPP_HAND_FAN = { cardW: 62, maxSpan: 270, maxStep: 34, tiltDeg: 9, arcPx: 6 } as const;
/** At most this many grant coalesces per commit (a Skip or a big batch just pops the rest in). */
const COALESCE_PER_COMMIT = 2;
const NO_SUMMONS: ReadonlySet<string> = new Set();

/** The mounted face-down cards by key: the 'enemy' hand-summon source resolves through this, never a DOM attribute. */
const cardEls = new Map<string, HTMLElement>();

/** The 'enemy' source: the face-down card with that hand key, measured once at launch. */
export const opponentHandSource: HandSummonSource = (uid) => {
  const el = cardEls.get(uid);
  if (!el || !el.isConnected) return null;
  const r = el.getBoundingClientRect();
  if (r.width <= 0) return null;
  const rot = parseFloat(el.style.getPropertyValue('--fan-rot')) || 0;
  const o: HandSummonOrigin = {
    el, cx: r.left + r.width / 2, cy: r.top + r.height / 2,
    w: el.offsetWidth || toStage(r.width), h: el.offsetHeight || toStage(r.height), rotateDeg: rot,
  };
  return o;
};

/** DEV / perf-bench override (like `__oppRunes`): `window.__oppHand = { minions: ['uid', …], spells: 2 }` forces the
 *  foe's starting hand, so a hand-built fight can show one. Stripped from player builds. */
function forcedStartHand(): OppStartHand | null {
  if (!(import.meta.env.DEV || import.meta.env.VITE_PERF_BENCH === '1') || typeof window === 'undefined') return null;
  const f = (window as unknown as { __oppHand?: { minions?: string[]; spells?: number } }).__oppHand;
  return f ? { minionUids: f.minions ?? [], spells: f.spells ?? 0 } : null;
}

const OppHandCardEl = memo(function OppHandCardEl({ k, spent, x, y, rot, back }: { k: string; spent: boolean; x: number; y: number; rot: number; back: string }): JSX.Element {
  const mine = useRef<HTMLDivElement | null>(null);
  const ref = useCallback((el: HTMLDivElement | null): void => {
    if (el) { mine.current = el; cardEls.set(k, el); return; }
    if (mine.current && cardEls.get(k) === mine.current) cardEls.delete(k);
    mine.current = null;
  }, [k]);
  return (
    <div
      ref={ref}
      className={`opphand-card${spent ? ' spent' : ''}`}
      style={{ '--ohx': x.toFixed(1), '--ohy': y.toFixed(1), '--fan-rot': `${rot.toFixed(2)}deg` } as CSSProperties}
    >
      <img decoding="sync" src={back} alt="" draggable={false} />
    </div>
  );
});

export interface OpponentHandProps {
  /** The fight's event log (the replay's), and the cursor the board folds through (`processedEnd`). */
  events: readonly CombatEvent[];
  through: number;
  /** Foe hand uids a copy was summoned from, as shown so far (`enemyHandSummonedShown`). */
  summoned: ReadonlySet<string>;
  /** The fight is playing (not yet settled): grants and greys only count then. */
  live: boolean;
}

export const OpponentHand = memo(function OpponentHand({ events, through, summoned, live }: OpponentHandProps): JSX.Element | null {
  const lobby = useGame((s) => s.run.lobby);
  const staged = useGame((s) => s.combatStaged);
  const inCombat = useGame((s) => s.run.phase === 'combat');
  const preview = useGame((s) => s.duelPreview);
  const showOppSkins = useGame((s) => s.showOpponentSkins);
  const gauntlet = useGame((s) => s.run.mode === 'gauntlet');
  const active = !!lobby && (staged || preview) && !gauntlet;

  // The fought foe, cached past the settle exactly as `CombatOpponent` caches it (the live pairing then names the
  // NEXT round's foe).
  const cached = useRef<ReturnType<typeof playerOpponent> | null>(null);
  const live0 = useMemo(() => (active && lobby && (inCombat || preview) ? playerOpponent(lobby) : null), [active, lobby, inCombat, preview]);
  if (live0?.seat) cached.current = live0;
  const foe = (inCombat || preview) ? live0 : cached.current;

  // The board the fight is really against: a Scene Builder rig pins an AUTHORED board for this wave over the paired
  // seat's (`sandboxFoeWave`), else the paired seat's served board. Cached with the foe.
  const authored = useGame((s) => (s.run.sandboxFoeWave === s.run.wave ? s.run.servedBoards?.[s.run.wave] ?? null : null));
  const snapRef = useRef<BoardSnapshot | undefined>(undefined);
  if (inCombat || preview) snapRef.current = authored ?? live0?.board.snapshot;
  const snapshot = snapRef.current;
  const start = useMemo(() => forcedStartHand() ?? (snapshot ? oppStartHand(snapshot) : EMPTY_START_HAND), [snapshot]);
  // A full hand takes nothing more: the snapshot's own room when it recorded one, else the hand cap.
  const room = (snapshot as { handRoom?: number } | undefined)?.handRoom;
  const handMax = typeof room === 'number' ? start.minionUids.length + start.spells + Math.max(0, room) : 10;

  const sigRef = useRef<{ sig: string; cards: OppHandCard[] }>({ sig: '', cards: [] });
  const cards = useMemo(() => {
    const next = opponentHandCards(start, events, live ? through : 0, live ? summoned : NO_SUMMONS, handMax);
    const sig = oppHandSignature(next);
    if (sig !== sigRef.current.sig) sigRef.current = { sig, cards: next };
    return sigRef.current.cards;
  }, [start, events, through, summoned, live, handMax]);

  const plate = cardPlateLookOf(opponentSkins(showOppSkins, seatCosmetics(foe?.seat, snapshot ? { snapshot } : foe?.board)));
  const back = oppHandBackSrc(plate, STANDARD_BACK);

  // The 'enemy' hand-summon source lives exactly as long as the hand is on screen.
  const shown = active && !!foe?.seat && cards.length > 0;
  useEffect(() => {
    if (!shown) return undefined;
    const prev = setHandSummonSource('enemy', opponentHandSource);
    return () => { setHandSummonSource('enemy', prev ?? null); };
  }, [shown]);

  // A GRANT materialises where it lands, as the player's do (the coalesce). Only a card that appears while the fight
  // plays; the starting hand and a remount draw at rest.
  const seenRef = useRef<Set<string> | null>(null);
  useLayoutEffect(() => {
    if (!shown) { seenRef.current = null; return; }
    const seen = seenRef.current;
    seenRef.current = new Set(cards.map((c) => c.key));
    if (!seen) return;
    let n = 0;
    for (const c of cards) {
      if (!c.grant || seen.has(c.key)) continue;
      const el = cardEls.get(c.key);
      if (!el) continue;
      if (n++ < COALESCE_PER_COMMIT) {
        const r = el.getBoundingClientRect();
        if (r.width > 0) playPlateCoalesce(r, el);
      } else el.classList.add('ohpop');
    }
  }, [cards, shown]);

  if (!shown) return null;
  const n = cards.length;
  const tip = `Opponent's hand: ${n} card${n === 1 ? '' : 's'}`;
  return createPortal(
    <div className="opphand gtip gtip-down" data-tip={tip} aria-label={tip} role="img" data-count={n}>
      {cards.map((c, i) => {
        const f = oppHandFan(i, n, OPP_HAND_FAN);
        return <OppHandCardEl key={c.key} k={c.key} spent={c.spent} x={f.x} y={f.y} rot={f.rot} back={back} />;
      })}
    </div>,
    stageHost(),
  );
});
