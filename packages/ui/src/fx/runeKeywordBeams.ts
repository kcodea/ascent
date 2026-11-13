import type { CombatEvent } from '@game/core';
import { badgeIdsForCombatFlag } from '@game/content';
import type { Moment } from '../choreo/compile';
import { KEYWORD_BEAM_GAP_MS, KEYWORD_BEAM_SOUND_MAX, launchKeywordBeam, type BeamKeyword } from './keywordBeam';
import { runeSlotPoint } from './keywordOrigin';
import { canPlayDefs } from './playDef';

/**
 * A RUNE GIVES RISE, EXECUTE OR WARD IN COMBAT (R-FX-KEYWORD-ORIGIN-01, owner 2026-11-13: "this same logic should
 * apply from any RUNE slot that applies these effects ... it would tendril from the rune slot itself"). The engine
 * marks a rune's fire with a `questTrigger` on its side and logs the grant with no giving minion (no source, or the
 * receiver named as its own source). The player's runes only: the foe's rack is not a slot these beams can leave.
 *
 * THE FIRE AND ITS GRANT ARE DIFFERENT BEATS (owner report 2026-11-13: Deathtouched Apple "did not show the
 * tendrils"). A `questTrigger` is its own beat, so the first version, which looked for both inside one beat, never
 * matched. They share the engine's `step` instead:
 *  - Rising Graves fires, THEN grants: the grant's beat launches, matched to the fire by step.
 *  - Deathtouched Apple grants inside the death's beat, THEN fires, and its receiver is a body that has not come back
 *    yet. The grant WAITS for that body's return (`reborn`) and leaves a breath after it (owner 2026-11-13: "its
 *    hitting a unit that isnt there, can it resummon and then get the tendril?").
 *  - Rising Graves' second Rise is a later step with no fire of its own: it continues the fire it directly follows.
 */
export interface RuneKeywordGrant { kw: BeamKeyword; target: string; flag: string }

/** The last rune fire, and where the run of beats that belong to it ends (the next beat may continue it). */
export interface RuneCarry { flag: string; end: number }

/** A grant held for its receiver to return to the board. */
export type WaitingGrant = RuneKeywordGrant;
/** Delay (ms at 1x) from a returning body's beat to its beam leaving, so the body is back on the board first. */
export const RUNE_BEAM_AFTER_RETURN_MS = 320;

/** How far (events) a grant and its rune fire may sit apart while sharing a step. */
const STEP_WINDOW = 16;

/** A keyword grant no minion gave: Rise / Execute with no source (or self-named, untinted), a Ward with no giving card. */
function grantOf(e: CombatEvent | undefined): { kw: BeamKeyword; target: string } | null {
  if (!e) return null;
  if (e.type === 'keyword' && (e.keyword === 'R' || e.keyword === 'V') && !e.tint && (e.source === undefined || e.source === e.target)) return { kw: e.keyword, target: e.target };
  // Flurry counts only with NO source: a body that gives itself Flurry (a Start of Combat) names itself.
  if (e.type === 'keyword' && e.keyword === 'W' && e.source === undefined) return { kw: 'W', target: e.target };
  if (e.type === 'shieldUp' && (e as { srcCard?: string }).srcCard === undefined) return { kw: 'DS', target: e.target };
  return null;
}

/** The player rune fire sharing `step`, within the window around `at` and inside [lo, hi). */
function fireWithStep(events: CombatEvent[], at: number, step: number | undefined, lo: number, hi: number): string | null {
  if (step === undefined) return null;
  for (let i = Math.max(lo, at - STEP_WINDOW); i < Math.min(hi, at + STEP_WINDOW + 1); i++) {
    const e = events[i];
    if (e?.type === 'questTrigger' && e.side === 'player' && e.step === step) return e.flag;
  }
  return null;
}

/**
 * The rune-given keywords to launch AS THIS BEAT STARTS, and the carry for the next beat.
 *  (a) a grant in this beat whose fire (same step) sits at or before this beat's end, or which continues the carry;
 *  (b) a fire in this beat whose grants (same step) sit BEFORE this beat: they waited for the fire.
 */
export function runeKeywordGrantsIn(
  moment: Moment, events: CombatEvent[], carry: RuneCarry | null, waiting: readonly WaitingGrant[] = [],
): { grants: RuneKeywordGrant[]; returned: RuneKeywordGrant[]; carry: RuneCarry | null; waiting: WaitingGrant[] } {
  const grants: RuneKeywordGrant[] = [];
  // A waiting grant leaves when its receiver's return is in THIS beat.
  const back = new Set<string>();
  for (let i = moment.start; i < moment.end; i++) { const e = events[i]; if (e?.type === 'reborn') back.add(e.target); }
  const returned = waiting.filter((w) => back.has(w.target));
  const stillWaiting: WaitingGrant[] = waiting.filter((w) => !back.has(w.target));
  /** Is `target` a body that died to return and has not returned by `from`? */
  const awaitsReturn = (target: string, grantAt: number, from: number): boolean => {
    let died = false;
    for (let j = Math.max(0, grantAt - STEP_WINDOW); j < grantAt; j++) { const d = events[j]; if (d?.type === 'death' && d.target === target && d.rise) died = true; }
    if (!died) return false;
    for (let j = grantAt; j < from; j++) if (events[j]?.type === 'reborn' && (events[j] as { target: string }).target === target) return false;
    for (let j = from; j < Math.min(events.length, from + 4 * STEP_WINDOW); j++) if (events[j]?.type === 'reborn' && (events[j] as { target: string }).target === target) return true;
    return false;
  };
  let next: RuneCarry | null = null;
  let onlyGrants = true;
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'questTrigger') {
      if (e.side !== 'player') continue;
      next = { flag: e.flag, end: moment.end };
      // (b) grants logged before this beat that share the fire's step.
      for (let j = Math.max(0, moment.start - STEP_WINDOW); j < moment.start; j++) {
        const g = grantOf(events[j]);
        if (!g || events[j]!.step !== e.step) continue;
        if (awaitsReturn(g.target, j, moment.end)) stillWaiting.push({ ...g, flag: e.flag });
        else grants.push({ ...g, flag: e.flag });
      }
      continue;
    }
    const g = grantOf(e);
    if (!g) { onlyGrants = false; continue; }
    // (a) its fire is at or before this beat's end (a later fire launches it itself, case b)...
    const flag = fireWithStep(events, i, e!.step, 0, moment.end)
      // ...or it directly continues the previous beat's fire.
      ?? (carry && carry.end === moment.start && fireWithStep(events, i, e!.step, moment.end, events.length) === null ? carry.flag : null);
    if (flag) { grants.push({ ...g, flag }); next = { flag, end: moment.end }; }
  }
  // A beat of nothing but continued grants keeps the carry alive for the one after it.
  if (!next && carry && carry.end === moment.start && onlyGrants && grants.length > 0) next = { flag: carry.flag, end: moment.end };
  return { grants, returned, carry: next, waiting: stillWaiting };
}

let carry: RuneCarry | null = null;
let waiting: WaitingGrant[] = [];

/** Beat start in COMBAT: each rune-given Rise / Execute / Ward leaves the rune's own slot, a gap apart. */
export function startRuneKeywordBeams(moment: Moment, events: CombatEvent[], speed: number, register: (id: number) => void): void {
  if (moment.start === 0) waiting = []; // a new fight: nothing waits across fights
  const out = runeKeywordGrantsIn(moment, events, carry, waiting);
  carry = out.carry;
  waiting = out.waiting.slice(-8);
  if (!canPlayDefs() || (out.grants.length === 0 && out.returned.length === 0)) return;
  let k = 0;
  const ordered = [...out.returned.map((g) => ({ g, first: RUNE_BEAM_AFTER_RETURN_MS })), ...out.grants.map((g) => ({ g, first: 0 }))];
  for (const { g, first } of ordered) {
    let at: { x: number; y: number } | null = null;
    for (const id of badgeIdsForCombatFlag(g.flag)) { at = runeSlotPoint(id); if (at) break; }
    if (!at) continue; // the flag belongs to something with no slot on screen (a quest): today's cue stands
    if (launchKeywordBeam(g.kw, at, g.target, { launchAt: first + k * KEYWORD_BEAM_GAP_MS, speed, sound: k < KEYWORD_BEAM_SOUND_MAX, register })) k++;
  }
}
