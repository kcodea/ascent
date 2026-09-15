import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { createRun, type Action, type RunState } from '../state';
import { reduce } from '../reducer';
import { createRecorder } from './recorder';
import { effectEventsOf, type CardLineage } from './effectsFromTransition';
import { syntheticIdentity, syntheticManifest, synthesizeJob } from './fixtures/syntheticLobby';

const manifest = syntheticManifest('set3', { start: 1, count: 1 });
const identity = syntheticIdentity(manifest);

describe('createRecorder / finalize', () => {
  it('produces a LobbyRecord with canonical ordering regardless of arrival order', () => {
    const a = createRecorder('L', 1, manifest, identity);
    const b = createRecorder('L', 1, manifest, identity);
    const round = (seat: string, r: number) => ({ lobbyId: 'L', seatId: seat, round: r, heroId: 'warden', tier: 1, goldSpent: 0, goldUnspent: 0, board: [], hand: [], health: 30, armor: 0, opponentSeatId: null, result: 'bye' as const, damageDealt: 0, damageTaken: 0, eliminated: false });
    const run = (seat: string) => ({ lobbyId: 'L', seatId: seat, heroId: 'warden', setId: 'set3' as const, tribes: [], policyId: 'p', termination: 'placed' as const, runesOwned: [], finalBoard: [] });
    const act = (seat: string, r: number, i: number) => ({ lobbyId: 'L', seatId: seat, round: r, index: i, action: { type: 'roll' } as Action, goldBefore: 1, goldAfter: 0, offers: [], preHash: 'x', postHash: 'y' });
    a.onRound(round('s0', 1)); a.onRound(round('s1', 1)); a.onRun(run('s0')); a.onRun(run('s1')); a.onAction(act('s0', 1, 0)); a.onAction(act('s0', 1, 1));
    b.onAction(act('s0', 1, 1)); b.onAction(act('s0', 1, 0)); b.onRun(run('s1')); b.onRun(run('s0')); b.onRound(round('s1', 1)); b.onRound(round('s0', 1));
    const ra = a.finalize(); const rb = b.finalize();
    expect(JSON.stringify(ra)).toBe(JSON.stringify(rb));
    expect(ra.roundsPlayed).toBe(1);
    expect(ra.seats.map((s) => s.seatId)).toEqual(['s0', 's1']);
    expect(ra.actions.map((x) => x.index)).toEqual([0, 1]);
    expect(ra.failure).toBeUndefined();
    expect(ra.manifest).toBe(manifest);
    expect(ra.identity).toBe(identity);
  });

  it('fail() censors the lobby and setRoundsPlayed overrides the derived count', () => {
    const r = createRecorder('L', 2, manifest, identity);
    r.fail('seat s3 stuck'); r.setRoundsPlayed(4);
    const out = r.finalize();
    expect(out.failure).toBe('seat s3 stuck');
    expect(out.roundsPlayed).toBe(4);
  });

  it('observeTransition records the action (hashes, Gold, offers) and its effects', () => {
    const r = createRecorder('L', 3, manifest, identity);
    const s0 = createRun(7, 'warden', 'lobby', undefined, 'set3');
    const offer = s0.shop.find((c) => !c.starform)!;
    const s1 = reduce(s0, { type: 'buy', uid: offer.uid });
    expect(s1).not.toBe(s0);
    const evs = r.observeTransition(s0, s1, { type: 'buy', uid: offer.uid }, 's0', 1, 0);
    const out = r.finalize();
    expect(out.actions).toHaveLength(1);
    expect(out.actions[0].goldBefore - out.actions[0].goldAfter).toBe(3);
    expect(out.actions[0].offers).toContain(offer.cardId);
    expect(out.actions[0].preHash).not.toBe(out.actions[0].postHash);
    expect(evs.some((e) => e.kind === 'cardGained' && e.sourceId === offer.cardId && e.route === 'shop' && e.gold === 3)).toBe(true);
    expect(out.effects).toEqual(evs);
  });
});

describe('effectEventsOf on real reducer transitions', () => {
  const ctx = { lobbyId: 'L', seatId: 's0', round: 1 };
  const step = (s: RunState, a: Action, lineage: CardLineage) => { const n = reduce(s, a); expect(n).not.toBe(s); return { n, evs: effectEventsOf(s, n, a, ctx, lineage) }; };

  it('buy → cardGained(shop, price); play → cardPlayed with the shop lineage', () => {
    const lineage: CardLineage = new Map();
    const s0 = createRun(7, 'warden', 'lobby', undefined, 'set3');
    const offer = s0.shop.find((c) => !c.starform)!;
    const { n: s1, evs: e1 } = step(s0, { type: 'buy', uid: offer.uid }, lineage);
    expect(e1).toHaveLength(1);
    expect(e1[0]).toMatchObject({ kind: 'cardGained', sourceId: offer.cardId, route: 'shop', gold: 3, lobbyId: 'L', seatId: 's0', round: 1 });
    const hand = s1.hand[0];
    expect(lineage.get(hand.uid)).toBe('shop');
    const { evs: e2 } = step(s1, { type: 'play', uid: hand.uid }, lineage);
    expect(e2.filter((e) => e.kind === 'cardPlayed')).toHaveLength(1);
    expect(e2.find((e) => e.kind === 'cardPlayed')).toMatchObject({ sourceId: offer.cardId, sourceUid: hand.uid, route: 'shop' });
    expect(e2.some((e) => e.kind === 'cardGained')).toBe(false);
  });

  it('a bought spell cast on a body → spellCast(shop) + the buff it applied; a sell → cardSold with Gold', () => {
    const lineage: CardLineage = new Map();
    let s = createRun(7, 'warden', 'lobby', undefined, 'set3');
    const offer = s.shop.find((c) => !c.starform)!;
    s = step(s, { type: 'buy', uid: offer.uid }, lineage).n;
    s = step(s, { type: 'play', uid: s.hand[0].uid }, lineage).n;
    // Roll into the next turn for Gold; the combat-flow actions are observed too (they may generate cards).
    for (const a of [{ type: 'faceOmen' }, { type: 'settleCombat' }, { type: 'resolveCombat' }] as Action[]) s = step(s, a, lineage).n;
    expect(s.phase).toBe('recruit');
    const spell = s.spell!;
    expect(CARD_INDEX[spell.cardId].spell).toBe(true);
    const { n: s2, evs: bought } = step(s, { type: 'buy', uid: spell.uid }, lineage);
    expect(bought.find((e) => e.kind === 'cardGained')).toMatchObject({ sourceId: spell.cardId, route: 'shop' });
    const inHand = s2.hand.find((c) => c.cardId === spell.cardId)!;
    const target = s2.board[0];
    const { n: s3, evs: cast } = step(s2, { type: 'play', uid: inHand.uid, targetUid: target.uid }, lineage);
    const castEv = cast.find((e) => e.kind === 'spellCast');
    expect(castEv).toMatchObject({ sourceId: spell.cardId, route: 'shop', targetUid: target.uid, targetId: target.cardId });
    expect(cast.filter((e) => e.kind === 'spellCast')).toHaveLength(s3.spellsThisTurn - s2.spellsThisTurn);
    if (s3.recruitBuffFx.length) {
      expect(cast.find((e) => e.kind === 'buff')).toMatchObject({ targetUid: target.uid, targetId: target.cardId });
    }
    expect(lineage.has(inHand.uid)).toBe(false);
    const { evs: sold } = step(s3, { type: 'sell', uid: target.uid }, lineage);
    expect(sold.find((e) => e.kind === 'cardSold')).toMatchObject({ sourceId: target.cardId, route: 'shop' });
    expect(sold.find((e) => e.kind === 'cardSold')!.gold).toBeGreaterThan(0);
  });

  it('a hand card that appears without a buy is routed as generated', () => {
    // Synthetic before/after around a real run: add a card to the hand with no action that grants one.
    const s0 = createRun(11, 'warden', 'lobby', undefined, 'set3');
    const s1: RunState = { ...s0, hand: [...s0.hand, { ...s0.hand[0] ?? { uid: 'gen1', cardId: 'apples', tribe: 'neutral', attack: 0, health: 0 }, uid: 'gen1', cardId: 'apples' } as RunState['hand'][number]] };
    const evs = effectEventsOf(s0, s1, { type: 'roll' }, ctx, new Map());
    expect(evs).toEqual([expect.objectContaining({ kind: 'cardGained', sourceId: 'apples', route: 'generated' })]);
  });
});

describe('synthetic fixture', () => {
  it('is deterministic and shaped like a real lobby', () => {
    const m = syntheticManifest('set3', { start: 100, count: 2 });
    const a = synthesizeJob(m); const b = synthesizeJob(m);
    expect(JSON.stringify(a)).toBe(JSON.stringify(b));
    for (const L of a) {
      expect(L.seats).toHaveLength(8);
      const placements = L.seats.map((s) => s.placement).sort((x, y) => (x ?? 0) - (y ?? 0));
      expect(placements).toEqual([1, 2, 3, 4, 5, 6, 7, 8]);
      expect(L.roundsPlayed).toBeGreaterThan(1);
      for (const e of L.effects) if (e.kind === 'cardGained' || e.kind === 'cardPlayed' || e.kind === 'spellCast') expect(CARD_INDEX[e.sourceId!]).toBeDefined();
      expect(L.actions.every((x) => x.goldBefore >= x.goldAfter || x.action.type === 'sell')).toBe(true);
    }
  });
});
