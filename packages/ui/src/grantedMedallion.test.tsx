// @vitest-environment jsdom
/**
 * GRANTED TRIGGERS ON THE MEDALLION (owner 2026-10-15, R-MEDAL-GRANTED-01): "hum with the echo whisper on it should get
 * the echo badge, same for other minions that dont have a badge that takes precedence".
 *
 * The portrait medallion resolves from the card's PRINTED mechanics plus the triggers the INSTANCE was granted (a Seed's
 * Drake Pup Echo, kept for good by Hum; a copied Echo; a Shop / rune graft), under the one existing precedence. Pinned:
 * Hum with Seed stacks wears the Echo gem (Shop and combat); a printed badge that outranks the grant keeps the gem; a
 * Whisper's temporary Echo drops its gem at the next turn; the combat snapshot carries a graft so the combat Unit shows it.
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { combatSide, makeRng, simulate, type BoardMinion } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, reduce, type Action, type BoardCard, type BoardSnapshot, type RunState } from '@game/sim';
import type { CardView } from './Card';
import { grantedTriggersOfBoard, grantedTriggersOfSnapshot } from './grantedTriggers';
import { instView } from './instView';
import { resolveMech } from './mechIcon';
import { mechMedallionSrc } from './mechMedallion';
import { storedCardView } from './storedBoardView';
import { Unit } from './Unit';
import { useGame } from './store';
import { versusSnapshotView } from './versus/versusInspectView';
import { mount } from './renderedText.mount';

const bc = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const gem = (v: CardView): string | undefined => resolveMech(v)?.id;

describe('R-MEDAL-GRANTED-01: the medallion reads printed + granted triggers', () => {
  it('Hum has no gem of its own; with Seed stacks (kept or this turn\'s) it wears the Echo gem', () => {
    expect(gem(instView(bc('h', 'd3_hum'), 2))).toBeUndefined();
    expect(gem(instView(bc('h', 'd3_hum', { seedEchoes: 4 }), 2))).toBe('echo');
    expect(gem(instView(bc('h', 'd3_hum', { seedEchoesTemp: 1 }), 2))).toBe('echo');
  });

  it('a printed badge that outranks the granted Echo keeps the gem', () => {
    // Haven Drake's printed Shout leads its text, so it outranks the Seed note's Echo.
    expect(gem(instView(bc('d', 'havendrake'), 2))).toBe('shout');
    expect(gem(instView(bc('d', 'havendrake', { seedEchoes: 2 }), 2))).toBe('shout');
    // A printed Echo stays an Echo (no double counting, no change).
    expect(gem(instView(bc('a', 'b2_armadiyo', { seedEchoes: 1 }), 2))).toBe('echo');
  });

  it('a copied Echo / grafted Echo on a blank body wears the Echo gem; an Echo-stripped copy does not', () => {
    const echo = { on: 'onDeath' as const, do: 'deathrattleSummon' as const, params: { tokenId: 'impscrap', count: 2, fixed: true } };
    expect(gem(instView(bc('h', 'd3_hum', { grantedEffects: [echo] }), 2))).toBe('echo');
    expect(gem(instView(bc('h', 'd3_hum', { copiedEcho: [echo] }), 2))).toBe('echo');
    expect(grantedTriggersOfBoard({ grantedEffects: [echo], echoStripped: true })).toBeUndefined();
  });

  it('a granted self-attack graft reads as Rally, never a watch on allies', () => {
    const rally = { on: 'onAttack' as const, do: 'rallyGoldNextTurn' as const, params: { gold: 1, fixed: true } };
    expect(gem(instView(bc('h', 'd3_hum', { grantedEffects: [rally] }), 2))).toBe('rally');
  });

  it('stored / scouted bodies and Versus snapshot bodies wear it too', () => {
    const stored = { cardId: 'd3_hum', attack: 2, health: 5, keywords: [], seedEchoes: 3 } as unknown as BoardMinion;
    expect(gem(storedCardView(stored))).toBe('echo');
    const snap = { uid: 's1', cardId: 'd3_hum', name: 'Hum', tribe: 'dragon' as const, attack: 2, health: 5, keywords: [], seedEchoes: 3 };
    expect(gem(versusSnapshotView(snap))).toBe('echo');
  });

  it('the granted list is one shared array per shape (perf: no memo churn across dispatches or beats)', () => {
    const a = grantedTriggersOfBoard({ seedEchoes: 1 });
    const b = grantedTriggersOfBoard({ seedEchoesTemp: 5 });
    expect(a).toBeDefined();
    expect(a).toBe(b);
    expect(grantedTriggersOfSnapshot({ seedEchoes: 2 })).toBe(a);
    expect(grantedTriggersOfBoard({})).toBeUndefined();
  });
});

describe('R-MEDAL-GRANTED-01: a Whisper\'s temporary Echo drops its gem when it expires', () => {
  const quiet: BoardSnapshot = { v: 1, wave: 1, heroId: 'indy', resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 1, minions: [{ cardId: 'sandbag', attack: 0, health: 300, keywords: [] }], seed: 1, origin: 'self' } as unknown as BoardSnapshot;
  const step = (s: RunState, a: Action): RunState => reduce(s, a) as RunState;
  const nextTurn = (s: RunState): RunState => {
    const served = { ...s, servedBoards: { ...(s.servedBoards ?? {}), [s.wave]: { ...quiet, wave: s.wave } } } as RunState;
    const after = step(step(step(served, { type: 'faceOmen' }), { type: 'settleCombat' }), { type: 'resolveCombat' });
    return { ...after, runeforgeOffer: undefined } as RunState;
  };

  it('Seed on a blank body: Echo gem this turn, gone at the next Start of Turn', () => {
    let s = { ...createRun(7, undefined, 'ascent', undefined, 'set3'), phase: 'recruit', embers: 40, tier: 6, hand: [bc('g', 'd3_gardener')], board: [bc('x', 'd3_hum', { whisperKeptThisTurn: 1 })] } as RunState;
    s = step(s, { type: 'play', uid: 'g', toIndex: s.board.length } as Action);
    const seed = s.hand.find((c) => c.cardId === 'w3_seed')!;
    s = step(s, { type: 'play', uid: seed.uid, targetUid: 'x' } as Action);
    const hum = (): BoardCard => s.board.find((c) => c.uid === 'x')!;
    expect(hum().seedEchoesTemp).toBe(1); // Hum already kept one this turn, so this Seed is temporary
    expect(gem(instView(hum(), s.tier, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { onBoard: true }))).toBe('echo');
    s = nextTurn(s);
    expect(hum().seedEchoesTemp).toBeUndefined();
    expect(gem(instView(hum(), s.tier, undefined, 0, 0, 0, 0, 0, 0, 0, 1, 0, undefined, undefined, { onBoard: true }))).toBeUndefined();
  });
});

describe('R-MEDAL-GRANTED-01: combat', () => {
  it('the combat snapshot carries a graft beyond the print (Seed stacks and printed effects stay out)', () => {
    const graft = { on: 'onDeath' as const, do: 'deathrattleSummon' as const, params: { tokenId: 'impscrap', count: 2, fixed: true } };
    const p = [
      { cardId: 'd3_hum', attack: 2, health: 5, keywords: [], grantedEffects: [graft] },
      { cardId: 'd3_hum', attack: 2, health: 5, keywords: [], seedEchoes: 2 },
      { cardId: 'havendrake', attack: 2, health: 5, keywords: [] },
    ] as unknown as BoardMinion[];
    const e = [{ cardId: 'sandbag', attack: 0, health: 5000, keywords: [] }] as unknown as BoardMinion[];
    const r = simulate(p, e, makeRng(3), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
    const [grafted, seeded, plain] = r.initial.player;
    expect(grafted!.grantedTriggers).toEqual([{ on: 'onDeath', do: 'deathrattleSummon' }]);
    expect(seeded!.grantedTriggers).toBeUndefined();
    expect(seeded!.seedEchoes).toBe(2);
    expect(plain!.grantedTriggers).toBeUndefined();
  });

  const m = mount(<div />);
  afterEach(() => { m.render(<div />); });
  const HUM = CARD_INDEX['d3_hum']!;
  const unitOf = (over: Record<string, unknown> = {}) => ({
    uid: 'u-hum', cardId: 'd3_hum', name: HUM.name, tribe: HUM.tribe, attack: HUM.attack, health: HUM.health,
    keywords: [], divineShield: false, alive: true, golden: false, summonBonus: 0, baseAttack: HUM.attack, baseHealth: HUM.health,
    ...over,
  });

  it('a combat Hum with Seed stacks shows the Echo gem; without them, no gem', () => {
    act(() => { useGame.setState({ run: createRun(21, 'drakko') as RunState, compactCards: false }); });
    m.render(<Unit u={unitOf()} side="you" />);
    expect(m.container.querySelector('.cgem')).toBeNull();
    m.render(<Unit u={unitOf({ seedEchoes: 4 })} side="you" />);
    const img = m.container.querySelector('.cgem .cgem-img');
    expect(img?.getAttribute('src')).toBe(mechMedallionSrc('echo'));
    // A copied / grafted Echo from the snapshot shows it too.
    m.render(<Unit u={unitOf({ grantedTriggers: [{ on: 'onDeath', do: 'deathrattleSummon' }] })} side="you" />);
    expect(m.container.querySelector('.cgem .cgem-img')?.getAttribute('src')).toBe(mechMedallionSrc('echo'));
  });
});
