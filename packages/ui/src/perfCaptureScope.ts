import type { RunMode, RunState } from '@game/sim';

/**
 * Is this a FULL REAL GAME? (owner ruling 2026-08-29: *"the auto perf hud stuff should only capture full real
 * 'play' mode games"*.)
 *
 * Automatic capture is for the thing players actually experience. **Play** — the title-screen button — starts an
 * eight-seat LOBBY run (`startLobby` → `pendingMode: 'lobby'`), so that is the mode this predicate exists for. It
 * shipped admitting only `'ascent'`, the pre-lobby scored climb, which no entry path has started since the lobby
 * became the game: every real Play game was being recorded and then silently dropped at the end (found
 * 2026-09-11; the Shared tab could only ever hold a legacy run).
 *
 * `'ascent'` stays eligible on purpose: it is still the `RunState.mode` default ("absent = 'ascent'", which is
 * what an older save resolves to on Continue), the store still carries `startAscent`, and it is a full scored
 * game — the same phase mix as a lobby seat, minus the seat. Nothing it can produce would mislead a comparison.
 *
 * Everything else records numbers that would mislead a comparison rather than inform it:
 *
 *   · **practice** runs a 3× shop timer and unlimited health, so its phase mix is nothing like a real game;
 *   · **the Scene Builder sandbox** exists to hold pathological boards still — it is *designed* to be
 *     unrepresentative, and its spikes would dominate every ranking (an ADDITIVE flag, checked before the mode,
 *     because the sandbox rides lobby / practice mechanics);
 *   · **tutorial** is scripted and short;
 *   · **rift** is its own ruleset.
 *
 * A run must also EXIST: idling on the title screen for a minute is not a game, and a row of menu frames
 * would sit in the viewer looking like data. And it must be FINISHED — that half of the rule is not here but at
 * the one call site (`Game.tsx`): the publish fires on the transition into a terminal phase (`gameover` /
 * `victory`), never on tab-hide or unmount, so an abandoned game leaves no row.
 *
 * The HUD and the manual **Share** button are deliberately NOT gated by this — deliberately profiling the
 * Scene Builder is a real thing to want. This governs only what uploads on its own.
 */
const CAPTURED_MODES: ReadonlySet<RunMode> = new Set<RunMode>(['lobby', 'ascent']);

export function isRealPlayRun(run: RunState | null | undefined): boolean {
  if (!run) return false;
  if (run.sandbox) return false;                        // Scene Builder rides real-mode mechanics under its own flag
  return CAPTURED_MODES.has(run.mode ?? 'ascent');      // absent === 'ascent' (see RunState.mode)
}
