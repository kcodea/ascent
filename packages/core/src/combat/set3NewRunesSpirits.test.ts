import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type Keyword } from '../index';
import { CARD_INDEX } from '@game/content';

/**
 * SET 3 NEW-CONCEPT RUNES, SPIRITS (owner review board 2026-11-23): the COMBAT halves, through real `simulate()`
 * fights with a served hand.
 *   · Kindred Rally (Epic): a minion summoned from your hand in combat fires your left-most Rally (free, per copy).
 *   · Deep Slumber (Epic): a hand minion's combat gain (`buffHand`) is paid once more per copy.
 * The Shop halves (and Last Dance / Welcome Party / Bonfire) are `packages/sim/src/set3NewRunesSpirits.test.ts`.
 */
const RALLY: CardDef = { id: 'dbg_kr_rally', name: 'dbg_kr_rally', tribe: 'neutral', tier: 1, attack: 1, health: 1000, keywords: ['RL'], effects: [{ on: 'onAttack', do: 'rallyBuffSelf', params: { attack: 1, health: 1 } }], text: '' };
CARD_INDEX[RALLY.id] = RALLY;

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);
const handMinion = (uid: string, cardId: string, over: Partial<{ attack: number; health: number; keywords: Keyword[]; golden: boolean }> = {}) => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords] as Keyword[], golden: false, ...over };
};
type Hand = ReturnType<typeof handMinion>[];
const fight = (mine: BoardMinion[], foes: BoardMinion[], mods: object = {}, hand: Hand = [], seed = 5) =>
  simulate(mine, foes, makeRng(seed), CARD_INDEX,
    combatSide({ tier: 6, tribes: ['undead', 'spirit'], questMods: mods, handMinions: hand }),
    combatSide({ tier: 6 }));

type Summon = Extract<CombatEvent, { type: 'summon' }>;
type HandBuff = Extract<CombatEvent, { type: 'handBuff' }>;
const fromHandSummons = (evs: CombatEvent[]): Summon[] => evs.filter((e): e is Summon => e.type === 'summon' && e.side === 'player' && !!(e as { fromHandUid?: string }).fromHandUid);
const triggers = (evs: CombatEvent[], flag: string) => evs.filter((e) => e.type === 'questTrigger' && e.flag === flag);
const ralliesOf = (evs: CombatEvent[], uid: string) => evs.filter((e) => e.type === 'sc' && e.source === uid && e.text === 'Rally');
/** The lead's Rally lines on the same beat (`step`) as a Kindred Rally pulse: the free Rallies the rune fired. */
const freeRallies = (evs: CombatEvent[], uid: string): number => {
  const steps = new Set(triggers(evs, 'runeKindredRally').map((e) => (e as { step?: number }).step));
  return ralliesOf(evs, uid).filter((e) => steps.has((e as { step?: number }).step)).length;
};
const handBuffs = (evs: CombatEvent[]): HandBuff[] => evs.filter((e): e is HandBuff => e.type === 'handBuff' && e.side === 'player');

// Tide Caller's Echo summons the highest-Health hand minion: the Spirit hand-summon path. A durable Rally body sits
// left-most so every hand-summon has a living Rally to fire.
const board = () => [bm(RALLY.id), bm('sp3_dreamtide', { attack: 1, health: 1 }), bm('sp3_dreamtide', { attack: 1, health: 1 })];
const hand = (): Hand => [handMinion('h1', 'u3_poochy', { attack: 4, health: 4, keywords: [] }), handMinion('h2', 'u3_poochy', { attack: 2, health: 2, keywords: [] })];

describe('Rune of the Kindred Rally', () => {
  it('every minion summoned from the hand fires the left-most Rally once (a free Rally, on its own beat)', () => {
    const off = fight(board(), [foe(3, 500)], {}, hand());
    const on = fight(board(), [foe(3, 500)], { runeKindredRally: true }, hand());
    const lead = on.initial.player[0]!.uid;
    const fh = fromHandSummons(on.events);
    expect(fh.length, 'the Callers summoned from the hand').toBe(2);
    expect(triggers(on.events, 'runeKindredRally')).toHaveLength(fh.length);
    expect(triggers(off.events, 'runeKindredRally')).toHaveLength(0);
    // Each pulse is followed by the lead's Rally line before the next event of any other kind of trigger.
    for (const t of triggers(on.events, 'runeKindredRally')) {
      const i = on.events.indexOf(t);
      const next = on.events.slice(i + 1).find((e) => e.type === 'sc' && e.text === 'Rally');
      expect(next && (next as { source?: string }).source, 'the left-most Rally body answers').toBe(lead);
    }
    // One free Rally per pulse, on the pulse's own beat.
    expect(freeRallies(on.events, lead)).toBe(fh.length);
  });
  it('two copies fire it twice per hand-summon', () => {
    const on = fight(board(), [foe(3, 500)], { runeKindredRally: true, flagCopies: { runeKindredRally: 2 } }, hand());
    const lead = on.initial.player[0]!.uid;
    const fh = fromHandSummons(on.events);
    expect(triggers(on.events, 'runeKindredRally')).toHaveLength(fh.length);
    expect(freeRallies(on.events, lead)).toBe(2 * fh.length);
  });
  it('no Rally body on the board: nothing (no pulse); an ordinary summon never fires it', () => {
    const noRally = fight([bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(3, 500)], { runeKindredRally: true }, hand());
    expect(fromHandSummons(noRally.events).length).toBeGreaterThan(0);
    expect(triggers(noRally.events, 'runeKindredRally')).toHaveLength(0);
    const plain = fight([bm(RALLY.id), bm('sp3_dreamtide', { attack: 1, health: 1 })], [foe(3, 500)], { runeKindredRally: true }, []);
    expect(triggers(plain.events, 'runeKindredRally'), 'an empty hand summons nothing from it').toHaveLength(0);
  });
  it('is deterministic for a seed', () => {
    const a = fight(board(), [foe(3, 500)], { runeKindredRally: true }, hand(), 9);
    const b = fight(board(), [foe(3, 500)], { runeKindredRally: true }, hand(), 9);
    expect(a.events).toEqual(b.events);
  });
});

describe('Rune of the Deep Slumber — combat half', () => {
  // Hearth Whisperer: "Whenever this takes damage, give a random minion in your hand +1/+2" (a combat `buffHand`).
  const whisperer = () => [bm('sp3_hearthwhisperer', { health: 60 })];
  const h = (): Hand => [handMinion('h1', 'u3_poochy', { attack: 1, health: 1, keywords: [] })];
  it('every hand gain lands doubled, pulsing the rune; the carry-back matches', () => {
    const off = fight(whisperer(), [foe(2, 500)], {}, h());
    const on = fight(whisperer(), [foe(2, 500)], { runeDeepSlumber: true }, h());
    const bo = handBuffs(off.events), bn = handBuffs(on.events);
    expect(bo.length).toBeGreaterThan(0);
    expect(bn.length).toBe(bo.length);
    for (const e of bo) expect([e.attack, e.health]).toEqual([1, 2]);
    for (const e of bn) expect([e.attack, e.health]).toEqual([2, 4]);
    expect(triggers(on.events, 'runeDeepSlumber')).toHaveLength(bn.length);
    expect(triggers(off.events, 'runeDeepSlumber')).toHaveLength(0);
  });
  it('two copies triple it', () => {
    const on = fight(whisperer(), [foe(2, 500)], { runeDeepSlumber: true, flagCopies: { runeDeepSlumber: 2 } }, h());
    for (const e of handBuffs(on.events)) expect([e.attack, e.health]).toEqual([3, 6]);
  });
});
