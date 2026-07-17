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
  /** Completed quest id → the number of TURNS it took to complete (completion wave − first-active wave). */
  questTurns: Record<string, number>;
  offeredRunes: string[];
  pickedRunes: string[];
  /** Every SHOP card SIGHTING this run (NOT deduped) — one entry per fresh shop-offer instance. The count of an
   *  id = how many times it was seen in the tavern. Split into minion vs spell at aggregation time. */
  offeredCards: string[];
  /** Every SHOP card ACQUISITION this run (NOT deduped) — one entry per shop buy. */
  boughtCards: string[];
  /** Every DISCOVER OPTION shown this run (NOT deduped) — one entry per option in each Discover's 3-card offer.
   *  Kept separate from shop sightings because a Discover offer means something very different (a targeted,
   *  usually tier-up pick) than a card lingering in the tavern. Absent on pre-split historical rows. */
  discoverOfferedCards?: string[];
  /** Every DISCOVER PICK this run (NOT deduped) — one entry per chosen Discover option. */
  discoverBoughtCards?: string[];
  /** Tavern tier reached by the end of each wave — `tierByWave[wave] = tier` (1-indexed; index 0 unused). Drives
   *  the Balance Report's shop-leveling curve (average tier by turn, split won vs lost). */
  tierByWave: number[];
  /** Every card ACQUISITION with the WAVE it happened on + its source (owner ask 2026-07-16: "what turns are
   *  minions mostly bought on"). One entry per shop buy / Discover pick — the wave-tagged superset of
   *  `boughtCards` + `discoverBoughtCards`. Absent on pre-migration historical rows. */
  buyEvents?: { id: string; wave: number; src: 'shop' | 'discover' }[];
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
  // Cards are counted, NOT deduped: `offeredCards` gets one entry per distinct shop-offer SIGHTING (a card sitting
  // in the shop keeps its uid, so it's counted once per fresh appearance — a reroll/refresh mints new uids) plus
  // each Discover option; `boughtCards` gets one entry per buy / Discover pick. So the array length per id = how
  // many times it was SEEN / TAKEN this run.
  const offeredCards: string[] = [];
  const boughtCards: string[] = [];
  const discoverOfferedCards: string[] = [];
  const discoverBoughtCards: string[] = [];
  const buyEvents: { id: string; wave: number; src: 'shop' | 'discover' }[] = [];
  const seenShopUids = new Set<string>(); // each shop-offer instance counts once, however many turns it lingers
  const questTurns: Record<string, number> = {};
  const seenCompleted = new Set<string>(); // quests already recorded as completed (detect the flip)
  const tierByWave: number[] = []; // tavern tier at the end of each wave (tier is monotonic, so last-write = reached)

  const questStart: Record<string, number> = {}; // first wave each quest was active (acquired), for turns-to-complete
  const recordCompletions = (st: RunState): void => {
    for (const q of st.activeQuests ?? []) {
      // Remember the wave a quest first became active, so completion records the TURNS IT TOOK (elapsed), not the
      // absolute turn it finished on (owner request 2026-07-15).
      if (!(q.questId in questStart)) questStart[q.questId] = st.wave;
      // A one-shot quest flips `completed`; a REPEATABLE never does but bumps `completionCount` on each re-fire.
      // Record the FIRST completion for either (into the existing `questTurns` — no schema change), so repeatables
      // (Forest Grove, Scrap Contract, Imp Census, Dark Bargain, …) count toward completion metrics.
      const done = q.completed || (q.completionCount ?? 0) > 0;
      if (done && !seenCompleted.has(q.questId)) {
        seenCompleted.add(q.questId);
        questTurns[q.questId] = Math.max(0, st.wave - (questStart[q.questId] ?? st.wave)); // turns to complete
      }
    }
  };

  recordCompletions(s);
  tierByWave[s.wave] = s.tier;
  for (const action of replay.actions) {
    const before = s;
    // Shop sightings: each fresh shop-offer instance (by uid) counts once.
    for (const c of before.shop ?? []) {
      if (c.uid && c.cardId && !seenShopUids.has(c.uid)) { seenShopUids.add(c.uid); offeredCards.push(c.cardId); }
    }
    // The right-hand SPELL slot is an offer too — it was invisible to the report (only `shop` was scanned).
    const slot = before.spell;
    if (slot?.uid && slot.cardId && !seenShopUids.has(slot.uid)) { seenShopUids.add(slot.uid); offeredCards.push(slot.cardId); }
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
      // A buy resolves from the shop row OR the right-hand spell slot (the slot was missed before).
      const card = before.shop?.find((c) => c.uid === action.uid) ?? (before.spell?.uid === action.uid ? before.spell : undefined);
      if (card?.cardId) {
        boughtCards.push(card.cardId); // one entry per purchase
        buyEvents.push({ id: card.cardId, wave: before.wave, src: 'shop' }); // wave-tagged for the buy-turn read
      }
    } else if (action.type === 'discover' && before.discover) {
      // A Discover is a one-time 3-card offer resolved right here: count all 3 as seen + the chosen one as taken.
      // Tracked in its OWN streams (not the shop ones) so the report can separate tavern odds from Discover odds.
      for (const id of before.discover) discoverOfferedCards.push(id);
      const picked = before.discover[action.index];
      if (picked) { discoverBoughtCards.push(picked); buyEvents.push({ id: picked, wave: before.wave, src: 'discover' }); }
    }
    recordCompletions(s);
    tierByWave[s.wave] = s.tier;
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
    offeredCards: offeredCards.filter((id) => CARD_INDEX[id]),
    boughtCards: boughtCards.filter((id) => CARD_INDEX[id]),
    discoverOfferedCards: discoverOfferedCards.filter((id) => CARD_INDEX[id]),
    discoverBoughtCards: discoverBoughtCards.filter((id) => CARD_INDEX[id]),
    tierByWave,
    buyEvents: buyEvents.filter((e) => CARD_INDEX[e.id]),
  };
}

// ── CSV export: per-card acquisition analytics (owner ask 2026-07-16) ───────────────────────────────────────

/**
 * Build a per-card CSV over the fetched telemetry rows — the spreadsheet the owner analyzes offline. One row
 * per card that was ever SEEN (shop or Discover), with:
 *  - exposure/acquisition counts split by source + the shop conversion rate,
 *  - WIN-RATE IMPACT: win% of runs that bought it vs win% of runs that SAW it but never bought (the lift),
 *  - buy-turn distribution (avg + per-wave counts, waves 1..17) from the wave-tagged `buyEvents`
 *    (pre-migration rows contribute to the counts/win columns but not the turn columns).
 * Percent columns are 1-dp numbers; blank = no data (never divide by zero).
 */
export function buildCardCsv(rows: RunTelemetry[]): string {
  const MAX_WAVE = 17;
  interface Acc {
    shopSeen: number; shopBought: number; discSeen: number; discPicked: number;
    runsSeen: number; runsBought: number; winsWhenBought: number; seenNotBought: number; winsSeenNotBought: number;
    buyWaves: number[]; // one entry per wave-tagged acquisition
  }
  const acc = new Map<string, Acc>();
  const get = (id: string): Acc => {
    let a = acc.get(id);
    if (!a) { a = { shopSeen: 0, shopBought: 0, discSeen: 0, discPicked: 0, runsSeen: 0, runsBought: 0, winsWhenBought: 0, seenNotBought: 0, winsSeenNotBought: 0, buyWaves: [] }; acc.set(id, a); }
    return a;
  };
  for (const r of rows) {
    for (const id of r.offeredCards) get(id).shopSeen++;
    for (const id of r.boughtCards) get(id).shopBought++;
    for (const id of r.discoverOfferedCards ?? []) get(id).discSeen++;
    for (const id of r.discoverBoughtCards ?? []) get(id).discPicked++;
    for (const e of r.buyEvents ?? []) get(e.id).buyWaves.push(e.wave);
    // Per-RUN presence: seen = offered anywhere; bought = acquired anywhere. Drives the win-rate split.
    const seen = new Set([...r.offeredCards, ...(r.discoverOfferedCards ?? [])]);
    const bought = new Set([...r.boughtCards, ...(r.discoverBoughtCards ?? [])]);
    for (const id of seen) {
      const a = get(id);
      a.runsSeen++;
      if (bought.has(id)) { a.runsBought++; if (r.won) a.winsWhenBought++; }
      else { a.seenNotBought++; if (r.won) a.winsSeenNotBought++; }
    }
    // Bought without a recorded sighting (granted/conjured paths) still counts as a bought run.
    for (const id of bought) {
      if (seen.has(id)) continue;
      const a = get(id);
      a.runsBought++;
      if (r.won) a.winsWhenBought++;
    }
  }
  const pct = (n: number, d: number): string => (d > 0 ? (Math.round((n / d) * 1000) / 10).toString() : '');
  const esc = (v: string): string => (/[",\n]/.test(v) ? `"${v.replace(/"/g, '""')}"` : v);
  const waveCols = Array.from({ length: MAX_WAVE }, (_, i) => `buys_t${i + 1}`);
  const header = ['id', 'name', 'type', 'tribe', 'tier', 'runs_seen', 'runs_bought', 'win_pct_when_bought',
    'win_pct_seen_not_bought', 'win_lift_pct', 'shop_seen', 'shop_bought', 'shop_conversion_pct',
    'discover_seen', 'discover_picked', 'avg_buy_turn', ...waveCols];
  const lines = [header.join(',')];
  const ids = [...acc.keys()].sort((x, y) => (acc.get(y)!.runsBought - acc.get(x)!.runsBought) || x.localeCompare(y));
  for (const id of ids) {
    const def = CARD_INDEX[id];
    if (!def || def.token) continue; // skip tokens/rewards that leak in — the sheet is the buyable pool
    const a = acc.get(id)!;
    const withPct = pct(a.winsWhenBought, a.runsBought);
    const withoutPct = pct(a.winsSeenNotBought, a.seenNotBought);
    const lift = withPct !== '' && withoutPct !== '' ? (Math.round((Number(withPct) - Number(withoutPct)) * 10) / 10).toString() : '';
    const avgTurn = a.buyWaves.length > 0 ? (Math.round((a.buyWaves.reduce((s2, w) => s2 + w, 0) / a.buyWaves.length) * 10) / 10).toString() : '';
    const perWave = Array.from({ length: MAX_WAVE }, (_, i) => a.buyWaves.filter((w) => w === i + 1).length.toString());
    lines.push([
      id, esc(def.name), def.spell ? 'spell' : 'minion', def.tribe, String(def.tier),
      String(a.runsSeen), String(a.runsBought), withPct, withoutPct, lift,
      String(a.shopSeen), String(a.shopBought), pct(a.shopBought, a.shopSeen),
      String(a.discSeen), String(a.discPicked), avgTurn, ...perWave,
    ].join(','));
  }
  return lines.join('\n');
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
  /** Quests only — average number of turns a completed quest took (completion wave − first-active wave). */
  avgTurns: number | null;
  /** Cards only — the offered/picked totals split by SOURCE, so the report separates tavern odds from Discover
   *  odds. `offered`/`picked` above stay the combined totals (used for ranking). 0 on non-card rows. */
  shopOffered: number;
  shopPicked: number;
  discoverOffered: number;
  discoverPicked: number;
}

/** The shop-leveling curve: average tavern tier reached by each wave, split by outcome. `won`/`lost` are indexed
 *  by wave (index 0 unused); a null slot = no runs reached that wave. Feeds the Balance Report's curve chart. */
export interface ShopCurve {
  maxWave: number;
  wonRuns: number;
  lostRuns: number;
  won: (number | null)[];
  lost: (number | null)[];
  /** Average wave at which a run first REACHES each tavern tier, indexed by tier (1..6; index 0 unused). T1 is
   *  always wave 1 (a given). A null slot = no run reached that tier. Shown beside the Y-axis tier labels. */
  avgWaveToTier: (number | null)[];
}

/** The finished player report: five ranked tables + the shop-leveling curve + the run count behind them. */
export interface PlayerReport {
  totalRuns: number;
  heroes: PlayerReportRow[];
  quests: PlayerReportRow[];
  runes: PlayerReportRow[];
  minions: PlayerReportRow[];
  spells: PlayerReportRow[];
  shopCurve: ShopCurve;
}

/** Average the per-run `tierByWave` arrays into two mean curves (won runs vs lost runs), indexed by wave. */
function aggregateShopCurve(rows: RunTelemetry[]): ShopCurve {
  const sum = { won: [] as number[], lost: [] as number[] };
  const cnt = { won: [] as number[], lost: [] as number[] };
  let maxWave = 0;
  for (const r of rows) {
    const bucket = r.won ? 'won' : 'lost';
    const t = r.tierByWave ?? [];
    for (let w = 1; w < t.length; w++) {
      const tier = t[w];
      if (tier == null) continue;
      sum[bucket][w] = (sum[bucket][w] ?? 0) + tier;
      cnt[bucket][w] = (cnt[bucket][w] ?? 0) + 1;
      if (w > maxWave) maxWave = w;
    }
  }
  const mean = (b: 'won' | 'lost'): (number | null)[] => {
    const out: (number | null)[] = [];
    for (let w = 1; w <= maxWave; w++) out[w] = cnt[b][w] ? Math.round((sum[b][w]! / cnt[b][w]!) * 100) / 100 : null;
    return out;
  };
  // Average wave a run first reaches each tier (2..6) — the first wave whose recorded tier ≥ the target, averaged
  // over the runs that got there. T1 is a given (wave 1). Feeds the Y-axis "avg turn to reach this tavern" labels.
  const tierSum: number[] = [];
  const tierCnt: number[] = [];
  for (const r of rows) {
    const t = r.tierByWave ?? [];
    for (let tier = 2; tier <= 6; tier++) {
      let firstWave: number | null = null;
      for (let w = 1; w < t.length; w++) {
        if (t[w] != null && t[w]! >= tier) { firstWave = w; break; }
      }
      if (firstWave != null) { tierSum[tier] = (tierSum[tier] ?? 0) + firstWave; tierCnt[tier] = (tierCnt[tier] ?? 0) + 1; }
    }
  }
  const avgWaveToTier: (number | null)[] = [];
  for (let tier = 1; tier <= 6; tier++) {
    avgWaveToTier[tier] = tier === 1 ? 1 : (tierCnt[tier] ? Math.round((tierSum[tier]! / tierCnt[tier]!) * 10) / 10 : null);
  }
  return {
    maxWave,
    wonRuns: rows.filter((r) => r.won).length,
    lostRuns: rows.filter((r) => !r.won).length,
    won: mean('won'),
    lost: mean('lost'),
    avgWaveToTier,
  };
}

interface Acc {
  offered: number; // runs this was offered in
  picked: number; // runs this was picked in
  games: number; // runs picked (= games played with it)
  won: number; // won runs among picked
  winsSum: number; // Σ scored wins among picked (hero avg wins)
  turnsSum: number; // Σ turns-to-complete among picked+completed (quest avg turns)
  turnsCount: number;
  shopOffered: number; // cards only — sightings/buys split by source (shop vs Discover)
  shopPicked: number;
  discOffered: number;
  discPicked: number;
}
const blankAcc = (): Acc => ({ offered: 0, picked: 0, games: 0, won: 0, winsSum: 0, turnsSum: 0, turnsCount: 0, shopOffered: 0, shopPicked: 0, discOffered: 0, discPicked: 0 });
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
    shopOffered: a.shopOffered, shopPicked: a.shopPicked,
    discoverOffered: a.discOffered, discoverPicked: a.discPicked,
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

    // Cards: offer = seen, pick = acquired. No win credit (per spec). Split minion vs spell AND shop vs Discover —
    // `offered`/`picked` accumulate the combined total (for ranking); the shop*/disc* fields track each source.
    for (const id of r.offeredCards) { const def = CARD_INDEX[id]; if (def) { const a = bump(def.spell ? spells : minions, id); a.offered++; a.shopOffered++; } }
    for (const id of r.boughtCards) { const def = CARD_INDEX[id]; if (def) { const a = bump(def.spell ? spells : minions, id); a.picked++; a.games++; a.shopPicked++; } }
    for (const id of r.discoverOfferedCards ?? []) { const def = CARD_INDEX[id]; if (def) { const a = bump(def.spell ? spells : minions, id); a.offered++; a.discOffered++; } }
    for (const id of r.discoverBoughtCards ?? []) { const def = CARD_INDEX[id]; if (def) { const a = bump(def.spell ? spells : minions, id); a.picked++; a.games++; a.discPicked++; } }
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
    shopCurve: aggregateShopCurve(rows),
  };
}
