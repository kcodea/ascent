import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, SETS } from '@game/content';
import type { Tribe } from '@game/core';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods, runeforgePool } from './reducer';
import { castSpell, socRuneReplaysOf } from './recruit';
import { poolOf } from './cardPool';
import { runeLiveStateOfRun } from './runeLiveState';
import { runeTally } from '../../ui/src/runeTally';
import { liveRuneText } from '../../ui/src/runeText';

/**
 * SET 3 DRAGON RUNES, BASIC (owner 2026-10-21): the Shop halves, driven through the real reducer (`buyRune`, `play`,
 * `buy`) wherever a player action exists. The combat halves are `packages/core/src/combat/set3DragonRunesBasic.test.ts`.
 */

const IDS = [
  'rune_runic_primer', 'rune_loose_tongues', 'rune_clear_voices', 'rune_spell_fed_scales', 'rune_borrowed_flame', 'rune_spell_tempering',
  'rune_open_treasury', 'rune_deep_breaths', 'rune_defiant_wings', 'rune_final_utterance', 'rune_ember_inheritance',
] as const;
const NAMES: Record<string, string> = {
  rune_runic_primer: 'Rune of the Runic Primer', rune_loose_tongues: 'Rune of Loose Tongues', rune_clear_voices: 'Rune of Clear Voices',
  rune_spell_fed_scales: 'Rune of Spell-Fed Scales', rune_borrowed_flame: 'Rune of Borrowed Flame', rune_spell_tempering: 'Rune of Spell Tempering',
  rune_open_treasury: 'Rune of the Open Treasury', rune_deep_breaths: 'Rune of Deep Breaths', rune_defiant_wings: 'Rune of Defiant Wings',
  rune_final_utterance: 'Rune of the Final Utterance', rune_ember_inheritance: 'Rune of Ember Inheritance',
};

// Costs from docs/set3-dragon-rune-draft-30.md (owner ruling 2026-10-22).
const COSTS: Record<string, number> = {
  rune_runic_primer: 2, rune_loose_tongues: 3, rune_clear_voices: 2, rune_spell_fed_scales: 3, rune_borrowed_flame: 2, rune_spell_tempering: 3,
  rune_open_treasury: 2, rune_deep_breaths: 3, rune_defiant_wings: 3, rune_final_utterance: 2, rune_ember_inheritance: 3,
};

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const TRIBES: Tribe[] = ['kobold', 'dwarf', 'undead', 'spirit', 'dragon'];
const base = (extra: Partial<RunState> = {}): RunState => ({
  ...createRun(3, 'runesmith', 'ascent', CONFIG.defaultLine, 'set3'),
  tribes: TRIBES, wave: 7, tier: 6, phase: 'recruit', embers: 40, hand: [], board: [], ...extra,
} as RunState);
/** Buy a rune through the REAL Runeforge path in a Set 3 Dragon run. */
function withRune(id: string, extra: Partial<RunState> = {}): RunState {
  const s = act(base({ runeforgeOffer: [id], runeforgeEpic: undefined, ...extra }), { type: 'buyRune', index: 0 });
  expect(s.ownedRunes, `${id} was bought`).toContain(id);
  return s;
}
/** Put a card in hand and play it (the real `play` action), optionally aimed. */
const play = (s: RunState, card: BoardCard, targetUid?: string): RunState => act({ ...s, hand: [...s.hand, card] }, { type: 'play', uid: card.uid, ...(targetUid ? { targetUid } : {}) } as Action);
const whispersIn = (s: RunState): string[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper).map((c) => c.cardId);
const fromSource = (c: BoardCard | undefined, source: string): [number, number] =>
  (c?.buffs ?? []).filter((b) => b.source === source).reduce<[number, number]>((t, b) => [t[0] + b.attack, t[1] + b.health], [0, 0]);
const DRAGON = 'd3_hum'; // a Tier 2 Dragon with no play trigger of its own
const NOT_DRAGON = 'sandbag';

describe('the Set 3 Dragon Basic roster (owner 2026-10-21)', () => {
  it('eleven Basic runes: the "Rune of" names and the draft costs, Set 3 only, Dragon-gated, no em dash', () => {
    for (const id of IDS) {
      const r = RUNE_INDEX[id]!;
      expect(r, id).toBeTruthy();
      expect(RUNES.some((x) => x.id === id), `${id} is a Basic rune`).toBe(true);
      expect(EPIC_RUNES.some((x) => x.id === id), `${id} is not Epic`).toBe(false);
      expect([r.name, r.cost, !!r.epic, r.tribes, r.sets], id).toEqual([NAMES[id], COSTS[id], false, ['dragon'], ['set3']]);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
  });
  it('a Set 3 Basic forge offers them only when Dragons are in the run', () => {
    const forge = (tribes: Tribe[]): string[] => runeforgePool(base({ tribes, ownedRunes: [] }));
    const withDragons = forge([...SETS.set3.tribes] as Tribe[]);
    for (const id of IDS) expect(withDragons, id).toContain(id);
    const noDragons = forge(['kobold', 'dwarf', 'undead', 'spirit'] as Tribe[]);
    for (const id of IDS) expect(noDragons, id).not.toContain(id);
  });
});

describe('Rune of the Runic Primer: get 2 Runebinds, repeat each turn', () => {
  it('pays 2 Runebinds the moment it is bought', () => {
    const s = withRune('rune_runic_primer');
    expect(whispersIn(s)).toEqual(['w4_runebind', 'w4_runebind']);
  });
  it('a rune source: below Runebind\'s tier (Tolan, Tier 2) it pays nothing (R-WHISPER-TIER-01)', () => {
    const s = withRune('rune_runic_primer', { tier: 1 });
    expect(whispersIn(s)).toEqual([]);
  });
  it('over-caps the hand only at the moment of acquisition (R-HAND-RUNE-TURN-01)', () => {
    const filler = Array.from({ length: CONFIG.handMaxRuneTurn }, (_, i) => bc(`f${i}`, 'growth'));
    const s = withRune('rune_runic_primer', { hand: filler });
    expect(s.hand.length).toBe(CONFIG.handMaxRuneTurn + 2);
  });
  it('repeats at the next Start of Turn (after the unused pair faded at End of Turn)', () => {
    let s = withRune('rune_runic_primer', { board: [bc('d', DRAGON)] });
    s = act(s, { type: 'faceOmen' });
    expect(whispersIn(s), 'unused Whispers vanish at End of Turn').toEqual([]);
    s = act(s, { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(whispersIn(s)).toEqual(['w4_runebind', 'w4_runebind']);
  });
});

describe('Rune of Loose Tongues: whenever you play a Dragon, get a random Whisper', () => {
  it('a Dragon played pays one Whisper of your tier or below; a non-Dragon pays nothing', () => {
    let s = withRune('rune_loose_tongues', { tier: 2 });
    expect(runeTally(s, 'rune_loose_tongues')).toBe('0/1');
    s = play(s, bc('n', NOT_DRAGON));
    expect(whispersIn(s)).toEqual([]);
    s = play(s, bc('d', DRAGON));
    const w = whispersIn(s);
    expect(w).toHaveLength(1);
    expect(CARD_INDEX[w[0]!]!.tier).toBeLessThanOrEqual(2);
  });
});

describe('Rune of Clear Voices: 3 different Whispers from hand in a turn, 2 Gold, once per turn', () => {
  it('pays on the third DISTINCT Whisper only, once, and the badge counts it', () => {
    let s = withRune('rune_clear_voices', { board: [bc('t', DRAGON)] });
    const gold0 = s.embers;
    expect(runeTally(s, 'rune_clear_voices')).toBe('0/3');
    s = play(s, bc('w1', 'w4_tome'), 't');
    s = play(s, bc('w2', 'w4_tome'), 't'); // the same Whisper again: still one distinct
    expect(runeTally(s, 'rune_clear_voices')).toBe('1/3');
    s = play(s, bc('w3', 'w4_runebind'), 't');
    expect(s.embers).toBe(gold0);
    s = play(s, bc('w4', 'w3_bait'), 't');
    expect(s.embers, '+2 Gold on the third distinct Whisper').toBe(gold0 + 2);
    expect(runeTally(s, 'rune_clear_voices')).toBe('3/3');
    s = play(s, bc('w5', 'w3_seed'), 't');
    expect(s.embers, 'once per turn').toBe(gold0 + 2);
  });
});

describe('Rune of Spell-Fed Scales: whenever you cast a Shop Spell, give a Dragon +6/+7', () => {
  it('a Shop Spell (any caster) gives a random friendly Dragon +6/+7; a Whisper never does', () => {
    const s = withRune('rune_spell_fed_scales', { board: [bc('d', DRAGON), bc('n', NOT_DRAGON)] });
    const growth = poolOf(s).all.find((c) => c.id === 'growth')!;
    expect(growth, 'Growth is a Set 3 Shop Spell').toBeTruthy();
    castSpell(s, growth);
    expect(fromSource(s.board[0], 'Rune of Spell-Fed Scales')).toEqual([6, 7]);
    expect(fromSource(s.board[1], 'Rune of Spell-Fed Scales')).toEqual([0, 0]);
    const after = play(s, bc('w', 'w4_tome'), 'd');
    expect(fromSource(after.board[0], 'Rune of Spell-Fed Scales'), 'a Whisper is not a Shop Spell').toEqual([6, 7]);
  });
  it('arms the combat half', () => {
    expect(questCombatMods(withRune('rune_spell_fed_scales')).runeSpellFedScales).toBe(true);
  });
});

describe('Rune of Borrowed Flame: a Whisper cast on a Dragon gives it +1/+1 and improves', () => {
  it('pays the live value, then improves it; a non-Dragon target pays nothing; the text prints the value', () => {
    let s = withRune('rune_borrowed_flame', { board: [bc('d', DRAGON), bc('n', NOT_DRAGON)] });
    const text = RUNE_INDEX['rune_borrowed_flame']!.text;
    expect(liveRuneText('rune_borrowed_flame', text, runeLiveStateOfRun(s))).toContain('+1/+1');
    s = play(s, bc('w1', 'w4_tome'), 'd');
    expect(fromSource(s.board[0], 'Rune of Borrowed Flame')).toEqual([1, 1]);
    s = play(s, bc('w2', 'w4_tome'), 'd');
    expect(fromSource(s.board[0], 'Rune of Borrowed Flame')).toEqual([3, 3]); // +1 then +2
    s = play(s, bc('w3', 'w4_tome'), 'n');
    expect(fromSource(s.board[1], 'Rune of Borrowed Flame')).toEqual([0, 0]);
    expect(s.runeBorrowedFlame).toBe(3);
    expect(liveRuneText('rune_borrowed_flame', text, runeLiveStateOfRun(s))).toContain('+3/+3');
    expect(questCombatMods(s).runeBorrowedFlame, 'combat starts from the grown value').toBe(3);
  });
  it('the buff is permanent in the Shop (it survives the next turn\'s Whisper expiry)', () => {
    let s = withRune('rune_borrowed_flame', { board: [bc('d', DRAGON)] });
    s = play(s, bc('w1', 'w4_tome'), 'd');
    const [a, h] = [s.board[0]!.attack, s.board[0]!.health];
    s = act(s, { type: 'faceOmen' });
    s = act(s, { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    {
      const d = s.board.find((c) => c.uid === 'd')!;
      expect(fromSource(d, 'Rune of Borrowed Flame')).toEqual([1, 1]);
      expect(d.attack).toBeGreaterThanOrEqual(a - 1); // only Tome's own temporary +1 came off
      expect(d.health).toBeGreaterThanOrEqual(h - 1);
    }
  });
});

describe('Rune of Spell Tempering: after you cast 4 Whispers, your Shop Spells +1/+1', () => {
  it('every 4th Whisper cast raises the run\'s spell power; the meter carries and the badge counts', () => {
    let s = withRune('rune_spell_tempering', { board: [bc('t', DRAGON)] });
    const sp0 = { ...(s.spellBonus ?? { attack: 0, health: 0 }) };
    for (let i = 1; i <= 3; i++) {
      s = play(s, bc(`w${i}`, 'w4_tome'), 't');
      expect(runeTally(s, 'rune_spell_tempering')).toBe(`${i}/4`);
    }
    expect(s.spellBonus ?? { attack: 0, health: 0 }).toEqual(sp0);
    s = play(s, bc('w4', 'w4_tome'), 't');
    expect(s.spellBonus).toEqual({ attack: sp0.attack + 1, health: sp0.health + 1 });
    expect(runeTally(s, 'rune_spell_tempering')).toBe('0/4');
    s = play(s, bc('w5', 'w4_tome'), 't');
    const m = questCombatMods(s);
    expect([m.runeSpellTempering, m.runeSpellTemperingTick], 'combat continues the meter').toEqual([true, 1]);
  });
});

describe('Rune of the Open Treasury: a copy of the first Shop Spell you buy each turn', () => {
  it('the first spell bought hands over a copy; the second the same turn does not', () => {
    let s = withRune('rune_open_treasury');
    expect(runeTally(s, 'rune_open_treasury')).toBe('1/1');
    s = act({ ...s, spell: { uid: 'sp1', cardId: 'growth' } as RunState['spell'] }, { type: 'buy', uid: 'sp1' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['growth', 'growth']);
    expect(runeTally(s, 'rune_open_treasury')).toBe('0/1');
    s = act({ ...s, spell: { uid: 'sp2', cardId: 'growth' } as RunState['spell'] }, { type: 'buy', uid: 'sp2' });
    expect(s.hand.map((c) => c.cardId)).toEqual(['growth', 'growth', 'growth']);
  });
});

describe('Rune of Defiant Wings: the Shop replay (Combat Prowess / Lasting Cadence)', () => {
  it('2 distinct friendly Dragons +3/+6 and Ward, permanent; a non-Dragon never', () => {
    // Three DIFFERENT Dragons (three copies of one card would triple).
    const s = withRune('rune_defiant_wings', { board: [bc('a', DRAGON), bc('n', NOT_DRAGON), bc('b', 'd3_iggy'), bc('c', 'd3_gatherer')] });
    const replay = socRuneReplaysOf(s).find((r) => r.id === 'rune_defiant_wings');
    expect(replay).toBeTruthy();
    replay!.fire(s);
    const hit = s.board.filter((c) => fromSource(c, 'Rune of Defiant Wings')[0] === 3);
    expect(hit).toHaveLength(2);
    expect(hit.every((c) => c.keywords.includes('DS') && c.uid !== 'n')).toBe(true);
    expect(questCombatMods(s).runeDefiantWings).toBe(true);
  });
});

describe('combat-only runes arm their combat flags (the fights: core set3DragonRunesBasic.test.ts)', () => {
  it('Rune of Deep Breaths, Rune of the Final Utterance, Rune of Ember Inheritance', () => {
    expect(questCombatMods(withRune('rune_deep_breaths')).runeDeepBreaths).toBe(true);
    expect(questCombatMods(withRune('rune_final_utterance')).runeFinalUtterance).toBe(true);
    expect(questCombatMods(withRune('rune_ember_inheritance')).runeEmberInheritance).toBe(true);
    expect(runeTally(withRune('rune_final_utterance'), 'rune_final_utterance')).toBeNull(); // its x/4 is the combat tally
  });
});
