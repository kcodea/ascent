/**
 * THE DUOS DEV TUNER'S FORCED FIGHTS, through the REAL Duos resolver (owner 2026-10-25: "force the next combat to a
 * tag-team hand-off"). Each scenario's boards go onto real Duos runs, End Turn prepares each side the way a lock does,
 * and `resolveVersusDuosRound` (what versus-resolve runs) must show exactly the mechanic the button names.
 */
import { describe, expect, it } from 'vitest';
import { createVersusRun, duosRandomFirst, normalizeVersusOptions, reduce, resolveVersusDuosRound, type PreparedCombatSide, type VersusGroupSeat } from '@game/sim';
import { DUOS_SCENARIO_LABEL, scenarioBoard, vanillaMinionId, withAddedCard, withForcedBoard, withGold, type DuosScenario } from './duosDevTuner';
import { fillHand } from './versusBotDriver';

const SEATS: VersusGroupSeat[] = ['p1', 'p2', 'p3', 'p4'];
const OPTS = normalizeVersusOptions({ v: 1, mode: 'duos', modifiers: [] });

/** A match seed whose round-1 order (the server's seeded 50/50, R-DUOS-ORDER-01) puts `lead` first for team a. */
const seedFor = (lead: VersusGroupSeat): number => { for (let k = 1; ; k++) if (duosRandomFirst(k, 1).a === lead) return k; };

function fight(kind: DuosScenario, lead: VersusGroupSeat = 'p1') {
  const matchSeed = seedFor(lead);
  const first = duosRandomFirst(matchSeed, 1);
  const sides: Partial<Record<VersusGroupSeat, PreparedCombatSide>> = {};
  SEATS.forEach((seat, i) => {
    const run = withForcedBoard(createVersusRun(100 + i, 'warden', 'set2', OPTS), scenarioBoard(kind, seat, 'p1', first));
    const ended = reduce(run, { type: 'faceOmen', deferFight: true });
    sides[seat] = ended.pendingCombatSide!;
  });
  return resolveVersusDuosRound({ matchSeed, round: 1, sides });
}
const tagIns = (r: ReturnType<typeof fight>) => r.aResult.events.filter((e) => e.type === 'tagIn').map((e) => (e as { side: string }).side);

describe('the Duos dev tuner (R-DUOS-DEVTUNER-01)', () => {
  it('forced boards are plain minions of the asked stats', () => {
    const run = createVersusRun(1, 'warden', 'set2', OPTS);
    const id = vanillaMinionId(run);
    const forced = withForcedBoard(run, [[1, 1], [4, 4]]);
    expect(forced.board.map((c) => [c.cardId, c.attack, c.health, c.keywords.length])).toEqual([[id, 1, 1, 0], [id, 4, 4, 0]]);
    expect(new Set(forced.board.map((c) => c.uid)).size).toBe(2);
    expect(forced.uidSeq).toBe(run.uidSeq + 2);
    expect(Object.keys(DUOS_SCENARIO_LABEL)).toEqual(['ourHandoff', 'theirHandoff', 'doubleWipe', 'allEmpty']);
  });

  it('"Our hand-off": my first board falls, my teammate steps in and wins (1 heart)', () => {
    const r = fight('ourHandoff');
    expect(tagIns(r)).toContain('player');
    expect(r.outcome).toBe('a');
    expect(r.heartsLost).toBe(1);
  });

  it('"Their hand-off": the foe\'s first board falls and their reserve flies in', () => {
    expect(tagIns(fight('theirHandoff'))).toContain('enemy');
  });

  it('follows the round\'s order: my teammate leading is the board that falls', () => {
    const r = fight('ourHandoff', 'p2');
    expect(r.first.a).toBe('p2');
    expect(tagIns(r)).toContain('player');
    expect(r.outcome).toBe('a');
  });

  it('"Both teams wiped": both reserves step in and fall: a draw, no hearts; all empty is a draw too', () => {
    const wipe = fight('doubleWipe');
    expect(tagIns(wipe).sort()).toEqual(['enemy', 'player']);
    expect([wipe.outcome, wipe.heartsLost]).toEqual(['draw', 0]);
    const empty = fight('allEmpty');
    expect([empty.outcome, empty.heartsLost]).toEqual(['draw', 0]);
  });

  it('the dev hand, board and Gold edits', () => {
    const run = createVersusRun(1, 'warden', 'set2', OPTS);
    expect(fillHand(run, 10).hand).toHaveLength(10);
    expect(withAddedCard(run, 'sandbag', 'board').board.at(-1)?.cardId).toBe('sandbag');
    expect(withGold(run, 0).embers).toBe(0);
    const full = { ...run, board: withForcedBoard(run, Array(7).fill([1, 1])).board };
    expect(withAddedCard(full, 'sandbag', 'board').board).toHaveLength(7);
  });
});
