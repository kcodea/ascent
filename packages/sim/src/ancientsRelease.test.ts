/**
 * THE ANCIENTS RELEASE SWITCH (owner 2026-11-16: "Ancients will go live everywhere, so build the flip to turn them
 * on/off as needed. When on, they're live everywhere"). R-ANCIENTS-RELEASE-01..04.
 *
 *  - the switch is read at creation only and pinned on the run (save / restore, a flip),
 *  - every player door is on (lobby, Practice, Gauntlet, every Versus mode); the tutorial is off,
 *  - heroes with no written pairings get no meter,
 *  - bots and generated seats answer the awakening and keep playing,
 *  - a captured board carries the seat's Ancient (scouting + match details read it back).
 */
import { describe, expect, it } from 'vitest';
import { cardRevision, CARD_INDEX, type GauntletStage } from '@game/content';
import {
  ANCIENT_IDS, ANCIENTS_LIVE, ancientsForNewRun, ancientsLive, ancientsSetSupported, heroHasAncientPairings, releaseAncients,
  autoplayRun, boardIntel, buildMatchDetails, createGauntletRun, createLobbyRun, createRun, createTutorialRun, createVersusRun,
  deserialize, enableAncients, lobbyRunTelemetry, emptyTelemetryLog, parseMatchDetails, reduce, serialize, snapshotBoard,
  DEFAULT_BOT, decide, createController, ancientTelemetryOf, legalModalAnswers,
  type AncientId, type PracticeConfig, type RunState, type VersusRoomOptions,
} from './index';

const offerOpen = (s: RunState): RunState => {
  // A meter one point from full, then one Refresh awakens it through the real reducer.
  const a = s.ancients!;
  return reduce({ ...s, phase: 'recruit', embers: 60, ancients: { ...a, points: a.cost - 1 } }, { type: 'roll' });
};
const pickedRun = (heroId = 'indy'): RunState => {
  let s = offerOpen(releaseAncients(createLobbyRun(7, heroId, {}, 'lobby', undefined, 'set2'), true));
  const id = s.ancients!.offer![0]!;
  s = reduce(s, { type: 'pickAncient', id });
  expect(s.ancients!.picked).toBe(id);
  return s;
};

const PRACTICE: PracticeConfig = { opponents: 'bots', botDifficulty: 3, health: 'unlimited', timeMult: 1, tribes: [] };
const stageFor = (): GauntletStage => {
  const body = Object.values(CARD_INDEX).find((c) => !c.spell && c.tier === 1)!;
  return {
    number: 1, name: 'Test', opponentName: 'Host', status: 'ready', runes: {},
    rounds: Array.from({ length: 10 }, () => ({ board: [{ cardId: body.id, attack: 1, health: 1, cardVersion: cardRevision(body) }] })),
  };
};

describe('the switch (R-ANCIENTS-RELEASE-01)', () => {
  it('ships OFF (owner 2026-11-16: "Ship the ancient switch off"), and `ancientsLive()` reads it', () => {
    expect(ANCIENTS_LIVE).toBe(false);
    expect(ancientsLive()).toBe(false);
  });

  it('Sets 2 and 3 have Ancients; the others do not', () => {
    expect(['set1', 'set2', 'set3', 'set4'].map(ancientsSetSupported)).toEqual([false, true, true, false]);
  });

  it('switch OFF (the default): lobby, Practice, Gauntlet and every Versus mode start without Ancients', () => {
    for (const mode of ['lobby', 'practice'] as const) {
      const run = createLobbyRun(11, 'indy', {}, mode, mode === 'practice' ? { ...PRACTICE } : undefined, 'set2');
      expect(run.ancientsEnabled, mode).toBeUndefined();
      expect(run.ancients, mode).toBeUndefined();
    }
    expect(createGauntletRun(3, 'indy', stageFor(), 'set2').ancientsEnabled).toBeUndefined();
    for (const mode of ['duel', 'group', 'duos', 'ranked_duos'] as const) {
      expect(createVersusRun(5, 'indy', 'set2', { mode } as VersusRoomOptions, mode.includes('duos') ? 'warden' : null).ancientsEnabled, mode).toBeUndefined();
    }
    expect(ancientsForNewRun('indy', 'set2')).toBe(false);
    expect(releaseAncients(createRun(11, 'indy', 'lobby', undefined, 'set2')).ancientsEnabled).toBeUndefined();
  });

  it('switch ON: lobby, Practice and Gauntlet start with the default meter', () => {
    for (const mode of ['lobby', 'practice'] as const) {
      const run = createLobbyRun(11, 'indy', {}, mode, mode === 'practice' ? { ...PRACTICE } : undefined, 'set2', undefined, { ancients: true });
      expect(run.ancientsEnabled, mode).toBe(true);
      expect(run.ancients, mode).toMatchObject({ points: 0, cost: 16, refresh: 1, combat: 2 });
    }
    expect(createGauntletRun(3, 'indy', stageFor(), 'set2', true).ancientsEnabled).toBe(true);
    expect(ancientsForNewRun('indy', 'set2', true)).toBe(true);
    expect(ancientsForNewRun('indy', 'set1', true)).toBe(false); // a set without Ancients
  });

  it('switch ON: every Versus mode (1v1, group, Duos, Ranked Duos) has them; `dev.ancients === false` forces off', () => {
    for (const mode of ['duel', 'group', 'duos', 'ranked_duos'] as const) {
      const opts = { mode } as VersusRoomOptions;
      const run = createVersusRun(5, 'indy', 'set2', opts, mode.includes('duos') ? 'warden' : null, { ancients: true });
      expect(run.ancientsEnabled, mode).toBe(true);
      expect(run.ancients, mode).toMatchObject({ points: 0, cost: 16 });
      expect(createVersusRun(5, 'indy', 'set2', opts, null, { ancients: false }).ancientsEnabled, mode).toBeUndefined();
    }
    // the DEV meter seam still overrides the meter
    expect(createVersusRun(5, 'indy', 'set2', null, null, { ancients: { cost: 1 } }).ancients!.cost).toBe(1);
  });

  it('the TUTORIAL is never on, even forced', () => {
    const tut = createTutorialRun(3, 'indy', 'learn', [[]], ['A'], 1, [[{ minions: [] }]]);
    expect(tut.ancientsEnabled).toBeUndefined();
    expect(releaseAncients(tut, true)).toBe(tut);
  });

  it('pinned across a save / restore and a flip: a run keeps exactly what it was created with', () => {
    const on = createLobbyRun(21, 'indy', {}, 'lobby', undefined, 'set2', undefined, { ancients: true });
    const off = createLobbyRun(21, 'indy', {}, 'lobby', undefined, 'set2', undefined, { ancients: false });
    // A restore keeps exactly what the run was created with, whatever the switch says now.
    const offBack = deserialize(serialize(off));
    expect(offBack.ancientsEnabled).toBeUndefined();
    expect(offBack.ancients).toBeUndefined();
    // An ON run restored mid-offer keeps the same meter and the same three.
    const mid = offerOpen(on);
    const midBack = deserialize(serialize(mid));
    expect(midBack.ancientsEnabled).toBe(true);
    expect(midBack.ancients).toEqual(mid.ancients);
    // A "flip" after creation (releasing again with the switch off) never strips Ancients from a run that has them.
    expect(releaseAncients(on, false)).toBe(on);
    expect(deserialize(serialize(on)).ancientsEnabled).toBe(true); // switch is OFF in this build: the ON run keeps its meter
  });
});

describe('heroes with no written pairings (R-ANCIENTS-RELEASE-01, audit F3)', () => {
  it('Runesmith and Guardian get no meter; a hero with all six does', () => {
    expect(heroHasAncientPairings('runesmith')).toBe(false);
    expect(heroHasAncientPairings('runeguard')).toBe(false);
    expect(heroHasAncientPairings('indy')).toBe(true);
    for (const hero of ['runesmith', 'runeguard']) {
      // Even with the switch forced ON.
      expect(createLobbyRun(9, hero, {}, 'lobby', undefined, 'set2', undefined, { ancients: true }).ancientsEnabled, hero).toBeUndefined();
      expect(createVersusRun(9, hero, 'set2', null, null, { ancients: true }).ancientsEnabled, hero).toBeUndefined();
      expect(ancientsForNewRun(hero, 'set2', true), hero).toBe(false);
    }
  });
});

describe('bots and generated seats answer the awakening (R-ANCIENTS-RELEASE-02, audit F5)', () => {
  it('autoplayRun picks an Ancient and keeps recording past the awakening', () => {
    const on = autoplayRun(41, 'indy', undefined, Infinity, 'set2', true);
    const picked = on.filter((b) => b.ancient);
    expect(picked.length).toBeGreaterThan(0);
    expect(ANCIENT_IDS).toContain(picked[0]!.ancient!.id);
    // It keeps playing well past round 6 (the recording is not cut at the pick).
    expect(Math.max(...on.map((b) => b.wave))).toBeGreaterThan(picked[0]!.wave);
    expect(Math.max(...on.map((b) => b.wave))).toBeGreaterThan(6);
    // Deterministic: the same seed picks the same Ancient on the same wave.
    expect(autoplayRun(41, 'indy', undefined, Infinity, 'set2', true).find((b) => b.ancient)?.ancient).toEqual(picked[0]!.ancient);
    // With the switch as shipped (off) the recording has none.
    expect(autoplayRun(41, 'indy', undefined, Infinity, 'set2').some((b) => b.ancient)).toBe(false);
  });

  it('the legacy greedy bot and the production bot both answer an open offer with a pick', () => {
    const s = offerOpen(enableAncients(createRun(7, 'indy', 'lobby', undefined, 'set2')));
    expect(s.ancients!.offer).toHaveLength(3);
    const legacy = DEFAULT_BOT.act(s);
    expect(legacy.type).toBe('pickAncient');
    expect(reduce(s, legacy)).not.toBe(s);
    const d = decide(s, createController('seat', 'hard'));
    expect(d?.action.type).toBe('pickAncient');
    expect(s.ancients!.offer).toContain((d!.action as { id: AncientId }).id);
  });

  it('a Versus timeout answers the offer (every offered Ancient is a legal answer)', () => {
    const s = offerOpen(createVersusRun(5, 'indy', 'set2', null, null, { ancients: true }));
    expect(legalModalAnswers(s).map((a) => (a as { id: string }).id).sort()).toEqual([...s.ancients!.offer!].sort());
  });
});

describe('the enemy Ancient is recorded and visible (R-ANCIENTS-RELEASE-03 / -04, audit F4)', () => {
  it('a captured board carries the Ancient (id, pairing hero, wave); scouting reads it', () => {
    const s = pickedRun();
    const snap = snapshotBoard(s);
    expect(snap.ancient).toEqual({ id: s.ancients!.picked, heroId: 'indy', wave: s.ancients!.awakenedWave });
    expect(boardIntel({ minions: snap.minions, tier: snap.tier, snapshot: snap }, 3).ancient).toEqual(snap.ancient);
    // A board with no Ancient (an old capture) carries none.
    expect(snapshotBoard(createRun(7, 'indy')).ancient).toBeUndefined();
  });

  it('match details store the Ancient and read it back; telemetry stamps it', () => {
    const s = pickedRun();
    const lobby = { ...s.lobby!, seats: s.lobby!.seats.map((x) => ({ ...x })) };
    const md = buildMatchDetails(lobby, { name: 'Me', placement: 3, selfBoard: snapshotBoard(s) });
    const me = md.seats.find((x) => x.self)!;
    expect(me.ancient).toEqual({ id: s.ancients!.picked, heroId: 'indy', wave: s.ancients!.awakenedWave });
    expect(parseMatchDetails(JSON.parse(JSON.stringify(md)))!.seats.find((x) => x.self)!.ancient).toEqual(me.ancient);
    // A tampered id is dropped, never trusted.
    const bad = JSON.parse(JSON.stringify(md));
    bad.seats.find((x: { self?: boolean }) => x.self).ancient.id = 'nope';
    expect(parseMatchDetails(bad)!.seats.find((x) => x.self)!.ancient).toBeUndefined();
    expect(ancientTelemetryOf(s)).toEqual({ ancients: true, ancient: me.ancient });
    expect(ancientTelemetryOf(createRun(7, 'indy'))).toEqual({});
    const row = lobbyRunTelemetry({ ...emptyTelemetryLog(), tierByWave: [] }, s, [], () => { throw new Error('no fallback'); });
    expect(row.ancient).toEqual(me.ancient);
  });
});
