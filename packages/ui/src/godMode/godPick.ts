// packages/ui/src/godMode/godPick.ts
import { ancientOfferOpen, modalOpen, type BoardSnapshot, type RunState } from '@game/sim';
import { pinGodFoe } from './godBoards';

/**
 * GOD MODE's End Turn wiring, kept out of Recruit.tsx so it can be tested without mounting the shop (owner
 * 2026-10-08: End Turn asks "What round should your opponent board be on?", a pick fights a real board from it).
 */

/** God Mode actions (`godPrint` / `godGrantRune`) are refused by the reducer while a window owns the screen: every
 *  `modalOpen` window (Discover, Choose One, a Battlecry aim, quest, hero-power or Runeforge offer, Scout) AND the
 *  Ancients awakening offer, which is its own gate (`reduce`'s two guards). The panel greys out on exactly this. */
export function godPanelLocked(run: RunState): boolean {
  return modalOpen(run) || ancientOfferOpen(run);
}

/** End Turn in God Mode opens the round prompt instead of fighting, unless a pick has just pinned the foe. */
export function godEndTurnNeedsPick(run: Pick<RunState, 'godMode'>, foeReady: boolean): boolean {
  return run.godMode === true && !foeReady;
}

export type GodPromptState = { busy: boolean; message: string | null } | null;

export interface GodPickDeps {
  getRun: () => RunState;
  setRun: (run: RunState) => void;
  /** Fetch a board for the round (Supabase → pool). May reject; a rejection reads as "no board". */
  findBoard: (round: number, setId: string) => Promise<BoardSnapshot | null>;
  setId: (run: RunState) => string;
  setPrompt: (p: GodPromptState) => void;
  remember: (round: number) => void;
  /** Re-enter End Turn with the God Mode gate open (the board is pinned by then). */
  fight: () => void;
}

export type GodPickOutcome = 'fought' | 'stale' | 'none';

/**
 * One pick: busy → fetch → if the shop moved on (phase / round / mode / run changed) drop the board; if nothing came back
 * (or the fetch threw) say so and stay open; otherwise pin it as this round's foe and start the fight. The prompt can
 * never be left stuck on busy: every path ends by closing it or clearing busy.
 */
export async function runGodPick(round: number, deps: GodPickDeps): Promise<GodPickOutcome> {
  deps.setPrompt({ busy: true, message: null });
  deps.remember(round);
  const live = deps.getRun();
  let board: BoardSnapshot | null = null;
  try {
    board = await deps.findBoard(round, deps.setId(live));
  } catch {
    board = null;
  }
  const now = deps.getRun();
  // Same run too (seed), not just the same round: leaving and starting a NEW God Mode game that reaches this wave while
  // the fetch is in flight must not pin the old pick into it.
  if (now.phase !== 'recruit' || now.wave !== live.wave || now.godMode !== true || now.seed !== live.seed) { deps.setPrompt(null); return 'stale'; }
  if (!board) { deps.setPrompt({ busy: false, message: `No boards found for round ${round} — try another` }); return 'none'; }
  deps.setRun(pinGodFoe(now, board));
  deps.setPrompt(null);
  deps.fight();
  return 'fought';
}
