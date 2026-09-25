// @vitest-environment jsdom
/**
 * THE ANNOUNCER — `announcer.ts` against the owner's contract (2026-09-23): *"they shouldn't trigger more than
 * once per game … and they shouldn't trigger back to back for things like equipment or triples etc."* and the
 * approved queue logic: once per event per run (persisted, seed-keyed variant), one global cooldown, a priority
 * queue with a shelf life (highest pending speaks, the rest are dropped), the silence rules (title / tutorial /
 * sandbox / replay, the first 3 s of a combat, the turn-1 music fade-in, a Skip cancels), and the per-game cap
 * of fifteen (eight until the second batch, owner 2026-09-24) with GameWon / GameLoss on top.
 *
 * Driven with fake timers and a stub player through the module's injected seams; the store is hand-built
 * structural state (`AnnouncerStateLike`), so every detector is exercised on exactly the fields it reads.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CardDef, Tribe } from '@game/core';
import {
  __setAnnouncerDepsForTests, ANNOUNCER_BACK_TO_SHOP_DELAY_MS, ANNOUNCER_BIG_STAT, ANNOUNCER_COMBAT_SILENCE_MS, ANNOUNCER_COOLDOWN_MS,
  ANNOUNCER_END_DELAY_MS, ANNOUNCER_EQUIPMENT_DELAY_MS, ANNOUNCER_FACE_OMEN_DELAY_MS, ANNOUNCER_GAME_START_DELAY_MS,
  ANNOUNCER_LINES, ANNOUNCER_PRIORITY, ANNOUNCER_RARE_CHANCE, ANNOUNCER_STOP_FADE_MS, ANNOUNCER_TURN_ONE_QUIET_MS,
  announcerDebug, announcerPick, announcerRoll, hasPair, cancelAnnouncer, getAnnouncerVolume, isAnnouncerMuted, observeCombatBoard,
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

/** Real card defs, found by shape so the tests never pin a card that a balance pass may move. */
const plainMinion = (tribe: Tribe): CardDef | undefined =>
  Object.values(CARD_INDEX).find((d) => d.tribe === tribe && !d.tribe2 && !d.universalTribe && !d.spell && !d.ruby && !d.token);
const BEAST = plainMinion('beast')!;
const DWARF = plainMinion('dwarf')!;
const MECH = plainMinion('mech')!;
const SPELL = Object.values(CARD_INDEX).find((d) => d.spell && !d.ruby)!;
/** A dual-tribe minion, and a plain minion of its SECOND tribe. */
const DUAL = Object.values(CARD_INDEX).find((d) => d.tribe2 && d.tribe2 !== 'neutral' && !d.universalTribe && !d.spell && !d.token && plainMinion(d.tribe2))!;

/** A gilded board minion. */
const g = (): AnnouncerRunLike['board'][number] => ({ attack: 2, health: 2, golden: true });
/** A plain board / hand minion with a card id. */
const m = (cardId: string, golden = false): AnnouncerRunLike['board'][number] => ({ attack: 2, health: 2, golden, cardId });

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
const events = (): string[] => plays.map((p) => p.file.replace(/-\d+$/, ''));
const dropped = (event: AnnouncerEvent): boolean => announcerDebug().log.some((l) => l.kind === 'drop' && l.event === event);
const expired = (event: AnnouncerEvent): boolean => announcerDebug().log.some((l) => l.kind === 'expire' && l.event === event);

/** A run on screen at wave 5's shop (past the turn-1 quiet window, no GameStart). */
function openShop(patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike {
  return go(run(patch));
}
/** Face Omen from `r`, then the verdict `settle` ms later; returns the settled run. */
async function fight(
  r: AnnouncerRunLike, outcome: 'win' | 'lose' | 'draw',
  opts: { settleAfter?: number; resolveAfter?: number; odds?: number; combat?: { enemyDamage?: number; playerDeaths?: number } } = {},
): Promise<AnnouncerRunLike> {
  const fighting = go({ ...r, phase: 'combat' });
  await tick(opts.settleAfter ?? FIGHT_MS);
  const settled = go(
    { ...fighting, combatSettled: true, history: [...r.history, outcome], resolve: opts.resolveAfter ?? r.resolve, lastCombat: { result: outcome, ...opts.combat } },
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
    random: () => 0, // the take is random in the game; pinned to the first take here so tests can name the file
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
  it('owner 2026-09-25: the take is a fresh random pick every time, not the run seed', () => {
    expect(announcerPick(1, 0.99)).toBe(0);
    expect(announcerPick(25, 0)).toBe(0);
    expect(announcerPick(25, 0.999999)).toBe(24);
    expect(announcerPick(4, 0.5)).toBe(2);
    // Every take is reachable, and two calls with different rolls can differ (no seed pinning a moment's take).
    const seen = new Set<number>();
    for (let i = 0; i < 25; i++) seen.add(announcerPick(25, (i + 0.5) / 25));
    expect(seen.size).toBe(25);
    expect(announcerPick(2, 0.1)).not.toBe(announcerPick(2, 0.9));
  });
  it('owner 2026-09-25: GameStart has 25 takes, every file exists, and no two share the same audio', async () => {
    const { readFileSync, existsSync } = await import('node:fs');
    const { createHash } = await import('node:crypto');
    const { resolve } = await import('node:path');
    const dir = `${resolve(process.cwd(), 'apps/web/public/announcer')}/`;
    expect(ANNOUNCER_LINES.gameStart).toHaveLength(25);
    // The audio stream only (ID3 tags stripped), so a re-tagged copy of the same take still counts as a duplicate.
    const audio = (b: Buffer): Buffer => {
      let a = b;
      if (a.subarray(0, 3).toString() === 'ID3') a = a.subarray(10 + ((a[6]! & 0x7f) << 21 | (a[7]! & 0x7f) << 14 | (a[8]! & 0x7f) << 7 | (a[9]! & 0x7f)));
      if (a.subarray(a.length - 128, a.length - 125).toString() === 'TAG') a = a.subarray(0, a.length - 128);
      return a;
    };
    const hashes = new Set<string>();
    for (const name of ANNOUNCER_LINES.gameStart) {
      const file = `${dir}${name}.mp3`;
      expect(existsSync(file), name).toBe(true);
      hashes.add(createHash('md5').update(audio(readFileSync(file))).digest('hex'));
    }
    expect(hashes.size).toBe(25);
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
  it('no line cap (owner 2026-09-25): past 15 lines every fresh moment still speaks; only the cooldown spaces them', async () => {
    let r = openShop({ wave: 2 });
    // Ten capped shop lines, each a fresh moment, each past the cooldown.
    const moments: Partial<AnnouncerRunLike>[] = [
      { equipment: { available: [1] } }, { tier: 6 }, { runeforgeOffer: ['a'] }, { runeforgeOffer: ['b'], runeforgeEpic: true },
      { hand: [{ golden: true }] }, { board: [{ attack: ANNOUNCER_BIG_STAT, health: 1, golden: false }] },
      { board: [g(), g(), g()] }, { goldSpentThisTurn: 20, embers: 10 },
      { shop: [{ uid: 'o1', cardId: MECH.id, atk: 51 }] }, { board: [m('twin'), m('twin')] },
    ];
    for (const mo of moments) {
      r = go({ ...r, ...mo });
      await tick(ANNOUNCER_EQUIPMENT_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
      r = go({ ...r, runeforgeOffer: undefined, runeforgeEpic: false, board: [], hand: [], shop: [] });
    }
    expect(plays).toHaveLength(10);
    r = await fight(r, 'lose'); // wave 2's Face Omen: EnteringCombat, #11
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r); // wave 3: BackToShop, #12
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight({ ...r, resolve: 9 }, 'win', { resolveAfter: 9 }); // StartCombatUnder10hp #13 + SurviveUnder10hp #14
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = backToShop(r, { lobby: { seats: seats(4) } }); // wave 4: TopFour, #15
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(events()).toEqual([
      'equipment', 'tier-six', 'runeforge', 'epic-runeforge', 'triple', 'minion-hits-100-stats', 'golden-army', 'big-spender',
      'shop-big-buff', 'pair', 'entering-combat', 'back-to-shop', 'start-combat-under-10hp', 'survive-under-10hp', 'top-four',
    ]);
    expect(announced.count).toBe(15);
    r = await fight(r, 'win', { odds: 0.2 }); // WinningLowOddsFight: line 16, no longer capped out
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toHaveLength(16);
    expect(events().at(-1)).toBe('winning-low-odds-fight');
    r = backToShop(r, { wave: 20, lobby: { seats: seats(2) } }); // TopTwo: line 17
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(plays).toHaveLength(17);
    expect(events().at(-1)).toBe('top-two');
    go({ ...r, phase: 'gameover', lobby: { seats: seats(1, 2) } });
    await tick(ANNOUNCER_END_DELAY_MS);
    expect(events().at(-1)).toBe('game-loss');
    expect(announced.count).toBe(17); // the end line is not counted
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

describe('the second batch (owner 2026-09-24)', () => {
  /** A buy: the offer `uid` leaves the row (or the spell slot) and the turn's buy count rises. */
  const buy = (r: AnnouncerRunLike, uid: string): AnnouncerRunLike => go({
    ...r,
    shop: (r.shop ?? []).filter((o) => o.uid !== uid),
    spell: r.spell?.uid === uid ? null : r.spell,
    cardsBoughtThisTurn: (r.cardsBoughtThisTurn ?? 0) + 1,
  });
  const offers = (...ids: string[]): { uid: string; cardId: string }[] => ids.map((cardId, i) => ({ uid: `o${i}`, cardId }));
  const RARE: AnnouncerEvent[] = ['randomSpellBuy', 'randomCardBuy', 'randomBeastBuy', 'randomDwarfBuy', 'round7'];
  /** Mark the rare lines spoken, so a test about something else never hears a lucky roll. */
  const silenceRare = (): void => { for (const e of RARE) announced = withAnnounced(announced, e, 1); };
  const seedWhere = (pred: (seed: number) => boolean): number => {
    for (let s = 1; s < 200_000; s++) if (pred(s)) return s;
    throw new Error('no seed');
  };
  const hit = (seed: number, e: AnnouncerEvent, wave: number, i: number): boolean => announcerRoll(seed, e, wave, i) < ANNOUNCER_RARE_CHANCE;
  /** Start a run on `seed` (its own slice). */
  const onSeed = (seed: number, patch: Partial<AnnouncerRunLike> = {}): AnnouncerRunLike => {
    announced = emptyAnnounced(seed);
    return openShop({ seed, ...patch });
  };
  const idSeats = (dead: string[] = []) => Array.from({ length: 8 }, (_, i) => ({ id: `s${i}`, alive: !dead.includes(`s${i}`) }));

  it('the card fixtures exist (a Beast, a Dwarf, a Mech, a spell, a dual-tribe minion)', () => {
    for (const d of [BEAST, DWARF, MECH, SPELL, DUAL]) expect(d).toBeDefined();
  });

  it('the clip fixes: TopTwo has ONE variant (TopTwo2 removed), ThreeWinStreak has two, GameWon one', () => {
    expect(ANNOUNCER_LINES.topTwo).toEqual(['top-two-1']);
    expect(ANNOUNCER_LINES.threeWinStreak).toEqual(['three-win-streak-1', 'three-win-streak-2']);
    expect(ANNOUNCER_LINES.gameWon).toEqual(['game-won']);
    expect(ANNOUNCER_LINES.knockout).toHaveLength(4);
    expect(ANNOUNCER_LINES.pair).toHaveLength(2);
    expect(ANNOUNCER_LINES.randomSpellBuy).toHaveLength(2);
    // The table stays append-only: the rare-line rolls still hash an event's index in it.
    expect(Object.keys(ANNOUNCER_LINES).indexOf('gameLoss')).toBe(18);
  });

  it('Knockout: your fight knocks your foe out; it lands with the return (the table settles there), twice at most, 1+ wave apart', async () => {
    let r = openShop({ wave: 8, lobby: { round: 8, seats: idSeats(), encounters: [] } });
    r = await fight(r, 'win');
    const e8 = { round: 8, a: 's0', b: 's3', damageToA: 0, damageToB: 12 };
    r = backToShop(r, { lobby: { round: 9, seats: idSeats(['s3']), encounters: [e8] } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['knockout']);
    expect(ANNOUNCER_LINES.knockout).toContain(files()[0]);
    expect(dropped('backToShop')).toBe(true); // outranked
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win');
    const e9 = { round: 9, a: 's5', b: 's0', damageToA: 9, damageToB: 0 }; // seat 0 on the B side this time
    r = backToShop(r, { lobby: { round: 10, seats: idSeats(['s3', 's5']), encounters: [e8, e9] } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(announced.fired.knockout).toEqual([9, 10]);
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    r = await fight(r, 'win');
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    const e10 = { round: 10, a: 's0', b: 's6', damageToA: 0, damageToB: 20 };
    backToShop(r, { lobby: { round: 11, seats: idSeats(['s3', 's5', 's6']), encounters: [e8, e9, e10] } });
    await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
    expect(announced.fired.knockout).toEqual([9, 10]); // never a third
  });

  it('Knockout is not heard when your foe survives, or when another pair\'s fight knocks a seat out', async () => {
    let r = openShop({ wave: 8, lobby: { round: 8, seats: idSeats(), encounters: [] } });
    r = await fight(r, 'win');
    const mine = { round: 8, a: 's0', b: 's3', damageToA: 0, damageToB: 12 };
    const theirs = { round: 8, a: 's2', b: 's5', damageToA: 0, damageToB: 30 };
    backToShop(r, { lobby: { round: 9, seats: idSeats(['s5']), encounters: [mine, theirs] } });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['back-to-shop']);
    expect(announced.fired.knockout ?? []).toEqual([]);
  });

  it('BigHit: a win that deals 15+ to the opposing hero, capped as the table charges it (no line on a loss)', async () => {
    let r = openShop({ wave: 9 }); // the round cap is 15 on waves 8 to 11
    r = await fight(r, 'win', { combat: { enemyDamage: 22 } });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(events()).toEqual(['big-hit']);
  });
  it('BigHit negatives: capped below 15 (wave 5 caps at 10), 14 damage, or a loss', async () => {
    let r = openShop({ wave: 5 });
    r = await fight(r, 'win', { combat: { enemyDamage: 22 } });
    r = backToShop(r, { wave: 9 });
    r = await fight(r, 'win', { combat: { enemyDamage: 14 } });
    r = backToShop(r);
    await fight(r, 'lose', { combat: { enemyDamage: 30 } });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(files().filter((f) => f === 'big-hit')).toEqual([]);
  });

  it('ComebackWin: a win right after 3+ losses in a row', async () => {
    const r = openShop({ history: ['win', 'lose', 'lose', 'lose'] });
    await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(events()).toEqual(['entering-combat-after-loss', 'comeback-win']);
  });
  it('ComebackWin negatives: two losses, or a draw breaking the run', async () => {
    let r = openShop({ history: ['lose', 'lose', 'draw', 'lose', 'lose'] });
    r = await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(files()).not.toContain('comeback-win');
    expect(announced.fired.comebackWin ?? []).toEqual([]);
  });

  it('FlawlessVictory: a win with no friendly deaths, from wave 5', async () => {
    const r = openShop({ wave: 5 });
    await fight(r, 'win', { combat: { playerDeaths: 0 } });
    await tick(ANNOUNCER_COMBAT_SILENCE_MS);
    expect(events()).toEqual(['flawless-victory']);
  });
  it('FlawlessVictory negatives: wave 4, a death, or no death count at all', async () => {
    let r = openShop({ wave: 4 });
    r = await fight(r, 'win', { combat: { playerDeaths: 0 } });
    r = backToShop(r, { wave: 5 });
    r = await fight(r, 'win', { combat: { playerDeaths: 1 } });
    r = backToShop(r, { wave: 6 });
    await fight(r, 'win');
    await tick(ANNOUNCER_COMBAT_SILENCE_MS + LINE_MS);
    expect(files()).not.toContain('flawless-victory');
  });

  it('GoldenArmy: the third gilded minion on the board outranks that Triple', async () => {
    const r = openShop({ board: [g(), g()] });
    go({ ...r, board: [g(), g(), g()] });
    await tick(0);
    expect(events()).toEqual(['golden-army']);
    expect(dropped('triple')).toBe(true);
  });
  it('GoldenArmy negative: three gilded split between board and hand is only a Triple', async () => {
    const r = openShop({ board: [g(), g()] });
    go({ ...r, hand: [{ golden: true }] });
    await tick(0);
    expect(events()).toEqual(['triple']);
  });

  it('RichTurn: a Shop turn that opens with 20+ Gold (with the return), outranking BackToShop', async () => {
    const r = await fight(openShop(), 'lose');
    backToShop(r, { embers: 20 });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
    expect(events()).toEqual(['rich-turn']);
  });
  it('RichTurn negatives: 19 Gold at the open, or reaching 20 mid-turn', async () => {
    const r = await fight(openShop(), 'lose');
    const s = backToShop(r, { embers: 19 });
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS + LINE_MS + ANNOUNCER_COOLDOWN_MS);
    go({ ...s, embers: 25 });
    await tick(1000);
    expect(events()).toEqual(['back-to-shop']);
  });

  it('BigSpender: 20+ Gold spent this turn while still holding 10+', async () => {
    const r = openShop({ goldSpentThisTurn: 12, embers: 18 });
    go({ ...r, goldSpentThisTurn: 20, embers: 10 });
    await tick(0);
    expect(events()).toEqual(['big-spender']);
  });
  it('BigSpender negatives: 20 spent with 9 left, 19 spent with plenty left', async () => {
    const r = openShop({ goldSpentThisTurn: 0, embers: 40 });
    go({ ...r, goldSpentThisTurn: 20, embers: 9 });
    go({ ...r, goldSpentThisTurn: 19, embers: 30 });
    await tick(1000);
    expect(plays).toEqual([]);
  });

  it('ShopBigBuff: a Shop minion offer passing 50 Attack (exactly 50 is not over)', async () => {
    const base = MECH.attack;
    const r = openShop({ shop: [{ uid: 'o1', cardId: MECH.id, atk: 0 }] });
    const at50 = go({ ...r, shop: [{ uid: 'o1', cardId: MECH.id, atk: 50 - base }] });
    await tick(1000);
    expect(plays).toEqual([]);
    go({ ...at50, shop: [{ uid: 'o1', cardId: MECH.id, atk: 51 - base }] });
    await tick(0);
    expect(events()).toEqual(['shop-big-buff']);
  });
  it('ShopBigBuff negative: a big board minion is not a Shop offer', async () => {
    const r = openShop();
    go({ ...r, board: [{ attack: 60, health: 5, golden: false }] });
    await tick(1000);
    expect(plays).toEqual([]);
  });

  it('Pair: the first two copies of one non-golden minion across board and hand', async () => {
    const r = openShop({ board: [m(BEAST.id)] });
    go({ ...r, hand: [m(BEAST.id)] });
    await tick(0);
    expect(events()).toEqual(['pair']);
    expect(ANNOUNCER_LINES.pair).toContain(files()[0]);
  });
  it('Pair negatives: a golden copy, two spells, two different minions', () => {
    expect(hasPair(run({ board: [m(BEAST.id)], hand: [m(BEAST.id, true)] }))).toBe(false);
    expect(hasPair(run({ hand: [m(SPELL.id), m(SPELL.id)] }))).toBe(false);
    expect(hasPair(run({ board: [m(BEAST.id), m(DWARF.id)] }))).toBe(false);
    expect(hasPair(run({ board: [m(DWARF.id)], hand: [m(DWARF.id)] }))).toBe(true);
  });

  it('TribeFour: four of one tribe bought in one Shop turn; a dual-tribe minion counts for its second tribe too', async () => {
    silenceRare();
    const second = plainMinion(DUAL.tribe2!)!;
    let r = openShop({ shop: offers(second.id, second.id, second.id, DUAL.id), cardsBoughtThisTurn: 0 });
    for (const uid of ['o0', 'o1', 'o2']) r = buy(r, uid);
    await tick(1000);
    expect(plays).toEqual([]);
    buy(r, 'o3');
    await tick(0);
    expect(events()).toEqual(['tribe-four']);
  });
  it('TribeFour negatives: three Beasts and a spell; four Beasts split over two turns', async () => {
    silenceRare();
    let r = openShop({ shop: offers(BEAST.id, BEAST.id, BEAST.id), spell: { uid: 'sp', cardId: SPELL.id }, cardsBoughtThisTurn: 0 });
    for (const uid of ['o0', 'o1', 'o2', 'sp']) r = buy(r, uid);
    r = await fight(r, 'lose');
    r = backToShop(r, { shop: offers(BEAST.id), cardsBoughtThisTurn: 0 });
    buy(r, 'o0');
    await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS + 1000);
    expect(files()).not.toContain('tribe-four');
  });

  describe('the rare lines (owner ruling: "Rare: ~10% per buy")', () => {
    it('announcerRoll is deterministic, in [0, 1), and passes about 10% of the time', () => {
      expect(announcerRoll(SEED, 'randomCardBuy', 5, 1)).toBe(announcerRoll(SEED, 'randomCardBuy', 5, 1));
      let passed = 0;
      for (let s = 1; s <= 5000; s++) {
        const v = announcerRoll(s, 'randomCardBuy', 5, 1);
        expect(v).toBeGreaterThanOrEqual(0);
        expect(v).toBeLessThan(1);
        if (v < ANNOUNCER_RARE_CHANCE) passed++;
      }
      expect(passed / 5000).toBeGreaterThan(0.08);
      expect(passed / 5000).toBeLessThan(0.12);
      // The wave and the buy index each change the roll (a second buy is its own chance).
      const vs = new Set([announcerRoll(SEED, 'randomCardBuy', 5, 1), announcerRoll(SEED, 'randomCardBuy', 5, 2), announcerRoll(SEED, 'randomCardBuy', 6, 1)]);
      expect(vs.size).toBe(3);
    });
    it('RandomCardBuy: a buy on a passing roll speaks; the same buy on a failing roll does not; a replay hears the same', async () => {
      const lucky = seedWhere((s) => hit(s, 'randomCardBuy', 5, 1));
      const r = onSeed(lucky, { shop: offers(MECH.id), cardsBoughtThisTurn: 0 });
      buy(r, 'o0');
      await tick(0);
      expect(events()).toEqual(['random-card-buy']);
      // A replay of the same run (same seed, fresh slice) rolls the same way.
      await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
      cur = null;
      const again = onSeed(lucky, { shop: offers(MECH.id), cardsBoughtThisTurn: 0 });
      buy(again, 'o0');
      await tick(0);
      expect(events()).toEqual(['random-card-buy', 'random-card-buy']);
    });
    it('RandomCardBuy negative: a failing roll stays silent', async () => {
      const unlucky = seedWhere((s) => !hit(s, 'randomCardBuy', 5, 1));
      const r = onSeed(unlucky, { shop: offers(MECH.id), cardsBoughtThisTurn: 0 });
      buy(r, 'o0');
      await tick(1000);
      expect(plays).toEqual([]);
    });
    it('RandomSpellBuy: a spell bought from the spell slot', async () => {
      const seed = seedWhere((s) => hit(s, 'randomSpellBuy', 5, 1) && !hit(s, 'randomCardBuy', 5, 1));
      const r = onSeed(seed, { spell: { uid: 'sp', cardId: SPELL.id }, cardsBoughtThisTurn: 0 });
      buy(r, 'sp');
      await tick(0);
      expect(events()).toEqual(['random-spell-buy']);
    });
    it('RandomBeastBuy / RandomDwarfBuy: their tribe only (a Mech never rolls them)', async () => {
      const seed = seedWhere((s) => hit(s, 'randomBeastBuy', 5, 1) && hit(s, 'randomDwarfBuy', 5, 1) && !hit(s, 'randomCardBuy', 5, 1));
      const r = onSeed(seed, { shop: offers(MECH.id), cardsBoughtThisTurn: 0 });
      buy(r, 'o0'); // buy 1: a Mech (the Beast roll would pass at index 1, but a Mech is no Beast)
      await tick(1000);
      expect(plays).toEqual([]);
      const seed2 = seedWhere((s) => hit(s, 'randomBeastBuy', 5, 1) && !hit(s, 'randomCardBuy', 5, 1));
      cur = null;
      const b = onSeed(seed2, { shop: offers(BEAST.id), cardsBoughtThisTurn: 0 });
      buy(b, 'o0');
      await tick(0);
      expect(events()).toEqual(['random-beast-buy']);
      const seed3 = seedWhere((s) => hit(s, 'randomDwarfBuy', 5, 1) && !hit(s, 'randomCardBuy', 5, 1));
      cur = null;
      const d = onSeed(seed3, { shop: offers(DWARF.id), cardsBoughtThisTurn: 0 });
      buy(d, 'o0');
      await tick(0);
      expect(events()).toEqual(['random-beast-buy', 'random-dwarf-buy']);
    });
    it('one buy qualifying for several rare lines speaks ONE (the specific line first on the tie)', async () => {
      const seed = seedWhere((s) => hit(s, 'randomBeastBuy', 5, 1) && hit(s, 'randomCardBuy', 5, 1));
      const r = onSeed(seed, { shop: offers(BEAST.id), cardsBoughtThisTurn: 0 });
      buy(r, 'o0');
      await tick(LINE_MS + ANNOUNCER_COOLDOWN_MS);
      expect(events()).toEqual(['random-beast-buy']);
      expect(dropped('randomCardBuy')).toBe(true);
      expect(ANNOUNCER_PRIORITY.randomBeastBuy).toBe(ANNOUNCER_PRIORITY.randomCardBuy);
    });
    it('Round7: wave 7\'s Shop on a passing roll; not on a failing one; never another wave', async () => {
      const lucky = seedWhere((s) => hit(s, 'round7', 7, 0));
      let r = await fight(onSeed(lucky, { wave: 6 }), 'lose');
      backToShop(r);
      await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
      expect(files()).toEqual(['round-7']);
      const unlucky = seedWhere((s) => !hit(s, 'round7', 7, 0));
      cur = null;
      plays = [];
      r = await fight(onSeed(unlucky, { wave: 6 }), 'lose');
      backToShop(r);
      await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
      expect(events()).toEqual(['back-to-shop']);
      cur = null;
      plays = [];
      r = await fight(onSeed(lucky, { wave: 7 }), 'lose');
      backToShop(r); // wave 8
      await tick(ANNOUNCER_BACK_TO_SHOP_DELAY_MS);
      expect(events()).toEqual(['back-to-shop']);
    });
  });

  it('the new lines stay silent in the tutorial and a sandbox rig', async () => {
    for (const rp of [{ mode: 'tutorial' }, { sandbox: true }] as Partial<AnnouncerRunLike>[]) {
      cur = null;
      const r = openShop({ ...rp, goldSpentThisTurn: 0, embers: 40, board: [g(), g()] });
      go({ ...r, goldSpentThisTurn: 25, embers: 15, board: [g(), g(), g()] });
      await tick(1000);
    }
    expect(plays).toEqual([]);
  });

  it('every new event has a priority, and the brief\'s numbers', () => {
    expect(ANNOUNCER_PRIORITY).toMatchObject({
      knockout: 88, bigHit: 57, comebackWin: 66, flawlessVictory: 58, goldenArmy: 48, richTurn: 22, bigSpender: 24,
      shopBigBuff: 46, pair: 18, tribeFour: 28, randomSpellBuy: 12, randomCardBuy: 12, randomBeastBuy: 12, randomDwarfBuy: 12, round7: 14,
    });
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
