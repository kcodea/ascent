import type { BoardMinion, Keyword } from '@game/core';
import { CARD_INDEX, GAUNTLET_BOARD_MAX, cardRevision, type GauntletMinion, type GauntletRound, type GauntletStage } from '@game/content';
import { GAUNTLET_DEFAULT_TIERS, runeCombatModsFor, type BoardSnapshot } from '@game/sim';
import { stagedBoard } from '../sandboxEdit';

/**
 * The Stage Builder's rules half: a Gauntlet stage draft <-> the `BoardSnapshot` the Scene Builder's sandbox pins.
 * Pure (never mutates an input) so it is unit-testable without a DOM.
 */

const copyMinion = (m: GauntletMinion): GauntletMinion => ({
  ...m,
  ...(m.addedKeywords ? { addedKeywords: [...m.addedKeywords] } : {}),
});

const copyRound = (r: GauntletRound): GauntletRound => ({
  ...(r.tier !== undefined ? { tier: r.tier } : {}),
  board: r.board.map(copyMinion),
});

const withRound = (stage: GauntletStage, round: number, next: GauntletRound): GauntletStage => ({
  ...stage,
  rounds: stage.rounds.map((r, i) => (i === round - 1 ? next : r)),
});

/** The opponent tavern tier for a (1-based) round: the authored tier, else the stage default table. */
export function roundTier(stage: GauntletStage, round: number): number {
  return stage.rounds[round - 1]?.tier ?? GAUNTLET_DEFAULT_TIERS[round - 1] ?? 6;
}

/** Runes the opponent holds in `round`: the round-6 rune from round 6, the round-9 rune from round 9. */
export function activeRunes(stage: GauntletStage, round: number): string[] {
  const out: string[] = [];
  if (round >= 6 && stage.runes.round6) out.push(stage.runes.round6);
  if (round >= 9 && stage.runes.round9) out.push(stage.runes.round9);
  return out;
}

/** A round as the pinned opponent board a Test fight serves (opponent runes included). */
export function roundToSnapshot(stage: GauntletStage, round: number, wave: number): BoardSnapshot {
  const minions: BoardMinion[] = (stage.rounds[round - 1]?.board ?? []).map((m) => {
    const added = m.addedKeywords ?? [];
    // A BoardMinion's `keywords` OVERRIDES the printed set, so added keywords must carry the printed ones with them
    // (same rule as `omenBoardMinions`). With none added, leave it unset so the card keeps its printed keywords.
    const keywords = added.length ? [...new Set([...(CARD_INDEX[m.cardId]?.keywords ?? []), ...added])] : undefined;
    return {
      cardId: m.cardId,
      attack: m.attack,
      health: m.health,
      ...(m.golden ? { golden: true } : {}),
      ...(keywords ? { keywords } : {}),
    };
  });
  const snap = stagedBoard(wave, minions, roundTier(stage, round));
  const runes = activeRunes(stage, round);
  return runes.length ? { ...snap, runes, questMods: runeCombatModsFor(runes) } : snap;
}

/** The inverse: a (possibly edited) pinned board back into a round. Keeps `prev.tier` — the draft's tier is the truth. */
export function snapshotToRound(snap: BoardSnapshot, prev: GauntletRound): GauntletRound {
  const board: GauntletMinion[] = snap.minions.map((m, i) => {
    const def = CARD_INDEX[m.cardId];
    const printed = def?.keywords ?? [];
    const added = (m.keywords ?? []).filter((k) => !printed.includes(k));
    const before = prev.board[i];
    const cardVersion = before && before.cardId === m.cardId ? before.cardVersion : def ? cardRevision(def) : 'unknown';
    return {
      cardId: m.cardId,
      attack: m.attack,
      health: m.health,
      ...(m.golden === true ? { golden: true } : {}),
      ...(added.length ? { addedKeywords: added } : {}),
      cardVersion,
    };
  });
  return { ...(prev.tier !== undefined ? { tier: prev.tier } : {}), board };
}

/** Deep-copy the previous round's board (and tier) into `round`. Round 1 (or out of range) is a no-op. */
export function copyPreviousRound(stage: GauntletStage, round: number): GauntletStage {
  if (round <= 1 || round > stage.rounds.length) return stage;
  const prev = stage.rounds[round - 2];
  if (!prev) return stage;
  return withRound(stage, round, copyRound(prev));
}

/** Move a minion within a round's board. `to` clamps; an out-of-range `from` or a no-move is a no-op. */
export function moveMinion(stage: GauntletStage, round: number, from: number, to: number): GauntletStage {
  const r = stage.rounds[round - 1];
  if (!r || from < 0 || from >= r.board.length) return stage;
  const dest = Math.min(Math.max(to, 0), r.board.length - 1);
  if (dest === from) return stage;
  const board = r.board.slice();
  const [m] = board.splice(from, 1);
  board.splice(dest, 0, m!);
  return withRound(stage, round, { ...r, board });
}

const minionsEqual = (a: GauntletMinion, b: GauntletMinion): boolean => {
  const ka = a.addedKeywords ?? [];
  const kb = b.addedKeywords ?? [];
  return (
    a.cardId === b.cardId &&
    a.attack === b.attack &&
    a.health === b.health &&
    !!a.golden === !!b.golden &&
    a.cardVersion === b.cardVersion &&
    ka.length === kb.length &&
    ka.every((k, i) => k === kb[i])
  );
};

/** Dirty compare: same tier (absent counts as absent), same minions in order. */
export function roundsEqual(a: GauntletRound, b: GauntletRound): boolean {
  return a.tier === b.tier && a.board.length === b.board.length && a.board.every((m, i) => minionsEqual(m, b.board[i]!));
}

/** Stamp every minion's `cardVersion` with its card's current revision (an unknown card keeps what it had). */
export function stampForSave(stage: GauntletStage): GauntletStage {
  return {
    ...stage,
    rounds: stage.rounds.map((r) => {
      const c = copyRound(r);
      return {
        ...c,
        board: c.board.map((m) => {
          const def = CARD_INDEX[m.cardId];
          return def ? { ...m, cardVersion: cardRevision(def) } : m;
        }),
      };
    }),
  };
}

/* ── Minion edits (shared by the panel's list and the board canvas, so both write the draft identically) ── */

/** Drop an optional key rather than writing `undefined`, so a toggled-back minion compares equal to its saved self. */
export function without<T extends object, K extends keyof T>(o: T, k: K): T {
  const next = { ...o };
  delete next[k];
  return next;
}

/** Apply `fn` to minion `idx` of `round`. Out of range is a no-op. */
export function editMinion(stage: GauntletStage, round: number, idx: number, fn: (m: GauntletMinion) => GauntletMinion): GauntletStage {
  const r = stage.rounds[round - 1];
  if (!r || idx < 0 || idx >= r.board.length) return stage;
  return withRound(stage, round, { ...r, board: r.board.map((m, i) => (i === idx ? fn(m) : m)) });
}

/** Append a minion at its printed stats. Refused when the card is unknown or the board is full. */
export function addMinion(stage: GauntletStage, round: number, cardId: string): GauntletStage {
  const r = stage.rounds[round - 1];
  const def = CARD_INDEX[cardId];
  if (!r || !def || r.board.length >= GAUNTLET_BOARD_MAX) return stage;
  return withRound(stage, round, { ...r, board: [...r.board, { cardId, attack: def.attack, health: def.health, cardVersion: cardRevision(def) }] });
}

export function removeMinion(stage: GauntletStage, round: number, idx: number): GauntletStage {
  const r = stage.rounds[round - 1];
  if (!r || idx < 0 || idx >= r.board.length) return stage;
  return withRound(stage, round, { ...r, board: r.board.filter((_, i) => i !== idx) });
}

/** Stats, floored like the game (0 Attack, 1 Health). */
export function setMinionStats(stage: GauntletStage, round: number, idx: number, patch: { attack?: number; health?: number }): GauntletStage {
  return editMinion(stage, round, idx, (m) => ({
    ...m,
    ...(patch.attack !== undefined ? { attack: Math.max(0, Math.round(patch.attack)) } : {}),
    ...(patch.health !== undefined ? { health: Math.max(1, Math.round(patch.health)) } : {}),
  }));
}

/** Swap the card: a fresh unit of the new card at its printed stats (golden + added keywords dropped, as the sandbox does). */
export function swapMinionCard(stage: GauntletStage, round: number, idx: number, cardId: string): GauntletStage {
  const def = CARD_INDEX[cardId];
  if (!def) return stage;
  return editMinion(stage, round, idx, () => ({ cardId, attack: def.attack, health: def.health, cardVersion: cardRevision(def) }));
}

/** Toggle an ADDED keyword. A keyword printed on the card is not the author's to add or remove — a no-op. */
export function toggleAddedKeyword(stage: GauntletStage, round: number, idx: number, kw: Keyword): GauntletStage {
  return editMinion(stage, round, idx, (m) => {
    if ((CARD_INDEX[m.cardId]?.keywords ?? []).includes(kw)) return m;
    const added = m.addedKeywords ?? [];
    const next = added.includes(kw) ? added.filter((k) => k !== kw) : [...added, kw];
    return next.length ? { ...m, addedKeywords: next } : without(m, 'addedKeywords');
  });
}

export function toggleMinionGolden(stage: GauntletStage, round: number, idx: number): GauntletStage {
  return editMinion(stage, round, idx, (m) => (m.golden ? without(m, 'golden') : { ...m, golden: true }));
}
