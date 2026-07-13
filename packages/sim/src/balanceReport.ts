/**
 * Balance report engine (owner request 2026-07-13) — the shared, PURE core behind both `npm run report` (the
 * CLI in `@game/tools`) and the in-app dev panel. It plays many seeded greedy-bot runs across every pickable
 * hero and tallies OFFER / PICK / WIN rates for heroes, quests, runes, minions, and spells.
 *
 * Method + caveats (the same ones the CLI header prints):
 *  - The bot is the greedy naive policy (`npm run bot`): it plays/buys the FIRST legal option and takes quest /
 *    rune / Discover index 0. So OFFER + WIN are meaningful; PICK reflects the BOT's (dumb) policy, not human
 *    choice — read it as "how often the greedy bot grabbed it when shown".
 *  - Minion/spell WIN rate is CORRELATIONAL: a card is one of up to 7 on a winning board, so it credits the
 *    whole board, not the card alone — a soft co-occurrence signal.
 *  - Everything is seeded + deterministic: the same game count reproduces the report exactly.
 *
 * This module is UI-free and Node-free (no `process`, no `console`) so it runs identically in the browser dev
 * panel and the CLI. The panel drives it hero-by-hero (yielding to the event loop between heroes) via
 * {@link pickableReportHeroes} + {@link playAndRecordInto}; the CLI runs the whole thing synchronously.
 */
import { CONFIG } from './config';
import { HEROES, type HeroDef } from './heroes';
import { createRun } from './state';
import { reduce } from './reducer';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';

export interface Tally {
  offered: number;
  picked: number;
  games: number;
  wins: number;
}
const blank = (): Tally => ({ offered: 0, picked: 0, games: 0, wins: 0 });
const bump = (m: Map<string, Tally>, key: string, field: keyof Tally, n = 1): void => {
  const t = m.get(key) ?? blank();
  t[field] += n;
  m.set(key, t);
};

/** The mutable accumulator threaded through a report run — one tally map per category. */
export interface ReportAccumulator {
  hero: Map<string, Tally>;
  quest: Map<string, Tally>;
  rune: Map<string, Tally>;
  minion: Map<string, Tally>;
  spell: Map<string, Tally>;
}

export const createReportAccumulator = (): ReportAccumulator => ({
  hero: new Map(), quest: new Map(), rune: new Map(), minion: new Map(), spell: new Map(),
});

/** The pickable heroes the report iterates (skips WIP heroes — mirrors the hero picker). */
export const pickableReportHeroes = (): HeroDef[] => HEROES.filter((h) => !h.wip);

/** Seed mixer — the exact hash the CLI uses so the panel and `npm run report` produce identical numbers. */
export const mixReportSeed = (h: number, g: number): number => ((h * 73856093) ^ (g * 19349663)) >>> 0;

/** Play one full greedy-bot run with a fixed hero, recording every offer + pick into `acc`, then credit the
 *  win/loss. Pure aside from mutating `acc`. Identical logic to the CLI's `playAndRecord`. */
export function playAndRecordInto(acc: ReportAccumulator, seed: number, heroId: string): void {
  let s = createRun(seed, heroId);
  // Per-run sets: a card/quest/rune counts as "offered this run" at most once (offer RATE = runs it appeared in).
  const offeredCards = new Set<string>();
  const offeredQuests = new Set<string>();
  const offeredRunes = new Set<string>();
  const pickedQuests = new Set<string>();
  const pickedRunes = new Set<string>();
  const boughtCards = new Set<string>();

  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 100000) {
    if (s.questOffer) {
      for (const id of s.questOffer) offeredQuests.add(id);
      pickedQuests.add(s.questOffer[0]!);
      s = reduce(s, { type: 'buyQuest', index: 0 });
    } else if (s.runeforgeOffer) {
      for (const id of s.runeforgeOffer) offeredRunes.add(id);
      pickedRunes.add(s.runeforgeOffer[0]!);
      s = reduce(s, { type: 'buyRune', index: 0 });
    } else if (s.discover) {
      s = reduce(s, { type: 'discover', index: 0 });
    } else if (s.chooseOne) {
      s = reduce(s, { type: 'chooseOne', index: 0 });
    } else if (s.pendingTarget) {
      s = reduce(s, { type: 'battlecryTarget', targetUid: s.board[0]?.uid ?? s.pendingTarget.uid });
    } else if (s.phase === 'combat') {
      s = reduce(s, { type: 'resolveCombat' });
    } else {
      // Recruit: snapshot the shop offers, then take one greedy action.
      for (const o of s.shop) offeredCards.add(o.cardId);
      if (s.hand.length > 0 && s.board.length < CONFIG.boardMax) {
        const n = reduce(s, { type: 'play', uid: s.hand[0]!.uid }); if (n !== s) { s = n; continue; }
      }
      if (s.embers >= CONFIG.minionCost && s.shop.length > 0 && s.board.length + s.hand.length < CONFIG.boardMax) {
        boughtCards.add(s.shop[0]!.cardId);
        const n = reduce(s, { type: 'buy', uid: s.shop[0]!.uid }); if (n !== s) { s = n; continue; }
      }
      if (s.tier < CONFIG.maxTier && s.embers >= s.upgradeCost) { const n = reduce(s, { type: 'upgrade' }); if (n !== s) { s = n; continue; } }
      if (s.heroReady && s.board[0]) { const n = reduce(s, { type: 'heroPower', uid: s.board[0].uid }); if (n !== s) { s = n; continue; } }
      s = reduce(s, { type: 'faceOmen' });
    }
  }

  const won = s.phase === 'victory';
  // Hero: one game, one outcome.
  bump(acc.hero, heroId, 'games'); if (won) bump(acc.hero, heroId, 'wins');
  // Quests / runes: offered + picked per run, credited with the run's outcome when picked.
  const credit = (m: Map<string, Tally>, offered: Set<string>, picked: Set<string>): void => {
    for (const id of offered) bump(m, id, 'offered');
    for (const id of picked) { bump(m, id, 'picked'); bump(m, id, 'games'); if (won) bump(m, id, 'wins'); }
  };
  credit(acc.quest, offeredQuests, pickedQuests);
  credit(acc.rune, offeredRunes, pickedRunes);
  // Minions + spells: split the offered/bought pools by spell-ness. WIN credit goes to the FINAL board.
  const finalBoard = new Set(s.board.map((c) => c.cardId));
  for (const id of offeredCards) {
    const def = CARD_INDEX[id]; if (!def) continue;
    bump(def.spell ? acc.spell : acc.minion, id, 'offered');
  }
  for (const id of boughtCards) bump(CARD_INDEX[id]?.spell ? acc.spell : acc.minion, id, 'picked');
  for (const id of finalBoard) { const m = CARD_INDEX[id]?.spell ? acc.spell : acc.minion; bump(m, id, 'games'); if (won) bump(m, id, 'wins'); }
}

/** One finished row for display: the tally + resolved name + derived rates (whole-percent, −1 = n/a). */
export interface ReportRow extends Tally {
  id: string;
  name: string;
  /** offered / total-runs, as a whole percent. −1 when no denominator applies (heroes). */
  offerRate: number;
  /** picked / offered, as a whole percent. −1 when never offered. */
  pickRate: number;
  /** wins / games, as a whole percent. −1 when never played. */
  winRate: number;
}

/** The finished report: five ranked tables + the run count that produced them. */
export interface BalanceReport {
  gamesPerHero: number;
  totalRuns: number;
  heroes: ReportRow[];
  quests: ReportRow[];
  runes: ReportRow[];
  minions: ReportRow[];
  spells: ReportRow[];
}

const rate = (n: number, d: number): number => (d === 0 ? -1 : Math.round((100 * n) / d));

/** Turn one tally map into ranked rows (most-winning first, game count as tiebreak). `offerDen` is the total
 *  run count for OFFER-rate categories (quests/runes/cards); omit it for heroes (offer rate n/a). */
function toRows(
  m: Map<string, Tally>,
  nameOf: (id: string) => string,
  offerDen?: number,
): ReportRow[] {
  const rows = [...m.entries()].map(([id, t]): ReportRow => ({
    id, name: nameOf(id), ...t,
    offerRate: offerDen ? rate(t.offered, offerDen) : -1,
    pickRate: t.offered > 0 ? rate(t.picked, t.offered) : -1,
    winRate: rate(t.wins, t.games),
  }));
  rows.sort((a, b) => (b.games ? b.wins / b.games : -1) - (a.games ? a.wins / a.games : -1) || b.games - a.games);
  return rows;
}

/** Finalize an accumulator into ranked, display-ready tables. */
export function finalizeReport(acc: ReportAccumulator, gamesPerHero: number): BalanceReport {
  const totalRuns = gamesPerHero * pickableReportHeroes().length;
  const heroName = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;
  return {
    gamesPerHero,
    totalRuns,
    heroes: toRows(acc.hero, heroName),
    quests: toRows(acc.quest, (id) => QUEST_INDEX[id]?.name ?? id, totalRuns),
    runes: toRows(acc.rune, (id) => RUNE_INDEX[id]?.name ?? id, totalRuns),
    minions: toRows(acc.minion, (id) => CARD_INDEX[id]?.name ?? id, totalRuns),
    spells: toRows(acc.spell, (id) => CARD_INDEX[id]?.name ?? id, totalRuns),
  };
}

/** Run the whole report synchronously (the CLI path). The dev panel instead loops heroes itself so it can
 *  yield to the event loop + drive a progress bar. */
export function computeBalanceReport(gamesPerHero: number): BalanceReport {
  const acc = createReportAccumulator();
  const heroes = pickableReportHeroes();
  for (let h = 0; h < heroes.length; h++) {
    for (let g = 0; g < gamesPerHero; g++) playAndRecordInto(acc, mixReportSeed(h + 1, g + 1), heroes[h]!.id);
  }
  return finalizeReport(acc, gamesPerHero);
}
