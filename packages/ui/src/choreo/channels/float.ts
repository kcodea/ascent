import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/** A floating number/glyph shown over a unit for a few seconds (damage/poison/shield/buff/keyword/gold). */
export interface Float {
  id: number;
  uid: string;
  text: string;
  kind: string;
}

/** A damage float for a minion that DIES this moment. Its unit collapses (`.unit.dying`, width→0) and is
 *  removed next moment, which would clip an in-unit float — so the killing-blow number is rendered in a
 *  board-level overlay at the unit's captured screen position instead, where it survives + lingers. */
export interface DeathFloat {
  id: number;
  x: number;
  y: number;
  text: string;
  kind: string;
}

/** Player-facing labels for granted keywords (the renamed terms — Reborn → Rise, etc.). Shared with
 *  `useCombatReplay.ts`'s narration (`narrate`/`narrateLog`), which imports this back. */
export const KW_FLOAT: Partial<Record<string, string>> = {
  R: 'Rise', DS: 'Ward', T: 'Taunt', V: 'Toxin', W: 'Flurry', C: 'Cleave', ST: 'Stealth', IMM: 'Immune',
};

/** A floating number/glyph for the unit the active event acts on. Verbatim extraction of the former
 *  `floatFor` in `useCombatReplay.ts`. */
function floatFor(e: CombatEvent | undefined): { uid: string; text: string; kind: string } | null {
  if (!e) return null;
  switch (e.type) {
    case 'dmg': return { uid: e.target, text: `${e.amount}`, kind: 'dmg' };
    case 'poison': return { uid: e.target, text: '☠', kind: 'poison' };
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    case 'buff': return { uid: e.target, text: `+${e.attack}/+${e.health}`, kind: 'buff' };
    case 'improve': return { uid: e.target, text: '✦', kind: 'buff' };
    case 'keyword': return { uid: e.target, text: KW_FLOAT[e.keyword] ?? e.keyword, kind: 'buff' };
    case 'maxGold': return { uid: e.target, text: `+${e.amount} max gold`, kind: 'gold' };
    case 'rally': return { uid: e.target, text: '☠', kind: 'rally' };
    default: return null;
  }
}

/**
 * Float channel (choreographer phase 3b) — the damage/poison/shield/buff/keyword/gold floats for one
 * moment's events, all at once. Verbatim extraction of the former per-beat float effect in
 * `useCombatReplay.ts`. Buff events are summed per target so a multi-proc effect (e.g. a re-procced
 * Deathrattle) shows one correct total, not several partials. `attackerUid` suppresses the attacker's own
 * retaliation number (only the struck unit shows a number) — pass `attackerOfImpact(beats, beatIdx - 1)`.
 * A unit dying THIS moment gets its damage number positioned in a board overlay via `findEl` instead of an
 * in-unit float (its slot collapses next moment, which would clip it).
 */
export function spawnFloats(
  moment: Moment,
  events: CombatEvent[],
  findEl: (uid: string) => Element | null,
  attackerUid: string | null,
): { floats: Float[]; deathFloats: DeathFloat[] } {
  const dying = new Set<string>();
  for (let i = moment.start; i < moment.end; i++) { const e = events[i]; if (e?.type === 'death') dying.add(e.target); }
  const spawned: Float[] = [];
  const deaths: DeathFloat[] = [];
  const buffByTarget = new Map<string, { a: number; h: number; id: number }>();
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    if (e?.type === 'buff') {
      const cur = buffByTarget.get(e.target) ?? { a: 0, h: 0, id: i };
      cur.a += e.attack;
      cur.h += e.health;
      buffByTarget.set(e.target, cur);
      continue;
    }
    const f = floatFor(e);
    if (!f) continue;
    if (f.kind === 'dmg' && f.uid === attackerUid) continue;
    if (f.kind === 'dmg' && dying.has(f.uid)) {
      const r = findEl(f.uid)?.getBoundingClientRect();
      if (r) { deaths.push({ id: i, x: r.left + r.width / 2, y: r.top + r.height * 0.5, text: f.text, kind: f.kind }); continue; }
    }
    spawned.push({ id: i, ...f });
  }
  for (const [uid, { a, h, id }] of buffByTarget) {
    spawned.push({ id, uid, text: `+${a}/+${h}`, kind: 'buff' });
  }
  return { floats: spawned, deathFloats: deaths };
}
