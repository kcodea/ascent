/**
 * AN AVENGE (N) IS PER COMBAT (owner 2026-11-18, R-AVENGE-PER-COMBAT-01): "avenge (x): do not carry over combat to
 * combat. if it were 'when x minions die' that carries over, but avenge means it needs to happen in combat. we also need
 * to make sure that we show real time values for this kind of metric as well, so the locked number should drop in combat
 * from the avenge triggers etc."
 *
 * The run half, on the reported pairing (Gambler x Ancient of Death, "Avenge (4): reduce the lock by 1 turn") plus the
 * shared reset every hero Avenge goes through. The engine half is `packages/core/src/combat/avengePerCombat.test.ts`.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import {
  ANCIENT_DICE_LOCK_FLAG, ANCIENT_IDS, ancientAvengeCountdown, ancientAvengeReset, ancientDiceLockTurns, createRun, enableAncients,
  heroPowerText, reduce, type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { destroyMinionInShop, makeContext } from './recruit';

const N = (i: number) => ['beatboxer', 'dw_edward', 'attachmentconductor', 'sandbag'][i % 4]!;
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const weak = (n: number, p = 'm'): BoardCard[] => Array.from({ length: n }, (_, i) => card(`${p}${i}`, 'sandbag', { attack: 1, health: 1, keywords: [] }));
const base = (hero: string, over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, hero), phase: 'recruit', embers: 40, heroReady: true, hand: [], board: [], shop: [], spell: null, ...over } as RunState);
const picked = (hero: string, id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(hero, over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 1000,
  minions: [{ cardId: 'sandbag', attack: 100, health: 1000, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
const events = (s: RunState) => s.lastCombat!.events ?? [];
const lockPulses = (s: RunState): number => events(s).filter((e) => e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_DICE_LOCK_FLAG).length;
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;

describe('Gambler x Death: the Avenge (4) never carries from one fight to the next', () => {
  it('3 deaths in fight one and 1 death in fight two do NOT fire (fails before the fix: the 4th death paid in fight two)', () => {
    let s = picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 9, board: weak(3) });
    s = fightNow(s);
    expect(s.lastCombat!.playerDeaths).toBe(3);
    expect(lockPulses(s)).toBe(0);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(9);
    expect(s.ancients!.gamblerDeaths ?? 0, 'the 3 deaths are discarded with the fight').toBe(0);
    expect(ancientAvengeCountdown(s), 'the next phase starts from the full count').toBe(4);
    expect(heroPowerText(s)).toContain('(**4** more to go)');
    s = fightNow({ ...s, phase: 'recruit', board: weak(1, 'n') });
    expect(s.lastCombat!.playerDeaths).toBe(1);
    expect(lockPulses(s), 'one death is not an Avenge (4)').toBe(0);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(9);
  });

  it('4 deaths in one fight fire once, and settle banks exactly that', () => {
    let s = picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 9, board: weak(5) });
    s = fightNow(s);
    expect(s.lastCombat!.playerDeaths).toBe(5);
    expect(lockPulses(s)).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(8);
    expect(s.ancients!.gamblerDeaths ?? 0, 'the 5th death does not carry either').toBe(0);
  });

  it('Shop progress does not carry INTO the fight: 3 Shop deaths then 1 combat death fire nothing', () => {
    let s = structuredClone(picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 9, board: [...weak(1), card('a', N(0)), card('b', N(1)), card('c', N(3))] }));
    for (const uid of ['a', 'b', 'c']) destroyMinionInShop(makeContext(s), at(s, uid));
    expect(s.ancients!.gamblerDeaths).toBe(3);
    expect(heroPowerText(s), 'the Shop count shows while the Shop runs').toContain('(**1** more to go)');
    s = fightNow(s);
    expect(s.ancients!.gamblerDeaths ?? 0, 'discarded as the fight starts').toBe(0);
    expect(s.lastCombat!.playerDeaths).toBe(1);
    expect(lockPulses(s)).toBe(0);
    expect(heroPowerText(s, 0, { friendlyDeaths: 1 }), 'the fight counts from 0').toContain('(**3** more to go)');
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.heroDiceLockUntil).toBe(9);
  });

  it('Shop deaths still count within one Shop phase (owner 2026-11-16): the 4th fires right then', () => {
    const s = structuredClone(picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 9, board: ['a', 'b', 'c', 'd'].map((u, i) => card(u, N(i))) }));
    for (const uid of ['a', 'b', 'c']) destroyMinionInShop(makeContext(s), at(s, uid));
    expect(s.heroDiceLockUntil).toBe(9);
    destroyMinionInShop(makeContext(s), at(s, 'd'));
    expect(s.heroDiceLockUntil).toBe(8);
  });
});

describe('Gambler x Death: the lock and the countdown are live through the fight (no jump at settle)', () => {
  it('at every beat the printed lock equals what the engine has resolved by that beat', () => {
    let s = picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 7, board: weak(6) });
    expect(ancientDiceLockTurns(s)).toBe(4);
    s = fightNow(s);
    expect(lockPulses(s)).toBe(1);
    // Walk the log the way the replay folds it: friendly deaths so far (a Rise's first death excluded) and the lock
    // pulses the engine has emitted so far. The live number must match the engine at every prefix.
    let deaths = 0, fired = 0;
    const seen: number[] = [];
    for (const e of events(s)) {
      if (e.type === 'death' && e.side === 'player' && !e.rise) deaths += 1;
      else if (e.type === 'questTrigger' && e.side === 'player' && e.flag === ANCIENT_DICE_LOCK_FLAG) fired += 1;
      else continue;
      // The avenge fires as the 4th body dies; the pulse and its `death` event belong to the same moment, so compare
      // once both halves of that moment are in (deaths at a multiple of 4 <=> the pulse is in).
      if (Math.floor(deaths / 4) !== fired) continue;
      expect(ancientDiceLockTurns(s, deaths), `after ${deaths} deaths`).toBe(4 - fired);
      const text = heroPowerText(s, 0, { friendlyDeaths: deaths });
      expect(text).toContain(`Locked for **${4 - fired}** more turns.`);
      expect(text).toContain(`(**${4 - (deaths % 4)}** more to go)`);
      seen.push(4 - fired);
    }
    expect(seen[0]).toBe(4);
    expect(seen[seen.length - 1]).toBe(3);
    const finalLive = ancientDiceLockTurns(s, deaths);
    const wave = s.wave;
    s = reduce(s, { type: 'resolveCombat' });
    expect((s.heroDiceLockUntil ?? 0) - wave, 'settle lands exactly on the last live number').toBe(finalLive);
  });

  it('without the pairing the lock helper is the plain lock, and deaths never move it', () => {
    const s = picked('gambler', 'war', { wave: 3, heroDiceLockUntil: 6 });
    expect(ancientDiceLockTurns(s, 0)).toBe(3);
    expect(ancientDiceLockTurns(s, 8)).toBe(3);
    expect(ancientDiceLockTurns(base('gambler', { wave: 3, heroDiceLockUntil: 6 }), 8)).toBe(3);
  });
});

describe('The shared reset: every hero Avenge count is discarded at the phase boundary, the carry-over kind is kept', () => {
  it('ancientAvengeReset zeroes every Avenge count and leaves "When 16 friendly minions die" alone', () => {
    const s = structuredClone(picked('gambler', 'death'));
    Object.assign(s.ancients!, {
      hunchDeaths: 3, xeroxDeaths: 4, tradesDeaths: 2, gorrDeaths: 5, nadjaDeaths: 5, brackusDeaths: 2, rayseDeaths: 3, cassenDeaths: 6,
      gildDeaths: 9, keshiDeaths: 3, batchBDeaths: 2, rascalDeaths: 3, gamblerDeaths: 3, flintDeaths: 3, cindyDeaths: 14, bramDeaths: 15,
    });
    ancientAvengeReset(s);
    const a = s.ancients! as unknown as Record<string, number>;
    for (const f of ['hunchDeaths', 'xeroxDeaths', 'tradesDeaths', 'gorrDeaths', 'nadjaDeaths', 'brackusDeaths', 'rayseDeaths', 'cassenDeaths', 'gildDeaths', 'keshiDeaths', 'batchBDeaths', 'rascalDeaths', 'gamblerDeaths', 'flintDeaths', 'cindyDeaths']) {
      expect(a[f], f).toBe(0);
    }
    expect(a.bramDeaths, 'Braum x Death is not an Avenge').toBe(15);
  });

  it('Hunch x Death (the Shop-counting ruling): 3 Shop deaths then 1 combat death improve nothing', () => {
    let s = picked('hunch', 'death', { wave: 3, board: weak(1) });
    s = { ...s, ancients: { ...s.ancients!, hunchDeaths: 3 } };
    const before = s.ancients!.spellImproved ?? { attack: 0, health: 0 };
    s = fightNow(s);
    expect(s.lastCombat!.playerDeaths).toBe(1);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.spellImproved ?? { attack: 0, health: 0 }).toEqual(before);
    expect(s.ancients!.hunchDeaths ?? 0).toBe(0);
  });

  it('determinism: the same run fights the same fight, across a JSON round trip', () => {
    const mk = (): RunState => picked('gambler', 'death', { wave: 3, heroDiceLockUntil: 9, board: weak(6) });
    const a = fightNow(mk());
    const b = fightNow(JSON.parse(JSON.stringify(mk())) as RunState);
    expect(JSON.stringify(events(b))).toBe(JSON.stringify(events(a)));
    expect(reduce(b, { type: 'resolveCombat' }).heroDiceLockUntil).toBe(reduce(a, { type: 'resolveCombat' }).heroDiceLockUntil);
  });
});
