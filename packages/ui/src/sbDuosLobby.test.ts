import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createLobbyRun, duosMemberView, reduce, type BoardCard, type BoardSnapshot, type PracticeConfig, type RunState } from '@game/sim';
import { foeSnapshotOf } from './sandboxEdit';
import { makeSbMateRun } from './sbDuos';

/**
 * THE SCENE BUILDER'S DUOS LOBBY (owner 2026-11-12, R-SB-DUOS-03): "scene builder duos mode needs to actually turn it
 * into a 'duos' lobby so i can test various combat interactions". End Turn on a sandbox Duos run is the real tag-team
 * fight: my board and the placeholder teammate's against my foe with THEIR foe as its reserve.
 */
const config: PracticeConfig = { opponents: 'bots', botDifficulty: 1, health: 'unlimited', timeMult: 1, tribes: [] };
const body = (uid: string, attack: number, health: number): BoardCard =>
  ({ uid, cardId: 'sandbag', tribe: CARD_INDEX['sandbag']?.tribe ?? 'neutral', attack, health, keywords: [], golden: false });
const myRun = (board: BoardCard[]): RunState => {
  const base = createLobbyRun(4242, 'warden', {}, 'practice', config, 'set3', undefined, { duos: true });
  return { ...base, sandbox: true, board };
};
/** Pin a run's foe for this wave (what the rig's Enemy editor does). */
const withFoe = (run: RunState, stats: [number, number][]): RunState => {
  const snap: BoardSnapshot = { ...foeSnapshotOf(run)!, minions: stats.map(([attack, health]) => ({ cardId: 'sandbag', attack, health, keywords: [] })) };
  return { ...run, servedBoards: { ...(run.servedBoards ?? {}), [run.wave]: snap }, sandboxFoeWave: run.wave };
};
const answerChoices = (run: RunState): RunState => {
  let r = run;
  for (let i = 0; i < 6 && r.discover; i++) r = reduce(r, { type: 'discoverPick', index: 0 } as never);
  return r;
};

function teamFight(opts: { mine: [number, number][]; mate: [number, number][]; foe: [number, number][]; foeMate: [number, number][]; first?: 'me' | 'mate' }) {
  const me = withFoe(myRun(opts.mine.map(([a, h], i) => body(`me${i}`, a, h))), opts.foe);
  const mateBase = answerChoices(makeSbMateRun(me, true));
  const mate = withFoe({ ...mateBase, board: opts.mate.map(([a, h], i) => body(`mt${i}`, a, h)) }, opts.foeMate);
  const ended = reduce(mate, { type: 'faceOmen', deferFight: true });
  const fought = reduce(me, { type: 'faceOmen', sandboxDuos: { mate: ended.pendingCombatSide!, foeMate: foeSnapshotOf(mate), first: opts.first } });
  return { me, mate: ended, fought };
}

describe('Scene Builder Duos: End Turn is the tag-team fight', () => {
  it('the placeholder teammate can end a turn into a prepared side', () => {
    const { mate } = teamFight({ mine: [[1, 1]], mate: [[4, 40]], foe: [[3, 3]], foeMate: [[2, 2]] });
    expect(mate.pendingCombatSide, 'if this fails the teammate hero opens a choice the test does not answer').toBeTruthy();
  });

  it('my board falls, the teammate board steps in, then the other team\'s second board steps in', () => {
    const { fought } = teamFight({ mine: [[1, 1]], mate: [[9, 60]], foe: [[3, 3]], foeMate: [[2, 2]] });
    expect(fought.phase).toBe('combat');
    const ev = fought.lastCombat!.events;
    const tags = ev.filter((e) => e.type === 'tagIn').map((e) => (e as { side: string }).side);
    expect(tags, 'both reserves stepped in').toEqual(expect.arrayContaining(['player', 'enemy']));
    expect(fought.lastCombat!.result).toBe('win');
    expect(fought.lastCombat!.duosMember, 'my own board fought first').toBe(0);
    expect(fought.lastCombat!.tagTeam, 'every member\'s carry-backs ride the result').toBeTruthy();
  });

  it('"Them first": the teammate board leads and mine is the reserve', () => {
    const { fought } = teamFight({ mine: [[9, 60]], mate: [[1, 1]], foe: [[3, 3]], foeMate: [], first: 'mate' });
    expect(fought.lastCombat!.duosMember).toBe(1);
    expect(fought.lastCombat!.events.some((e) => e.type === 'tagIn' && (e as { side: string }).side === 'player')).toBe(true);
    expect(fought.lastCombat!.result).toBe('win');
  });

  it('an empty first board hands straight over, as in a match', () => {
    const { fought } = teamFight({ mine: [], mate: [[9, 60]], foe: [[3, 3]], foeMate: [] });
    expect(fought.lastCombat!.duosMember, 'the teammate led: my board was empty').toBe(1);
    expect(fought.lastCombat!.result).toBe('win');
  });

  it('the same fight lands on the teammate run, which goes on to its next shop', () => {
    const { fought, mate } = teamFight({ mine: [[1, 1]], mate: [[9, 60]], foe: [[3, 3]], foeMate: [[2, 2]] });
    const theirs = duosMemberView(fought.lastCombat!, 1);
    const next = reduce(mate, { type: 'resolveCombat', fight: { result: theirs, damageTaken: 0 } });
    expect(next.phase).toBe('recruit');
    expect(next.wave).toBe(mate.wave + 1);
    expect(next.pendingCombatSide).toBeUndefined();
  });

  it('refused off the sandbox: a real Duos run ignores the rig payload and fights its own fight', () => {
    const { me, mate } = teamFight({ mine: [[1, 1]], mate: [[9, 60]], foe: [[3, 3]], foeMate: [[2, 2]] });
    const real = { ...me, sandbox: undefined } as RunState;
    const fought = reduce(real, { type: 'faceOmen', sandboxDuos: { mate: mate.pendingCombatSide!, foeMate: null } });
    expect(fought.lastCombat?.events.some((e) => e.type === 'tagIn') ?? false).toBe(false);
  });
});
