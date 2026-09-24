// @vitest-environment jsdom
/**
 * THE ANNOUNCER — `announcer.ts` against the owner's contract (2026-09-23): *"they shouldn't trigger more than
 * once per game … and they shouldn't trigger back to back for things like equipment or triples etc."* and the
 * approved queue logic: once per event per run (persisted, seed-keyed variant), one global cooldown, a priority
 * queue with a shelf life (highest pending speaks, the rest are dropped), the silence rules (title / tutorial /
 * sandbox / replay, the first 3 s of a combat, the turn-1 music fade-in, a Skip cancels), and the per-game cap
 * of eight with GameWon / GameLoss on top.
 *
 * Driven with fake timers and a stub player through the module's injected seams; the store is hand-built
 * structural state (`AnnouncerStateLike`), so every detector is exercised on exactly the fields it reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  __setAnnouncerDepsForTests, ANNOUNCER_BACK_TO_SHOP_DELAY_MS, ANNOUNCER_BIG_STAT, ANNOUNCER_COMBAT_SILENCE_MS, ANNOUNCER_COOLDOWN_MS,
  ANNOUNCER_END_DELAY_MS, ANNOUNCER_EQUIPMENT_DELAY_MS, ANNOUNCER_FACE_OMEN_DELAY_MS, ANNOUNCER_GAME_START_DELAY_MS,
  ANNOUNCER_LINE_CAP, ANNOUNCER_LINES, ANNOUNCER_PRIORITY, ANNOUNCER_STOP_FADE_MS, ANNOUNCER_TURN_ONE_QUIET_MS,
  announcerDebug, announcerVariant, cancelAnnouncer, getAnnouncerVolume, isAnnouncerMuted, observeCombatBoard,
  previewAnnouncerEvent, setAnnouncerVolume, syncAnnouncer, toggleAnnouncerMute, type AnnouncerEvent, type AnnouncerRunLike,
  type AnnouncerStateLike,
} from './announcer';
import { announcedFor, emptyAnnounced, withAnnounced, type AnnouncedSlice } from './announcerSlice';
import {
  ANNOUNCER_TUNER_DEFAULTS, ANNOUNCER_TUNER_EVENTS, announcerLineGain, resetAnnouncerTunerConfig, setAnnouncerTunerValue,
} from './announcerConfig';

const SEED = 4242;
const LINE_MS = 1000;
/** A fight long enough that a Face Omen line's cooldown has passed by the verdict. */
const FIGHT_MS = 1000 + 12_000 + 2000;

class StubHandle {
  stopped: number | null = null;
  stop(ms: number): void { this.stopped = ms; }
}
interface Play { file: string; t: number; handle: StubHandle; gain: number }
let plays: Play[] = [];
let failNext = false;

let announced: AnnouncedSlice = emptyAnnounced(SEED);
const mark = (event: AnnouncerEvent, wave: number): void => { announced = withAnnounced(announced, event, wave); };

const seats = (alive: number, placement?: number) =>
  Array.from({ length: 8 }, (_, i) => ({ alive: i < alive, ...(i === 0 && placement ? { placement } : {}) }));

function run(patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike {
  return {
    seed: SEED, mode: 'practice', wave: 5, phase: 'recruit', resolve: 30, tier: 3, history: [], board: [], hand: [],
    combatSettled: false, lobby: { seats: seats(8) }, ...patch,
  };
}
function st(r: AnnouncerRunLike, patch: Partial<AnnouncerStateLike> = {}): AnnouncerStateLike {
  return {
    showTitle: false, heroChoices: null, practiceSetupOpen: false, replaying: false,
    run: r, announced, combatOdds: null, markAnnounced: mark, ...patch,
  };
}
let cur: AnnouncerStateLike | null = null;
/** Push a store update: the announcer sees (next, prev). */
function go(r: AnnouncerRunLike, patch: Partial<AnnouncerStateLike> = {}): AnnouncerRunLike {
  const next = st(r, patch);
  syncAnnouncer(next, cur);
  cur = next;
  return r;
}
const tick = async (ms: number): Promise<void> => { await vi.advanceTimersByTimeAsync(ms); };
const files = (): string[] => plays.map((p) => p.file);
const events = (): string[] => plays.map((p) => p.file.replace(/-\d$/, ''));
const dropped = (event: AnnouncerEvent): boolean => announcerDebug().log.some((l) => l.kind === 'drop' && l.event === event);
const expired = (event: AnnouncerEvent): boolean => announcerDebug().log.some((l) => l.kind === 'expire' && l.event === event);

/** A run on screen at wave 5's shop (past the turn-1 quiet window, no GameStart). */
function openShop(patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike {
  return go(run(patch));
}
/** Face Omen from `r`, then the verdict `settle` ms later; returns the settled run. */
async function fight(r: AnnouncerRunLike, outcome: 'win' | 'lose' | 'draw', opts: { settleAfter?: number; resolveAfter?: number; odds?: number } = {}): Promise<AnnouncerRunLike> {
  const fighting = go({ ...r, phase: 'combat' });
  await tick(opts.settleAfter ?? FIGHT_MS);
  const settled = go(
    { ...fighting, combatSettled: true, history: [...r.history, outcome], resolve: opts.resolveAfter ?? r.resolve, lastCombat: { result: outcome } },
    opts.odds !== undefined ? { combatOdds: { wave: r.wave, odds: { win: opts.odds, draw: 0, lose: 1 - opts.odds } } } : {},
  );
  return settled;
}
/** Back to the shop from a settled combat: wave +1. */
function backToShop(r: AnnouncerRunLike, patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike {
  return go({ ...r, phase: 'recruit', combatSettled: false, wave: r.wave + 1, ...patch });
}

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(100_000);
  plays = [];
  failNext = false;
  announced = emptyAnnounced(SEED);
  cur = null;
  __setAnnouncerDepsForTests({
    now: () => Date.now(),
    setTimeout: (cb, ms) => setTimeout(cb, ms) as unknown as number,
    clearTimeout: (id) => clearTimeout(id),
    play: (url, onEnded, gain) => {
      if (failNext) { failNext = false; return Promise.resolve(null); }
      const handle = new StubHandle();
      plays.push({ file: url.replace(/^.*\/announcer\//, '').replace(/\.mp3$/, ''), t: Date.now(), handle, gain });
      setTimeout(() => { if (handle.stopped === null) onEnded(); }, LINE_MS);
      return Promise.resolve(handle);
    },
  });
});
afterEach(() => {
  resetAnnouncerTunerConfig();
  __setAnnouncerDepsForTests(null);
  vi.useRealTimers();
});

describe('the gate', () => {
  const cases: [string, Partial<AnnouncerStateLike>, Partial<AnnouncerRunLike>][] = [
    ['the title', { showTitle: true }, {}],
    ['the hero picker', { heroChoices: ['a'] }, {}],
    ['Practice setup', { practiceSetupOpen: true }, {}],
    ['a replay', { replaying: true }, {}],
    ['the tutorial', {}, { mode: 'tutorial' }],
    ['a sandbox rig', {}, { sandbox: true }],
    ['the scored climb', {}, { mode: 'ascent' }],
  ];
  for (const [name, patch, rp] of cases) {
    it(`never speaks on ${name}`, async () => {
      go(run({ wave: 1, tier: 1, ...rp }), patch);
      await tick(ANNOUNCER_GAME_START_DELAY_MS + 5000);
      go(run({ wave: 1, tier: 6, ...rp }), patch);
      await tick(5000);
      expect(plays).toEqual([]);
      expect(announcerDebug().active).toBe(false);
    });
  }
  it('speaks in a lobby run and in Practice', async () => {
    go(run({ wave: 1, tier: 1, mode: 'lobby' }));
    await tick(ANNOUNCER_GAME_START_DELAY_MS);
    expect(events()).toEqual(['game-start']);
  });
});

describe('GameStart', () => {
  it('plays ANNOUNCER_GAME_START_DELAY_MS (4 s) after the first shop lands, after the music fade-in', async () => {
    go(run({ wave: 1, tier: 1 }));
    await tick(ANNOUNCER_GAME_START_DELAY_MS - 1);
    expect(plays).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['game-start']);
    expect(plays[0]!.t - 100_000).toBe(ANNOUNCER_GAME_START_DELAY_MS);
    expect(ANNOUNCER_GAME_START_DELAY_MS).toBeGreaterThan(ANNOUNCER_TURN_ONE_QUIET_MS);
    expect(announced.fired.gameStart).toEqual([1]);
    expect(announced.count).toBe(1);
  });
  it('the variant comes from the run seed: the same seed hears the same line, other seeds hear the other', () => {
    const a = announcerVariant(SEED, 'gameStart', 0, 2);
    expect(announcerVariant(SEED, 'gameStart', 0, 2)).toBe(a);
    const seen = new Set<number>();
    for (let s = 1; s < 40; s++) seen.add(announcerVariant(s, 'gameStart', 0, 2));
    expect(seen).toEqual(new Set([0, 1]));
    // A repeat occurrence of a two-line event is allowed to differ from its first (still deterministic).
    expect(announcerVariant(SEED, 'backToShop', 1, 3)).toBe(announcerVariant(SEED, 'backToShop', 1, 3));
  });
  it('a Continue never replays it: a restored slice that has it fired stays silent', async () => {
    announced = withAnnounced(announced, 'gameStart', 1);
    go(run({ wave: 1, tier: 1 }));
    await tick(ANNOUNCER_GAME_START_DELAY_MS + 1000);
    expect(plays).toEqual([]);
  });
  it('a slice from another seed is discarded (a new run starts fresh)', () => {
    const other = withAnnounced(emptyAnnounced(1), 'gameStart', 1);
    expect(announcedFor(other, SEED)).toEqual(emptyAnnounced(SEED));
    expect(announcedFor(JSON.parse(JSON.stringify(other)) as AnnouncedSlice, 1)).toEqual(other);
  });
  it('the turn-1 quiet window holds every line, not just GameStart', async () => {
    go(run({ wave: 1, tier: 1 }));
    go(run({ wave: 1, tier: 1, equipment: { available: [1] } }));
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + 10);
    expect(plays).toEqual([]);
    await tick(ANNOUNCER_TURN_ONE_QUIET_MS);
    expect(events()).toEqual(['equipment']); // outranks GameStart (still pending), which is then dropped by the cooldown
    await tick(ANNOUNCER_GAME_START_DELAY_MS);
    expect(events()).toEqual(['equipment']);
    expect(dropped('gameStart')).toBe(true);
  });
});

describe('the queue', () => {
  it('priority: several events pending at once, the highest speaks and the rest are dropped, not delayed', async () => {
    const r = openShop({ wave: 3, resolve: 8, history: ['lose', 'lose'] });
    go({ ...r, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(events()).toEqual(['start-combat-under-10hp']);
    expect(dropped('enteringCombatAfterLoss')).toBe(true);
    expect(dropped('enteringCombat')).toBe(true);
    await tick(60_000);
    expect(events()).toEqual(['start-combat-under-10hp']);
    expect(ANNOUNCER_PRIORITY.startCombatUnder10hp).toBeGreaterThan(ANNOUNCER_PRIORITY.enteringCombatAfterLoss);
    expect(ANNOUNCER_PRIORITY.enteringCombatAfterLoss).toBeGreaterThan(ANNOUNCER_PRIORITY.enteringCombat);
  });
  it('the cooldown: an Equipment then a Triple on one turn speaks ONE line; the other is dropped and stays unfired', async () => {
    const r = openShop();
    go({ ...r, equipment: { available: [1] } });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS);
    expect(events()).toEqual(['equipment']);
    await tick(2000);
    go({ ...r, equipment: { available: [1] }, board: [{ attack: 4, health: 4, golden: true }] });
    await tick(ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['equipment']);
    expect(dropped('triple')).toBe(true);
    expect(announced.fired.triple).toBeUndefined();
  });
  it('never while a line is playing, and the next line waits a full ANNOUNCER_COOLDOWN_MS after the previous one ENDS', async () => {
    const r = openShop();
    go({ ...r, tier: 6 });
    await tick(0);
    expect(events()).toEqual(['tier-six']);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS - ANNOUNCER_EQUIPMENT_DELAY_MS - 10); // the line lands 10 ms short of the cooldown's end
    go({ ...r, tier: 6, equipment: { available: [1] } });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS);
    expect(events()).toEqual(['tier-six']);
    expect(dropped('equipment')).toBe(true);
    await tick(10);
    go({ ...r, tier: 6, equipment: { available: [1, 2] } }); // the moment recurs (a second Equipment), now outside the cooldown
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS);
    expect(events()).toEqual(['tier-six', 'equipment']);
    expect(plays[1]!.t - (plays[0]!.t + LINE_MS)).toBe(ANNOUNCER_COOLDOWN_MS + ANNOUNCER_EQUIPMENT_DELAY_MS);
  });
  it('the forge lines bypass the cooldown (a once-per-run scheduled moment) but never talk over a playing line', async () => {
    const r = openShop();
    go({ ...r, tier: 6 });
    await tick(0);
    expect(events()).toEqual(['tier-six']);
    // Still PLAYING: the forge line waits for the end, then speaks at once (no 12 s).
    await tick(LINE_MS / 2);
    go({ ...r, tier: 6, runeforgeOffer: ['a'] });
    await tick(0);
    expect(events()).toEqual(['tier-six']);
    await tick(LINE_MS / 2);
    expect(events()).toEqual(['tier-six', 'runeforge']);
    expect(plays[1]!.t).toBe(plays[0]!.t + LINE_MS);
    // Inside the cooldown of THAT line: the Epic forge still speaks; a Triple landing with it is dropped (cooldown).
    await tick(LINE_MS + 3000);
    go({ ...r, tier: 6, runeforgeOffer: undefined }); // the Basic forge closes
    go({ ...r, tier: 6, runeforgeOffer: ['b'], runeforgeEpic: true, board: [{ attack: 1, health: 1, golden: true }] });
    await tick(0);
    expect(events()).toEqual(['tier-six', 'runeforge', 'epic-runeforge']);
    expect(dropped('triple')).toBe(true);
    expect(announced.fired.triple).toBeUndefined();
  });
  it('the shelf life: a shop line pending when combat starts expires; a combat line pending when the shop opens expires', async () => {
    const r = openShop();
    go({ ...r, equipment: { available: [1] } });
    await tick(100);
    go({ ...r, equipment: { available: [1] }, phase: 'combat' }); // Face Omen 100 ms in
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + 100);
    expect(plays).toEqual([]);
    expect(expired('equipment')).toBe(true);
    // A verdict line inside the combat's silence window, then a Skip-like instant return to the shop.
    const fighting = { ...r, equipment: { available: [1] }, phase: 'combat' as const };
    await tick(10);
    go({ ...fighting, combatSettled: true, history: ['win', 'win', 'win'], lastCombat: { result: 'win' } });
    go({ ...fighting, combatSettled: false, phase: 'recruit', wave: r.wave + 1, history: ['win', 'win', 'win'] });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(expired('threeWinStreak')).toBe(true);
    expect(events()).toEqual(['back-to-shop']);
  });
  it('once per event per run: the same moment recurring after a line spoke stays silent', async () => {
    const r = openShop();
    go({ ...r, runeforgeOffer: ['a'] });
    await tick(0);
    expect(events()).toEqual(['runeforge']);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, runeforgeOffer: undefined });
    go({ ...r, runeforgeOffer: ['b'] });
    await tick(0);
    expect(events()).toEqual(['runeforge']);
    // …but an EPIC forge is its own event.
    go({ ...r, runeforgeOffer: undefined });
    go({ ...r, runeforgeOffer: ['c'], runeforgeEpic: true });
    await tick(0);
    expect(events()).toEqual(['runeforge', 'epic-runeforge']);
  });
  it('the cap: after ANNOUNCER_LINE_CAP lines nothing else speaks, except GameWon / GameLoss', async () => {
    let r = openShop({ wave: 2 });
    // Six capped shop lines, each a fresh moment, each past the cooldown.
    const moments: Partial<AnnouncerRunLike>[] = [
      { equipment: { available: [1] } }, { tier: 6 }, { runeforgeOffer: ['a'] }, { runeforgeOffer: ['b'], runeforgeEpic: true },
      { board: [{ attack: 1, health: 1, golden: true }] }, { board: [{ attack: ANNOUNCER_BIG_STAT, health: 1, golden: false }] },
    ];
    for (const m of moments) {
      r = go({ ...r, ...m });
      await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
      r = go({ ...r, runeforgeOffer: undefined, runeforgeEpic: false, board: [] });
    }
    expect(plays).toHaveLength(6);
    r = await fight(r, 'lose'); // wave 2's Face Omen: EnteringCombat, #7
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r); // wave 3: BackToShop, #8
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['equipment', 'tier-six', 'runeforge', 'epic-runeforge', 'triple', 'minion-hits-100-stats', 'entering-combat', 'back-to-shop']);
    expect(announced.count).toBe(ANNOUNCER_LINE_CAP);
    r = await fight({ ...r, resolve: 9 }, 'win', { resolveAfter: 9 }); // StartCombatUnder10hp + SurviveUnder10hp: capped out
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toHaveLength(ANNOUNCER_LINE_CAP);
    expect(dropped('startCombatUnder10hp')).toBe(true);
    expect(dropped('surviveUnder10hp')).toBe(true);
    r = backToShop(r, { wave: 20, lobby: { seats: seats(2) } }); // TopTwo: capped out
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toHaveLength(ANNOUNCER_LINE_CAP);
    expect(dropped('topTwo')).toBe(true);
    go({ ...r, phase: 'gameover', lobby: { seats: seats(1, 2) } });
    await tick(ANNOUNCER_END_DELAY_MS);
    expect(events().at(-1)).toBe('game-loss');
    expect(announced.count).toBe(ANNOUNCER_LINE_CAP); // the end line sits outside the cap
  });
  it('GameWon / GameLoss never expire and wait out the cooldown instead of being dropped', async () => {
    const r = openShop();
    const settled = await fight(r, 'win', { odds: 0.2 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(events()).toEqual(['winning-low-odds-fight']);
    go({ ...settled, phase: 'gameover', lobby: { seats: seats(1, 1) } });
    await tick(ANNOUNCER_END_DELAY_MS + 10);
    expect(events()).toEqual(['winning-low-odds-fight']);
    expect(announcerDebug().pending.map((p) => p.event)).toEqual(['gameWon']);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(files()).toEqual(['winning-low-odds-fight-1', 'game-won']);
  });
  it('a line that fails to load frees the announcer (the next moment can speak)', async () => {
    const r = openShop();
    failNext = true;
    go({ ...r, tier: 6 });
    await tick(0);
    expect(plays).toEqual([]);
    expect(announcerDebug().playing).toBeNull();
    await tick(ANNOUNCER_COOLDOWN_MS);
    go({ ...r, tier: 6, runeforgeOffer: ['a'] });
    await tick(0);
    expect(events()).toEqual(['runeforge']);
  });
});

describe('the detectors', () => {
  it('BackToShop: twice per game at most, first no earlier than wave 2, never consecutive, the second 5+ waves later', async () => {
    let r = go(run({ wave: 1, tier: 1 }));
    await tick(ANNOUNCER_GAME_START_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    const waves: number[] = [];
    for (let w = 1; w <= 9; w++) {
      r = await fight(r, 'win');
      await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
      r = backToShop(r);
      await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
      if (events().at(-1) === 'back-to-shop' && plays.at(-1)!.t === Date.now()) waves.push(r.wave);
      await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
      r = go({ ...r, history: [] }); // no streak lines in this test
    }
    expect(waves).toEqual([2, 7]);
    expect(announced.fired.backToShop).toEqual([2, 7]);
  });
  it('Equipment: the first Equipment acquired, ANNOUNCER_EQUIPMENT_DELAY_MS after the SFX', async () => {
    const r = openShop();
    go({ ...r, equipment: { available: [1] } });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS - 1);
    expect(plays).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['equipment']);
  });
  it('Triple: the first gilded minion, a second only 5+ waves later, never a third', async () => {
    let r = openShop({ wave: 4 });
    go({ ...r, hand: [{ golden: true }] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['triple']);
    r = go({ ...r, wave: 8, hand: [{ golden: true }, { golden: true }] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['triple']);
    r = go({ ...r, wave: 9, hand: [{ golden: true }, { golden: true }, { golden: true }] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['triple', 'triple']);
    expect(announced.fired.triple).toEqual([4, 9]);
    go({ ...r, wave: 20, hand: [{ golden: true }, { golden: true }, { golden: true }, { golden: true }] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['triple', 'triple']);
  });
  it('TierSix: the shop reaching tier 6', async () => {
    const r = openShop({ tier: 5 });
    go({ ...r, tier: 6 });
    await tick(0);
    expect(events()).toEqual(['tier-six']);
  });
  it('Runeforge / EpicRuneforge: the offer appearing, Basic vs Epic', async () => {
    const r = openShop();
    go({ ...r, runeforgeOffer: ['a'], runeforgeEpic: true });
    await tick(0);
    expect(events()).toEqual(['epic-runeforge']);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, runeforgeOffer: undefined });
    go({ ...r, runeforgeOffer: ['b'] });
    await tick(0);
    expect(events()).toEqual(['epic-runeforge', 'runeforge']);
  });
  it('EnteringCombat: the first Face Omen, ANNOUNCER_FACE_OMEN_DELAY_MS after the flip', async () => {
    const r = openShop({ wave: 1, tier: 1 });
    await tick(ANNOUNCER_GAME_START_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS - 1);
    expect(events()).toEqual(['game-start']);
    await tick(1);
    expect(events()).toEqual(['game-start', 'entering-combat']);
  });
  it('EnteringCombatAfterLoss: a Face Omen after two consecutive losses (one is not enough)', async () => {
    let r = openShop({ history: ['win', 'lose'] });
    r = await fight(r, 'lose');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toEqual([]);
    r = backToShop(r);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(events()).toEqual(['back-to-shop', 'entering-combat-after-loss']);
  });
  it('StartCombatUnder10hp: Resolve at or below 10 going in; Armor does not count; 11 is not under', async () => {
    const r = openShop();
    go({ ...r, phase: 'combat', resolve: 11 });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(plays).toEqual([]);
    go({ ...r, phase: 'recruit', wave: 6, resolve: 10 });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual(['back-to-shop']);
    go({ ...r, phase: 'combat', wave: 6, resolve: 10, history: ['win'] });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(events()).toEqual(['back-to-shop', 'start-combat-under-10hp']);
  });
  it('SurviveUnder10hp: surviving a fight entered at or below 10; it plays even right after this round\'s StartCombatUnder10hp, as the round\'s only line', async () => {
    const r = openShop({ resolve: 7 });
    const fighting = go({ ...r, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS);
    expect(events()).toEqual(['start-combat-under-10hp']);
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    go({ ...fighting, combatSettled: true, history: ['lose'], resolve: 2, lastCombat: { result: 'lose' } },
      { combatOdds: { wave: r.wave, odds: { win: 0.9, draw: 0, lose: 0.1 } } });
    await tick(0);
    expect(events()).toEqual(['start-combat-under-10hp', 'survive-under-10hp']); // inside the cooldown, still spoke
    expect(dropped('losingLowOddsFight')).toBe(true); // the round's only line
  });
  it('SurviveUnder10hp does not fire when the fight was entered above 10, nor when the seat fell', async () => {
    let r = openShop({ resolve: 11 });
    r = await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(plays).toEqual([]);
    r = backToShop(r, { resolve: 5, history: [] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    await fight(r, 'lose', { resolveAfter: 0 }); // entered at 5 (StartCombatUnder10hp speaks), the seat fell
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(events()).toEqual(['back-to-shop', 'start-combat-under-10hp']);
    expect(announced.fired.surviveUnder10hp).toBeUndefined();
  });
  it('LosingLowOddsFight: losing at 65%+ win odds; WinningLowOddsFight: winning at 35% or less; no odds = skip', async () => {
    const outcomeLines = (): string[] => events().filter((e) => e !== 'back-to-shop');
    let r = openShop();
    r = await fight(r, 'lose', { odds: 0.64 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(outcomeLines()).toEqual([]);
    r = backToShop(r, { history: [] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'lose', { odds: 0.65 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(outcomeLines()).toEqual(['losing-low-odds-fight']);
    r = backToShop(r, { history: [] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win', { odds: 0.36 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(outcomeLines()).toEqual(['losing-low-odds-fight']);
    r = backToShop(r, { history: [] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win'); // no odds computed: skipped
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(outcomeLines()).toEqual(['losing-low-odds-fight']);
    r = backToShop(r, { history: [] });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win', { odds: 0.35 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(outcomeLines()).toEqual(['losing-low-odds-fight', 'winning-low-odds-fight']);
  });
  it('stale odds (another wave) are ignored', async () => {
    const r = openShop();
    const fighting = go({ ...r, phase: 'combat' });
    await tick(8000);
    go({ ...fighting, combatSettled: true, history: ['lose'], lastCombat: { result: 'lose' } },
      { combatOdds: { wave: r.wave - 1, odds: { win: 0.9, draw: 0, lose: 0.1 } } });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(plays).toEqual([]);
  });
  it('ThreeWinStreak: the third consecutive win, not the second', async () => {
    let r = openShop({ history: ['win'] });
    r = await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toEqual([]);
    r = backToShop(r);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(events()).toEqual(['back-to-shop', 'three-win-streak']);
  });
  it('MinionHits100Stats: a board minion reaching 100 Attack or 100 Health in the shop', async () => {
    const r = openShop();
    go({ ...r, board: [{ attack: 99, health: 99, golden: false }] });
    await tick(0);
    expect(plays).toEqual([]);
    go({ ...r, board: [{ attack: 99, health: ANNOUNCER_BIG_STAT, golden: false }] });
    await tick(0);
    expect(events()).toEqual(['minion-hits-100-stats']);
  });
  it('MinionHits100Stats in combat: the observed player frame, after the 3 s silence, once per fight', async () => {
    const r = openShop();
    go({ ...r, phase: 'combat' });
    await tick(500);
    observeCombatBoard([{ attack: 12, health: 120 }], r.wave);
    observeCombatBoard([{ attack: 120, health: 120 }], r.wave);
    await tick(ANNOUNCER_COMBAT_SILENCE_MS - 501);
    expect(plays).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['minion-hits-100-stats']);
    expect(announcerDebug().pending).toEqual([]);
  });
  it('MinionHits100Stats is not observed outside a fight', async () => {
    openShop();
    observeCombatBoard([{ attack: 120, health: 120 }], 5);
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + 1);
    expect(plays).toEqual([]);
  });
  it('TopFour at four seats left, TopTwo at two; TopTwo outranks TopFour and BackToShop when they land together', async () => {
    let r = openShop({ lobby: { seats: seats(6) } });
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { lobby: { seats: seats(4) } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['top-four']);
    expect(dropped('backToShop')).toBe(true);
    expect(announced.fired.backToShop).toBeUndefined();
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight({ ...r, history: [] }, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { lobby: { seats: seats(2) } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['top-four', 'top-two']);
  });
  it('TopFour / TopTwo need the player standing', async () => {
    let r = openShop({ lobby: { seats: seats(6) } });
    r = await fight(r, 'lose');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    backToShop(r, { lobby: { seats: [{ alive: false }, ...seats(4).slice(1)] } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['back-to-shop']);
  });
  it('BackToShop waits ANNOUNCER_BACK_TO_SHOP_DELAY_MS after the return, not the instant resolveCombat lands', async () => {
    let r = openShop();
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    backToShop(r);
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS - 1);
    expect(events()).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['back-to-shop']);
    expect(plays[0]!.t - Date.now()).toBe(0);
  });
  it('the scheduled Runeforge opens WITH the return to the shop (one store update): it plays, and outranks the BackToShop of that same return, which stays unfired', async () => {
    // The turn-6 Basic forge: `resolveCombat` -> advanceCombat -> the turn-start sequence sets `runeforgeOffer`
    // in the SAME reducer step that flips the phase (owner report 2026-09-23: the forge lines never played).
    let r = openShop({ wave: 5 });
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { runeforgeOffer: ['a', 'b', 'c', 'd'] });
    expect(r.wave).toBe(6);
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS - 1);
    expect(events()).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['runeforge']);
    expect(dropped('backToShop')).toBe(true);
    expect(announced.fired.runeforge).toEqual([6]);
    expect(announced.fired.backToShop).toBeUndefined();
    // The forge closes; the shop turn goes on; nothing replays.
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = go({ ...r, runeforgeOffer: undefined });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['runeforge']);
    // A later return still hears BackToShop (the dropped one never counted).
    r = await fight({ ...r, history: [] }, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    backToShop(r);
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['runeforge', 'back-to-shop']);
  });
  it('the scheduled Epic Runeforge opens WITH the turn-9 return: the Epic variant plays', async () => {
    let r = openShop({ wave: 8 });
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { runeforgeOffer: ['a', 'b', 'c', 'd'], runeforgeEpic: true });
    expect(r.wave).toBe(9);
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['epic-runeforge']);
    expect(announced.fired.epicRuneforge).toEqual([9]);
    expect(announced.fired.runeforge).toBeUndefined();
  });
  it('a forge that opened with the return is not detected twice while it stays open, and TopFour still outranks it', async () => {
    let r = openShop({ wave: 5, lobby: { seats: seats(6) } });
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { runeforgeOffer: ['a'], lobby: { seats: seats(4) } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['top-four']);
    expect(dropped('runeforge')).toBe(true);
    go({ ...r, tier: 4 }); // an unrelated update while the offer is still open
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['top-four']);
    expect(announcerDebug().log.filter((l) => l.kind === 'queue' && l.event === 'runeforge')).toHaveLength(1);
  });
  it('GameWon at 1st place ANNOUNCER_END_DELAY_MS into the end screen; GameLoss at 2nd to 8th', async () => {
    const r = openShop();
    go({ ...r, phase: 'gameover', lobby: { seats: seats(1, 1) } });
    await tick(ANNOUNCER_END_DELAY_MS - 1);
    expect(plays).toEqual([]);
    await tick(1);
    expect(files()).toEqual(['game-won']);
    // A fresh run that loses.
    announced = emptyAnnounced(SEED + 1);
    cur = null;
    go({ ...r, seed: SEED + 1, phase: 'recruit' });
    go({ ...r, seed: SEED + 1, phase: 'gameover', lobby: { seats: seats(3, 4) } });
    await tick(ANNOUNCER_END_DELAY_MS);
    expect(events()).toEqual(['game-won', 'game-loss']);
  });
  it('ANNOUNCER_LINES covers every event with at least one clip and every clip name is kebab-case', () => {
    for (const [event, clips] of Object.entries(ANNOUNCER_LINES)) {
      expect(clips.length, event).toBeGreaterThan(0);
      for (const c of clips) expect(c).toMatch(/^[a-z0-9]+(-[a-z0-9]+)*$/);
    }
  });
});

describe('the silence rules', () => {
  it('nothing in the first ANNOUNCER_COMBAT_SILENCE_MS of a combat resolution: a verdict at 1 s speaks at 3 s', async () => {
    const r = openShop({ history: ['win', 'win'] });
    const settled = await fight(r, 'win', { settleAfter: 1000 });
    expect(settled.history).toHaveLength(3);
    await tick(ANNOUNCER_COMBAT_SILENCE_MS - 1001);
    expect(plays).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['three-win-streak']);
  });
  it('a Skip cancels the queue and the playing line with an ANNOUNCER_STOP_FADE_MS fade', async () => {
    const r = openShop({ history: ['win', 'win'] });
    await fight(r, 'win', { settleAfter: 1000 });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS - 1000);
    expect(events()).toEqual(['three-win-streak']);
    await tick(100);
    expect(announcerDebug().playing).toBe('threeWinStreak');
    cancelAnnouncer('skip');
    expect(plays[0]!.handle.stopped).toBe(ANNOUNCER_STOP_FADE_MS);
    expect(announcerDebug().playing).toBeNull();
    expect(announcerDebug().pending).toEqual([]);
  });
  it('leaving the run (the title) cancels a pending line and the machine goes inactive', async () => {
    const r = openShop();
    go({ ...r, equipment: { available: [1] } });
    go({ ...r, equipment: { available: [1] } }, { showTitle: true });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + 10);
    expect(plays).toEqual([]);
    expect(announcerDebug().active).toBe(false);
  });
  it('a new run (another seed) resets the machine; its own slice is read, the old one is not', async () => {
    const r = openShop();
    go({ ...r, tier: 6 });
    await tick(0);
    expect(events()).toEqual(['tier-six']);
    announced = emptyAnnounced(SEED + 9);
    go(run({ seed: SEED + 9, tier: 6 }));
    go(run({ seed: SEED + 9, tier: 6, runeforgeOffer: ['a'] }));
    await tick(0);
    expect(events()).toEqual(['tier-six', 'runeforge']); // no cooldown carried across runs
  });
});

describe('the channel', () => {
  it('has its own persisted volume (slider default 50, which plays the owner mix gain 0.7) and mute', () => {
    expect(getAnnouncerVolume()).toBe(0.5);
    expect(announcerDebug().level).toBeCloseTo(0.7, 10);
    setAnnouncerVolume(0.4);
    expect(getAnnouncerVolume()).toBe(0.4);
    expect(localStorage.getItem('ascent.announcervol.v2')).toBe('0.4');
    expect(announcerDebug().level).toBeCloseTo(0.56, 10); // 0.4 of the way to 50 = 0.8 x 0.7
    setAnnouncerVolume(7);
    expect(getAnnouncerVolume()).toBe(1);
    expect(isAnnouncerMuted()).toBe(false);
    expect(toggleAnnouncerMute()).toBe(true);
    expect(localStorage.getItem('ascent.announcermuted')).toBe('1');
    expect(announcerDebug().level).toBe(0);
    toggleAnnouncerMute();
    expect(announcerDebug().level).toBe(1);
    setAnnouncerVolume(0.5);
  });
});

describe('the dev tuner (owner 2026-09-24): per-event volume + timing offset', () => {
  it('covers every event exactly once, and the shipped defaults are 100% and 0 ms', () => {
    expect([...ANNOUNCER_TUNER_EVENTS].sort()).toEqual(Object.keys(ANNOUNCER_LINES).sort());
    for (const e of ANNOUNCER_TUNER_EVENTS) {
      expect(ANNOUNCER_TUNER_DEFAULTS[`${e}Vol`]).toBe(100);
      expect(ANNOUNCER_TUNER_DEFAULTS[`${e}Offset`]).toBe(0);
    }
  });
  it('the event volume multiplies into the line gain, and the final gain is clamped at 1', async () => {
    const r = openShop();
    go({ ...r, tier: 6 });
    await tick(0);
    expect(plays[0]!.gain).toBe(1); // untuned: as recorded
    setAnnouncerTunerValue('equipmentVol', 150);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, tier: 6, equipment: { available: [1] } });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS);
    expect(events()).toEqual(['tier-six', 'equipment']);
    expect(plays[1]!.gain).toBe(1.5);
    expect(announcerLineGain(0.5, 1.5)).toBeCloseTo(0.75, 10);
    expect(announcerLineGain(0.7, 1.5)).toBe(1); // 1.05 clamps
    expect(announcerLineGain(0.7, 0)).toBe(0);
    setAnnouncerTunerValue('equipmentVol', 999);
    expect(ANNOUNCER_TUNER_DEFAULTS.equipmentVol).toBe(100);
  });
  it('a positive offset delays the line by exactly that much', async () => {
    setAnnouncerTunerValue('equipmentOffset', 700);
    const r = openShop();
    go({ ...r, equipment: { available: [1] } });
    await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + 700 - 1);
    expect(plays).toEqual([]);
    await tick(1);
    expect(events()).toEqual(['equipment']);
  });
  it('a negative offset fires earlier, but never before the moment is detected', async () => {
    setAnnouncerTunerValue('enteringCombatOffset', -600);
    const r = openShop({ wave: 1, tier: 1 });
    await tick(ANNOUNCER_GAME_START_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...r, phase: 'combat' });
    await tick(ANNOUNCER_FACE_OMEN_DELAY_MS - 600 - 1);
    expect(events()).toEqual(['game-start']);
    await tick(1);
    expect(events()).toEqual(['game-start', 'entering-combat']);
    // Past the built-in delay: clamped to the detection moment, never scheduled in the past.
    setAnnouncerTunerValue('equipmentOffset', -2000);
    const s = openShop();
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    const t0 = Date.now();
    go({ ...s, equipment: { available: [1] } });
    expect(announcerDebug().pending[0]!.notBefore).toBe(t0);
    await tick(0);
    expect(events()).toEqual(['game-start', 'entering-combat', 'equipment']);
  });
  it('the offset leaves the cooldown alone: it still counts from the previous line ending', async () => {
    setAnnouncerTunerValue('equipmentOffset', -400);
    const r = openShop();
    go({ ...r, tier: 6 });
    await tick(0);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS - 10);
    go({ ...r, tier: 6, equipment: { available: [1] } }); // -400 cancels the 400 ms delay: due now, 10 ms inside the cooldown
    await tick(0);
    expect(events()).toEqual(['tier-six']);
    expect(dropped('equipment')).toBe(true);
  });
  it('the ▶ preview plays the event line now at its tuned volume, cycling variants, outside the queue', async () => {
    setAnnouncerTunerValue('backToShopVol', 60);
    expect(previewAnnouncerEvent('backToShop')).toBe('back-to-shop-1');
    await tick(0);
    expect(previewAnnouncerEvent('backToShop')).toBe('back-to-shop-2');
    await tick(0);
    expect(files()).toEqual(['back-to-shop-1', 'back-to-shop-2']);
    expect(plays.map((p) => p.gain)).toEqual([0.6, 0.6]);
    expect(plays[0]!.handle.stopped).toBe(ANNOUNCER_STOP_FADE_MS); // the second press cut the first
    expect(announced.fired.backToShop ?? []).toEqual([]); // nothing marked
  });
});
