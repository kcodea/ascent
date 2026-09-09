import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';

/**
 * A FREE RALLY REACHES THE RALLY WATCHERS (Bug Board 7e04222d, 2026-09-09: "hawkus doesnt seem to be triggering
 * dawnclaw after a rally unit triggers its rally effect").
 *
 * The capsule showed Hawkus firing on every REAL swing of the side's Rally minion — and staying dark on the
 * one Rally the player watched first: Rune of Rallying's free Start-of-Combat Rally, which ran only the
 * rallier's own effects. The engine already counts a free Rally as a Rally trigger for the quests; now the
 * watchers on other bodies hear it too. Ally-ATTACK watchers must not: a free Rally is not an attack.
 */
const bm = (cardId: string, uid: string, attack: number, health: number, keywords?: string[]): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: keywords ?? [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false } as unknown as BoardMinion);
const wall = [bm('sandbag', 'W', 0, 4000)];
const fight = (board: BoardMinion[], mods?: Record<string, unknown>) => simulate(
  board, wall, makeRng(4), CARD_INDEX,
  combatSide({ tier: 6, tribes: ['beast', 'demon'], ...(mods ? { questMods: mods } : {}) } as never), combatSide({ tier: 1 }));
const rallies = (r: ReturnType<typeof simulate>, source: string) => r.events.filter((e) => e.type === 'rally' && (e as { source: string }).source === source);
const stepOf = (e: unknown) => (e as { step?: number }).step;

describe('Rune of Rallying — the free Start-of-Combat Rally', () => {
  // left-most Echo (Hawkus's target) · Hawkus · the Rally minion
  const board = () => [bm('spore', 'ECHO', 0, 400), bm('b2_hawkus', 'HAWK', 0, 400), bm('b2_echohorn', 'RL', 6, 400, ['RL'])];

  it('fires Hawkus at the SAME step as the rune trigger, before any swing', () => {
    const r = fight(board(), { runeRallying: true });
    const hawk = r.initial.player[1]!.uid;
    const runeStep = stepOf(r.events.find((e) => e.type === 'questTrigger' && (e as { flag: string }).flag === 'runeRallying'));
    expect(runeStep, 'the rune fired').toBeDefined();
    const firstSwing = stepOf(r.events.find((e) => e.type === 'attack'));
    const early = rallies(r, hawk).filter((e) => stepOf(e) === runeStep);
    expect(early.length, "Hawkus answered the free Rally").toBe(1);
    expect(runeStep!).toBeLessThan(firstSwing!);
  });

  it('…and still exactly once per real Rally swing afterwards (nothing doubled)', () => {
    const withRune = fight(board(), { runeRallying: true });
    const without = fight(board());
    const hawkA = withRune.initial.player[1]!.uid, hawkB = without.initial.player[1]!.uid;
    // Same seed, same fight either way — the rune adds exactly ONE Hawkus proc (its free Rally) and nothing else.
    expect(rallies(without, hawkB).length).toBeGreaterThan(0);
    expect(rallies(withRune, hawkA).length).toBe(rallies(without, hawkB).length + 1);
  });

  it('an ally-ATTACK watcher does not hear a free Rally (it is not an attack)', () => {
    // Crypt Drake-style watchers count swings; none should be credited by the rune's Start-of-Combat Rally.
    const r = fight(board(), { runeRallying: true });
    const runeStep = stepOf(r.events.find((e) => e.type === 'questTrigger' && (e as { flag: string }).flag === 'runeRallying'));
    expect(r.events.some((e) => e.type === 'attack' && stepOf(e) === runeStep)).toBe(false);
  });
});
