import { CARD_INDEX } from '@game/content';
import { createRun, type BoardCard, type RunState } from '../state';
import { reduce } from '../reducer';
import { createStrategistPilot } from '../balance/strategy/strategistPilot';
import { GENERALIST_BUDGETS } from '../balance/generalistPilot';
import { pickLineForRun } from '../balance/strategy/lines';
import { STRATEGY_PACKAGES } from '../balance/strategy/packages';
import { horizonTermOf, probeHorizon } from './growth';
import { mixSeed } from '../state';
import { toBotVisibleState } from './visibleState';
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (over: Partial<RunState> = {}, seed = 4242, heroId = 'drakko'): RunState =>
  ({ ...createRun(seed, heroId, 'ascent', undefined, 'set2'), phase: 'recruit', spell: undefined, ...over } as RunState);
const which = process.argv[2] ?? 'tempo';
let start: RunState;
if (which === 'tempo') start = { ...run({ embers: 0, wave: 6, tier: 4, board: ['dw_brakka', 'venom', 'dw_orin'].map((id, i) => body(`b${i}`, id)), hand: [body('p', 'spiritfire')] }), shop: [] } as RunState;
else { const d = CARD_INDEX['b2_packstrider']!; const stray = CARD_INDEX['stray']!; start = { ...run({ embers: 3, wave: 2, tier: d.tier, board: [], hand: [] }, 11), shop: [{ uid: 'v', cardId: 'stray', atk: d.attack - stray.attack, hp: d.health - stray.health }, { uid: 'e', cardId: 'b2_packstrider' }] } as RunState; }
let k = 0; for (; k < STRATEGY_PACKAGES.length; k++) if (pickLineForRun(start.heroId, start.tribes, start.seed ^ 7, k, 'set2').primary === (which === 'tempo' ? 'tempo' : 'rally')) break;
const pilot = createStrategistPilot(GENERALIST_BUDGETS.smoke, 7, { exploration: k });
const seed = mixSeed(7, start.wave, 0x6f07) >>> 0;
let s = start;
for (let i = 0; i < 3; i++) {
  const a = pilot.decide(s, { seatId: 'seat', round: s.wave, scoutedOpponent: null });
  const tr = pilot.lastTrace()!;
  const rv = toBotVisibleState(s);
  console.log(tr.route, JSON.stringify(a), 'root', tr.search?.rootUtility.toFixed(2), JSON.stringify(horizonTermOf(rv, seed)));
  for (const t of tr.search?.top ?? []) { const h = probeHorizon(t.visible, seed); console.log('   ', t.plan.map((x) => x.tag).join('→'), t.utility.toFixed(2), JSON.stringify(horizonTermOf(t.visible, seed)), 'd1', h?.d1, 'd2', h?.d2, 'trial2', h?.trial2, 'carry', h?.fight2.carryBack, 'win', h?.fight2.winRate, 'mass2', h?.mass2); }
  if (!a) break;
  s = reduce(s, a);
}
