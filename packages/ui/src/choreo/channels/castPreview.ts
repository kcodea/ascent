/**
 * THE COMBAT CAST-PREVIEW CHANNEL (owner ask 2026-09-23): a minion that casts a spell mid-fight shows that
 * spell's card preview above itself, on the replay clock, the way the shop shows it above a rune or minion.
 *
 * Scanned PER EVENT, not per moment kind, for the same reason `rallyFired.ts` is: the simulator announces every
 * "X casts Y" as an `sc` event stamped with the spell's id (`spellId`, the 2026-09-01 Dragonflame rule), and
 * that event lands wherever its cast resolved — a `scNarrate` moment of its own, or absorbed into the caster's
 * attack wind-up (an on-attack cast). A cue keyed on the kind could never see the absorbed case.
 *
 * ONCE PER FIGHT (owner detail 2026-09-23): *"for card like fatecarver or warflame that casts the same spell
 * every time, it should only do the quick pop one time in combat."* `CastPreviewMemory` remembers each
 * (caster uid, spell id) pair claimed this fight; later casts of the same spell by the same body get no preview
 * (their buff FX and floats still play), a DIFFERENT spell from the same body previews once too, and the memory
 * resets at the start of every combat and on a replay seek / rewatch.
 */
import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

export interface CombatSpellCast { source: string; spellId: string }

/** Every "X casts Y" in the moment window, in event order. Only `sc` events carrying a `spellId` are casts;
 *  a plain narration line (a spell-power gain) carries none and is never a preview. */
export function spellCastsIn(moment: Pick<Moment, 'start' | 'end'>, events: readonly CombatEvent[]): CombatSpellCast[] {
  const out: CombatSpellCast[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'sc' && typeof e.spellId === 'string' && typeof e.source === 'string') out.push({ source: e.source, spellId: e.spellId });
  }
  return out;
}

/** The once-per-fight memory: `claim` says whether this (caster, spell) pair may preview — true the first time,
 *  false after — until `reset`. */
export class CastPreviewMemory {
  private seen = new Set<string>();
  claim(source: string, spellId: string): boolean {
    const key = `${source}|${spellId}`;
    if (this.seen.has(key)) return false;
    this.seen.add(key);
    return true;
  }
  reset(): void { this.seen.clear(); }
}
