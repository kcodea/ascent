import { describe, it, expect } from 'vitest';
import { combatSide, simulate, makeRng, isEchoEffect, DEATH_WATCHER_FACTORIES, type BoardMinion, type EffectDef } from '@game/core';
import { CARD_INDEX } from '@game/content';
import { createRun, type RunState } from './index';
import { fireOnFriendDeath, fireShopRally } from './recruit';

/**
 * R-ECHO-WATCHER-01 (owner report 2026-11-20: "an echohorn just triggered a brood matron - that shouldnt happen
 * since it is not an echo"). A FRIEND-DEATH WATCHER rides the `onDeath` trigger but is not an Echo: "trigger
 * your Echo" effects never pick, fire, count or copy it. The wide reading stays (any own-death `onDeath` is an
 * Echo, not only `deathrattle*` ids). Both phases: combat `simulate` and the Shop's Rally dispatch.
 *
 * Plus the Brood Matron rework (owner 2026-11-20): "Avenge (2): Summon an Imp and give your Imps +1/+1 this game."
 */

const SPORE_ECHO: EffectDef = { on: 'onDeath', do: 'deathrattleBuffAll', params: { attack: 1, health: 1 } };

// ── combat ─────────────────────────────────────────────────────────────────────────────────────────────────
const bm = (cardId: string, uid: string, attack = 0, health = 400, over: Partial<BoardMinion> = {}): BoardMinion =>
  ({ cardId, attack, health, sourceUid: uid, keywords: [...(CARD_INDEX[cardId]?.keywords ?? [])], ...over } as BoardMinion);
const fight = (p: BoardMinion[], e: BoardMinion[] = [bm('sandbag', 'W', 0, 40000)], seed = 3) =>
  simulate(p, e, makeRng(seed), CARD_INDEX, combatSide({ tier: 6 }), combatSide({ tier: 6 }));
/** The `rally` cues Echohorn logged, as the CARD IDS of the Echoes they triggered. */
const echohornTargets = (r: ReturnType<typeof simulate>): string[] => {
  const byUid = new Map<string, string>();
  for (const m of r.initial.player) byUid.set(m.uid, m.cardId);
  for (const ev of r.events) if (ev.type === 'summon') byUid.set(ev.minion.uid, ev.minion.cardId);
  const horn = r.initial.player.find((m) => m.cardId === 'b2_echohorn')!.uid;
  return r.events
    .filter((ev) => ev.type === 'rally' && (ev as { source: string }).source === horn)
    .map((ev) => byUid.get((ev as { target: string }).target) ?? '?');
};

describe('R-ECHO-WATCHER-01 — the shared Echo predicate', () => {
  it('friend-death watchers are not Echoes; every other onDeath effect is (the wide reading)', () => {
    expect([...DEATH_WATCHER_FACTORIES].sort()).toEqual(['impInheritOnDeath', 'onFriendDeathGainEcho']);
    for (const w of DEATH_WATCHER_FACTORIES) expect(isEchoEffect({ on: 'onDeath', do: w })).toBe(false);
    // The 2026-07-31 wide-reading Echoes (ids that do not start with `deathrattle`) still count.
    for (const id of ['mossmemory_colossus', 'runesnout_archivist', 'dw_anvilshade', 'dw_brunni', 'dw3_beergutbud', 'duo_spencer', 'duo_antsy']) {
      expect(CARD_INDEX[id]!.effects.some(isEchoEffect), id).toBe(true);
    }
    for (const id of ['ashen_heir', 'n2_echomimic', 'brood']) expect(CARD_INDEX[id]!.effects.some(isEchoEffect), id).toBe(false);
    expect(isEchoEffect({ on: 'avenge', do: 'deathrattleBuffAll' })).toBe(false);
  });
});

describe('R-ECHO-WATCHER-01 — combat: Echohorn skips friend-death watchers', () => {
  it('Ashen Heir left-most, a real Echo to its right: Echohorn triggers the real Echo', () => {
    const r = fight([bm('ashen_heir', 'H'), bm('spore', 'E'), bm('b2_echohorn', 'S', 4)]);
    const t = echohornTargets(r);
    expect(t.length, 'Echohorn rallied').toBeGreaterThan(0);
    expect(new Set(t), 'every proc hit the Sporeling, never the Heir').toEqual(new Set(['spore']));
  });

  it('Echo Mimic (watcher only) left-most: Echohorn passes it for the real Echo', () => {
    // The FIRST proc (later, once the Sporeling dies, the Mimic legitimately gains its Echo and becomes one).
    const r = fight([bm('n2_echomimic', 'M'), bm('spore', 'E'), bm('b2_echohorn', 'S', 4)]);
    expect(echohornTargets(r)[0]).toBe('spore');
  });

  it('Brood Matron (no watcher since the rework) left-most: Echohorn triggers the real Echo', () => {
    const r = fight([bm('brood', 'B'), bm('spore', 'E'), bm('b2_echohorn', 'S', 4)]);
    expect(new Set(echohornTargets(r))).toEqual(new Set(['spore']));
  });

  it('only a watcher on the board: Echohorn triggers nothing', () => {
    expect(echohornTargets(fight([bm('ashen_heir', 'H'), bm('b2_echohorn', 'S', 4)]))).toEqual([]);
    expect(echohornTargets(fight([bm('n2_echomimic', 'M'), bm('b2_echohorn', 'S', 4)]))).toEqual([]);
  });

  it('Echo Mimic WITH a gained Echo is an Echo, and the trigger fires that Echo', () => {
    // The Sporeling Echo rides the Mimic as a graft (the shop's per-instance `grantedEffects`).
    const r = fight([bm('n2_echomimic', 'M', 0, 400, { grantedEffects: [SPORE_ECHO] }), bm('b2_echohorn', 'S', 4)]);
    const t = echohornTargets(r);
    expect(t.length).toBeGreaterThan(0);
    expect(new Set(t)).toEqual(new Set(['n2_echomimic']));
    // The Echo it fired is the Sporeling's +1/+1 to the board (the watcher fires nothing).
    const mimic = r.initial.player.find((m) => m.cardId === 'n2_echomimic')!.uid;
    expect(r.events.some((ev) => ev.type === 'buff' && (ev as { source?: string }).source === mimic)).toBe(true);
  });

  it('the wide reading still holds: Moss Colossus (not a deathrattle* id) is triggered', () => {
    const r = fight([bm('mossmemory_colossus', 'C'), bm('b2_echohorn', 'S', 4)]);
    expect(echohornTargets(r).length).toBeGreaterThan(0);
  });
});

// ── shop ───────────────────────────────────────────────────────────────────────────────────────────────────
type Card = RunState['board'][number];
const bc = (uid: string, cardId: string, over: Partial<Card> = {}): Card => {
  const def = CARD_INDEX[cardId]!;
  return { uid, cardId, tribe: def.tribe, attack: def.attack, health: def.health, keywords: [...def.keywords], golden: false, ...over } as Card;
};
const shop = (board: Card[]): RunState => ({ ...createRun(3, 'warden'), phase: 'recruit', board } as RunState);
const stats = (s: RunState, uid: string): string => { const c = s.board.find((b) => b.uid === uid)!; return `${c.attack}/${c.health}`; };

describe('R-ECHO-WATCHER-01 — the Shop: Echohorn skips friend-death watchers', () => {
  it('Ashen Heir left-most, Sporeling to its right: the Sporeling Echo fires (the board gains +1/+1)', () => {
    const s = shop([bc('h', 'ashen_heir'), bc('e', 'spore'), bc('s', 'b2_echohorn')]);
    const before = stats(s, 's');
    fireShopRally(s, s.board[2]!);
    expect(stats(s, 's'), 'the Sporeling Echo buffed the Echohorn').not.toBe(before);
  });

  it('only Ashen Heir: Echohorn does nothing', () => {
    const s = shop([bc('h', 'ashen_heir'), bc('s', 'b2_echohorn')]);
    const echoesBefore = s.deathrattlesTriggered;
    fireShopRally(s, s.board[1]!);
    expect(s.deathrattlesTriggered, 'no Echo was triggered or tallied').toBe(echoesBefore);
  });

  it('Echo Mimic WITH a gained Echo fires that Echo', () => {
    const s = shop([bc('m', 'n2_echomimic', { grantedEffects: [SPORE_ECHO] }), bc('s', 'b2_echohorn')]);
    const before = stats(s, 's');
    fireShopRally(s, s.board[1]!);
    expect(stats(s, 's')).not.toBe(before);
  });

  it("Echo Mimic copies a dying friend's ECHO, never its watcher", () => {
    // A dying Ashen Heir carries only a watcher: the Mimic gains nothing.
    const s = shop([bc('m', 'n2_echomimic'), bc('h', 'ashen_heir')]);
    fireOnFriendDeath(s, s.board[1]!);
    expect(s.board[0]!.grantedEffects ?? []).toEqual([]);
    // A dying Sporeling carries a real Echo: the Mimic gains it.
    const t = shop([bc('m', 'n2_echomimic'), bc('e', 'spore')]);
    fireOnFriendDeath(t, t.board[1]!);
    expect((t.board[0]!.grantedEffects ?? []).map((e) => e.do)).toEqual(['deathrattleBuffAll']);
  });
});

// ── Brood Matron rework ────────────────────────────────────────────────────────────────────────────────────
describe('Brood Matron rework (owner 2026-11-20): Avenge (2) summons an Imp, then gives your Imps +1/+1 this game', () => {
  const run = (golden: boolean) => fight(
    [bm('brood', 'B', 0, 1000, { golden }), bm('sandbag', 'a', 0, 1), bm('sandbag', 'b', 0, 1)],
    [bm('omen', 'O', 100, 100000, { keywords: [] })],
    1,
  );
  const impSummons = (r: ReturnType<typeof simulate>) => r.events.filter((e) => e.type === 'summon' && e.minion.cardId === 'impscrap');

  it('has no friend-death watcher any more', () => {
    expect(CARD_INDEX['brood']!.effects.some((e) => e.on === 'onDeath')).toBe(false);
  });

  it('two friendly deaths: one Imp, then every Imp +1/+1 (the new Imp included), permanently', () => {
    const r = run(false);
    expect(impSummons(r).length, 'first Avenge (2) summons one Imp; its death is a third, not a fourth').toBe(1);
    const imp = impSummons(r)[0]!;
    const impUid = imp.type === 'summon' ? imp.minion.uid : '';
    expect(r.events.some((e) => e.type === 'buff' && e.target === impUid && e.attack === 1 && e.health === 1), 'the new Imp took the +1/+1').toBe(true);
    expect(r.playerImpBuffGain).toEqual({ attack: 1, health: 1 });
  });

  it('gilded: two Imps and +2/+2 per Avenge', () => {
    // Gilded is self-feeding (two Imps per two deaths), so count PER FIRE: every fire is 2 Imps and +2/+2.
    const r = run(true);
    const imps = impSummons(r).length;
    expect(imps).toBeGreaterThanOrEqual(2);
    expect(imps % 2).toBe(0);
    expect(r.playerImpBuffGain).toEqual({ attack: imps, health: imps });
  });
});
