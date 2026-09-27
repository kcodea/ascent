/**
 * LORD OF THE RISEN × ANCIENT OF TIME — the live tally and the Start-of-Turn beat (owner report 2026-09-26: "this
 * hero power is tallying at resolution, not in real time … this also does not have a start of turn beat").
 *
 *   · R-ANCRISEN-07: the power text counts the fight's summons AS THEY REPLAY ("This combat: N summoned"), from the
 *     same step-tagged tally the quest panel reads, which agrees exactly with what the next Start of Turn pays.
 *   · R-SOT-BEAT-01: the Start-of-Turn grant is recorded on its OWN beat channel (`sotBeatFx`), not the per-action
 *     buff-FX channel that replayed under the return curtain; the UI half lives in packages/ui/src/sotBeats.test.ts.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { ANCIENT_IDS, createRun, enableAncients, heroPowerText, reduce, type BoardCard, type BoardSnapshot, type RunState } from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const pup = (uid: string, cardId: string, attack: number, health: number): BoardCard => card(uid, cardId, { attack, health, keywords: [] });
const timeRun = (board: BoardCard[]): RunState => {
  let s = enableAncients({ ...createRun(7, 'risen'), phase: 'recruit', embers: 60, hand: [], board } as RunState);
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['time', ...ANCIENT_IDS.filter((a) => a !== 'time').slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id: 'time' });
  expect(s.ancients!.picked).toBe('time');
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fight = (s: RunState, attack = 3, health = 400): RunState =>
  reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
/** A board whose fight summons several bodies (Mama Pup's Pups, plus the Undying Rise). */
const summoningBoard = (): RunState => {
  const s = timeRun([card('p', 'pack'), pup('b', 'shaper', 0, 500), pup('a', 'hm_test_squire', 2, 2)]);
  return reduce(s, { type: 'heroPower', uid: 'a' });
};
/** The replay's running count at step `step`: exactly how `useCombatReplay`'s `questDelta` folds the log. */
const summonsUpTo = (s: RunState, step: number): number =>
  (s.lastCombat!.playerQuestEvents ?? []).filter((e) => e.kind === 'summonCombat' && e.step <= step).length;

describe('R-ANCRISEN-07 — Time counts summons LIVE, as the fight replays', () => {
  it('the step-tagged tally ticks during the fight and ends on exactly the count the Start of Turn pays', () => {
    const s = fight(summoningBoard());
    const n = s.lastCombat!.playerSummonsMade!;
    expect(n).toBeGreaterThanOrEqual(3);
    const steps = (s.lastCombat!.playerQuestEvents ?? []).filter((e) => e.kind === 'summonCombat').map((e) => e.step);
    // Summons land on different beats: the count climbs 1, 2, 3 … through the replay, it does not appear at the end.
    expect(new Set(steps).size, 'summons land on more than one beat').toBeGreaterThan(1);
    const first = Math.min(...steps);
    expect(summonsUpTo(s, first - 1), 'nothing counted before the first summon').toBe(0);
    expect(summonsUpTo(s, first), 'the first summon is counted on its own beat').toBeGreaterThan(0);
    expect(summonsUpTo(s, first), 'and not the whole fight at once').toBeLessThan(n);
    expect(summonsUpTo(s, Infinity), 'the full replay agrees with the carry-back').toBe(n);
  });

  it('the power text prints the running count mid-fight ("This combat"), then the banked count after', () => {
    const s = fight(summoningBoard());
    const n = s.lastCombat!.playerSummonsMade!;
    for (let k = 0; k <= n; k++) {
      expect(heroPowerText(s, 0, { summons: k })).toContain(`This combat: **${k}** summoned (**+${3 * k}/+${2 * k}**)`);
    }
    // Outside a fight (no live tally): the last combat's count, which the next Start of Turn pays.
    const settled = reduce(s, { type: 'settleCombat' });
    expect(heroPowerText(settled)).toContain(`Last combat: **${n}** summoned (**+${3 * n}/+${2 * n}**)`);
    expect(heroPowerText(settled)).not.toContain('This combat');
  });
});

describe('R-SOT-BEAT-01 — Time\'s Start-of-Turn grant is its own beat', () => {
  it('records one hero beat with every minion\'s real gain, on the beat channel, not the under-curtain buff channel', () => {
    let s = fight(summoningBoard());
    const n = s.lastCombat!.playerSummonsMade!;
    const seq0 = s.sotBeatFxSeq ?? 0;
    const before = new Map(s.board.map((c) => [c.uid, { attack: c.attack, health: c.health }]));
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.phase).toBe('recruit');
    expect(s.sotBeatFxSeq).toBe(seq0 + 1);
    expect(s.sotBeatFx).toHaveLength(1);
    const beat = s.sotBeatFx![0]!;
    expect(beat.source).toEqual({ kind: 'hero', id: 'risen', label: 'Ancient of Time' });
    expect(beat.gains.map((g) => g.uid).sort()).toEqual(s.board.map((c) => c.uid).sort());
    for (const g of beat.gains) {
      const b = before.get(g.uid)!;
      expect([g.attack, g.health], `${g.uid} gained +3/+2 per summon`).toEqual([3 * n, 2 * n]);
      expect([at(s, g.uid).attack, at(s, g.uid).health]).toEqual([b.attack + 3 * n, b.health + 2 * n]);
    }
    // The old path captured it on `recruitBuffFx`, which the Shop replayed at once, under the return curtain.
    expect(s.recruitBuffFx.filter((e) => e.kind === 'spell' && !e.sourceUid)).toEqual([]);
  });

  it('pays exactly the PREVIOUS combat\'s count (owner: previous combat only), never a running total', () => {
    let s = fight(summoningBoard());
    const n1 = s.lastCombat!.playerSummonsMade!;
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.sotBeatFx![0]!.gains[0]!.attack).toBe(3 * n1);
    // Fight 2: no summoner left and no Undying, so nothing is summoned and the next Start of Turn pays nothing.
    s = { ...s, board: s.board.filter((c) => c.uid !== 'p') };
    const b = { ...at(s, 'b') };
    s = fight(s, 0, 400);
    expect(s.lastCombat!.playerSummonsMade).toBe(0);
    s = reduce(s, { type: 'resolveCombat' });
    expect([at(s, 'b').attack, at(s, 'b').health], 'no payout from the older fight').toEqual([b.attack, b.health]);
    expect(s.sotBeatFx ?? [], 'no beat when nothing is paid').toEqual([]);
    expect(heroPowerText(s)).toContain('Last combat: **0** summoned (**+0/+0**)');
  });

  it('the beat channel is per action: the next Shop action clears it (the seq stays monotonic)', () => {
    let s = reduce(fight(summoningBoard()), { type: 'resolveCombat' });
    const seq = s.sotBeatFxSeq!;
    s = reduce(s, { type: 'roll' });
    expect(s.sotBeatFx ?? []).toEqual([]);
    expect(s.sotBeatFxSeq).toBe(seq);
  });
});
