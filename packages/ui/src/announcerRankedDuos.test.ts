// @vitest-environment jsdom
/**
 * THE ANNOUNCER IN RANKED DUOS. A Ranked Duos game runs as `mode === 'versus'`, where the
 * table lines are muted. In Ranked Duos the lines that read a table of four TEAMS correctly speak again, raised by the
 * team detectors only; Versus 1v1 / Group / Versus Duos stay as silent as before. The team's result speaks outside the
 * queue (its run has left the screen). No new recordings: every file is one the solo game already plays.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setAnnouncerDepsForTests, ANNOUNCER_BACK_TO_SHOP_DELAY_MS, ANNOUNCER_END_DELAY_MS, ANNOUNCER_FACE_OMEN_DELAY_MS, ANNOUNCER_LINES,
  CATALOG_BATCH_1_EVENTS, CATALOG_BATCH_2_EVENTS, CATALOG_BATCH_3_EVENTS, CATALOG_BATCH_4_EVENTS, RANKED_DUOS_TABLE_EVENTS, VERSUS_SILENT_EVENTS,
  announceTeamRankUp, announceTeamResult, announcerDebug, cancelTeamResultLine, duosFoeTeamsAlive, resetAnnouncerForTests, setAnnouncerDuosTable,
  syncAnnouncer, teamResultEvent, type AnnouncerDeps, type AnnouncerEvent, type AnnouncerRunLike, type AnnouncerStateLike,
} from './announcer';
import { emptyAnnounced, withAnnounced, type AnnouncedSlice } from './announcerSlice';
import { resetAnnouncerTunerConfig, setAnnouncerTunerValue } from './announcerConfig';

const SEED = 777;
const LINE_MS = 1000;
class StubHandle { stopped: number | null = null; stop(ms: number): void { this.stopped = ms; } }
let plays: { file: string; handle: StubHandle }[] = [];
let announced: AnnouncedSlice = emptyAnnounced(SEED);
const mark = (event: AnnouncerEvent, wave: number, take?: string, reshuffle?: boolean): void => { announced = withAnnounced(announced, event, wave, take, reshuffle); };

/** A Duos table as the match shows it: me, my teammate, then the other teams' members in pairs. */
const table = (foeAlive: boolean[], foe = 's2'): NonNullable<AnnouncerRunLike['lobby']> => ({
  seats: [{ id: 's0', alive: true }, { id: 's1', alive: true }, ...foeAlive.map((alive, i) => ({ id: `s${i + 2}`, alive }))],
  forcedOpponent: { round: 5, seatId: foe },
});
const run = (patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike => ({
  seed: SEED, mode: 'versus', wave: 5, phase: 'recruit', resolve: 30, tier: 3, history: [], board: [], hand: [],
  combatSettled: false, lobby: table([true, true, true, true, true, true]), ...patch,
});
const st = (r: AnnouncerRunLike): AnnouncerStateLike => ({
  showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false, run: r, announced, combatOdds: null, markAnnounced: mark,
} as AnnouncerStateLike);
let cur: AnnouncerStateLike | null = null;
const go = (r: AnnouncerRunLike): AnnouncerRunLike => { const next = st(r); syncAnnouncer(next, cur); cur = next; return r; };
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
const events = (): string[] => plays.map((p) => (Object.entries(ANNOUNCER_LINES).find(([, takes]) => (takes as readonly string[]).includes(p.file))?.[0] ?? p.file));

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(500_000);
  plays = [];
  announced = emptyAnnounced(SEED);
  cur = null;
  resetAnnouncerForTests();
  resetAnnouncerTunerConfig();
  const deps: Partial<AnnouncerDeps> = {
    foe: () => null, random: () => 0, now: () => Date.now(),
    setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    play: (url, onEnded) => {
      const handle = new StubHandle();
      const file = url.split('/').pop()!.replace(/\.[a-z0-9]+$/, '');
      plays.push({ file, handle });
      setTimeout(() => { if (handle.stopped === null) onEnded(); }, LINE_MS);
      return Promise.resolve(handle);
    },
  };
  __setAnnouncerDepsForTests(deps);
  // Only the lines under test speak: the moment catalog is muted, the table lines are certain.
  for (const e of [...CATALOG_BATCH_1_EVENTS, ...CATALOG_BATCH_2_EVENTS, ...CATALOG_BATCH_3_EVENTS, ...CATALOG_BATCH_4_EVENTS]) setAnnouncerTunerValue(`${e}Chance`, 0);
  for (const e of [...RANKED_DUOS_TABLE_EVENTS, 'gameWon', 'gameLoss', 'secondPlace', 'rankUp'] as const) setAnnouncerTunerValue(`${e}Chance`, 100); // percent
  setAnnouncerTunerValue('backToShopChance', 0);
});
afterEach(() => { resetAnnouncerForTests(); resetAnnouncerTunerConfig(); vi.useRealTimers(); });

/** Back in the shop a round later, with the table as given. */
async function round(lobbyAfter: NonNullable<AnnouncerRunLike['lobby']>, wave: number, before: AnnouncerRunLike): Promise<AnnouncerRunLike> {
  const fighting = go({ ...before, phase: 'combat' });
  await tick(16_000);
  const settled = go({ ...fighting, combatSettled: true, history: [...before.history, 'win'], lastCombat: { result: 'win' } });
  await tick(2500);
  const back = go({ ...settled, phase: 'recruit', combatSettled: false, wave, lobby: lobbyAfter });
  await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS + 200);
  return back;
}

describe('the table read as teams', () => {
  it('counts the other teams still standing (a team stands while either seat does)', () => {
    expect(duosFoeTeamsAlive(run())).toBe(3);
    expect(duosFoeTeamsAlive(run({ lobby: table([false, false, true, true, true, true]) }))).toBe(2);
    expect(duosFoeTeamsAlive(run({ lobby: table([false, true, true, true, false, false]) }))).toBe(2);
    expect(duosFoeTeamsAlive(run({ lobby: { seats: [{ alive: true }, { alive: true }] } }))).toBeNull(); // a 1v1 table
  });
  it('the lines it re-enables are all lines Versus mutes, and none is new', () => {
    for (const e of RANKED_DUOS_TABLE_EVENTS) { expect(VERSUS_SILENT_EVENTS).toContain(e); expect(ANNOUNCER_LINES[e].length).toBeGreaterThan(0); }
    expect(RANKED_DUOS_TABLE_EVENTS).not.toContain('topFour');
    expect(RANKED_DUOS_TABLE_EVENTS).not.toContain('playersRemain');
  });
});

describe('in a Ranked Duos game', () => {
  beforeEach(() => setAnnouncerDuosTable(true));

  it('the first team going out speaks FirstOut after the return wipe', async () => {
    const shop = go(run());
    await tick(5000);
    await round(table([true, true, false, false, true, true], 's2'), 6, shop);
    expect(events()).toEqual(['firstOut']);
  });

  it('the team we just fought going out speaks Knockout; two teams left speaks TopTwo (the queue picks one a moment)', async () => {
    announced = withAnnounced(announced, 'firstOut', 3, ANNOUNCER_LINES.firstOut[0]);
    const shop = go(run({ lobby: table([true, true, false, false, true, true], 's2') }));
    await tick(5000);
    // we fought s2's team (s2 + s3) and it is out now: knockout AND top two are both true; one line speaks
    await round(table([false, false, false, false, true, true], 's6'), 6, shop);
    expect(events()).toHaveLength(1);
    expect(['knockout', 'topTwo']).toContain(events()[0]);
    const queued = announcerDebug().log.filter((l) => l.kind === 'queue').map((l) => l.event);
    expect(queued).toContain('knockout');
    expect(queued).toContain('topTwo');
    expect(queued).not.toContain('firstOut'); // already said this game
  });

  it('a team that goes out in a fight we were not in is not our knockout', async () => {
    const shop = go(run({ lobby: table([true, true, true, true, true, true], 's2') }));
    await tick(5000);
    await round(table([true, true, true, true, false, false], 's4'), 6, shop);
    const queued = announcerDebug().log.filter((l) => l.kind === 'queue').map((l) => l.event);
    expect(queued).toContain('firstOut');
    expect(queued).not.toContain('knockout');
  });

  it('a fight with one other team left opens with FinalShowdown', async () => {
    const shop = go(run({ lobby: table([false, false, false, false, true, true], 's6') }));
    await tick(5000);
    go({ ...shop, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS + 3500);
    expect(events()).toEqual(['finalShowdown']);
  });

  it('the seat-count lines stay silent: nothing fires for "top four" or "players remain"', async () => {
    const shop = go(run());
    await tick(5000);
    await round(table([true, true, false, false, true, true], 's2'), 6, shop);
    const queued = announcerDebug().log.filter((l) => l.kind === 'queue').map((l) => l.event);
    for (const e of ['topFour', 'playersRemain', 'lobbyLast', 'leaderboardTop'] as const) expect(queued).not.toContain(e);
  });
});

describe('outside Ranked Duos nothing changed', () => {
  it('a Versus Duos table (same shape, not ranked) stays silent', async () => {
    setAnnouncerDuosTable(false);
    const shop = go(run());
    await tick(5000);
    await round(table([true, true, false, false, true, true], 's2'), 6, shop);
    expect(events()).toEqual([]);
    go({ ...run({ lobby: table([false, false, false, false, true, true]) }), phase: 'combat' });
    await tick(8000);
    expect(events()).toEqual([]);
  });
});

describe('the team result line', () => {
  it('1st wins, exactly 2nd has its own line, 3rd and 4th lose', () => {
    expect([1, 2, 3, 4].map(teamResultEvent)).toEqual(['gameWon', 'secondPlace', 'gameLoss', 'gameLoss']);
  });

  it('speaks after the end delay with no run on screen, and RankUp follows a promotion', async () => {
    expect(announcerDebug().active).toBe(false);
    expect(announceTeamResult(1)).toBe('gameWon');
    await tick(ANNOUNCER_END_DELAY_MS - 50);
    expect(plays).toHaveLength(0);
    await tick(100);
    expect(events()).toEqual(['gameWon']);
    expect(announceTeamRankUp()).toBe(true); // the rating row landed while the win line talks
    await tick(LINE_MS + 50);
    expect(events()).toEqual(['gameWon', 'rankUp']);
  });

  it('RankUp with no end line waiting speaks at once', async () => {
    announceTeamRankUp();
    await tick(20);
    expect(events()).toEqual(['rankUp']);
  });

  it('Continue stops it (before it starts, or mid-line); a new game stops it too', async () => {
    announceTeamResult(4);
    cancelTeamResultLine();
    await tick(ANNOUNCER_END_DELAY_MS + 500);
    expect(plays).toHaveLength(0);
    announceTeamResult(2);
    await tick(ANNOUNCER_END_DELAY_MS + 100);
    expect(events()).toEqual(['secondPlace']);
    cancelTeamResultLine();
    expect(plays[0]!.handle.stopped).not.toBeNull();
    announceTeamResult(1);
    go(run({ seed: SEED + 1, mode: 'practice', wave: 2 })); // a new run lands on screen
    await tick(ANNOUNCER_END_DELAY_MS + 500);
    expect(events()).toEqual(['secondPlace']);
  });

  it('a line switched off in the tuner stays off', async () => {
    setAnnouncerTunerValue('gameLossChance', 0);
    expect(announceTeamResult(3)).toBeNull();
    await tick(ANNOUNCER_END_DELAY_MS + 500);
    expect(plays).toHaveLength(0);
  });

  it('cuts a run line still talking (the result is the last word)', async () => {
    setAnnouncerDuosTable(true);
    const shop = go(run({ lobby: table([false, false, false, false, true, true], 's6') }));
    await tick(5000);
    go({ ...shop, phase: 'combat' });
    for (let i = 0; i < 100 && plays.length === 0; i++) await tick(100); // until the line starts
    expect(events()).toEqual(['finalShowdown']);
    announceTeamResult(1);
    expect(plays[0]!.handle.stopped).not.toBeNull();
    await tick(ANNOUNCER_END_DELAY_MS + 100);
    expect(events()).toEqual(['finalShowdown', 'gameWon']);
  });
});
