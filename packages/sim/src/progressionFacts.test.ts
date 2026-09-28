import { describe, expect, it } from 'vitest';
import { matchXp } from '@game/progression';
import { createRun, DEFAULT_PRACTICE_CONFIG, type Action, type RunState } from './state';
import { reduce } from './reducer';
import { BOTS } from './bots';
import { beginDerive, emptyDeriveState, observeAction, progressionFactsOf, progressionPlacementOf, type CombatEventSummary, type DeriveState } from './runDerive';

/**
 * ACCOUNT PROGRESSION facts (2026-09-27) come off the run OBSERVER (`observeAction`), not scattered checks.
 * Two layers: fixtures that pin the exact fact document (the four-loss comeback, draws, a practice curtain), and
 * a real bot run proving the observer's combat record agrees with the reducer's own round history.
 */

const combat = (wave: number, result: CombatEventSummary['result']): CombatEventSummary => ({
  wave, result, damage: 0, attacks: 0, friendlyDeaths: 0, enemyDeaths: 0, summons: 0, spellCasts: 0, beats: 0,
  boardSize: 0, boardAttack: 0, boardHealth: 0, shopTier: 1, triggers: {},
});
function stateWith(results: string): DeriveState {
  const st = emptyDeriveState();
  [...results].forEach((c, i) => st.combats.push(combat(i + 1, c === 'W' ? 'win' : c === 'L' ? 'loss' : 'draw')));
  return st;
}
/** A finished lobby-shaped run: `placement` stamped on seat s0. */
function finished(mode: RunState['mode'], placement: number, over: Partial<RunState> = {}): RunState {
  const base = createRun(7, 'warden', mode);
  const seats = Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, alive: i === 0 ? placement === 1 : i < placement, placement: i === 0 ? placement : undefined }));
  return { ...base, phase: 'gameover', wave: 14, lobby: { ...(base.lobby ?? {}), seats } as unknown as RunState['lobby'], ...over };
}

describe('progressionFactsOf: fixtures', () => {
  it('the four-loss comeback: LLLLW earns it, and the record is counted from the observer', () => {
    const facts = progressionFactsOf(stateWith('WLLLLWWD'), finished('lobby', 3), { runId: 'run-a', mode: 'ranked', patch: 'p' });
    expect(facts).toEqual({
      version: 1, runId: 'run-a', mode: 'ranked', setId: facts.setId, patch: 'p', heroId: 'warden', placement: 3, waveReached: 14,
      terminal: true, comebackAfterFourLosses: true, combats: { wins: 3, losses: 4, draws: 1 },
    });
    expect(matchXp(facts).total).toBe(100 + 40 + 25);
  });

  it('a draw inside the streak neither adds nor clears; three losses then a win does not count', () => {
    expect(progressionFactsOf(stateWith('LLDLLW'), finished('lobby', 5), { runId: 'r', mode: 'ranked', patch: 'p' }).comebackAfterFourLosses).toBe(true);
    expect(progressionFactsOf(stateWith('LLLWLLL'), finished('lobby', 8), { runId: 'r', mode: 'ranked', patch: 'p' }).comebackAfterFourLosses).toBe(false);
  });

  it('practice on Unlimited Health has no meaningful placement; on normal Health it does', () => {
    const unlimited = finished('practice', 4, { practiceConfig: { ...DEFAULT_PRACTICE_CONFIG, health: 'unlimited' } });
    const normal = finished('practice', 4, { practiceConfig: { ...DEFAULT_PRACTICE_CONFIG, health: 'normal' } });
    expect(progressionPlacementOf(unlimited)).toBeNull();
    expect(progressionPlacementOf(normal)).toBe(4);
    const f = progressionFactsOf(stateWith('WWL'), unlimited, { runId: 'practice:9', mode: 'practice', patch: 'p' });
    expect(f.placement).toBeNull();
    expect(matchXp(f).total).toBe(60);
    expect(matchXp(progressionFactsOf(stateWith('WWL'), normal, { runId: 'practice:9', mode: 'practice', patch: 'p' })).total).toBe(84);
  });

  it('a sandbox or an unfinished run is not terminal (earns nothing)', () => {
    const sandbox = progressionFactsOf(stateWith('W'), finished('lobby', 1, { sandbox: true }), { runId: 'r', mode: 'ranked', patch: 'p' });
    expect(sandbox.terminal).toBe(false);
    expect(matchXp(sandbox).total).toBe(0);
    const midRun = progressionFactsOf(stateWith('W'), finished('lobby', 1, { phase: 'recruit' }), { runId: 'r', mode: 'ranked', patch: 'p' });
    expect(midRun.terminal).toBe(false);
  });

  it('an explicit placement (the one the ladder settled) wins over the derived one', () => {
    expect(progressionFactsOf(stateWith(''), finished('lobby', 6), { runId: 'r', mode: 'ranked', patch: 'p', placement: 2 }).placement).toBe(2);
  });
});

describe('progressionFactsOf: real play', () => {
  it('the observer records one result per fought round, in order, matching the reducer history', () => {
    let s = createRun(11, 'warden');
    let st = beginDerive(s);
    const bot = BOTS[0]!;
    for (let i = 0; i < 4000 && s.phase !== 'gameover' && s.phase !== 'victory'; i++) {
      const a: Action = bot.act(s);
      const next = reduce(s, a);
      st = observeAction(st, s, a, next);
      if (next === s && a.type === 'faceOmen') break;
      s = next;
    }
    const facts = progressionFactsOf(st, s, { runId: 'bot', mode: 'practice', patch: 'p' });
    const history = s.history.map((r) => (r === 'win' ? 'win' : r === 'lose' ? 'loss' : 'draw'));
    expect(st.combats.map((c) => c.result)).toEqual(history);
    expect(facts.combats.wins + facts.combats.losses + facts.combats.draws).toBe(history.length);
    expect(facts.terminal).toBe(true);
  });
});
