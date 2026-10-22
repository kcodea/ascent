import { describe, it, expect } from 'vitest';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, RUNE_DUP_SWEETENER } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { seedEchoMerge, whisperStatBonusesOf } from './whisper';
import { runeTally } from '../../ui/src/runeTally';

/**
 * SET 3 DRAGON RUNES, EPIC B (owner 2026-10-21): the four Whisper Epics.
 *
 *  - RUNE OF LASTING WORDS       "The first Whisper you cast from hand on each Dragon each turn is permanent."      R-RUNE-LASTING-WORDS-01
 *  - RUNE OF TWIN TONGUES        "Whispers cast from hand also cast on another friendly Dragon."                    R-RUNE-TWIN-TONGUES-01
 *  - RUNE OF THE OPENED VAULT    "Get a Shush. After you activate Jar of Secrets, your next Whisper cast from hand
 *                                 casts twice."                                                                     R-RUNE-OPENED-VAULT-01
 *  - RUNE OF BEQUEATHED SECRETS  "The first Dragon you sell each turn gives its Whisper stat bonuses to your
 *                                 left-most Dragon permanently."                                                    R-RUNE-BEQUEATHED-SECRETS-01
 *
 * Every block drives the real reducer: the rune is bought at the real Runeforge (`buyRune`), Whispers are cast from hand
 * with the real `play` action, Jar of Secrets is activated with `activateEquipment`, and turns flip through
 * faceOmen -> settleCombat -> resolveCombat (the Start of Turn strips temporary Whisper grants).
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
/** Buy `ids` through the REAL Runeforge, in a Set 3 run with Dragons. */
function withRunes(ids: string[], extra: Partial<RunState> = {}, seed = 3): RunState {
  let s = {
    ...createRun(seed, 'runesmith', 'ascent', undefined, 'set3'),
    tribes: ['kobold', 'dwarf', 'undead', 'spirit', 'dragon'], wave: 7, tier: 6, phase: 'recruit', embers: 60, hand: [], board: [],
    ...extra,
  } as RunState;
  for (const id of ids) s = act({ ...s, runeforgeOffer: [id], runeforgeEpic: !!RUNE_INDEX[id]!.epic } as RunState, { type: 'buyRune', index: 0 });
  return s;
}
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard): [number, number] => [c.attack, c.health];
/** Put a Whisper card in hand and cast it from hand. */
const castFromHand = (s: RunState, whisperId: string, targetUid?: string, over: Partial<BoardCard> = {}): RunState => {
  const uid = `w${s.hand.length}_${whisperId}`;
  const held = { ...s, hand: [...s.hand, bc(uid, whisperId, over)] } as RunState;
  return act(held, { type: 'play', uid, ...(targetUid ? { targetUid } : {}) } as Action);
};
const nextTurn = (s: RunState): RunState => {
  const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
  const next = act(settled, { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return { ...next, runeforgeOffer: undefined } as RunState;
};
const sell = (s: RunState, uid: string): RunState => act(s, { type: 'sell', uid } as Action);

/** Three plain Set 3 Dragons and a non-Dragon. None reacts to a Whisper or a sale in the Shop. */
const DRAGONS = (): BoardCard[] => [bc('d1', 'd3_woozy'), bc('d2', 'd3_gatherer'), bc('d3', 'd3_iggy')];
const BASE = { d1: [5, 3], d2: [5, 4], d3: [7, 2], v: [CARD_INDEX['venom']!.attack, CARD_INDEX['venom']!.health] } as const;

describe('the roster (Set 3 Dragon Epic B, owner 2026-10-21)', () => {
  it('four Epic Dragon runes, Set 3 only, owner text verbatim, no em dash', () => {
    const want: [string, string, string][] = [
      ['rune_lasting_words', 'Rune of Lasting Words', 'The first **Whisper** you cast from hand on each **Dragon** each turn is permanent.'],
      ['rune_twin_tongues', 'Rune of Twin Tongues', '**Whispers** cast from hand also cast on another friendly **Dragon**.'],
      ['rune_opened_vault', 'Rune of the Opened Vault', 'Get a **Shush**. After you activate **Jar of Secrets**, your next **Whisper** cast from hand casts twice.'],
      ['rune_bequeathed_secrets', 'Rune of Bequeathed Secrets', 'The first **Dragon** you **Sell** each turn gives its **Whisper** stat bonuses to your left-most **Dragon** permanently.'],
    ];
    for (const [id, name, text] of want) {
      const r = RUNE_INDEX[id]!;
      expect(EPIC_RUNES.includes(r), `${id} is Epic (array membership)`).toBe(true);
      expect(RUNES.includes(r)).toBe(false);
      expect([r.name, r.text, r.epic, r.sets, r.tribes]).toEqual([name, text, true, ['set3'], ['dragon']]);
      expect(/—|--/.test(r.text), id).toBe(false);
    }
    expect(RUNE_INDEX['rune_opened_vault']!.previewCards).toEqual(['d3_shush']);
    // Duplicates: Lasting Words cannot deepen (a cast is permanent or not), so a second copy pays the sweetener.
    expect(RUNE_DUP_SWEETENER.has('rune_lasting_words')).toBe(true);
    for (const id of ['rune_twin_tongues', 'rune_opened_vault', 'rune_bequeathed_secrets']) expect(RUNE_DUP_SWEETENER.has(id), id).toBe(false);
  });
});

describe('R-RUNE-LASTING-WORDS-01: the first Whisper cast from hand on each Dragon each turn is permanent', () => {
  it('control: without the rune a Bait on a Dragon fades at the next Start of Turn', () => {
    let s = withRunes([], { board: DRAGONS() });
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([...BASE.d1]);
    expect(at(s, 'd1').keywords).not.toContain('T');
  });

  it('the first Bait on each Dragon stays (stats AND its Taunt); a second on the same Dragon that turn fades; re-arms next turn', () => {
    let s = withRunes(['rune_lasting_words'], { board: [...DRAGONS(), bc('v', 'venom')] });
    s = castFromHand(s, 'w3_bait', 'd1'); // first on d1: kept
    s = castFromHand(s, 'w3_bait', 'd1'); // second on d1 this turn: temporary
    s = castFromHand(s, 'w3_bait', 'd2'); // first on d2: kept (per Dragon)
    s = castFromHand(s, 'w3_bait', 'v');  // not a Dragon: temporary
    expect(at(s, 'd1').lastingWordsUsedThisTurn).toBe(true);
    expect(at(s, 'd1').whisperKept).toEqual({ attack: 3, health: 5 });
    expect(at(s, 'd3').lastingWordsUsedThisTurn).toBeUndefined();
    expect(s.runeProcs?.['rune_lasting_words']).toBe(2);
    s = nextTurn(s);
    expect(stats(at(s, 'd1')), 'one Bait kept on d1').toEqual([5 + 3, 3 + 5]);
    expect(at(s, 'd1').keywords, 'the kept Taunt stays').toContain('T');
    expect(stats(at(s, 'd2'))).toEqual([5 + 3, 4 + 5]);
    expect(stats(at(s, 'v')), 'a non-Dragon keeps nothing').toEqual([...BASE.v]);
    expect(at(s, 'd1').lastingWordsUsedThisTurn, 're-armed at the turn flip').toBeUndefined();
    s = castFromHand(s, 'w3_bait', 'd1'); // first on d1 THIS turn: kept again
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
    expect(at(s, 'd1').whisperKept).toEqual({ attack: 6, health: 10 });
  });

  it('a Seed on a Dragon becomes a permanent Drake Pup Echo stack', () => {
    let s = withRunes(['rune_lasting_words'], { board: DRAGONS() });
    s = castFromHand(s, 'w3_seed', 'd1');
    expect(at(s, 'd1').seedEchoes).toBe(1);
    expect(at(s, 'd1').seedEchoesTemp).toBeUndefined();
    s = nextTurn(s);
    expect(at(s, 'd1').seedEchoes).toBe(1);
  });

  it('a Yazzus repeat is a second cast: only the first of the two is kept', () => {
    let s = withRunes(['rune_lasting_words'], { board: [...DRAGONS(), bc('y', 'yazzus')] });
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
  });

  it('a gilded Whisper keeps its whole doubled value', () => {
    let s = withRunes(['rune_lasting_words'], { board: DRAGONS() });
    s = castFromHand(s, 'w3_bait', 'd1', { whisperMult: 2 });
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
  });
});

describe('R-RUNE-TWIN-TONGUES-01: a Whisper cast from hand also casts on another friendly Dragon', () => {
  it('the copy is a full cast on ONE random OTHER Dragon (seeded), counted as a spell cast', () => {
    let s = withRunes(['rune_twin_tongues'], { board: [...DRAGONS(), bc('v', 'venom')] });
    const cast0 = s.spellsCast;
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
    const twins = ['d2', 'd3'].filter((u) => at(s, u).whisperBuffs?.length);
    expect(twins, 'exactly one other Dragon got the copy').toHaveLength(1);
    expect(stats(at(s, 'v')), 'never a non-Dragon').toEqual([...BASE.v]);
    expect(s.spellsCast - cast0, 'two Whisper casts').toBe(2);
    expect(s.runeProcs?.['rune_twin_tongues']).toBe(1);
    // Deterministic: the same seed picks the same twin.
    let again = withRunes(['rune_twin_tongues'], { board: [...DRAGONS(), bc('v', 'venom')] });
    again = castFromHand(again, 'w3_bait', 'd1');
    expect(['d2', 'd3'].filter((u) => at(again, u).whisperBuffs?.length)).toEqual(twins);
  });

  it('a non-Dragon target still copies onto a Dragon; with no OTHER Dragon there is no copy', () => {
    let s = withRunes(['rune_twin_tongues'], { board: [bc('v', 'venom'), bc('d1', 'd3_woozy')] });
    s = castFromHand(s, 'w3_bait', 'v');
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
    let lone = withRunes(['rune_twin_tongues'], { board: [bc('d1', 'd3_woozy')] });
    const c0 = lone.spellsCast;
    lone = castFromHand(lone, 'w3_bait', 'd1');
    expect(lone.spellsCast - c0).toBe(1);
    expect(stats(at(lone, 'd1'))).toEqual([5 + 3, 3 + 5]);
  });

  it('an untargeted Whisper (Well of Dragons) is not cast "on" anything, so it is not copied', () => {
    let s = withRunes(['rune_twin_tongues'], { board: DRAGONS() });
    const c0 = s.spellsCast;
    s = castFromHand(s, 'w3_wellofdragons');
    expect(s.spellsCast - c0).toBe(1);
  });

  it('a Yazzus repeat is a cast from hand too: each of the two casts copies once', () => {
    let s = withRunes(['rune_twin_tongues'], { board: [bc('d1', 'd3_woozy'), bc('d2', 'd3_gatherer'), bc('y', 'yazzus')] });
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd2'))).toEqual([5 + 6, 4 + 10]);
  });

  it('INTERACTION with Lasting Words: the from-hand cast is kept, the copy (not from hand) fades', () => {
    let s = withRunes(['rune_twin_tongues', 'rune_lasting_words'], { board: [bc('d1', 'd3_woozy'), bc('d2', 'd3_gatherer')] });
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(at(s, 'd2').lastingWordsUsedThisTurn, 'the copy never spends the twin\'s latch').toBeUndefined();
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
    expect(stats(at(s, 'd2'))).toEqual([...BASE.d2]);
    // …and the twin's own first from-hand Whisper this turn is still kept.
    s = castFromHand(s, 'w3_bait', 'd2');
    s = nextTurn(s);
    expect(stats(at(s, 'd2'))).toEqual([5 + 3, 4 + 5]);
  });
});

describe('R-RUNE-OPENED-VAULT-01: get a Shush; after a Jar of Secrets activation the next Whisper cast from hand casts twice', () => {
  const vault = (board: BoardCard[] = DRAGONS(), runes: string[] = []): RunState => {
    let s = withRunes(['rune_opened_vault', ...runes], { board });
    const shush = s.hand.find((c) => c.cardId === 'd3_shush');
    expect(shush, 'the rune hands over a Shush').toBeDefined();
    s = act(s, { type: 'play', uid: shush!.uid, toIndex: s.board.length } as Action);
    return s;
  };

  it('buying it gets a Shush; no activation, no double', () => {
    let s = vault();
    expect(s.openedVaultArmed).toBeUndefined();
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 3, 3 + 5]);
  });

  it('activating Jar of Secrets arms ONE double; the next Whisper from hand resolves twice on the same target, then it is spent', () => {
    let s = vault();
    s = act(s, { type: 'activateEquipment' } as Action);
    expect(s.openedVaultArmed).toBe(true);
    expect(runeTally(s, 'rune_opened_vault')).toBe('next Whisper x2');
    const c0 = s.spellsCast;
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
    expect(s.spellsCast - c0).toBe(2);
    expect(s.openedVaultArmed).toBeUndefined();
    expect(runeTally(s, 'rune_opened_vault')).toBeNull();
    s = castFromHand(s, 'w3_bait', 'd2');
    expect(stats(at(s, 'd2'))).toEqual([5 + 3, 4 + 5]);
  });

  it('the armed double waits across turns until a Whisper is cast from hand', () => {
    let s = vault();
    s = act(s, { type: 'activateEquipment' } as Action);
    s = nextTurn(s);
    expect(s.openedVaultArmed).toBe(true);
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
  });

  it('a refused cast (Ripple on a minion with no Shout) keeps the charge', () => {
    let s = vault();
    s = act(s, { type: 'activateEquipment' } as Action);
    s = castFromHand(s, 'w3_ripple', 'd1');
    expect(s.openedVaultArmed).toBe(true);
  });

  it('an untargeted Whisper spends it too (Well of Dragons Discovers twice)', () => {
    let s = vault();
    s = act(s, { type: 'activateEquipment' } as Action);
    const c0 = s.spellsCast;
    s = castFromHand(s, 'w3_wellofdragons');
    expect(s.spellsCast - c0).toBe(2);
    expect(s.openedVaultArmed).toBeUndefined();
  });

  it('INTERACTION with Twin Tongues: both casts from hand copy, so the twin Dragon gets two copies', () => {
    let s = vault([bc('d1', 'd3_woozy'), bc('d2', 'd3_gatherer')], ['rune_twin_tongues']);
    s = act(s, { type: 'activateEquipment' } as Action);
    // Shush is a Dragon too; take it off the table so the twin is d2.
    s = { ...s, board: s.board.filter((c) => c.cardId !== 'd3_shush') } as RunState;
    const c0 = s.spellsCast;
    s = castFromHand(s, 'w3_bait', 'd1');
    expect(stats(at(s, 'd1'))).toEqual([5 + 6, 3 + 10]);
    expect(stats(at(s, 'd2'))).toEqual([5 + 6, 4 + 10]);
    expect(s.spellsCast - c0).toBe(4);
  });
});

describe('R-RUNE-BEQUEATHED-SECRETS-01: the first Dragon sold each turn gives its Whisper stats to the left-most Dragon', () => {
  it('this turn\'s temporary Whisper stats pass on PERMANENTLY; the second Dragon sold that turn gives nothing; re-arms', () => {
    let s = withRunes(['rune_bequeathed_secrets'], { board: [bc('v', 'venom'), ...DRAGONS()] });
    expect(runeTally(s, 'rune_bequeathed_secrets')).toBe('1/1');
    s = castFromHand(s, 'w3_bait', 'd1');
    s = castFromHand(s, 'w3_bait', 'd3');
    expect(whisperStatBonusesOf(at(s, 'd1'))).toEqual({ attack: 3, health: 5 });
    s = sell(s, 'd1'); // the left-most Dragon leaves: d2 is the left-most now (the Venom is not a Dragon)
    expect(stats(at(s, 'd2'))).toEqual([5 + 3, 4 + 5]);
    expect(s.bequeathedUsedThisTurn).toBe(true);
    expect(runeTally(s, 'rune_bequeathed_secrets')).toBe('0/1');
    s = sell(s, 'd3'); // second Dragon this turn: nothing
    expect(stats(at(s, 'd2'))).toEqual([5 + 3, 4 + 5]);
    s = nextTurn(s);
    expect(stats(at(s, 'd2')), 'the inheritance is permanent').toEqual([5 + 3, 4 + 5]);
    expect(s.bequeathedUsedThisTurn).toBe(false);
    expect(stats(at(s, 'v'))).toEqual([...BASE.v]);
  });

  it('Whisper stats KEPT on earlier turns count (Lasting Words), alongside this turn\'s', () => {
    let s = withRunes(['rune_bequeathed_secrets', 'rune_lasting_words'], { board: [bc('d1', 'd3_woozy'), bc('d2', 'd3_gatherer')] });
    s = castFromHand(s, 'w3_bait', 'd2'); // kept on d2
    s = nextTurn(s);
    s = castFromHand(s, 'w4_runebind', 'd2'); // kept again (first this turn): +2/+2
    s = castFromHand(s, 'w3_bait', 'd2');     // temporary
    expect(whisperStatBonusesOf(at(s, 'd2'))).toEqual({ attack: 3 + 2 + 3, health: 5 + 2 + 5 });
    s = sell(s, 'd2');
    expect(stats(at(s, 'd1'))).toEqual([5 + 8, 3 + 12]);
    s = nextTurn(s);
    expect(stats(at(s, 'd1'))).toEqual([5 + 8, 3 + 12]);
  });

  it('literal "first Dragon": a Dragon with no Whisper stats spends the turn\'s charge; no other Dragon = nothing', () => {
    let s = withRunes(['rune_bequeathed_secrets'], { board: DRAGONS() });
    s = castFromHand(s, 'w3_bait', 'd2');
    s = sell(s, 'd1'); // no Whisper stats: the charge is spent for nothing
    s = sell(s, 'd2');
    expect(stats(at(s, 'd3'))).toEqual([...BASE.d3]);
    let lone = withRunes(['rune_bequeathed_secrets'], { board: [bc('d1', 'd3_woozy'), bc('v', 'venom')] });
    lone = castFromHand(lone, 'w3_bait', 'd1');
    lone = sell(lone, 'd1');
    expect(stats(at(lone, 'v'))).toEqual([...BASE.v]);
    expect(lone.bequeathedUsedThisTurn).toBe(true);
  });

  it('a triple SUMS the copies\' kept Whisper stats', () => {
    const merged = seedEchoMerge([
      bc('a', 'd3_woozy', { whisperKept: { attack: 3, health: 5 } }),
      bc('b', 'd3_woozy', { whisperKept: { attack: 2, health: 2 } }),
      bc('c', 'd3_woozy'),
    ]);
    expect(merged.whisperKept).toEqual({ attack: 5, health: 7 });
  });
});
