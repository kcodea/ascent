import { describe, it, expect, vi, afterEach } from 'vitest';
import { simulate, combatSide, makeRng, type BoardMinion, type CombatEvent } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { compileMoments } from './compile';
import { groupBuffCasts, type BuffCast } from './channels/buffCast';
import { bindingFor } from './bindings';
import { runMomentCues } from './score';
import { playDef } from '../fx/playDef';

vi.mock('../fx/playDef', () => ({ playDef: vi.fn(() => () => {}), canPlayDefs: vi.fn(() => true) }));
vi.mock('../fx/combatAnchors', () => ({ anchorsForUnits: vi.fn(() => ({ source: { x: 0, y: 0 }, target: { x: 5, y: 7 } })) }));
afterEach(() => { vi.mocked(playDef).mockClear(); vi.useRealTimers(); });

/** T-Rex dies to the dummy and its Echo summons a T-Rex Baby (a Beast) while Oona is on the board. */
function oonaFight() {
  const p: BoardMinion[] = [{ cardId: 'b2_trex', attack: 1, health: 1 }, { cardId: 'b2_oona', attack: 1, health: 60 }];
  const e: BoardMinion[] = [{ cardId: 'sandbag', attack: 5, health: 60 }];
  const r = simulate(p, e, makeRng(1), CARD_INDEX, combatSide({ tier: 6, tribes: ['beast'] }));
  const oonaUid = r.initial.player.find((m) => m.cardId === 'b2_oona')?.uid ?? '';
  const baby = r.events.find((ev) => ev.type === 'summon' && ev.minion.cardId === 'b2_trexbaby');
  const babyUid = baby?.type === 'summon' ? baby.minion.uid : '';
  const cardIds = new Map<string, string>();
  for (const m of [...r.initial.player, ...r.initial.enemy]) cardIds.set(m.uid, m.cardId);
  for (const ev of r.events) if (ev.type === 'summon') cardIds.set(ev.minion.uid, ev.minion.cardId);
  return { r, oonaUid, babyUid, cardIds };
}

/**
 * King Oona's banana (owner 2026-09-24): when Oona doubles a Beast summoned in combat, `oona-banana` travels
 * from Oona to that Beast. It is bound at `cards.b2_oona.buffWave` with the `buffed` fan-out, which only works
 * because a REAL fight gives Oona's doubling its own `buffWave` moment with Oona's body as the cast source —
 * pinned here against the live simulator so a change to that folding cannot silently strand the banana.
 */
describe("King Oona's banana (real combat)", () => {
  it('the doubling is a buffWave cast from Oona to the summoned Beast, and the banana is bound there', () => {
    const { r, oonaUid, babyUid } = oonaFight();
    expect(oonaUid).toBeTruthy();
    expect(babyUid).toBeTruthy();

    const casts = compileMoments(r.events)
      .filter((m) => m.kind === 'buffWave')
      .flatMap((m) => groupBuffCasts(m, r.events));
    expect(casts.some((c) => c.source === oonaUid && c.target === babyUid)).toBe(true);

    expect(bindingFor('b2_oona', 'buffWave')).toEqual({ def: 'oona-banana', fanOut: 'buffed' });
  });

  // ONE banana per buff (owner 2026-09-24: "banana replaces tendril"). The tendril path (`fireBuffCasts`,
  // reached through `onBuffCasts`) plays a minion's `buffed` def IN PLACE of the tendril, so the score's own
  // `buffed` fan-out must stand down for that buff — it used to play the same def again on the same beat.
  it('the score hands the cast to the tendril path and does NOT play the banana a second time itself', () => {
    vi.useFakeTimers();
    const { r, oonaUid, babyUid, cardIds } = oonaFight();
    const wave = compileMoments(r.events).find((m) => m.kind === 'buffWave'
      && groupBuffCasts(m, r.events).some((c) => c.source === oonaUid));
    expect(wave).toBeTruthy();
    const handed: BuffCast[] = [];
    const noop = (): void => {};
    runMomentCues(wave!, {
      events: r.events as CombatEvent[], cardIds, combatSpeed: 1, onShake: noop, slotRectOf: () => ({ cx: 0, cy: 0, w: 100, h: 140 }),
      attackerUid: null, meleePair: null, onFloats: noop, onDeathFloats: noop, onAuraBurst: noop, onShieldBreak: noop, onReborn: noop,
      onBuffCasts: (casts: BuffCast[]) => { handed.push(...casts); }, onSelfBuffs: noop, onImprove: noop, onMaxGold: noop, onDamageFx: noop,
      onSummonFx: noop, onAscend: noop, onExecuteFx: noop,
    } as unknown as Parameters<typeof runMomentCues>[1]);
    vi.runAllTimers();
    expect(handed.some((c) => c.source === oonaUid && c.target === babyUid)).toBe(true);
    expect(vi.mocked(playDef).mock.calls.filter((c) => c[0] === 'oona-banana')).toHaveLength(0);
  });
});
