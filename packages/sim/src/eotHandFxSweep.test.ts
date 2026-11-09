import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, reduceWithPresentation, type RunState } from './index';

/**
 * R-HANDFX-02, swept: EVERY End-of-Turn card (both gildings, with repeat ticks from cards played this turn) is run
 * against a hand holding minions of every tribe, some carrying a Ruby and some a plain buff. No consequence may aim
 * at a hand card whose stats and keywords did not change. Owner 2026-11-08 saw the false hand FX from Assembler and
 * from Dwarf End-of-Turn buffs (Kringle, Striker): both were the hand-Ruby snapshot bug, which hit every trigger.
 */
const TRIBES = ['dwarf', 'kobold', 'beast', 'demon', 'dragon', 'mech', 'undead', 'spirit', 'celestial'];

type Def = { id: string; tribe?: string; attack?: number; health?: number; effects?: { on: string }[] };
type Ev = { type: string; target?: { uid?: string }; targets?: { uid?: string }[] };

describe('no End-of-Turn card aims FX at a hand card it did not change (R-HANDFX-02)', () => {
  const defs = Object.values(CARD_INDEX as unknown as Record<string, Def>);
  const eot = defs.filter((d) => d.effects?.some((e) => e.on === 'endOfTurn'));
  const minionOf = (tribe: string): string | undefined =>
    defs.find((d) => d.tribe === tribe && !d.effects?.length && d.attack !== undefined)?.id ?? defs.find((d) => d.tribe === tribe)?.id;

  it('covers the End-of-Turn cards', () => {
    expect(eot.length).toBeGreaterThan(20);
  });

  it('every End-of-Turn card, plain and golden, leaves untouched hand cards alone', () => {
    const offenders: string[] = [];
    for (const d of eot) {
      for (const golden of [false, true]) {
        const tribe = d.tribe && d.tribe !== 'neutral' ? d.tribe : 'dwarf';
        const filler = minionOf(tribe)!;
        const board = [
          { uid: 'f1', cardId: filler, tribe, attack: 3, health: 3, keywords: [], golden: false },
          { uid: 'src', cardId: d.id, tribe: d.tribe ?? 'neutral', attack: d.attack ?? 3, health: d.health ?? 3, keywords: [], golden },
          { uid: 'f2', cardId: filler, tribe, attack: 3, health: 3, keywords: [], golden: false },
        ];
        const hand = TRIBES.flatMap((t, i) => {
          const id = minionOf(t);
          if (!id) return [];
          return [
            { uid: `h${i}r`, cardId: id, tribe: t, attack: 10, health: 20, keywords: [], golden: false, buffs: [{ source: 'Ruby', attack: 8, health: 18, count: 1 }] },
            { uid: `h${i}b`, cardId: id, tribe: t, attack: 6, health: 7, keywords: [], golden: false, buffs: [{ source: 'Kringle', attack: 4, health: 5, count: 2 }] },
          ];
        });
        const s = {
          ...createRun(3, 'warden'), phase: 'recruit', board, hand, gold: 10,
          playedThisTurn: ['dw_brakka', 'k_veinbreaker', 'fred'], // repeat-per-card effects tick more than once
        } as unknown as RunState;
        const { state: after, batch } = reduceWithPresentation(s, { type: 'faceOmen' }, true);
        const byUid = new Map(hand.map((c) => [c.uid, c]));
        for (const ev of (batch?.events ?? []) as unknown as Ev[]) {
          for (const t of [ev.target, ...(ev.targets ?? [])]) {
            const b = t?.uid ? byUid.get(t.uid) : undefined;
            if (!b) continue;
            const a = after.hand.find((c) => c.uid === b.uid) ?? after.board.find((c) => c.uid === b.uid);
            const changed = !a || a.attack !== b.attack || a.health !== b.health || JSON.stringify(a.keywords) !== JSON.stringify(b.keywords);
            if (!changed) offenders.push(`${d.id}${golden ? ' (golden)' : ''}: ${ev.type} on unchanged hand card ${b.cardId}`);
          }
        }
      }
    }
    expect([...new Set(offenders)]).toEqual([]);
  });
});
