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
 *  - Deathtouched Apple grants inside the death's beat, THEN fires: the FIRE's beat launches, so the beam leaves as
 *    the rune pulses and not while the body is still being struck.
 *  - Rising Graves' second Rise is a later step with no fire of its own: it continues the fire it directly follows.
 */
export interface RuneKeywordGrant { kw: BeamKeyword; target: string; flag: string }

/** The last rune fire, and where the run of beats that belong to it ends (the next beat may continue it). */
export interface RuneCarry { flag: string; end: number }

/** How far (events) a grant and its rune fire may sit apart while sharing a step. */
const STEP_WINDOW = 16;

/** A keyword grant no minion gave: Rise / Execute with no source (or self-named, untinted), a Ward with no giving card. */
function grantOf(e: CombatEvent | undefined): { kw: BeamKeyword; target: string } | null {
  if (!e) return null;
  if (e.type === 'keyword' && (e.keyword === 'R' || e.keyword === 'V') && !e.tint && (e.source === undefined || e.source === e.target)) return { kw: e.keyword, target: e.target };
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
export function runeKeywordGrantsIn(moment: Moment, events: CombatEvent[], carry: RuneCarry | null): { grants: RuneKeywordGrant[]; carry: RuneCarry | null } {
  const grants: RuneKeywordGrant[] = [];
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
        if (g && events[j]!.step === e.step) grants.push({ ...g, flag: e.flag });
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
  return { grants, carry: next };
}

let carry: RuneCarry | null = null;

/** Beat start in COMBAT: each rune-given Rise / Execute / Ward leaves the rune's own slot, a gap apart. */
export function startRuneKeywordBeams(moment: Moment, events: CombatEvent[], speed: number, register: (id: number) => void): void {
  const out = runeKeywordGrantsIn(moment, events, carry);
  carry = out.carry;
  if (!canPlayDefs() || out.grants.length === 0) return;
  let k = 0;
  for (const g of out.grants) {
    let at: { x: number; y: number } | null = null;
    for (const id of badgeIdsForCombatFlag(g.flag)) { at = runeSlotPoint(id); if (at) break; }
    if (!at) continue; // the flag belongs to something with no slot on screen (a quest): today's cue stands
    if (launchKeywordBeam(g.kw, at, g.target, { launchAt: k * KEYWORD_BEAM_GAP_MS, speed, sound: k < KEYWORD_BEAM_SOUND_MAX, register })) k++;
  }
}
