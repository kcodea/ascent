/**
 * SET 2 RUNE BATCH, EPIC TRIBAL (owner 2026-11-12, docs/design/2026-11-12-set2-rune-batch.md; R-SET2-EPIC-TRIBAL-1112-01..10):
 *
 *   Big Spender     Dwarf  4  Your "spend Gold" triggers count each Gold twice.
 *   Royal Treasury  Dwarf  4  When you buy 5 Dwarves, gain +1 maximum Gold. (repeats, owner 2026-11-12)
 *   Feral Return    Beast  4  Start of Combat: give your left-most Beast Rise. Beasts that Rise gain +5/+5.
 *   Pack Tactics    Beast  4  Your Beasts' Rallies also trigger when that Beast is attacked.
 *   Blood Frenzy    Beast  4  When a Beast kills a minion, trigger your left-most Rally.
 *   Hellfire        Demon  3  When a Demon attacks or dies, deal 1 damage to all enemies. This counts as Demon damage.
 *   Wildfire        Demon  4  When one of your minions kills an enemy, deal that enemy's Attack as damage to a random enemy
 *                             minion. (3 times per combat.)  (owner rework 2026-11-13; Hellfire became Demon damage the same day)
 *   Elder's Voice   Dragon 3  Your first Shout each turn also triggers at Start of Combat.
 *   Vein Finder     Kobold 3  After every 3rd Refresh, cast a Ruby on all your minions.
 *   Gem Rain        Kobold 4  Start of Combat: cast 2 permanent Rubies on all your minions.
 *
 * Every block drives the real engine: the Runeforge `buyRune`, the reducer's `roll` / `buy` / `play`, and `simulate()`.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { destroyMinionInShop, makeContext } from './recruit';
import { snapshotBoard } from './snapshot';
import { runeTally } from '../../ui/src/runeTally';

// ── Shop helpers ────────────────────────────────────────────────────────────────────────────────────────────────
const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** A Set 2 run at the Runeforge, each rune bought through the REAL `buyRune` path. */
function withRune(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
  return { ...s, ...extra };
}
const sumFrom = (c: BoardCard, source: string) =>
  (c.buffs ?? []).filter((b) => b.source === source).reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), { attack: 0, health: 0 });
const PLAIN = Object.values(CARD_INDEX).filter((c) => !c.spell && !c.token && !c.universalTribe && c.tribe === 'neutral' && !c.tribe2 && c.effects.length === 0 && c.keywords.length === 0)
  .map((c) => c.id).filter((id) => !['sylus', 'chronos', 'yazzus', 'drummer', 'uron', 'zyff'].includes(id));
const NEUTRAL = PLAIN[0]!;
const plain = (uid: string, i: number): BoardCard => body(uid, PLAIN[i % PLAIN.length]!);

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Omit<Partial<BoardMinion>, 'keywords'> & { keywords?: string[] } = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { uid, sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as unknown as BoardMinion;
};
// A plain neutral body (no effects), not the Sandbag: a Sandbag gains Attack when damaged, which turns every volley test
// into a brawl.
const wall = (attack: number, uid = 'w', health = 5000): BoardMinion => bm(uid, PLAIN[1]!, { attack, health, keywords: [] });
const dummy = (uid: string, health = 1): BoardMinion => bm(uid, PLAIN[2]!, { attack: 0, health, keywords: [] });
const side = (mods: object) => combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: mods });
const fight = (p: BoardMinion[], e: BoardMinion[], mods: object, seed = 4, enemyMods: object = {}) =>
  ({ ...simulate(p, e, makeRng(seed), CARD_INDEX, side(mods), side(enemyMods)), src: { player: p.map((m) => m.sourceUid!), enemy: e.map((m) => m.sourceUid!) } });
type Fight = ReturnType<typeof fight>;
const triggers = (evs: readonly CombatEvent[], flag: string, s: 'player' | 'enemy' = 'player') =>
  evs.filter((e) => e.type === 'questTrigger' && e.flag === flag && (e as { side?: string }).side === s);
type Buff = Extract<CombatEvent, { type: 'buff' }>;
type Dmg = Extract<CombatEvent, { type: 'dmg' }>;
const uidOf = (r: Fight, src: string, s: 'player' | 'enemy' = 'player') => r.initial[s][r.src[s].indexOf(src)]!.uid;
const rubyBuffsOn = (r: Fight, target: string) => r.events.filter((e): e is Buff => e.type === 'buff' && e.ruby === true && e.target === target && !e.bounce);

describe('the ten runes as content', () => {
  it('names, costs, the Epic pool, the tribe gate, Set 2 only, the doc texts verbatim', () => {
    const rows: [string, string, number, string, string][] = [
      ['rune_big_spender', 'Big Spender', 4, 'dwarf', 'Your "spend Gold" triggers count each Gold **twice**.'],
      ['rune_royal_treasury', 'Royal Treasury', 4, 'dwarf', 'When you buy **5** **Dwarves**, gain **+1** maximum Gold.'],
      ['rune_feral_return', 'Feral Return', 4, 'beast', '**Start of Combat:** give your left-most **Beast** **Rise**. **Beasts** that **Rise** gain **+5/+5**.'],
      ['rune_pack_tactics', 'Pack Tactics', 4, 'beast', "Your **Beasts'** **Rallies** also trigger when that Beast is attacked."],
      ['rune_blood_frenzy', 'Blood Frenzy', 4, 'beast', 'When a **Beast** kills a minion, trigger your left-most **Rally**.'],
      ['rune_hellfire', 'Hellfire', 3, 'demon', 'When a **Demon** attacks or dies, deal **1** damage to all enemies. This counts as **Demon** damage.'],
      ['rune_wildfire', 'Wildfire', 4, 'demon', "When one of your minions kills an enemy, deal that enemy's **Attack** as damage to a random enemy minion. (**3** times per combat.)"],
      ['rune_elders_voice', "Elder's Voice", 3, 'dragon', 'Your first **Shout** each turn also triggers at **Start of Combat**.'],
      ['rune_vein_finder', 'Vein Finder', 3, 'kobold', 'After every **3rd** Refresh, cast a **Ruby** on all your minions.'],
      ['rune_gem_rain', 'Gem Rain', 4, 'kobold', '**Start of Combat:** cast **2** permanent **Rubies** on all your minions.'],
    ];
    for (const [id, name, cost, tribe, text] of rows) {
      const r = RUNE_INDEX[id]!;
      expect([r.name, r.cost, r.text, r.sets, r.tribes, r.epic]).toEqual([name, cost, text, ['set2'], [tribe], true]);
      expect(EPIC_RUNES.some((x) => x.id === id), `${id} is an Epic rune`).toBe(true);
      expect(RUNES.some((x) => x.id === id)).toBe(false);
      expect(r.text).not.toMatch(/—|--|Oath|climb/);
    }
  });
});

describe('BIG SPENDER: your "spend Gold" triggers count each Gold twice', () => {
  it('a Gold meter (Spellslinging) hears a Refresh x2; the Gold paid and the turn tally stay real', () => {
    const run = (ids: string[]) => {
      const s0 = { ...withRune(ids), goldSpentThisTurn: 0, spellDripTick: 0 }; // the rune purchases themselves spent Gold
      const s = act(s0, { type: 'roll' });
      return { paid: s0.embers - s.embers, tick: s.spellDripTick ?? 0, turn: s.goldSpentThisTurn ?? 0 };
    };
    const off = run(['rune_spellslinging']);
    const on = run(['rune_spellslinging', 'rune_big_spender']);
    const two = run(['rune_spellslinging', 'rune_big_spender', 'rune_big_spender']);
    expect(off.paid).toBeGreaterThan(0);
    expect(on.paid).toBe(off.paid);
    expect([off.tick, on.tick, two.tick]).toEqual([off.paid, off.paid * 2, off.paid * 3]);
    expect(on.turn, 'the turn Gold-spent tally is real Gold').toBe(on.paid);
  });

  it('a minion "spend Gold" meter (Coinfire Forewoman) hears it twice too', () => {
    const tickAfterRoll = (ids: string[]) => {
      const s = act(withRune(ids, { board: [body('c', 'dw_coinfire', { goldTick: 0 })] }), { type: 'roll' });
      return s.board.find((c) => c.uid === 'c')!.goldTick ?? 0;
    };
    expect(tickAfterRoll(['rune_big_spender'])).toBe(2 * tickAfterRoll([]));
  });
});

describe('ROYAL TREASURY: When you buy 5 Dwarves, gain +1 maximum Gold (repeats)', () => {
  const DWARVES = ['dw_orin', 'dw_ironlung', 'dw_brunni', 'dw_wardkeeper', 'dw_coinfire', 'dw_brakka', 'dw_dorrin', 'dw_brewer', 'dw_pimm', 'dw_edward'];
  const buyAll = (s: RunState, ids: string[]): RunState => {
    for (const [i, id] of ids.entries()) {
      s = { ...s, embers: 60, shop: [{ uid: `o${i}`, cardId: id }] };
      s = act(s, { type: 'buy', uid: `o${i}` });
      s = { ...s, hand: [] }; // keep room
    }
    return s;
  };
  it('every 5th Dwarf bought raises max Gold by 1, and repeats; the badge prints the meter and the total', () => {
    let s = withRune(['rune_royal_treasury']);
    const base = s.maxGoldBonus ?? 0;
    s = buyAll(s, DWARVES.slice(0, 4));
    expect(s.maxGoldBonus ?? 0).toBe(base);
    expect(runeTally(s, 'rune_royal_treasury')).toBe('4/5 · +0 max Gold');
    s = buyAll(s, DWARVES.slice(4, 5));
    expect(s.maxGoldBonus).toBe(base + 1);
    expect(runeTally(s, 'rune_royal_treasury')).toBe('0/5 · +1 max Gold');
    s = buyAll(s, DWARVES.slice(5, 10));
    expect(s.maxGoldBonus).toBe(base + 2);
    expect(runeTally(s, 'rune_royal_treasury')).toBe('0/5 · +2 max Gold');
  });
  it('a non-Dwarf buy does not tick it; two copies give +2 per trip', () => {
    let s = withRune(['rune_royal_treasury']);
    s = buyAll(s, ['beetle', NEUTRAL]);
    expect(s.royalTreasuryTick ?? 0).toBe(0);
    let d = withRune(['rune_royal_treasury', 'rune_royal_treasury']);
    const base = d.maxGoldBonus ?? 0;
    d = buyAll(d, DWARVES.slice(0, 5));
    expect(d.maxGoldBonus).toBe(base + 2);
  });
});

describe('FERAL RETURN: Start of Combat: give your left-most Beast Rise. Beasts that Rise gain +5/+5', () => {
  it('the left-most Beast (not the left-most minion) gains Rise; when it Rises it gains +5/+5 (combat only)', () => {
    const r = fight([bm('n', NEUTRAL, { attack: 0, health: 5000 }), bm('b', 'beetle', { attack: 0, health: 1 })], [wall(3)], { runeFeralReturn: true });
    const b = uidOf(r, 'b');
    const grant = r.events.find((e) => e.type === 'keyword' && e.target === b && (e as { keyword: string }).keyword === 'R');
    expect(grant, 'the Beast gets Rise at Start of Combat').toBeTruthy();
    expect(r.events.some((e) => e.type === 'keyword' && e.target === uidOf(r, 'n'))).toBe(false);
    const reborn = r.events.findIndex((e) => e.type === 'reborn' && e.target === b);
    expect(reborn).toBeGreaterThan(-1);
    const gain = r.events.slice(reborn).find((e): e is Buff => e.type === 'buff' && e.target === b && e.attack === 5 && e.health === 5);
    expect(gain, 'the risen Beast gains +5/+5').toBeTruthy();
    expect((r.playerPermaBuffs ?? []).some((p) => p.attack === 5 && p.health === 5), 'combat only: nothing carries back').toBe(false);
    const off = fight([bm('n', NEUTRAL, { attack: 0, health: 5000 }), bm('b', 'beetle', { attack: 0, health: 1 })], [wall(3)], {});
    expect(off.events.some((e) => e.type === 'reborn')).toBe(false);
  });
  it('a Beast that Rises from another source also gains +5/+5; a non-Beast that Rises does not', () => {
    const r = fight([bm('b', 'beetle', { attack: 0, health: 1, keywords: ['R'], rebornAvailable: true } as never), bm('n', NEUTRAL, { attack: 0, health: 1, keywords: ['R'], rebornAvailable: true } as never), bm('x', 'beetle', { attack: 0, health: 5000 })], [wall(3)], { runeFeralReturn: true });
    const gains = r.events.filter((e): e is Buff => e.type === 'buff' && e.attack === 5 && e.health === 5);
    expect(gains.map((g) => g.target)).not.toContain(uidOf(r, 'n'));
    expect(gains.some((g) => g.target === uidOf(r, 'b'))).toBe(true);
  });
  it('per copy held (two Beasts get Rise), Twilight repeats it, and no Beast means nothing', () => {
    const board = () => [bm('a', 'beetle', { attack: 0, health: 5000 }), bm('b', 'beetle', { attack: 0, health: 5000 }), bm('c', 'beetle', { attack: 0, health: 5000 })];
    const n = (r: Fight) => triggers(r.events, 'runeFeralReturn').length;
    expect(n(fight(board(), [wall(0)], { runeFeralReturn: true }))).toBe(1);
    expect(n(fight(board(), [wall(0)], { runeFeralReturn: true, flagCopies: { runeFeralReturn: 2 } }))).toBe(2);
    expect(n(fight(board(), [wall(0)], { runeFeralReturn: true, runeTwilight: true }))).toBe(2);
    expect(n(fight([bm('n', NEUTRAL, { health: 5000 })], [wall(0)], { runeFeralReturn: true }))).toBe(0);
  });
  it('Shop: a Beast that Rises in the Shop gains +5/+5 permanently; a non-Beast does not', () => {
    const s = withRune(['rune_feral_return'], { board: [body('b', 'beetle', { keywords: ['R'] }), body('n', NEUTRAL, { keywords: ['R'] })] });
    destroyMinionInShop(makeContext(s), s.board[0]!);
    const risen = s.board.find((c) => c.cardId === 'beetle')!;
    expect(sumFrom(risen, 'Feral Return')).toEqual({ attack: 5, health: 5 });
    destroyMinionInShop(makeContext(s), s.board.find((c) => c.uid === 'n')!);
    const n = s.board.find((c) => c.cardId === NEUTRAL)!;
    expect(sumFrom(n, 'Feral Return')).toEqual({ attack: 0, health: 0 });
  });
});

describe("PACK TACTICS: Your Beasts' Rallies also trigger when that Beast is attacked", () => {
  const selfRallies = (r: Fight, uid: string) => r.events.filter((e) => e.type === 'buff' && e.target === uid && (e as Buff).source === uid).length;
  const attacks = (r: Fight, key: 'attacker' | 'defender', uid: string) => r.events.filter((e) => e.type === 'attack' && (e as Record<string, unknown>)[key] === uid).length;
  it('a Rally Beast fires its Rally each time it is attacked, on top of its own swings', () => {
    const p = () => [bm('p', 'b2_packstrider', { health: 5000 })];
    const on = fight(p(), [wall(1)], { runePackTactics: true });
    const off = fight(p(), [wall(1)], {});
    const pu = uidOf(on, 'p');
    expect(attacks(on, 'defender', pu)).toBeGreaterThan(0);
    expect(selfRallies(off, pu)).toBe(attacks(off, 'attacker', pu));
    expect(selfRallies(on, pu)).toBe(attacks(on, 'attacker', pu) + attacks(on, 'defender', pu));
    expect(triggers(on.events, 'runePackTactics').length).toBe(attacks(on, 'defender', pu));
  });
  it('a non-Beast Rally (Cinder Chef, a Dragon) does not; works for an enemy snapshot side too', () => {
    const r = fight([bm('c', 'd2_cinderchef', { health: 5000 })], [wall(1)], { runePackTactics: true });
    expect(triggers(r.events, 'runePackTactics')).toHaveLength(0);
    const e = fight([wall(1)], [bm('p', 'b2_packstrider', { health: 5000 })], {}, 4, { runePackTactics: true });
    expect(triggers(e.events, 'runePackTactics', 'enemy').length).toBeGreaterThan(0);
  });
});

describe('BLOOD FRENZY: When a Beast kills a minion, trigger your left-most Rally', () => {
  const chefRallies = (r: Fight) => { const c = uidOf(r, 'c'); return r.events.filter((e) => e.type === 'buff' && e.target === c && (e as Buff).source === c).length; };
  const foes = () => [dummy('e1'), dummy('e2'), dummy('e3')];
  // A Beast kill = an enemy `death` right after a swing by the Beast `k`.
  const beastKills = (r: Fight) => { let last = ''; let n = 0; for (const e of r.events) { if (e.type === 'attack') last = (e as { attacker: string }).attacker; if (e.type === 'death' && (e as { side: string }).side === 'enemy' && last === uidOf(r, 'k')) n++; } return n; };
  it('each enemy a Beast kills by attacking fires the left-most Rally (a Cinder Chef: Rally, +1/+1 to itself)', () => {
    const p = () => [bm('k', 'beetle', { attack: 10, health: 5000 }), bm('c', 'd2_cinderchef', { attack: 0, health: 5000 })];
    const on = fight(p(), foes(), { runeBloodFrenzy: true });
    const swingsOf = (r: Fight) => r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === uidOf(r, 'c')).length;
    expect(beastKills(on)).toBeGreaterThan(0);
    expect(triggers(on.events, 'runeBloodFrenzy')).toHaveLength(beastKills(on));
    expect(chefRallies(on), 'its own swings plus one Rally per Beast kill').toBe(swingsOf(on) + beastKills(on));
    const off = fight(p(), foes(), {});
    expect(chefRallies(off)).toBe(swingsOf(off));
    const two = fight(p(), foes(), { runeBloodFrenzy: true, flagCopies: { runeBloodFrenzy: 2 } });
    expect(chefRallies(two)).toBe(swingsOf(two) + 2 * beastKills(two));
  });
  it('a non-Beast killer does not fire it', () => {
    const r = fight([bm('k', NEUTRAL, { attack: 10, health: 5000 }), bm('c', 'd2_cinderchef', { attack: 0, health: 5000 })], foes(), { runeBloodFrenzy: true });
    expect(chefRallies(r)).toBe(0);
  });
});

describe('HELLFIRE: When a Demon attacks or dies, deal 1 damage to all enemies (Demon damage, owner 2026-11-13)', () => {
  // The volley is dealt BY the Demon that attacked or died (owner 2026-11-13: "Hellfire only counts as Demon damage"),
  // the Fel Spikes spray shape: every hit that LANDS is one "a Demon deals damage" (Rachel, Todd, Ruinous Lord, Ruins),
  // counts toward that Demon's Pummel, and an Execute Demon executes what it lands on.
  const hellOnes = (r: Fight, dealer: string, uids: string[]) => r.events.filter((e): e is Dmg => e.type === 'dmg' && e.amount === 1 && e.source === dealer && uids.includes(e.target)).length;
  const swingsOf = (r: Fight, uid: string) => r.events.filter((e) => e.type === 'attack' && (e as { attacker: string }).attacker === uid).length;
  const demonHits = (r: Fight, s: 'player' | 'enemy' = 'player') => {
    const demons = new Set(r.initial[s].filter((m) => CARD_INDEX[m.cardId]?.tribe === 'demon').map((m) => m.uid));
    return r.events.filter((e): e is Dmg => e.type === 'dmg' && !!e.source && demons.has(e.source)).length;
  };
  const rachelFires = (r: Fight, s: 'player' | 'enemy' = 'player') => {
    const rach = r.initial[s].find((m) => m.cardId === 'dm_radrachel')!.uid;
    return r.events.filter((e) => e.type === 'buff' && e.target === rach && (e as Buff).source === rach).length;
  };
  it('every Demon swing sends 1 damage to every enemy, dealt by that Demon', () => {
    const r = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })], [wall(0), dummy('e1', 5000), dummy('e2', 5000)], { runeHellfire: true });
    const swings = swingsOf(r, uidOf(r, 'd'));
    expect(swings).toBeGreaterThan(0);
    expect(triggers(r.events, 'runeHellfire')).toHaveLength(swings);
    expect(hellOnes(r, uidOf(r, 'd'), r.initial.enemy.map((m) => m.uid))).toBeGreaterThanOrEqual(swings * 3);
    const off = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })], [wall(0), dummy('e1', 5000), dummy('e2', 5000)], {});
    expect(triggers(off.events, 'runeHellfire')).toHaveLength(0);
  });
  it('a Demon that dies sends 1 damage to every enemy, dealt by the dying Demon; a non-Demon does not', () => {
    const r = fight([bm('d', 'dm_hank', { attack: 0, health: 1 })], [wall(5), dummy('e1', 50)], { runeHellfire: true });
    expect(triggers(r.events, 'runeHellfire')).toHaveLength(1);
    const death = r.events.findIndex((e) => e.type === 'death' && e.target === uidOf(r, 'd'));
    const after = r.events.slice(death).filter((e): e is Dmg => e.type === 'dmg' && e.amount === 1 && e.source === uidOf(r, 'd'));
    expect(after.length).toBe(2);
    const n = fight([bm('d', NEUTRAL, { attack: 0, health: 1 })], [wall(5), dummy('e1', 50)], { runeHellfire: true });
    expect(triggers(n.events, 'runeHellfire')).toHaveLength(0);
  });
  it('attack half + Rad Rachel: Rachel fires once per Hellfire hit that lands (plus the swing itself)', () => {
    const mine = () => [bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] }), bm('r', 'dm_radrachel', { attack: 0, health: 5000 })];
    const theirs = () => [dummy('e1', 5000), dummy('e2', 5000), dummy('e3', 5000)];
    const r = fight(mine(), theirs(), { runeHellfire: true });
    const volleys = triggers(r.events, 'runeHellfire').length;
    expect(volleys).toBeGreaterThan(0);
    const hits = demonHits(r);
    expect(hits).toBeGreaterThanOrEqual(volleys * 3); // three enemies, all survive: three landed hits per volley
    expect(rachelFires(r)).toBe(hits);
    const off = fight(mine(), theirs(), {});
    expect(triggers(off.events, 'runeHellfire')).toHaveLength(0);
    expect(rachelFires(off)).toBe(demonHits(off)); // without the rune: the Demons' own landed swings alone
  });
  it('death half + Rad Rachel: the dying Demon\'s volley fires Rachel once per landed hit', () => {
    const r = fight([bm('d', 'dm_hank', { attack: 0, health: 1 }), bm('r', 'dm_radrachel', { attack: 0, health: 5000 })],
      [wall(5), dummy('e1', 5000)], { runeHellfire: true });
    const hank = uidOf(r, 'd');
    const death = r.events.findIndex((e) => e.type === 'death' && e.target === hank);
    expect(death).toBeGreaterThan(-1);
    const deathHits = r.events.slice(death).filter((e): e is Dmg => e.type === 'dmg' && e.source === hank).length;
    expect(deathHits).toBe(2);
    expect(rachelFires(r)).toBe(demonHits(r));
  });
  it('with Ruins: one Hellfire volley pumps Ruins exactly as one Fel Spikes spray does (once per landed hit)', () => {
    const foes = () => [wall(5, 'w', 5000), dummy('e1', 5000), dummy('e2', 5000)];
    const ruinsAfterDeath = (r: Fight) => {
      const d = r.events.findIndex((e) => e.type === 'death' && e.target === uidOf(r, 'd'));
      return d < 0 ? -1 : triggers(r.events.slice(d), 'runeRuins').length;
    };
    const spikes = fight([bm('d', 'dm_felspikes', { attack: 0, health: 1, keywords: [] })], foes(), { runeRuins: true });
    const hell = fight([bm('d', 'dm_hank', { attack: 0, health: 1 })], foes(), { runeRuins: true, runeHellfire: true });
    expect(ruinsAfterDeath(spikes)).toBe(3);
    expect(ruinsAfterDeath(hell)).toBe(ruinsAfterDeath(spikes));
  });
  it('the volley counts toward the Demon\'s Pummel (Impossible Todd summons his Imp on the third swing)', () => {
    const foes = () => [wall(0), ...Array.from({ length: 6 }, (_, i) => dummy(`e${i}`, 5000))];
    const r = fight([bm('t', 'dm_todd', { attack: 1, health: 5000, keywords: [] })], foes(), { runeHellfire: true });
    const imp = r.events.findIndex((e) => e.type === 'summon' && e.side === 'player');
    expect(imp).toBeGreaterThan(-1);
    // 1 (the swing) + 7 (the volley) per swing: the 20 is crossed on the third swing.
    expect(swingsOf({ ...r, events: r.events.slice(0, imp) }, uidOf(r, 't'))).toBe(3);
  });
  it('an Execute Demon executes what its volley lands on (the venom spends on the first landed hit, as a spray)', () => {
    const r = fight([bm('d', 'dm_hank', { attack: 0, health: 1, keywords: ['V'] })], [wall(5, 'w', 5000), dummy('e1', 5000)], { runeHellfire: true });
    const enemies = r.initial.enemy.map((m) => m.uid);
    expect(r.events.filter((e) => e.type === 'poison' && enemies.includes(e.target)).length).toBe(1);
    const off = fight([bm('d', 'dm_hank', { attack: 0, health: 1, keywords: ['V'] })], [wall(5, 'w', 5000), dummy('e1', 5000)], {});
    expect(off.events.filter((e) => e.type === 'poison' && off.initial.enemy.some((m) => m.uid === e.target)).length).toBe(0);
  });
  it('symmetric: a served enemy side\'s Hellfire fires ITS Rachel the same way', () => {
    const mine = () => [bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] }), bm('r', 'dm_radrachel', { attack: 0, health: 5000 })];
    const theirs = () => [dummy('e1', 5000), dummy('e2', 5000), dummy('e3', 5000)];
    const e = fight(theirs(), mine(), {}, 4, { runeHellfire: true });
    const volleys = triggers(e.events, 'runeHellfire', 'enemy').length;
    expect(volleys).toBeGreaterThan(0);
    expect(demonHits(e, 'enemy')).toBeGreaterThanOrEqual(3 * volleys);
    expect(rachelFires(e, 'enemy')).toBe(demonHits(e, 'enemy'));
  });
  it('two sides with Hellfire: Demon deaths chain across but the fight ends (bounded)', () => {
    const p = () => Array.from({ length: 4 }, (_, i) => bm(`p${i}`, 'dm_hank', { attack: 1, health: 2 }));
    const e = () => Array.from({ length: 4 }, (_, i) => bm(`e${i}`, 'dm_hank', { attack: 1, health: 2 }));
    const r = fight(p(), e(), { runeHellfire: true }, 4, { runeHellfire: true });
    expect(r.result).toBeDefined();
    expect(triggers(r.events, 'runeHellfire').length).toBeGreaterThan(0);
    expect(triggers(r.events, 'runeHellfire', 'enemy').length).toBeGreaterThan(0);
  });
});

describe('WILDFIRE: When one of your minions kills an enemy, deal that enemy\'s Attack as damage to a random enemy minion. (3 times per combat.)', () => {
  // The damage event right after each Wildfire trigger (a Ward pop counts as the hit, so it is skipped here).
  const wildHits = (r: Fight, s: 'player' | 'enemy' = 'player') => {
    const out: Dmg[] = [];
    r.events.forEach((e, i) => {
      if (e.type === 'questTrigger' && e.flag === 'runeWildfire' && (e as { side?: string }).side === s) {
        const d = r.events.slice(i + 1).find((x) => x.type === 'dmg' || x.type === 'shield');
        if (d && d.type === 'dmg') out.push(d as Dmg);
      }
    });
    return out;
  };
  const killer = () => [bm('k', NEUTRAL, { attack: 10, health: 5000, keywords: [] })];
  // Six 4-Attack, 1-Health enemies beside a 0/5000 wall: every attack kill is a 4-damage Wildfire hit.
  const foes = () => [wall(0, 'w', 5000), ...Array.from({ length: 6 }, (_, i) => bm(`e${i}`, PLAIN[2]!, { attack: 4, health: 1, keywords: [] }))];
  it('an ATTACK kill fires it: the dead enemy\'s Attack, to one random enemy minion, 3 times per combat (more per copy)', () => {
    const one = fight(killer(), foes(), { runeWildfire: true });
    const two = fight(killer(), foes(), { runeWildfire: true, flagCopies: { runeWildfire: 2 } });
    const off = fight(killer(), foes(), {});
    expect(triggers(off.events, 'runeWildfire')).toHaveLength(0);
    expect(triggers(one.events, 'runeWildfire')).toHaveLength(3);
    expect(triggers(two.events, 'runeWildfire').length).toBeGreaterThan(3);
    expect(triggers(two.events, 'runeWildfire').length).toBeLessThanOrEqual(6);
    const enemies = new Set(one.initial.enemy.map((m) => m.uid));
    const hits = wildHits(one);
    expect(hits.length).toBe(3);
    for (const h of hits) {
      expect(h.amount).toBe(4);
      expect(enemies.has(h.target)).toBe(true);
      expect('source' in h).toBe(false); // sourceless: the rune deals it
    }
    // ONE target per trigger: exactly one dmg event between a trigger and the next attack / trigger.
    const i0 = one.events.findIndex((e) => e.type === 'questTrigger' && e.flag === 'runeWildfire');
    const rest = one.events.slice(i0 + 1);
    const next = rest.findIndex((e) => e.type === 'attack' || (e.type === 'questTrigger' && e.flag === 'runeWildfire'));
    expect(rest.slice(0, next < 0 ? undefined : next).filter((e) => e.type === 'dmg').length).toBe(1);
    // Deterministic: the same seed picks the same targets.
    expect(wildHits(fight(killer(), foes(), { runeWildfire: true })).map((h) => h.target)).toEqual(hits.map((h) => h.target));
  });
  it('cannot chain: a kill made by Wildfire\'s own damage never triggers it (a big budget proves it is not the cap)', () => {
    // The Stealthed B cannot be attacked, so the only minion kill is A; Wildfire's 5 then kills B, and that is all.
    const r = fight([bm('k', NEUTRAL, { attack: 1, health: 5000, keywords: [] })],
      [bm('a', PLAIN[2]!, { attack: 5, health: 1, keywords: [] }), bm('b', PLAIN[2]!, { attack: 0, health: 5, keywords: ['ST'] })],
      { runeWildfire: true, flagCopies: { runeWildfire: 3 } });
    const b = uidOf(r, 'b', 'enemy');
    expect(r.events.some((e) => e.type === 'death' && e.target === b)).toBe(true);
    expect(triggers(r.events, 'runeWildfire')).toHaveLength(1);
    expect(wildHits(r).map((h) => [h.target, h.amount])).toEqual([[b, 5]]);
  });
  it('a 0-Attack enemy\'s death spends nothing', () => {
    const r = fight(killer(), [wall(0, 'w', 5000), ...Array.from({ length: 4 }, (_, i) => dummy(`z${i}`))], { runeWildfire: true });
    expect(r.events.filter((e) => e.type === 'death' && (e as { side: string }).side === 'enemy').length).toBeGreaterThan(0);
    expect(triggers(r.events, 'runeWildfire')).toHaveLength(0);
  });
  it('a Hellfire volley kill IS a minion kill (the Demon deals it), so it fires Wildfire', () => {
    // A Taunt wall soaks every swing, so A (3/1) can only die to the Demon's Hellfire volley.
    const r = fight([bm('d', 'dm_knocked', { attack: 1, health: 5000, keywords: [] })],
      [bm('w', PLAIN[1]!, { attack: 0, health: 5000, keywords: ['T'] }), bm('a', PLAIN[2]!, { attack: 3, health: 1, keywords: [] })], { runeHellfire: true, runeWildfire: true });
    expect(triggers(r.events, 'runeWildfire')).toHaveLength(1);
    expect(wildHits(r)[0]!.amount).toBe(3);
  });
  it('is not Demon damage: Rad Rachel never hears a Wildfire hit', () => {
    const r = fight([...killer(), bm('r', 'dm_radrachel', { attack: 0, health: 5000 })], foes(), { runeWildfire: true });
    expect(triggers(r.events, 'runeWildfire').length).toBeGreaterThan(0);
    const rach = uidOf(r, 'r');
    expect(r.events.filter((e) => e.type === 'buff' && (e as Buff).source === rach).length).toBe(0);
  });
  it('works for a served enemy side the same way (symmetric)', () => {
    const e = fight(foes(), killer(), {}, 4, { runeWildfire: true });
    expect(triggers(e.events, 'runeWildfire', 'enemy')).toHaveLength(3);
    const hits = wildHits(e, 'enemy');
    expect(hits.length).toBe(3);
    expect(hits.every((h) => h.amount === 4)).toBe(true);
  });
});

describe("ELDER'S VOICE: Your first Shout each turn also triggers at Start of Combat", () => {
  it('Shop: the first Shout body of the turn is recorded (a later Shout does not replace it) and rides into combat', () => {
    let s = withRune(['rune_elders_voice'], { hand: [body('h1', 'd2_broodfire'), body('h2', 'd2_chronicler')] });
    s = act(s, { type: 'play', uid: 'h1' });
    const first = s.eldersVoiceUid;
    expect(first).toBeTruthy();
    expect(s.board.some((c) => c.uid === first && c.cardId === 'd2_broodfire')).toBe(true);
    s = act(s, { type: 'play', uid: 'h2' });
    expect(s.eldersVoiceUid).toBe(first);
    expect(questCombatMods(s).eldersVoiceUid).toBe(first);
    const without = act(withRune([], { hand: [body('h1', 'd2_broodfire')] }), { type: 'play', uid: 'h1' });
    expect(questCombatMods(without).eldersVoiceUid).toBeUndefined();
  });
  it('combat: that body Shouts once more at Start of Combat, once per copy; gone from the board, nothing', () => {
    const shouts = (r: Fight, src: string) => r.events.filter((e) => e.type === 'shout' && (e as { source: string }).source === uidOf(r, src)).length;
    const p = () => [bm('v', 'd2_broodfire', { health: 5000 }), bm('d', 'd2_humphry', { health: 5000 })];
    const on = fight(p(), [wall(0)], { runeEldersVoice: true, eldersVoiceUid: 'v' });
    expect(shouts(on, 'v')).toBe(1);
    expect(triggers(on.events, 'runeEldersVoice')).toHaveLength(1);
    expect(shouts(fight(p(), [wall(0)], { runeEldersVoice: true, eldersVoiceUid: 'v', flagCopies: { runeEldersVoice: 2 } }), 'v')).toBe(2);
    expect(shouts(fight(p(), [wall(0)], { runeEldersVoice: true, eldersVoiceUid: 'v', runeTwilight: true }), 'v'), 'not a "Start of Combat:" rune: Twilight does not repeat it').toBe(1);
    expect(triggers(fight(p(), [wall(0)], { runeEldersVoice: true, eldersVoiceUid: 'gone' }).events, 'runeEldersVoice')).toHaveLength(0);
    expect(shouts(fight(p(), [wall(0)], {}), 'v')).toBe(0);
  });
});

describe('VEIN FINDER: After every 3rd Refresh, cast a Ruby on all your minions', () => {
  it('every 3rd Refresh pressed lands a Ruby on every board minion; the badge counts N/3', () => {
    let s = withRune(['rune_vein_finder'], { freeRolls: 6, board: [plain('a', 0), plain('b', 1)] });
    expect(runeTally(s, 'rune_vein_finder')).toBe('0/3');
    s = act(s, { type: 'roll' }); s = act(s, { type: 'roll' });
    expect(runeTally(s, 'rune_vein_finder')).toBe('2/3');
    expect(s.board.map((c) => sumFrom(c, 'Ruby').attack)).toEqual([0, 0]);
    s = act(s, { type: 'roll' });
    expect(s.board.map((c) => sumFrom(c, 'Ruby').attack)).toEqual([1, 1]);
    for (let i = 0; i < 3; i++) s = act(s, { type: 'roll' });
    expect(s.board.map((c) => sumFrom(c, 'Ruby').attack)).toEqual([2, 2]);
  });
});

describe('GEM RAIN: Start of Combat: cast 2 permanent Rubies on all your minions', () => {
  it('2 Rubies on every friendly minion, carried back to the Shop; per copy and Twilight repeat it', () => {
    const p = () => [bm('n', NEUTRAL, { health: 5000 }), bm('k', 'k_veinbreaker', { health: 5000 })];
    const r = fight(p(), [wall(0)], { runeGemRain: true });
    for (const src of ['n', 'k']) {
      const first = rubyBuffsOn(r, uidOf(r, src))[0]!;
      expect([first.attack, first.health]).toEqual([2, 2]);
      const home = (r.playerPermaBuffs ?? []).filter((b) => b.sourceUid === src && b.ruby).reduce((t, b) => t + b.attack, 0);
      expect(home, `${src}: the Rubies carry back`).toBe(2);
    }
    const n = (x: Fight) => triggers(x.events, 'runeGemRain').length;
    expect([n(r), n(fight(p(), [wall(0)], { runeGemRain: true, flagCopies: { runeGemRain: 2 } })), n(fight(p(), [wall(0)], { runeGemRain: true, runeTwilight: true }))]).toEqual([1, 2, 2]);
  });
  it('with Engraving Gems: the same 2 permanent Rubies (no double carry), and Engraving does not claim them', () => {
    const p = () => [bm('n', NEUTRAL, { health: 5000 })];
    const both = fight(p(), [wall(0)], { runeGemRain: true, runeEngravingGems: true });
    const home = (both.playerPermaBuffs ?? []).filter((b) => b.sourceUid === 'n' && b.ruby).reduce((t, b) => t + b.attack, 0);
    expect(home).toBe(2);
    expect(triggers(both.events, 'runeEngravingGems')).toHaveLength(0);
  });
  it('an enemy snapshot side with Gem Rain gets its Rubies too (symmetric), and a snapshot carries the flag', () => {
    const r = fight([wall(0)], [bm('n', NEUTRAL, { health: 5000 })], {}, 4, { runeGemRain: true });
    expect(triggers(r.events, 'runeGemRain', 'enemy')).toHaveLength(1);
    const s = withRune(['rune_gem_rain'], { board: [plain('a', 0)] });
    expect(snapshotBoard(s).questMods?.runeGemRain).toBe(true);
  });
});
