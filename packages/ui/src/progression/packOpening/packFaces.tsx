import { useLayoutEffect, useRef, useState, type CSSProperties, type ReactElement } from 'react';
import type { PackCard } from '@game/progression';
import { stageViewport, type StageRect } from '../../stage';
import { rewardPreview, type RewardEmblem } from '../rewardPreview';
import { packRarityLabel, rarityIconSrc } from './packRarity';
import { FLIP_HALF_GUARANTEED_MS, FLIP_HALF_MS, FLIP_PERSPECTIVE_PER_WIDTH } from './cardFlip';

/**
 * THE PACK CARD FACES (spec sections 6 and 11). One layout for every face: category label, art area (the reward's art,
 * or an emblem drawn below), name, rarity ribbon, and NEW or a DUPLICATE stamp with "+N Aether".
 *
 * Placement is transform-only. A placed face (the theatre passes `from` and / or `slot`) is laid out ONCE at the
 * featured slot (`SLOT_*`, `FACE_*`, never animated) and every move is a `transform` on the outer element:
 * - `handoff`: mounts on the scene's card at edge-on (`from`, the card's FLAT rect in stage px, converted with
 *   `rectToStage` at the edge event by the shell) turned to -90 deg with the scene's perspective, then transitions to
 *   the featured slot and 0 deg. The turn sits on an inner element so it can take its own easing (it continues the
 *   scene's accelerating first half, decelerating), while the move eases in and out.
 * - `featured`: at the slot. `tray`: small, in a row below (slot index of `count`). `summary`: one row of all faces.
 * The scene turns the card's BACK from 0 to +90 deg (its left edge toward the camera); the FACE is the back turned a
 * further 180 deg, so it continues from -90 deg to 0 (edge-on either way; the sign keeps the motion continuous).
 * An unplaced face (the reduced-motion row) has no inline pose; its parent places it.
 */

export type PackFacePhase = 'handoff' | 'featured' | 'tray' | 'summary';
export interface PackFaceSlot { index: number; count: number }
export interface PackFaceProps { card: PackCard; phase: PackFacePhase; from?: StageRect; slot?: PackFaceSlot }

/** The featured face's layout size (stage px) and its slot's centre as a fraction of the theatre. */
export const FACE_W = 220;
export const FACE_H = 320;
export const SLOT_X = 0.5;
export const SLOT_Y = 0.46;
/** The tray below the featured slot: scale, step between faces, and its centre's drop from the slot centre. */
const TRAY_SCALE = 0.36;
const TRAY_STEP = 92;
const TRAY_DY = 380;
/** The summary row: scale, step between faces, and its centre's offset from the slot centre. */
const SUMMARY_SCALE = 0.72;
const SUMMARY_STEP = 184;
const SUMMARY_DY = -90;
/** The face turns with the scene's perspective: the same multiple of the card's width (the face's own, pre-scale). */
const PERSPECTIVE = FLIP_PERSPECTIVE_PER_WIDTH * FACE_W;
/** The handoff's easing: the move eases in and out; the turn starts at the first half's end speed (slope ~1.65). */
const MOVE_EASE = 'cubic-bezier(0.45, 0, 0.25, 1)';
const TURN_EASE = 'cubic-bezier(0.3, 0.5, 0.4, 1)';

/** The slot's style in the theatre (the shell's `.pkop-slot` uses it too, so the two can never drift apart). */
export const slotBox = (): CSSProperties => ({
  left: `${SLOT_X * 100}%`, top: `${SLOT_Y * 100}%`, width: FACE_W, height: FACE_H, marginLeft: -FACE_W / 2, marginTop: -FACE_H / 2,
});

const pose = (x: number, y: number, sx: number, sy: number): string => `translate(${x}px, ${y}px) scale(${sx}, ${sy})`;
const rowX = (slot: PackFaceSlot | undefined, step: number): number => (slot ? (slot.index - (slot.count - 1) / 2) * step : 0);

function placedPose(phase: PackFacePhase, slot: PackFaceSlot | undefined): string {
  if (phase === 'tray') return pose(rowX(slot, TRAY_STEP), TRAY_DY, TRAY_SCALE, TRAY_SCALE);
  if (phase === 'summary') return pose(rowX(slot, SUMMARY_STEP), SUMMARY_DY, SUMMARY_SCALE, SUMMARY_SCALE);
  return pose(0, 0, 1, 1);
}

/** The pose that puts the slot-laid face exactly on `from` (stage px). Uses the theatre's size, never a DOM read. */
function fromPose(from: StageRect): string {
  const vp = stageViewport();
  const dx = from.left + from.width / 2 - vp.w * SLOT_X;
  const dy = from.top + from.height / 2 - vp.h * SLOT_Y;
  return pose(dx, dy, from.width / FACE_W, from.height / FACE_H);
}

/** The face's category, singular ("Hero skin", "Title"); an unknown reward is just a "Reward". */
function categoryLabel(kind: string, known: boolean): string {
  if (!known) return 'Reward';
  const s = kind.replace(/^New /, '');
  return s.charAt(0).toUpperCase() + s.slice(1);
}

const STROKE = { fill: 'none', stroke: 'currentColor', strokeWidth: 3.5, strokeLinecap: 'round', strokeLinejoin: 'round' } as const;

/** One drawn emblem per `RewardEmblem` (no `<title>`: the face is announced by the shell's status region). */
const EMBLEMS: Readonly<Record<RewardEmblem, ReactElement>> = {
  title: (
    <g {...STROKE}>
      <path d="M14 22h36v18H14z" />
      <path d="M14 26H6l5 7-5 7h8M50 26h8l-5 7 5 7h-8" />
      <path d="M22 31h20" />
    </g>
  ),
  announcer: (
    <g {...STROKE}>
      <path d="M10 26h8l22-12v36L18 38h-8z" />
      <path d="M18 38l4 14h7l-4-14" />
      <path d="M48 24c3 2 4 5 4 8s-1 6-4 8M54 18c5 4 7 9 7 14s-2 10-7 14" />
    </g>
  ),
  music: (
    <g {...STROKE}>
      <path d="M24 46V16l26-6v30" />
      <path d="M24 24l26-6" />
      <ellipse cx="18" cy="46" rx="6" ry="5" />
      <ellipse cx="44" cy="40" rx="6" ry="5" />
    </g>
  ),
  hero_attack: (
    <g {...STROKE}>
      <path d="M12 12l26 26M52 12L26 38" />
      <path d="M34 42l8-8M30 34l-8 8" />
      <path d="M40 40l10 10M24 40L14 50" />
      <path d="M12 12l2 8 6-6zM52 12l-2 8-6-6z" />
    </g>
  ),
  board: (
    <g {...STROKE}>
      <path d="M32 8l24 14v20L32 56 8 42V22z" />
      <path d="M8 22l24 14 24-14M32 36v20" />
    </g>
  ),
  unknown: (
    <g {...STROKE}>
      <circle cx="32" cy="32" r="22" />
      <path d="M25 26a7 7 0 1 1 10 6c-2 1-3 3-3 5v2" />
      <circle cx="32" cy="46" r="0.6" strokeWidth="5" />
    </g>
  ),
};

export function PackFace({ card, phase, from, slot }: PackFaceProps) {
  const p = rewardPreview(card.rewardId);
  const placed = from !== undefined || slot !== undefined;
  const handoff = phase === 'handoff' && from !== undefined;
  const [arrived, setArrived] = useState(!handoff);
  const ref = useRef<HTMLDivElement | null>(null);

  // Mounted on the scene's card: flush that pose once (one style/layout read per flip, never per frame), then let the
  // transition carry it to the slot.
  useLayoutEffect(() => {
    if (arrived) return;
    void ref.current?.offsetWidth;
    setArrived(true);
  }, [arrived]);

  const atEdge = handoff && !arrived;
  const flipMs = card.guaranteed ? FLIP_HALF_GUARANTEED_MS : FLIP_HALF_MS;
  const featured = phase === 'handoff' || phase === 'featured';
  const glow = featured && (card.rarity === 'legendary' || card.rarity === 'ancient');

  const outer: CSSProperties | undefined = placed
    ? {
      ...slotBox(),
      transform: atEdge ? fromPose(from!) : placedPose(phase, slot),
      transition: atEdge ? 'none' : handoff ? `transform ${flipMs}ms ${MOVE_EASE}` : undefined,
    }
    : undefined;
  const inner: CSSProperties | undefined = placed
    ? {
      transform: `perspective(${PERSPECTIVE}px) rotateY(${atEdge ? -90 : 0}deg)`,
      transition: atEdge ? 'none' : handoff ? `transform ${flipMs}ms ${TURN_EASE}` : undefined,
    }
    : undefined;

  const cls = `pkf r-${card.rarity} pkf-${phase}${placed ? ' pkf-placed' : ''}${glow ? ' pkf-glow' : ''}`;
  return (
    <div
      ref={ref}
      className={cls}
      style={outer}
      data-testid="pack-face"
      data-phase={phase}
      data-from={from ? `${from.left},${from.top},${from.width},${from.height}` : undefined}
      aria-hidden
    >
      <div className="pkf-card" style={inner}>
        <div className="pkf-cat">{categoryLabel(p.label.kind, p.category !== null)}</div>
        <div className="pkf-art">
          {p.art
            ? <img src={p.art.url} alt="" decoding="sync" draggable={false} className={`pkf-img pkf-img-${p.art.kind}`} />
            : (
              <div className="pkf-emblem" data-emblem={p.emblem ?? 'unknown'}>
                <svg viewBox="0 0 64 64" aria-hidden focusable="false">{EMBLEMS[p.emblem ?? 'unknown']}</svg>
              </div>
            )}
        </div>
        <div className="pkf-name">{p.label.name}</div>
        {p.category === null && <div className="pkf-note">{p.label.kind}</div>}
        <div className="pkf-ribbon">
          <img src={rarityIconSrc(card.rarity)} alt="" decoding="sync" draggable={false} className="pkf-rarity-icon" />
          <span>{packRarityLabel(card.rarity)}</span>
        </div>
        {card.duplicate
          ? (
            <div className="pkf-dup">
              <span className="pkf-stamp">Duplicate</span>
              <span className="pkf-aether">{`+${card.duplicate.aether} Aether`}</span>
            </div>
          )
          : <div className="pkf-new">New</div>}
      </div>
    </div>
  );
}

/**
 * Warm every face's art the moment a result arrives (spec section 11), so the handoff never shows a blank face. Called
 * once per result, never per render. Returns the images so the caller can hold them until the next pack.
 */
export function warmFaceArt(cards: readonly PackCard[]): HTMLImageElement[] {
  if (typeof Image === 'undefined') return [];
  const seen = new Set<string>();
  const held: HTMLImageElement[] = [];
  for (const c of cards) {
    for (const url of [rewardPreview(c.rewardId).art?.url, rarityIconSrc(c.rarity)]) {
      if (!url || seen.has(url)) continue;
      seen.add(url);
      const img = new Image();
      img.decoding = 'sync';
      img.src = url;
      if (typeof img.decode === 'function') img.decode().catch(() => undefined);
      held.push(img);
    }
  }
  return held;
}
