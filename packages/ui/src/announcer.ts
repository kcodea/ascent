/**
 * THE ANNOUNCER (owner ask 2026-09-23): *"i added announcer sfx here … I named them for when they should
 * trigger. they shouldn't trigger more than once per game, though. and they shouldn't trigger back to back for
 * things like equipment or triples etc."* Plus: *"we'll need an announcer toggle and audio channel as well,
 * similar to music."*
 *
 * One-shot voice lines on game moments, driven from the store like the music (`syncAnnouncer(state, prev)`
 * on every store update, React-free) and spoken through a PRIORITY QUEUE, not a FIFO:
 *
 *  · ONCE PER EVENT PER RUN, tracked in the store's `announced` slice (persisted with the autosave, keyed by the
 *    run seed, reset by every new run) so a Save & Continue never replays a line. Two events may speak twice
 *    (BackToShop, Triple) — at least ANNOUNCER_REPEAT_GAP_WAVES waves apart, still against the cap.
 *  · The VARIANT (1 / 2 / 3) is picked from the run seed, so a replayed run hears the same line.
 *  · A GLOBAL COOLDOWN: no line within ANNOUNCER_COOLDOWN_MS of the previous one, and never while a line is
 *    playing. An event that lands inside the cooldown is DROPPED, not queued (that is what stops the Equipment →
 *    Triple → TierSix chatter on one turn). A dropped event stays unfired: it may speak later if its moment
 *    recurs (BackToShop, a later Equipment) and is still valid (TierSix cannot recur).
 *  · PRIORITY with a SHELF LIFE: when several events are pending at once the highest priority speaks and the
 *    rest are dropped; combat lines expire when the next shop opens, shop lines when combat starts; the two
 *    end-of-game lines never expire and wait out the cooldown.
 *  · TIMING: the Face Omen lines wait ANNOUNCER_FACE_OMEN_DELAY_MS after the flip, the return-to-shop lines (and a
 *    forge that opens with the return) ANNOUNCER_BACK_TO_SHOP_DELAY_MS after `resolveCombat` (owner 2026-09-23:
 *    "they play too quickly and should be offset by about 1s").
 *  · SILENCE RULES: nothing in the first ANNOUNCER_COMBAT_SILENCE_MS of a combat resolution; nothing over the
 *    music's turn-1 fade-in (GameStart waits until ANNOUNCER_GAME_START_DELAY_MS); never on the title, in a
 *    tutorial, a sandbox rig or a replay; a Skip (`stopAllAudio`) or leaving the run cancels the queue and the
 *    playing line at once (ANNOUNCER_STOP_FADE_MS).
 *  · A per-game CAP of ANNOUNCER_LINE_CAP lines; GameWon / GameLoss are allowed on top of it.
 *
 * AUDIO: its OWN channel — a third gain on the SFX AudioContext (like the music's), with its own volume + mute
 * (`ascent.announcervol`, `ascent.announcermuted`, default 0.9), NOT ducked by the Game-sounds mute or slider.
 * The 34 clips are PUBLIC files (`apps/web/public/announcer/`), fetched + decoded LAZILY on first need into a
 * cached buffer (never the eager `import.meta.glob` bank in sfx.ts). Without Web Audio an HTMLAudioElement per
 * line carries the level. Lines never overlap each other.
 */
import { isMusicWanted, MUSIC_FADE_MS, MUSIC_START_DELAY_MS, type MusicStateLike } from './music';
import {
  type AnnouncedSlice, type AnnouncerEvent, announcedFor, firedWaves, hasFired, UNCAPPED_EVENTS,
} from './announcerSlice';

export type { AnnouncerEvent } from './announcerSlice';

// ── The constants (one name each; the tests and the devlog read these) ──────────────────────────────────────
/** No line within this of the previous one ending. THE cooldown. */
export const ANNOUNCER_COOLDOWN_MS = 12_000;
/** Lines per game, GameWon / GameLoss excepted. */
export const ANNOUNCER_LINE_CAP = 8;
/** GameStart: after the first shop lands, past the music's 3 s start + its fade-in. */
export const ANNOUNCER_GAME_START_DELAY_MS = MUSIC_START_DELAY_MS + 1000;
/** No line over the music's turn-1 fade-in: the quiet window after a wave-1 run lands. */
export const ANNOUNCER_TURN_ONE_QUIET_MS = MUSIC_START_DELAY_MS + MUSIC_FADE_MS;
/** Nothing in the first 3 s of a combat resolution (the lines detected DURING the fight: the verdict lines, the
 *  combat board stat). The Face Omen lines are the entry itself and sit inside this window on purpose. */
export const ANNOUNCER_COMBAT_SILENCE_MS = 3000;
/** The Face Omen lines (EnteringCombat / AfterLoss / StartCombatUnder10hp) wait out the combat-start stinger +
 *  wipe. 600 ms at first; the owner heard them "too quickly" and asked for about a second more (2026-09-23). */
export const ANNOUNCER_FACE_OMEN_DELAY_MS = 1600;
/** The return-to-shop lines (BackToShop, TopFour / TopTwo, a forge opening WITH the return) wait out the return
 *  wipe. They used to fire the instant `resolveCombat` landed (~30 ms); same owner ask, about a second later. */
export const ANNOUNCER_BACK_TO_SHOP_DELAY_MS = 1000;
/** GameWon / GameLoss: into the rank / post-game screen. */
export const ANNOUNCER_END_DELAY_MS = 1000;
/** Equipment: let the equipment SFX land first. */
export const ANNOUNCER_EQUIPMENT_DELAY_MS = 400;
/** A cancelled line's fade (Skip, leaving the run). */
export const ANNOUNCER_STOP_FADE_MS = 100;
/** "Under 10 hp": Resolve at or below this, Armor not counted. */
export const ANNOUNCER_LOW_RESOLVE = 10;
/** Losing a fight the odds gave the player at least this. */
export const ANNOUNCER_HIGH_ODDS = 0.65;
/** Winning a fight the odds gave the player at most this. */
export const ANNOUNCER_LOW_ODDS = 0.35;
/** A minion at or above this Attack or Health. */
export const ANNOUNCER_BIG_STAT = 100;
/** BackToShop: at most this many per game, the first no earlier than this wave. */
export const ANNOUNCER_BACK_TO_SHOP_MAX = 2;
export const ANNOUNCER_BACK_TO_SHOP_MIN_WAVE = 2;
/** Triple: at most this many per game. */
export const ANNOUNCER_TRIPLE_MAX = 2;
/** A repeatable event's second line comes at least this many waves after its first. */
export const ANNOUNCER_REPEAT_GAP_WAVES = 5;
/** EnteringCombat is "the first Face Omen": if the first one is dropped it may still speak up to this wave. */
export const ANNOUNCER_ENTERING_COMBAT_MAX_WAVE = 3;
const DEFAULT_ANNOUNCER_VOLUME = 0.9;

/** The clips, per event, in variant order. Files live at `<BASE_URL>announcer/<name>.mp3`. GameWon has one
 *  variant today: the delivered `GameWon.mp3` is byte-identical to `TopTwo2.mp3` (a mis-export the owner will
 *  replace); the corrected file drops in under the same name. */
export const ANNOUNCER_LINES: Record<AnnouncerEvent, readonly string[]> = {
  gameStart: ['game-start-1', 'game-start-2'],
  backToShop: ['back-to-shop-1', 'back-to-shop-2', 'back-to-shop-3'],
  equipment: ['equipment-1', 'equipment-2'],
  triple: ['triple-1', 'triple-2'],
  tierSix: ['tier-six-1', 'tier-six-2'],
  runeforge: ['runeforge-1', 'runeforge-2'],
  epicRuneforge: ['epic-runeforge-1', 'epic-runeforge-2'],
  enteringCombat: ['entering-combat-1', 'entering-combat-2'],
  enteringCombatAfterLoss: ['entering-combat-after-loss'],
  startCombatUnder10hp: ['start-combat-under-10hp'],
  surviveUnder10hp: ['survive-under-10hp'],
  losingLowOddsFight: ['losing-low-odds-fight-1', 'losing-low-odds-fight-2'],
  winningLowOddsFight: ['winning-low-odds-fight-1', 'winning-low-odds-fight-2'],
  threeWinStreak: ['three-win-streak'],
  minionHits100Stats: ['minion-hits-100-stats'],
  topFour: ['top-four-1', 'top-four-2'],
  topTwo: ['top-two-1', 'top-two-2'],
  gameWon: ['game-won'],
  gameLoss: ['game-loss-1', 'game-loss-2', 'game-loss-3'],
};

/** Higher speaks first when several are pending at once. */
export const ANNOUNCER_PRIORITY: Record<AnnouncerEvent, number> = {
  gameWon: 100,
  gameLoss: 100,
  topTwo: 90,
  topFour: 85,
  surviveUnder10hp: 80,
  losingLowOddsFight: 70,
  winningLowOddsFight: 70,
  threeWinStreak: 65,
  startCombatUnder10hp: 60,
  enteringCombatAfterLoss: 55,
  minionHits100Stats: 50,
  tierSix: 45,
  epicRuneforge: 40,
  runeforge: 35,
  triple: 30,
  equipment: 25,
  enteringCombat: 20,
  gameStart: 15,
  backToShop: 10,
};

/** When a pending line goes stale: 'shop' lines when combat starts, 'combat' lines when the next shop opens. */
export type AnnouncerShelf = 'shop' | 'combat' | 'never';

// ── The store slice the detectors read (structural, so tests hand-build states) ─────────────────────────────
export interface AnnouncerRunLike {
  seed: number;
  mode?: string | undefined;
  sandbox?: boolean | undefined;
  wave: number;
  phase: string;
  resolve: number;
  tier: number;
  history: readonly string[];
  board: readonly { attack: number; health: number; golden: boolean }[];
  hand: readonly { golden: boolean }[];
  equipment?: { available: readonly unknown[] } | undefined;
  runeforgeOffer?: readonly string[] | undefined;
  runeforgeEpic?: boolean | undefined;
  combatSettled: boolean;
  lastCombat?: { result: string } | undefined;
  lobby?: { seats: readonly { alive: boolean; placement?: number | undefined }[] } | undefined;
}
export interface AnnouncerStateLike extends MusicStateLike {
  run: AnnouncerRunLike;
  announced: AnnouncedSlice;
  /** The rail's real pre-combat odds for `wave`, once the deferred probe has run (see `stampReplayOdds`). */
  combatOdds: { wave: number; odds: { win: number; draw: number; lose: number } } | null;
  markAnnounced: (event: AnnouncerEvent, wave: number) => void;
}

/** The pure gate: the same as the music's (lobby / practice on screen, no sandbox, no replay, no title). */
export const isAnnouncerWanted = (s: MusicStateLike): boolean => isMusicWanted(s);

// ── Injected seams (the real browser APIs by default; tests replace them) ───────────────────────────────────
export interface AnnouncerHandle {
  /** Fade out over `fadeMs` and stop. The ended callback must NOT fire after this. */
  stop(fadeMs: number): void;
}
export interface AnnouncerDeps {
  now: () => number;
  setTimeout: (cb: () => void, ms: number) => number;
  clearTimeout: (id: number) => void;
  /** Start `url` playing; `onEnded` fires once when it finishes on its own. Null = could not play. */
  play: (url: string, onEnded: () => void) => Promise<AnnouncerHandle | null>;
}

// ── Level (the Settings slider + mute), persisted ────────────────────────────────────────────────────────────
let volume = (() => {
  try {
    const v = parseFloat(localStorage.getItem('ascent.announcervol') ?? '');
    return Number.isFinite(v) ? Math.min(1, Math.max(0, v)) : DEFAULT_ANNOUNCER_VOLUME;
  } catch {
    return DEFAULT_ANNOUNCER_VOLUME;
  }
})();
let muted = (() => {
  try {
    return localStorage.getItem('ascent.announcermuted') === '1';
  } catch {
    return false;
  }
})();
const level = (): number => (muted ? 0 : volume);

export function getAnnouncerVolume(): number {
  return volume;
}
export function setAnnouncerVolume(v: number): void {
  volume = Math.min(1, Math.max(0, v));
  try { localStorage.setItem('ascent.announcervol', String(volume)); } catch { /* ignore */ }
  applyLevel();
}
export function isAnnouncerMuted(): boolean {
  return muted;
}
export function toggleAnnouncerMute(): boolean {
  muted = !muted;
  try { localStorage.setItem('ascent.announcermuted', muted ? '1' : '0'); } catch { /* ignore */ }
  applyLevel();
  return muted;
}

// ── Default playback: a decoded buffer through the announcer gain, else an element per line ────────────────
let ctxProvider: () => AudioContext | null = () => null;
/** sfx.ts hands its (lazily created) AudioContext in through here, so this module never builds a second one. */
export function setAnnouncerAudioContextProvider(provider: () => AudioContext | null): void {
  ctxProvider = provider;
}
let graph: { ctx: AudioContext; level: GainNode } | null = null;
const buffers = new Map<string, Promise<AudioBuffer | null>>();
/** Elements on the no-context path that are currently sounding (their `volume` follows the level). */
const liveElements = new Set<HTMLAudioElement>();

function ensureGraph(ctx: AudioContext): GainNode {
  if (graph && graph.ctx === ctx) return graph.level;
  const lvl = ctx.createGain();
  lvl.gain.value = level();
  lvl.connect(ctx.destination);
  graph = { ctx, level: lvl };
  return lvl;
}

function applyLevel(): void {
  if (graph) {
    const now = graph.ctx.currentTime;
    graph.level.gain.cancelScheduledValues(now);
    graph.level.gain.setTargetAtTime(level(), now, 0.01);
  }
  for (const el of liveElements) el.volume = level();
}

function loadBuffer(ctx: AudioContext, url: string): Promise<AudioBuffer | null> {
  let p = buffers.get(url);
  if (!p) {
    p = fetch(url)
      .then((r) => (r.ok ? r.arrayBuffer() : Promise.reject(new Error(String(r.status)))))
      .then((bytes) => ctx.decodeAudioData(bytes))
      .catch(() => null);
    buffers.set(url, p);
  }
  return p;
}

async function playDefault(url: string, onEnded: () => void): Promise<AnnouncerHandle | null> {
  const ctx = ctxProvider();
  if (ctx) {
    const out = ensureGraph(ctx);
    const buf = await loadBuffer(ctx, url);
    if (!buf) return null;
    const src = ctx.createBufferSource();
    src.buffer = buf;
    const g = ctx.createGain();
    g.gain.value = 1;
    src.connect(g);
    g.connect(out);
    let live = true;
    src.onended = () => { if (live) { live = false; try { src.disconnect(); g.disconnect(); } catch { /* ignore */ } onEnded(); } };
    src.start();
    return {
      stop(fadeMs) {
        if (!live) return;
        live = false;
        const t = ctx.currentTime;
        try {
          g.gain.cancelScheduledValues(t);
          g.gain.setValueAtTime(g.gain.value, t);
          g.gain.linearRampToValueAtTime(0, t + fadeMs / 1000);
          src.stop(t + fadeMs / 1000 + 0.01);
        } catch { /* already stopped */ }
      },
    };
  }
  // No Web Audio: one element per line, its own volume carrying the level.
  try {
    if (typeof Audio === 'undefined') return null;
    const el = new Audio(url);
    el.volume = level();
    let live = true;
    const done = (): void => { if (live) { live = false; liveElements.delete(el); onEnded(); } };
    el.addEventListener('ended', done);
    el.addEventListener('error', done);
    liveElements.add(el);
    await el.play();
    return {
      stop(fadeMs) {
        if (!live) return;
        live = false;
        liveElements.delete(el);
        const from = el.volume;
        const started = Date.now();
        const id = window.setInterval(() => {
          const t = Math.min(1, (Date.now() - started) / Math.max(1, fadeMs));
          el.volume = from * (1 - t);
          if (t >= 1) { window.clearInterval(id); try { el.pause(); } catch { /* ignore */ } }
        }, 25);
      },
    };
  } catch {
    return null;
  }
}

const defaultDeps: AnnouncerDeps = {
  now: () => (typeof performance !== 'undefined' ? performance.now() : Date.now()),
  setTimeout: (cb, ms) => window.setTimeout(cb, ms),
  clearTimeout: (id) => window.clearTimeout(id),
  play: playDefault,
};
let deps: AnnouncerDeps = defaultDeps;
/** Tests only: swap the seams. Resets the machine. */
export function __setAnnouncerDepsForTests(patch: Partial<AnnouncerDeps> | null): void {
  resetAnnouncerForTests();
  deps = patch ? { ...defaultDeps, ...patch } : defaultDeps;
}

// ── The queue ───────────────────────────────────────────────────────────────────────────────────────────────
interface PendingLine {
  event: AnnouncerEvent;
  shelf: AnnouncerShelf;
  notBefore: number;
  wave: number;
  /** Speaks inside the cooldown (never over a playing line: it waits for that to end). SurviveUnder10hp after
   *  this round's StartCombatUnder10hp (the round's only line), and the two forge lines (see `detectForge`). */
  bypassCooldown?: boolean;
}
export type AnnouncerLogKind = 'queue' | 'play' | 'drop' | 'expire' | 'cancel' | 'end';
export interface AnnouncerLogEntry { t: number; kind: AnnouncerLogKind; event: AnnouncerEvent; file?: string; why?: string }

let active = false;
let runKey: number | null = null;
let slice: AnnouncedSlice | null = null;
let mark: ((event: AnnouncerEvent, wave: number) => void) | null = null;
let pending: PendingLine[] = [];
let playing: { event: AnnouncerEvent; token: number; handle: AnnouncerHandle | null } | null = null;
let playToken = 0;
let pumpTimer: number | null = null;
/** When the previous line ended (or was cut). The cooldown counts from here. */
let lastLineEndedAt = -Infinity;
/** The event + wave of the line that spoke last (the SurviveUnder10hp exception reads it). */
let lastLine: { event: AnnouncerEvent; wave: number } | null = null;
/** The run landed on screen at this time (the turn-1 quiet window counts from here). */
let runEnteredAt = 0;
let enteredAtWaveOne = false;
/** The current combat resolution began at this time (null outside combat). */
let combatStartedAt: number | null = null;
/** MinionHits100Stats in combat is checked per frame; report it once per fight. */
let bigStatSeenThisCombat = false;
const log: AnnouncerLogEntry[] = [];

function note(kind: AnnouncerLogKind, event: AnnouncerEvent, extra: { file?: string; why?: string } = {}): void {
  log.push({ t: deps.now(), kind, event, ...extra });
  if (log.length > 200) log.splice(0, log.length - 200);
}

function clearPump(): void {
  if (pumpTimer !== null) {
    deps.clearTimeout(pumpTimer);
    pumpTimer = null;
  }
}
/** The queue is evaluated on its own task, never inside the store update that fed it: a burst of events from one
 *  moment (the three Face Omen lines, a verdict's Survive + LowOdds) must be weighed TOGETHER, or the first one
 *  enqueued would speak before the higher-priority one arrived. */
function schedulePump(ms: number): void {
  clearPump();
  pumpTimer = deps.setTimeout(() => { pumpTimer = null; pump(); }, Math.max(0, ms));
}

/** A deterministic variant index from the run seed, the event and its occurrence (so a replay hears the same
 *  line and a second BackToShop differs from the first). */
export function announcerVariant(seed: number, event: AnnouncerEvent, occurrence: number, variants: number): number {
  if (variants <= 1) return 0;
  const events = Object.keys(ANNOUNCER_LINES) as AnnouncerEvent[];
  let h = (seed ^ 0x9e3779b9) >>> 0;
  h = Math.imul(h ^ (events.indexOf(event) + 1), 0x85ebca6b) >>> 0;
  h = Math.imul(h ^ (occurrence + 1), 0xc2b2ae35) >>> 0;
  h = (h ^ (h >>> 13)) >>> 0;
  h = Math.imul(h, 0x27d4eb2f) >>> 0;
  h = (h ^ (h >>> 16)) >>> 0;
  return h % variants;
}

function clipUrl(file: string): string {
  const base = (import.meta.env?.BASE_URL as string | undefined) ?? '/';
  return `${base}announcer/${file}.mp3`;
}

const isTerminal = (e: AnnouncerEvent): boolean => UNCAPPED_EVENTS.includes(e);

function enqueue(line: PendingLine): void {
  if (!active) return;
  if (pending.some((p) => p.event === line.event)) return;
  // The turn-1 quiet window: nothing over the music's fade-in.
  if (enteredAtWaveOne) line.notBefore = Math.max(line.notBefore, runEnteredAt + ANNOUNCER_TURN_ONE_QUIET_MS);
  pending.push(line);
  note('queue', line.event);
  schedulePump(0);
}

function expire(shelf: AnnouncerShelf): void {
  if (!pending.length) return;
  const keep: PendingLine[] = [];
  for (const p of pending) {
    if (p.shelf === shelf) note('expire', p.event);
    else keep.push(p);
  }
  pending = keep;
}

function pump(): void {
  clearPump();
  if (!active || playing || !pending.length) return;
  const now = deps.now();
  const ready = pending.filter((p) => p.notBefore <= now);
  if (!ready.length) {
    schedulePump(Math.min(...pending.map((p) => p.notBefore)) - now);
    return;
  }
  ready.sort((a, b) => ANNOUNCER_PRIORITY[b.event] - ANNOUNCER_PRIORITY[a.event]);
  const cooldownUntil = lastLineEndedAt + ANNOUNCER_COOLDOWN_MS;
  const cooling = now < cooldownUntil;
  // Inside the cooldown only a line that BYPASSES it may speak (the highest such one); every other ready capped
  // line is DROPPED (not delayed into the wrong moment). A terminal line (GameWon / GameLoss) waits it out
  // instead: it never expires.
  const top = cooling ? ready.find((p) => p.bypassCooldown) : ready[0];
  if (!top) {
    for (const p of ready) {
      if (isTerminal(p.event)) continue;
      note('drop', p.event, { why: 'cooldown' });
    }
    pending = pending.filter((p) => !ready.includes(p) || isTerminal(p.event));
    if (pending.length) schedulePump(Math.min(cooldownUntil, ...pending.filter((p) => p.notBefore > now).map((p) => p.notBefore)) - now);
    return;
  }
  // The top line speaks; the other READY lines are dropped (outranked, or still inside the cooldown); a terminal
  // line keeps waiting. Lines whose time has not come stay pending and meet the cooldown when it does.
  for (const p of ready) {
    if (p === top || isTerminal(p.event)) continue;
    note('drop', p.event, { why: cooling && !p.bypassCooldown ? 'cooldown' : `outranked by ${top.event}` });
  }
  pending = pending.filter((p) => !ready.includes(p) || (isTerminal(p.event) && p !== top));
  speak(top);
  if (pending.length) schedulePump(Math.min(...pending.map((p) => p.notBefore)) - now);
}

function speak(line: PendingLine): void {
  const s = slice;
  if (!s || !mark) return;
  if (!isTerminal(line.event) && s.count >= ANNOUNCER_LINE_CAP) {
    note('drop', line.event, { why: 'cap' });
    return;
  }
  const variants = ANNOUNCER_LINES[line.event];
  const occurrence = firedWaves(s, line.event).length;
  const file = variants[announcerVariant(s.seed, line.event, occurrence, variants.length)]!;
  const token = ++playToken;
  playing = { event: line.event, token, handle: null };
  lastLine = { event: line.event, wave: line.wave };
  note('play', line.event, { file });
  mark(line.event, line.wave);
  const ended = (): void => {
    if (!playing || playing.token !== token) return;
    playing = null;
    lastLineEndedAt = deps.now();
    note('end', line.event);
    pump();
  };
  let p: Promise<AnnouncerHandle | null>;
  try {
    p = deps.play(clipUrl(file), ended);
  } catch {
    p = Promise.resolve(null);
  }
  p.then(
    (handle) => {
      if (!playing || playing.token !== token) { handle?.stop(0); return; }
      if (!handle) { ended(); return; }
      playing.handle = handle;
    },
    () => ended(),
  );
}

/** Cancel the queue and the playing line at once (a Skip, leaving the run). */
export function cancelAnnouncer(why = 'cancel'): void {
  clearPump();
  for (const p of pending) note('cancel', p.event, { why });
  pending = [];
  if (playing) {
    note('cancel', playing.event, { why });
    playing.handle?.stop(ANNOUNCER_STOP_FADE_MS);
    playing = null;
    lastLineEndedAt = deps.now();
  }
}

// ── The detectors ───────────────────────────────────────────────────────────────────────────────────────────
const countGolden = (r: AnnouncerRunLike): number => r.board.filter((c) => c.golden).length + r.hand.filter((c) => c.golden).length;
const equipmentCount = (r: AnnouncerRunLike): number => r.equipment?.available.length ?? 0;
const hasBigStat = (units: readonly { attack: number; health: number }[]): boolean =>
  units.some((u) => u.attack >= ANNOUNCER_BIG_STAT || u.health >= ANNOUNCER_BIG_STAT);
const aliveSeats = (r: AnnouncerRunLike): number => r.lobby?.seats.filter((x) => x.alive).length ?? 0;
const playerAlive = (r: AnnouncerRunLike): boolean => r.lobby?.seats[0]?.alive ?? r.resolve > 0;
/** Placement at the end: the seat's stamped placement, else how many were still standing (EndScreen's rule). */
export function finalPlacement(r: AnnouncerRunLike): number {
  const me = r.lobby?.seats[0];
  if (me?.placement) return me.placement;
  if (r.phase === 'victory') return 1;
  return r.lobby ? aliveSeats(r) : 2;
}
const tail = (h: readonly string[], n: number): readonly string[] => h.slice(Math.max(0, h.length - n));

/** A repeatable event (BackToShop, Triple) may speak again `gap` waves after its last line, up to `max`. */
function repeatAllowed(s: AnnouncedSlice, event: AnnouncerEvent, wave: number, max: number): boolean {
  const waves = firedWaves(s, event);
  if (waves.length >= max) return false;
  const last = waves[waves.length - 1];
  return last === undefined || wave - last >= ANNOUNCER_REPEAT_GAP_WAVES;
}

/** THE FORGE OPENING: `runeforgeOffer` appeared (`runeforgeEpic` picks the Epic line). The scheduled forges (turn
 *  6 Basic / turn 9 Epic for every hero, a Runesmith's turn 5, a Guardian's turn 8, a booked Clock forge) open
 *  INSIDE the reducer step that returns the run to the shop (`resolveCombat` → `advanceCombat` → the turn-start
 *  sequence → `openNextStartOfTurnModal`), so the store's ONE update carries the phase flip AND the offer. The
 *  return branch of `syncAnnouncer` returned before this check ever ran, so those forges were never detected at
 *  all (owner report 2026-09-23: "i dont think the runeforge voicelines are playing?"). Both the return branch
 *  and the within-turn branch (a forge behind a quest offer or a Discover arrives on its own update) call this.
 *  The forge lines BYPASS the cooldown (never a playing line): the forge is a scheduled, once-per-run moment
 *  that takes the whole screen, and a Face Omen or verdict line followed by a short fight (or an early End
 *  Combat) would otherwise land the opening inside the previous line's 12 s and drop it for good. */
function detectForge(s: AnnouncedSlice, p: AnnouncerRunLike, run: AnnouncerRunLike, notBefore: number): void {
  if (p.runeforgeOffer || !run.runeforgeOffer) return;
  const event: AnnouncerEvent = run.runeforgeEpic ? 'epicRuneforge' : 'runeforge';
  if (!hasFired(s, event)) enqueue({ event, shelf: 'shop', notBefore, wave: run.wave, bypassCooldown: true });
}

function enterRun(s: AnnouncerStateLike): void {
  cancelAnnouncer('run change');
  active = true;
  runKey = s.run.seed;
  lastLineEndedAt = -Infinity;
  lastLine = null;
  runEnteredAt = deps.now();
  enteredAtWaveOne = s.run.wave === 1 && s.run.phase === 'recruit';
  combatStartedAt = s.run.phase === 'combat' ? runEnteredAt : null;
  bigStatSeenThisCombat = false;
  if (enteredAtWaveOne && !hasFired(slice!, 'gameStart')) {
    enqueue({ event: 'gameStart', shelf: 'shop', notBefore: runEnteredAt + ANNOUNCER_GAME_START_DELAY_MS, wave: 1 });
  }
}

function leaveRun(): void {
  cancelAnnouncer('left the run');
  active = false;
  runKey = null;
  slice = null;
  mark = null;
  combatStartedAt = null;
}

/** Drive the announcer from a store update. Cheap: a few reads when the run object did not change. */
export function syncAnnouncer(s: AnnouncerStateLike, prev: AnnouncerStateLike | null): void {
  const want = isAnnouncerWanted(s);
  if (!want) {
    if (active) leaveRun();
    return;
  }
  const run = s.run;
  slice = announcedFor(s.announced, run.seed);
  mark = s.markAnnounced;
  if (!active || runKey !== run.seed) {
    enterRun(s);
    return;
  }
  const p = prev?.run;
  if (!p || p === run || p.seed !== run.seed) return;
  const now = deps.now();

  // ── Phase flips ──
  if (p.phase !== 'combat' && run.phase === 'combat') {
    // FACE OMEN: the shop's lines are stale now; combat's silence window starts.
    expire('shop');
    combatStartedAt = now;
    bigStatSeenThisCombat = false;
    const at = now + ANNOUNCER_FACE_OMEN_DELAY_MS;
    if (run.resolve <= ANNOUNCER_LOW_RESOLVE && !hasFired(slice, 'startCombatUnder10hp')) {
      enqueue({ event: 'startCombatUnder10hp', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    const last2 = tail(run.history, 2);
    if (last2.length === 2 && last2.every((r) => r === 'lose') && !hasFired(slice, 'enteringCombatAfterLoss')) {
      enqueue({ event: 'enteringCombatAfterLoss', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (run.wave <= ANNOUNCER_ENTERING_COMBAT_MAX_WAVE && !hasFired(slice, 'enteringCombat')) {
      enqueue({ event: 'enteringCombat', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    return;
  }
  if (p.phase === 'combat' && run.phase === 'combat' && !p.combatSettled && run.combatSettled) {
    // THE VERDICT landed (the replay finished, or a draw settled): the outcome lines.
    const at = Math.max(now, (combatStartedAt ?? now) + ANNOUNCER_COMBAT_SILENCE_MS);
    const enteredLow = p.resolve <= ANNOUNCER_LOW_RESOLVE;
    if (enteredLow && run.resolve > 0 && !hasFired(slice, 'surviveUnder10hp')) {
      const afterOwnWarning = lastLine?.event === 'startCombatUnder10hp' && lastLine.wave === run.wave;
      enqueue({ event: 'surviveUnder10hp', shelf: 'combat', notBefore: at, wave: run.wave, bypassCooldown: afterOwnWarning });
    }
    const result = run.lastCombat?.result;
    const odds = s.combatOdds && s.combatOdds.wave === run.wave ? s.combatOdds.odds : null;
    if (odds && result === 'lose' && odds.win >= ANNOUNCER_HIGH_ODDS && !hasFired(slice, 'losingLowOddsFight')) {
      enqueue({ event: 'losingLowOddsFight', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    if (odds && result === 'win' && odds.win <= ANNOUNCER_LOW_ODDS && !hasFired(slice, 'winningLowOddsFight')) {
      enqueue({ event: 'winningLowOddsFight', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    const last3 = tail(run.history, 3);
    if (last3.length === 3 && last3.every((r) => r === 'win') && !hasFired(slice, 'threeWinStreak')) {
      enqueue({ event: 'threeWinStreak', shelf: 'combat', notBefore: at, wave: run.wave });
    }
    return;
  }
  if (p.phase === 'combat' && run.phase === 'recruit') {
    // BACK TO THE SHOP: the fight's lines are stale; the rail shows the round's eliminations now. Every line of
    // this moment shares one `at`, so they are weighed TOGETHER by priority after the return wipe.
    expire('combat');
    combatStartedAt = null;
    const at = now + ANNOUNCER_BACK_TO_SHOP_DELAY_MS;
    const alive = aliveSeats(run);
    if (run.lobby && playerAlive(run)) {
      if (alive <= 2 && !hasFired(slice, 'topTwo')) enqueue({ event: 'topTwo', shelf: 'shop', notBefore: at, wave: run.wave });
      else if (alive <= 4 && !hasFired(slice, 'topFour')) enqueue({ event: 'topFour', shelf: 'shop', notBefore: at, wave: run.wave });
    }
    // A forge that opens WITH the return (the turn-6 / turn-9 forges, a hero's turn-5 / turn-8 one, a booked
    // Clock forge) arrives in this same update: it outranks BackToShop, which is then dropped as outranked
    // (and stays unfired, so a later return may still hear it).
    detectForge(slice, p, run, at);
    if (run.wave >= ANNOUNCER_BACK_TO_SHOP_MIN_WAVE && repeatAllowed(slice, 'backToShop', run.wave, ANNOUNCER_BACK_TO_SHOP_MAX)) {
      enqueue({ event: 'backToShop', shelf: 'shop', notBefore: at, wave: run.wave });
    }
    return;
  }
  if (p.phase !== run.phase && (run.phase === 'gameover' || run.phase === 'victory')) {
    // THE END: the two lines that never expire and sit outside the cap.
    expire('combat');
    expire('shop');
    combatStartedAt = null;
    const event: AnnouncerEvent = finalPlacement(run) === 1 ? 'gameWon' : 'gameLoss';
    if (!hasFired(slice, 'gameWon') && !hasFired(slice, 'gameLoss')) {
      enqueue({ event, shelf: 'never', notBefore: now + ANNOUNCER_END_DELAY_MS, wave: run.wave });
    }
    return;
  }

  // ── Within a shop turn ──
  if (run.phase === 'recruit') {
    if (equipmentCount(run) > equipmentCount(p) && !hasFired(slice, 'equipment')) {
      enqueue({ event: 'equipment', shelf: 'shop', notBefore: now + ANNOUNCER_EQUIPMENT_DELAY_MS, wave: run.wave });
    }
    if (countGolden(run) > countGolden(p) && repeatAllowed(slice, 'triple', run.wave, ANNOUNCER_TRIPLE_MAX)) {
      enqueue({ event: 'triple', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    if (p.tier < 6 && run.tier >= 6 && !hasFired(slice, 'tierSix')) {
      enqueue({ event: 'tierSix', shelf: 'shop', notBefore: now, wave: run.wave });
    }
    detectForge(slice, p, run, now);
    if (!hasBigStat(p.board) && hasBigStat(run.board) && !hasFired(slice, 'minionHits100Stats')) {
      enqueue({ event: 'minionHits100Stats', shelf: 'shop', notBefore: now, wave: run.wave });
    }
  }
}

/** The combat replay's PLAYER units at the current beat (Recruit hands them in per frame): MinionHits100Stats
 *  during a fight. Ghost / enemy boards are never passed. Once per fight, only while the fight is on. */
export function observeCombatBoard(units: readonly { attack: number; health: number }[], wave: number): void {
  if (!active || !slice || combatStartedAt === null || bigStatSeenThisCombat) return;
  if (hasFired(slice, 'minionHits100Stats') || !hasBigStat(units)) return;
  bigStatSeenThisCombat = true;
  enqueue({ event: 'minionHits100Stats', shelf: 'combat', notBefore: Math.max(deps.now(), combatStartedAt + ANNOUNCER_COMBAT_SILENCE_MS), wave });
}

/** Read-only view for the DEV surface (`window.__announcer`) and the tests. */
export function announcerDebug(): {
  active: boolean; playing: AnnouncerEvent | null; pending: readonly { event: AnnouncerEvent; shelf: AnnouncerShelf; notBefore: number }[];
  lastLineEndedAt: number; level: number; log: readonly AnnouncerLogEntry[]; slice: AnnouncedSlice | null;
} {
  return {
    active, playing: playing?.event ?? null, pending: pending.map((p) => ({ event: p.event, shelf: p.shelf, notBefore: p.notBefore })),
    lastLineEndedAt, level: level(), log, slice,
  };
}

/** Tests only: back to a cold module (queue cleared, timers cleared, level untouched). */
export function resetAnnouncerForTests(): void {
  clearPump();
  playing?.handle?.stop(0);
  playing = null;
  pending = [];
  active = false;
  runKey = null;
  slice = null;
  mark = null;
  lastLineEndedAt = -Infinity;
  lastLine = null;
  runEnteredAt = 0;
  enteredAtWaveOne = false;
  combatStartedAt = null;
  bigStatSeenThisCombat = false;
  log.length = 0;
}

if (typeof window !== 'undefined' && import.meta.env?.DEV) {
  (window as unknown as { __announcer?: { log: readonly AnnouncerLogEntry[]; debug: typeof announcerDebug } }).__announcer = { log, debug: announcerDebug };
}
