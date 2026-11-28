/**
 * PACK OPENING: THE DRAW PILE UNDER THE HAND (owner 2026-11-24: improve "the real tactile feel of opening cards"). The
 * top card of the pile answers the pointer like a card under a thumb: it lifts when the pointer rests on it, leans and
 * slides a little toward where the pointer is on it, sinks when pressed, and kicks on each heartbeat of a big tease.
 *
 * Pure maths (no Pixi): the scene eases one `PileState` per frame and reads the pose from it. No allocation.
 */
export interface PileState {
  /** 0..1: lifted under a resting pointer. */
  lift: number;
  /** 0..1: pressed down (pointer held on it). */
  press: number;
  /** -1..1: where the pointer is on the card, eased (x right, y down). */
  lx: number;
  ly: number;
  /** 0..1: a heartbeat's kick, decaying. */
  beat: number;
}

export const newPile = (): PileState => ({ lift: 0, press: 0, lx: 0, ly: 0, beat: 0 });

/** How far the lifted card slides toward the pointer (card-stack units) and how much it leans (radians), at the edge. */
export const PILE_LEAN_PX = 9;
export const PILE_LEAN_RAD = 0.028;
/** How far a lifted card rises (card-stack units, up the screen). */
export const PILE_RISE_PX = 7;

const EPS = 0.0015;
const ease = (v: number, to: number, k: number): number => {
  const n = v + (to - v) * k;
  return Math.abs(to - n) < EPS ? to : n;
};

/**
 * One frame (dt in 60 Hz frames). `over`: the pointer rests on the card; `pressed`: it is held down on it; (nx, ny): the
 * pointer's place on the card, -1..1. The press is quicker than the lift (a press should feel immediate).
 */
export function pileEase(s: PileState, over: boolean, pressed: boolean, nx: number, ny: number, dt: number): PileState {
  const d = Math.max(0, dt);
  s.lift = ease(s.lift, over ? 1 : 0, Math.min(1, 0.2 * d));
  s.press = ease(s.press, pressed ? 1 : 0, Math.min(1, 0.45 * d));
  const k = Math.min(1, 0.24 * d);
  s.lx = ease(s.lx, over ? Math.max(-1, Math.min(1, nx)) : 0, k);
  s.ly = ease(s.ly, over ? Math.max(-1, Math.min(1, ny)) : 0, k);
  s.beat = s.beat < EPS ? 0 : s.beat * Math.pow(0.86, d);
  return s;
}

/** The card's scale over its rest size: up when lifted, down when pressed, a kick on a beat. */
export const pileScale = (s: PileState): number => 1 + 0.04 * s.lift - 0.065 * s.press + 0.035 * s.beat;

/** Has it all come to rest (so the scene may idle)? */
export const pileAtRest = (s: PileState): boolean => s.lift === 0 && s.press === 0 && s.lx === 0 && s.ly === 0 && s.beat === 0;
