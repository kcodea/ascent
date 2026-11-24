/**
 * FOUR RUNES AND THEIR THREE RUNE-ONLY MINIONS, owner design 2026-11-23 (R-WIZENED-1123-01..04):
 *
 *   Wizened Gems  Basic  Kobold   3  When you cast 3 Shop spells, improve your Rubies by +1/+1 and get a Ruby.
 *   Petah         Basic  Beast    3  Get a Petah.        Beast T4 4/3: cast a spell, 2 other random Beasts +3/+3.
 *   Furlboggen    Epic   Kobold   4  Get a Furlboggen.   Kobold T6 8/6: a Ruby cast on it, a Ruby on each other type.
 *   Huntsman      Epic   none     3  Get a Huntsman.     Neutral T6 12/12: any minion dies, +6/+6 permanently, x2 in the Shop.
 *
 * Every block drives the real engine: the Runeforge `buyRune`, the reducer's `play` / `faceOmen` / settle, `castSpell`,
 * `applyEndOfTurn` and `simulate()` on both sides. The live-text half is packages/ui/src/wizenedRunes1123Text.test.tsx.
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { ANCIENT_IDS, CONFIG, createRun, enableAncients, reduce, reduceWithPresentation, type Action, type BoardCard, type RunState } from './index';
import { applyEndOfTurn, castSpell, consumeShopMinion, destroyMinionInShop, fireGravetwinEchoes, fireOnRubyPlayed, fireRecruitDeathrattlesForTest, makeContext, noteSpellCast, replayBattlecry, settlePendingDeath } from './recruit';
import { questCombatMods } from './reducer';
import { runeLiveStateInCombat, runeLiveStateOfRun, runeLiveStateOfSnapshot } from './runeLiveState';
import { snapshotBoard } from './snapshot';
import { sideFromSnapshot } from './boardSide';
import { deserialize, handCap, serialize } from './state';
import { runeLiveTally, runeTally } from '../../ui/src/runeTally';
import { runeProgress } from '../../ui/src/choreo/triggerCounts';

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
function base(extra: Partial<RunState> = {}, set: 'set2' | 'set3' = 'set2'): RunState {
  return {
    ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, set),
    tribes: [...SETS[set].tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor(set).buyable.map((c) => [c.id, 5])),
    ...extra,
  } as RunState;
}
const buy = (s: RunState, id: string): RunState => act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
const withRune = (ids: string[], extra: Partial<RunState> = {}): RunState => ({ ...ids.reduce(buy, base()), ...extra });
const owned = (s: RunState, cardId: string): BoardCard[] => [...s.hand, ...s.board].filter((c) => c.cardId === cardId);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const line = (c: { attack: number; health: number }): string => `${c.attack}/${c.health}`;
const NONE = { attack: 0, health: 0 };
const rubyOn = (c: BoardCard) => (c.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((t, b) => ({ attack: t.attack + b.attack, health: t.health + b.health }), NONE);
const ruby = (uid: string): BoardCard => body(uid, 'ruby', { attack: 1, health: 1 });
const playRuby = (s: RunState, uid: string, target: string): RunState => act(s, { type: 'play', uid, targetUid: target });
const filler = (uid: string): BoardCard => body(uid, 'sandbag', { attack: 1, health: 1 });

/** An untargeted Set 2 Shop spell that moves nobody's stats, so every stat change below is the card under test. */
const POUCH = CARD_INDEX['emberpouch']!;
const cast = (s: RunState, n = 1): RunState => { for (let i = 0; i < n; i++) castSpell(s, POUCH); return s; };

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (cardId: string, uid: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...CARD_INDEX[cardId]!.keywords], ...extra } as BoardMinion);
const fight = (p: BoardMinion[], e: BoardMinion[], pm: QuestCombatMods = {}, em: QuestCombatMods = {}, seed = 11) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: pm }), combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: em }));
type Buff = Extract<CombatEvent, { type: 'buff' }>;
const buffsFrom = (r: ReturnType<typeof fight>, side: 'player' | 'enemy', cardId: string): Buff[] => {
  const src = new Set(r.initial[side].filter((m) => m.cardId === cardId).map((m) => m.uid));
  return r.events.filter((e): e is Buff => e.type === 'buff' && src.has(e.source ?? ''));
};
const deathsOf = (r: ReturnType<typeof fight>): number => r.events.filter((e) => e.type === 'death').length;
const perma = (ps: { sourceUid: string; attack: number; health: number }[] | undefined, uid: string) =>
  (ps ?? []).filter((p) => p.sourceUid === uid).reduce((t, p) => ({ attack: t.attack + p.attack, health: t.health + p.health }), NONE);

/** Three DIFFERENT Beasts whose effects a Shop cast, a Ruby or a death never wakes (three of one card would triple). */
const BEASTS = Object.values(CARD_INDEX).filter((c) => c.tribe === 'beast' && !c.tribe2 && !c.spell && !c.universalTribe && c.keywords.length === 0 && c.effects.every((e) => e.on === 'onAttack')).map((c) => c.id);
const BEAST = BEASTS[0]!;
const beast = (uid: string): BoardCard => body(uid, BEASTS[Number(uid.slice(1) || 1) - 1]!);

describe('content', () => {
  it('the fixtures are three different Beasts', () => { expect(new Set(BEASTS.slice(0, 3)).size).toBe(3); });
  it('the four runes: name, cost, pool, sets, tribe gate, text', () => {
    const rows: [string, string, number, boolean, readonly string[] | undefined, string[], string][] = [
      ['rune_wizened_gems', 'Wizened Gems', 3, false, ['kobold'], ['set2', 'set3'], 'When you cast **3 Shop spells**, improve your **Rubies** by **+1/+1** and get a **Ruby**.'],
      ['rune_petah', 'Petah', 3, false, ['beast'], ['set2'], 'Get a **Petah**.'],
      ['rune_furlboggen', 'Furlboggen', 4, true, ['kobold'], ['set2', 'set3'], 'Get a **Furlboggen**.'],
      ['rune_huntsman', 'Huntsman', 3, true, undefined, ['set2', 'set3'], 'Get a **Huntsman**.'],
    ];
    for (const [id, name, cost, epic, tribes, sets, text] of rows) {
      const r = (epic ? EPIC_RUNES : RUNES).find((x) => x.id === id)!;
      expect([r.name, r.cost, !!r.epic, r.tribes, r.sets, r.text], id).toEqual([name, cost, epic, tribes, sets, text]);
    }
  });
  it('the three minions are tokens at their printed line, in no Shop pool of either set', () => {
    const rows: [string, string, string, number, number, number][] = [
      ['b2_petah', 'Petah', 'beast', 4, 4, 3],
      ['k_furlboggen', 'Furlboggen', 'kobold', 6, 8, 6],
      ['n2_huntsman', 'Huntsman', 'neutral', 6, 12, 12],
    ];
    for (const [id, name, tribe, tier, a, h] of rows) {
      const d = CARD_INDEX[id]!;
      expect([d.name, d.tribe, d.tier, d.attack, d.health, d.token], id).toEqual([name, tribe, tier, a, h, true]);
      for (const set of ['set2', 'set3'] as const) expect(poolFor(set).buyable.some((c) => c.id === id), `${id} ${set}`).toBe(false);
    }
  });
  it('no em dash, "--", "Oath" or "climb" in any of the texts', () => {
    const texts = [
      ...['rune_wizened_gems', 'rune_petah', 'rune_furlboggen', 'rune_huntsman'].map((id) => RUNE_INDEX[id]!.text),
      ...['b2_petah', 'k_furlboggen', 'n2_huntsman'].flatMap((id) => [CARD_INDEX[id]!.text, CARD_INDEX[id]!.goldenText!]),
    ];
    for (const t of texts) expect(t).not.toMatch(/—|--|oath|climb/i);
  });
  it('each grant rune hands over one copy, in Set 3 too, and a second copy of the rune another', () => {
    for (const [rune, card] of [['rune_petah', 'b2_petah'], ['rune_furlboggen', 'k_furlboggen'], ['rune_huntsman', 'n2_huntsman']] as const) {
      const s = withRune([rune]);
      expect(owned(s, card).map((c) => c.golden), rune).toEqual([false]);
      expect(owned(buy(s, rune), card), rune).toHaveLength(2);
    }
    expect(owned(buy(base({}, 'set3'), 'rune_furlboggen'), 'k_furlboggen')).toHaveLength(1);
    expect(owned(buy(base({}, 'set3'), 'rune_huntsman'), 'n2_huntsman')).toHaveLength(1);
  });
});

describe('WIZENED GEMS in the Shop', () => {
  const run = (extra: Partial<RunState> = {}): RunState => withRune(['rune_wizened_gems'], { rubyBonus: { ...NONE }, ...extra });
  const rubies = (s: RunState): BoardCard[] => s.hand.filter((c) => c.cardId === 'ruby');

  it('every 3rd Shop spell: Rubies +1/+1 for the run and one Ruby at that strength, repeating; a Ruby in hand grows too', () => {
    const s = cast(run({ hand: [ruby('r0')] }), 2);
    expect([s.rubyBonus, rubies(s).length, runeTally(s, 'rune_wizened_gems')]).toEqual([NONE, 1, '2/3']);
    cast(s);
    expect(s.rubyBonus).toEqual({ attack: 1, health: 1 });
    expect(rubies(s).map(line)).toEqual(['2/2', '2/2']);
    expect(runeTally(s, 'rune_wizened_gems')).toBe('0/3');
    cast(s, 3);
    expect([s.rubyBonus, rubies(s).length]).toEqual([{ attack: 2, health: 2 }, 3]);
    expect(s.runeProcs?.['rune_wizened_gems']).toBe(2);
  });
  it('without the rune: nothing (the mutation check)', () => {
    const s = cast(base({ rubyBonus: { ...NONE } }), 6);
    expect([s.rubyBonus, rubies(s).length, s.runeWizenedGemsTick, runeTally(s, 'rune_wizened_gems')]).toEqual([NONE, 0, undefined, null]);
  });
  it('two copies pay twice on the one count', () => {
    const s = cast({ ...buy(run(), 'rune_wizened_gems'), hand: [] } as RunState, 3);
    expect([s.rubyBonus, rubies(s).length]).toEqual([{ attack: 2, health: 2 }, 2]);
  });
  it('a full hand loses the Ruby and keeps the improvement; the count starts over', () => {
    const s = run();
    s.hand = Array.from({ length: handCap(s) }, (_, i) => filler(`h${i}`));
    cast(s, 3);
    expect([rubies(s).length, s.rubyBonus, s.runeWizenedGemsTick]).toEqual([0, { attack: 1, health: 1 }, 0]);
  });
  it('a hand cast counts, and each repeat of it counts (Yazzus)', () => {
    const s0 = run({ board: [body('a', 'sandbag')], hand: [body('f', 'spiritfire')] });
    expect(act(s0, { type: 'play', uid: 'f', targetUid: 'a' }).runeWizenedGemsTick).toBe(1);
    const s1 = run({ board: [body('a', 'sandbag'), body('y', 'yazzus')], hand: [body('f', 'spiritfire')] });
    expect(act(s1, { type: 'play', uid: 'f', targetUid: 'a' }).runeWizenedGemsTick).toBe(2);
  });
  it('a Ruby, a Clue-type Gift and a reward token are not Shop spells; with the Spellstone a Ruby is', () => {
    const s = run({ board: [body('a', 'sandbag')], hand: [ruby('r1')] });
    noteSpellCast(s, CARD_INDEX['tower_shield']!);
    noteSpellCast(s, CARD_INDEX['discoverspell']!);
    expect(s.runeWizenedGemsTick ?? 0).toBe(0);
    expect(playRuby(s, 'r1', 'a').runeWizenedGemsTick ?? 0).toBe(0);
    const st = { ...withRune(['rune_wizened_gems', 'rune_spellstone']), board: [body('a', 'sandbag')], hand: ['r1', 'r2', 'r3'].map(ruby), rubyBonus: { ...NONE } } as RunState;
    const after = ['r1', 'r2', 'r3'].reduce((x, u) => playRuby(x, u, 'a'), st);
    expect(after.rubyBonus).toEqual({ attack: 1, health: 1 });
    expect([rubies(after).length, after.runeWizenedGemsTick], 'three Rubies buy one Ruby: it does not feed itself').toEqual([1, 0]);
  });
  it('its own payout never counts: a payout under a get-a-Ruby watcher resolves once', () => {
    const s = run({ board: [body('g', 'k_gemsage'), body('a', 'sandbag')] });
    cast(s, 3);
    expect(s.runeWizenedGemsTick).toBe(0);
    expect(s.runeProcs?.['rune_wizened_gems']).toBe(1);
  });
  it('the count persists across turns and through a save', () => {
    const s = cast(run(), 2);
    const loaded = deserialize(serialize(s));
    expect(loaded.runeWizenedGemsTick).toBe(2);
    expect(runeTally(loaded, 'rune_wizened_gems')).toBe('2/3');
    let next = act(act(act({ ...loaded, board: [body('a', 'sandbag', { attack: 50, health: 500 })] } as RunState, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(next.wave).toBe(8);
    expect(next.runeWizenedGemsTick).toBe(2);
    next = { ...next, rubyBonus: { ...NONE } } as RunState;
    cast(next);
    expect(next.rubyBonus).toEqual({ attack: 1, health: 1 });
  });
  it('END OF TURN: Soul Defiler casting 2 Shop spells pays inside End of Turn, and the same turn\'s fight has the Rubies', () => {
    const s = cast(run({ board: [body('d', 'dm_curator')] }), 1);
    const omen = act(s, { type: 'faceOmen' });
    expect(omen.rubyBonus, 'paid at End of Turn, before the fight').toEqual({ attack: 1, health: 1 });
    expect(omen.runeWizenedGemsTick).toBe(0);
    expect(questCombatMods(omen).runeWizenedGems).toBe(true);
  });
  it('determinism: the same run replayed gives the same state', () => {
    const go = () => serialize(cast(run({ board: [beast('b1'), beast('b2'), beast('b3'), body('p', 'b2_petah')] }), 7));
    expect(go()).toBe(go());
  });
});

describe('WIZENED GEMS in combat', () => {
  const CASTERS = (): BoardMinion[] => [bm('d2_flamebeat', 'fb', 1, 900)]; // Rally: cast Dragonflame (a Set 2 Shop spell)
  const WALL = (): BoardMinion[] => [bm('sandbag', 'W', 0, 9000)];
  type Tally = Extract<CombatEvent, { type: 'shopSpellTally' }>;
  const tallies = (r: ReturnType<typeof fight>, side = 'player') => r.events.filter((e): e is Tally => e.type === 'shopSpellTally' && e.side === side);

  it.each([0, 1, 2])('a count started in the Shop (%i) continues; the third cast pays mid-fight (Ruby power, a Ruby to hand, the badge) and the count comes home', (start) => {
    const s = cast(withRune(['rune_wizened_gems'], { rubyBonus: { ...NONE } }), start);
    const mods = questCombatMods(s);
    expect([mods.runeWizenedGems, mods.runeWizenedGemsTick ?? 0]).toEqual([true, start]);
    const r = fight(CASTERS(), WALL(), mods);
    const n = tallies(r).length;
    expect(n, 'Flamebeat cast several').toBeGreaterThan(3);
    const trips = Math.floor((start + n) / 3);
    expect(tallies(r)[0]!.wizened, 'the live count on the first cast').toBe((start + 1) % 3);
    expect(r.playerRubyBonusGain).toEqual({ attack: trips, health: trips });
    expect(r.playerRubyGrants).toBe(trips);
    expect(r.events.filter((e) => e.type === 'questTrigger' && e.flag === 'runeWizenedGems' && e.side === 'player')).toHaveLength(trips);
    expect(r.events.filter((e) => e.type === 'toHand' && e.cardId === 'ruby' && e.side === 'player')).toHaveLength(trips);
    expect(r.playerShoutCarry?.wizenedGemsTick).toBe((start + n) % 3);
    // settle: the Rubies, the power and the count come home, exactly once.
    const after = act({ ...s, phase: 'combat', lastCombat: r } as RunState, { type: 'settleCombat' });
    expect([after.rubyBonus, after.runeWizenedGemsTick]).toEqual([{ attack: trips, health: trips }, (start + n) % 3]);
    expect(after.hand.filter((c) => c.cardId === 'ruby').map(line)).toEqual(Array(Math.min(trips, handCap(after))).fill(`${1 + trips}/${1 + trips}`));
  });
  it('without the rune nothing moves and the marker carries no count (the mutation check)', () => {
    const r = fight(CASTERS(), WALL());
    expect(tallies(r).length).toBeGreaterThan(0);
    expect(tallies(r).every((e) => e.wizened === undefined)).toBe(true);
    expect([r.playerRubyBonusGain?.attack ?? 0, r.playerRubyGrants ?? 0, r.playerShoutCarry?.wizenedGemsTick]).toEqual([0, 0, undefined]);
  });
  it('two copies pay double; a served enemy side runs the same rule (symmetric)', () => {
    const one = fight(CASTERS(), WALL(), { runeWizenedGems: true });
    const two = fight(CASTERS(), WALL(), { runeWizenedGems: true, flagCopies: { runeWizenedGems: 2 } });
    expect(two.playerRubyBonusGain!.attack).toBe(one.playerRubyBonusGain!.attack * 2);
    const foe = fight(WALL(), CASTERS(), {}, { runeWizenedGems: true });
    expect(tallies(foe, 'enemy').map((e) => e.wizened)).toEqual(tallies(one).map((e) => e.wizened));
    expect(foe.playerRubyBonusGain?.attack ?? 0).toBe(0);
  });
  it('with the Spellstone a combat Ruby counts; its own payout\'s Rubies never do', () => {
    const blazer = [bm('k_blazer', 'bz', 1, 900), bm('k_gemsage', 'gs', 0, 900)];
    const r = fight(blazer, WALL(), { runeWizenedGems: true, runeSpellstone: true });
    const landings = r.events.filter((e) => e.type === 'buff' && e.ruby === true).length;
    expect(tallies(r)).toHaveLength(landings);
    expect(r.playerRubyGrants).toBe(Math.floor(landings / 3));
    expect(tallies(fight(blazer, WALL(), { runeWizenedGems: true })), 'no Spellstone, no count').toHaveLength(0);
  });
  it('the badge ticks live off the replay, and an opponent\'s rail reads its snapshot', () => {
    const s = cast(withRune(['rune_wizened_gems']), 2);
    const r = fight(CASTERS(), WALL(), questCombatMods(s));
    const i = r.events.indexOf(tallies(r)[0]!);
    const mid = runeLiveStateInCombat(runeLiveStateOfRun(s), runeProgress(r.events, i + 1, false, 'player', undefined));
    expect(runeLiveTally('rune_wizened_gems', runeLiveStateOfRun(s))).toBe('2/3');
    expect(runeLiveTally('rune_wizened_gems', mid)).toBe('0/3');
    const snap = snapshotBoard({ ...s, board: [body('a', 'sandbag')] } as RunState);
    expect([snap.questMods?.runeWizenedGems, snap.questMods?.runeWizenedGemsTick]).toEqual([true, 2]);
    expect(sideFromSnapshot(snap, 6, []).questMods?.runeWizenedGemsTick).toBe(2);
    expect(runeLiveStateOfSnapshot(snap).wizenedGems).toBe(2);
  });
});

describe('PETAH: "When you cast a spell, give 2 other random Beasts +3/+3."', () => {
  const board = (golden = false): BoardCard[] => [body('p', 'b2_petah', { golden }), beast('b1'), beast('b2'), beast('b3'), body('k', 'k_beggy')];
  const gains = (s: RunState) => s.board.map((c) => c.attack - (board().find((x) => x.uid === c.uid)!.attack));

  it.each([[false, 3], [true, 6]] as const)('golden=%s: one Shop spell, two DIFFERENT other Beasts +%i/+%i, never itself, never a Kobold', (golden, n) => {
    const s = cast(base({ board: board(golden) }));
    expect(gains(s).filter((g) => g === n)).toHaveLength(2);
    expect([gains(s)[0], gains(s)[4]]).toEqual([0, 0]);
    for (const c of s.board) expect(c.health - board().find((x) => x.uid === c.uid)!.health).toBe(c.attack - board().find((x) => x.uid === c.uid)!.attack);
  });
  it('without Petah: nothing (the mutation check)', () => {
    const s = cast(base({ board: board().slice(1) }));
    expect(s.board.map(line)).toEqual(board().slice(1).map(line));
  });
  it('alone, or with no other Beast, it does nothing and never buffs itself', () => {
    const s = cast(base({ board: [body('p', 'b2_petah'), body('k', 'k_beggy')] }));
    expect(s.board.map(line)).toEqual(['4/3', line(CARD_INDEX['k_beggy']!)]);
  });
  it('two Petahs each fire, and each may pick the other', () => {
    const s = cast(base({ board: [body('p', 'b2_petah'), body('q', 'b2_petah')] }));
    expect(s.board.map(line)).toEqual(['7/6', '7/6']);
  });
  it('every kind of spell: a Ruby from hand, a Gift and a Whisper-type cast count; a reward token does not; a Spellstone Ruby fires once', () => {
    const total = (s: RunState) => s.board.filter((c) => c.uid !== 'k' && c.uid !== 'p').reduce((n, c) => n + c.attack - CARD_INDEX[c.cardId]!.attack, 0);
    expect(total(playRuby(base({ board: board(), hand: [ruby('r')] }), 'r', 'k')), 'a Ruby').toBe(6);
    const gift = base({ board: board() }); noteSpellCast(gift, CARD_INDEX['tower_shield']!);
    expect(total(gift), 'a Gift').toBe(6);
    const tok = base({ board: board() }); noteSpellCast(tok, CARD_INDEX['discoverspell']!);
    expect(total(tok), 'a reward token').toBe(0);
    const st = { ...withRune(['rune_spellstone']), board: board(), hand: [ruby('r')] } as RunState;
    expect(total(playRuby(st, 'r', 'k')), 'a Spellstone Ruby').toBe(6);
  });
  it('each repeat of a cast fires it (Yazzus)', () => {
    const s = base({ board: [body('k', 'sandbag'), ...board().slice(0, 4), body('y', 'yazzus')], hand: [body('f', 'spiritfire')] });
    const after = act(s, { type: 'play', uid: 'f', targetUid: 'k' });
    expect(after.board.filter((c) => ['b1', 'b2', 'b3'].includes(c.uid)).reduce((n, c) => n + c.attack - CARD_INDEX[c.cardId]!.attack, 0)).toBe(12);
  });
  it('END OF TURN: Soul Defiler\'s casts buff the Beasts before the same turn\'s fight, each on its own beat', () => {
    const s = base({ board: [body('p', 'b2_petah'), beast('b1'), beast('b2'), body('d', 'dm_curator')] });
    const probe = structuredClone(s); applyEndOfTurn(probe);
    const without = structuredClone({ ...s, board: s.board.slice(1) }) as RunState; applyEndOfTurn(without);
    expect(at(probe, 'b1').attack - at(without, 'b1').attack).toBe(6); // 2 casts x +3
    const omen = act(s, { type: 'faceOmen' });
    const initial = omen.lastCombat!.initial.player[1]!;
    expect(initial.attack, 'in the fight already').toBe(at(omen, 'b1').attack);
    expect(at(omen, 'b1').attack).toBe(at(probe, 'b1').attack);
    const batch = reduceWithPresentation(structuredClone(s), { type: 'faceOmen' }, true).batch;
    const beats = JSON.stringify(batch).match(/factory:onSpellCastBuffRandomTribe:spellCast/g) ?? [];
    expect(beats.length).toBeGreaterThanOrEqual(2);
  });
  it('START OF TURN: a spell a Gravetwin Echo casts at the start of the Shop pays at once', () => {
    const s = base({ board: [body('g', 'gravetwin', { copiedEcho: [{ on: 'onDeath', do: 'echoCastRememberedSpells' }] }), ...board()], lastSurvivorCardIds: ['gravetwin'], rememberedSpellIds: ['emberpouch'] } as Partial<RunState>);
    const before = s.board.map((c) => c.attack);
    fireGravetwinEchoes(s);
    const gained = s.board.filter((c) => CARD_INDEX[c.cardId]!.tribe === 'beast').reduce((n, c) => n + c.attack, 0) - before.slice(1, 5).reduce((n, a) => n + a, 0);
    expect(gained).toBe(6);
  });
  it('COMBAT: every spell its side casts mid-fight pays two other Beasts, combat only, on either side', () => {
    const mine = [bm('b2_petah', 'P', 0, 4000), bm(BEAST, 'B1', 0, 4000), bm(BEAST, 'B2', 0, 4000), bm('d2_flamebeat', 'FB', 1, 900)];
    const r = fight(mine, [bm('sandbag', 'W', 0, 9000)]);
    const casts = r.events.filter((e) => e.type === 'spellcast' && e.side === 'player').length;
    const bs = buffsFrom(r, 'player', 'b2_petah');
    expect(casts).toBeGreaterThan(0);
    expect(bs.map((b) => `${b.attack}/${b.health}`)).toEqual(Array(casts * 2).fill('3/3'));
    const petahUid = r.initial.player.find((m) => m.cardId === 'b2_petah')!.uid;
    expect(bs.some((b) => b.target === petahUid)).toBe(false);
    expect([perma(r.playerPermaBuffs, 'B1'), perma(r.playerPermaBuffs, 'B2')]).toEqual([NONE, NONE]);
    const foe = fight([bm('sandbag', 'W', 0, 9000)], mine);
    expect(buffsFrom(foe, 'enemy', 'b2_petah')).toHaveLength(foe.events.filter((e) => e.type === 'spellcast' && e.side === 'enemy').length * 2);
    expect(buffsFrom(fight(mine, [bm('d2_flamebeat', 'X', 1, 900)]), 'player', 'b2_petah').length, 'only its own side\'s casts').toBe(
      fight(mine, [bm('d2_flamebeat', 'X', 1, 900)]).events.filter((e) => e.type === 'spellcast' && e.side === 'player').length * 2);
  });
  it.each([false, true])('COMBAT: a Ruby cast mid-fight is a spell, exactly once (Spellstone %s)', (stone) => {
    const mine = [bm('b2_petah', 'P', 0, 4000), bm(BEAST, 'B1', 0, 4000), bm(BEAST, 'B2', 0, 4000), bm('k_blazer', 'BZ', 1, 900)];
    const r = fight(mine, [bm('sandbag', 'W', 0, 9000)], stone ? { runeSpellstone: true } : {});
    const landings = r.events.filter((e) => e.type === 'buff' && e.ruby === true).length;
    expect(landings).toBeGreaterThan(0);
    expect(buffsFrom(r, 'player', 'b2_petah').filter((b) => !b.ruby)).toHaveLength(landings * 2);
  });
});

describe('FURLBOGGEN: "When a Ruby is cast on this, cast a Ruby on another minion of each type."', () => {
  const DRAGON = Object.values(CARD_INDEX).find((c) => c.tribe === 'dragon' && !c.tribe2 && !c.spell && !c.token && c.effects.length === 0 && c.keywords.length === 0 && !c.universalTribe)?.id ?? 'd2_flamebeat';
  const board = (golden = false): BoardCard[] => [
    body('f', 'k_furlboggen', { golden }), body('k', 'k_beggy'), body('k2', 'k_beggy'), beast('b'), body('d', DRAGON), body('n', 'sandbag'),
  ];
  const landed = (s: RunState): string[] => s.board.map((c) => line(rubyOn(c)));

  it.each([[false, '1/1'], [true, '2/2']] as const)('golden=%s: a Ruby on it lands a Ruby on the FIRST other Kobold, the Beast and the Dragon, never a Neutral, never itself again', (golden, n) => {
    const s = playRuby(base({ board: board(golden), hand: [ruby('r')] }), 'r', 'f');
    expect(landed(s)).toEqual(['1/1', n, '0/0', n, n, '0/0']);
  });
  it('a Ruby on another minion does nothing, and without Furlboggen the Ruby is one Ruby (the mutation check)', () => {
    expect(landed(playRuby(base({ board: board(), hand: [ruby('r')] }), 'r', 'k'))).toEqual(['0/0', '1/1', '0/0', '0/0', '0/0', '0/0']);
    const bare = board(); bare[0] = body('f', 'k_geode');
    expect(landed(playRuby(base({ board: bare, hand: [ruby('r')] }), 'r', 'f'))).toEqual(['1/1', '0/0', '0/0', '0/0', '0/0', '0/0']);
  });
  it('two Furlboggens: the other takes the Kobold Ruby and does NOT answer it; no loop', () => {
    const s = playRuby(base({ board: [body('f', 'k_furlboggen'), body('g', 'k_furlboggen'), beast('b')], hand: [ruby('r')] }), 'r', 'f');
    expect(landed(s)).toEqual(['1/1', '1/1', '1/1']);
    const again = playRuby({ ...s, hand: [ruby('r2')] } as RunState, 'r2', 'g');
    expect(landed(again), 'the latch is released: the next Ruby answers again').toEqual(['2/2', '2/2', '2/2']);
  });
  it('once per Ruby: a Yazzus Ruby that lands 2 times fans out 2 times; an All-types body takes its own slot', () => {
    const s = playRuby(base({ board: [...board().slice(0, 4), body('y', 'yazzus')], hand: [ruby('r')] }), 'r', 'f');
    expect(landed(s)).toEqual(['2/2', '2/2', '0/0', '2/2', '0/0']);
    const all = Object.values(CARD_INDEX).find((c) => c.universalTribe && !c.spell)!.id;
    const u = playRuby(base({ board: [body('f', 'k_furlboggen'), body('u', all), body('k', 'k_beggy')], hand: [ruby('r')] }), 'r', 'f');
    expect(landed(u)).toEqual(['1/1', '1/1', '1/1']);
  });
  it('its Rubies carry the run\'s Ruby power and wake the target\'s own Ruby watchers', () => {
    const s = playRuby(base({ board: [body('f', 'k_furlboggen'), beast('b')], hand: [ruby('r')], rubyBonus: { attack: 2, health: 1 } }), 'r', 'f');
    expect(rubyOn(at(s, 'b'))).toEqual({ attack: 3, health: 2 });
    expect(at(s, 'b').rubiesOnThisTurn).toBe(1);
  });
  it('a body born with Rubies is not a cast (0 Rubies), and one off the board does not answer', () => {
    const s = base({ board: board() });
    fireOnRubyPlayed(s, at(s, 'f'), 5, 5, undefined, 0);
    expect(landed(s)).toEqual(Array(6).fill('0/0'));
    const off = body('x', 'k_furlboggen');
    fireOnRubyPlayed(s, off, 1, 1);
    expect(landed(s)).toEqual(Array(6).fill('0/0'));
  });
  it('END OF TURN: Assembler\'s 2 Rubies fan out twice, each fan its own beat, in the same turn\'s fight', () => {
    const s = base({ board: [body('f', 'k_furlboggen'), body('as', 'k_assembler'), beast('b')] });
    const probe = structuredClone(s); applyEndOfTurn(probe);
    expect(landed(probe)).toEqual(['2/2', '2/2', '2/2']);
    const omen = act(s, { type: 'faceOmen' });
    expect(omen.lastCombat!.initial.player.find((m) => m.cardId === BEAST)!.attack).toBe(CARD_INDEX[BEAST]!.attack + 2);
    const batch = JSON.stringify(reduceWithPresentation(structuredClone(s), { type: 'faceOmen' }, true).batch);
    expect(batch.match(/factory:onRubyPlayedRubyEachType:onRubyPlayed/g) ?? []).toHaveLength(2);
  });
  it('COMBAT: a Ruby played on it mid-fight fans out, combat only, golden doubles, either side', () => {
    const mine = (golden = false) => [bm('k_blazer', 'BZ', 1, 4000), bm('k_furlboggen', 'F', 0, 4000, { golden }), bm(BEAST, 'B', 0, 4000)];
    const wall = [bm('sandbag', 'W', 0, 9000)];
    const run = (golden: boolean, side: 'player' | 'enemy') => {
      const r = side === 'player' ? fight(mine(golden), wall) : fight(wall, mine(golden));
      const uid = (c: string) => r.initial[side].find((m) => m.cardId === c)!.uid;
      const hits = r.events.filter((e): e is Buff => e.type === 'buff' && e.ruby === true);
      const onF = hits.filter((b) => b.target === uid('k_furlboggen')).length;
      return { r, onF, fan: hits.filter((b) => b.source === uid('k_furlboggen')), uid };
    };
    for (const side of ['player', 'enemy'] as const) {
      const plain = run(false, side), gold = run(true, side);
      expect(plain.onF).toBeGreaterThan(0);
      expect(plain.fan, 'Blazer (the other Kobold) and the Beast, once per Ruby on it').toHaveLength(plain.onF * 2);
      expect(plain.fan.some((b) => b.target === plain.uid('k_furlboggen'))).toBe(false);
      expect(gold.fan).toHaveLength(gold.onF * 4);
    }
    expect(perma(run(false, 'player').r.playerPermaBuffs, 'B')).toEqual(NONE);
  });
  it('COMBAT: two Furlboggens do not loop, and the Spellstone with a Ruby caster beside them still ends', () => {
    const mine = [bm('k_blazer', 'BZ', 1, 4000), bm('k_furlboggen', 'F', 0, 4000), bm('k_furlboggen', 'G', 0, 4000)];
    const r = fight(mine, [bm('sandbag', 'W', 0, 3000)], { runeSpellstone: true, runeRoughCut: true, runeConduit: 1 });
    const byF = r.events.filter((e): e is Buff => e.type === 'buff' && e.ruby === true && !e.bounce && r.initial.player.some((m) => m.cardId === 'k_furlboggen' && m.uid === e.source));
    const blazerOnF = r.events.filter((e): e is Buff => e.type === 'buff' && e.ruby === true && !e.bounce && r.initial.player.some((m) => m.cardId === 'k_furlboggen' && m.uid === e.target) && r.initial.player.some((m) => m.cardId === 'k_blazer' && m.uid === e.source));
    expect(byF).toHaveLength(blazerOnF.length); // each fan is exactly one Ruby: the first other Kobold
  });
});

describe('HUNTSMAN: "When any minion dies, gain +6/+6 permanently. Gains double in the Shop."', () => {
  it.each([[false, 6], [true, 12]] as const)('golden=%s COMBAT: +%i/+%i for each death on EITHER side, and it all carries home', (golden, n) => {
    const r = fight([bm('n2_huntsman', 'H', 50, 4000, { golden }), bm('sandbag', 'a', 1, 1)], ['x', 'y', 'z'].map((u) => bm('sandbag', u, 1, 1)));
    const friendly = r.events.filter((e) => e.type === 'death' && e.side === 'player').length;
    const foes = r.events.filter((e) => e.type === 'death' && e.side === 'enemy').length;
    expect([foes, deathsOf(r)]).toEqual([3, 3 + friendly]);
    const bs = buffsFrom(r, 'player', 'n2_huntsman');
    expect(bs.map((b) => `${b.attack}/${b.health}`), 'one gain per death').toEqual(Array(deathsOf(r)).fill(`${n}/${n}`));
    expect(perma(r.playerPermaBuffs, 'H')).toEqual({ attack: n * deathsOf(r), health: n * deathsOf(r) });
    const s = { ...base({ board: [body('H', 'n2_huntsman', { golden })] }), phase: 'combat', lastCombat: r } as RunState;
    const after = act(s, { type: 'settleCombat' });
    expect(at(after, 'H').attack).toBe(12 + n * deathsOf(r));
  });
  it('two Huntsmen each gain; a served enemy Huntsman gains the same way (symmetric)', () => {
    const two = fight([bm('n2_huntsman', 'H', 50, 4000), bm('n2_huntsman', 'I', 50, 4000)], [bm('sandbag', 'x', 0, 1), bm('sandbag', 'y', 0, 1)]);
    expect([perma(two.playerPermaBuffs, 'H').attack, perma(two.playerPermaBuffs, 'I').attack]).toEqual([12, 12]);
    const foe = fight([bm('sandbag', 'x', 0, 1), bm('sandbag', 'y', 0, 1)], [bm('n2_huntsman', 'H', 50, 4000)]);
    expect(buffsFrom(foe, 'enemy', 'n2_huntsman')).toHaveLength(2);
  });
  it('a Rise death is a death; its own death pays it nothing, and it is not saved by a death in the same clash', () => {
    const rise = fight([bm('n2_huntsman', 'H', 50, 4000)], [bm('sandbag', 'x', 0, 1, { keywords: ['R'] })]);
    expect(deathsOf(rise)).toBe(2);
    expect(buffsFrom(rise, 'player', 'n2_huntsman')).toHaveLength(2);
    const mutual = fight([bm('n2_huntsman', 'H', 5, 5)], [bm('sandbag', 'x', 5, 5)]);
    expect(deathsOf(mutual), 'both die; the +6 Health never brings a dying Huntsman back').toBe(2);
    expect(buffsFrom(mutual, 'player', 'n2_huntsman')).toHaveLength(0);
  });
  it('a risen Huntsman is a combat-only copy: what it gains after its Rise does not carry home (R-RISE-06)', () => {
    const r = fight([bm('n2_huntsman', 'H', 60, 1, { keywords: ['R', 'T'] })], [bm('sandbag', 'w', 200, 500), bm('sandbag', 'x', 0, 1)], {}, {}, 3);
    const died = r.events.findIndex((e) => e.type === 'death' && e.side === 'player');
    expect(died).toBeGreaterThanOrEqual(0);
    const before = buffsFrom(r, 'player', 'n2_huntsman').filter((b) => r.events.indexOf(b) < died).length;
    expect(perma(r.playerPermaBuffs, 'H').attack).toBe(6 * before);
  });
  it('MASS DEATH: a board of tokens dying on both sides is exactly one gain per death, and the fight ends', () => {
    const t0 = performance.now();
    const r = fight([...['H', 'I', 'J'].map((u) => bm('n2_huntsman', u, 40, 9000)), ...['a', 'b', 'c', 'd'].map((u) => bm('blaster', u, 1, 1))], ['p', 'q', 'r', 's', 't', 'u', 'v'].map((u) => bm('blaster', u, 1, 1)));
    expect(buffsFrom(r, 'player', 'n2_huntsman').length).toBeLessThanOrEqual(deathsOf(r) * 3);
    expect(perma(r.playerPermaBuffs, 'H').attack).toBeGreaterThanOrEqual(6 * 7);
    expect(performance.now() - t0).toBeLessThan(500);
  });
  it.each([[false, 12], [true, 24]] as const)('golden=%s SHOP: a destroyed minion pays double, +%i/+%i; two Huntsmen each', (golden, n) => {
    const s = base({ board: [body('H', 'n2_huntsman', { golden }), body('I', 'n2_huntsman', { golden }), body('v', 'sandbag')] });
    destroyMinionInShop(makeContext(s), at(s, 'v'));
    expect([line(at(s, 'H')), line(at(s, 'I'))]).toEqual([`${12 + n}/${12 + n}`, `${12 + n}/${12 + n}`]);
  });
  it('SHOP: the deferred destroy and a Rise death pay once each; a sale pays nothing; without Huntsman nothing grows', () => {
    const s = base({ board: [body('H', 'n2_huntsman'), body('v', 'sandbag', { keywords: ['R'] }), body('z', 'sandbag')] });
    s.pendingDeath = { uid: 'v', kind: 'destroy' };
    settlePendingDeath(s);
    expect(at(s, 'H').attack, 'the Rise death').toBe(24);
    const sold = act(base({ board: [body('H', 'n2_huntsman'), body('z', 'sandbag')] }), { type: 'sell', uid: 'z' });
    expect(at(sold, 'H').attack).toBe(12);
    const own = base({ board: [body('H', 'n2_huntsman'), body('I', 'n2_huntsman')] });
    destroyMinionInShop(makeContext(own), at(own, 'H'));
    expect([own.board.length, line(at(own, 'I'))]).toEqual([1, '24/24']);
  });
  it('SHOP: a Blaster Echo that kills several pays per death (R-WIZENED-1123-04), and a Huntsman it kills gains nothing', () => {
    const s = base({ board: [body('H', 'n2_huntsman'), body('b', 'blaster'), body('x', 'sandbag', { health: 2 }), body('y', 'sandbag', { health: 3 })] }, 'set3');
    destroyMinionInShop(makeContext(s), at(s, 'b')); // its own death, then its Echo deals 3 to all
    expect(s.board.map((c) => c.uid)).toEqual(['H']);
    expect(at(s, 'H').attack).toBe(12 + 12 * 3);
    const d = base({ board: [body('H', 'n2_huntsman', { health: 2 }), body('b', 'blaster'), body('x', 'sandbag', { health: 2 })] }, 'set3');
    destroyMinionInShop(makeContext(d), at(d, 'b'));
    expect(d.board).toEqual([]);
  });
  it('START OF TURN: a Gravetwin firing a Blaster Echo at the start of the Shop pays at once, at the Shop rate', () => {
    const s = base({ board: [body('g', 'gravetwin', { health: 50, copiedEcho: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }] }), body('H', 'n2_huntsman'), body('x', 'sandbag', { health: 1 })], lastSurvivorCardIds: ['gravetwin'] } as Partial<RunState>);
    fireGravetwinEchoes(s);
    expect(at(s, 'H').attack).toBe(24);
  });
  it('END OF TURN: deaths pay double before the same turn\'s fight, one beat per death', () => {
    const s = { ...withRune(['rune_reliquary']), board: [body('g', 'blaster', { health: 50 }), body('H', 'n2_huntsman', { health: 90 }), body('x', 'sandbag', { health: 1 }), body('y', 'sandbag', { health: 2 })] } as RunState;
    expect(s.questRecurringEndOfTurn?.length ?? 0, 'an End of Turn Echo rune is held').toBeGreaterThan(0);
    const probe = structuredClone(s); applyEndOfTurn(probe);
    const died = 4 - probe.board.length;
    expect(died).toBe(2);
    expect(at(probe, 'H').attack).toBe(12 + 12 * died);
    const omen = act(structuredClone(s), { type: 'faceOmen' });
    expect(omen.lastCombat!.initial.player.find((m) => m.cardId === 'n2_huntsman')!.attack).toBe(12 + 12 * died);
    const batch = JSON.stringify(reduceWithPresentation(structuredClone(s), { type: 'faceOmen' }, true).batch);
    expect(batch.match(/factory:onAnyDeathGainSelf:onDeath/g) ?? []).toHaveLength(died);
  });
  it('it is a watcher, not an Echo: nothing can trigger, copy or count it as one', () => {
    const r = fight([bm('n2_huntsman', 'H', 1, 1)], [bm('sandbag', 'w', 50, 500)]);
    expect(r.playerDeathrattles).toBe(0);
  });
});

/**
 * HUNTSMAN, every recruit-phase death (owner 2026-11-23: "Huntsman should also count on destroys / deaths in recruit phase
 * too"). Five engine sites announce a Shop death (`fireOnFriendDeath`): the immediate destroy (`destroyMinionInShop`), the
 * two-step destroy (`settlePendingDeath`), the spray (`shopSprayExceptTribe`), the damage-all verb and the (archived) Orbit
 * devour. Each family below goes through the real action, at +12/+12 a death.
 */
describe('HUNTSMAN in the recruit phase: every destroy and every death', () => {
  const H = (over: Partial<BoardCard> = {}): BoardCard => body('H', 'n2_huntsman', over);
  const gain = (s: RunState): number => at(s, 'H').attack - 12;
  const settle = (s: RunState): RunState => act(s, { type: 'resolveShopDeath' });

  it.each([['graverobber', 'sandbag'], ['u3_cagebreaker', 'u3_adeptus']] as const)('an aimed Shout that destroys (%s): once, when the body dies', (shout, victim) => {
    let s = base({ board: [H(), body('v', victim)], hand: [body('g', shout)] }, 'set3');
    s = act(s, { type: 'play', uid: 'g', toIndex: 2 });
    s = act(s, { type: 'battlecryTarget', targetUid: 'v' });
    expect([s.pendingDeath?.uid, gain(s)], 'marked, not dead yet').toEqual(['v', 0]);
    s = settle(s);
    expect([gain(s), s.board.some((c) => c.uid === 'v')]).toEqual([12, false]);
  });
  it.each([[false, 12], [true, 24]] as const)('a destroy spell (Grave Robbery), golden=%s: +%i', (golden, n) => {
    const s = base({ board: [H({ golden }), body('v', 'sandbag')], hand: [body('g', 'graverobbery')] }, 'set3');
    expect(gain(settle(act(s, { type: 'play', uid: 'g', targetUid: 'v' })))).toBe(n);
  });
  it('an Equipment destroy (Deathfibrillator): the Rise death counts, the risen body is alive', () => {
    let s = base({ board: [H(), body('v', 'u3_adeptus')], hand: [body('e', 'u3_ems')] }, 'set3');
    s = act(s, { type: 'play', uid: 'e', toIndex: 2 });
    s = settle(act(act(s, { type: 'selectEquipment', equipmentId: 'deathfibrillator' }), { type: 'activateEquipment', targetUid: 'v' }));
    expect([gain(s), s.board.filter((c) => c.cardId === 'u3_adeptus').length]).toEqual([12, 1]);
  });
  it('a destroy still pending when the fight starts settles first: the gain is in that turn\'s fight', () => {
    const s = base({ board: [H(), body('v', 'sandbag')], hand: [body('g', 'graverobbery')] }, 'set3');
    const f = act(act(s, { type: 'play', uid: 'g', targetUid: 'v' }), { type: 'faceOmen' });
    expect(f.lastCombat!.initial.player.find((m) => m.cardId === 'n2_huntsman')!.attack).toBe(24);
  });
  it('an un-aimed re-fire of a destroy Shout pays at once', () => {
    const s = base({ board: [H(), body('I', 'n2_huntsman'), body('g', 'graverobber')] }, 'set3');
    replayBattlecry(s, at(s, 'g')); // it destroys one of the two Huntsmen (R-TARGET-03: never itself)
    expect(s.board).toHaveLength(2);
    expect(s.board.find((c) => c.cardId === 'n2_huntsman')!.attack, 'the other Huntsman gains; the destroyed one gained nothing').toBe(24);
  });
  it.each(['R', 'RB'] as const)('a death followed by a return (%s) counts', (kw) => {
    const s = base({ board: [H(), body('v', 'sandbag', { keywords: [kw] })] });
    destroyMinionInShop(makeContext(s), at(s, 'v'));
    expect([gain(s), s.board.length]).toEqual([12, 2]);
  });
  it('a Huntsman with Rise that is destroyed returns as printed: its own death pays it nothing', () => {
    const s = base({ board: [H({ attack: 60, health: 60, keywords: ['R'] })] });
    destroyMinionInShop(makeContext(s), at(s, 'H'));
    expect(s.board.map(line)).toEqual(['12/1']);
  });
  it('a Shop death that fires an Echo: the one death pays, and the bodies the Echo summons pay nothing', () => {
    const s = base({ board: [H(), body('v', 'sandbag', { copiedEcho: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'pup', count: 2 } }] })] });
    destroyMinionInShop(makeContext(s), at(s, 'v'));
    expect([gain(s), s.board.length]).toEqual([12, 3]);
  });
  it('an Echo triggered WITHOUT a death pays nothing', () => {
    const s = base({ board: [H(), body('v', 'sandbag', { copiedEcho: [{ on: 'onDeath', do: 'deathrattleSummon', params: { tokenId: 'pup', count: 2 } }] })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'v'));
    expect([gain(s), s.board.length]).toEqual([0, 4]);
  });
  it('a Shop-fired spray (Fel Spikes) pays per body it kills; a Huntsman it kills gains nothing', () => {
    const s = base({ board: [body('f', 'dm_felspikes', { health: 99 }), H({ health: 99 }), body('x', 'sandbag', { health: 1 }), body('y', 'sandbag', { health: 1 })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'f'));
    expect([gain(s), s.board.map((c) => c.uid)]).toEqual([24, ['f', 'H']]);
    const d = base({ board: [body('f', 'dm_felspikes', { health: 99 }), body('x', 'sandbag', { health: 1 }), H({ health: 1 }), body('I', 'n2_huntsman', { health: 99 })] });
    const doomed = at(d, 'H');
    fireRecruitDeathrattlesForTest(d, at(d, 'f'));
    expect([d.board.map((c) => c.uid), at(d, 'I').attack, doomed.attack], 'the dying one hears neither death').toEqual([['f', 'I'], 36, 12]);
  });
  it('a hero-power destroy (Soren with the Ancient of Fortune) goes through the same Shop destroy', () => {
    let s = enableAncients(base({ heroId: 'soren', board: [H(), body('v', 'sandbag')] }));
    s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: ['fortune', ...ANCIENT_IDS.filter((a) => a !== 'fortune').slice(0, 2)] } };
    s = act(s, { type: 'pickAncient', id: 'fortune' });
    s = act(s, { type: 'heroPower', uid: 'v' });
    expect(s.board.map((c) => c.uid)).toEqual(['H']);
    expect(gain(s)).toBe(12);
  });
  it('START OF TURN, the real turn flip: a surviving Gravetwin\'s Blaster Echo pays at the Shop rate, in a Start of Turn beat', () => {
    const twin = body('g', 'gravetwin', { health: 900, copiedEcho: [{ on: 'onDeath', do: 'deathrattleDamageAll', params: { amount: 3 } }] });
    let s = base({ board: [twin, H({ health: 900 }), body('x', 'sandbag', { health: 1 })] });
    s = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
    const fromFight = gain(s);
    s = act({ ...s, lastSurvivorCardIds: ['gravetwin'] } as RunState, { type: 'resolveCombat' });
    expect(s.board.map((c) => c.uid)).toEqual(['g', 'H']);
    expect(gain(s) - fromFight).toBe(12);
    expect(s.sotBeatFx?.some((b) => JSON.stringify(b).includes('"H"')), 'a Start of Turn beat carries the gain').toBe(true);
  });
  it('NOT deaths in the engine today: a sale, a Shop minion Consumed, Devour Soul, a return to hand, a loan expiry', () => {
    const none = (s: RunState, why: string): void => expect(gain(s), why).toBe(0);
    none(act(base({ board: [H(), body('v', 'sandbag')] }), { type: 'sell', uid: 'v' }), 'a sale');
    const eat = base({ board: [H(), body('d', 'dm_felspikes')], shop: [{ uid: 'o', cardId: 'sandbag' }] as RunState['shop'] });
    expect(consumeShopMinion(eat, at(eat, 'd'), 0)).toBe(true);
    none(eat, 'a Shop minion Consumed');
    const dev = act(base({ board: [H(), body('v', 'sandbag', { attack: 0 })], hand: [body('s', 'devour')] }), { type: 'play', uid: 's', targetUid: 'v' });
    expect(dev.board.map((c) => c.uid)).toEqual(['H']);
    none(dev, 'Devour Soul');
    const ret = act(base({ board: [H(), body('v', 'sandbag')], hand: [body('s', 'seconddraft')] }), { type: 'play', uid: 's', targetUid: 'v' });
    expect(ret.board.map((c) => c.uid)).toEqual(['H']);
    none(ret, 'a return to hand');
    const loan = base({ board: [H(), body('v', 'sandbag')] });
    loan.pendingDeath = { uid: 'v', kind: 'loan' };
    settlePendingDeath(loan);
    expect(loan.board.map((c) => c.uid)).toEqual(['H']);
    none(loan, 'a Funeral on Loan expiry');
  });
});
