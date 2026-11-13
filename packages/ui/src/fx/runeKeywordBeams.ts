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
 */
export interface RuneKeywordGrant { kw: BeamKeyword; target: string; flag: string }

/** The last rune fire whose grants may continue into the very next beat (Rising Graves gives one Rise per beat). */
export interface RuneCarry { flag: string; end: number }

/**
 * The keyword grants in this moment that a player rune made, and the carry for the next moment. A moment with exactly
 * one player rune fire attributes its sourceless grants to it; a moment with none continues the previous moment's
 * fire only when it follows it directly and holds nothing but such grants.
 */
export function runeKeywordGrantsIn(moment: Moment, events: CombatEvent[], carry: RuneCarry | null): { grants: RuneKeywordGrant[]; carry: RuneCarry | null } {
  const flags = new Set<string>();
  const found: Array<{ kw: BeamKeyword; target: string }> = [];
  let other = 0;
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (!e) continue;
    if (e.type === 'questTrigger') { if (e.side === 'player') flags.add(e.flag); continue; }
    if (e.type === 'keyword' && (e.keyword === 'R' || e.keyword === 'V') && !e.tint && (e.source === undefined || e.source === e.target)) {
      found.push({ kw: e.keyword, target: e.target });
      continue;
    }
    if (e.type === 'shieldUp' && (e as { srcCard?: string }).srcCard === undefined) { found.push({ kw: 'DS', target: e.target }); continue; }
    other++;
  }
  let flag: string | null = null;
  if (flags.size === 1) flag = [...flags][0]!;
  else if (flags.size === 0 && carry && carry.end === moment.start && other === 0) flag = carry.flag;
  if (!flag || found.length === 0) return { grants: [], carry: flags.size === 1 ? { flag: [...flags][0]!, end: moment.end } : null };
  return { grants: found.map((g) => ({ ...g, flag: flag! })), carry: { flag, end: moment.end } };
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
    if (!at) continue; // the flag belongs to something with no slot on screen (a quest, the foe): today's cue stands
    if (launchKeywordBeam(g.kw, at, g.target, { launchAt: k * KEYWORD_BEAM_GAP_MS, speed, sound: k < KEYWORD_BEAM_SOUND_MAX, register })) k++;
  }
}
