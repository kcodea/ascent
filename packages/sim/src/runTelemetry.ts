/**
 * Run telemetry (owner request 2026-07-13) — the REAL-PLAYER balance report. Unlike `balanceReport.ts` (which
 * runs greedy-bot SIMULATIONS), this reconstructs what a real player was OFFERED and PICKED by re-running their
 * finished run's action log through the deterministic reducer (the same trick as `replayRun`). No sim pollution,
 * no live instrumentation of the hot path — a finished run is `(seed, heroId, actions)`, so at each step we can
 * observe `questOffer` / `runeforgeOffer` / `shop` (offers) and the player's buy / buyQuest / buyRune (picks),
 * plus each quest's completion turn. One compact `RunTelemetry` row is uploaded per finished run; the in-app
 * report fetches recent rows and aggregates them client-side.
 *
 * Hero offers aren't in the seeded replay (the 3-hero picker rolls off UI randomness), so the caller passes the
 * offered trio in via `heroOffer`.
 */
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';
import { createRun, runRecord, type RunState } from './state';
import { HEROES } from './heroes';
import { reduce } from './reducer';
import type { Replay } from './snapshot';

/** One finished run's offers + picks + outcome — the row uploaded per run + aggregated for the player report. */
export interface RunTelemetry {
  heroId: string;
  /** The 3 heroes offered in the pre-run picker (UI-supplied; empty if unknown). */
  heroOffer: string[];
  won: boolean;
  /** Scored wins over the course (the "wins" the report averages for heroes). */
  wins: number;
  /** Every quest that appeared in an offer this run (deduped). */
  offeredQuests: string[];
  /** Quests the player took (buyQuest). */
  pickedQuests: string[];
  /** Completed quest id → the wave it completed on (for "avg turns to complete"). */
  questTurns: Record<string, number>;
  offeredRunes: string[];
  pickedRunes: string[];
  /** Every card OFFERED this run (deduped) — shop rows + Discover choices. Split into minion vs spell at
   *  aggregation time. */
  offeredCards: string[];
  /** Cards the player ACQUIRED this run (deduped) — bought from the shop OR taken from a Discover. */
  boughtCards: string[];
}

/**
 * Reconstruct a finished run's telemetry by replaying its action log. `heroOffer` is the offered hero trio
 * (from the UI; the picked hero is `replay.heroId`). Deterministic + pure — safe to run headlessly at run-end.
 */
export function reconstructRunTelemetry(replay: Replay, heroOffer: string[] = []): RunTelemetry {
  let s = createRun(replay.seed, replay.heroId);
  const offeredQuests = new Set<string>();
  const pickedQuests = new Set<string>();
  const offeredRunes = new Set<string>();
  const pickedRunes = new Set<string>();
  const offeredCards = new Set<string>();
  const boughtCards = new Set<string>();
  const questTurns: Record<string, number> = {};
  const seenCompleted = new Set<string>(); // quests already recorded as completed (detect the flip)

  const recordCompletions = (st: RunState): void => {
    for (const q of st.activeQuests ?? []) {
      if (q.completed && !seenCompleted.has(q.questId)) {
        seenCompleted.add(q.questId);
        questTurns[q.questId] = st.wave;
      }
    }
  };

  recordCompletions(s);
  for (const action of replay.actions) {
    const before = s;
    // Snapshot offers visible in the state this action is acting on — shop rows, Discover choices, quests, runes.
    for (const id of before.shop ?? []) if (id.cardId) offeredCards.add(id.cardId);
    if (before.discover) for (const id of before.discover) offeredCards.add(id); // Discover = a 3-card offer too
    if (before.questOffer) for (const id of before.questOffer) offeredQuests.add(id);
    if (before.runeforgeOffer) for (const id of before.runeforgeOffer) offeredRunes.add(id);

    s = reduce(before, action);
    if (s === before) continue; // rejected action — no state change

    if (action.type === 'buyQuest' && before.questOffer) {
      const picked = before.questOffer[action.index];
      if (picked) pickedQuests.add(picked);
    } else if (action.type === 'buyRune' && before.runeforgeOffer) {
      const picked = before.runeforgeOffer[action.index];
      if (picked) pickedRunes.add(picked);
    } else if (action.type === 'buy') {
      const card = before.shop?.find((c) => c.uid === action.uid);
      if (card?.cardId) boughtCards.add(card.cardId);
    } else if (action.type === 'discover' && before.discover) {
      const picked = before.discover[action.index]; // the card taken from the Discover → an acquisition
      if (picked) boughtCards.add(picked);
    }
    recordCompletions(s);
  }

  const rec = runRecord(s);
  return {
    heroId: replay.heroId,
    heroOffer,
    won: s.phase === 'victory',
    wins: rec.wins,
    offeredQuests: [...offeredQuests],
    pickedQuests: [...pickedQuests],
    questTurns,
    offeredRunes: [...offeredRunes],
    pickedRunes: [...pickedRunes],
    offeredCards: [...offeredCards].filter((id) => CARD_INDEX[id]),
    boughtCards: [...boughtCards].filter((id) => CARD_INDEX[id]),
  };
}

// ── Aggregation: many run rows → the player balance report ──────────────────────────────────────────────────

/** One display row of the player report. Rates are whole percents (−1 = n/a); averages are 1-dp or null. */
export interface PlayerReportRow {
  id: string;
  name: string;
  offered: number;
  picked: number;
  games: number;
  offerRate: number;
  pickRate: number;
  winRate: number;
  /** Heroes/quests/runes only (won runs among picked / picked games). */
  avgWins: number | null;
  /** Quests only — average wave a completed quest finished on. */
  avgTurns: number | null;
}

/** The finished player report: four ranked tables + the run count behind them. */
export interface PlayerReport {
  totalRuns: number;
  heroes: PlayerReportRow[];
  quests: PlayerReportRow[];
  runes: PlayerReportRow[];
  minions: PlayerReportRow[];
  spells: PlayerReportRow[];
}

interface Acc {
  offered: number; // runs this was offered in
  picked: number; // runs this was picked in
  games: number; // runs picked (= games played with it)
  won: number; // won runs among picked
  winsSum: number; // Σ scored wins among picked (hero avg wins)
  turnsSum: number; // Σ completion wave among picked+completed (quest avg turns)
  turnsCount: number;
}
const blankAcc = (): Acc => ({ offered: 0, picked: 0, games: 0, won: 0, winsSum: 0, turnsSum: 0, turnsCount: 0 });
const pct = (n: number, d: number): number => (d === 0 ? -1 : Math.round((100 * n) / d));
const avg1 = (sum: number, n: number): number | null => (n === 0 ? null : Math.round((10 * sum) / n) / 10);

function toRows(
  m: Map<string, Acc>,
  total: number,
  nameOf: (id: string) => string,
  opts: { wins?: boolean; turns?: boolean } = {},
): PlayerReportRow[] {
  const rows = [...m.entries()].map(([id, a]): PlayerReportRow => ({
    id, name: nameOf(id),
    offered: a.offered, picked: a.picked, games: a.games,
    offerRate: pct(a.offered, total),
    pickRate: pct(a.picked, a.offered),
    winRate: pct(a.won, a.games),
    avgWins: opts.wins ? avg1(a.winsSum, a.games) : null,
    avgTurns: opts.turns ? avg1(a.turnsSum, a.turnsCount) : null,
  }));
  // Rank by win rate (games as tiebreak); minions (no win) fall back to pick volume.
  rows.sort((x, y) => (y.winRate - x.winRate) || (y.games - x.games) || (y.picked - x.picked));
  return rows;
}

/** Aggregate finished-run telemetry rows into the player report (heroes / quests / runes / minions). */
export function aggregatePlayerReport(rows: RunTelemetry[]): PlayerReport {
  const heroes = new Map<string, Acc>();
  const quests = new Map<string, Acc>();
  const runes = new Map<string, Acc>();
  const minions = new Map<string, Acc>();
  const spells = new Map<string, Acc>();
  const bump = (m: Map<string, Acc>, id: string): Acc => { let a = m.get(id); if (!a) { a = blankAcc(); m.set(id, a); } return a; };

  for (const r of rows) {
    // Heroes: offered = the trio; picked = the chosen hero; games/win/avgWins credited to the pick.
    for (const id of r.heroOffer) bump(heroes, id).offered++;
    // A run with no captured hero-offer still credits its pick as offered+picked (so pick rate stays ≤100%).
    if (!r.heroOffer.includes(r.heroId)) bump(heroes, r.heroId).offered++;
    const hp = bump(heroes, r.heroId);
    hp.picked++; hp.games++; hp.winsSum += r.wins; if (r.won) hp.won++;

    const creditPicked = (m: Map<string, Acc>, offered: string[], picked: string[], turns?: Record<string, number>): void => {
      for (const id of offered) bump(m, id).offered++;
      for (const id of picked) {
        const a = bump(m, id);
        if (!offered.includes(id)) a.offered++; // ensure pick rate ≤ 100%
        a.picked++; a.games++; if (r.won) a.won++;
        const t = turns?.[id];
        if (t !== undefined) { a.turnsSum += t; a.turnsCount++; }
      }
    };
    creditPicked(quests, r.offeredQuests, r.pickedQuests, r.questTurns);
    creditPicked(runes, r.offeredRunes, r.pickedRunes);

    // Cards (shop + Discover): offer = seen, pick = acquired. No win credit (per spec). Split minion vs spell.
    for (const id of r.offeredCards) { const def = CARD_INDEX[id]; if (def) bump(def.spell ? spells : minions, id).offered++; }
    for (const id of r.boughtCards) { const def = CARD_INDEX[id]; if (def) { const a = bump(def.spell ? spells : minions, id); a.picked++; a.games++; } }
  }

  const total = rows.length;
  const heroName = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;
  return {
    totalRuns: total,
    heroes: toRows(heroes, total, heroName, { wins: true }),
    quests: toRows(quests, total, (id) => QUEST_INDEX[id]?.name ?? id, { wins: true, turns: true }),
    runes: toRows(runes, total, (id) => RUNE_INDEX[id]?.name ?? id, { wins: true }),
    minions: toRows(minions, total, (id) => CARD_INDEX[id]?.name ?? id),
    spells: toRows(spells, total, (id) => CARD_INDEX[id]?.name ?? id),
  };
}
