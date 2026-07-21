/**
 * Deep balance analysis (owner ask 2026-07-21). Runs every bot pilot across every pickable hero and mines the
 * finished runs for a rich, cross-pilot read: best/worst/most-balanced minions + spells, comps (by board tribe
 * mix), card-pair synergies, quests (win rate + average turns-to-complete), runes, and heroes.
 *
 * Beyond `npm run report` (which is per-bot offer/pick/win): this aggregates ALL pilots into one dataset and
 * adds comp / synergy / quest-turn tracking the report doesn't have. Deterministic — same seeds reproduce it.
 *
 *   npm run analyze            (default 30 games/hero/bot)
 *   npm run analyze -- 20      (20 games/hero/bot)
 *
 * SPELL TABLES: usable as of 2026-07-21. They were empty because the tavern's spell offer lives in
 * `state.spell` (a dedicated slot) and the bot turn engine only read `state.shop` — so bots never saw a spell
 * to buy. The engine now reads both and values spells by what they DO; spell n is still smaller than minion n
 * (one offer per shop vs several), so treat thin rows with the usual care. Rune n is also small
 * (turn-6 only). And every win% credits the whole final board (co-occurrence), so read it as a package signal,
 * not isolated card power (ablation would be cleaner). The data also reflects what the BOTS can pilot — the
 * Demon-Consume package tops everything partly because it's the most mechanical for a bot to assemble.
 */
import { createRun, reduce, pickableReportHeroes, mixReportSeed, BOTS, type BotPolicy } from '@game/sim';
import { CARD_INDEX, QUEST_INDEX, RUNE_INDEX } from '@game/content';

const GAMES = Math.max(1, Number(process.argv[2] ?? 30) | 0);

// ---- accumulators ----
interface WL { games: number; wins: number }
const wl = (): WL => ({ games: 0, wins: 0 });
const add = (m: Map<string, WL>, k: string, won: boolean): void => { const t = m.get(k) ?? wl(); t.games++; if (won) t.wins++; m.set(k, t); };

const card = new Map<string, WL>();          // a card on the FINAL board → run outcome
const hero = new Map<string, WL>();
const rune = new Map<string, WL>();
const comp = new Map<string, WL>();          // dominant board tribe → outcome
const pair = new Map<string, WL>();          // unordered card pair on the final board → outcome
const quest = new Map<string, WL>();         // quest picked → outcome (when picked)
const questTurns = new Map<string, { done: number; sumWave: number }>(); // completion wave tally

const perBot = new Map<string, WL>();

/** Play one run under `policy`, mirroring playAndRecordInto's loop, but mining the extra signals. */
function analyzeRun(seed: number, heroId: string, policy: BotPolicy): void {
  let s = createRun(seed, heroId);
  const pickedQuests = new Set<string>();
  const pickedRunes = new Set<string>();
  const boughtCards = new Set<string>();
  const questSeenDone = new Set<string>();  // quests whose completion wave we've already recorded

  let steps = 0;
  while (s.phase !== 'gameover' && s.phase !== 'victory' && steps++ < 100000) {
    // Record quest completions as they happen (wave = "turns to complete").
    for (const aq of s.activeQuests ?? []) {
      const done = aq.completed || (aq.completionCount ?? 0) > 0;
      if (done && !questSeenDone.has(aq.questId)) {
        questSeenDone.add(aq.questId);
        const t = questTurns.get(aq.questId) ?? { done: 0, sumWave: 0 };
        t.done++; t.sumWave += s.wave;
        questTurns.set(aq.questId, t);
      }
    }
    const action = policy.act(s);
    if (action.type === 'buyQuest' && s.questOffer?.[action.index]) pickedQuests.add(s.questOffer[action.index]!);
    else if (action.type === 'buyRune' && s.runeforgeOffer?.[action.index]) pickedRunes.add(s.runeforgeOffer[action.index]!);
    else if (action.type === 'buy') { const o = s.shop.find((x) => x.uid === action.uid); if (o) boughtCards.add(o.cardId); }
    const n = reduce(s, action);
    if (n !== s) { s = n; continue; }
    if (s.phase === 'combat') s = reduce(s, { type: 'resolveCombat' });
    else if (s.phase === 'recruit') s = reduce(s, { type: 'faceOmen' });
    else break;
  }

  const won = s.phase === 'victory';
  add(hero, heroId, won);
  add(perBot, policy.id, won);
  for (const id of pickedQuests) add(quest, id, won);
  for (const id of pickedRunes) add(rune, id, won);

  // Final board: card outcomes, comp (dominant tribe), pair synergies.
  const board = s.board.map((c) => c.cardId);
  const uniq = [...new Set(board)];
  for (const id of uniq) if (!CARD_INDEX[id]?.spell) add(card, id, won); // minions: fought on the final board
  for (const id of boughtCards) if (CARD_INDEX[id]?.spell) add(card, id, won); // spells: consumed on cast, so credit the BUY

  const tribes = new Map<string, number>();
  for (const c of s.board) { const t = c.tribe; if (t && t !== 'neutral') tribes.set(t, (tribes.get(t) ?? 0) + 1); }
  let dom = 'neutral', domN = 0;
  for (const [t, n2] of tribes) if (n2 > domN) { domN = n2; dom = t; }
  add(comp, domN >= 3 ? `${dom} (${domN}+)` : 'no dominant tribe', won);

  for (let i = 0; i < uniq.length; i++) for (let j = i + 1; j < uniq.length; j++) {
    const [a, b] = [uniq[i]!, uniq[j]!].sort();
    add(pair, `${a}|${b}`, won);
  }
}

// ---- run every pilot × hero × game ----
const heroes = pickableReportHeroes();
for (const bot of BOTS) {
  for (let h = 0; h < heroes.length; h++) {
    for (let g = 0; g < GAMES; g++) analyzeRun(mixReportSeed(h + 1, g + 1), heroes[h]!.id, bot);
  }
}
const totalRuns = BOTS.length * heroes.length * GAMES;

// ---- reporting helpers ----
const nameCard = (id: string): string => CARD_INDEX[id]?.name ?? id;
const rate = (t: WL): number => (t.games ? Math.round((100 * t.wins) / t.games) : 0);
const overall = (m: Map<string, WL>): number => { let g = 0, w = 0; for (const t of m.values()) { g += t.games; w += t.wins; } return g ? (100 * w) / g : 0; };

function rank(m: Map<string, WL>, minN: number, name: (k: string) => string): { id: string; name: string; rate: number; n: number }[] {
  return [...m.entries()].filter(([, t]) => t.games >= minN).map(([id, t]) => ({ id, name: name(id), rate: rate(t), n: t.games })).sort((a, b) => b.rate - a.rate || b.n - a.n);
}
function show(title: string, rows: { name: string; rate: number; n: number }[], k: number): void {
  console.log(`\n── ${title} ──`);
  for (const r of rows.slice(0, k)) console.log(`  ${r.name.slice(0, 28).padEnd(28)} ${String(r.rate).padStart(3)}%  (n=${r.n})`);
}

console.log(`\n=== ASCENT — deep balance analysis ===`);
console.log(`${GAMES} games/hero × ${heroes.length} heroes × ${BOTS.length} pilots = ${totalRuns} runs\n`);
console.log(`── win rate by pilot ──`);
for (const b of BOTS) { const t = perBot.get(b.id)!; console.log(`  ${b.name.padEnd(12)} ${String(rate(t)).padStart(3)}%  (${t.wins}/${t.games})`); }
console.log(`\n  overall board-appearance win baseline: ${overall(card).toFixed(1)}%`);

// Split cards into minions vs spells.
const isSpell = (id: string): boolean => !!CARD_INDEX[id]?.spell;
const minionRank = rank(new Map([...card].filter(([id]) => !isSpell(id))), 25, nameCard);
const spellRank = rank(new Map([...card].filter(([id]) => isSpell(id))), 6, nameCard);
const base = overall(card);

show('BEST minions (win% on final board)', minionRank, 20);
show('WORST minions', [...minionRank].reverse(), 20);
show('BEST spells', spellRank, 15);
show('WORST spells', [...spellRank].reverse(), 15);

// Well-balanced = win% closest to the overall baseline (with enough n).
const balanced = minionRank.map((r) => ({ ...r, dist: Math.abs(r.rate - base) })).sort((a, b) => a.dist - b.dist || b.n - a.n);
show(`MOST BALANCED minions (closest to ${base.toFixed(0)}% baseline)`, balanced, 20);

show('BEST comps (dominant board tribe)', rank(comp, 30, (k) => k), 12);
show('WORST comps', [...rank(comp, 30, (k) => k)].reverse(), 12);

const pairName = (k: string): string => k.split('|').map(nameCard).join(' + ');
show('BEST synergies (card pairs on final board)', rank(pair, 25, pairName), 15);
show('WORST synergies', [...rank(pair, 25, pairName)].reverse(), 15);

show('BEST heroes', rank(hero, 20, (id) => heroes.find((h) => h.id === id)?.name ?? id), 12);
show('WORST heroes', [...rank(hero, 20, (id) => heroes.find((h) => h.id === id)?.name ?? id)].reverse(), 12);

show('BEST runes (win% when taken)', rank(rune, 15, (id) => RUNE_INDEX[id]?.name ?? id), 15);
show('WORST runes', [...rank(rune, 15, (id) => RUNE_INDEX[id]?.name ?? id)].reverse(), 15);

// Quests: win% when picked + average turns-to-complete.
console.log(`\n── QUESTS — win% when taken · avg turns to complete ──`);
const qRows = [...quest.entries()].filter(([, t]) => t.games >= 15).map(([id, t]) => {
  const qt = questTurns.get(id);
  const avg = qt && qt.done ? (qt.sumWave / qt.done).toFixed(1) : '—';
  return { name: QUEST_INDEX[id]?.name ?? id, rate: rate(t), n: t.games, avg, done: qt?.done ?? 0 };
}).sort((a, b) => b.rate - a.rate || b.n - a.n);
console.log('  BEST:');
for (const r of qRows.slice(0, 15)) console.log(`  ${r.name.slice(0, 26).padEnd(26)} ${String(r.rate).padStart(3)}%  (n=${r.n})  ~${r.avg} turns`);
console.log('  WORST:');
for (const r of [...qRows].reverse().slice(0, 15)) console.log(`  ${r.name.slice(0, 26).padEnd(26)} ${String(r.rate).padStart(3)}%  (n=${r.n})  ~${r.avg} turns`);
console.log('');
