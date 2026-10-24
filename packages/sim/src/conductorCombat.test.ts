/**
 * CONDUCTOR: the improvement is RUN-WIDE and steps on EVERY trigger of the Shout (owner 2026-10-24):
 *   "every played conductor should buff every other conductor's buff. so if one conductor is played, the next
 *    conductor found gets the increases buff from it"
 *   "no, it improves by +3/+3 each trigger of the shout"
 *   "so if it gets triggered in combat, those stats won't be permanently granted, but the improvement would be"
 *
 * One arena body serves both phases (`ARENA_EFFECTS.battlecryConductorAdjacent`): grant (3 + N) x golden to the
 * adjacent minions, THEN raise the run-wide N (`conductorBuff`) by 3 x Rune of Mastery. The shop writes
 * `RunState.conductorBuff`; combat grows the side's live value and carries the growth back at settle.
 */
import { describe, expect, it } from 'vitest';
import { conductorText } from '../../ui/src/cardText';
import { snapshotBoard } from './snapshot';
import { opponentBoard } from './opponents';
import { replayBattlecry } from './recruit';
import { ANCIENT_IDS, createRun, enableAncients, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState } from './index';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [], ...extra } as BoardMinion);
const buffs = (events: readonly CombatEvent[]) =>
  events.filter((e) => e.type === 'buff').map((e) => e as unknown as { attack: number; health: number; target: string; source?: string });
const recruit = (over: Partial<RunState>): RunState => ({ ...createRun(1), phase: 'recruit', embers: 40, hand: [], shop: [], ...over } as RunState);
const ALLEY = CARD_INDEX['alley']!;

describe('Conductor: every trigger improves EVERY Conductor by +3/+3 (run-wide)', () => {
  it('play 1 grants +3/+3, play 2 (another copy) grants +6/+6, a re-trigger grants +9/+9 and steps again', () => {
    let s = recruit({
      board: [card('a', 'alley'), card('b', 'alley')],
      hand: [card('c1', 'n2_conductor'), card('c2', 'n2_conductor')],
    });
    s = reduce(s, { type: 'play', uid: 'c1', toIndex: 1 });
    expect(s.board.map((c) => [c.attack, c.health])).toEqual([[ALLEY.attack + 3, ALLEY.health + 3], [2, 4], [ALLEY.attack + 3, ALLEY.health + 3]]);
    expect(s.conductorBuff, 'the run-wide improvement stepped by +3').toBe(3);
    expect(s.board[1]!.summonBonus ?? 0, 'nothing per-copy is written any more').toBe(0);
    // The SECOND copy (found later, still in hand) already grants the improved value: +6/+6 to its one neighbour.
    s = reduce(s, { type: 'play', uid: 'c2', toIndex: 0 });
    expect([s.board[1]!.attack, s.board[1]!.health]).toEqual([ALLEY.attack + 3 + 6, ALLEY.health + 3 + 6]);
    expect(s.conductorBuff).toBe(6);
    // A RE-TRIGGER of the first copy (Moira / Ryme / Dawnclaw / hero power: `replayBattlecry`) pays +9/+9 and steps.
    const c1 = s.board.find((c) => c.uid === 'c1')!;
    replayBattlecry(s, c1);
    expect(s.conductorBuff, '"it improves by +3/+3 each trigger of the shout"').toBe(9);
    const right = s.board.find((c) => c.uid === 'b')!;
    expect([right.attack, right.health]).toEqual([ALLEY.attack + 3 + 9, ALLEY.health + 3 + 9]);
  });

  it('a Conductor still in the SHOP prints the improved grant', () => {
    let s = recruit({ board: [card('a', 'alley')], hand: [card('c', 'n2_conductor')] });
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 1 });
    expect(conductorText('n2_conductor', false, s.conductorBuff ?? 0)).toContain('{{+6/+6}}');
  });

  it('gilded doubles the applied grant, not the step', () => {
    let s = recruit({ board: [card('a', 'alley')], hand: [card('g', 'n2_conductor', { golden: true, attack: 4, health: 8 })], conductorBuff: 3 });
    s = reduce(s, { type: 'play', uid: 'g', toIndex: 1 });
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([ALLEY.attack + 12, ALLEY.health + 12]); // (3 + 3) x 2
    expect(s.conductorBuff, 'the step is +3 gilded or not').toBe(6);
  });

  it('Rune of Mastery multiplies the step', () => {
    let s = recruit({ board: [card('a', 'alley')], hand: [card('c', 'n2_conductor')], runeMastery: true });
    s = reduce(s, { type: 'play', uid: 'c', toIndex: 1 });
    expect(s.conductorBuff).toBe(6);
  });

  it('a legacy per-copy accrual (the 2026-09-23 design) still pays on top', () => {
    const s = recruit({ board: [card('a', 'alley'), card('c', 'n2_conductor', { summonBonus: 2 })], conductorBuff: 3 });
    replayBattlecry(s, s.board[1]!);
    expect([s.board[0]!.attack, s.board[0]!.health]).toEqual([ALLEY.attack + 8, ALLEY.health + 8]);
    expect(s.conductorBuff).toBe(6);
  });
});

describe('Conductor in combat: the grant is combat-only, the improvement is permanent', () => {
  it("a Parting Cry re-fire pays (3 + the side's N), and the step rides the carry-back", () => {
    const r = simulate(
      [bm('dw_orin', 'L', 4, 99), bm('n2_conductor', 'C', 1, 1, { partingCry: true }), bm('dw_orin', 'R', 4, 99)],
      [bm('sandbag', 'B', 6, 30)],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 4, conductorBuff: 6 }), combatSide({ tier: 6 }),
    );
    expect(buffs(r.events).filter((b) => b.attack === 9 && b.health === 9).length, 'both live neighbours get +9/+9').toBe(2);
    expect(r.playerShoutCarry?.conductorBuff, 'one trigger: +3 carried back').toBe(3);
    expect(r.events.some((e) => e.type === 'improve' && (e as { conductor?: number }).conductor === 3), 'logged for the live text').toBe(true);
  });

  it("an ENEMY Conductor uses its own run's value, and its growth never reaches the player", () => {
    const r = simulate(
      [bm('sandbag', 'B', 6, 30)],
      [bm('dw_orin', 'L', 4, 99), bm('n2_conductor', 'C', 1, 1, { partingCry: true }), bm('dw_orin', 'R', 4, 99)],
      makeRng(5), CARD_INDEX,
      combatSide({ tier: 6, conductorBuff: 30 }), combatSide({ tier: 4, conductorBuff: 3 }),
    );
    expect(buffs(r.events).filter((b) => b.attack === 6 && b.health === 6).length, "the foe's N = 3: +6/+6").toBe(2);
    expect(r.playerShoutCarry?.conductorBuff ?? 0).toBe(0);
  });

  it('a recorded board carries its run-wide value into the fight (snapshot)', () => {
    const s = recruit({ board: [card('c', 'n2_conductor')], conductorBuff: 9 });
    const snap = snapshotBoard(s);
    expect(snap.conductorBuff).toBe(9);
    expect(opponentBoard(snap)[0]!.cardId).toBe('n2_conductor');
  });
});

// End to end: Auctioneer x Time fires the EDGE Shouts at Start of Combat, then settle.
const tough = (uid: string, cardId: string): BoardCard => ({ ...card(uid, cardId), health: 400 });
const withTime = (over: Partial<RunState>): RunState => {
  const id: AncientId = 'time';
  let s = enableAncients({ ...createRun(7, 'myra'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id });
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});

describe('Conductor end to end: N combat triggers give +3/+3 x N in the next Shop, combat stats gone', () => {
  it('two edge Conductors fire in combat; settle banks +6 and the middle minion keeps only its Shop stats', () => {
    const s = withTime({ board: [tough('c1', 'n2_conductor'), tough('w', 'whelpling'), tough('c2', 'n2_conductor')], conductorBuff: 0 });
    const fought = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
    const ev = fought.lastCombat!.events as CombatEvent[];
    const steps = ev.filter((e) => e.type === 'improve' && (e as { conductor?: number }).conductor).length;
    expect(steps, 'both Conductor Shouts fired in the fight').toBe(2);
    const settled = reduce(fought, { type: 'resolveCombat' });
    expect(settled.conductorBuff, 'the improvement is permanent: +3/+3 x 2').toBe(6);
    expect(settled.board.find((c) => c.uid === 'w')!.attack, 'the combat grant was combat-only').toBe(CARD_INDEX['whelpling']!.attack);
    // ...and a Conductor in the next Shop prints the improved grant.
    expect(conductorText('n2_conductor', false, settled.conductorBuff ?? 0)).toContain('{{+9/+9}}');
  });
});

describe("Conductor's live text", () => {
  it('prints (base + run-wide improvement) x golden; the step is untouched unless Mastery', () => {
    expect(conductorText('n2_conductor', false, 0)).toBeNull();
    expect(conductorText('n2_conductor', false, 3)).toBe('**Shout:** give adjacent minions **{{+6/+6}}**. Improve all Conductors by **+3/+3** this game.');
    expect(conductorText('n2_conductor', true, 3), 'gilded doubles the applied grant').toContain('{{+12/+12}}');
    expect(conductorText('n2_conductor', false, 0, 2), 'Rune of Mastery doubles the printed step').toContain('{{+6/+6}}** this game');
  });
});
