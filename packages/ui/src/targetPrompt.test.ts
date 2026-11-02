import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, spellDisplayText, type BoardCard, type RunState } from '@game/sim';
import { TARGET_VERBS, buildTargetPrompt, promptPlain, targetNoun, targetPromptFor } from './targetPrompt';

// R-TARGET-PROMPT-01 (owner ask 2026-11-01): the targeting pill says what the pick will DO, at its live value —
// "Select a Dwarf to grant +45 Health" for a Baby Gastrid — instead of "Choose a minion for <Card>'s Shout".

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over } as BoardCard;
};

const run = (over: Partial<RunState>): RunState => ({ ...createRun(7), phase: 'recruit', ...over } as RunState);

const prompt = (s: RunState, shown?: string, bonusA = 0, bonusH = 0): string => promptPlain(targetPromptFor(s, shown, bonusA, bonusH) ?? []);

describe('the targeting prompt says what the pick does (R-TARGET-PROMPT-01)', () => {
  it('Baby Gastrid: a Dwarf, granted its Health per Gold spent THIS turn (live)', () => {
    const s = run({
      board: [body('dw', 'dw_foreman'), body('g', 'dw_dorrin')],
      goldSpentThisTurn: 9,
      pendingTarget: { uid: 'g', cardId: 'dw_dorrin' },
    });
    expect(prompt(s)).toBe('Select a Dwarf to grant +18 Health');
    // Spend more and the pill follows: the number is the one the Shout will pay right now.
    expect(prompt({ ...s, goldSpentThisTurn: 22 } as RunState)).toBe('Select a Dwarf to grant +44 Health');
  });

  it('a golden Shout doubles, exactly as its factory pays (Baby Gastrid, Twilight Emissary)', () => {
    const g = run({
      board: [body('dw', 'dw_foreman'), body('g', 'dw_dorrin', { golden: true })],
      goldSpentThisTurn: 9,
      pendingTarget: { uid: 'g', cardId: 'dw_dorrin' },
    });
    expect(prompt(g)).toBe('Select a Dwarf to grant +36 Health');
    const e = run({
      board: [body('d', 'd2_broodwhelp'), body('e', 'emissary', { golden: true })],
      pendingTarget: { uid: 'e', cardId: 'emissary' },
    });
    expect(prompt(e)).toBe('Select a Dragon to grant +4/+4');
  });

  it('Rune of Full Measure: Baby Gastrid pays the same number as Attack too', () => {
    const s = run({
      board: [body('dw', 'dw_foreman'), body('g', 'dw_dorrin')],
      goldSpentThisTurn: 5, runeFullMeasure: true,
      pendingTarget: { uid: 'g', cardId: 'dw_dorrin' },
    });
    expect(prompt(s)).toBe('Select a Dwarf to grant +10/+10');
  });

  it('Humphry: the baseline plus one step per OTHER Dragon played this turn (its own play is not an other)', () => {
    const s = run({
      board: [body('d', 'd2_broodwhelp'), body('h', 'd2_humphry')],
      playedThisTurn: ['d2_broodwhelp', 'd2_humphry'],
      pendingTarget: { uid: 'h', cardId: 'd2_humphry' },
    });
    expect(prompt(s)).toBe('Select a Dragon to grant +4/+4');
  });

  it('Crest of the Climb (Choose One spell): phrases the CHOSEN branch, spell power folded in', () => {
    const s = run({
      board: [body('a', 'dw_foreman')],
      hand: [body('c', 'crestclimb')],
      pendingTarget: { uid: 'c', cardId: 'crestclimb', optionIndex: 1, spell: true, deferredPlay: true },
    });
    expect(prompt(s)).toBe('Select a minion to grant +4 Health');
    expect(prompt(s, undefined, 0, 1)).toBe('Select a minion to grant +5 Health');
    // Both stats of power are added to any grant (`spellBuffTarget`), so the branch becomes a pair.
    expect(prompt(s, undefined, 1, 1)).toBe('Select a minion to grant +1/+5');
    const atk = { ...s, pendingTarget: { ...s.pendingTarget!, optionIndex: 0 } } as RunState;
    expect(prompt(atk, undefined, 2, 0)).toBe('Select a minion to grant +6 Attack');
  });

  it('Runic Beetle (Choose One minion): a Beast, its keyword and stats in one clause; golden doubles the stats', () => {
    const s = run({
      board: [body('b', 'n3_splitboon')],
      hand: [body('r', 'beetle')],
      pendingTarget: { uid: 'r', cardId: 'beetle', optionIndex: 0, deferredPlay: true },
    });
    expect(prompt(s)).toBe('Select a Beast to grant Rise and +1/+1');
    const gold = { ...s, hand: [body('r', 'beetle', { golden: true })] } as RunState;
    expect(prompt(gold)).toBe('Select a Beast to grant Rise and +2/+2');
    const flurry = { ...s, pendingTarget: { ...s.pendingTarget!, optionIndex: 1 } } as RunState;
    expect(prompt(flurry)).toBe('Select a Beast to grant Flurry and +3 Attack');
  });

  it("a Mage-Pup's taught spell reads the live spell-power value the Pup prints", () => {
    const pup = body('p', 'b2_magepup', { taughtSpellId: 'spiritfire' } as Partial<BoardCard>);
    const s = run({ board: [body('a', 'dw_foreman'), pup], pendingTarget: { uid: 'p', cardId: 'b2_magepup' } });
    expect(prompt(s, spellDisplayText('spiritfire', 2, 0, 3))).toBe('Select a friendly minion to grant +8/+9');
  });

  it('Common Ground: the second pick averages with the first', () => {
    const s = run({
      board: [body('a', 'dw_foreman'), body('b', 'd2_broodwhelp')],
      hand: [body('cg', 'commonground')],
      pendingTarget: { uid: 'cg', cardId: 'commonground', spell: true, spellFirstUid: 'a' },
    });
    expect(prompt(s)).toBe('Select a second friendly minion to average stats with the first');
  });

  it('non-stat Shouts: the verb from the factory, the noun from the filter', () => {
    const at = (cardId: string, golden = false): string => prompt(run({
      board: [body('a', 'dw_foreman'), body('x', cardId, { golden })],
      pendingTarget: { uid: 'x', cardId },
    }));
    expect(at('graverobber')).toBe('Select a friendly minion to destroy for a spell');
    expect(at('graverobber', true)).toBe('Select a friendly minion to destroy for 2 spells');
    expect(at('dw_runemaster')).toBe('Select a friendly minion to make Golden');
    expect(at('d2_roomworks')).toBe('Select a friendly minion with End of Turn to trigger it');
    expect(at('dm_agent', true)).toBe('Select a Demon to Consume 2 Shop minions');
    expect(at('u3_cagebreaker')).toBe('Select an Undead to destroy and Discover');
  });

  it('a factory the table cannot phrase falls back to naming the card', () => {
    const noun = targetNoun({ target: 'friendly' });
    expect(promptPlain(buildTargetPrompt(
      { name: 'Devour Soul', effects: [{ on: 'cast', do: 'spellDevour' } as never], noun, fallbackSuffix: '' },
      { golden: false, spell: true, shown: '', goldSpent: 0, runeFullMeasure: false, played: () => 0, shopTier: 1 },
    ))).toBe('Select a friendly minion for Devour Soul');
  });

  it('every aimed Shout and targeted Choose One that opens the pill is phrased (no fallback)', () => {
    const missing: string[] = [];
    for (const d of Object.values(CARD_INDEX)) {
      if (d.ruby) continue; // Rubies aim by drag, never through the pill
      const sets: { name: string; effects: readonly { do: string }[] }[] = [];
      if (d.chooseOne?.length) {
        d.chooseOne.forEach((o, i) => { if (o.target ?? d.target) sets.push({ name: `${d.name} [${i}]`, effects: o.effects }); });
      } else if (!d.spell && d.target === 'friendly') {
        sets.push({ name: d.name, effects: d.effects.filter((e) => e.on === 'onPlay') });
      }
      for (const s of sets) if (s.effects.some((e) => !TARGET_VERBS[e.do])) missing.push(s.name);
    }
    expect(missing).toEqual([]);
  });
});
