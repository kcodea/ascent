import type { CombatEvent } from '@game/core';
import type { Moment } from '../compile';

/**
 * A floating number/glyph shown over a unit for a few seconds (damage/poison/shield/buff/keyword/gold).
 *
 * Rendered in a BOARD-LEVEL overlay (`.floatanchor` in Recruit.tsx), not inside the `.unit`. It used to be a
 * sibling of the unit's `<Card>`, which made it unreadable under the Pixi FX canvas: `.unit` becomes its own
 * stacking context in combat (`.attacking` z8, `.struck` z12, `.reborn` z14), so the float's `z-index: 25`
 * only ordered it against its OWN card — globally it painted at 8/12/14, under `.pixifx` (z110). No canvas
 * z-index can fix that (pick 20 and it covers the number on a struck unit; pick 7 and every effect drops under
 * the whole unit). Lifting the float out of the unit makes its z-index globally comparable, so the number wins
 * over every effect in every unit state, with no per-effect decision.
 *
 * `x`/`y` are the unit's LAYOUT-frame centre and `w`/`h` its footprint, both SNAPSHOT at spawn (see
 * `spawnFloats`). The overlay reproduces that box so every per-kind rule (`bottom: 15%`, `.float.sym`'s
 * `top: 38%`, the centred `.float.dmg`) and both keyframes (`floatup`/`floatupc`, `floatsym`) keep working
 * verbatim — they are still positioned against a card-sized box, it just lives at board level now.
 */
export interface Float {
  id: number;
  uid: string;
  text: string;
  kind: string;
  /** Viewport centre of the unit's SLOT at spawn. */
  x: number;
  y: number;
  /** The unit's footprint at spawn — the anchor box the per-kind percentage rules resolve against. */
  w: number;
  h: number;
}

/** Keyword-proc floats (shield/reborn/rally) that bloom big in the card centre, staggered after the damage
 *  number so the two never collide. Damage/gold numbers stay in the stat corner. (`poison`/Execute was dropped
 *  2026-07-22 — its red ☠ was a third signifier on a beat that already carries the crescent strike and the
 *  victim's red flash.) Lived in `Unit.tsx` until the floats moved to the board overlay. */
export const SYM_KINDS = new Set(['shield', 'shieldup', 'reborn', 'rally']);

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
  R: 'Rise', DS: 'Ward', T: 'Taunt', V: 'Execute', W: 'Flurry', C: 'Cleave', ST: 'Stealth', IMM: 'Immune',
};

/** A floating number/glyph for the unit the active event acts on. Verbatim extraction of the former
 *  `floatFor` in `useCombatReplay.ts`. */
function floatFor(e: CombatEvent | undefined): { uid: string; text: string; kind: string } | null {
  if (!e) return null;
  switch (e.type) {
    case 'dmg': return { uid: e.target, text: `${e.amount}`, kind: 'dmg' };
    // NO float for `poison`. It used to bloom a big red ☠ in the card centre; removed 2026-07-22 (owner) now
    // that the Execution Strike reads the kill on its own — the skull was a third signifier on the same beat,
    // stacked on top of the crescent and the victim's red flash. (`rally` keeps its own ☠, in purple.)
    case 'shieldUp': return { uid: e.target, text: '◇', kind: 'shieldup' };
    // CUT (owner, 2026-08-04): the stat badge now carries its own change — it withholds the new number and
    // rolls to it on the effect's clock (`fx/statHold.ts`). A `+2/+2` float rising off the card at the same
    // moment competes with that: two things asking for the eye, in the same place, saying the same thing.
    //
    // Only the STAT float goes. `improve` and `keyword` below stay: an effect improving or a minion gaining
    // Taunt is information no badge shows, so cutting those would remove a channel rather than de-duplicate
    // one. The combat LOG still narrates every buff in full (`useCombatReplay`), so the history is intact —
    // this removes a redundant on-card readout, not the record of what happened.
    case 'buff': return null;
    // Cut with the stat float (owner, 2026-08-04). The card's medallion already pulses on an improve and the
    // combat log narrates it; a bare ✦ rising off the card added a third telling of the same beat.
    case 'improve': return null;
    // Cut likewise. A gained keyword SHOWS on the card — the dome, the badge chrome, the keyword row — so
    // the float was announcing a change the card itself already makes visible and keeps visible.
    case 'keyword': return null;
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
 * A unit dying THIS moment gets a `DeathFloat` (a shorter-lived, card-centred variant) instead of a normal
 * float, because its slot collapses next moment.
 *
 * ── the position snapshot ────────────────────────────────────────────────────────────────────────────
 * EVERY float is now placed from a `rectOf` reading taken ONCE, here, at spawn — never re-read while it
 * lives. That matches the house rule for anchored FX (`fx/playDef.ts`, "when are anchors sampled"): a combat
 * moment is an event at a point in time, and re-resolving its geometry would mean a `getBoundingClientRect()`
 * per frame, which this repo bans (CLAUDE.md). A float lives ~1.5s and fires on an event, so ONE read per
 * spawned float is not a hot path — it is the same one-per-event read `deathFloats` have always done.
 *
 * The consequence, stated plainly: a unit that moves after the float spawns does NOT drag its number along.
 * That is what we want. `rectOf` is the caller's `layoutRectOf`-based SLOT reading, so a float on a lunging
 * attacker is placed where the card lives and returns to, not out in mid-board where it happens to be at the
 * instant of firing — the exact failure `layoutRectOf` was written for (the "phantom mid-board ring",
 * 2026-07-21). And when the board reflows around a death, the number stays where the hit landed instead of
 * sliding sideways with a card that is only re-seating itself.
 *
 * A float whose unit can't be measured (`rectOf` → null) is dropped: with no anchor there is nowhere
 * board-level to put it, and a number pinned at the viewport origin is worse than no number.
 */
export function spawnFloats(
  moment: Moment,
  events: CombatEvent[],
  rectOf: (uid: string) => { cx: number; cy: number; w: number; h: number } | null,
  attackerUid: string | null,
): { floats: Float[]; deathFloats: DeathFloat[] } {
  const dying = new Set<string>();
  for (let i = moment.start; i < moment.end; i++) { const e = events[i]; if (e?.type === 'death') dying.add(e.target); }
  const spawned: Float[] = [];
  const deaths: DeathFloat[] = [];
  for (let i = moment.start; i < moment.end; i++) {
    const e = events[i];
    // Every combat buff is now a directed FX, not a float: buff-OTHER (source !== target) → tendril,
    // self-buff (source === target) → pulse. Both flash the badge to the new value. So suppress ALL buff floats.
    if (e?.type === 'buff') continue;
    const f = floatFor(e);
    if (!f) continue;
    if (f.kind === 'dmg' && f.uid === attackerUid) continue;
    const r = rectOf(f.uid);
    if (!r) continue;
    if (f.kind === 'dmg' && dying.has(f.uid)) {
      deaths.push({ id: i, x: r.cx, y: r.cy, text: f.text, kind: f.kind });
      continue;
    }
    spawned.push({ id: i, ...f, x: r.cx, y: r.cy, w: r.w, h: r.h });
  }
  return { floats: spawned, deathFloats: deaths };
}
