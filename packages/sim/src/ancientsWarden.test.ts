/**
 * ANCIENTS × the WARDEN (owner pairings 2026-09-26). Aegis: "Give a friendly minion Ward, then give your minions with
 * Ward +5 Attack." Each pairing in the phase(s) it fires in, plus the new Resilient Ward on War's Aegis.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { CombatEvent, CombatResult } from '@game/core';
import {
  ANCIENT_IDS, ancientAfterCombat, ancientCombatMods, ancientOfferText, createRun, enableAncients, heroPowerText, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** A plain body with the given stats + keywords. Each uid letter maps to a DIFFERENT effect-less card, so no two
 *  bodies on a test board ever form a triple (which would fold them into a golden and move every uid). */
const VANILLA: Record<string, string> = { a: 'hm_test_squire', b: 'shaper', c: 'beetle', v: 'n2_spellsword', r: 'k3_forkvein', w: 'k3_splitpick' };
const pup = (uid: string, attack: number, health: number, keywords: BoardCard['keywords'] = []): BoardCard =>
  card(uid, VANILLA[uid]!, { attack, health, keywords });
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'warden'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number, n = 1): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health * n,
  minions: Array.from({ length: n }, () => ({ cardId: 'sandbag', attack, health, keywords: [] })), seed: 1, origin: 'self',
});
const at = (s: RunState, uid: string): BoardCard => s.board.find((c) => c.uid === uid)!;
const fightNow = (s: RunState, attack = 3, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });

describe('Warden × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet.")', () => {
    for (const id of ANCIENT_IDS) expect(ancientOfferText('warden', id)).not.toBe('Not written yet.');
  });
});

describe('Warden × DEATH — a two-target Aegis', () => {
  it('the first pick opens the recipient aim and pays nothing; the second destroys it and gives its Attack + Ward', () => {
    let s = picked('death', { board: [pup('v', 9, 4), pup('r', 2, 6), pup('w', 1, 1, ['DS'])] });
    const gold = s.embers;
    s = reduce(s, { type: 'heroPower', uid: 'v' });
    expect(s.pendingTarget).toMatchObject({ uid: 'v', heroPowerSlot: 0 });
    expect([s.embers, s.heroReady]).toEqual([gold, true]);
    expect(reduce(s, { type: 'battlecryTarget', targetUid: 'v' }), 'never onto itself').toBe(s);
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'r' });
    expect(s.pendingTarget).toBeUndefined();
    expect(s.board.some((c) => c.uid === 'v'), 'destroyed').toBe(false);
    expect(at(s, 'r').attack).toBe(2 + 9);
    expect(at(s, 'r').keywords).toContain('DS');
    expect(at(s, 'w').attack, 'the power is replaced: no +5 Attack wave').toBe(1);
    expect([s.embers, s.heroReady]).toEqual([gold - 3, false]);
  });

  it('the destroy is a REAL death: a Rebirth victim comes back (the shop destroy path)', () => {
    let s = picked('death', { board: [pup('v', 9, 4, ['RB']), pup('r', 2, 6)] });
    s = reduce(s, { type: 'heroPower', uid: 'v' });
    s = reduce(s, { type: 'battlecryTarget', targetUid: 'r' });
    const back = s.board.find((c) => c.cardId === VANILLA.v);
    expect(back, 'the same body, returned').toBeDefined();
    expect(back!.attack).toBe(9);
    expect(back!.keywords).not.toContain('RB'); // spent on the return
    expect(at(s, 'r').attack).toBe(11);
  });

  it('a click-away cancels it untouched; ending the turn abandons it; one minion alone cannot use it', () => {
    let s = picked('death', { board: [pup('v', 9, 4), pup('r', 2, 6)] });
    const before = s;
    s = reduce(s, { type: 'heroPower', uid: 'v' });
    s = reduce(s, { type: 'cancelChoice' });
    expect(s.pendingTarget).toBeUndefined();
    expect([s.embers, s.heroReady, s.board.length]).toEqual([before.embers, true, 2]);
    const lone = picked('death', { board: [pup('v', 9, 4)] });
    expect(reduce(lone, { type: 'heroPower', uid: 'v' })).toBe(lone);
  });

  it('a victim\'s Resilient Ward travels as a Resilient Ward', () => {
    let s = picked('death', { board: [pup('v', 3, 4, ['DS', 'RW']), pup('r', 2, 6)] });
    s = reduce(reduce(s, { type: 'heroPower', uid: 'v' }), { type: 'battlecryTarget', targetUid: 'r' });
    expect(at(s, 'r').keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
  });

  it('prints the replaced power', () => {
    expect(heroPowerText(picked('death'))).toBe('Destroy a friendly minion. Another friendly minion gains its Attack and **Ward**.');
  });
});

describe('Warden × WAR — the next Aegis grants Resilient Ward', () => {
  it('exactly the NEXT Aegis grants Resilient Ward (+ the +5 Attack wave); the one after is a plain Ward', () => {
    let s = picked('war', { board: [pup('a', 1, 5), pup('b', 1, 5)] });
    expect(s.ancients!.resilientAegisLeft).toBe(1);
    expect(heroPowerText(s)).toContain('**Resilient Ward**');
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(at(s, 'a').keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
    expect(at(s, 'a').attack).toBe(6);
    expect(s.ancients!.resilientAegisLeft).toBe(0);
    expect(heroPowerText(s)).not.toContain('Resilient');
    s = reduce({ ...s, heroReady: true }, { type: 'heroPower', uid: 'b' });
    expect(at(s, 'b').keywords).toContain('DS');
    expect(at(s, 'b').keywords).not.toContain('RW');
  });

  it('Resilient Ward is permanent on the run card: it survives a fight (combat strips it from the combat body only)', () => {
    let s = picked('war', { board: [pup('a', 0, 40)] });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    s = fightNow(s);
    const me = s.lastCombat!.initial.player[0]!;
    expect(me.keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
    expect((s.lastCombat!.events as CombatEvent[]).some((e) => e.type === 'wardDowngrade' && e.target === me.uid)).toBe(true);
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a').keywords).toEqual(expect.arrayContaining(['DS', 'RW']));
  });
});

describe('Warden × FORTUNE — 2 Gold next turn per friendly Ward that breaks', () => {
  it('stacks per break (against the same fight without it)', () => {
    const board = [pup('a', 0, 30, ['DS']), pup('b', 0, 30, ['DS']), pup('c', 0, 30, ['DS', 'RW'])];
    const run = (id: AncientId): RunState => reduce(fightNow(picked(id, { board: board.map((c) => ({ ...c, keywords: [...c.keywords] })) })), { type: 'resolveCombat' });
    const withF = picked('fortune', { board });
    const lc = fightNow(withF).lastCombat!;
    const playerUids = new Set(lc.initial.player.map((m) => m.uid));
    const breaks = (lc.events as CombatEvent[]).filter((e) => e.type === 'shield' && playerUids.has(e.target)).length;
    expect(breaks).toBeGreaterThanOrEqual(2);
    expect(lc.playerWardBreaks).toHaveLength(breaks); // the Resilient Ward's downgrade is not a break
    expect(run('fortune').embers - run('death').embers).toBe(2 * breaks);
  });

  it('only the player\'s fight is tracked, and only while Fortune or Genesis is picked', () => {
    expect(ancientCombatMods(picked('fortune')).ancientTrackWardBreaks).toBe(true);
    expect(ancientCombatMods(picked('genesis')).ancientTrackWardBreaks).toBe(true);
    expect(ancientCombatMods(picked('time')).ancientTrackWardBreaks).toBeUndefined();
  });
});

describe('Warden × GENESIS — every 3 friendly Ward breaks, a copy of one of them', () => {
  const result = (ids: string[]): CombatResult => ({ playerWardBreaks: ids } as unknown as CombatResult);

  it('the count carries across combats and the countdown is live', () => {
    const s = picked('genesis');
    expect(heroPowerText(s)).toContain('**3** more to go');
    ancientAfterCombat(s, result(['gnash', 'u3_poochy']));
    expect(s.hand).toHaveLength(0);
    expect(s.ancients!.wardWindow).toEqual(['gnash', 'u3_poochy']);
    expect(heroPowerText(s)).toContain('**1** more to go');
    ancientAfterCombat(s, result(['sandbag', 'gnash'])); // the 3rd pays, the 4th starts the next window
    expect(s.hand).toHaveLength(1);
    expect(['gnash', 'u3_poochy', 'sandbag']).toContain(s.hand[0]!.cardId);
    expect(s.hand[0]!.golden).toBe(false);
    expect(s.ancients!.wardBreaks).toBe(4);
    expect(s.ancients!.wardWindow).toEqual(['gnash']);
    expect(heroPowerText(s)).toContain('**2** more to go');
  });

  it('counts real combat breaks at settle', () => {
    let s = picked('genesis', { board: [pup('a', 0, 30, ['DS']), pup('b', 0, 30, ['DS']), pup('c', 0, 30, ['DS'])] });
    s = fightNow(s);
    const n = s.lastCombat!.playerWardBreaks?.length ?? 0;
    expect(n).toBe(3);
    s = reduce(s, { type: 'resolveCombat' });
    expect(s.ancients!.wardBreaks).toBe(3);
    expect(s.hand).toHaveLength(1);
    expect([VANILLA.a, VANILLA.b, VANILLA.c]).toContain(s.hand[0]!.cardId);
  });
});

describe('Warden × TIME — End of Turn: minions with Ward gain +5/+5', () => {
  it('permanent, only Warded minions (a Resilient Ward counts), and it lands before the fight', () => {
    let s = picked('time', { board: [pup('a', 1, 10, ['DS']), pup('b', 1, 10), pup('c', 1, 10, ['DS', 'RW'])] });
    s = fightNow(s, 0, 50);
    expect([at(s, 'a').attack, at(s, 'a').health]).toEqual([6, 15]);
    expect([at(s, 'b').attack, at(s, 'b').health]).toEqual([1, 10]);
    expect([at(s, 'c').attack, at(s, 'c').health]).toEqual([6, 15]);
    expect(s.lastCombat!.initial.player[0]!.attack).toBe(6); // it fought with the gain
    s = reduce(s, { type: 'resolveCombat' });
    expect(at(s, 'a').attack).toBe(6); // kept
  });

  it('fires in the shop only at End of Turn (a refresh does nothing)', () => {
    let s = picked('time', { board: [pup('a', 1, 10, ['DS'])] });
    s = reduce(s, { type: 'roll' });
    expect(at(s, 'a').attack).toBe(1);
  });
});

describe('Warden × BONDS — a Warded gain gives another Warded minion +5 Attack', () => {
  it('SHOP: Aegis\'s +5 wave makes every Warded minion a gainer; each fires once, and the +5s never re-trigger it', () => {
    let s = picked('bonds', { board: [pup('a', 1, 5, ['DS']), pup('b', 1, 5, ['DS']), pup('c', 1, 5)] });
    s = reduce(s, { type: 'heroPower', uid: 'c' }); // c gains Ward; a, b, c all gain +5 Attack
    const total = ['a', 'b', 'c'].reduce((n, u) => n + at(s, u).attack, 0);
    expect(total).toBe(3 + 3 * 5 + 3 * 5); // printed 1 each, the Aegis wave, one Bonds +5 per gainer
    for (const u of ['a', 'b', 'c']) expect(at(s, u).health).toBe(5); // Bonds is Attack only
  });

  it('SHOP: a lone Warded minion has nobody to give to', () => {
    let s = picked('bonds', { board: [pup('a', 1, 5)] });
    s = reduce(s, { type: 'heroPower', uid: 'a' });
    expect(at(s, 'a').attack).toBe(6);
  });

  it('END OF TURN: a Warded End-of-Turn gain reacts before the fight, and the per-action diff does not repeat it', () => {
    let s = picked('bonds', { board: [card('arn', 'dw_arnold', { keywords: ['DS'] }), pup('b', 1, 5, ['DS'])] });
    const arn0 = at(s, 'arn').attack;
    s = fightNow(s, 0, 50);
    // Beefy (+8/+8 to Arnold AND its neighbours) grows both Warded bodies, so each gives the other +5, exactly once:
    // the End-of-Turn pass handled them, and the per-action diff after the fight is prepared does not repeat it.
    const bondsOf = (c: BoardCard): number => (c.buffs ?? []).filter((b) => b.source === 'Ancient of Bonds').reduce((n, b) => n + b.attack * b.count, 0);
    expect(at(s, 'arn').attack).toBe(arn0 + 8 + 5);
    expect(at(s, 'b').attack).toBe(1 + 8 + 5);
    expect([bondsOf(at(s, 'arn')), bondsOf(at(s, 'b'))]).toEqual([5, 5]);
    expect(s.lastCombat!.initial.player[1]!.attack).toBe(14); // it landed before the fight
  });

  it('COMBAT: the pairing threads the Bonds mod into the player\'s fight', () => {
    expect(ancientCombatMods(picked('bonds')).ancientBonds).toEqual({ attack: 5, label: 'Ancient of Bonds' });
  });
});

describe('Warden × Ancients — serialisable', () => {
  it('the Warden counters survive a JSON round trip', () => {
    const s = picked('genesis');
    s.ancients!.wardWindow = ['gnash'];
    s.ancients!.wardBreaks = 4;
    const back = JSON.parse(JSON.stringify(s)) as RunState;
    expect(back.ancients).toEqual(s.ancients);
  });
});
