/**
 * B11 — the operators' FEED procedures as macro steps.
 *
 * The engine-combo macro (`generalistPilot.ts::assemble`) needs, once a combo's pieces are fielded, the per-line
 * operation a strong player performs every turn: the Ales cast in order with the champion seated left, the spell
 * on Mirrorwing first, the Chipper's Demons played, the Echo body seated left-most, the Blarts at the back. The
 * B9 operators already hold those procedures (`feed`, `spellTarget`, `slot`); this module reads them as a list
 * of candidate actions from a visible state, one step at a time (the caller applies a step on a clone, validates
 * it, and asks again from the new state), so nothing is rewritten and nothing is applied unvalidated.
 */
import { CARD_INDEX } from '@game/content';
import type { Action, RunState } from '../../../state';
import type { BotVisibleState } from '../../../productionBots/types';
import { CAST_ORDER, castableNow, isSpellCard, spellNeedsTarget, spellPolicyOf } from './spells';
import { stats, type LineOperator, type TurnMemory } from './types';

const freshMemory = (wave: number): TurnMemory => ({ wave, rolls: 0, froze: false, usedPower: false, bought: new Set(), sold: new Set(), refused: new Set(), arranged: new Set(), orderedByLine: false, castOn: new Set() });

/** The next move toward the line's desired order (stable by `slot`), or null when the board is in order. */
export function lineArrangementMove(op: LineOperator, v: BotVisibleState): Action | null {
  const desired = v.board.map((c, i) => ({ c, i, slot: op.slot(c, v) })).sort((a, b) => a.slot - b.slot || a.i - b.i);
  for (let i = 0; i < desired.length; i++) {
    if (desired[i]!.c.uid !== v.board[i]!.uid) return { type: 'reposition', uid: desired[i]!.c.uid, toIndex: i };
  }
  return null;
}

/**
 * The line's feed actions from `v`, in the order the operator skeleton takes them: the line's own `feed` hook
 * (Ales in order, the Chipper's Demons), then the hand's spells by `CAST_ORDER` through the line's `spellTarget`
 * (never a `never` spell, never a Choose One — its pick is a prompt the macro does not script), then a Ruby on
 * the line's spell body, then one move toward the line's arrangement. `skip` holds the actions the caller has
 * already seen refused this chain (JSON-keyed), so a refused step is not proposed twice.
 */
export function operatorFeedActions(op: LineOperator, v: BotVisibleState, run: RunState, skip: ReadonlySet<string>): Action[] {
  const mem = freshMemory(v.wave);
  for (const k of skip) {
    // The hooks read `refused` by `play:<uid>` / `seat:<uid>` keys; mirror the caller's refusals into them.
    mem.refused.add(k);
  }
  const out: Action[] = [];
  const push = (a: Action): void => { if (!skip.has(feedKey(a))) out.push(a); };
  for (const a of op.feed(v, run, mem)) push(a);
  const spells = v.hand.filter((c) => isSpellCard(c.cardId));
  for (const kind of CAST_ORDER) {
    for (const c of spells) {
      const p = spellPolicyOf(c.cardId);
      if (p.kind !== kind || p.kind === 'never' || !castableNow(c.cardId, v)) continue;
      const def = CARD_INDEX[c.cardId]!;
      if (def.chooseOne?.length) continue;
      if (spellNeedsTarget(c.cardId)) {
        const t = op.spellTarget(v, c.cardId, mem);
        if (!t) continue;
        if (p.targetBelow !== undefined && stats(t) >= p.targetBelow) continue;
        push({ type: 'play', uid: c.uid, targetUid: t.uid });
        continue;
      }
      push({ type: 'play', uid: c.uid });
    }
  }
  const ruby = v.hand.find((c) => CARD_INDEX[c.cardId]?.ruby);
  if (ruby) {
    const t = op.spellTarget(v, ruby.cardId, mem) ?? [...v.board].sort((a, b) => stats(b) - stats(a))[0];
    if (t) push({ type: 'play', uid: ruby.uid, targetUid: t.uid });
  }
  const move = lineArrangementMove(op, v);
  if (move) push(move);
  return out;
}

/** The key a feed action is remembered under when refused (matches the operators' `refused` vocabulary). */
export function feedKey(a: Action): string {
  if (a.type === 'play') return `play:${a.uid}`;
  if (a.type === 'reposition') return `seat:${a.uid}`;
  if (a.type === 'sell') return `sell:${a.uid}`;
  return JSON.stringify(a);
}
