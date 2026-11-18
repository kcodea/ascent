// The Career chart capture (its own file: it needs made-up match history, since a guest has none).
//
// Run it with a DEAD local backend address, so the Career page believes a backend exists (without one it shows the
// offline state) while nothing can answer:
//   CAPTURE_BACKEND=http://127.0.0.1:9 CAPTURE_BACKEND_KEY=capture node apps/site/scripts/capture.mjs career-chart
//
// The history is made up, the boards are not: each game's final board and runes come from the game's own bot playing
// a real run of the live card set in the page (`createRun` + a bot policy + `snapshotBoard`), so every card id, stat
// and rune is one the game really produced. Only the dates, placements, records and ratings are invented here. The
// rows go into the store's career cache under a stand-in account id; the page's own refresh finds no session, asks
// nothing, and keeps them.
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const REPO = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../../..').split(path.sep).join('/');
const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

const rectOf = (p, sel, nth = 0) => p.ev(([s, n]) => { const e = document.querySelectorAll(s)[n]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height, left: r.x, top: r.y }; }, [sel, nth]);
async function moveTo(p, at, steps = 14) { await p.page.mouse.move(at.x, at.y, { steps }); }
async function click(p, at) { await moveTo(p, at); await sleep(220); await p.page.mouse.down(); await sleep(70); await p.page.mouse.up(); }
/** Glide the pointer from `from` to `to` in `ms` of real time (eased), so the clip's pace does not depend on the machine. */
async function glide(p, from, to, ms) {
  const t0 = Date.now();
  for (;;) {
    const t = Math.min(1, (Date.now() - t0) / ms);
    const e = t * t * (3 - 2 * t);
    await p.page.mouse.move(from.x + (to.x - from.x) * e, from.y + (to.y - from.y) * e);
    if (t >= 1) return;
    await sleep(12);
  }
}

/** Placements, oldest game first. EARLIER: the period before the chart's 30 days (it feeds the "against the period
 *  before" figures). RECENT: the 30 days on the chart, a climb with two rough patches. */
const EARLIER = [6, 4, 7, 5, 3, 8, 5, 6, 2, 4];
const RECENT = [3, 5, 2, 4, 6, 1, 3, 2, 7, 5, 4, 1, 3, 8, 6, 7, 2, 3, 1, 4, 5, 2, 3, 6, 8, 7, 4, 2, 1, 3, 5, 2, 1, 4, 3, 2];
/** How many games before the pinned one the pointer joins the line. */
const LEAD = 10;
/** Rank points a placement moves (1st to 8th). */
const POINTS = [0, 34, 26, 18, 10, -10, -20, -28, -36];
const START_MMR = 560;

/** Build the made-up career in the page. Returns a summary for the log and which recent game to pin. */
function buildCareer([earlier, recent, points, startMmr, repo]) {
  return (async () => {
    // The SAME module instance the game runs: its URL is read out of a served game module that imports it.
    const src = await (await fetch(`/@fs/${repo}/packages/ui/src/careerTrends.tsx`)).text();
    const url = /from\s+"([^"]*\/packages\/sim\/src\/index\.ts[^"]*)"/.exec(src)?.[1];
    if (!url) throw new Error('sim module address not found');
    const sim = await import(/* @vite-ignore */ url);
    const heroes = sim.playableHeroes().map((h) => h.id);
    const bots = [sim.BOT_BY_ID.midrange, sim.BOT_BY_ID.tempo, sim.BOT_BY_ID.greedy].filter(Boolean);
    const t0 = performance.now();
    // A small roster of mains, so the Heroes read is "several heroes", not a different one every game.
    const mains = [0, 3, 7, 11, 16, 20].map((i) => heroes[i % heroes.length]);
    const now = Date.now();
    const DAY = 86_400_000;
    const placements = [...earlier, ...recent];
    const n = placements.length;
    let mmr = startMmr;
    let peak = mmr;
    const runs = [];
    for (let i = 0; i < n; i++) {
      const place = placements[i];
      const heroId = mains[(i * 5 + (i >> 2)) % mains.length];
      // Winners play longer: the round the bot's run is stopped at follows the placement.
      const wave = Math.max(7, 15 - place + (i % 2));
      // Up to six bot runs per game; the fullest, strongest final board is the one kept.
      let seed = 0, board = null, tribe = null;
      for (let k = 0; k < 6 && !(board && board.minions.length === 7); k++) {
        const trySeed = 9100 + i * 137 + k * 7919;
        let s = sim.createRun(trySeed, heroId);
        const bot = bots[(i + k) % bots.length];
        let steps = 0;
        while (s.phase !== 'gameover' && s.phase !== 'victory' && s.wave <= wave && steps++ < 20000) {
          const next = sim.reduce(s, bot.act(s));
          if (next !== s) { s = next; continue; }
          if (s.phase === 'combat') s = sim.reduce(s, { type: 'resolveCombat' });
          else if (s.phase === 'recruit') s = sim.reduce(s, { type: 'faceOmen' });
          else break;
        }
        const snap = JSON.parse(JSON.stringify(sim.snapshotBoard(s)));
        if (!board || snap.minions.length > board.minions.length || (snap.minions.length === board.minions.length && snap.power > board.power)) { board = snap; seed = trySeed; tribe = sim.dominantBoardTribe(s); }
      }
      const before = mmr;
      mmr = Math.max(0, mmr + points[place]);
      peak = Math.max(peak, mmr);
      // The earlier games sit 31 to 52 days back; the recent ones are spread evenly over the last 27 days (always in
      // order, so the chart's points are the games in this list's order).
      const r = i - earlier.length;
      const back = r < 0 ? 31.5 + ((earlier.length - 1 - i) / (earlier.length - 1)) * 20 : ((recent.length - 1 - r) / (recent.length - 1)) * 27;
      const atMs = now - back * DAY - (((i * 37) % 150) + 40) * 60_000;
      const wins = Math.max(2, Math.round((9 - place) * 1.1) + (i % 2));
      const losses = Math.max(1, place - 1 + (i % 3 === 0 ? 1 : 0));
      const minutes = 17 + (i % 9);
      runs.push({
        id: 5000 + i, heroId, at: new Date(atMs).toISOString(), atMs, wave: board.wave, wins, losses, draws: i % 7 === 0 ? 1 : 0,
        placement: place, goldSpent: 90 + board.wave * 9 + (i % 5) * 4, apt: 9 + (i % 6) * 0.8,
        ratingDelta: mmr - before, ratingAfter: mmr, seed, dominantTribe: tribe, mode: 'lobby', board, detailed: true,
        runes: Array.isArray(board.runes) ? board.runes : [], replayRowId: null,
        durationMs: minutes * 60_000, activeMs: minutes * 60_000, lobbyStrength: null, boardStrength: null, match: null,
        rank: Math.floor(before / 100),
      });
    }
    // The game to pin: a 1st or 2nd place among the last dozen (not the final three, so the line runs on past it),
    // with a full board and at least two runes: the highest rated of those (high on the chart, so the pinned game
    // sits above the chart instead of over it).
    let pin = -1;
    for (let r = recent.length - 12; r <= recent.length - 4; r++) {
      const run = runs[earlier.length + r];
      if (run.placement > 2 || run.board.minions.length < 7 || run.runes.length < 2) continue;
      if (pin < 0 || run.ratingAfter > runs[earlier.length + pin].ratingAfter) pin = r;
    }
    const pinned = pin >= 0 ? runs[earlier.length + pin] : null;
    runs.reverse(); // the page holds them newest first
    const g = window.useGame;
    const st = g.getState();
    const pos = (v) => ({ divisionIndex: Math.floor(v / 100), points: v % 100 });
    g.setState({
      account: { ...st.account, anonymous: false, userId: 'local-stub', discriminator: '0001' },
      profile: { ...st.profile, rating: mmr, highestRating: peak, rank: { ...st.profile.rank, position: pos(mmr), highest: pos(peak) } },
    });
    const s2 = g.getState();
    s2.setCareerCache(`local-stub|${s2.careerVersion}`, runs);
    return {
      pin, n: runs.length, mmr, peak, ms: Math.round(performance.now() - t0), sizes: runs.map((r) => r.board.minions.length).join(''),
      heroes: [...new Set(runs.map((r) => r.heroId))], noRunes: runs.filter((r) => !r.runes.length).length,
      pinned: pinned && { hero: pinned.heroId, wave: pinned.wave, place: pinned.placement, minions: pinned.board.minions.map((m) => `${m.cardId} ${m.attack}/${m.health}`), runes: pinned.runes },
    };
  })();
}

export const careerChart = {
  async run(p) {
    const made = await p.ev(buildCareer, [EARLIER, RECENT, POINTS, START_MMR, REPO]);
    console.log('CAREER', JSON.stringify(made));
    if (made.pin < 0) throw new Error('no recent game fits the pin (a full board, two runes, 1st or 2nd)');
    // The corner dock is left as a hollow box once the rig hides its dev tools: out of frame entirely.
    await p.ev(() => { const st = document.createElement('style'); st.textContent = '.ph-dock { visibility: hidden !important; }'; document.head.append(st); });
    await p.ev(() => window.useGame.getState().goTo('career'));
    await sleep(2500);
    await p.shot('career-open');
    const tabs = await p.ev(() => [...document.querySelectorAll('.phk-tabs .phk-tab')].map((b) => { const r = b.getBoundingClientRect(); return { t: b.textContent.trim(), x: r.x + r.width / 2, y: r.y + r.height / 2 }; }));
    const trends = tabs.find((t) => /^trends$/i.test(t.t));
    if (!trends) throw new Error('no Trends tab');
    await click(p, trends);
    await sleep(2000);
    const chart = await rectOf(p, '.ct-panel[data-kind="mmr"] .ct-mmr');
    if (!chart) throw new Error('no MMR chart');
    // Where the chart draws game `i` of the window (careerTrends.tsx: MW 284, ML 6, MR 70).
    const n = RECENT.length;
    const xOf = (i) => chart.left + ((6 + (i / (n - 1)) * (284 - 6 - 70)) / 284) * chart.w;
    const y = chart.top + chart.h * 0.55;
    const join = { x: xOf(made.pin - LEAD), y };
    const from = { x: join.x - 40, y: y + 170 };
    const rest = { x: xOf(made.pin), y: y - 30 };
    await moveTo(p, from);
    await sleep(900);
    await p.shot('trends');
    const start = p.now();
    await sleep(300);
    // Onto the line, then along it (the crosshair follows), coming to rest on the game to pin.
    await glide(p, from, join, 550);
    await sleep(250);
    await glide(p, join, rest, 2000);
    await sleep(650);
    await p.page.mouse.down(); await sleep(70); await p.page.mouse.up();
    await sleep(800);
    const tip = await p.ev(() => { const t = document.querySelector('.atip.ct-pinned'); if (!t) return null; const r = t.getBoundingClientRect(); return { x: r.x, y: r.y, w: r.width, h: r.height, board: t.querySelectorAll('.ct-pinboard img').length, runes: t.querySelectorAll('.ct-pinrunes > *').length, text: t.querySelector('.ct-headline')?.textContent }; });
    console.log('TIP', JSON.stringify(tip));
    if (!tip || !tip.board || !tip.runes) throw new Error('the pinned game did not show its board and runes');
    await glide(p, rest, { x: rest.x + 46, y: rest.y + 92 }, 450); // off the point, so the pinned dot is seen
    await sleep(2300);
    // The recording only gets a frame when the picture changes: a last small pointer drift closes the still hold.
    await glide(p, { x: rest.x + 46, y: rest.y + 92 }, { x: rest.x + 50, y: rest.y + 96 }, 300);
    await sleep(150);
    const end = p.now() - 0.1;
    await p.shot('pinned');
    // Frame: the pinned game above, the MMR and Placement charts whole beneath it (16:9).
    const panels = await p.ev(() => ['mmr', 'place'].map((k) => { const r = document.querySelector('.ct-panel[data-kind="' + k + '"]').getBoundingClientRect(); return { l: r.left, t: r.top, r: r.right, b: r.bottom }; }));
    const left = Math.min(tip.x - (rest.x - join.x), panels[0].l) - 14; // room for the tips of the games passed on the way
    const right = Math.max(tip.x + tip.w, panels[1].r) + 14;
    const w = Math.round(right - left) & ~1;
    const h = Math.round((w * 9) / 16) & ~1;
    const crop = { x: Math.max(0, Math.round(left)), y: Math.max(0, Math.round(tip.y - 14)), w, h };
    console.log('CROP', JSON.stringify(crop));
    return { start, end, still: end - 0.4, crop };
  },
};
