/**
 * EVERY SHOUT TRIGGERED IN COMBAT RESOLVES IN REAL TIME (R-REALTIME-03, owner 2026-09-26).
 *
 * *"all shouts should be real time in combat, regardless of what they do/are. theres no point in delaying any of
 * them and they may be important to trigger other combat effects like gangplank's to hand watcher."*
 *
 * A Shout re-fired mid-fight (Dawnclaw / Ryme, a Rally re-fire, Parting Cry, an Ancient of Time, Shared Scripture)
 * used to resolve live ONLY when its `do` had a combat factory; every other Shout was deferred and replayed in the
 * Shop after the fight. Now every onPlay id either has a combat factory (it resolves on the beat) or sits on the
 * explicit, reasoned `SHOP_ONLY_SHOUTS` list (its target is the Shop row / the Starform / Orbit / a Consume): it
 * still fires live (its line, every Shout counter) and only its Shop part is applied at settle, once.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { FACTORIES, SHOP_ONLY_SHOUTS, combatSide, makeRng, simulate, type BoardMinion, type CombatEvent } from '@game/core';
import {
  ANCIENT_IDS, createRun, enableAncients, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';

// ── content walk ────────────────────────────────────────────────────────────────────────────────────────────

/** Every onPlay (Shout) `do` id content uses, across every set (archived included: CARD_INDEX is global). */
function shoutIds(): Map<string, string[]> {
  const out = new Map<string, string[]>();
  for (const c of Object.values(CARD_INDEX)) {
    for (const e of c?.effects ?? []) {
      if (e.on !== 'onPlay') continue;
      if (!out.has(e.do)) out.set(e.do, []);
      out.get(e.do)!.push(c.id);
    }
  }
  return out;
}

describe('R-REALTIME-03 — every Shout id is combat-live or an explicit Shop-only exception', () => {
  const ids = shoutIds();

  it('fixture guard: content has Shouts to walk', () => {
    expect(ids.size).toBeGreaterThan(40);
  });

  it('no onPlay id silently defers: each has a combat factory OR a SHOP_ONLY_SHOUTS entry', () => {
    const holes = [...ids.keys()].filter((d) => !FACTORIES[d as keyof typeof FACTORIES] && !SHOP_ONLY_SHOUTS[d]);
    expect(holes, `Shout id(s) that would defer to settle with no ruling: ${holes.join(', ')}. Give each a combat `
      + 'factory (the default, R-REALTIME-03), or add it to SHOP_ONLY_SHOUTS with the reason its target cannot exist mid-fight.').toEqual([]);
  });

  it('the Shop-only list is exact: every entry is a real Shout, has no combat factory, and says why', () => {
    for (const [d, ex] of Object.entries(SHOP_ONLY_SHOUTS)) {
      expect(ids.has(d), `${d}: no content Shout uses it any more — delete the entry`).toBe(true);
      expect(FACTORIES[d as keyof typeof FACTORIES], `${d}: a combat factory exists — it is live, delete the entry`).toBeUndefined();
      expect(ex.why.length, `${d}: a reason`).toBeGreaterThan(20);
      expect(ex.line, `${d}: its live line`).toBeTruthy();
      expect(ex.line).not.toMatch(/—|--/); // player-facing text: no em dash (owner rule 2026-09-21)
    }
  });

  it('the Shop-only exceptions are the nine the ruling was reviewed against (grow this deliberately)', () => {
    expect(Object.keys(SHOP_ONLY_SHOUTS).sort()).toEqual([
      'armChooseBoth', 'battlecryAllDemonsConsume', 'battlecryCollapseStarform', 'battlecryConsumeShopRandom',
      'battlecryCreateStarformOrBuff', 'battlecryStarformConsumeShop', 'battlecryTargetConsumesShop',
      'buffRightmostSlotPermanent', 'triggerAdjacentOrbits',
    ]);
  });
});

// ── simulate-level (Dawnclaw's Echo re-fires the adjacent Shouts) ─────────────────────────────────────────────

const bm = (cardId: string, attack: number, health: number, extra: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, ...extra } as BoardMinion);
/** Dawnclaw (1/1 Taunt) dies to the first swing and its Echo re-fires its living neighbours' Shouts. */
const refire = (left: BoardMinion, right: BoardMinion[] = [], side = combatSide({ tier: 6 })) => simulate(
  [left, bm('b2_dawnclaw', 1, 1), ...right], [bm('sandbag', 50, 9999)], makeRng(4), CARD_INDEX, side, combatSide({ tier: 6 }));
const ofType = <T extends CombatEvent['type']>(ev: readonly CombatEvent[], t: T) =>
  ev.filter((e): e is Extract<CombatEvent, { type: T }> => e.type === t);

describe('R-REALTIME-03 — a card-to-hand Shout re-fired in combat', () => {
  it("Defender's Tower Shields fly to hand ON the Shout, and Gangplank's hand watcher pays out mid-fight", () => {
    const r = refire(bm('n3_defender', 1, 9999), [bm('dw_gangplank', 1, 9999), bm('dw_gangplank', 1, 9999)]);
    const shout = r.events.findIndex((e) => e.type === 'shout');
    expect(shout, 'the Echo re-fired the Shout').toBeGreaterThanOrEqual(0);
    const toHand = r.events.map((e, i) => [e, i] as const).filter(([e]) => e.type === 'toHand' && (e as { cardId: string }).cardId === 'tower_shield');
    expect(toHand.length, 'two Tower Shields, live').toBe(2);
    expect(toHand.every(([, i]) => i > shout), 'after the Shout fires').toBe(true);
    // Gangplank (+1/+2 to a random OTHER friendly Dwarf): each of the two pays the other, once per card: 2 x 2.
    const gpUids = new Set(r.initial.player.filter((m) => m.cardId === 'dw_gangplank').map((m) => m.uid));
    const paid = ofType(r.events, 'buff').filter((e) => gpUids.has(e.target) && e.attack === 1 && e.health === 2);
    expect(paid.length, "each Gangplank's watcher fired once per Tower Shield, during the fight").toBe(4);
    expect(r.events.findIndex((e) => e.type === 'buff' && gpUids.has((e as { target: string }).target)), 'after the cards arrived').toBeGreaterThan(toHand[0]![1]);
    expect(r.playerHandGrants).toEqual(['tower_shield', 'tower_shield']);
    expect(r.playerDeferredBattlecries, 'nothing is left to replay at settle').toBeUndefined();
  });

  it("Branch Manager's Discover lands a Spirit in hand live (a random pick, the combat Discover rule) and wakes the watcher", () => {
    const r = refire(bm('sp3_gatheringguide', 1, 9999), [bm('sp3_tidebud', 1, 9999)], combatSide({ tier: 6, tribes: ['spirit'] }));
    const got = ofType(r.events, 'toHand');
    expect(got.length, 'one Spirit to hand').toBe(1);
    const def = CARD_INDEX[got[0]!.cardId]!;
    expect(def.tribe === 'spirit' || def.tribe2 === 'spirit' || !!def.universalTribe, `${def.id} is a Spirit`).toBe(true);
    expect(got[0]!.cardId, 'never itself').not.toBe('sp3_gatheringguide');
  });

  it('a Discover-to-hand Shout that was ALREADY live (Sea Urchin-style random grant) now wakes the hand watchers too', () => {
    const r = refire(bm('sp3_revelator', 1, 9999), [bm('dw_gangplank', 1, 9999), bm('dw_gangplank', 1, 9999)]);
    expect(ofType(r.events, 'toHand').length).toBe(1);
    const gpUids = new Set(r.initial.player.filter((m) => m.cardId === 'dw_gangplank').map((m) => m.uid));
    expect(ofType(r.events, 'buff').filter((e) => gpUids.has(e.target)).length, 'each Gangplank pays the other once').toBe(2);
  });
});

describe('R-REALTIME-03 — hand buffs, Gold and run flags land on the beat', () => {
  it('a hand-buff Shout (Tidebud) grows the hand card live (a handBuff event), never at settle', () => {
    const hand = [{ uid: 'h1', cardId: 'sp3_flamereveler', attack: 4, health: 3, keywords: [], golden: false }];
    const r = refire(bm('sp3_tidebud', 1, 9999), [], combatSide({ tier: 6, handMinions: hand }));
    const hb = ofType(r.events, 'handBuff');
    expect(hb.map((e) => [e.uid, e.health])).toEqual([['h1', 2]]);
    expect(r.playerDeferredBattlecries).toBeUndefined();
  });

  it("a Gold Shout (Paymaster Pimm) counts live: its line on the beat and the next-turn Gold carried back", () => {
    const r = refire(bm('dw_pimm', 1, 9999));
    const shout = r.events.findIndex((e) => e.type === 'shout');
    const line = r.events.findIndex((e) => e.type === 'sc' && /Gold next turn/.test((e as { text: string }).text));
    expect(line).toBeGreaterThan(shout);
    expect(r.playerBonusGold).toBeGreaterThanOrEqual(1);
  });

  it('Nimbus banks its extra cast the moment it fires (a live line + the carry-back), not as a settle replay', () => {
    const r = refire(bm('nimbus', 1, 9999));
    expect(r.events.some((e) => e.type === 'sc' && (e as { text: string }).text === 'Your next spell: +1 cast')).toBe(true);
    expect(r.playerShoutCarry?.nextSpellExtraCasts).toBe(1);
    expect(r.playerDeferredBattlecries).toBeUndefined();
  });

  it('Baby Gastrid reads the Gold spent in the turn that just ended, live (Rune of Full Measure pays Attack too)', () => {
    const r = refire(bm('dw_dorrin', 1, 9999), [bm('dw_gangplank', 1, 9999)],
      combatSide({ tier: 6, goldSpentThisTurn: 5, questMods: { runeFullMeasure: true } }));
    const gp = r.initial.player.find((m) => m.cardId === 'dw_gangplank')!.uid;
    const src = r.initial.player[0]!.uid;
    expect(ofType(r.events, 'buff').filter((e) => e.source === src && e.target === gp).map((e) => [e.attack, e.health])).toEqual([[10, 10]]);
  });
});

describe('R-REALTIME-03 — a Shop-only Shout still fires live', () => {
  it('Star Seed logs its line on the beat and records ONE settle replay carrying its run card', () => {
    const r = refire(bm('ce3_starseed', 1, 9999, { sourceUid: 'run-seed' }));
    expect(r.events.some((e) => e.type === 'sc' && /Starform when the Shop opens/.test((e as { text: string }).text))).toBe(true);
    expect(r.playerDeferredBattlecries).toEqual([{ cardId: 'ce3_starseed', golden: false, uid: 'run-seed' }]);
  });
});

// ── end to end: the reducer fight + settle (Auctioneer × Time fires the edge Shouts at Start of Combat) ────────

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: 400, keywords: [], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'myra'), phase: 'recruit', embers: 60, hand: [], ...over } as RunState);
const withTime = (over: Partial<RunState> = {}): RunState => {
  const id: AncientId = 'time';
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  return reduce(s, { type: 'pickAncient', id });
};
const foes = (wave: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: 400,
  minions: [{ cardId: 'sandbag', attack: 0, health: 400, keywords: [] }], seed: 1, origin: 'self',
});
const fightAndSettle = (s: RunState): { fought: RunState; settled: RunState } => {
  const fought = reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave) } }, { type: 'faceOmen' });
  return { fought, settled: reduce(fought, { type: 'resolveCombat' }) };
};
const beforeFirstAttack = (s: RunState): CombatEvent[] => {
  const ev = s.lastCombat!.events as CombatEvent[];
  const first = ev.findIndex((e) => e.type === 'attack');
  return first < 0 ? ev : ev.slice(0, first);
};

describe('R-REALTIME-03 end to end — live in the fight, applied ONCE at settle', () => {
  it('Defender at Start of Combat: the Shields arrive in the fight, and settle adds exactly two (no replay)', () => {
    const { fought, settled } = fightAndSettle(withTime({ board: [card('d', 'n3_defender')] }));
    expect(beforeFirstAttack(fought).filter((e) => e.type === 'toHand').length).toBe(2);
    expect(settled.hand.filter((c) => c.cardId === 'tower_shield').length).toBe(2);
  });

  it('Contract Butcher: "+2/+1 Shop" on the beat; the permanent shop buff is applied exactly once', () => {
    const s = withTime({ board: [card('b', 'dm_butcher')] });
    const before = { ...s.tavernBuyBonus };
    const { fought, settled } = fightAndSettle(s);
    expect(beforeFirstAttack(fought).some((e) => e.type === 'sc' && (e as { text: string }).text === '+2/+1 Shop')).toBe(true);
    expect([settled.tavernBuyBonus.atk - before.atk, settled.tavernBuyBonus.hp - before.hp]).toEqual([2, 1]);
  });

  it('Squirl Scout: the run-wide snowball grows live, buffs this fight, and carries back ONE step', () => {
    const s = withTime({ board: [card('q', 'squirlscout'), card('w', 'whelpling')], squirlScoutBuff: 2 });
    const { fought, settled } = fightAndSettle(s);
    const src = fought.lastCombat!.initial.player[0]!.uid;
    const grants = beforeFirstAttack(fought).filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === src);
    expect(grants.map((e) => [e.attack, e.health]), 'one Beast owned → one grant of the improved value (2 + 1)').toEqual([[3, 3]]);
    expect(settled.squirlScoutBuff, 'the step is carried back once').toBe(3);
    expect(settled.board.find((c) => c.uid === 'w')!.attack, 'the combat grant was a combat gain, not a Shop buff').toBe(card('w', 'whelpling').attack);
  });

  it('Nimbus: the next-spell charge is banked once, never doubled by a settle replay', () => {
    const { settled } = fightAndSettle(withTime({ board: [card('n', 'nimbus')], nextSpellExtraCasts: 0 }));
    expect(settled.nextSpellExtraCasts).toBe(1);
  });

  it('Star Seed (Shop-only): fires its line in the fight, and settle creates exactly one Starform', () => {
    const { fought, settled } = fightAndSettle(withTime({ board: [card('ss', 'ce3_starseed')] }));
    expect(beforeFirstAttack(fought).some((e) => e.type === 'sc' && /Starform/.test((e as { text: string }).text))).toBe(true);
    expect(fought.lastCombat!.playerDeferredBattlecries).toEqual([{ cardId: 'ce3_starseed', golden: false, uid: 'ss' }]);
    expect(fought.shop.some((o) => o.starform), 'no Starform before settle').toBe(false);
    expect(settled.shop.filter((o) => o.starform).length, 'settle applied the Shop part exactly once').toBe(1);
  });
});
