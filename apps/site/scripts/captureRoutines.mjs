// One routine per capture slot. Each drives a fresh guest player to its moment and returns
// { start, end, crop?, still? } in seconds of recording (crop in 1920x1080 source pixels).
import { careerChart } from './captureCareer.mjs';

const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

/** Start a Practice run from the store (skips the setup screens), pick the first hero, wait for the shop. */
async function startPractice(p) {
  await p.ev(() => {
    const g = window.useGame.getState();
    g.setPracticeDraft({ timeMult: 1 });
    g.startPractice();
    window.useGame.getState().confirmPracticeSetup();
  });
  await p.page.waitForFunction(() => !!window.useGame.getState().heroChoices, null, { timeout: 30000 });
  await p.ev(() => { const g = window.useGame.getState(); g.pickHero(g.heroChoices[0]); });
  await p.page.waitForFunction(() => { const g = window.useGame.getState(); return !g.showTitle && !g.heroChoices && g.run.phase === 'recruit'; }, null, { timeout: 60000 });
  await sleep(6000); // the opening banner
}

const rectOf = (p, sel, nth = 0) => p.ev(([s, n]) => { const e = document.querySelectorAll(s)[n]; if (!e) return null; const r = e.getBoundingClientRect(); return { x: r.x + r.width / 2, y: r.y + r.height / 2, w: r.width, h: r.height }; }, [sel, nth]);
const byText = (p, re, scope = 'body') => p.ev(([r0, sc]) => { const r = new RegExp(r0, 'i'); const b = [...document.querySelectorAll(`${sc} button, ${sc} [role=button]`)].filter((x) => x.getBoundingClientRect().width > 0 && getComputedStyle(x).visibility !== 'hidden').find((x) => r.test(`${x.getAttribute('aria-label') || ''} ${x.textContent.trim()}`)); if (!b) return null; const q = b.getBoundingClientRect(); return { x: q.x + q.width / 2, y: q.y + q.height / 2 }; }, [re, scope]);
const gold = (p, n) => p.ev((v) => window.useGame.setState((s) => ({ run: { ...s.run, embers: v } })), n);
const run = (p) => p.ev(() => { const r = window.useGame.getState().run; return { board: r.board.length, hand: r.hand.length, spent: r.goldSpentThisTurn, embers: r.embers, expired: !!r.shopClockExpired, phase: r.phase }; });

async function moveTo(p, at, steps = 14) { await p.page.mouse.move(at.x, at.y, { steps }); }
async function click(p, at) { await moveTo(p, at); await sleep(220); await p.page.mouse.down(); await sleep(70); await p.page.mouse.up(); }
async function drag(p, from, to, steps = 22) {
  await moveTo(p, from);
  await sleep(150);
  await p.page.mouse.down();
  await p.page.mouse.move(to.x, to.y, { steps });
  await sleep(160);
  await p.page.mouse.up();
}

const SHOP = '[data-zone="tavern"] .card[data-uid]';
const HAND = '[data-zone="hand"] .card[data-uid]';
const BOARD = '[data-zone="warband"] .card[data-uid]';

/** Buy up to `n` shop minions by dragging them onto the board, as a player does. */
async function buy(p, n, gap = 650) {
  for (let i = 0; i < n; i++) {
    const b = await run(p);
    const c = await rectOf(p, SHOP);
    if (!c) break;
    await drag(p, c, { x: 860 + i * 110, y: 900 });
    await sleep(gap);
    const a = await run(p);
    if (a.board + a.hand === b.board + b.hand) { console.log('BUY-MISS', JSON.stringify(a)); break; }
  }
}

/** Play every minion in hand onto the board. */
async function playHand(p, gap = 600) {
  for (let i = 0; i < 7; i++) {
    const b = await run(p);
    const c = await rectOf(p, HAND);
    if (!c) break;
    await drag(p, c, { x: 700 + i * 170, y: 610 });
    await sleep(gap);
    if ((await run(p)).board === b.board) { console.log('PLAY-MISS', JSON.stringify(await run(p))); break; }
  }
}

/** Spend Gold until the Gold Fuse breaks and the turn timer starts. */
async function breakFuse(p) {
  await gold(p, 20);
  await buy(p, 3);
  for (let i = 0; i < 6 && (await run(p)).spent < 10; i++) {
    const r = await byText(p, '^\\s*refresh');
    if (!r) break;
    await click(p, r);
    await sleep(700);
  }
  if ((await run(p)).spent < 10) throw new Error(`fuse not broken: ${JSON.stringify(await run(p))}`);
}

/** The sample room's name is a dev label ("Sample Versus 1v1"): keep it out of the still. */
const hideSample = (p) => p.ev(() => { for (const e of document.querySelectorAll('.ph-stage *')) if (!e.children.length && /^Sample /.test(e.textContent.trim())) e.style.visibility = 'hidden'; });

const SHOPVIEW = { x: 320, y: 24, w: 1296, h: 729 };
const HOME = { x: 128, y: 84, w: 1770, h: 996 };
const WIDE = { x: 240, y: 24, w: 1440, h: 810 };

export const ROUTINES = {
  'gold-fuse': {
    async run(p) {
      await startPractice(p);
      await gold(p, 20);
      await moveTo(p, { x: 1300, y: 640 });
      const start = p.now();
      await sleep(900);
      await buy(p, 3, 800);
      for (let i = 0; i < 6 && (await run(p)).spent < 10; i++) { await click(p, await byText(p, '^\\s*refresh')); await sleep(800); }
      await sleep(3200);
      return { start, end: Math.min(p.now(), start + 8), still: start + 4.4, crop: SHOPVIEW };
    },
  },
  runeforge: {
    async run(p) {
      await startPractice(p);
      await gold(p, 20);
      await buy(p, 2);
      await playHand(p);
      await gold(p, 12);
      await moveTo(p, { x: 1500, y: 880 });
      await sleep(600);
      const start = p.now();
      await sleep(300);
      await p.ev(() => window.useGame.getState().dispatch({ type: 'devOpenRuneforge', epic: false }));
      await p.page.waitForSelector('.forge-cards button.runecard', { timeout: 15000 });
      await sleep(3600);
      await p.debugShot('forge');
      const cards = await p.ev(() => [...document.querySelectorAll('.forge-cards button.runecard')].map((b) => ({ label: b.getAttribute('aria-label'), no: b.classList.contains('cantafford') })));
      console.log('RUNES', JSON.stringify(cards));
      const pick = Math.max(0, cards.findIndex((c, i) => !c.no && i >= 1));
      await click(p, await rectOf(p, '.forge-cards button.runecard', pick));
      const clicked = p.now();
      await sleep(500);
      await moveTo(p, { x: 1560, y: 900 });
      await sleep(2600);
      // The whole forge, its own frame and buttons included (3:2), so nothing is cut off. It ends as the rune locks in.
      return { start: start + 1.6, end: clicked + 1.15, still: start + 3.5, crop: { x: 294, y: 112, w: 1332, h: 888 } };
    },
  },
  'ancient-select': {
    async run(p) {
      await startPractice(p);
      await gold(p, 20);
      await buy(p, 3);
      await playHand(p);
      await moveTo(p, { x: 1500, y: 900 });
      await sleep(600);
      const start = p.now();
      await sleep(300);
      await p.ev(() => window.useGame.getState().dispatch({ type: 'ancientSetMeter', points: 16 }));
      await p.page.waitForSelector('.anc-offer .anc-choose.in', { timeout: 20000 });
      await sleep(1800);
      await click(p, await rectOf(p, '.anc-cards .anc-slot button.anc-card', 1));
      await sleep(3000);
      await p.debugShot('anc-after');
      return { start: start + 2.3, end: Math.min(p.now(), start + 9.5), still: start + 5.5, crop: { x: 320, y: 180, w: 1280, h: 720 }, share: true };
    },
  },
  'chest-opening': {
    async run(p) {
      await sleep(1500);
      const start = p.now();
      await p.ev(() => window.dispatchEvent(new CustomEvent('ascent:cratefx-play', { detail: { mode: 'epic', speed: 1, chest: 'epic' } })));
      for (let i = 0; i < 9; i++) { await sleep(1000); await p.debugShot(`crate-${i}`); }
      console.log('CRATE', JSON.stringify(await p.ev(() => ({ cls: document.querySelector('.crate')?.className, name: document.querySelector('.crate-reward-name')?.textContent, rarity: document.querySelector('.crate-reward-rarity')?.textContent }))));
      return { start, end: start + 6.5, still: start + 5, crop: { x: 320, y: 130, w: 1280, h: 720 } };
    },
  },
  'mode-versus': {
    query: '?partyroom=1',
    async run(p) {
      await sleep(2500);
      await hideSample(p);
      await sleep(600);
      const png = await p.shot('room');
      console.log('TABS', JSON.stringify(await p.ev(() => [...document.querySelectorAll('.phk-tab')].map((b) => b.textContent.trim()))));
      return { png, width: 640, crop: HOME };
    },
  },
  'mode-duos': {
    query: '?partyroom=1',
    async run(p) {
      await sleep(2500);
      const d = await byText(p, '^\\s*duos\\s*$');
      if (!d) throw new Error('no Duos tab');
      await click(p, d);
      await moveTo(p, { x: 1700, y: 760 });
      await hideSample(p);
      await sleep(1500);
      const png = await p.shot('duos');
      return { png, width: 640, crop: HOME };
    },
  },
  'mode-gauntlet': {
    async run(p) {
      const t = await byText(p, 'gauntlet', '.ph-modes');
      if (t) await click(p, t);
      await moveTo(p, { x: 1700, y: 760 });
      await sleep(2500);
      const png = await p.shot('gauntlet');
      return { png, width: 640, crop: HOME };
    },
  },
  'career-chart': careerChart,
};
