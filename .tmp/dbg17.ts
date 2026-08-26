import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { createRun, reduce } from '@game/sim';
const bm = (cardId: string, uid: string, attack: number, health: number, keywords: string[] = []): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords } as any);
// ── ordering fight ──
const r = simulate(
  [bm('pack', 'p0', 1, 1), bm('b2_oona', 'p1', 1, 30), bm('b2_beardsley', 'p2', 1, 30, ['DS'])],
  [bm('cryptwolf', 'e0', 6, 40)],
  makeRng(13), CARD_INDEX, combatSide({ tier: 5 }), combatSide({ tier: 5 }));
for (const e of (r.events as any[]).slice(0, 14)) console.log(e.type, JSON.stringify(e).slice(0, 130));
// ── triple ──
const base = CARD_INDEX['drummer']! as any;
const copy = (uid: string) => ({ uid, cardId: base.id, tribe: base.tribe, attack: base.attack, health: base.health, keywords: [], golden: false });
let s: any = { ...createRun(1, 'aster'), embers: 30, board: [copy('a'), copy('b')], hand: [copy('c')], shop: [] };
s = reduce(s, { type: 'play', uid: 'c' } as any);
console.log('board after:', s.board.map((c: any) => `${c.cardId}${c.golden ? '(G)' : ''}`).join(' '), '| discover?', !!s.discover, '| triplePending?', JSON.stringify(s.pendingTriple ?? null));
console.log('hand after:', s.hand.map((c: any) => `${c.cardId}${c.golden ? '(G)' : ''}`).join(' '));
