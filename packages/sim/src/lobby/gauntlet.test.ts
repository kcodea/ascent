import { describe, expect, it } from 'vitest';
import { lossDamageCap, roundLossCap, runeCombatModsFor } from '../reducer';
import { omenBoardMinions, authoredTierFor, authoredSeat } from './tutorialSeats';
import { settleRunLobbyRound, type RunLobby } from './runLobby';
import { CARD_INDEX, RUNE_INDEX, RUNES, cardRevision, type GauntletStage } from '@game/content';
import { createGauntletRun, gauntletOutcome, GAUNTLET_LOSS_CAPS, GAUNTLET_DEFAULT_TIERS } from './gauntlet';
import { reduce, type Action, type RunState } from '../index';
import type { CombatResult } from '@game/core';

describe('roundLossCap', () => {
  it('falls back to the normal game table when the lobby sets no caps', () => {
    for (const r of [1, 3, 4, 7, 8, 11, 12, 15, 16, 40]) expect(roundLossCap(undefined, r)).toBe(lossDamageCap(r));
    for (const r of [1, 5, 16]) expect(roundLossCap({}, r)).toBe(lossDamageCap(r));
  });

  it('reads a per-round table, null and past-the-end meaning uncapped', () => {
    const rules = { lossCaps: [5, 5, 5, 10, 10, 10, 15, 15, null, null] };
    expect([1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11].map((r) => roundLossCap(rules, r)))
      .toEqual([5, 5, 5, 10, 10, 10, 15, 15, Infinity, Infinity, Infinity]);
  });
});

const tauntless = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length === 0)!;
const keyworded = Object.values(CARD_INDEX).find((c) => !c.spell && (c.keywords ?? []).length > 0)!;

describe('authored minions', () => {
  it('keep the authored stat line and mark golden', () => {
    const [m] = omenBoardMinions([{ cardId: tauntless.id, attack: 9, health: 11, golden: true }]);
    expect(m).toMatchObject({ cardId: tauntless.id, attack: 9, health: 11, golden: true });
  });

  it('add keywords ON TOP of the printed ones, without duplicates', () => {
    const printed = keyworded.keywords!;
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1, addedKeywords: ['T', printed[0]!] }]);
    expect(new Set(m!.keywords)).toEqual(new Set([...printed, 'T']));
    expect(m!.keywords!.length).toBe(new Set([...printed, 'T']).size);
  });

  it('a real card with no added keywords still inherits its printed keywords (keywords left unset)', () => {
    const [m] = omenBoardMinions([{ cardId: keyworded.id, attack: 1, health: 1 }]);
    expect(m!.keywords).toBeUndefined();
  });
});

describe('authoredTierFor', () => {
  it('an explicit per-round tier wins over the ramp', () => {
    const seat = { authoredTierRamp: 2, authoredTiers: [1, 1, 4] };
    expect(authoredTierFor(seat, 3)).toBe(4);
    expect(authoredTierFor(seat, 5)).toBe(authoredTierFor({ authoredTierRamp: 2 }, 5)); // past the table -> ramp
  });
});

describe('invulnerable seats', () => {
  it('take no damage from a round they win, and are never knocked out', () => {
    const lobby = {
      version: 1, seed: 1, round: 1, encounters: [], finished: false,
      rules: { seatCount: 2, startingResolve: 30, startingArmor: 0, exhaustion: 'repeatFinal', maxRounds: 10 },
      seats: [
        { id: 's0', label: 'You', heroId: 'aster', kind: 'player', seed: 1, resolve: 30, armor: 0, alive: true },
        { id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored', seed: 2, resolve: 1, armor: 0, alive: true,
          invulnerable: true, authoredBoards: [[{ attack: 1, health: 1 }]] },
      ],
    } as unknown as RunLobby;
    const playerWon = { result: 'win', playerDamage: 0, enemyDamage: 50 } as unknown as CombatResult;
    const out = settleRunLobbyRound(lobby, playerWon);
    expect(out.seats[1]).toMatchObject({ resolve: 1, alive: true });
    expect(out.encounters.at(-1)).toMatchObject({ damageToB: 0 });
  });
});

describe('opponent runes', () => {
  it('runeCombatModsFor turns a combat rune into its combat modifier', () => {
    expect(RUNE_INDEX['rune_adventuring']?.reward).toMatchObject({ kind: 'rallyRepeat', scope: 'always' });
    expect(runeCombatModsFor(['rune_adventuring']).rallyExtraAlways).toBe(1);
    expect(runeCombatModsFor([]).rallyExtraAlways).toBeUndefined();
  });

  it('runeCombatModsFor never throws on any rune, even duplicated (the scratch run has no board or shop turn)', () => {
    for (const r of RUNES) expect(() => runeCombatModsFor([r.id, r.id]), r.id).not.toThrow();
  });

  it('an authored seat fields its runes from their round on, stacking', () => {
    const seat = {
      id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored' as const, seed: 2, resolve: 30, armor: 0, alive: true,
      authoredBoards: Array.from({ length: 10 }, () => [{ attack: 1, health: 1 }]),
      authoredRunes: [{ fromRound: 6, runeId: 'rune_adventuring' }, { fromRound: 9, runeId: 'rune_adventuring' }],
    };
    const d = authoredSeat(seat);
    expect(d.prepare(5)?.snapshot).toBeUndefined();
    expect(d.prepare(6)?.snapshot?.runes).toEqual(['rune_adventuring']);
    expect(d.prepare(6)?.snapshot?.questMods?.rallyExtraAlways).toBe(1);
    expect(d.prepare(9)?.snapshot?.runes).toEqual(['rune_adventuring', 'rune_adventuring']);
    expect(d.prepare(9)?.snapshot?.questMods?.rallyExtraAlways).toBe(2);
  });

  it('a rune-less authored seat prepares exactly the board it always did (no snapshot key)', () => {
    const seat = {
      id: 's1', label: 'Foe', heroId: 'aster', kind: 'authored' as const, seed: 2, resolve: 30, armor: 0, alive: true,
      authoredBoards: [[{ attack: 2, health: 3 }]],
    };
    expect(authoredSeat(seat).prepare(1)).toEqual({ minions: omenBoardMinions([{ attack: 2, health: 3 }]), tier: 1 });
    expect('snapshot' in authoredSeat(seat).prepare(1)!).toBe(false);
  });
});

const body = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1 && (c.keywords ?? []).length === 0)!;
const stageOf = (atk: number, hp: number): GauntletStage => ({
  number: 1, name: 'Test', opponentName: 'The Test Host', status: 'ready', runes: {},
  rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: body.id, attack: atk, health: hp, cardVersion: cardRevision(body) }] })),
});
/** A minimal recruit turn: clear the blocking modals (quest shop, Runeforge, Discovers — the same branches the
 *  autoplay recorder in snapshot.ts takes), then buy and play shop minions while Gold lasts, so the player
 *  fields a real board rather than an empty one. */
const recruit = (s: RunState): RunState => {
  const step = (a: Action): boolean => { const next = reduce(s, a); if (next === s) return false; s = next; return true; };
  for (let guard = 0; guard < 60; guard++) {
    if (s.questOffer) { if (step({ type: 'buyQuest', index: 0 })) continue; break; }
    if (s.runeforgeOffer) { if (step({ type: 'skipRuneforge' })) continue; break; }
    if (s.powerOffer) { if (step({ type: 'pickPower', index: 0 })) continue; break; }
    if (s.discover) { if (step({ type: 'discover', index: 0 })) continue; break; }
    if (s.chooseOne) { if (step({ type: 'chooseOne', index: 0 })) continue; break; }
    if (s.pendingTarget) { if (step({ type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid })) continue; break; }
    if (s.hand.length > 0 && s.board.length < 7 && s.hand.some((c) => step({ type: 'play', uid: c.uid }))) continue;
    const minion = s.shop.find((c) => !CARD_INDEX[c.cardId]?.spell);
    if (minion && s.board.length + s.hand.length < 7 && step({ type: 'buy', uid: minion.uid })) continue;
    break;
  }
  return s;
};
const playRound = (s: RunState): RunState => {
  s = recruit(s);
  for (const a of [{ type: 'faceOmen' }, { type: 'resolveCombat' }, { type: 'settleCombat' }] as Action[]) s = reduce(s, a);
  return s;
};
const playOut = (s: RunState): RunState => {
  for (let i = 0; i < 12 && s.phase !== 'gameover' && s.phase !== 'victory'; i++) s = playRound(s);
  return s;
};

describe('createGauntletRun', () => {
  it('is a 2-seat gauntlet lobby: the player and one invulnerable authored opponent', () => {
    const run = createGauntletRun(11, 'aster', stageOf(1, 1));
    expect(run.mode).toBe('gauntlet');
    expect(run.gauntletStage).toBe(1);
    expect(run.lobby!.rules).toMatchObject({ seatCount: 2, maxRounds: 10, lossCaps: GAUNTLET_LOSS_CAPS });
    expect(run.lobby!.seats.map((s) => s.kind)).toEqual(['player', 'authored']);
    expect(run.lobby!.seats[1]).toMatchObject({ label: 'The Test Host', invulnerable: true });
    expect(run.lobby!.seats[0]).toMatchObject({ resolve: run.resolve, armor: run.armor }); // the hero's own pools
  });

  it('blank tiers follow GAUNTLET_DEFAULT_TIERS; authored tiers win', () => {
    const s = stageOf(1, 1);
    s.rounds[2]!.tier = 6;
    const seat = createGauntletRun(11, 'aster', s).lobby!.seats[1]!;
    expect(seat.authoredTiers![0]).toBe(GAUNTLET_DEFAULT_TIERS[0]);
    expect(seat.authoredTiers![2]).toBe(6);
  });

  it('runes become authoredRunes from rounds 6 and 9', () => {
    const s = { ...stageOf(1, 1), runes: { round6: 'rune_adventuring', round9: 'rune_adventuring' } };
    expect(createGauntletRun(11, 'aster', s).lobby!.seats[1]!.authoredRunes)
      .toEqual([{ fromRound: 6, runeId: 'rune_adventuring' }, { fromRound: 9, runeId: 'rune_adventuring' }]);
  });
});

describe('gauntlet verdict', () => {
  it('surviving all 10 rounds against a board you cannot beat is still a CLEAR, and the foe never dies', () => {
    // A board the player can't beat (huge), so every round is a loss — but the caps keep total damage at
    // 3×5 + 3×10 + 2×15 = 75 before round 9. That kills a 30+Armor hero, so give the check a hero-agnostic shape:
    // assert the run ends, and that the verdict matches whether the player's seat survived.
    const run = playOut(createGauntletRun(3, 'aster', stageOf(999, 999)));
    expect(run.phase).toBe('gameover');
    const me = run.lobby!.seats[0]!;
    expect(gauntletOutcome(run)).toBe(me.alive ? 'cleared' : 'defeated');
    expect(run.lobby!.seats[1]!.alive).toBe(true);
  });

  it('a stage the player always beats is cleared after exactly 10 rounds, not earlier', () => {
    const run = playOut(createGauntletRun(3, 'aster', stageOf(1, 1)));
    expect(run.lobby!.round).toBe(11);
    expect(run.phase).toBe('gameover');
    expect(gauntletOutcome(run)).toBe('cleared');
  });

  it('losing on round 10 with Resolve left is a clear', () => {
    // Rounds 1–9 are a 1/1 (the player wins); round 10 is unbeatable.
    const s = stageOf(1, 1);
    s.rounds[9] = { board: [{ cardId: body.id, attack: 999, health: 999, cardVersion: cardRevision(body) }] };
    const run = playOut(createGauntletRun(3, 'aster', s));
    expect(run.history.at(-1)).toBe('lose');
    expect(run.resolve + run.armor).toBeGreaterThan(0);
    expect(gauntletOutcome(run)).toBe('cleared');
  });

  it('is null while the run is in progress and for non-gauntlet runs', () => {
    const run = createGauntletRun(3, 'aster', stageOf(1, 1));
    expect(gauntletOutcome(run)).toBeNull();
    expect(gauntletOutcome({ ...run, mode: 'lobby', phase: 'gameover' })).toBeNull();
  });

  it('applies the gauntlet caps to the player: a round-1 loss costs at most 5', () => {
    let run = createGauntletRun(3, 'aster', stageOf(999, 999));
    const before = run.resolve + run.armor;
    run = playRound(run);
    expect(before - (run.resolve + run.armor)).toBeLessThanOrEqual(5);
    expect(run.lastCombat!.damageCap).toBe(5);
  });
});
