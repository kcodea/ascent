import { anchorsForUnits, combatAnchorsFromRects, unitSelector } from './combatAnchors';
import { trackSettledSlot } from './settledSlot';
import { defArrivalMs } from './defArrival';
import { getDef } from './fxDefs';
import { canPlayDefs, playDef } from './playDef';
import { holdRise } from './riseHold';
import { holdExecute } from './executeHold';
import { holdWard } from './wardHold';
import { holdFlurry } from './flurryHold';
import { sfx } from '../sfx';
import type { Point } from './keywordOrigin';

/**
 * A KEYWORD'S BEAM FROM A POINT (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13): Rise, Execute or Ward given by something
 * that is not a minion (a spell, a hero power, a rune) sends that keyword's beam from a screen point to the receiver,
 * and the keyword's look appears when it lands. The same hold, sounds and follow-the-receiver behaviour as the
 * minion-given paths (`riseGivenLaunch.ts`, `executeGivenLaunch.ts`, `wardGivenLaunch.ts`).
 */
export type BeamKeyword = 'R' | 'V' | 'DS' | 'W' | 'CR';

/** Each keyword's beam, launch sound and landing sound (null = none / played another way). */
export const KEYWORD_BEAMS: Readonly<Record<BeamKeyword, { def: string; launchSfx: string | null; landSfx: string | null }>> = {
  R: { def: 'rise-beam', launchSfx: 'sfx-rise-wisp', landSfx: 'sfx-rise-applied' },
  V: { def: 'execute-beam', launchSfx: 'sfx-execute-slice', landSfx: 'sfx-execute-applied' },
  DS: { def: 'lastlight-beam', launchSfx: null, landSfx: null }, // the Ward sound is `sfx.shield()` at the landing
  W: { def: 'flurry-beam', launchSfx: 'sfx-flurry-whoosh', landSfx: 'sfx-flurry-swings' },
  CR: { def: 'crit-beam', launchSfx: 'sfx-crit-shing', landSfx: 'sfx-crit-impact' },
};

/** The gap (ms at 1x) between beams when one cause gives several keywords at once. */
export const KEYWORD_BEAM_GAP_MS = 180;
/** A cascade rings its sounds on its first few beams only. */
export const KEYWORD_BEAM_SOUND_MAX = 3;

/**
 * A screen point as a rect the anchor builder accepts. It rejects a zero-size rect as an unmounted element (the first
 * version passed one, so every point-origin beam fell through to its landing: sound and keyword, no beam; owner
 * report 2026-11-13, Lord of the Risen), so the point is a 2 px box centred on itself.
 */
export const pointRect = (p: Point): { left: number; top: number; width: number; height: number } => ({ left: p.x - 1, top: p.y - 1, width: 2, height: 2 });

/** Is this keyword one that travels on a beam? */
export const isBeamKeyword = (k: string): k is BeamKeyword => k in KEYWORD_BEAMS;

/** Hide `kw`'s look on `uid` for `ms` (each hold expires on its own; 0 releases it). */
export const holdKeywordLook = (kw: BeamKeyword, uid: string, ms: number): void => hold(kw, uid, ms);

const hold = (kw: BeamKeyword, uid: string, ms: number): void => {
  if (kw === 'R') holdRise(uid, ms); else if (kw === 'V') holdExecute(uid, ms); else if (kw === 'W') holdFlurry(uid, ms); else if (kw === 'DS') holdWard(uid, ms);
  // Critical Strike has no look on the card to hold back: it is a line in the card's keywords.
};

/**
 * Launch `kw`'s beam from `from` to `targetUid` after `launchAt` ms (at 1x). False when nothing can play (defs off,
 * the beam is not in the library, or the receiver is not on screen): the caller keeps its old cue. `from` may be a
 * function, read as the beam leaves (a giver that is still landing on the board); `def` / `gain` play a card's own
 * bound beam in place of the keyword's default.
 */
export function launchKeywordBeam(
  kw: BeamKeyword,
  from: Point | (() => Point | null),
  targetUid: string,
  opts: { launchAt?: number; speed?: number; sound?: boolean; onLand?: () => void; register?: (id: number) => void; def?: string; gain?: number } = {},
): boolean {
  if (!canPlayDefs()) return false;
  const beam = KEYWORD_BEAMS[kw];
  const defId = opts.def ?? beam.def;
  const def = getDef(defId);
  if (!def || !document.querySelector(unitSelector(targetUid))) return false;
  const s = opts.speed && opts.speed > 0 ? opts.speed : 1;
  const launchAt = Math.max(0, opts.launchAt ?? 0);
  const sound = opts.sound !== false;
  const register = opts.register ?? (() => {});
  const arrive = defArrivalMs(def);
  hold(kw, targetUid, (launchAt + arrive) / s + 50); // safety net; `land` releases it on time
  const land = (): void => {
    hold(kw, targetUid, 0);
    if (sound) {
      if (kw === 'DS') sfx.shield();
      const at = beam.landSfx ? anchorsForUnits(targetUid, targetUid) : null;
      if (at && beam.landSfx) playDef(beam.landSfx, at, { uids: { source: targetUid, target: targetUid } });
    }
    opts.onLand?.();
  };
  const launch = (): void => {
    const tEl = document.querySelector(unitSelector(targetUid));
    const origin = typeof from === 'function' ? from() : from;
    const anchors = tEl && origin
      ? combatAnchorsFromRects({ source: pointRect(origin), target: tEl.getBoundingClientRect(), row: null, viewport: { w: window.innerWidth, h: window.innerHeight } })
      : null;
    if (!anchors) { land(); return; }
    const settle = trackSettledSlot(() => document.querySelector(unitSelector(targetUid)));
    const stop = playDef(defId, settle ? { ...anchors, target: settle.start } : anchors,
      { uids: { source: null, target: targetUid }, index: 0, gain: opts.gain, target: settle?.get, onDone: settle?.stop });
    if (!stop) settle?.stop();
    if (sound && beam.launchSfx) playDef(beam.launchSfx, anchors, { uids: { source: null, target: targetUid } });
    if (arrive <= 0) land(); else register(window.setTimeout(land, arrive / s));
  };
  if (launchAt <= 0) launch(); else register(window.setTimeout(launch, launchAt / s));
  return true;
}
