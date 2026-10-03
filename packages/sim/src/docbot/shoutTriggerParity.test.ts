/**
 * DOC BOT LANE `shoutTriggerParity` (R-SHOUT-TRIGGER-01) — a TRIGGERED Shout is a Shout, for every listener.
 *
 * Born from the owner report 2026-10-03 ("auctioneer w/ rune of the choir does not work and it should"): the
 * Choir's extra lived only in the PLAYED-Shout counter, so the Auctioneer's Pulse (and every other re-trigger, and
 * every combat Shout) never heard it. Two halves:
 *   · SOURCE (shoutTriggerParity.ts): every shop and combat site that fires a Shout is derived and must read its
 *     phase's Shout-extras fold. A new hand-rolled Shout loop fails here the day it lands.
 *   · BEHAVIOUR (below): under a standing +1 (`shoutExtraAlways`), every entry path fires each Shout exactly
 *     twice, the same as a played Shout. Parity, not a per-card pin.
 */
import { describe, expect, it } from 'vitest';
import { CARD_INDEX } from '@game/content';
import { combatSide, makeRng, simulate, type BoardMinion, type QuestCombatMods } from '@game/core';
import { createRun, reduce, type BoardCard, type RunState } from '../index';
import { replayBattlecry } from '../recruit';
import { SHOP_SHOUT_FIRE_SCOPES, auditShoutParity } from './shoutTriggerParity';

describe('Doc Bot — Shout-trigger parity (source)', () => {
  const audit = auditShoutParity();

  it('the scan sees both phases (the instrument is not blind)', () => {
    expect(audit.shop.length).toBeGreaterThanOrEqual(4);
    expect(audit.combat.length).toBeGreaterThanOrEqual(4);
    expect(audit.combat.map((s) => s.key)).toContain('factories.ts#replayCombatBattlecry#onPlay');
  });

  it('every shop scope that fires a Shout is classified (played / triggered / settle)', () => {
    const list = audit.unclassified.map((s) => `${s.file}:${s.line} ${s.scope}`);
    expect(list, `Unclassified Shout fire scope(s): ${list.join(' · ')} — add it to SHOP_SHOUT_FIRE_SCOPES and make its count read playedShoutRepeats or standingShoutExtras.`).toEqual([]);
  });

  it('no registry entry describes a scope that no longer exists', () => {
    expect(audit.stale).toEqual([]);
  });

  it('NO DEAF SITE: every Shout fire site reads its phase\'s Shout-extras fold (the Choir class)', () => {
    const list = audit.deaf.map((s) => `${s.file}:${s.line} ${s.key}`);
    expect(list, `Shout fired without the Shout extras: ${list.join(' · ')} — a triggered Shout is a Shout (R-SHOUT-TRIGGER-01). Shop: route through replayBattlecry / standingShoutExtras. Combat: read ctx.shoutCarryExtras per fire.`).toEqual([]);
  });

  it('only the settle replay is excused, and it says why', () => {
    const settle = Object.entries(SHOP_SHOUT_FIRE_SCOPES).filter(([, e]) => e.counter === 'settle').map(([k]) => k);
    expect(settle).toEqual(['replayEconomyBattlecry']);
  });
});

// ── behaviour: a standing +1 doubles EVERY entry path ─────────────────────────────────────────────────────────
const card = (uid: string, cardId: string, extra: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...extra };
};
/** Hoard Cleric's Shout gives the plain Dragon +3/+3: the Dragon's Attack / 3 = Shout fires. */
const shop = (extra: number, hero = 'myra'): RunState => ({
  ...createRun(5, hero), wave: 6, phase: 'recruit', embers: 60, hand: [], shoutExtraAlways: extra || undefined,
  board: [card('w', 'whelpling', { attack: 1, health: 50 }), card('c', 'cleric', { attack: 1, health: 50 })],
} as RunState);
const gain = (a: RunState, b: RunState): number => (b.board.find((c) => c.uid === 'w')!.attack - a.board.find((c) => c.uid === 'w')!.attack) / 3;

const SHOP_PATHS: Record<string, (extra: number) => number> = {
  'played from hand': (x) => {
    const s = { ...shop(x), board: [card('w', 'whelpling', { attack: 1, health: 50 })], hand: [card('c', 'cleric')] } as RunState;
    return gain(s, reduce(s, { type: 'play', uid: 'c' }));
  },
  'Auctioneer Pulse (hero power)': (x) => { const s = shop(x); return gain(s, reduce(s, { type: 'heroPower', uid: 'c' })); },
  'shared shop re-trigger (Echoing Roar / Resonance / Ryme / Last Word)': (x) => {
    const s = shop(x); const before = structuredClone(s);
    replayBattlecry(s, s.board.find((c) => c.uid === 'c')!);
    return gain(before, s);
  },
};

const bm = (cardId: string, uid: string, attack: number, health: number): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])] } as unknown as BoardMinion);
const COMBAT_PATHS: Record<string, (extra: number) => number> = {
  'combat re-fire (Ryme Echo → replayCombatBattlecry)': (x) => simulate(
    [bm('alley', 'p0', 1, 30), bm('ryme', 'p1', 1, 1)], [bm('cryptwolf', 'e0', 5, 60)], makeRng(0xd0c5), CARD_INDEX,
    combatSide({ tier: 3, questMods: { shoutExtraAlways: x || undefined } as QuestCombatMods }), combatSide({ tier: 3 }),
  ).events.filter((e) => e.type === 'summon' && (e as { minion: { cardId: string } }).minion.cardId === 'stray').length,
  'forced combat Shout (Rune of Ancestral Roar)': (x) => simulate(
    [bm('emissary', 'p0', 2, 1)], [bm('sandbag', 'e0', 9, 400)], makeRng(7), CARD_INDEX,
    combatSide({ tier: 3, questMods: { runeAncestralRoar: true, shoutExtraAlways: x || undefined } as QuestCombatMods }), combatSide({ tier: 3 }),
  ).events.filter((e) => e.type === 'sc' && (e as { text: string }).text === 'Shout').length,
};

describe('Doc Bot — Shout-trigger parity (behaviour): a standing +1 doubles every path', () => {
  for (const [name, run] of Object.entries({ ...SHOP_PATHS, ...COMBAT_PATHS })) {
    it(name, () => {
      const base = run(0);
      expect(base, 'the path fires at all').toBeGreaterThan(0);
      expect(run(1), `${name}: a standing Shout extra must double the fires, like a played Shout`).toBe(base * 2);
    });
  }
});
