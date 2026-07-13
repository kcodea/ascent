/**
 * Dev balance report (owner request 2026-07-13) — runs many seeded bot games across every pickable hero and
 * tallies OFFER rate, PICK rate, and WIN rate for heroes, quests, runes, minions, and spells. Run with:
 *   npm run report            (default games/hero)
 *   npm run report -- 60      (60 games per hero)
 *
 * Method + caveats (logged, not hidden):
 *  - The bot is the same greedy naive policy as `npm run bot`: it plays/buys the FIRST legal option and takes
 *    quest/rune/Discover index 0. So OFFER rate + WIN rate are meaningful signals; PICK rate reflects the BOT's
 *    (dumb) policy, not human choice — read it as "how often the greedy bot grabbed it when shown", not a verdict.
 *  - Minion/spell WIN rate is CORRELATIONAL: a card is one of up to 7 on a winning board, so "win rate when on the
 *    final board" credits the whole board, not the card alone. Treat it as a soft co-occurrence signal.
 *  - Everything is seeded + deterministic; re-running the same game count reproduces the report exactly.
 */
import { CONFIG, createRun, reduce, HEROES } from '@game/sim';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';

interface Tally { offered: number; picked: number; games: number; wins: number }
const blank = (): Tally => ({ offered: 0, picked: 0, games: 0, wins: 0 });
const bump = (m: Map<string, Tally>, key: string, field: keyof Tally, n = 1): void => {
  const t = m.get(key) ?? blank();
  t[field] += n;
  m.set(key, t);
};

const heroT = new Map<string, Tally>();
const questT = new Map<string, Tally>();
const runeT = new Map<string, Tally>();
const minionT = new Map<string, Tally>();
const spellT = new Map<string, Tally>();

/** Play one full run with a fixed hero, recording every offer + pick, then credit the win/loss. */
function playAndRecord(seed: number, heroId: string): void {
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
  bump(heroT, heroId, 'games'); if (won) bump(heroT, heroId, 'wins');
  // Quests / runes: offered + picked per run, credited with the run's outcome when picked.
  const credit = (m: Map<string, Tally>, offered: Set<string>, picked: Set<string>): void => {
    for (const id of offered) bump(m, id, 'offered');
    for (const id of picked) { bump(m, id, 'picked'); bump(m, id, 'games'); if (won) bump(m, id, 'wins'); }
  };
  credit(questT, offeredQuests, pickedQuests);
  credit(runeT, offeredRunes, pickedRunes);
  // Minions + spells: split the offered/bought pools by spell-ness. WIN credit goes to the FINAL board (minions
  // that survived to the end of a winning run) — a soft co-occurrence signal.
  const finalBoard = new Set(s.board.map((c) => c.cardId));
  for (const id of offeredCards) {
    const def = CARD_INDEX[id]; if (!def) continue;
    bump(def.spell ? spellT : minionT, id, 'offered');
  }
  for (const id of boughtCards) bump(CARD_INDEX[id]?.spell ? spellT : minionT, id, 'picked');
  for (const id of finalBoard) { const m = CARD_INDEX[id]?.spell ? spellT : minionT; bump(m, id, 'games'); if (won) bump(m, id, 'wins'); }
}

const GAMES = Math.max(1, Number(process.argv[2] ?? 30) | 0);
const pickable = HEROES.filter((h) => !h.wip);
console.log(`\n=== ASCENT — dev balance report ===`);
console.log(`${GAMES} games/hero × ${pickable.length} heroes = ${GAMES * pickable.length} runs (greedy bot; see header caveats)\n`);

const mix = (a: number, b: number): number => ((a * 73856093) ^ (b * 19349663)) >>> 0;
for (let h = 0; h < pickable.length; h++) {
  for (let g = 0; g < GAMES; g++) playAndRecord(mix(h + 1, g + 1), pickable[h]!.id);
}

const pct = (n: number, d: number): string => (d === 0 ? '  –  ' : `${((100 * n) / d).toFixed(0).padStart(3)}%`);
const nameOfHero = (id: string): string => HEROES.find((h) => h.id === id)?.name ?? id;

function table(title: string, m: Map<string, Tally>, nameOf: (id: string) => string, opts: { offerRateDen?: number } = {}): void {
  console.log(`── ${title} ──`);
  const rows = [...m.entries()].map(([id, t]) => ({ id, ...t }));
  // Sort by win rate (games desc as tiebreak), most-winning first.
  rows.sort((a, b) => (b.games ? b.wins / b.games : -1) - (a.games ? a.wins / a.games : -1) || b.games - a.games);
  const den = opts.offerRateDen;
  console.log(`  ${'name'.padEnd(26)} ${'offer'.padStart(6)} ${'pick'.padStart(6)} ${'win'.padStart(6)}  (n)`);
  for (const r of rows) {
    const offer = den ? pct(r.offered, den) : String(r.offered).padStart(5);
    const pick = r.offered > 0 ? pct(r.picked, r.offered) : '  –  ';
    const win = pct(r.wins, r.games);
    console.log(`  ${nameOf(r.id).slice(0, 26).padEnd(26)} ${offer.padStart(6)} ${pick.padStart(6)} ${win.padStart(6)}  (${r.games})`);
  }
  console.log('');
}

// Heroes: no "offer/pick" (each is played a fixed number of games); show win rate only.
console.log(`── heroes (win rate over ${GAMES} games each) ──`);
[...heroT.entries()].sort((a, b) => (b[1].wins / b[1].games) - (a[1].wins / a[1].games))
  .forEach(([id, t]) => console.log(`  ${nameOfHero(id).slice(0, 26).padEnd(26)} ${pct(t.wins, t.games)}  (${t.wins}/${t.games})`));
console.log('');

const TOTAL_RUNS = GAMES * pickable.length;
table('quests (offer = % of runs offered · pick = greedy-bot take · win = when picked)', questT, (id) => QUEST_INDEX[id]?.name ?? id, { offerRateDen: TOTAL_RUNS });
table('runes (offer = % of runs offered · win = when picked)', runeT, (id) => RUNE_INDEX[id]?.name ?? id, { offerRateDen: TOTAL_RUNS });
table('minions (offer = % of runs seen in shop · pick = bought/seen · win = when on final board)', minionT, (id) => CARD_INDEX[id]?.name ?? id, { offerRateDen: TOTAL_RUNS });
table('spells (offer = % of runs seen in shop · pick = bought/seen · win = when on final board)', spellT, (id) => CARD_INDEX[id]?.name ?? id, { offerRateDen: TOTAL_RUNS });
