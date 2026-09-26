/**
 * SHOP RISE WATCHERS (owner 2026-09-26: "yes fix this"; R-RISE-SHOP-01). A minion destroyed IN THE SHOP that holds
 * Rise comes straight back, and that return is a Rise: every "when a minion Rises" watcher hears it, once, at that
 * moment. Before the fix only the deferred two-step death (`settlePendingDeath`) called `fireOnRise`; the immediate
 * destroy (`destroyMinionInShop`: Warden x Ancient of Death's Aegis, Pulse x Death, …) Rose in silence.
 *
 * The dispatch now lives in `riseReturn`, the one Rise return both shop paths share, so each shop Rise fires the
 * watchers exactly once whichever path killed the body.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_IDS, CONFIG, ENDLESS_MARCH_TOKEN, createRun, enableAncients, reduce,
  type Action, type AncientId, type BoardCard, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const buffFrom = (c: BoardCard | undefined, source: string) => c?.buffs?.find((b) => b.source === source);
/** A set-3 recruit run fielding Undead. */
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1, 'indy', 'ascent', CONFIG.defaultLine, 'set3'), phase: 'recruit', embers: 20, tier: 6, tribes: ['undead', 'dwarf', 'kobold'], ...over } as RunState);
/** A Poochy carrying Rise (its printed Taunt kept). */
const riser = (uid = 'p'): BoardCard => body(uid, 'u3_poochy', { keywords: ['T', 'R'] });
/** Destroy `uid` through the IMMEDIATE shop path (every direct destroyer shares it). */
const destroyNow = (s: RunState, uid: string): void => destroyMinionInShop(makeContext(s), at(s, uid));

describe('immediate shop destroy: the Rise return fires the board\'s Rise watchers', () => {
  it('Revenant and Rising Tide pay once (board AND hand), permanently', () => {
    const s = run({
      board: [riser(), body('rev', 'u3_revenant'), body('tide', 'u3_risingtide')],
      hand: [body('h1', 'dw_brunni')],
    });
    destroyNow(s, 'p');
    const risen = s.board.find((c) => c.cardId === 'u3_poochy')!;
    expect(risen, 'it rose').toBeDefined();
    expect(risen.uid, 'a fresh body').not.toBe('p');
    expect(s.pendingDeath, 'nothing deferred').toBeUndefined();
    expect(at(s, 'rev').keywords, 'Revenant gains Ward').toContain('DS');
    expect(buffFrom(at(s, 'rev'), 'Revenant')).toMatchObject({ attack: 7, health: 7, count: 1 });
    expect(buffFrom(at(s, 'rev'), 'Rising Tide')).toMatchObject({ attack: 3, health: 4, count: 1 });
    expect(buffFrom(risen, 'Rising Tide'), 'the risen body is buffed too').toMatchObject({ attack: 3, health: 4 });
    expect(risen.health, '1 Health on return, then Rising Tide +4').toBe(1 + 4);
    const h1 = s.hand.find((c) => c.uid === 'h1')!;
    expect(buffFrom(h1, 'Rising Tide'), 'the hand is buffed').toMatchObject({ attack: 3, health: 4, count: 1 });
    expect(h1.attack).toBe(CARD_INDEX['dw_brunni']!.attack + 3);
  });

  it('the watchers\' buffs are recorded for the shop buff FX (a tendril from Rising Tide)', () => {
    const s = run({ board: [riser(), body('rev', 'u3_revenant'), body('tide', 'u3_risingtide')] });
    const before = s.recruitBuffFx.length;
    destroyNow(s, 'p');
    const fx = s.recruitBuffFx.slice(before).filter((f) => f.sourceUid === 'tide');
    expect(fx.some((f) => f.targetUid === 'rev' && f.attack >= 3), 'Rising Tide -> Revenant').toBe(true);
  });

  it('Rune of the Endless March: the risen Undead summons its Spear Warden beside it, once', () => {
    let s = act(
      { ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'), tribes: ['celestial', 'undead', 'kobold', 'dwarf', 'spirit'], wave: 7, tier: 6, phase: 'recruit', embers: 40, runeforgeOffer: ['rune_endless_march'], board: [riser()] } as RunState,
      { type: 'buyRune', index: 0 },
    );
    s = { ...s, board: s.board.map((c) => ({ ...c })) };
    destroyNow(s, 'p');
    const risen = s.board.find((c) => c.cardId === 'u3_poochy')!;
    const wardens = s.board.filter((c) => c.cardId === ENDLESS_MARCH_TOKEN);
    expect(wardens, 'one Spear Warden').toHaveLength(1);
    expect(s.board.indexOf(wardens[0]!), 'beside the riser').toBe(s.board.indexOf(risen) + 1);
    expect(s.runeProcs?.['rune_endless_march']).toBe(1);
  });
});

describe('no Rise is heard twice', () => {
  it('the immediate path: a later action settles nothing more', () => {
    let s = run({ board: [riser(), body('rev', 'u3_revenant')], hand: [body('h1', 'dw_brunni')] });
    destroyNow(s, 'p');
    s = act(s, { type: 'resolveShopDeath' }); // a stray settle is a no-op
    s = act(s, { type: 'freeze' });
    expect(buffFrom(at(s, 'rev'), 'Revenant')).toMatchObject({ attack: 7, health: 7, count: 1 });
  });

  it('the deferred path (a Deathfibrillator): still exactly once', () => {
    let s = run({ board: [body('p', 'u3_poochy', { keywords: ['T'] }), body('rev', 'u3_revenant'), body('tide', 'u3_risingtide')], hand: [body('ems', 'u3_ems'), body('h1', 'dw_brunni')] });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'p' });
    expect(s.pendingDeath?.uid).toBe('p');
    s = act(s, { type: 'resolveShopDeath' });
    s = act(s, { type: 'resolveShopDeath' });
    expect(buffFrom(at(s, 'rev'), 'Revenant')).toMatchObject({ attack: 7, health: 7, count: 1 });
    expect(buffFrom(s.hand.find((c) => c.uid === 'h1'), 'Rising Tide')).toMatchObject({ attack: 3, health: 4, count: 1 });
  });

  it('a Rebirth return is not a Rise: the Rise watchers stay quiet', () => {
    const s = run({ board: [body('p', 'u3_poochy', { keywords: ['T', 'RB'] }), body('rev', 'u3_revenant')] });
    destroyNow(s, 'p');
    expect(s.board.some((c) => c.cardId === 'u3_poochy'), 'it returned').toBe(true);
    expect(buffFrom(at(s, 'rev'), 'Revenant')).toBeUndefined();
  });
});

describe('Lord of the Risen x Ancient of Bonds: its shop Echo fires exactly once per Rise', () => {
  const VANILLA_A = 'hm_test_squire';
  const pickedBonds = (over: Partial<RunState>): RunState => {
    let s = enableAncients({ ...createRun(7, 'risen'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['bonds', ...ANCIENT_IDS.filter((a: AncientId) => a !== 'bonds').slice(0, 2)] } };
    s = reduce(s, { type: 'pickAncient', id: 'bonds' });
    expect(s.ancients!.picked).toBe('bonds');
    return s;
  };

  it('immediate destroy: one neighbour Echo (one Imp Scrap)', () => {
    const s = pickedBonds({ board: [body('i', 'burialimp'), body('a', VANILLA_A, { attack: 2, health: 2, keywords: ['R'] })] });
    const before = s.board.length;
    destroyNow(s, 'a');
    expect(s.board.some((c) => c.cardId === VANILLA_A), 'it rose').toBe(true);
    expect(s.board.filter((c) => c.cardId === 'impscrap')).toHaveLength(1);
    expect(s.board.length).toBe(before + 1);
  });

  it('deferred destroy (a Deathfibrillator): one neighbour Echo, not two', () => {
    let s = pickedBonds({
      setId: 'set3', tier: 6,
      board: [body('i', 'burialimp'), body('p', 'u3_poochy', { keywords: ['T'] })],
      hand: [body('ems', 'u3_ems')],
    });
    s = act(s, { type: 'play', uid: 'ems', toIndex: 0 });
    s = act(s, { type: 'activateEquipment', targetUid: 'p' });
    expect(s.pendingDeath?.uid).toBe('p');
    s = act(s, { type: 'resolveShopDeath' });
    expect(s.board.some((c) => c.cardId === 'u3_poochy' && c.uid !== 'p'), 'it rose').toBe(true);
    expect(s.board.filter((c) => c.cardId === 'impscrap')).toHaveLength(1);
  });
});
