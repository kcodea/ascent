import { describe, expect, it, vi } from 'vitest';
import { combatSide, makeRng, simulate, type BoardMinion, type CombatEvent, type ConsequenceEvent } from '@game/core';
import { CARD_INDEX, poolFor } from '@game/content';
import { createRun, isRuneBuffSource, prepareActionWithPresentation, type BoardCard, type RunState } from '@game/sim';
import { compileMoments } from './compile';
import { groupBuffCasts } from './channels/buffCast';
import { heroPowerBuffLabelFor, labelBuffFxFor } from './bindings';
import { presentConsequence, type PresenterContext } from '../choreographer/consequencePresenters';
import type { CompiledBeat } from '../choreographer/timelineTypes';

/**
 * START OF COMBAT + END OF TURN buffs show WHERE THEY COME FROM (owner ask 2026-09-15): every SoC / EoT effect
 * that grants stats to OTHER units presents as the buffer's tribe tendril, source → each recipient, one
 * ribbon per recipient — never one batched cue for the wave.
 *
 * Both phases already route through one shared renderer (`fireBuffFx`), so what this file pins is the SIGNAL
 * each phase hands it — the part that broke, or would break, silently:
 *
 *   · COMBAT: a `buff` event per recipient whose `source` is the buffer's UID (a NAME is a label source, which
 *     the replay treats as bodiless and draws nothing — Old Timber's bug), grouped into one cast per recipient
 *     by `groupBuffCasts`, in a `buffWave` moment that lands BEFORE the first attack.
 *   · SHOP: a `statsChanged` consequence per recipient under the buffer's own trigger, so the presenter hands
 *     `statGain` the source minion per recipient (Kringle) — or, for a HERO power, `heroPowerGain`.
 *
 * Runes keep their authored, per-recipient cue (rune badge burst + `rune-buff-unit` sparkle in combat; the gold
 * rail ribbon in the shop) — pinned here so "every recipient gets its own cue" holds for them too.
 */

const bm = (cardId: string, over: Partial<BoardMinion> = {}): BoardMinion => {
  const d = CARD_INDEX[cardId]!;
  return { cardId, attack: d.attack, health: d.health, keywords: [...d.keywords], ...over } as unknown as BoardMinion;
};
const foe = (attack: number, health: number): BoardMinion => ({ cardId: 'sandbag', attack, health, keywords: [] } as unknown as BoardMinion);

/** Simulate and return the buff-wave moments that land BEFORE the first swing (the Start-of-Combat window). */
function socWaves(board: BoardMinion[], side: Record<string, unknown> = {}) {
  const r = simulate(board, [foe(1, 60)], makeRng(3), CARD_INDEX,
    combatSide({ tier: 6, poolIds: Object.keys(CARD_INDEX), ...side } as never), combatSide({ tier: 6 }));
  const firstAttack = r.events.findIndex((e) => e.type === 'attack');
  const end = firstAttack < 0 ? r.events.length : firstAttack;
  const moments = compileMoments(r.events).filter((m) => m.start < end);
  return { r, moments, waves: moments.filter((m) => m.kind === 'buffWave'), uidOf: (cardId: string) => r.initial.player.find((m) => m.cardId === cardId)!.uid };
}

describe('START OF COMBAT — one tendril per recipient, from the buffer, before the first clash', () => {
  it('Bucky (Dwarf): one cast per OTHER Dwarf, each sourced on Bucky, in a buffWave that precedes the first attack', () => {
    const { r, waves, uidOf } = socWaves([bm('dw_bucky'), bm('dw_brakka'), bm('dw_edward')], { alesLastTurn: 2 });
    expect(waves.length, 'Bucky poured — a buff wave before any swing').toBeGreaterThan(0);
    const casts = groupBuffCasts(waves[0]!, r.events);
    expect(casts.map((c) => c.target).sort()).toEqual([uidOf('dw_brakka'), uidOf('dw_edward')].sort());
    for (const c of casts) expect(c.source, 'a UID, so the tribe ribbon has a body to leave from').toBe(uidOf('dw_bucky'));
    // The buffer's tribe picks the ribbon: `fireBuffFx` reads it off the source card (see buffFxRender.test.ts).
    expect(CARD_INDEX[r.initial.player.find((m) => m.uid === casts[0]!.source)!.cardId]!.tribe).toBe('dwarf');
  });

  it('Kobe (Kobold): each adjacent Kobold gets its OWN Ruby event — the gem cue is the authored, per-recipient tell, and no tendril wave opens for it', () => {
    // Owner rework 2026-09-18: Kobe's Rubies land WHEN IT TAKES DAMAGE (a Taunt soaks the foe's swing), not at
    // Start of Combat — so the Start-of-Combat window holds no wave from it at all, and the per-recipient
    // `ruby` events arrive inside the hit that caused them.
    const { r, waves, uidOf } = socWaves([bm('k_kobe'), bm('k_veinbreaker'), bm('venom')]);
    const rubies = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && !!e.ruby && e.source === uidOf('k_kobe'));
    expect(rubies.map((e) => e.target)).toContain(uidOf('k_veinbreaker'));
    expect(rubies.map((e) => e.target)).toContain(uidOf('k_kobe'));
    expect(rubies.every((e) => e.target !== uidOf('venom')), 'not a Kobold').toBe(true);
    // A Ruby is TOLD BY THE GEM (`rubyFx`, one detonation per landing) — no ribbon under it (owner 2026-08-02),
    // and nothing of Kobe's opens a buff wave before the first swing any more.
    for (const w of waves) expect(groupBuffCasts(w, r.events).filter((c) => c.source === uidOf('k_kobe'))).toEqual([]);
  });

  it('Old Timber (Spirit): its Start-of-Combat buffs are sourced on its UID, not its name (the label form drew nothing)', () => {
    const { r, waves, uidOf } = socWaves([bm('sp3_forestcolossus', { spiritTally: 2 } as Partial<BoardMinion>), bm('sp3_kindled'), bm('venom')]);
    const casts = groupBuffCasts(waves[0]!, r.events);
    expect(casts.map((c) => c.target)).toEqual([uidOf('sp3_kindled')]);
    expect(casts[0]!.source).toBe(uidOf('sp3_forestcolossus'));
    expect(casts[0]!.source, 'a name is a LABEL source — bodiless, no ribbon').not.toBe('Old Timber');
    expect(CARD_INDEX['sp3_forestcolossus']!.tribe).toBe('spirit'); // → `tendril-trail-spirit`
  });

  it('Rune of the Five Banners: one buff event per banner-bearer, rune-labelled — the per-recipient `rune-buff-unit` sparkle is its cue', () => {
    const { r, moments, uidOf } = socWaves([bm('venom'), bm('dw_brakka'), bm('k_veinbreaker')], { questMods: { runeFiveBanners: true } });
    const grants = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'Rune of the Five Banners');
    expect(grants.map((e) => e.target).sort(), 'one banner per body with a type').toEqual([uidOf('dw_brakka'), uidOf('k_veinbreaker')].sort());
    for (const g of grants) expect(isRuneBuffSource(g.source), 'the replay keys the sparkle on this').toBe(true);
    // The rune's own badge beat (`questTrigger`) lands before the wave, and both precede the first attack.
    const kinds = moments.map((m) => m.kind);
    expect(kinds.indexOf('questTrigger')).toBeGreaterThan(-1);
    expect(kinds.lastIndexOf('buffWave')).toBeGreaterThan(kinds.indexOf('questTrigger'));
  });

  it("Emissary's United Front (hero power): label-sourced per recipient, and the replay knows which button it leaves from", () => {
    const { r, uidOf } = socWaves([bm('venom'), bm('dw_brakka'), bm('k_veinbreaker')], { questMods: { unitedFront: 3 } });
    const grants = r.events.filter((e): e is Extract<CombatEvent, { type: 'buff' }> => e.type === 'buff' && e.source === 'United Front');
    expect(grants.map((e) => e.target).sort()).toEqual([uidOf('dw_brakka'), uidOf('k_veinbreaker')].sort());
    expect(heroPowerBuffLabelFor('United Front')).toEqual({ heroId: 'vale' });
    expect(labelBuffFxFor('United Front'), 'no authored def — the generic ribbon is the fallback').toBeNull();
    expect(isRuneBuffSource('United Front'), 'not a rune: no sparkle — the tendril is its only tell').toBe(false);
  });
});

// ── SHOP (End of Turn) ────────────────────────────────────────────────────────────────────────────────────────

const body = (uid: string, cardId: string, over: Partial<BoardCard> = {}): BoardCard => {
  const d = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: d.tribe, attack: d.attack, health: d.health, keywords: [...d.keywords], golden: false, ...over };
};
const run = (setId: 'set1' | 'set2' | 'set3', over: Partial<RunState> = {}): RunState =>
  ({ ...createRun(1), setId, phase: 'recruit', embers: 20, tier: 6,
    pool: Object.fromEntries(poolFor(setId).buyable.map((c) => [c.id, 5])), ...over } as RunState);

const spyCtx = () => ({
  statGain: vi.fn(), heroPowerGain: vi.fn(), selfBuff: vi.fn(), rubyLanded: vi.fn(), spellPower: vi.fn(), impAura: vi.fn(), rubyAura: vi.fn(),
  cardGranted: vi.fn(), cardSummoned: vi.fn(), cardDestroyed: vi.fn(), shopBuffed: vi.fn(),
  resourceChanged: vi.fn(), counterChanged: vi.fn(), cardTransformed: vi.fn(), keywordChanged: vi.fn(),
  questTendril: vi.fn(), tavernGust: vi.fn(), weldPulse: vi.fn(), fodderEaten: vi.fn(), echoFired: vi.fn(),
}) satisfies PresenterContext;

/** Resolve End of Turn, then present every `statsChanged` under its own trigger the way the live player does. */
function presentEndOfTurn(state: RunState) {
  const prepared = prepareActionWithPresentation(state, { type: 'faceOmen' } as never);
  const events = prepared.batch?.events ?? [];
  const triggers = new Map(events.filter((e) => e.type === 'sourceTrigger').map((t) => [t.id, t]));
  const ctx = spyCtx();
  let i = 0;
  for (const e of events) {
    if (e.type !== 'statsChanged') continue;
    const trig = triggers.get((e as { parentId?: string }).parentId ?? '')!;
    const beat = { id: trig.id, source: trig.source, policyKey: (trig as { policyKey?: string }).policyKey } as CompiledBeat;
    presentConsequence({ consequence: e as ConsequenceEvent, beat, ctx, index: i++ });
  }
  return ctx;
}

describe('END OF TURN — one ribbon per recipient, from the buffer', () => {
  it('Kringle (Dwarf): the two end Dwarves each get their own statGain, sourced on Kringle', () => {
    const ctx = presentEndOfTurn(run('set2', {
      board: [body('l', 'dw_brakka'), body('k', 'dw_foreman'), body('r', 'dw_edward')],
      playedThisTurn: ['x', 'y'] as never,
    }));
    expect(ctx.statGain).toHaveBeenCalledTimes(2);
    expect(ctx.statGain).toHaveBeenCalledWith('l', 'board', expect.any(Number), expect.any(Number), { uid: 'k', cardId: 'dw_foreman' });
    expect(ctx.statGain).toHaveBeenCalledWith('r', 'board', expect.any(Number), expect.any(Number), { uid: 'k', cardId: 'dw_foreman' });
    expect(ctx.selfBuff, 'Kringle pays OTHERS').not.toHaveBeenCalled();
    expect(CARD_INDEX['dw_foreman']!.tribe).toBe('dwarf'); // → `tendril-trail-dwarf`, read off the source card
  });

  it('Rune of Action: each of the three leftmost gets its own rail ribbon (the rune cue), never a minion tendril', () => {
    const ctx = presentEndOfTurn(run('set1', {
      board: [body('a', 'venom'), body('b', 'dw_brakka'), body('c', 'k_veinbreaker'), body('d', 'yazzus')],
      playedThisTurn: ['x', 'y'] as never,
      questRecurringEndOfTurn: ['runeAction'] as never,
    }));
    expect(ctx.questTendril).toHaveBeenCalledTimes(3);
    for (const uid of ['a', 'b', 'c']) expect(ctx.questTendril).toHaveBeenCalledWith('rune', 'rune_action', uid, expect.any(Number));
    expect(ctx.questTendril).not.toHaveBeenCalledWith('rune', 'rune_action', 'd', expect.any(Number));
    // The generic statGain still fires per recipient with NO minion source — the presenter's contract for a
    // rune beat (it draws nothing there; the rail ribbon above is the cue).
    expect(ctx.statGain).toHaveBeenCalledTimes(3);
    expect(ctx.statGain).toHaveBeenCalledWith('a', 'board', expect.any(Number), expect.any(Number), undefined);
  });

  it("Aevor's Tempest (hero power): each end minion gets its own heroPowerGain — the tendril from the power button", () => {
    const ctx = presentEndOfTurn(run('set1', {
      board: [body('l', 'venom'), body('m', 'dw_brakka'), body('r', 'yazzus')],
      heroId: 'aevor', tempestKills: 15,
    } as Partial<RunState>));
    expect(ctx.heroPowerGain).toHaveBeenCalledTimes(2);
    expect(ctx.heroPowerGain).toHaveBeenCalledWith('l', 'aevor');
    expect(ctx.heroPowerGain).toHaveBeenCalledWith('r', 'aevor');
    expect(ctx.statGain, 'a hero beat is not a minion beat').not.toHaveBeenCalled();
  });
});
