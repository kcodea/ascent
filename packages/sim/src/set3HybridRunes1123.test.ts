/**
 * SET 3 NEW HYBRID RUNES (owner review board 2026-11-23): the SHOP / End of Turn / settle halves through the real reducer
 * and the real Shop chokepoints. The combat halves are `packages/core/src/combat/set3HybridRunes1123.test.ts`.
 *
 *   · Gem Whispers (Basic, Kobold + Dragon): "Whispers you cast on a minion also cast a Ruby on it."
 *   · Brewed Whispers (Basic, Dwarf + Dragon): "After you cast a Dwarven Ale, get a random Whisper."
 *   · Haunted Hand (Epic, Undead + Spirit): "When a minion in your hand gains stats, give your Undead Aura +1 Attack.
 *     (5 times per turn)"
 */
import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { questCombatMods, runeforgePool } from './reducer';
import { castSpell, mintRubies } from './recruit';
import { HAUNTED_HAND_CAP, runeLiveStateInCombat, runeLiveStateOfRun } from './runeLiveState';
import { liveRuneText } from '../../ui/src/runeText';

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
/** Buy runes through the REAL Runeforge path. */
function withRunes(ids: string[], extra: Partial<RunState> = {}): RunState {
  let s = base(extra);
  for (const id of ids) {
    s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: RUNE_INDEX[id]!.epic || undefined, embers: 40 }, { type: 'buyRune', index: 0 });
    expect(s.ownedRunes, `${id} was bought`).toContain(id);
  }
  return { ...s, discover: undefined, discoverQueue: undefined };
}
const play = (s: RunState, card: BoardCard, targetUid?: string): RunState => act({ ...s, hand: [...s.hand, card] }, { type: 'play', uid: card.uid, ...(targetUid ? { targetUid } : {}) } as Action);
const whispersIn = (s: RunState): string[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper).map((c) => c.cardId);
const rubyOn = (c: BoardCard | undefined): number => (c?.buffs ?? []).filter((b) => b.source === 'Ruby').reduce((n, b) => n + (b.count ?? 1), 0);
const playRuby = (s: RunState, target: string): RunState => {
  mintRubies(s, 1);
  const ruby = s.hand[s.hand.length - 1]!;
  return act(s, { type: 'play', uid: ruby.uid, targetUid: target });
};
const DRAGON = 'd3_hum';
const KOBOLD = Object.values(CARD_INDEX).find((c) => c.tribe === 'kobold' && !c.spell && !c.token && c.tier === 1 && c.effects.length === 0)?.id ?? 'sandbag';

const WANT: [string, number, boolean, Tribe[], string][] = [
  ['rune_gem_whispers', 2, false, ['kobold', 'dragon'], '**Whispers** you cast on a minion also cast a **Ruby** on it.'],
  ['rune_brewed_whispers', 2, false, ['dwarf', 'dragon'], 'After you cast a **Dwarven Ale**, get a random **Whisper**.'],
  ['rune_haunted_hand', 3, true, ['undead', 'spirit'], 'When a minion in your hand gains stats, give your **Undead Aura +1 Attack**. **(5 times per turn)**'],
];

describe('the Set 3 new hybrid roster (owner review board 2026-11-23)', () => {
  it('three runes at the sibling hybrid costs, Set 3 only, gated to both tribes, in the right pool, no em dash', () => {
    for (const [id, cost, epic, tribes, text] of WANT) {
      const r = RUNE_INDEX[id]!;
      expect([r.cost, !!r.epic, r.sets, r.tribes, r.text], id).toEqual([cost, epic, ['set3'], tribes, text]);
      expect((epic ? EPIC_RUNES : RUNES).some((x) => x.id === id), `${id} pool`).toBe(true);
      expect(r.text, `${id}: no em dash`).not.toMatch(/—|--/);
    }
  });
  it('the forge offers each only when one of its tribes is in the run (the gate is an OR)', () => {
    for (const [id, , epic, tribes] of WANT) {
      const pool = (t: Tribe[]) => runeforgePool({ ...base(), tribes: t, ownedRunes: [], runeforgeEpic: epic || undefined } as RunState);
      expect(pool(TRIBES), `${id} with all five`).toContain(id);
      expect(pool(TRIBES.filter((t) => !tribes.includes(t))), `${id} with neither tribe`).not.toContain(id);
    }
  });
});

describe('Rune of Gem Whispers: Shop', () => {
  it('a Whisper cast from hand on a friendly minion also casts a Ruby on it (Dragon or not); without the rune, no Ruby', () => {
    for (const rune of [true, false]) {
      let s = withRunes(rune ? ['rune_gem_whispers'] : [], { board: [bc('d', DRAGON), bc('k', KOBOLD)] });
      s = play(s, bc('w1', 'w4_runebind'), 'd');
      s = play(s, bc('w2', 'w4_runebind'), 'k');
      expect(rubyOn(s.board.find((c) => c.uid === 'd')), `Dragon, rune ${rune}`).toBe(rune ? 1 : 0);
      expect(rubyOn(s.board.find((c) => c.uid === 'k')), `Kobold, rune ${rune}`).toBe(rune ? 1 : 0);
    }
  });
  it('two copies cast two Rubies per Whisper', () => {
    let s = withRunes(['rune_gem_whispers', 'rune_duplication'], { board: [bc('d', DRAGON)] });
    // Rune of Duplication copies the most recent rune when bought; fall back to a second buy if it did not.
    if ((s.flagCopies?.runeGemWhispers ?? 1) < 2) s = withRunes(['rune_gem_whispers', 'rune_gem_whispers'], { board: [bc('d', DRAGON)] });
    s = play(s, bc('w1', 'w4_runebind'), 'd');
    expect(rubyOn(s.board[0])).toBe(2);
  });
  it('the combat mod rides into the fight', () => {
    expect(questCombatMods(withRunes(['rune_gem_whispers'])).runeGemWhispers).toBe(true);
  });
});

describe('Rune of Brewed Whispers: Shop', () => {
  it('every Dwarven Ale cast gets one random Whisper (any caster through castSpell); a non-Ale spell gets none', () => {
    const s = withRunes(['rune_brewed_whispers']);
    castSpell(s, CARD_INDEX['wo_attack']!);
    expect(whispersIn(s)).toHaveLength(1);
    castSpell(s, CARD_INDEX['wo_attack']!);
    expect(whispersIn(s)).toHaveLength(2);
    castSpell(s, CARD_INDEX['growth']!);
    expect(whispersIn(s), 'Growth is not an Ale').toHaveLength(2);
    const off = base();
    castSpell(off, CARD_INDEX['wo_attack']!);
    expect(whispersIn(off)).toHaveLength(0);
  });
  it('the Whisper comes from the tier-gated pool (R-WHISPER-TIER-01)', () => {
    const s = withRunes(['rune_brewed_whispers'], { tier: 1 });
    for (let i = 0; i < 6; i++) castSpell(s, CARD_INDEX['wo_attack']!);
    for (const id of whispersIn(s)) expect(CARD_INDEX[id]!.tier, id).toBeLessThanOrEqual(1);
  });
  it('the combat mod rides into the fight', () => {
    expect(questCombatMods(withRunes(['rune_brewed_whispers'])).runeBrewedWhispers).toBe(true);
  });
});

describe('Rune of the Haunted Hand: Shop', () => {
  // Rune of the Keepsake Gem relays every Ruby to the left-most hand minion: a real per-action hand gain.
  const HELD = 'sandbag';
  const setup = (runes: string[]) => withRunes(runes, { board: [bc('k', KOBOLD)], hand: [] });
  it('each hand gain raises the Undead Aura +1 Attack, the first 5 each turn; the combat mod carries what is left', () => {
    let s = setup(['rune_keepsake_gem', 'rune_haunted_hand']);
    s = { ...s, hand: [bc('h', HELD)] };
    const aura0 = s.undeadAttackBonus ?? 0;
    for (let i = 1; i <= 3; i++) s = playRuby(s, 'k');
    expect((s.undeadAttackBonus ?? 0) - aura0).toBe(3);
    expect(questCombatMods(s).hauntedHandLeft).toBe(HAUNTED_HAND_CAP - 3);
    for (let i = 4; i <= 7; i++) s = playRuby(s, 'k');
    expect((s.undeadAttackBonus ?? 0) - aura0, 'capped at 5 a turn').toBe(5);
    expect(questCombatMods(s).hauntedHandLeft).toBe(0);
  });
  it('without the rune, or with no minion in hand, the Aura does not move', () => {
    let off = setup(['rune_keepsake_gem']);
    off = { ...off, hand: [bc('h', HELD)] };
    const a0 = off.undeadAttackBonus ?? 0;
    off = playRuby(off, 'k');
    expect((off.undeadAttackBonus ?? 0) - a0).toBe(0);
    let empty = setup(['rune_keepsake_gem', 'rune_haunted_hand']);
    const e0 = empty.undeadAttackBonus ?? 0;
    empty = playRuby(empty, 'k');
    expect((empty.undeadAttackBonus ?? 0) - e0).toBe(0);
  });
  it('the cap re-arms at the next turn', () => {
    let s = setup(['rune_keepsake_gem', 'rune_haunted_hand']);
    s = { ...s, hand: [bc('h', HELD)] };
    for (let i = 0; i < 5; i++) s = playRuby(s, 'k');
    expect(s.hauntedHandThisTurn).toBe(5);
    s = act(s, { type: 'faceOmen' });
    s = act(s, { type: 'resolveCombat' } as Action);
    expect(s.phase).toBe('recruit');
    expect(s.hauntedHandThisTurn ?? 0).toBe(0);
    expect(questCombatMods(s).hauntedHandLeft).toBe(HAUNTED_HAND_CAP);
  });
  it('live text: the printed cap counts down once a use is spent, in the Shop and through a replayed fight', () => {
    const text = RUNE_INDEX['rune_haunted_hand']!.text;
    let s = setup(['rune_keepsake_gem', 'rune_haunted_hand']);
    s = { ...s, hand: [bc('h', HELD)] };
    expect(liveRuneText('rune_haunted_hand', text, runeLiveStateOfRun(s)), 'unspent: the printed text').toBe(text);
    s = playRuby(s, 'k');
    s = playRuby(s, 'k');
    const live = runeLiveStateOfRun(s);
    expect(liveRuneText('rune_haunted_hand', text, live)).toContain('**(3 left this turn)**');
    const mid = runeLiveStateInCombat(live, { triggers: { runeHauntedHand: 2 }, deaths: 0 });
    expect(liveRuneText('rune_haunted_hand', text, mid)).toContain('**(1 left this turn)**');
  });
});
