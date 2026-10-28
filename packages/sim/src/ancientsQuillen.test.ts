/**
 * ANCIENTS × QUILLEN (owner pairings 2026-10-27). Archive (once per turn): "Archive a friendly or shop minion. When full,
 * discover a minion of those types." (full = 3 archived). Every pairing in the phase(s) it fires in.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import type { Tribe } from '@game/core';
import {
  ANCIENT_IDS, activePowers, ancientOfferText, createRun, enableAncients, heroPowerText, poolOf, reduce,
  type AncientId, type BoardCard, type BoardSnapshot, type RunState,
} from './index';
import { hasDeathrattle } from './recruit';

const BASE = 'Archive a friendly or shop minion. When full, discover a minion of those types.';

const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
const base = (over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(7, 'quillen'), phase: 'recruit', tier: 6, embers: 20, heroReady: true, hand: [], board: [], ...over } as RunState);
const picked = (id: AncientId, over: Partial<RunState> = {}): RunState => {
  let s = enableAncients(base(over));
  s = { ...s, ancients: { ...s.ancients!, points: s.ancients!.cost, offer: [id, ...ANCIENT_IDS.filter((a) => a !== id).slice(0, 2)] } };
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};
const foes = (wave: number, attack: number, health: number): BoardSnapshot => ({
  v: 1, wave, heroId: 'indy', resolve: 30, tier: 7, triples: 0, tribes: [], threat: 'glass', power: health,
  minions: [{ cardId: 'sandbag', attack, health, keywords: [] }], seed: 1, origin: 'self',
});
const fightNow = (s: RunState, attack = 0, health = 400): RunState => reduce({ ...s, servedBoards: { [s.wave]: foes(s.wave, attack, health) } }, { type: 'faceOmen' });

/** A single-typed minion of the run's pool for each of the run's types (so Archive has something to pay out). */
const typed = (): { tribe: Tribe; id: string }[] => {
  const s = base();
  const out: { tribe: Tribe; id: string }[] = [];
  for (const c of poolOf(s).buyable) {
    if (c.spell || c.ruby || c.token || c.universalTribe || c.tribe === 'neutral' || c.tribe2 || c.tier > 6) continue;
    if (!s.tribes.includes(c.tribe) || out.some((o) => o.tribe === c.tribe)) continue;
    out.push({ tribe: c.tribe, id: c.id });
  }
  return out;
};
const T = typed();
const archive = (s: RunState, uid: string): RunState => reduce(s, { type: 'heroPower', uid } as never);

describe('Quillen × every Ancient has a written pairing', () => {
  it('all six are written (no "Not written yet."), and none uses an em dash', () => {
    for (const id of ANCIENT_IDS) {
      expect(ancientOfferText('quillen', id)).not.toBe('Not written yet.');
      expect(ancientOfferText('quillen', id)).not.toMatch(/—|--/);
    }
  });
  it('the run has three different types to archive', () => {
    expect(T.length).toBeGreaterThanOrEqual(3);
  });
});

describe('Quillen × DEATH: "Echo minions discovered from Archive gain Rise."', () => {
  const echoId = Object.values(CARD_INDEX).find((c) => !c.spell && !c.ruby && !c.token && hasDeathrattle(c) && !c.keywords.includes('R'))!.id;
  const plainId = 'beatboxer';
  const payout = (pick: string): BoardCard => {
    let s = picked('death', { archivedTribes: [T[0]!.tribe, T[1]!.tribe], board: [card('x', T[2]!.id)] });
    expect(heroPowerText(s)).toBe(`${BASE} **Echo** minions you **Discover** from it gain **Rise**.`);
    s = archive(s, 'x');
    expect(s.discover?.length).toBeGreaterThan(0);
    expect(s.ancients!.discoverTag).toBe('archive');
    s = reduce({ ...s, discover: [pick] }, { type: 'discover', index: 0 });
    return s.hand.find((c) => c.cardId === pick)!;
  };
  it('an Echo pick gains Rise', () => { expect(payout(echoId).keywords).toContain('R'); });
  it('a pick without an Echo does not', () => { expect(payout(plainId).keywords).not.toContain('R'); });
});

describe('Quillen × FORTUNE: "Archive grants +1 Max gold as well."', () => {
  it('each Archive gives +1 max Gold, permanently, printed live', () => {
    let s = picked('fortune', { board: [card('x', T[0]!.id)] });
    const before = s.maxGoldBonus ?? 0;
    s = archive(s, 'x');
    expect(s.maxGoldBonus).toBe(before + 1);
    expect(heroPowerText(s)).toBe(`${BASE} Each Archive also gives **+1** max Gold (**+1** so far).`);
  });
});

describe('Quillen × WAR: "Get a Paragon."', () => {
  it('the pick gets a Paragon', () => {
    const s = picked('war');
    expect(s.hand.filter((c) => c.cardId === 'n2_paragon').length).toBe(1);
    expect(heroPowerText(s)).toBe(`${BASE} You got a **Paragon** when this awakened.`);
  });
});

describe('Quillen × GENESIS: "Archive only requires 2 minions."', () => {
  it('the 2nd archived minion pays out (one pick per type), and the bank empties', () => {
    let s = picked('genesis', { archivedTribes: [T[0]!.tribe], board: [card('x', T[1]!.id)] });
    expect(heroPowerText(s)).toBe('Archive a friendly or shop minion. When **2** are archived, discover a minion of those types.');
    s = archive(s, 'x');
    expect(s.discover?.length).toBe(2);
    expect(s.archivedTribes).toEqual([]);
  });
  it('without it, two archived minions do not pay', () => {
    let s = enableAncients(base({ archivedTribes: [T[0]!.tribe], board: [card('x', T[1]!.id)] }));
    s = archive(s, 'x');
    expect(s.discover).toBeUndefined();
    expect(s.archivedTribes?.length).toBe(2);
  });
});

describe('Quillen × TIME: "Archive becomes: Start of Turn: Get a random minion of your most common type."', () => {
  it('Archive turns passive; each Start of Turn gets a minion of your most common type (its own beat)', () => {
    let s = picked('time', { board: [card('a', T[0]!.id, { health: 50 }), card('b', T[0]!.id, { health: 50 })] });
    expect(activePowers(s)[0]!.passive).toBe(true);
    const name = T[0]!.tribe.charAt(0).toUpperCase() + T[0]!.tribe.slice(1);
    expect(heroPowerText(s)).toBe(`**Start of Turn:** get a random minion of your most common type (**${name}**).`);
    expect(archive(s, 'a').board.length).toBe(2); // no Archive
    s = reduce(fightNow(s), { type: 'resolveCombat' });
    const got = s.hand.filter((c) => !CARD_INDEX[c.cardId]!.spell);
    expect(got.length).toBe(1);
    const d = CARD_INDEX[got[0]!.cardId]!;
    expect(d.tribe === T[0]!.tribe || d.tribe2 === T[0]!.tribe || !!d.universalTribe).toBe(true);
    expect(d.tier).toBeLessThanOrEqual(s.tier);
    expect((s.sotBeatFx ?? []).some((b) => b.source.label === 'Ancient of Time')).toBe(true);
  });
});

describe('Quillen × BONDS: "Archiving 3 different tribes grants 2 discovers."', () => {
  it('three different types: two Discovers (the second queued)', () => {
    let s = picked('bonds', { archivedTribes: [T[0]!.tribe, T[1]!.tribe], board: [card('x', T[2]!.id)] });
    s = archive(s, 'x');
    expect(s.discover?.length).toBe(3);
    expect(s.discoverQueue?.length).toBe(1);
    s = reduce(s, { type: 'discover', index: 0 });
    expect(s.discover?.length).toBe(3);
  });
  it('a repeated type: one Discover', () => {
    let s = picked('bonds', { archivedTribes: [T[0]!.tribe, T[0]!.tribe], board: [card('x', T[1]!.id)] });
    s = archive(s, 'x');
    expect(s.discover?.length).toBe(3);
    expect(s.discoverQueue?.length ?? 0).toBe(0);
  });
});

describe('Quillen × determinism', () => {
  it('every pairing replays identically from the same state', () => {
    for (const id of ANCIENT_IDS) {
      const run = () => {
        let s = picked(id, { wave: 4, archivedTribes: [T[0]!.tribe, T[1]!.tribe], board: [card('x', T[2]!.id), card('a', T[0]!.id, { health: 40 })] });
        s = archive(s, 'x');
        if (s.discover?.length) s = reduce(s, { type: 'discover', index: 0 });
        return reduce(fightNow(s, 1, 1000), { type: 'resolveCombat' });
      };
      const a = run();
      const b = run();
      expect(JSON.stringify(a.lastCombat?.events), id).toBe(JSON.stringify(b.lastCombat?.events));
      expect(JSON.stringify(a.board), id).toBe(JSON.stringify(b.board));
      expect(JSON.stringify(a.hand), id).toBe(JSON.stringify(b.hand));
      expect(JSON.stringify(a.ancients), id).toBe(JSON.stringify(b.ancients));
    }
  });
});
