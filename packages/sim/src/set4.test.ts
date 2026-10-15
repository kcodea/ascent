import { describe, it, expect } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX, SETS, activeSet, poolFor } from '@game/content';
import { CONFIG, createRun, reduce, type Action, type BoardCard, type RunState } from './index';
import { fireRecruitDeathrattlesForTest, spellDisplayText } from './recruit';
import { whisperValue } from './whisper';

/**
 * SET 4 (owner 2026-10-13) — the placeholder set, the WHISPER mechanic and the self-damage Beasts.
 *
 *  - Set 4 is registered, DISABLED, never the active set, and its pool is exactly its eight minions.
 *  - Whispers (R-WHISPER-01): granted on play from hand and at every Start of Turn while the granter is on the board;
 *    an unused Whisper vanishes at End of Turn and counts as nothing; a cast counts as a spell cast, never a Shop spell.
 *  - Whisper buffs (R-WHISPER-02): kept through the turn's combat, stripped at the next Start of Turn; Engraved does
 *    not keep them.
 *  - Self-damage (R-WOUND-01): never lethal, fires damage-taken watchers in BOTH phases; Apua / Alan are permanent.
 */

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const act = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
const run = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, undefined, 'ascent', CONFIG.defaultLine, 'set4'), phase: 'recruit', embers: 40, tier: 6, hand: [], board: [], ...over } as RunState);
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const stats = (c: BoardCard | undefined): [number, number] => [c?.attack ?? -1, c?.health ?? -1];
const whispersIn = (s: RunState, id?: string): BoardCard[] => s.hand.filter((c) => CARD_INDEX[c.cardId]?.whisper && (!id || c.cardId === id));
const nextTurn = (s: RunState): RunState => {
  const settled = act(act(s, { type: 'faceOmen' }), { type: 'settleCombat' });
  const next = act(settled, { type: 'resolveCombat' });
  expect(next.phase).toBe('recruit');
  return next;
};
const cast = (s: RunState, whisperUid: string, targetUid: string): RunState => act(s, { type: 'play', uid: whisperUid, targetUid } as Action);

describe('Set 4 placeholder', () => {
  it('is registered, disabled, never the active set, and holds the Beasts then the Celestials, in order', () => {
    expect(SETS.set4).toBeDefined();
    expect(SETS.set4.enabled).toBe(false);
    expect(activeSet().id).not.toBe('set4');
    // The 2026-10-14 swap (owner): the Whisper Dragons left for Set 3 and the Celestials arrived from it, ids unchanged.
    expect(poolFor('set4').buyable.map((c) => c.id)).toEqual([
      'b4_hawg', 'b4_apua', 'b4_eatah', 'b4_alan',
      'ce3_vendor', /* ce3_seer: Gravestar Seer archived 2026-10-15 */ 'ce3_conductor', 'ce3_herald', 'ce3_adept', 'ce3_spellcore', 'ce3_artificer',
      'ce3_starseed', 'ce3_dawnsentinel', 'ce3_peddler', 'ce3_wishingstar', 'ce3_accretionwarden', 'ce3_shootingstar',
      'ce3_eclipsewarden', 'ce3_orbitkeeper', 'ce3_coronadevotee', 'ce3_starcharter', 'ce3_lensgrinder', 'ce3_lodestar',
      'ce3_twinstar', 'ce3_novaherald', 'ce3_zenith',
    ]);
    expect(SETS.set4.tribes).toEqual(['beast', 'celestial']);
    // The Starform shop token rides along as a set member (never drawable: a token), exactly as it did in Set 3.
    expect(poolFor('set4').all.some((c) => c.id === 'ce3_starform')).toBe(true);
    expect(poolFor('set4').buyable.some((c) => c.id === 'ce3_starform')).toBe(false);
    // No Dragon is left in Set 4.
    expect(poolFor('set4').all.filter((c) => c.tribe === 'dragon').map((c) => c.id)).toEqual([]);
    // Set 3's generic neutral Shop spells, by reference (owner 2026-10-14), after the minions.
    expect(poolFor('set4').spells.map((c) => c.id)).toEqual(['apples', 'bulwark', 'emberpouch', 'depositbox', 'sprout', 'summonstone', 'manafont', 'growth', 'refreshtexts', 'tribeschoice', 'funeralonloan', 'lasso', 'riftsunkcodex', 'shatter', 'staffofguel', 'tribeportal', 'beyondsummit', 'decoysigil', 'fronttoback', 'goldentouch', 'helpwanted', 'insurancepolicy', 'quickstudy', 'devour', 'chronostaff', 'corpseboard', 'resonance', 'sigilkinship', 'spellcart', 'strangerevision', 'weaken', 'powershifter', 'displacement', 'aresmar', 'perfectvision', 'sparkplug', 'sp_gamble', 'sp_picnic', 'stellarchorus', 'splitdecision', 'aspectsblessing', 'sharedspirit', 'graverobbery', 'handsoap', 'starcrash', 'accretion']);
    // Every shared spell is neutral; Set 4's OWN two (Star Crash, Black Hole) are the Celestials' tribe spells.
    expect(poolFor('set4').spells.filter((c) => c.tribe !== 'neutral').map((c) => c.id)).toEqual(['starcrash', 'accretion']);
    // The Whispers are granted, never drawable: in the global index, out of every set's pool.
    for (const id of ['w4_tome', 'w4_runebind']) {
      expect(CARD_INDEX[id]?.whisper).toBe(true);
      for (const set of Object.keys(SETS) as (keyof typeof SETS)[]) expect(poolFor(set).all.some((c) => c.id === id), `${id} in ${set}`).toBe(false);
    }
    const r = createRun(3, undefined, 'ascent', CONFIG.defaultLine, 'set4');
    expect(r.setId).toBe('set4');
    expect(r.tribes.every((t) => t === 'beast' || t === 'celestial')).toBe(true);
  });

  it('stats and tiers match the owner sheet', () => {
    const want: [string, number, number, number][] = [
      ['d4_galas', 1, 3, 1], ['d4_tolan', 2, 2, 5], ['d4_tamby', 3, 3, 4], ['d4_whisp', 6, 7, 6],
      ['b4_hawg', 1, 1, 2], ['b4_apua', 2, 3, 3], ['b4_eatah', 3, 4, 5], ['b4_alan', 5, 5, 6],
    ];
    for (const [id, tier, a, h] of want) expect([CARD_INDEX[id]!.tier, CARD_INDEX[id]!.attack, CARD_INDEX[id]!.health], id).toEqual([tier, a, h]);
    expect(CARD_INDEX['b4_eatah']!.keywords).toEqual(['T', 'R']);
  });

  it('no player text carries an em dash or a double hyphen', () => {
    for (const id of ['d4_galas', 'd4_tolan', 'd4_tamby', 'd4_whisp', 'b4_hawg', 'b4_apua', 'b4_eatah', 'b4_alan', 'w4_tome', 'w4_runebind']) {
      const d = CARD_INDEX[id]!;
      for (const t of [d.text, d.goldenText ?? '']) expect(/—|--/.test(t), `${id}: ${t}`).toBe(false);
    }
  });
});

describe('R-WHISPER-01: the Whisper lifecycle', () => {
  it('playing Galas from hand hands over a Tome at once', () => {
    const s = act(run({ hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    expect(s.board.map((c) => c.cardId)).toEqual(['d4_galas']);
    expect(whispersIn(s, 'w4_tome')).toHaveLength(1);
  });

  it('an unused Whisper vanishes at End of Turn, uncounted, and a fresh one returns at Start of Turn while the granter stays', () => {
    let s = act(run({ hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    const castBefore = s.spellsCast;
    s = act(s, { type: 'faceOmen' });
    expect(whispersIn(s)).toHaveLength(0); // vanished at End of Turn
    expect(s.spellsCast).toBe(castBefore); // and never counted as cast
    s = act(act(s, { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(whispersIn(s, 'w4_tome')).toHaveLength(1); // granted again: Galas is still on the board
  });

  it('no granter on the board, no fresh Whisper', () => {
    let s = act(run({ hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = act(s, { type: 'sell', uid: 'g' } as Action);
    s = nextTurn(s);
    expect(whispersIn(s)).toHaveLength(0);
  });

  it('every granter grants its own copy; a Gilded granter grants one worth double', () => {
    const s = nextTurn(run({ board: [bc('g1', 'd4_galas'), bc('g2', 'd4_galas'), bc('t', 'd4_tolan', { golden: true })] }));
    expect(whispersIn(s, 'w4_tome')).toHaveLength(2);
    const rb = whispersIn(s, 'w4_runebind');
    expect(rb).toHaveLength(1);
    expect(rb[0]!.whisperMult).toBe(2);
  });

  it('a Whisper cast counts as a spell cast but is not a Shop spell', () => {
    let s = act(run({ board: [bc('x', 'venom')], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    const before = s.spellsCast;
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    expect(s.spellsCast).toBe(before + 1);
    expect(s.lastSpellCastId).not.toBe('w4_tome'); // never copy food (the Gift rule)
    expect(whispersIn(s)).toHaveLength(0);
  });
});

describe('Tome and Runebind values (live, retroactive, run-wide)', () => {
  it('Tome: +1/+1 plus +1/+1 for every 4 spells cast this game, retroactive (turn 10 with 60 spells -> +16/+16)', () => {
    const tome = CARD_INDEX['w4_tome']!;
    expect(whisperValue({ spellsCast: 0, rubyCasts: 0 }, tome)).toEqual({ attack: 1, health: 1 });
    expect(whisperValue({ spellsCast: 3, rubyCasts: 0 }, tome)).toEqual({ attack: 1, health: 1 });
    expect(whisperValue({ spellsCast: 3, rubyCasts: 1 }, tome)).toEqual({ attack: 2, health: 2 }); // Rubies count
    expect(whisperValue({ spellsCast: 60, rubyCasts: 0 }, tome)).toEqual({ attack: 16, health: 16 });
    let s = act(run({ spellsCast: 60, board: [bc('x', 'venom')], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([1 + 16, 1 + 16]);
  });

  it('a Gilded Galas Tome grants double', () => {
    let s = act(run({ spellsCast: 4, board: [bc('x', 'venom')], hand: [bc('g', 'd4_galas', { golden: true, attack: 6, health: 2 })] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([1 + 4, 1 + 4]);
  });

  it('Runebind: +2/+2, then every Runebind (held or later) is +2/+2 stronger for the rest of the run', () => {
    let s = run({ board: [bc('t1', 'd4_tolan'), bc('x', 'venom'), bc('y', 'venom')] });
    s = nextTurn(s);
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([3, 3]);
    expect(s.whisperImprove?.['w4_runebind']).toBe(2);
    s = nextTurn(s);
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'y');
    expect(stats(at(s, 'y'))).toEqual([1 + 4, 1 + 4]); // the improved value
    // A LATER Tolan's Runebind reads the run-wide value too.
    s = act({ ...s, hand: [...s.hand, bc('t2', 'd4_tolan')] }, { type: 'play', uid: 't2', toIndex: 0 } as Action);
    expect(spellDisplayText('w4_runebind', 0, 0, 0, 0, 0, 0, { whisperImprove: s.whisperImprove, spellsCast: s.spellsCast, rubyCasts: s.rubyCasts })).toContain('+6/+6');
  });

  it('Gilded Tolan: double the value AND the improve', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan', { golden: true, attack: 4, health: 10 }), bc('x', 'venom')] }));
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([1 + 4, 1 + 4]);
    expect(s.whisperImprove?.['w4_runebind']).toBe(4);
  });

  it('a Yazzus repeat is a real second cast: Runebind improves between them', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan'), bc('z', 'yazzus'), bc('x', 'venom')] }));
    const before = s.spellsCast;
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([1 + 2 + 4, 1 + 2 + 4]); // +2/+2 then the improved +4/+4
    expect(s.whisperImprove?.['w4_runebind']).toBe(4);
    expect(s.spellsCast).toBe(before + 2);
  });
});

describe('R-WHISPER-02: Whisper buffs are temporary', () => {
  it('kept through the turn and its combat, stripped at the next Start of Turn (stats and ledger)', () => {
    let s = act(run({ board: [bc('x', 'venom')], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    expect(stats(at(s, 'x'))).toEqual([2, 2]);
    expect(at(s, 'x').whisperBuffs?.[0]).toMatchObject({ source: 'Tome', attack: 1, health: 1 });
    // The fight is built from the board as it stands: the combat side carries the Whisper stats.
    const fought = act(s, { type: 'faceOmen' });
    const initial = fought.lastCombat?.initial?.player ?? [];
    const xIn = initial.find((m) => (m as { sourceUid?: string }).sourceUid === 'x' || m.cardId === 'venom');
    if (xIn) expect([xIn.attack, xIn.health]).toEqual([2, 2]);
    const next = act(act(fought, { type: 'settleCombat' }), { type: 'resolveCombat' });
    expect(stats(at(next, 'x'))).toEqual([1, 1]);
    expect(at(next, 'x').whisperBuffs).toBeUndefined();
    expect((at(next, 'x').buffs ?? []).some((b) => b.source === 'Tome')).toBe(false);
  });

  it('Engraved does not keep a Whisper grant (it keeps combat gains only)', () => {
    let s = act(run({ board: [bc('x', 'venom', { keywords: ['EG'] })], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    s = nextTurn(s);
    expect(stats(at(s, 'x'))).toEqual([1, 1]);
  });

  it('never strips a minion below 1 Health', () => {
    let s = act(run({ board: [bc('x', 'venom')], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 'x');
    at(s, 'x').health = 1; // Shop damage took the Whisper's share
    s = nextTurn(s);
    expect(at(s, 'x').health).toBe(1);
  });
});

describe('Tamby and Whisp', () => {
  it('Tamby: a Whisper cast on it hands back a copy, once per turn; Gilded hands back two', () => {
    let s = act(run({ board: [bc('t', 'd4_tamby')], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    s = cast(s, whispersIn(s)[0]!.uid, 't');
    expect(whispersIn(s, 'w4_tome')).toHaveLength(1); // the copy
    s = cast(s, whispersIn(s)[0]!.uid, 't');
    expect(whispersIn(s)).toHaveLength(0); // once per turn
    let g = act(run({ board: [bc('t', 'd4_tamby', { golden: true })], hand: [bc('g', 'd4_galas')] }), { type: 'play', uid: 'g', toIndex: 0 } as Action);
    g = cast(g, whispersIn(g)[0]!.uid, 't');
    expect(whispersIn(g, 'w4_tome')).toHaveLength(2);
    // The latch re-arms next turn.
    s = nextTurn(s);
    const fresh = whispersIn(s)[0]!.uid;
    s = cast(s, fresh, 't');
    expect(whispersIn(s)).toHaveLength(1);
  });

  it('Whisp: a Whisper cast on a Dragon is also cast on Whisp (a full cast); not on a non-Dragon; never loops', () => {
    let s = nextTurn(run({ board: [bc('t', 'd4_tolan'), bc('w', 'd4_whisp'), bc('x', 'venom')] }));
    const before = s.spellsCast;
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 't'); // Tolan is a Dragon
    expect(stats(at(s, 't'))).toEqual([2 + 2, 5 + 2]);
    expect(stats(at(s, 'w'))).toEqual([7 + 4, 6 + 4]); // the echo reads the improved Runebind
    expect(s.spellsCast).toBe(before + 2);
    s = nextTurn(s);
    s = cast(s, whispersIn(s, 'w4_runebind')[0]!.uid, 'x'); // not a Dragon: no echo
    expect(stats(at(s, 'w'))).toEqual([7, 6]); // last turn's grants expired, nothing new
    // Two Whisps never feed each other.
    let two = nextTurn(run({ board: [bc('g', 'd4_galas'), bc('w1', 'd4_whisp'), bc('w2', 'd4_whisp')] }));
    two = cast(two, whispersIn(two)[0]!.uid, 'g');
    expect(stats(at(two, 'w1'))).toEqual([8, 7]);
    expect(stats(at(two, 'w2'))).toEqual([8, 7]);
  });
});

describe('R-WOUND-01: Set 4 Beast self-damage', () => {
  it('Hawg (Shop): 1 damage to itself, healed by its own +1 Health; the other Beasts +1 Health; Apua answers the hit', () => {
    const s = act(run({ board: [bc('a', 'b4_apua'), bc('e', 'b4_eatah')], hand: [bc('h', 'b4_hawg')] }), { type: 'play', uid: 'h', toIndex: 0 } as Action);
    expect(stats(at(s, 'h'))).toEqual([1, 2]); // net neutral on itself
    expect(stats(at(s, 'e'))).toEqual([4, 6]);
    expect(stats(at(s, 'a'))).toEqual([3 + 1, 3 + 1 + 1]); // +1 Health from Hawg, +1/+1 from Apua (Hawg took damage)
  });

  it('Gilded Hawg fires twice: two hits, two rounds of Health', () => {
    const s = act(run({ board: [bc('a', 'b4_apua')], hand: [bc('h', 'b4_hawg', { golden: true, attack: 2, health: 4 })] }), { type: 'play', uid: 'h', toIndex: 0 } as Action);
    expect(stats(at(s, 'h'))).toEqual([2, 4]);
    expect(stats(at(s, 'a'))).toEqual([3 + 2, 3 + 2 + 2]);
  });

  it('a 1-Health Beast takes the hit, fires its watcher and ends net neutral (Shop)', () => {
    const s = act(run({ board: [bc('a', 'b4_apua', { health: 1 })], hand: [bc('h', 'b4_hawg', { health: 1 })] }), { type: 'play', uid: 'h', toIndex: 0 } as Action);
    expect(s.board.map((c) => c.uid).sort()).toEqual(['a', 'h']);
    expect(stats(at(s, 'h'))).toEqual([1, 1]);
  });

  it('Eatah\'s Echo in combat: each Beast takes 1 then +1 Health; a 1-Health Beast never dies to it; Apua answers its own hit', () => {
    // Eatah (Taunt, no Rise here) dies to the first exchange; its Echo hits Hawg (1 Health) and heals it straight back.
    // Apua answers EVERY Beast hit: Eatah's lethal one, then each Echo hit (its own included), permanently.
    const p: BoardMinion[] = [
      { cardId: 'b4_eatah', attack: 4, health: 1, keywords: ['T'], sourceUid: 'pe' } as unknown as BoardMinion,
      { cardId: 'b4_hawg', attack: 0, health: 1, keywords: [], sourceUid: 'ph' } as unknown as BoardMinion,
      { cardId: 'b4_apua', attack: 0, health: 3, keywords: [], sourceUid: 'pa' } as unknown as BoardMinion,
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 200, keywords: [] } as unknown as BoardMinion];
    const r = simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const [eatah, hawg, apua] = [0, 1, 2].map((i) => r.initial.player[i]!.uid) as [string, string, string];
    const hit = r.events.findIndex((ev) => ev.type === 'dmg' && ev.target === hawg && ev.source === eatah);
    expect(hit, 'the Echo hit Hawg').toBeGreaterThan(-1);
    expect((r.events[hit] as { remainingHp: number }).remainingHp).toBe(0); // it really took the hit at 1 Health
    const rest = r.events.slice(hit + 1);
    const mend = rest.findIndex((ev) => ev.type === 'buff' && ev.target === hawg && ev.source === eatah && ev.health === 1);
    expect(mend, 'the +1 Health landed').toBeGreaterThan(-1);
    expect(r.events.some((ev) => ev.type === 'death' && ev.target === hawg && r.events.indexOf(ev) < hit + 1 + mend + 1), 'no death between hit and Health').toBe(false);
    // Apua: the lethal hit on Eatah, the Echo hit on Hawg and on itself -> 3 permanent +1/+1 at least.
    const apuaGains = r.events.filter((ev) => ev.type === 'buff' && ev.target === apua && ev.source === apua).length;
    expect(apuaGains).toBeGreaterThanOrEqual(3);
    expect(r.playerPermaBuffs?.find((b) => b.sourceUid === 'pa')?.attack).toBe(apuaGains);
  });

  it('Gilded Eatah\'s Echo hits twice, each tick its own wave', () => {
    const p: BoardMinion[] = [
      { cardId: 'b4_eatah', attack: 8, health: 1, keywords: ['T'], golden: true, sourceUid: 'pe' } as unknown as BoardMinion,
      { cardId: 'b4_hawg', attack: 0, health: 1, keywords: [], sourceUid: 'ph' } as unknown as BoardMinion,
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 200, keywords: [] } as unknown as BoardMinion];
    const r = simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const eatah = r.initial.player[0]!.uid;
    const hits = r.events.filter((ev) => ev.type === 'dmg' && ev.source === eatah && ev.amount === 1);
    expect(hits).toHaveLength(2);
    expect(new Set(hits.map((h) => h.wave)).size).toBe(2);
  });

  it('Apua in combat: a friendly Beast taking an ATTACK hit grants +1/+1 permanently (carried back)', () => {
    const p: BoardMinion[] = [{ cardId: 'b4_apua', attack: 1, health: 30, keywords: [], sourceUid: 'pa' } as unknown as BoardMinion];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 3, keywords: [] } as unknown as BoardMinion];
    const r = simulate(p, e, makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const apua = r.initial.player[0]!.uid;
    const hits = r.events.filter((ev) => ev.type === 'dmg' && ev.target === apua).length;
    expect(hits).toBeGreaterThan(0);
    const kept = r.playerPermaBuffs?.find((b) => b.sourceUid === 'pa');
    expect([kept?.attack, kept?.health]).toEqual([hits, hits]);
  });

  it('a lethal attack on Apua is not undone by its own gain', () => {
    const p: BoardMinion[] = [{ cardId: 'b4_apua', attack: 1, health: 1, keywords: [], sourceUid: 'pa' } as unknown as BoardMinion];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 30, keywords: [] } as unknown as BoardMinion];
    const r = simulate(p, e, makeRng(2), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const apua = r.initial.player[0]!.uid;
    expect(r.events.some((ev) => ev.type === 'death' && ev.target === apua)).toBe(true);
    expect(r.events.some((ev) => ev.type === 'buff' && ev.target === apua && ev.source === apua)).toBe(false);
  });

  it('Alan: a friendly Beast taking damage gives ANOTHER friendly Beast +1/+2 (never itself)', () => {
    const s = act(run({ board: [bc('al', 'b4_alan')], hand: [bc('h', 'b4_hawg')] }), { type: 'play', uid: 'h', toIndex: 0 } as Action);
    // Hawg was hit: Alan's only other Beast is Hawg itself.
    expect(stats(at(s, 'h'))).toEqual([1 + 1, 2 + 2]);
    expect(stats(at(s, 'al'))).toEqual([5, 6 + 1]); // only Hawg's +1 Health
  });

  it('Shop damage from another source wakes Apua too (a Shop-fired Blaster Echo hits your board)', () => {
    const s = run({ board: [bc('a', 'b4_apua', { health: 10 }), bc('bl', 'blaster', { health: 5 })] });
    fireRecruitDeathrattlesForTest(s, at(s, 'bl'));
    // Blaster's Echo deals 1 (its printed amount) to every friendly body in the Shop; Apua took a hit -> +1/+1.
    const a = at(s, 'a');
    const dmg = 10 - (a.health - 1);
    expect(dmg).toBeGreaterThan(0);
    expect(a.attack).toBe(3 + 1);
  });
});

describe('R-WOUND-01 beat order: the hits first, then the reactions, then the Health (owner 2026-10-13)', () => {
  it('combat: Eatah\'s Echo hits land first, then the reactions (same wave, after every hit), then the +Health on a later wave', () => {
    const p: BoardMinion[] = [
      { cardId: 'b4_eatah', attack: 4, health: 1, keywords: ['T'], sourceUid: 'pe' } as unknown as BoardMinion,
      { cardId: 'b4_hawg', attack: 0, health: 3, keywords: [], sourceUid: 'ph' } as unknown as BoardMinion,
      { cardId: 'b4_apua', attack: 0, health: 3, keywords: [], sourceUid: 'pa' } as unknown as BoardMinion,
    ];
    const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 1, health: 200, keywords: [] } as unknown as BoardMinion];
    const r = simulate(p, e, makeRng(5), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const [eatah, , apua] = [0, 1, 2].map((i) => r.initial.player[i]!.uid) as [string, string, string];
    const hits = r.events.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.type === 'dmg' && ev.source === eatah && ev.amount === 1);
    expect(hits.length).toBe(2); // Hawg + Apua
    const hitWave = hits[0]!.ev.wave;
    expect(hits.every(({ ev }) => ev.wave === hitWave)).toBe(true); // ONE hit beat
    const lastHit = Math.max(...hits.map((h) => h.i));
    // Apua's answers to THESE two hits (it keeps answering later attacks in the fight too).
    const reactions = r.events.map((ev, i) => ({ ev, i })).filter(({ ev, i }) => i > hits[0]!.i && ev.type === 'buff' && ev.source === apua).slice(0, 2);
    const mends = r.events.map((ev, i) => ({ ev, i })).filter(({ ev }) => ev.type === 'buff' && ev.source === eatah && ev.health === 1);
    expect(reactions.length).toBe(2);
    expect(mends.length).toBe(2);
    // Order: every hit, then every reaction, then every Health.
    expect(Math.min(...reactions.map((x) => x.i))).toBeGreaterThan(lastHit);
    expect(Math.min(...mends.map((x) => x.i))).toBeGreaterThan(Math.max(...reactions.map((x) => x.i)));
    // Waves: the reactions ride the HIT's wave, after every hit (the replay's #2074 split gives them their own beat, one
    // tick per fire: packages/ui/src/choreo/set4WoundBeats.test.ts); the Health is its own later wave.
    expect(reactions.every((x) => x.ev.wave === hitWave)).toBe(true);
    expect(mends.every((x) => x.ev.wave !== undefined && x.ev.wave > hitWave!)).toBe(true);
  });

  it('Shop: Hawg\'s hit wave precedes the reaction waves, which precede the Health waves', () => {
    const s = act(run({ board: [bc('a', 'b4_apua'), bc('l', 'b4_alan')], hand: [bc('h', 'b4_hawg')] }), { type: 'play', uid: 'h', toIndex: 0 } as Action);
    const fx = s.recruitBuffFx;
    const hit = fx.find((e) => e.damage)!;
    const reactions = fx.filter((e) => !e.damage && e.sourceCardId === 'b4_alan');
    const health = fx.filter((e) => !e.damage && e.sourceCardId === 'b4_hawg');
    expect(hit.targetUid).toBe('h');
    expect(reactions.length).toBe(1);
    expect(health.length).toBe(2); // Apua + Alan get Hawg's +1 Health
    expect(reactions[0]!.fxWave!).toBeGreaterThan(hit.fxWave!);
    for (const h of health) expect(h.fxWave!).toBeGreaterThan(reactions[0]!.fxWave!);
  });
});
