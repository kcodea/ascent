/**
 * DUOS BATCH 2 (owner picks 2026-11-01, R-DUOS-RUNES-04 + R-DUOS-CARDS-06): two Duos spells (Double Down, Upgrade Assist)
 * and four Duos runes (Hand-Me-Downs, Buddy System, Gild Pact, Pep Talk) plus the reworked Teammate Synergy, each through the real reducer
 * on two teammates' runs, plus Pep Talk's COMBAT half in a tag-team fight (you fight first, your teammate steps in buffed).
 */
import { describe, expect, it } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX, EPIC_RUNES, RUNES, RUNE_INDEX, duosPoolFor, poolFor } from '@game/content';
import { questCombatMods, reduce, runeforgePool } from './reducer';
import { createRun, type BoardCard, type RunState } from './state';
import { createVersusRun } from './versus/run';
import type { VersusRoomOptions } from './versus/options';
import { duosWireOf } from './duosPass';
import { duosRuneTally } from './duosRunes';

const DUOS: VersusRoomOptions = { v: 1, mode: 'duos', modifiers: [] };
const NEW_RUNES = ['rune_hand_me_downs', 'rune_buddy_system', 'rune_gild_pact', 'rune_pep_talk'];

function card(id: string, uid: string, golden = false): BoardCard {
  const d = CARD_INDEX[id]!;
  return { uid, cardId: id, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden };
}
function seat(over: Partial<RunState> = {}, seed = 11): RunState {
  const run = createVersusRun(seed, 'warden', 'set2', DUOS);
  return { ...run, hand: [], board: [], embers: 10, ...over };
}
const rune = (s: RunState, id: string): RunState => reduce(s, { type: 'devGrant', kind: 'rune', id });
/** Ship every entry `from` queued since `since` to `to` (the wire form, `receivePass`), as the transport does. */
function ship(from: RunState, fromSeat: string, to: RunState, since = 0): RunState {
  let out = to;
  for (const e of from.duos!.outbox.slice(since)) out = reduce(out, { type: 'receivePass', from: fromSeat, seq: e.seq, card: duosWireOf(e) });
  return out;
}
/** `n` DIFFERENT effectless minions (nothing triples by accident). */
const plainMinions = (n: number): string[] => poolFor('set2').buyable.filter((c) => !c.spell && !c.chooseOne && c.effects.length === 0 && c.keywords.length === 0).slice(0, n).map((c) => c.id);

describe('R-DUOS-RUNES-04 / R-DUOS-CARDS-06: the batch exists and is Duos-only', () => {
  it('the four runes carry the owner costs and rarities, and only a Duos forge offers them', () => {
    const want: Record<string, [number, boolean]> = {
      rune_hand_me_downs: [1, false], rune_buddy_system: [2, false], rune_gild_pact: [2, false], rune_pep_talk: [1, false],
    };
    for (const [id, [cost, epic]] of Object.entries(want)) {
      const r = RUNE_INDEX[id]!;
      expect(r.duos).toBe(true);
      expect(r.cost).toBe(cost);
      expect((epic ? EPIC_RUNES : RUNES).includes(r)).toBe(true);
    }
    const duosPool = [...runeforgePool({ ...seat(), runeforgeEpic: false } as RunState), ...runeforgePool({ ...seat(), runeforgeEpic: true } as RunState)];
    for (const id of NEW_RUNES) expect(duosPool).toContain(id);
    const lobby = createRun(11, 'warden', 'lobby', undefined, 'set2');
    const lobbyPool = [...runeforgePool({ ...lobby, runeforgeEpic: false } as RunState), ...runeforgePool({ ...lobby, runeforgeEpic: true } as RunState)];
    for (const id of NEW_RUNES) expect(lobbyPool).not.toContain(id);
    // The existing Twin Gilding (2-copy Gilds) is untouched.
    expect(RUNE_INDEX['rune_twin_gilding']!.duos).toBeUndefined();
  });

  it('the two spells are Duos-only neutral Shop spells at the owner tiers and costs, in a Duos run\'s pool only', () => {
    expect(CARD_INDEX['duo_doubledown']).toMatchObject({ spell: true, duos: true, tier: 5, cost: 4, tribe: 'neutral' });
    expect(CARD_INDEX['duo_upgradeassist']).toMatchObject({ spell: true, duos: true, tier: 4, cost: 2, tribe: 'neutral' });
    for (const set of ['set2', 'set3'] as const) {
      for (const id of ['duo_doubledown', 'duo_upgradeassist']) {
        expect(duosPoolFor(set).spells.some((c) => c.id === id)).toBe(true);
        expect(poolFor(set).all.some((c) => c.id === id)).toBe(false);
      }
    }
  });
});

describe('Double Down: "Discover a spell. You and your teammate each get a copy."', () => {
  it('a spell Discover; I keep the pick, my teammate gets a copy of it, streaming from the option I took', () => {
    let ann = seat({ hand: [card('duo_doubledown', 'dd')], tier: 3 });
    ann = reduce(ann, { type: 'play', uid: 'dd' });
    const opts = [...ann.discover!];
    expect(opts.length).toBeGreaterThan(0);
    for (const id of opts) expect(CARD_INDEX[id]!.spell).toBe(true);
    expect(ann.discoverDuos).toBe('copy');
    ann = reduce(ann, { type: 'discover', index: 1 });
    expect(ann.hand.map((c) => c.cardId)).toEqual([opts[1]]);
    expect(ann.duos!.outbox.map((e) => [e.team, e.src])).toEqual([[{ kind: 'gift', cardId: opts[1], count: 1 }, { discover: 1 }]]);
    const bob = ship(ann, 'p1', seat({}, 12));
    expect(bob.hand.map((c) => c.cardId)).toEqual([opts[1]]);
  });

  it('outside Duos it is a plain spell Discover (no rider, nothing queued)', () => {
    const run = createRun(11, 'warden', 'lobby', undefined, 'set2');
    let s: RunState = { ...run, hand: [card('duo_doubledown', 'dd')], board: [], embers: 10, tier: 3 };
    s = reduce(s, { type: 'play', uid: 'dd' });
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.discoverDuos).toBeUndefined();
  });
});

describe('Upgrade Assist: "Your teammate\'s next Shop upgrade costs 3 less."', () => {
  it('lowers only the teammate\'s upgrade price by 3, floored at 0, and stacks with Spencer\'s discount', () => {
    let ann = seat({ hand: [card('duo_upgradeassist', 'ua')] });
    const mine = ann.upgradeCost;
    ann = reduce(ann, { type: 'play', uid: 'ua' });
    expect(ann.upgradeCost).toBe(mine);
    expect(ann.duos!.outbox.map((e) => e.team)).toEqual([{ kind: 'upgradeDiscount', amount: 3 }]);
    let bob = seat({ upgradeCost: 7 }, 12);
    bob = ship(ann, 'p1', bob);
    expect(bob.upgradeCost).toBe(4);
    // Spencer's 1 on top (the same team effect): 3.
    bob = reduce(bob, { type: 'receivePass', from: 'p1', seq: 50, card: { uid: 'team50', cardId: '__team', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false, passFrom: 'team', team: { kind: 'upgradeDiscount', amount: 1 } } as unknown as BoardCard });
    expect(bob.upgradeCost).toBe(3);
    // A second Assist cannot push it below 0.
    bob = ship(ann, 'p3', bob);
    expect(bob.upgradeCost).toBe(0);
  });
});

describe('Hand-Me-Downs: "When you sell a minion, your teammate gets 1 Gold. (Twice per turn)"', () => {
  it('the first two sales each turn send 1 Gold, streaming from the rune badge; the live tally counts them', () => {
    const ids = plainMinions(3);
    let ann = rune(seat({ board: ids.map((id, i) => card(id, `m${i}`)) }), 'rune_hand_me_downs');
    expect(duosRuneTally(ann, 'rune_hand_me_downs')).toBe('0/2 this turn');
    const sent = ann.duos!.outbox.length;
    for (let i = 0; i < 3; i++) ann = reduce(ann, { type: 'sell', uid: `m${i}` });
    const golds = ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'gold');
    expect(golds.map((e) => [e.team, e.src])).toEqual([[{ kind: 'gold', amount: 1 }, { rune: 'rune_hand_me_downs' }], [{ kind: 'gold', amount: 1 }, { rune: 'rune_hand_me_downs' }]]);
    expect(duosRuneTally(ann, 'rune_hand_me_downs')).toBe('2/2 this turn');
    const bob = ship(ann, 'p1', seat({ embers: 3 }, 12), sent);
    expect(bob.embers).toBe(5);
    // Next turn the allowance is fresh.
    expect(duosRuneTally({ ...ann, wave: ann.wave + 1 }, 'rune_hand_me_downs')).toBe('0/2 this turn');
  });
});

describe('Buddy System: "When you buy a minion, give your teammate\'s left-most minion +3/+2." (no limit)', () => {
  it('every minion bought sends +3/+2 to the teammate\'s left-most, permanently, from the rune badge', () => {
    let ann = rune(seat({ embers: 30 }), 'rune_buddy_system');
    const sent = ann.duos!.outbox.length;
    let bought = 0;
    for (let k = 0; k < 4; k++) {
      const offer = ann.shop.find((o) => { const d = CARD_INDEX[o.cardId]; return !!d && !d.spell && !d.ruby && !o.starform; });
      if (!offer) break;
      ann = reduce(ann, { type: 'buy', uid: offer.uid });
      bought += 1;
    }
    expect(bought).toBeGreaterThanOrEqual(3);
    const buffs = ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'buffLeftmost');
    expect(buffs).toHaveLength(bought);
    expect(buffs[0]!.team).toEqual({ kind: 'buffLeftmost', attack: 3, health: 2, runeId: 'rune_buddy_system' });
    expect(buffs[0]!.src).toEqual({ rune: 'rune_buddy_system' });
    const [a, b] = plainMinions(2);
    let bob = seat({ board: [card(a!, 'l'), card(b!, 'r')] }, 12);
    bob = ship(ann, 'p1', bob, sent);
    expect(bob.board[0]!.attack).toBe(CARD_INDEX[a!]!.attack + 3 * bought);
    expect(bob.board[0]!.health).toBe(CARD_INDEX[a!]!.health + 2 * bought);
    expect(bob.board[1]!.attack).toBe(CARD_INDEX[b!]!.attack);
    expect(bob.board[0]!.buffs?.some((x) => x.source === 'Buddy System')).toBe(true);
  });
});

/** Bob Gilds by tripling a plain minion (the third copy arrives as a pass, R-DUOS-PASS-06). */
function bobGilds(bob: RunState, k: number): RunState {
  const id = plainMinions(1)[0]!;
  const b = { ...bob, hand: [card(id, `ga${k}`)], board: [...bob.board.filter((c) => c.golden), card(id, `gb${k}`)] };
  return reduce(b, { type: 'receivePass', from: 'p3', seq: 900 + k, card: { ...card(id, `gx${k}`), passFrom: 'hand' } as BoardCard });
}

describe('Gild Pact: "When your teammate Gilds a minion, you and your teammate each get 2 Gold Pouches."', () => {
  it('my rune tells my teammate\'s run to report its Gilds; each one gives us BOTH 2 Gold Pouches', () => {
    let ann = rune(seat(), 'rune_gild_pact');
    let bob = seat({}, 12);
    // Bob's run learns that Ann listens (her rune's `listen`).
    bob = ship(ann, 'p1', bob);
    expect(bob.duos!.runes?.mateListens?.gild).toBe(true);
    const bobSent = bob.duos!.outbox.length;
    bob = bobGilds(bob, 0);
    expect([...bob.hand, ...bob.board].some((c) => c.golden)).toBe(true);
    expect(bob.duos!.outbox.slice(bobSent).map((e) => e.team?.kind)).toContain('mateGild');
    const annSent = ann.duos!.outbox.length;
    ann = ship(bob, 'p2', ann, bobSent);
    expect(ann.hand.filter((c) => c.cardId === 'emberpouch')).toHaveLength(2);
    const back = ann.duos!.outbox.slice(annSent);
    expect(back.map((e) => [e.team, e.src])).toEqual([[{ kind: 'gift', cardId: 'emberpouch', count: 2 }, { rune: 'rune_gild_pact' }]]);
    const bobHand = bob.hand.length;
    bob = ship(ann, 'p1', bob, annSent);
    expect(bob.hand.filter((c) => c.cardId === 'emberpouch')).toHaveLength(2);
    expect(bob.hand.length).toBe(bobHand + 2);
  });

  it('no listener, no report: a Gild with no Gild rune on the teammate\'s run sends nothing extra', () => {
    let bob = seat({}, 12);
    const sent = bob.duos!.outbox.length;
    bob = bobGilds(bob, 0);
    expect(bob.duos!.outbox.slice(sent).some((e) => e.team?.kind === 'mateGild')).toBe(false);
  });
});

/** A Triple Reward wire from seat `from` (`synergy` = sent by their Teammate Synergy). */
const tripleWire = (seq: number, tier?: number, synergy = false): BoardCard => ({
  uid: `team${seq}`, cardId: '__team', tribe: 'neutral', attack: 0, health: 0, keywords: [], golden: false, passFrom: 'team',
  team: { kind: 'tripleReward', count: 1, ...(tier ? { tier } : {}), ...(synergy ? { synergy: true } : {}) },
} as unknown as BoardCard);
const rewards = (s: RunState): BoardCard[] => s.hand.filter((c) => c.cardId === 'discoverspell');

describe('Teammate Synergy (reworked, owner 2026-11-01): "When you get a Triple Reward, your teammate gets one too. (3 per game)"', () => {
  it('the rune text and the badge read the new rule', () => {
    expect(RUNE_INDEX['rune_teammate_synergy']!.text).toBe('When you get a **Triple Reward**, your teammate gets one too. **(3 per game)**');
    expect(duosRuneTally(rune(seat(), 'rune_teammate_synergy'), 'rune_teammate_synergy')).toBe('3 left');
  });

  it('ANY Triple Reward I get (not only a Gild) sends my teammate one at the SAME tier, streaming from the rune badge', () => {
    let ann = rune(seat({ tier: 4 }), 'rune_teammate_synergy');
    const sent = ann.duos!.outbox.length;
    // A Triple Reward from outside (another seat's gift: not a Gild of mine, not a Synergy reward).
    ann = reduce(ann, { type: 'receivePass', from: 'p9', seq: 1, card: tripleWire(1) });
    expect(rewards(ann)).toHaveLength(1);
    const out = ann.duos!.outbox.slice(sent);
    expect(out.map((e) => [e.team, e.src])).toEqual([[{ kind: 'tripleReward', count: 1, tier: 4, synergy: true }, { rune: 'rune_teammate_synergy' }]]);
    expect(duosRuneTally(ann, 'rune_teammate_synergy')).toBe('2 left');
    const bob = ship(ann, 'p1', seat({ tier: 1 }, 12), sent);
    expect(rewards(bob)).toHaveLength(1);
    expect(rewards(bob)[0]!.grantedTier).toBe(4); // the same reward: Ann's tier, not Bob's
  });

  it('the Triple Reward a Gild pays counts too, and the rune stops after 3 per game', () => {
    const id = plainMinions(1)[0]!;
    let ann = rune(seat(), 'rune_teammate_synergy');
    let gifts = 0;
    for (let k = 0; k < 4; k++) {
      const sent = ann.duos!.outbox.length;
      ann = { ...ann, hand: [card(id, `a${k}`)], board: [card(id, `c${k}`)] };
      ann = reduce(ann, { type: 'receivePass', from: 'p2', seq: 100 + k, card: { ...card(id, `x${k}`), passFrom: 'hand' } as BoardCard });
      const g = ann.hand.find((c) => c.golden)!;
      ann = reduce({ ...ann, board: [] }, { type: 'play', uid: g.uid }); // playing the Gilded copy pays its Triple Reward
      gifts += ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'tripleReward').length;
    }
    expect(gifts).toBe(3);
    expect(duosRuneTally(ann, 'rune_teammate_synergy')).toBe('0 left');
  });

  it('NO LOOP: a Triple Reward my teammate\'s Synergy sent me never sends one back, even when I hold Synergy too', () => {
    let ann = rune(seat(), 'rune_teammate_synergy');
    let bob = rune(seat({}, 12), 'rune_teammate_synergy');
    const annSent = ann.duos!.outbox.length;
    ann = reduce(ann, { type: 'receivePass', from: 'p9', seq: 1, card: tripleWire(1) });
    const bobSent = bob.duos!.outbox.length;
    bob = ship(ann, 'p1', bob, annSent);
    expect(rewards(bob)).toHaveLength(1);
    expect(bob.duos!.outbox.slice(bobSent).some((e) => e.team?.kind === 'tripleReward')).toBe(false);
    expect(duosRuneTally(bob, 'rune_teammate_synergy')).toBe('3 left');
    // And a Synergy-flagged reward on its own never spends a use.
    bob = reduce(bob, { type: 'receivePass', from: 'p1', seq: 77, card: tripleWire(77, 3, true) });
    expect(duosRuneTally(bob, 'rune_teammate_synergy')).toBe('3 left');
  });
});

describe('Pep Talk (owner change 2026-11-01): "When you trigger a Shout, give your teammate\'s left-most minion +2/+3." (no limit)', () => {
  const shouters = (): string[] => poolFor('set2').buyable.filter((c) => !c.spell && c.effects.some((e) => e.on === 'onPlay') && !c.target && !c.chooseOne && !c.duos).slice(0, 3).map((c) => c.id);

  it('the rune text reads the new rule', () => {
    expect(RUNE_INDEX['rune_pep_talk']!.text).toBe("When you trigger a **Shout**, give your teammate's **left-most** minion **+2/+3**.");
  });

  it('SHOP: each of MY Shouts gives my teammate\'s left-most +2/+3, permanently, streaming from the rune badge', () => {
    let ann = rune(seat({ hand: shouters().map((id, i) => card(id, `s${i}`)) }), 'rune_pep_talk');
    const sent = ann.duos!.outbox.length;
    for (let i = 0; i < 3; i++) {
      ann = reduce(ann, { type: 'play', uid: `s${i}` });
      if (ann.discover) ann = reduce(ann, { type: 'discover', index: 0 });
    }
    const buffs = ann.duos!.outbox.slice(sent).filter((e) => e.team?.kind === 'buffLeftmost');
    expect(buffs.length).toBeGreaterThanOrEqual(3);
    for (const e of buffs) expect(e.src).toEqual({ rune: 'rune_pep_talk' });
    const total = buffs.reduce((n, e) => n + (e.team as { attack: number }).attack, 0);
    const shouts = total / 2;
    expect(shouts).toBeGreaterThanOrEqual(3);
    const [a, b] = plainMinions(2);
    let bob = seat({ board: [card(a!, 'l'), card(b!, 'r')] }, 12);
    bob = ship(ann, 'p1', bob, sent);
    expect(bob.board[0]!.attack).toBe(CARD_INDEX[a!]!.attack + 2 * shouts);
    expect(bob.board[0]!.health).toBe(CARD_INDEX[a!]!.health + 3 * shouts);
    expect(bob.board[1]!.attack).toBe(CARD_INDEX[b!]!.attack);
    expect(bob.board[0]!.buffs?.some((x) => x.source === 'Pep Talk')).toBe(true);
  });

  it('SHOP: my teammate\'s Shouts do nothing for my Pep Talk (only mine count)', () => {
    const ann = rune(seat(), 'rune_pep_talk');
    let bob = ship(ann, 'p1', seat({ hand: shouters().map((id, i) => card(id, `s${i}`)) }, 12));
    const sent = bob.duos!.outbox.length;
    bob = reduce(bob, { type: 'play', uid: 's0' });
    expect(bob.duos!.outbox.slice(sent).some((e) => e.team?.kind === 'buffLeftmost')).toBe(false);
  });

  it('the holder\'s run carries the buff into combat (QuestCombatMods.duosPepTalk)', () => {
    expect(questCombatMods(rune(seat(), 'rune_pep_talk')).duosPepTalk).toEqual({ attack: 2, health: 3 });
    expect(questCombatMods(seat()).duosPepTalk).toBeUndefined();
  });

  // COMBAT (owner: "these types of triggers need to work in combat so if you go second, they have the buff"). A tag-team
  // fight: the HOLDER's board fights first and triggers a Shout in combat (Ryme dies first and its Echo re-fires
  // Pennycat's Shout); the teammate's board waits as the reserve and steps in with its left-most already buffed, this
  // fight only.
  const first = (): BoardMinion[] => [{ cardId: 'ryme', attack: 1, health: 1, sourceUid: 'pW1' }, { cardId: 'alley', attack: 1, health: 30, sourceUid: 'pW0' }];
  const foe = (): BoardMinion[] => [{ cardId: plainMinions(1)[0]!, attack: 40, health: 400, sourceUid: 'f0' }];
  const mate = (): BoardMinion[] => [{ cardId: plainMinions(1)[0]!, attack: 2, health: 2, sourceUid: 'm0' }, { cardId: plainMinions(2)[1]!, attack: 2, health: 2, sourceUid: 'm1' }];
  const holder = () => ({ ...combatSide(), questMods: { duosPepTalk: { attack: 2, health: 3 } } });
  /** `firstState` = the side fighting first (its own run context), `reserveState` = the teammate waiting. */
  const fight = (firstState: ReturnType<typeof combatSide>, reserveState: ReturnType<typeof combatSide>, reserveBoard = mate()) =>
    simulate(first(), foe(), makeRng(4), CARD_INDEX, firstState, combatSide(), { reserve: { player: { board: reserveBoard, state: reserveState } } });
  const tagIn = (r: ReturnType<typeof simulate>) => r.events.find((e): e is Extract<CombatEvent, { type: 'tagIn' }> => e.type === 'tagIn' && e.side === 'player');

  it('COMBAT, I fight first: my combat Shouts buff my waiting teammate\'s left-most before they step in', () => {
    const plain = fight(combatSide(), combatSide());
    const pep = fight(holder(), combatSide());
    const base = tagIn(plain)!.minions[0]!;
    const buffed = tagIn(pep)!.minions[0]!;
    // One combat Shout fired before the step-in (Ryme's Echo re-fires Pennycat): exactly +2/+3.
    expect(pep.events.some((e) => e.type === 'shout')).toBe(true);
    expect([buffed.attack - base.attack, buffed.health - base.health]).toEqual([2, 3]);
    // Only the left-most.
    expect(tagIn(pep)!.minions[1]!.attack).toBe(tagIn(plain)!.minions[1]!.attack);
  });

  it('COMBAT is combat-only: the teammate\'s locked board passed in is never changed (their run keeps its stats)', () => {
    const board = mate();
    const snap = structuredClone(board);
    fight(holder(), combatSide(), board);
    expect(board).toEqual(snap);
  });

  it('COMBAT, my teammate fights first: their Shouts never trigger MY Pep Talk (only the holder\'s own Shouts count)', () => {
    // The holder is the RESERVE here; the board fighting first has no Pep Talk. Same fight as without the rune.
    expect(tagIn(fight(combatSide(), holder()))!.minions).toEqual(tagIn(fight(combatSide(), combatSide()))!.minions);
  });

  it('COMBAT is symmetric: the enemy side\'s holder buffs its own reserve the same way', () => {
    const p = fight(holder(), combatSide());
    const e = simulate(foe(), first(), makeRng(4), CARD_INDEX, combatSide(), holder(), { firstSide: 'enemy', reserve: { enemy: { board: mate(), state: combatSide() } } });
    const tagE = e.events.find((x): x is Extract<CombatEvent, { type: 'tagIn' }> => x.type === 'tagIn' && x.side === 'enemy');
    expect(tagE?.minions[0]!.attack).toBe(tagIn(p)!.minions[0]!.attack);
    expect(tagE?.minions[0]!.health).toBe(tagIn(p)!.minions[0]!.health);
  });
});
