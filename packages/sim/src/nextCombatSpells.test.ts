import { describe, it, expect } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  combatSide, makeRng, simulate, socTwilightExtraFires, stripNextCombatBanks,
  type BoardMinion, type CombatEvent, type CombatResult, type CombatSideState, type MinionSnapshot, type QuestCombatMods,
} from '@game/core';
import { createRun, mixSeed, TAG, type RunState } from './state';
import { reduce } from './reducer';
import { snapshotBoard, type BoardSnapshot } from './snapshot';
import { opponentBoard } from './opponents';
import { seatCombatSide, sideFromSnapshot, snapshotBanksLive } from './boardSide';
import { settleRunLobbyRound, type RunLobby, type LobbySeatState } from './lobby/runLobby';
import { DEFAULT_LOBBY_RULES } from './lobby/lobby';

/**
 * NEXT-COMBAT SPELLS, FOR BOTH SIDES (owner rulings 2026-10-07):
 *
 *   on the lost spells:        "these should carry over."
 *   on Rallying Offensive / Marked Target: "rallying offensive and marked target should work for opponents."
 *   on the shared snapshot:    "this is probably okay as long as they are spent on the turn the player played them"
 *   on bare seat-vs-seat sides: "is a significant issue that needs to be fixed."
 *   on the beat:               "we need to show these spells being cast in a start of combat beat."
 *
 * Each spell is CAST through the real reducer, the turn is ENDED (`faceOmen`), the board is SNAPSHOT exactly as the
 * store captures it, and the snapshot is SERVED as the enemy — so every assertion runs the shipped path end to end.
 */

const POOL = Object.keys(CARD_INDEX);

const spell = (uid: string, cardId: string): RunState['hand'][number] =>
  ({ uid, cardId, tribe: 'neutral', attack: 0, health: 1, keywords: [], golden: false } as RunState['hand'][number]);
const minion = (uid: string, cardId: string, attack: number, health: number): RunState['board'][number] =>
  ({ uid, cardId, tribe: CARD_INDEX[cardId]?.tribe ?? 'neutral', attack, health, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], golden: false } as RunState['board'][number]);

/** A tier-1 Echo body (any card with an `onDeath` effect) for Closed Casket to destroy. */
const ECHO_ID = Object.values(CARD_INDEX).find((c) => c && !c.spell && !c.token && c.tier === 1 && c.effects?.some((e) => e.on === 'onDeath'))!.id;

/** A Rally body (Supporter), a Shout body (Pennycat) and an Echo body — every spell below has something to act on. */
const BOARD = (): RunState['board'] => [minion('a', 'supporter', 4, 6), minion('b', 'alley', 3, 6), minion('c', ECHO_ID, 3, 3)];

interface SpellCase {
  id: string;
  /** Which board body a targeted cast aims at (default 0). */
  target?: number;
  /** A board of its own (default `BOARD()`). */
  board?: () => RunState['board'];
}
const CASES: SpellCase[] = [
  { id: 'fleetingvigor' }, { id: 'fieldmaneuvers' }, { id: 'laststand' }, { id: 'executionersedge' },
  { id: 'openthegates' }, { id: 'markedtarget' },
  // Cinderchef's Rally buffs itself, so a doubled Rally is countable on either side.
  { id: 'rallyoffensive', board: () => [minion('a', 'd2_cinderchef', 3, 8), minion('b', 'alley', 3, 6), minion('c', ECHO_ID, 3, 3)] }, { id: 'weaken' }, { id: 'decoysigil' },
  { id: 'summoningbulwark' }, { id: 'sp_solidground' }, { id: 'sp_containmentrune' }, { id: 'sp_stoleninitiative' },
  { id: 'bloodlust' }, { id: 'sp_partingcry', target: 1 }, { id: 'sp_closedcasket', target: 2 }, { id: 'preemptive' },
];

/** Cast `c.id` on a fresh run (Field Maneuvers' Choose One takes its first branch, Ward), then End the Turn. */
function castAndEndTurn(c: SpellCase, board: RunState['board'] = c.board?.() ?? BOARD()): { pre: RunState; next: RunState; snap: BoardSnapshot } {
  const setId = c.id.startsWith('sp_') || c.id === 'openthegates' ? 'set2' : 'set1';
  const s0 = { ...createRun(11), setId, phase: 'recruit', embers: 30, board, hand: [spell('sp', c.id)] } as RunState;
  const def = CARD_INDEX[c.id]!;
  const targetUid = def.target ? board[c.target ?? 0]!.uid : undefined;
  let s = reduce(s0, { type: 'play', uid: 'sp', ...(targetUid ? { targetUid } : {}) } as never);
  if (s.chooseOne) s = reduce(s, { type: 'chooseOne', index: 0 } as never);
  if (s.pendingTarget) s = reduce(s, { type: 'battlecryTarget', targetUid: board[c.target ?? 0]!.uid } as never);
  if (s.hand.some((h) => h.uid === 'sp')) throw new Error(`${c.id} did not cast`);
  const pre = s;
  const next = reduce(s, { type: 'faceOmen' } as never);
  if (!next.lastCombat) throw new Error('no combat');
  return { pre, next, snap: snapshotBoard(next) }; // the store captures right after faceOmen
}

/** The events that OPEN a fight: everything ahead of the first event the fight itself stamped with a step. */
const openingOf = (r: CombatResult): CombatEvent[] => {
  const end = r.events.findIndex((e) => e.step !== undefined);
  return r.events.slice(0, end === -1 ? r.events.length : end);
};
/** The fight's own events, minus the cast markers — what gameplay resolved. */
const fightOf = (r: CombatResult): CombatEvent[] => r.events.filter((e) => e.step !== undefined && e.type !== 'bankedCast');

/** Fold `initial` through the opening (buffs / keywords / summons) — the board each side fights from. */
function socBoards(r: CombatResult): Record<'player' | 'enemy', string[]> {
  const out = { player: r.initial.player.map((m) => ({ ...m, keywords: [...m.keywords] })), enemy: r.initial.enemy.map((m) => ({ ...m, keywords: [...m.keywords] })) };
  const find = (uid: string): MinionSnapshot | undefined => out.player.find((m) => m.uid === uid) ?? out.enemy.find((m) => m.uid === uid);
  for (const e of openingOf(r)) {
    if (e.type === 'buff') { const u = find(e.target); if (u) { u.attack += e.attack; u.health += e.health; } }
    if (e.type === 'keyword') { const u = find(e.target); if (u && !u.keywords.includes(e.keyword)) u.keywords.push(e.keyword); }
    if (e.type === 'summon') out[e.side].splice(e.index, 0, { ...e.minion, keywords: [...e.minion.keywords] });
  }
  const line = (m: MinionSnapshot): string => `${m.uid}:${m.cardId}:${m.attack}/${m.health}:${[...m.keywords].sort().join('')}`;
  return { player: out.player.map(line), enemy: out.enemy.map(line) };
}

/**
 * THE OLD PLAYER PATH, reproduced — the reducer code this change removed (the `preparePlayerCombatSide` pre-bake,
 * `resolveCombatVs`' Marked Target edit, `playerCombatConfig`'s `playerRallyDouble`, `enterCombat`'s Fleeting Vigor
 * rewind), applied to the same prepared inputs. Comparing its fight against the new one is the before/after proof
 * that the player's own fight resolves exactly as it did.
 */
function oldPlayerFight(run: RunState, input: NonNullable<CombatResult['oddsInput']>): CombatResult {
  const NEW_KEYS: (keyof QuestCombatMods)[] = ['rallyDouble', 'markFoeRightmostTaunt', 'fleetingVigor', 'bankedKeywords', 'bankedImps', 'attackFirstNext'];
  const player: BoardMinion[] = input.player.map((m) => ({ ...m, keywords: [...(m.keywords ?? [])] }));
  const enemy: BoardMinion[] = input.enemy.map((m) => ({ ...m, ...(m.keywords ? { keywords: [...m.keywords] } : {}) }));
  const twilightMult = 1 + socTwilightExtraFires({ runeTwilight: !!run.questFlags?.runeTwilight, flagCopies: run.flagCopies });
  const fleeting = run.fleetingVigor && (run.fleetingVigor.attack !== 0 || run.fleetingVigor.health !== 0) ? run.fleetingVigor : null;
  const covered = fleeting ? player.length : 0;
  if (fleeting) for (const m of player) { m.attack += fleeting.attack * twilightMult; m.health += fleeting.health * twilightMult; }
  for (const g of run.pendingCombatKeywords ?? []) {
    const m = player.find((p) => p.sourceUid === g.uid);
    if (!m) continue;
    if (!m.keywords!.includes(g.keyword)) m.keywords!.push(g.keyword);
    if (g.keyword === 'CR' && g.critChance !== undefined) m.critChance = g.critChance;
  }
  if (run.pendingSCImps) {
    const imp = CARD_INDEX['impscrap']!;
    const n = Math.min(run.pendingSCImps * twilightMult, Math.max(0, 7 - player.length));
    for (let k = 0; k < n; k++) player.push({ cardId: 'impscrap', attack: imp.attack + (run.impBuff?.attack ?? 0), health: imp.health + (run.impBuff?.health ?? 0), keywords: [...imp.keywords], golden: false });
  }
  if (run.markEnemyRightmostTaunt && enemy.length > 0) {
    const last = enemy[enemy.length - 1]!;
    if (!(last.keywords ?? []).includes('T')) last.keywords = [...(last.keywords ?? []), 'T'];
  }
  const questMods = { ...input.playerState.questMods };
  for (const k of NEW_KEYS) delete questMods[k];
  const r = simulate(player, enemy, makeRng(mixSeed(run.seed, run.wave, TAG.COMBAT)), CARD_INDEX,
    { ...input.playerState, questMods }, input.enemyState, { ...input.config, playerRallyDouble: run.rallyDoubleNext ?? false });
  if (fleeting) {
    const a = fleeting.attack * twilightMult;
    const h = fleeting.health * twilightMult;
    const buffed = r.initial.player.slice(0, covered);
    const opening: CombatEvent[] = [];
    if (buffed[0]) opening.push({ type: 'sc', source: buffed[0].uid, text: `Fleeting Vigor — your minions surge +${a}/+${h}` });
    for (const m of buffed) { m.attack -= a; m.health -= h; opening.push({ type: 'buff', target: m.uid, attack: a, health: h, source: m.uid }); }
    r.events.unshift(...opening);
  }
  return r;
}

/** A plain player board to serve each snapshot against. */
const ME = (): BoardMinion[] => Array.from({ length: 4 }, () => ({ cardId: 'stray', attack: 1, health: 20, keywords: [], golden: false }));

/** Serve `snap` as the ENEMY in `round` through the lobby's seat builder. */
function serveAsEnemy(snap: BoardSnapshot, round = snap.wave, me: BoardMinion[] = ME()): { r: CombatResult; side: CombatSideState; minions: BoardMinion[] } {
  const seat = seatCombatSide({ minions: opponentBoard(snap), tier: snap.tier, snapshot: snap }, round, POOL);
  const r = simulate(me, seat.minions, makeRng(5), CARD_INDEX, combatSide({ tier: 3, poolIds: POOL }), seat.state);
  return { r, side: seat.state, minions: seat.minions };
}

const casts = (r: CombatResult, side: 'player' | 'enemy'): string[] =>
  r.events.flatMap((e) => (e.type === 'bankedCast' && e.side === side ? [e.spellId] : []));

describe('next-combat spells — the PLAYER\'s own fight is unchanged (before/after, every spell)', () => {
  for (const c of CASES) {
    it(`${c.id}: same outcome, same fight, same Start-of-Combat board as the removed player path`, () => {
      const { next } = castAndEndTurn(c);
      const lc = next.lastCombat!;
      const input = lc.oddsInput!;
      // The reducer's fight IS `simulate` over these inputs (deterministic: same seed, same log).
      const again = simulate(input.player, input.enemy, makeRng(mixSeed(next.seed, next.wave, TAG.COMBAT)), CARD_INDEX, input.playerState, input.enemyState, input.config);
      expect(again.events).toEqual(lc.events);
      const old = oldPlayerFight(next, input);
      expect([again.result, again.playerDamage, again.enemyDamage]).toEqual([old.result, old.playerDamage, old.enemyDamage]);
      expect(fightOf(again)).toEqual(fightOf(old)); // every gameplay event, in order, identical
      expect(socBoards(again)).toEqual(socBoards(old)); // the board each side fought from, identical
      // …and the cast beat is new (the preemptive marker only when Pre-emptive Assault really applies).
      expect(casts(again, 'player')).toContain(c.id);
    });
  }
});

describe('next-combat spells CARRY OVER — cast, End Turn, snapshot, serve as the enemy', () => {
  type Check = (r: CombatResult, ctx: { side: CombatSideState; minions: BoardMinion[]; snap: BoardSnapshot }) => void;
  const enemyUid = (r: CombatResult): Set<string> => new Set(r.initial.enemy.map((m) => m.uid));
  const playerUid = (r: CombatResult): Set<string> => new Set(r.initial.player.map((m) => m.uid));
  const opening = openingOf;
  const checks: Record<string, Check> = {
    fleetingvigor: (r) => expect(opening(r).some((e) => e.type === 'buff' && enemyUid(r).has(e.target) && e.attack === 2)).toBe(true),
    fieldmaneuvers: (r) => expect(opening(r).some((e) => e.type === 'keyword' && enemyUid(r).has(e.target) && e.keyword === 'DS')).toBe(true),
    laststand: (r) => expect(opening(r).some((e) => e.type === 'keyword' && enemyUid(r).has(e.target) && e.keyword === 'R')).toBe(true),
    executionersedge: (r) => expect(opening(r).some((e) => e.type === 'keyword' && enemyUid(r).has(e.target) && e.keyword === 'CR')).toBe(true),
    openthegates: (r) => expect(opening(r).filter((e) => e.type === 'summon' && e.side === 'enemy' && e.minion.cardId === 'impscrap').length).toBe(3),
    markedtarget: (r) => {
      const last = r.initial.player[r.initial.player.length - 1]!.uid;
      expect(opening(r).some((e) => e.type === 'keyword' && e.target === last && e.keyword === 'T')).toBe(true);
    },
    rallyoffensive: (r, { snap }) => {
      // The served Supporter's Rally fires twice per swing: more Rally buffs than the same board without the bank.
      const plain = simulate(ME(), opponentBoard(snap), makeRng(5), CARD_INDEX, combatSide({ tier: 3, poolIds: POOL }),
        { ...sideFromSnapshot(snap, snap.tier, POOL, snap.wave), questMods: stripNextCombatBanks(snap.questMods ?? {}) });
      // Cinderchef's Rally buffs itself: count the buffs landing on ENEMY bodies.
      const buffs = (x: CombatResult): number => x.events.filter((e) => e.type === 'buff' && enemyUid(x).has(e.target)).length;
      expect(buffs(plain)).toBeGreaterThan(0);
      expect(buffs(r)).toBeGreaterThan(buffs(plain)); // (not exactly 2x: a bigger body changes how the fight goes)
    },
    weaken: (r) => expect(r.events.some((e) => e.type === 'sc' && playerUid(r).has(e.source) && /Weakened to 1 Health/.test(e.text))).toBe(true),
    decoysigil: (r) => expect(r.events.some((e) => e.type === 'summon' && e.side === 'enemy' && e.minion.cardId === 'trainingdummy')).toBe(true),
    summoningbulwark: (_r, { side }) => expect(side.questMods.summonTaunts).toBe(2),
    sp_solidground: (_r, { side }) => expect(side.questMods.solidGroundLeft).toBe(3),
    sp_containmentrune: (_r, { side }) => expect(side.questMods.containFirstEnemySummon).toBe(true),
    sp_stoleninitiative: (_r, { side }) => expect(side.questMods.stolenInitiative).toBe(true),
    bloodlust: (_r, { minions }) => expect(minions.some((m) => m.bloodlust)).toBe(true),
    sp_partingcry: (_r, { minions }) => expect(minions.some((m) => m.partingCry)).toBe(true),
    sp_closedcasket: (_r, { minions }) => expect(minions.some((m) => m.closedCasket)).toBe(true),
  };
  for (const c of CASES) {
    if (c.id === 'preemptive') continue; // captured, NOT applied for an opponent — see the next describe
    it(`${c.id}: applies on the ENEMY side, with its Start of Combat cast beat`, () => {
      const { snap } = castAndEndTurn(c);
      const { r, side, minions } = serveAsEnemy(snap);
      expect(casts(r, 'enemy')).toContain(c.id);
      checks[c.id]!(r, { side, minions, snap });
    });
  }

  it('Pre-emptive Assault is CAPTURED but inert for an opponent (pending an owner ruling on both sides holding it)', () => {
    const { snap } = castAndEndTurn({ id: 'preemptive' });
    expect(snap.questMods?.attackFirstNext).toBe(true);
    const { r } = serveAsEnemy(snap);
    expect(casts(r, 'enemy')).not.toContain('preemptive');
    const plain = simulate(ME(), opponentBoard(snap), makeRng(5), CARD_INDEX, combatSide({ tier: 3, poolIds: POOL }),
      { ...sideFromSnapshot(snap, snap.tier, POOL, snap.wave), questMods: stripNextCombatBanks(snap.questMods ?? {}) });
    expect(fightOf(r)).toEqual(fightOf(plain));
  });

  it('Marked Target is a real Start of Combat step for EITHER side: the holder\'s FOE\'s right-most gains Taunt', () => {
    const me: BoardMinion[] = [{ cardId: 'stray', attack: 1, health: 5 }, { cardId: 'stray', attack: 1, health: 5 }];
    const foe: BoardMinion[] = [{ cardId: 'stray', attack: 1, health: 5 }, { cardId: 'stray', attack: 1, health: 5 }];
    const armed = combatSide({ tier: 2, questMods: { markFoeRightmostTaunt: true } });
    const asEnemy = simulate(me, foe, makeRng(1), CARD_INDEX, combatSide({ tier: 2 }), armed);
    const asPlayer = simulate(me, foe, makeRng(1), CARD_INDEX, armed, combatSide({ tier: 2 }));
    expect(socBoards(asEnemy).player[1]).toMatch(/:T$/); // the PLAYER's right-most, marked by the enemy
    expect(socBoards(asPlayer).enemy[1]).toMatch(/:T$/); // the ENEMY's right-most, marked by the player
    expect(asEnemy.initial.player[1]!.keywords).not.toContain('T'); // …landing as a beat, not pre-baked
  });
});

describe('banks spend on their OWN round only (owner: "spent on the turn the player played them")', () => {
  it('a board re-served past its own wave (a stale final board, a ghost) repeats none of its banks or marks', () => {
    for (const id of ['weaken', 'fleetingvigor', 'markedtarget', 'rallyoffensive', 'bloodlust', 'sp_closedcasket', 'openthegates']) {
      const { snap } = castAndEndTurn(CASES.find((c) => c.id === id)!);
      expect(snapshotBanksLive(snap, snap.wave)).toBe(true);
      expect(snapshotBanksLive(snap, snap.wave + 3)).toBe(false);
      const { r, side, minions } = serveAsEnemy(snap, snap.wave + 3);
      expect(casts(r, 'enemy'), id).toEqual([]);
      expect(side.questMods.weakenTargets ?? side.questMods.fleetingVigor ?? side.questMods.markFoeRightmostTaunt ?? side.questMods.rallyDouble ?? side.questMods.bankedImps, id).toBeUndefined();
      expect(minions.some((m) => m.bloodlust || m.closedCasket || m.partingCry), id).toBe(false);
    }
  });

  it('a fight never spends the SHARED snapshot (Stolen Initiative, Containment, Solid Ground stay armed on it)', () => {
    for (const id of ['sp_stoleninitiative', 'sp_containmentrune', 'sp_solidground']) {
      const { snap } = castAndEndTurn(CASES.find((c) => c.id === id)!);
      const before = JSON.stringify(snap);
      // Serve it as the enemy against a board that summons (so Containment / Solid Ground have a summon to spend on).
      serveAsEnemy(snap, snap.wave, [{ cardId: 'alley', attack: 1, health: 1 }, { cardId: ECHO_ID, attack: 1, health: 1 }, ...ME()]);
      simulate(opponentBoard(snap), ME(), makeRng(5), CARD_INDEX, sideFromSnapshot(snap, snap.tier, POOL), combatSide({ tier: 3 }));
      expect(JSON.stringify(snap), id).toBe(before);
    }
  });

  it('the deferred odds probe sees the banks UN-SPENT, and re-running it reproduces the real fight', () => {
    for (const id of ['sp_solidground', 'sp_stoleninitiative', 'sp_containmentrune', 'fleetingvigor', 'openthegates']) {
      const { next } = castAndEndTurn(CASES.find((c) => c.id === id)!);
      const input = next.lastCombat!.oddsInput!;
      const mods = input.playerState.questMods;
      if (id === 'sp_solidground') expect(mods.solidGroundLeft).toBe(3);
      if (id === 'sp_stoleninitiative') expect(mods.stolenInitiative).toBe(true);
      if (id === 'sp_containmentrune') expect(mods.containFirstEnemySummon).toBe(true);
      if (id === 'fleetingvigor') expect(mods.fleetingVigor).toBeTruthy();
      if (id === 'openthegates') expect(mods.bankedImps).toBe(3);
      const rerun = simulate(input.player, input.enemy, makeRng(mixSeed(next.seed, next.wave, TAG.COMBAT)), CARD_INDEX, input.playerState, input.enemyState, input.config);
      expect(rerun.events, id).toEqual(next.lastCombat!.events);
    }
  });

  it('the run keeps the banks armed through the fight and spends them at settle', () => {
    const { next } = castAndEndTurn({ id: 'openthegates' });
    expect(next.pendingSCImps).toBe(3);
    const settled = reduce(next, { type: 'settleCombat' } as never);
    expect(settled.pendingSCImps ?? 0).toBe(0);
    expect(snapshotBoard(settled).questMods?.bankedImps).toBeUndefined();
  });
});

describe('seat-vs-seat fights use FULL sides (owner: "is a significant issue that needs to be fixed")', () => {
  const authored = (id: string, seed: number, runes: string[] = []): LobbySeatState => ({
    id, label: id, heroId: 'aster', kind: 'authored', seed, resolve: 30, armor: 0, alive: true,
    authoredBoards: [[{ attack: 1, health: 1 }], [{ attack: 1, health: 1 }]],
    ...(runes.length ? { authoredRunes: runes.map((runeId) => ({ fromRound: 1, runeId })) } : {}),
  });
  const lobbyOf = (a: LobbySeatState, b: LobbySeatState): RunLobby => ({
    version: 1, seed: 99, round: 1, encounters: [], finished: false, rules: { ...DEFAULT_LOBBY_RULES },
    // The player's seat is OUT (and never fell in a round, so it raises no ghost): s1 vs s2 is the round's one fight.
    seats: [{ id: 's0', label: 'me', heroId: 'aster', kind: 'player', seed: 0, resolve: 0, armor: 0, alive: false }, a, b],
  });
  const dummy = { events: [], result: 'draw', playerDamage: 0, initial: { player: [], enemy: [] } } as unknown as CombatResult;

  it('an opponent\'s rune now acts in its fight against another opponent (it was a bare tier-only side)', () => {
    // Identical 1/1 boards draw — unless Rune of Warding's Start of Combat Ward reaches the fight.
    const warded = settleRunLobbyRound(lobbyOf(authored('s1', 70101, ['rune_warding']), authored('s2', 70102)), dummy);
    const e = warded.encounters.find((x) => x.fought && [x.a, x.b].includes('s1') && [x.a, x.b].includes('s2'))!;
    const s1Won = (e.a === 's1' && e.outcome === 'win') || (e.b === 's1' && e.outcome === 'lose');
    expect(s1Won).toBe(true);
    const plain = settleRunLobbyRound(lobbyOf(authored('s1', 70103), authored('s2', 70104)), dummy);
    expect(plain.encounters.find((x) => x.fought)!.outcome).toBe('draw');
  });

  it('is deterministic: the same table settles identically twice', () => {
    const a = settleRunLobbyRound(lobbyOf(authored('s1', 70105, ['rune_warding']), authored('s2', 70106)), dummy);
    const b = settleRunLobbyRound(lobbyOf(authored('s1', 70105, ['rune_warding']), authored('s2', 70106)), dummy);
    expect(JSON.stringify(a.encounters)).toBe(JSON.stringify(b.encounters));
    expect(a.seats.map((s) => [s.resolve, s.armor])).toEqual(b.seats.map((s) => [s.resolve, s.armor]));
  });

  it('a served snapshot\'s banked spells reach a seat fight on its own round (both seats are full sides)', () => {
    const { snap } = castAndEndTurn({ id: 'weaken' });
    const other = castAndEndTurn({ id: 'fleetingvigor' }).snap;
    const sa = seatCombatSide({ minions: opponentBoard(snap), tier: snap.tier, snapshot: snap }, snap.wave, POOL);
    const sb = seatCombatSide({ minions: opponentBoard(other), tier: other.tier, snapshot: other }, other.wave, POOL);
    const r = simulate(sa.minions, sb.minions, makeRng(3), CARD_INDEX, sa.state, sb.state);
    expect(casts(r, 'player')).toContain('weaken');
    expect(casts(r, 'enemy')).toContain('fleetingvigor');
  });
});

describe('determinism', () => {
  it('the same cast + End Turn reproduces the identical fight, opening included', () => {
    for (const c of CASES) {
      const a = castAndEndTurn(c).next.lastCombat!;
      const b = castAndEndTurn(c).next.lastCombat!;
      expect(JSON.stringify({ e: a.events, i: a.initial, r: a.result }), c.id).toBe(JSON.stringify({ e: b.events, i: b.initial, r: b.result }));
    }
  });
});
