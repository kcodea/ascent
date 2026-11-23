/**
 * RUNE OF SEQUENCING (Set 2 Epic Dragon rune, owner design 2026-11-14, R-SET2-RUNE-SEQUENCING-01): "When you cast 3
 * different spells, get a copy of the first one." ONE sequence across the Shop, End of Turn and combat. Every block drives
 * the real engine: the Runeforge `buyRune`, the Shop cast chokepoint (`castSpell`), `simulate()` for the combat half
 * (both sides) and the reducer's `settleCombat` for the carry home.
 */
import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CardDef, type CombatEvent, type QuestCombatMods } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNE_INDEX, SETS, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods } from './reducer';
import { castSpell } from './recruit';
import { handCap } from './state';
import { runeLiveStateInCombat, runeLiveStateOfRun, runeLiveStateOfSnapshot } from './runeLiveState';
import { runeLiveTally, runeTally } from '../../ui/src/runeTally';
import { liveRuneText } from '../../ui/src/runeText';
import { runeProgress } from '../../ui/src/choreo/triggerCounts';

const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
function withRunes(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', CONFIG.defaultLine, 'set2'),
    tribes: [...SETS.set2.tribes], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [], recruitBuffFx: [],
    pool: Object.fromEntries(poolFor('set2').buyable.map((c) => [c.id, 5])),
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic }, { type: 'buyRune', index: 0 });
  return { ...s, ...extra };
}
const filler = (uid: string): BoardCard => ({ uid, cardId: 'sandbag', tribe: 'neutral', attack: 1, health: 1, keywords: [], golden: false });

// Three different untargeted, copyable Set 2 Shop spells, none of them the ones the combat casters below cast.
const SPELLS: CardDef[] = poolFor('set2').all.filter((c) => c.spell && !c.token && !c.gift && !c.ruby && !c.target && c.effects.length > 0
  && !['sp_dragonflame', 'growth', 'seconddraft'].includes(c.id) && !c.effects.some((e) => e.do.toLowerCase().includes('discover'))).slice(0, 3);
const [A, B, C] = SPELLS as [CardDef, CardDef, CardDef];
const handIds = (s: RunState): string[] => s.hand.map((c) => c.cardId);

// ── Combat helpers ──────────────────────────────────────────────────────────────────────────────────────────────
const bm = (uid: string, cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { sourceUid: uid, cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardMinion;
};
const wall = (uid: string, attack = 0, health = 5000): BoardMinion => bm(uid, 'sandbag', { attack, health, keywords: [] });
const fight = (p: BoardMinion[], e: BoardMinion[], pm: QuestCombatMods, em: QuestCombatMods = {}, seed = 4) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: pm }), combatSide({ tier: 6, tribes: [...SETS.set2.tribes], questMods: em }));
type ToHand = Extract<CombatEvent, { type: 'toHand' }>;
type Seq = Extract<CombatEvent, { type: 'runeSequence' }>;
const toHands = (evs: readonly CombatEvent[], side: 'player' | 'enemy' = 'player') => evs.filter((e): e is ToHand => e.type === 'toHand' && e.side === side);
const seqs = (evs: readonly CombatEvent[], side: 'player' | 'enemy' = 'player') => evs.filter((e): e is Seq => e.type === 'runeSequence' && e.side === side);
// Flamebeat Drake (Rally: cast Dragonflame) + Nitrogen (when a Dragon attacks, cast Growth): two different combat casts.
const CASTERS = (): BoardMinion[] => [bm('fb', 'd2_flamebeat', { health: 900 }), bm('ni', 'd3_nitrogen', { health: 900 })];

describe('Sequencing as content', () => {
  it('an Epic Dragon rune, Set 2 only, cost 3, the owner text, plain player style', () => {
    const r = RUNE_INDEX['rune_sequencing']!;
    expect([r.name, r.cost, r.text, r.sets, r.tribes, !!r.epic]).toEqual(
      ['Sequencing', 3, 'When you cast **3** different spells, get a **copy** of the first one.', ['set2', 'set3'], ['dragon'], true]);
    expect(EPIC_RUNES.includes(r)).toBe(true);
    expect(/—|--|Oath|climb/.test(r.text)).toBe(false);
    expect(SPELLS.length).toBe(3);
  });
});

describe('Sequencing in the Shop', () => {
  it('builds the sequence from different spells and pays a copy of the FIRST on the third; then starts over', () => {
    const s = withRunes(['rune_sequencing']);
    castSpell(s, A);
    castSpell(s, B);
    expect(s.runeSequence).toEqual([A.id, B.id]);
    expect(handIds(s)).toEqual([]);
    expect(runeTally(s, 'rune_sequencing')).toBe('2/3');
    castSpell(s, C);
    expect(handIds(s), 'a copy of the FIRST spell').toEqual([A.id]);
    expect(s.runeSequence, 'the sequence clears').toEqual([]);
    expect(runeTally(s, 'rune_sequencing')).toBe('0/3');
    expect(s.runeProcs?.['rune_sequencing'], 'the rune pulses').toBeGreaterThan(0);
  });

  it('a repeat neither counts nor resets', () => {
    const s = withRunes(['rune_sequencing']);
    castSpell(s, A);
    castSpell(s, A);
    castSpell(s, B);
    castSpell(s, A);
    castSpell(s, B);
    expect(s.runeSequence).toEqual([A.id, B.id]);
    expect(handIds(s)).toEqual([]);
    castSpell(s, C);
    expect(handIds(s)).toEqual([A.id]);
  });

  it('the granted copy counts normally when cast: it can open the next sequence; repeats forever', () => {
    const s = withRunes(['rune_sequencing']);
    for (const d of [A, B, C]) castSpell(s, d);
    expect(handIds(s)).toEqual([A.id]);
    s.hand = [];
    castSpell(s, A); // the copy, cast
    expect(s.runeSequence).toEqual([A.id]);
    castSpell(s, C);
    castSpell(s, B);
    expect(handIds(s), 'the second sequence pays its own first spell').toEqual([A.id]);
    expect(s.runeSequence).toEqual([]);
  });

  it('a Gift never joins the sequence (never copy food)', () => {
    const gift = Object.values(CARD_INDEX).find((c) => c.gift && c.spell && !c.target && !c.token)!;
    const s = withRunes(['rune_sequencing']);
    castSpell(s, A);
    castSpell(s, gift);
    expect(s.runeSequence).toEqual([A.id]);
  });

  it('two copies of the rune: the same sequence, two copies of the first spell', () => {
    const s = withRunes(['rune_sequencing', 'rune_sequencing']);
    for (const d of [A, B, C]) castSpell(s, d);
    expect(handIds(s)).toEqual([A.id, A.id]);
  });

  it('a full hand: the copy is refused by the normal hand cap, and the sequence still starts over', () => {
    const s = withRunes(['rune_sequencing']);
    s.hand = Array.from({ length: handCap(s) }, (_, i) => filler(`f${i}`));
    for (const d of [A, B, C]) castSpell(s, d);
    expect(s.hand.length).toBe(handCap(s));
    expect(handIds(s).includes(A.id)).toBe(false);
    expect(s.runeSequence).toEqual([]);
  });

  it('without the rune nothing is tracked', () => {
    const s = withRunes([]);
    for (const d of [A, B, C]) castSpell(s, d);
    expect(s.runeSequence).toBeUndefined();
    expect(handIds(s)).toEqual([]);
  });
});

describe('Sequencing across phases (combat)', () => {
  it('the Shop sequence rides into the fight, combat casts advance it, and the copy of the FIRST goes to hand mid-fight', () => {
    const s = withRunes(['rune_sequencing']);
    castSpell(s, A); // started in the Shop
    const mods = questCombatMods(s);
    expect(mods.runeSequencing).toBe(true);
    expect(mods.runeSequence).toEqual([A.id]);
    const r = fight(CASTERS(), [wall('w', 0, 9000)], mods);
    const grants = toHands(r.events).filter((e) => e.cardId === A.id);
    expect(grants.length, 'a live toHand of the Shop-started first spell').toBe(1);
    expect(r.playerHandGrants).toContain(A.id);
    // The pay happened on the beat of the second different combat cast, and every change was announced.
    const ticks = seqs(r.events);
    expect(ticks[0]!.seq.length).toBe(2);
    expect(ticks[1]!.seq).toEqual([]);
    const payAt = r.events.indexOf(ticks[1]!);
    expect(r.events.indexOf(grants[0]!)).toBeLessThan(payAt);
    expect(r.events.some((e) => e.type === 'questTrigger' && e.flag === 'runeSequencing' && e.side === 'player')).toBe(true);
    // The fight's final sequence comes home on the carry.
    expect(r.playerShoutCarry?.runeSequence).toEqual(ticks[ticks.length - 1]!.seq);
  });

  it('a repeated combat spell does not count: Dragonflame alone moves the sequence once', () => {
    const r = fight([bm('fb', 'd2_flamebeat', { health: 900 })], [wall('w', 0, 9000)], { runeSequencing: true, runeSequence: [A.id] });
    expect(r.events.filter((e) => e.type === 'spellcast' && e.side === 'player').length).toBeGreaterThan(1);
    expect(seqs(r.events).map((e) => e.seq)).toEqual([[A.id, 'sp_dragonflame']]);
    expect(toHands(r.events).length).toBe(0);
    expect(r.playerShoutCarry?.runeSequence).toEqual([A.id, 'sp_dragonflame']);
  });

  it('stacks in combat: two copies hand over two copies', () => {
    const r = fight(CASTERS(), [wall('w', 0, 9000)], { runeSequencing: true, runeSequence: [A.id], flagCopies: { runeSequencing: 2 } });
    expect(toHands(r.events).filter((e) => e.cardId === A.id).length).toBe(2);
  });

  it('symmetric: the enemy side runs the same rule off its own mods', () => {
    const mine = fight(CASTERS(), [wall('w', 0, 9000)], { runeSequencing: true, runeSequence: [A.id] });
    const theirs = fight([wall('w', 0, 9000)], CASTERS(), {}, { runeSequencing: true, runeSequence: [A.id] });
    expect(toHands(theirs.events, 'enemy').map((e) => e.cardId)).toEqual(toHands(mine.events).map((e) => e.cardId));
    expect(seqs(theirs.events, 'enemy').map((e) => e.seq)).toEqual(seqs(mine.events).map((e) => e.seq));
    expect(seqs(theirs.events, 'player').length).toBe(0);
  });

  it('settle writes the fight\'s sequence back and lands the copy, so the next Shop continues the ONE sequence', () => {
    const s0 = withRunes(['rune_sequencing']);
    castSpell(s0, A);
    const r = fight([bm('fb', 'd2_flamebeat', { health: 900 })], [wall('w', 0, 9000)], questCombatMods(s0));
    let s: RunState = { ...s0, phase: 'combat', lastCombat: r };
    s = act(s, { type: 'settleCombat' });
    expect(s.runeSequence).toEqual([A.id, 'sp_dragonflame']);
    castSpell(s, B); // back in the Shop: the third different spell
    expect(handIds(s)).toContain(A.id);
    expect(s.runeSequence).toEqual([]);
    // and a combat payout lands in the hand at settle
    const s1 = withRunes(['rune_sequencing']);
    castSpell(s1, A);
    const r1 = fight(CASTERS(), [wall('w', 0, 9000)], questCombatMods(s1));
    const after = act({ ...s1, phase: 'combat', lastCombat: r1 }, { type: 'settleCombat' });
    expect(handIds(after)).toContain(A.id);
  });
});

describe('Sequencing live text and meter', () => {
  it('the text names the sequence so far and what is left; the meter reads n/3 in the Shop and mid-fight', () => {
    const s = withRunes(['rune_sequencing']);
    const r = RUNE_INDEX['rune_sequencing']!;
    expect(liveRuneText(r.id, r.text, runeLiveStateOfRun(s))).toBe(`${r.text} (Sequence: none yet.)`);
    castSpell(s, A);
    castSpell(s, B);
    const live = runeLiveStateOfRun(s);
    expect(liveRuneText(r.id, r.text, live)).toBe(`${r.text} (Sequence: ${A.name}, ${B.name}. 1 more.)`);
    expect(runeLiveTally(r.id, live)).toBe('2/3');
    // mid-fight: the replayed `runeSequence` tick replaces the pre-fight sequence on the beat it lands
    const fightR = fight(CASTERS(), [wall('w', 0, 9000)], { runeSequencing: true, runeSequence: [A.id] });
    const first = seqs(fightR.events)[0]!;
    const upto = fightR.events.indexOf(first) + 1;
    const prog = runeProgress(fightR.events, upto, false, 'player', undefined);
    const mid = runeLiveStateInCombat(runeLiveStateOfRun({ ...s, runeSequence: [A.id] }), prog);
    // the fold is per STEP (like every replay meter): the last tick of the replayed step stands
    const atStep = seqs(fightR.events).filter((e) => (e.step ?? 0) <= (first.step ?? 0)).pop()!;
    expect(mid.sequence).toEqual(atStep.seq);
    expect(runeLiveTally(r.id, mid)).toBe(`${atStep.seq.length}/3`);
    const before = runeLiveStateInCombat(runeLiveStateOfRun({ ...s, runeSequence: [A.id] }), runeProgress(fightR.events, fightR.events.findIndex((e) => e.step !== undefined && e.step === first.step), false, 'player', undefined));
    expect(before.sequence, 'before any combat cast the pre-fight sequence stands').toEqual([A.id]);
    // an opponent's captured board reads its own sequence
    expect(runeLiveStateOfSnapshot({ questMods: { runeSequencing: true, runeSequence: [B.id] } }).sequence).toEqual([B.id]);
    // an unowned rune (a Runeforge offer) prints the plain text
    expect(liveRuneText(r.id, r.text, runeLiveStateOfRun(withRunes([])))).toBe(r.text);
  });
});
