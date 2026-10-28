import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatResult, type CombatSideState, type CombatConfig } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, deserialize, reduce, serialize, type Action, type BoardCard, type PreparedCombatSide, type RunState } from './index';
import { snapshotBoard, type BoardSnapshot } from './snapshot';
import { opponentBoard } from './opponents';
import { seatCombatSide, sideFromSnapshot } from './boardSide';
import { rankedDuosMemberSide } from './versus/rankedDuosFinalize';
import { resolveVersusFight } from './versus/combat';

/**
 * R-WHISPER-SNAPSHOT-01 (owner ask 2026-10-27: "make sure whispers are wired to work correctly with snapshots. i think
 * they are, but need to confirm they carry into combat snapshots etc").
 *
 * A board built with ACTIVE Whispers, through the real reducer: every Set 3 granter played from hand, every granted
 * Whisper cast (Tome, Runebind, Seed, Warding Call, Bait; Tamby copies one), Whaloo on board to cast Runebind in combat,
 * and the Dragon runes that read Whispers (Borrowed Flame, Spell Tempering, Runic Transposition, War Council, Final
 * Utterance, Runebound Brood). The turn then ends exactly as a real one does (`faceOmen`, deferred so the prepared side
 * is visible), and that ONE prepared side is the truth: the live fight simulates exactly it.
 *
 * Every path a recorded board travels must reproduce that fight byte for byte (same result, same damage, same event
 * log, same carry-backs that combat reads):
 *  - the lobby seat / boards-table snapshot (`snapshotBoard` -> JSON -> `seatCombatSide`)
 *  - a served opponent (`opponentBoard` + `sideFromSnapshot`, the faceOmen path, pinned in `servedBoards`)
 *  - Ranked Duos solo members (`rankedDuosMemberSide`, form 'snapshot') and duo members (form 'side', the prepared side)
 *  - Versus (`resolveVersusFight` over the JSON-transported prepared side)
 *  - save and continue (`serialize` / `deserialize` before End Turn)
 * Replay v2 and Live Games spectating carry the RESULT (the event log), never re-simulate, so they inherit the live fight.
 */

const SET3_POOL = poolFor('set3').all.map((c) => c.id);
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const bc = (uid: string, cardId: string): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false };
};
const json = <T>(v: T): T => JSON.parse(JSON.stringify(v)) as T;
const whisper = (s: RunState, id: string): BoardCard | undefined => s.hand.find((c) => c.cardId === id);
const uidOf = (s: RunState, cardId: string): string => s.board.find((c) => c.cardId === cardId)!.uid;

/** The Whisper board, mid-turn, every Whisper cast. */
function whisperRun(): RunState {
  const granters = ['d4_galas', 'd4_tolan', 'd3_gardener', 'd3_whispwarder', 'd3_baitbrood', 'd4_tamby', 'd3_whaloo'];
  let s = {
    ...createRun(7, undefined, 'ascent', undefined, 'set3'),
    phase: 'recruit', embers: 60, tier: 6, wave: 9, board: [], shop: [],
    hand: granters.map((id, i) => bc(`h${i}`, id)),
    spellsCast: 11, // Tome's "every 4 spells" step is live
    questFlags: {
      runeBorrowedFlame: true, runeSpellTempering: true, runeRunicTransposition: true,
      runeWarCouncil: true, runeFinalUtterance: true, runeRuneboundBrood: true,
    },
    runeBorrowedFlame: 2, runeSpellTemperingTick: 1,
    // Pin a quiet opponent for the deferred faceOmen (the fight we compare is run by hand below).
    servedBoards: {},
  } as unknown as RunState;
  for (const c of [...s.hand]) s = act(s, { type: 'play', uid: c.uid, toIndex: s.board.length } as Action);
  expect(s.board.map((c) => c.cardId), 'every granter landed').toEqual(granters);
  // Cast every granted Whisper: Tome on Tamby (Tamby copies it; the copy goes on Whaloo), Runebind on Whaloo,
  // Seed on Gardener, Warding Call on Galas, Bait on Tolan.
  const castOn = (id: string, targetCard: string): void => {
    const w = whisper(s, id);
    expect(w, `${id} is in hand`).toBeDefined();
    s = act(s, { type: 'play', uid: w!.uid, targetUid: uidOf(s, targetCard) } as Action);
    expect(whisper(s, id)?.uid === w!.uid, `${id} was cast`).toBe(false);
  };
  castOn('w4_tome', 'd4_tamby');
  castOn('w4_tome', 'd3_whaloo'); // Tamby's copy
  castOn('w4_runebind', 'd3_whaloo');
  castOn('w3_seed', 'd3_gardener');
  castOn('w3_wardingcall', 'd4_galas');
  castOn('w3_bait', 'd4_tolan');
  return s;
}

/** The deferred End Turn: the exact side the live fight simulates, and the run it leaves (what the lobby captures). */
function endTurn(s: RunState): { run: RunState; prep: PreparedCombatSide } {
  const quiet: BoardSnapshot = { v: 1, wave: s.wave, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' };
  const run = act({ ...s, servedBoards: { [s.wave]: quiet } } as RunState, { type: 'faceOmen', deferFight: true } as Action);
  expect(run.pendingCombatSide, 'the deferred fight parked its prepared side').toBeDefined();
  return { run, prep: run.pendingCombatSide! };
}

/** A real enemy that trades, so deaths happen (Seed's Echoes, Final Utterance's Avenge, Whaloo swinging thrice). */
const FOE: BoardMinion[] = [
  { cardId: 'd3_matriarch', attack: 14, health: 30, keywords: ['T'] },
  { cardId: 'd3_gravus', attack: 18, health: 12, keywords: ['T'] },
  { cardId: 'd3_iggy', attack: 16, health: 9, keywords: [] },
  { cardId: 'd3_woozy', attack: 12, health: 14, keywords: [] },
  { cardId: 'd3_hum', attack: 10, health: 20, keywords: ['DS'] },
] as unknown as BoardMinion[];
const foeState = (): CombatSideState => combatSide({ tier: 6, poolIds: SET3_POOL });

/** One fight with the Whisper side as `player` (or `enemy`), always the same seed and foe. */
function fight(board: BoardMinion[], state: CombatSideState, config: CombatConfig = {}, as: 'player' | 'enemy' = 'player', seed = 4242): CombatResult {
  const [pb, ps, eb, es] = as === 'player'
    ? [structuredClone(board), structuredClone(state), structuredClone(FOE), foeState()]
    : [structuredClone(FOE), foeState(), structuredClone(board), structuredClone(state)];
  return simulate(pb, eb, makeRng(seed), CARD_INDEX, ps, es, config);
}

/** What must match: the outcome, the damage, every event, and the Whisper carry-backs combat produced. */
const essence = (r: CombatResult, as: 'player' | 'enemy' = 'player') => ({
  result: r.result,
  playerDamage: r.playerDamage,
  events: r.events,
  carry: as === 'player' ? r.playerShoutCarry : r.enemyCarry?.shoutCarry,
});

describe('R-WHISPER-SNAPSHOT-01: a board with active Whispers fights identically on every recorded path', () => {
  const live = whisperRun();
  const { run, prep } = endTurn(live);
  const snap = json(snapshotBoard(run)); // the boards / lobby_fights rows are JSON
  const truth = fight(prep.board, prep.state, prep.config);

  it('the staged board really carries live Whisper state into the fight', () => {
    // Whisper stats ride IN attack/health (temporary rows on the run card), keywords ride IN keywords, Seed stacks ride
    // as seedEchoes, the run's Runebind improvement and the Dragon runes ride the side.
    const withRows = run.board.filter((c) => (c.whisperBuffs ?? []).length > 0).map((c) => c.cardId);
    expect(withRows).toEqual(expect.arrayContaining(['d4_tamby', 'd3_whaloo']));
    expect(run.board.find((c) => c.cardId === 'd3_gardener')!.seedEchoesTemp).toBeGreaterThan(0);
    expect(run.board.find((c) => c.cardId === 'd4_galas')!.whisperKeywords?.length).toBeGreaterThan(0);
    expect(run.board.find((c) => c.cardId === 'd4_tolan')!.whisperKeywords?.length).toBeGreaterThan(0);
    expect(prep.state.whisperImprove?.['w4_runebind']).toBeGreaterThan(0);
    expect(prep.state.questMods.runeBorrowedFlame).toBeGreaterThan(1);
    expect(prep.state.questMods.runeSpellTemperingTick).toBeGreaterThan(0);
    expect(prep.board.find((m) => m.cardId === 'd3_gardener')!.seedEchoes).toBeGreaterThan(0);
    // ...and the fight actually exercises them: combat Runebind casts (Whaloo / War Council) and Drake Pups from Seed.
    expect(truth.events.some((e) => e.type === 'sc' && e.spellId === 'w4_runebind')).toBe(true);
    expect(truth.events.some((e) => e.type === 'summon' && e.side === 'player' && e.minion.cardId === 'd3_drakepup')).toBe(true);
    expect(truth.playerShoutCarry?.whisperImprove?.['w4_runebind']).toBeGreaterThan(prep.state.whisperImprove!['w4_runebind']!);
  });

  it('the snapshot captures every Whisper carrier (board stats, keywords, Seed stacks, Runebind improvement, Dragon runes)', () => {
    expect(snap.minions.map((m) => [m.cardId, m.attack, m.health, [...(m.keywords ?? [])].sort(), m.seedEchoes ?? 0]))
      .toEqual(prep.board.map((m) => [m.cardId, m.attack, m.health, [...(m.keywords ?? [])].sort(), m.seedEchoes ?? 0]));
    expect(snap.whisperImprove).toEqual(prep.state.whisperImprove);
    for (const k of ['runeBorrowedFlame', 'runeSpellTempering', 'runeSpellTemperingTick', 'runeRunicTransposition', 'runeWarCouncil', 'runeFinalUtterance', 'runeRuneboundBrood'] as const) {
      expect(snap.questMods?.[k], k).toEqual(prep.state.questMods[k]);
    }
  });

  it('lobby seat (boards table JSON -> seatCombatSide) fights exactly the live fight', () => {
    const seat = seatCombatSide({ minions: snap.minions, tier: snap.tier, snapshot: snap }, snap.wave, SET3_POOL);
    expect(essence(fight(seat.minions, seat.state))).toEqual(essence(truth));
  });

  it('served opponent (opponentBoard + sideFromSnapshot, pinned in servedBoards) fights exactly the live fight, on either side', () => {
    const board = opponentBoard(snap);
    const state = sideFromSnapshot(snap, snap.tier, SET3_POOL, snap.wave);
    expect(essence(fight(board, state))).toEqual(essence(truth));
    // As the ENEMY side (how a player actually meets it), against the same board fighting live from that side.
    const liveAsEnemy = fight(prep.board, prep.state, {}, 'enemy');
    expect(essence(fight(board, state, {}, 'enemy'), 'enemy')).toEqual(essence(liveAsEnemy, 'enemy'));
    // Pinned: a restored run re-serves the same object from `servedBoards`, through JSON.
    const pinned = json({ servedBoards: { [snap.wave]: snap } }).servedBoards[snap.wave]!;
    expect(essence(fight(opponentBoard(pinned), sideFromSnapshot(pinned, pinned.tier, SET3_POOL, pinned.wave)))).toEqual(essence(truth));
  });

  it('Ranked Duos: a solo snapshot member and a duo prepared-side member both fight exactly the live fight', () => {
    const solo = rankedDuosMemberSide({ member: 0, kind: 'solo', form: 'snapshot', board: snap }, snap.wave) as PreparedCombatSide;
    expect(essence(fight(solo.board, { ...solo.state, poolIds: SET3_POOL }))).toEqual(essence(truth));
    const duo = rankedDuosMemberSide({ member: 0, kind: 'duo', form: 'side', board: json(prep) }, snap.wave) as PreparedCombatSide;
    expect(essence(fight(duo.board, duo.state, duo.config))).toEqual(essence(truth));
  });

  it('Versus: the JSON-transported prepared side resolves to the same fight both seats see', () => {
    const foe: PreparedCombatSide = { board: FOE, state: foeState(), config: {} };
    const a = resolveVersusFight({ matchSeed: 99, round: 3, p1: json(prep), p2: json(foe) });
    const b = resolveVersusFight({ matchSeed: 99, round: 3, p1: prep, p2: foe });
    expect(essence(a.p1)).toEqual(essence(b.p1));
    expect(a.outcome).toBe(b.outcome);
  });

  it('save and continue: a run saved mid-turn with Whispers active ends its turn into the identical fight', () => {
    const restored = deserialize(serialize(live));
    const { prep: again } = endTurn(restored);
    expect(essence(fight(again.board, again.state, again.config))).toEqual(essence(truth));
  });
});
