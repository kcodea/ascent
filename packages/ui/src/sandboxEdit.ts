import type { BoardMinion, CardDef, Keyword } from '@game/core';
import type { BoardCard, BoardSnapshot } from '@game/sim';

/**
 * The Scene Builder's board edits, as PURE data transforms — the rules half of the sandbox editor.
 *
 * Everything the editor can do lives here as a total function over `BoardCard[]` (your row) or
 * `BoardSnapshot` (the pinned opponent), so the rules are unit-testable and the React surfaces stay thin.
 * That split is not stylistic: this repo has no jsdom, so a rule that lives inside a component cannot be
 * asserted at all.
 *
 * Two invariants run through every function here, and both exist because breaking them produces a rig that
 * looks broken rather than an obvious error:
 *   - **Health floors at 1, attack at 0.** A 0-health minion is a corpse; a board of them ends combat
 *     instantly, which reads as "the sandbox is broken" rather than "you typed 0".
 *   - **An opponent board is never empty and never longer than 7.** Same reason for the floor; the ceiling
 *     is the board size the game itself enforces.
 *
 * Stats set here are BASE stats — nothing writes `BoardCard.buffs` (owner ruling 2026-08-09). A 40/40 you
 * typed should read as a 40/40 with neutral badges, not as "+38 buffed": a buff-coloured badge would be
 * asserting a history the unit does not have.
 */

/** Board size, both sides. The game's own limit; published so the clamps and any UI bound cannot drift. */
export const MAX_BOARD = 7;

/** Stats always arrive as a partial — the editor has two fields and either may be untouched. */
export interface StatEdit {
  attack?: number;
  health?: number;
}

const clampAttack = (n: number): number => (!Number.isFinite(n) ? 0 : Math.max(0, Math.round(n)));
const clampHealth = (n: number): number => (!Number.isFinite(n) ? 1 : Math.max(1, Math.round(n)));

/** Apply a partial stat edit to whatever carries `attack`/`health`, honouring the floors. */
function applyStats<T extends { attack: number; health: number }>(unit: T, stats: StatEdit): T {
  return {
    ...unit,
    attack: stats.attack === undefined ? unit.attack : clampAttack(stats.attack),
    health: stats.health === undefined ? unit.health : clampHealth(stats.health),
  };
}

/** Add or remove a keyword, whichever the unit currently lacks or has. Order is preserved on removal. */
function flipKeyword(keywords: Keyword[], kw: Keyword): Keyword[] {
  return keywords.includes(kw) ? keywords.filter((k) => k !== kw) : [...keywords, kw];
}

/* ── your row: BoardCard[] ─────────────────────────────────────────────────────────────────────────── */

/** Replace one card in `board`, matched by uid. An unknown uid returns the board unchanged — the editor can
 *  race a card leaving the board (sold, magnetized), and a throw there would take the panel down. */
function mapCard(board: BoardCard[], uid: string, fn: (c: BoardCard) => BoardCard): BoardCard[] {
  if (!board.some((c) => c.uid === uid)) return board;
  return board.map((c) => (c.uid === uid ? fn(c) : c));
}

export function setCardStats(board: BoardCard[], uid: string, stats: StatEdit): BoardCard[] {
  return mapCard(board, uid, (c) => applyStats(c, stats));
}

/**
 * Swap which card a slot holds, KEEPING its uid. The uid is what every other system knows this body by
 * (the FX subject picker, drag state, the hold store), so swapping the card must not orphan it.
 *
 * Adopts the new card's printed stats and tribe — the point of a swap is to become that card, and carrying
 * the old body's numbers over would silently produce a minion that exists nowhere in the content.
 */
export function setCardId(
  board: BoardCard[],
  uid: string,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardCard[] {
  const def = defOf(cardId);
  if (def === undefined) return board; // unknown id → no-op, never a half-written card
  return mapCard(board, uid, (c) => ({
    ...c,
    cardId,
    tribe: def.tribe,
    attack: clampAttack(def.attack),
    health: clampHealth(def.health),
    keywords: [...def.keywords],
  }));
}

export function toggleCardKeyword(board: BoardCard[], uid: string, kw: Keyword): BoardCard[] {
  return mapCard(board, uid, (c) => ({ ...c, keywords: flipKeyword(c.keywords, kw) }));
}

/* ── the opponent: BoardSnapshot ───────────────────────────────────────────────────────────────────── */

/** Σ(attack + health), which is what `BoardSnapshot.power` is documented to mean. Recomputed on every edit
 *  so a served board can never report a strength its minions don't have. */
const powerOf = (minions: BoardMinion[]): number =>
  minions.reduce((sum, m) => sum + m.attack + m.health, 0);

/**
 * The envelope a pinned opponent board needs, around whatever minions the author staged.
 *
 * The metadata below is the same set `sandbagBoard` (fx/harness/procStage.ts) established, and its audit of
 * which fields are inert for a SERVED board still applies verbatim — read it there before changing any of
 * them. The short version: a served board is pinned into `servedBoards` and read by `nextOpponent`, never
 * selected through `pickOpponent`, so `origin` / `threat` / `seed` / `remote` are all inert; `resolve` is
 * display-only; and `tier` is NOT inert — it feeds loss damage (`enemyState.tier` in `simulate`).
 */
export function stagedBoard(wave: number, minions: BoardMinion[]): BoardSnapshot {
  const clamped = minions.slice(0, MAX_BOARD).map((m) => applyStats(m, {}));
  return {
    v: 1,
    wave,
    heroId: 'warden', // no served-board hero-power branch — see procStage.ts
    resolve: 30,      // display-only
    tier: 7,          // NOT inert: feeds loss damage
    triples: 0,
    tribes: [],
    threat: 'glass',
    power: powerOf(clamped),
    minions: clamped,
    seed: 1,
    origin: 'self',
  };
}

/** Replace one minion by index, recomputing `power`. An out-of-range index is a no-op. */
function mapEnemy(snap: BoardSnapshot, index: number, fn: (m: BoardMinion) => BoardMinion): BoardSnapshot {
  if (index < 0 || index >= snap.minions.length) return snap;
  const minions = snap.minions.map((m, i) => (i === index ? fn(m) : m));
  return { ...snap, minions, power: powerOf(minions) };
}

export function setEnemyStats(snap: BoardSnapshot, index: number, stats: StatEdit): BoardSnapshot {
  return mapEnemy(snap, index, (m) => applyStats(m, stats));
}

export function setEnemyCardId(
  snap: BoardSnapshot,
  index: number,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardSnapshot {
  const def = defOf(cardId);
  if (def === undefined) return snap;
  return mapEnemy(snap, index, () => ({
    cardId,
    attack: clampAttack(def.attack),
    health: clampHealth(def.health),
    keywords: [...def.keywords],
  }));
}

export function toggleEnemyKeyword(snap: BoardSnapshot, index: number, kw: Keyword): BoardSnapshot {
  return mapEnemy(snap, index, (m) => ({ ...m, keywords: flipKeyword(m.keywords ?? [], kw) }));
}

/** Append a minion at its printed stats. Refused at `MAX_BOARD` — the game's own board limit. */
export function addEnemy(
  snap: BoardSnapshot,
  cardId: string,
  defOf: (id: string) => CardDef | undefined,
): BoardSnapshot {
  const def = defOf(cardId);
  if (def === undefined || snap.minions.length >= MAX_BOARD) return snap;
  const minions: BoardMinion[] = [
    ...snap.minions,
    { cardId, attack: clampAttack(def.attack), health: clampHealth(def.health), keywords: [...def.keywords] },
  ];
  return { ...snap, minions, power: powerOf(minions) };
}

/** Remove a minion. REFUSED at one minion left: an empty served board ends combat the instant it starts,
 *  and the rig would then report "no moments" for an effect that is working perfectly. */
export function removeEnemy(snap: BoardSnapshot, index: number): BoardSnapshot {
  if (index < 0 || index >= snap.minions.length || snap.minions.length <= 1) return snap;
  const minions = snap.minions.filter((_, i) => i !== index);
  return { ...snap, minions, power: powerOf(minions) };
}
