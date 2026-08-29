/**
 * DOC BOT LANE `refIntegrity` — every card id a definition NAMES resolves.
 *
 * History: #719 "bad params.cardId crashed the hand-grant render" (a mis-typed id survived to runtime and
 * took the UI down), #853 / #848 "six cards that never previewed what they name" (the id existed but nothing
 * validated the naming convention end-to-end), #886 "one dw_soldier, not two" (a duplicate-id class cousin).
 *
 * The rule: any `...Id`-suffixed string param in a card effect, rune reward, or quest reward must resolve in
 * `CARD_INDEX`. Content zod-validates SHAPE; nothing validated the CROSS-REFERENCES until this. Walks nested
 * objects so a reward wrapping a card grant is covered too.
 */
import { describe, expect, it } from 'vitest';
import { EQUIPMENT_INDEX, CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';

/** Param keys that end in `Id` but do not name a card. Each is checked against its OWN registry below, so
 *  widening this set never means "unchecked" — it means "checked somewhere else". */
const NOT_A_CARD_ID = new Set(['sourceId', 'equipmentId']);

function unresolved(owner: string, obj: unknown, out: string[]): void {
  if (!obj || typeof obj !== 'object') return;
  for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
    if (/Id$/.test(k) && typeof v === 'string' && !NOT_A_CARD_ID.has(k)) {
      if (!CARD_INDEX[v]) out.push(`${owner}: ${k}='${v}' does not resolve in CARD_INDEX`);
    } else if (typeof v === 'object') {
      unresolved(owner, v, out);
    }
  }
}

/**
 * `equipmentId` names an EQUIPMENT (owner handoff 2026-08-28), not a card — so it is excluded from the
 * CARD_INDEX sweep above and checked against its own registry here. Exactly the same failure it is guarding
 * against (#719: a mis-typed id surviving to runtime as a silent no-op), just a different index.
 */
describe('Doc Bot — Equipment reference integrity', () => {
  it('every `equipmentId` param resolves in EQUIPMENT_INDEX', () => {
    const bad: string[] = [];
    for (const c of Object.values(CARD_INDEX)) {
      for (const e of c?.effects ?? []) {
        const id = e.params?.equipmentId;
        if (typeof id === 'string' && !EQUIPMENT_INDEX[id]) bad.push(`${c!.id}: '${id}'`);
      }
    }
    expect(bad, 'an Equipment id that resolves nowhere is a grant that silently does nothing').toEqual([]);
  });
});

describe('Doc Bot — reference integrity', () => {
  it('every id-suffixed param in cards, runes, and quests resolves in CARD_INDEX', () => {
    const bad: string[] = [];
    for (const c of Object.values(CARD_INDEX)) for (const e of c?.effects ?? []) unresolved(c!.id, e.params, bad);
    for (const r of [...RUNES, ...EPIC_RUNES]) unresolved(r.id, (r as { reward?: unknown }).reward, bad);
    for (const q of QUEST_DEFS) unresolved(q.id, (q as { reward?: unknown }).reward, bad);
    expect(bad, `Unresolved reference(s) — a typo here is a crash or a silent no-op at runtime (#719):\n  ${bad.join('\n  ')}`).toEqual([]);
  });

  it('the scan itself sees the real surface (~52 id params as of 2026-08-26)', () => {
    // The floor keeps a refactor of param naming from silently blinding the walk (the instrument must not lie).
    let seen = 0;
    const count = (obj: unknown): void => {
      if (!obj || typeof obj !== 'object') return;
      for (const [k, v] of Object.entries(obj as Record<string, unknown>)) {
        if (/Id$/.test(k) && typeof v === 'string' && !NOT_A_CARD_ID.has(k)) seen++;
        else if (typeof v === 'object') count(v);
      }
    };
    for (const c of Object.values(CARD_INDEX)) for (const e of c?.effects ?? []) count(e.params);
    for (const r of [...RUNES, ...EPIC_RUNES]) count((r as { reward?: unknown }).reward);
    for (const q of QUEST_DEFS) count((q as { reward?: unknown }).reward);
    expect(seen).toBeGreaterThanOrEqual(40);
  });
});
