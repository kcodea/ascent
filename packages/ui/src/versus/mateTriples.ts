/**
 * DUOS — A CARD THAT COMPLETES MY TEAMMATE'S TRIPLE (owner 2026-11-02, R-DUOS-MATE-TRIPLE-01):
 *
 *   "this is referring to when a teammate has a pair, and the minion shows up in your shop. we need something that
 *    shows you can give that to your teammate for a triple."
 *
 * My teammate's live run reaches me as their spectator frames (`spectate.receiveSpectate` -> `noteMateFrame`), or, in
 * the Scene Builder, as the placeholder teammate's run (`sbDuos.ts`). From it this module keeps the card ids my
 * teammate is ONE copy short of a Gild on (two non-Golden copies on their board + hand; one under Midas' Touch, Twin
 * Gilding, ...: their own `gildCopiesNeeded`). The shop and hand mark a card with one of those ids (`.matetrip`, the
 * own-triple hint tinted teal), so I know buying it and passing it finishes their triple.
 *
 * Pure counting (mirrors the shop's own triple hint and the reducer's `checkTriples` eligibility: spells, Rubies and
 * `noTriple` cards never combine). The store holds one sorted, joined key per seat and is written only when it CHANGES,
 * so a frame that moves nothing costs one comparison and no render. No cycle: this file imports no Versus module (the
 * screen-side hook lives in `useMateTriples.ts`).
 */
import { create } from 'zustand';
import { CARD_INDEX } from '@game/content';
import { gildCopiesNeeded, type VersusGroupSeat } from '@game/sim';

type GildRun = Parameters<typeof gildCopiesNeeded>[0];

/** A card that can take part in a Gild (the shop hint's and `checkTriples`' rule). */
export function canGild(cardId: string): boolean {
  const cd = CARD_INDEX[cardId];
  return !!cd && !cd.spell && !cd.ruby && !cd.noTriple;
}

/**
 * The card ids `view` (a run, or a run's spectator view) is one copy short of Gilding (or closer), sorted and joined by
 * `|` ('' for none, or for anything that is not a run). Pure.
 */
export function mateTripleKey(view: unknown): string {
  if (!view || typeof view !== 'object') return '';
  const v = view as { board?: unknown; hand?: unknown; heroId?: unknown };
  if (typeof v.heroId !== 'string') return '';
  const counts = new Map<string, number>();
  for (const zone of [v.board, v.hand]) {
    if (!Array.isArray(zone)) continue;
    for (const c of zone as { cardId?: unknown; golden?: unknown }[]) {
      if (!c || typeof c.cardId !== 'string' || c.golden || !canGild(c.cardId)) continue;
      counts.set(c.cardId, (counts.get(c.cardId) ?? 0) + 1);
    }
  }
  const out: string[] = [];
  for (const [id, n] of counts) if (n >= gildCopiesNeeded(view as GildRun, id) - 1) out.push(id);
  return out.sort().join('|');
}

export interface MateTriplesState {
  /** Per seat (a Duos match's teammate frames): the seat's `mateTripleKey`. */
  bySeat: Partial<Record<VersusGroupSeat, string>>;
  /** The Scene Builder's placeholder teammate ('' while none, or while its screen is on). */
  local: string;
}

export const useMateTriples = create<MateTriplesState>(() => ({ bySeat: {}, local: '' }));

/** A frame of `seat`'s stream produced `view`: keep its key (written only when it changed). */
export function noteMateTriples(seat: VersusGroupSeat, view: unknown): void {
  const key = mateTripleKey(view);
  const st = useMateTriples.getState();
  if ((st.bySeat[seat] ?? '') !== key) useMateTriples.setState({ bySeat: { ...st.bySeat, [seat]: key } });
}

/** The Scene Builder's teammate run changed (null: no teammate, or its screen is on). */
export function noteLocalMateTriples(run: unknown): void {
  const key = run ? mateTripleKey(run) : '';
  if (useMateTriples.getState().local !== key) useMateTriples.setState({ local: key });
}

/** A new match (or none): forget every seat. */
export function resetMateTriples(): void {
  if (Object.keys(useMateTriples.getState().bySeat).length) useMateTriples.setState({ bySeat: {} });
}

/** The ids of a key, as a set (empty for ''). Pure. */
export const mateTripleIds = (key: string): ReadonlySet<string> => new Set(key ? key.split('|') : []);
