/**
 * EMOTES IN A GAME (owner spec 2026-10-13): the menu's state, the 20 s cooldown, the phase clock and "say it".
 *
 * THE PHASE CLOCK. An emote's offset is measured from the start of the phase it was used in: the shop TURN (the run
 * entering `recruit` for a wave) or the COMBAT (the run entering `combat`). The same clock times your own emotes (what
 * gets recorded) and a served seat's replay (what gets played back), so a recorded "4.2 s into the shop" plays 4.2 s
 * into yours. `performance.now()`: monotonic, and only differences are ever kept.
 *
 * SAYING ONE: refused while cooling down, outside a shop turn or a combat, or in a replay. Otherwise the message goes
 * out through the transport (your own bubble comes straight back), and in a LOBBY run it is recorded for the round's
 * board (emoteRecording.ts): a shop emote is held for the board captured at the end of the turn, a combat emote is
 * written onto the board already captured for this round.
 */
import { create } from 'zustand';
import { EMOTE_COOLDOWN_MS, emoteCooldownLeft, recordEmoteOnBoards, type BoardSnapshot, type EmoteMessage, type EmotePhase } from '@game/sim';
import { emoteOf } from '@game/progression';
import { useGame } from '../store';
import { holdShopEmote } from './emoteRecording';
import { sendEmote } from './emoteTransport';

export const PLAYER_SEAT = 's0';

/** The menu: closed, or open anchored at a stage point (the portrait's top-centre). `lastUsedAt` drives the cooldown. */
export interface EmoteUiState {
  menu: { x: number; y: number } | null;
  lastUsedAt: number | null;
}
export const useEmoteUi = create<EmoteUiState>(() => ({ menu: null, lastUsedAt: null }));

export const emoteNow = (): number => (typeof performance !== 'undefined' ? performance.now() : Date.now());

// ── The phase clock ─────────────────────────────────────────────────────────────────────────────────────────

let clock: { phase: EmotePhase | null; round: number; startedAt: number } = { phase: null, round: 0, startedAt: 0 };
type ClockListener = (c: { phase: EmotePhase | null; round: number; startedAt: number }) => void;
const clockListeners = new Set<ClockListener>();

/** Start (or end, with null) a phase. Re-marking the SAME phase and round is a no-op, so a re-render never resets it. */
export function markEmotePhase(phase: EmotePhase | null, round: number, at: number = emoteNow()): void {
  if (clock.phase === phase && clock.round === round) return;
  clock = { phase, round, startedAt: at };
  for (const fn of [...clockListeners]) fn(clock);
}
/** The current phase clock. */
export const emotePhaseClock = (): Readonly<typeof clock> => clock;
/** Hear every phase start (the replay scheduler). */
export function onEmotePhase(fn: ClockListener): () => void {
  clockListeners.add(fn);
  return () => { clockListeners.delete(fn); };
}

/** Map a run onto the clock: a shop turn, a combat, or neither (game over, no run). */
export function phaseOfRun(run: { phase: string }): EmotePhase | null {
  return run.phase === 'recruit' ? 'shop' : run.phase === 'combat' ? 'combat' : null;
}

// ── The menu ────────────────────────────────────────────────────────────────────────────────────────────────

/** Whether this client may emote at all right now (a run on screen in a shop turn or a combat, not a replay). */
export function canEmoteNow(): boolean {
  const s = useGame.getState();
  return !s.replaySession && !s.replaying && !!phaseOfRun(s.run) && clock.phase !== null; // a replay or a Versus spectator never emotes
}

export function openEmoteMenu(at: { x: number; y: number }): void {
  if (!canEmoteNow()) return;
  useEmoteUi.setState({ menu: at });
}
export function closeEmoteMenu(): void {
  if (useEmoteUi.getState().menu) useEmoteUi.setState({ menu: null });
}

/** Ms of cooldown left (0 = ready). */
export const emoteCooldownRemaining = (now: number = emoteNow()): number => emoteCooldownLeft(useEmoteUi.getState().lastUsedAt, now);

/**
 * Say emote `emoteId`. Returns whether it went out. Never throws.
 */
export function sayEmote(emoteId: string, now: number = emoteNow()): boolean {
  if (!emoteOf(emoteId) || !canEmoteNow()) return false;
  if (emoteCooldownLeft(useEmoteUi.getState().lastUsedAt, now) > 0) return false;
  const run = useGame.getState().run;
  const phase = clock.phase!;
  const message: EmoteMessage = { emoteId, seat: PLAYER_SEAT, phase, offsetMs: Math.max(0, now - clock.startedAt), round: run.wave };
  useEmoteUi.setState({ lastUsedAt: now, menu: null });
  recordOwnEmote(message, run);
  sendEmote(message);
  return true;
}

/** Record it for the round's board: rated lobby runs only (the boards a lobby uploads), never a sandbox. */
function recordOwnEmote(m: EmoteMessage, run: { mode?: string; sandbox?: unknown }): void {
  if (run.mode !== 'lobby' || run.sandbox) return;
  if (m.phase === 'shop') { holdShopEmote(m); return; }
  useGame.setState((s) => {
    const next = recordEmoteOnBoards(s.capturedBoards, m) as BoardSnapshot[];
    return next === s.capturedBoards ? {} : { capturedBoards: next };
  });
}

/** Tests: reset the cooldown, the menu and the clock. */
export function resetEmotesForTests(): void {
  useEmoteUi.setState({ menu: null, lastUsedAt: null });
  clock = { phase: null, round: 0, startedAt: 0 };
}

export { EMOTE_COOLDOWN_MS };
