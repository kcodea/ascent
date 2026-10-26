import { describe, expect, it } from 'vitest';
import { CARD_INDEX, SETS, activeSet, poolFor, type SetId } from '@game/content';
import type { BoardSnapshot } from '../snapshot';
import { registerOpponentRuns } from '../opponents';
import { playableHeroes, practiceHeroChoiceIds } from '../heroes';
import { DEFAULT_PRACTICE_CONFIG, deserialize, serialize, type PracticeConfig } from '../state';
import { poolOf } from '../cardPool';
import { godPracticeConfig } from '../godMode';
import { isPracticeDevSetRun, practiceRunTribes, practiceSetOf, practiceSetOptions } from '../practiceTribes';
import { createLobbyRun, driverFor, resetLobbyDrivers } from './runLobby';
import { lobbySeatRecordings, restoreLobbySeatRecordings } from './savedSeats';

/**
 * PRACTICE'S DEV SET PICKER (owner 2026-10-26: "can you add a dev only practice option in sandbox to select the set to
 * practice with? this would then just use the bot runs for that sandbox test environment.").
 *
 * A Practice config naming a set other than the live one pins THAT set on the run (`poolOf`), and the table is
 * generated seats that play the chosen set, never recorded player runs. The live switch is never touched. Registers
 * into the module-global pool, so it lives in its own file.
 */

const LIVE: SetId = activeSet().id;
/** A defined set that is not the live one (the dev pick under test). */
const DEV: SetId = (Object.keys(SETS) as SetId[]).find((id) => id !== LIVE && poolFor(id).buyable.length > 0)!;
const cfg = (setId?: SetId): PracticeConfig => ({ ...DEFAULT_PRACTICE_CONFIG, health: 'normal', ...(setId ? { setId } : {}) });
const HERO = 'warden';
const SEED = 4242;
/** A card id belongs to `setId` when that set draws it, or it is a token / gift (resolved globally, never drawn). */
const inSet = (setId: SetId, id: string): boolean => poolFor(setId).all.some((c) => c.id === id) || !!CARD_INDEX[id]?.token;

describe("Practice's dev set picker", { timeout: 120_000 }, () => {
  it('offers every defined set by name, the live one marked, and reads an unknown pick as the live set', () => {
    expect(practiceSetOptions().map((o) => o.id)).toEqual(Object.keys(SETS));
    expect(practiceSetOptions().map((o) => o.name)).toEqual(Object.values(SETS).map((s) => s.name));
    expect(practiceSetOptions().filter((o) => o.live).map((o) => o.id)).toEqual([LIVE]);
    expect(practiceSetOf(undefined)).toBe(LIVE);
    expect(practiceSetOf({ setId: 'nope' as SetId })).toBe(LIVE);
    expect(practiceSetOf({ setId: DEV })).toBe(DEV);
  });

  it('pins the chosen set for the whole run: pool, shop, tribes and heroes come from it, and a save keeps it', () => {
    const run = createLobbyRun(SEED, HERO, {}, 'practice', cfg(DEV));
    try {
      expect(run.setId).toBe(DEV);
      expect(poolOf(run).setId).toBe(DEV);
      expect(run.shop.length).toBeGreaterThan(0);
      for (const c of run.shop) expect(inSet(DEV, c.cardId), c.cardId).toBe(true);
      for (const t of run.tribes) expect(SETS[DEV].tribes).toContain(t);
      // The hero offer is gated by the chosen set's tribes (the same derivation the run gets).
      const tribes = practiceRunTribes(SEED, cfg(DEV));
      for (const t of tribes) expect(SETS[DEV].tribes).toContain(t);
      expect(practiceHeroChoiceIds('all', tribes).length).toBeGreaterThan(0);
      expect(isPracticeDevSetRun(run)).toBe(true);
      expect(run.practiceConfig?.setId).toBe(DEV);
      // Replays and Continue read the pinned set back through the save.
      const back = deserialize(serialize(run));
      expect(back.setId).toBe(DEV);
      expect(poolOf(back).setId).toBe(DEV);
    } finally { if (run.lobby) resetLobbyDrivers(run.lobby.seats); }
  });

  it('seats only generated bots on the chosen set, never a recorded run, even when that set has recorded runs', () => {
    // A recorded run ON the dev set, on a hero the player is not: a normal table would seat it.
    const hero = playableHeroes().find((h) => h.id !== HERO)!.id;
    const snaps: BoardSnapshot[] = Array.from({ length: 6 }, (_, i) => ({
      v: 1, wave: i + 1, heroId: hero, resolve: 30, tier: 1, triples: 0, tribes: [], threat: 'glass', power: 10, seed: 777,
      origin: 'self', author: 'Recorded', setId: DEV, minions: [{ cardId: poolFor(DEV).buyable[0]!.id, attack: 1, health: 1, keywords: [], golden: false }],
    } as unknown as BoardSnapshot));
    registerOpponentRuns([snaps]);
    const run = createLobbyRun(SEED, HERO, {}, 'practice', cfg(DEV));
    const lobby = run.lobby!;
    try {
      const rivals = lobby.seats.filter((s) => s.kind !== 'player');
      expect(rivals.length).toBe(7);
      expect(rivals.every((s) => s.kind === 'hybrid' && s.setId === DEV)).toBe(true);
      expect(lobby.seats.some((s) => s.kind === 'snapshot')).toBe(false);
      // The bots' boards are the chosen set's cards.
      for (const seat of rivals.slice(0, 2)) {
        const prep = driverFor(seat, lobby.setId)?.prepare(2) ?? driverFor(seat, lobby.setId)?.finalBoard?.() ?? null;
        expect(prep, seat.id).not.toBeNull();
        for (const m of prep!.snapshot?.minions ?? []) expect(inSet(DEV, m.cardId), m.cardId).toBe(true);
      }
      // The save carries each bot's recording WITH its set, and a resume primes it back under the same key.
      const rec = lobbySeatRecordings(lobby);
      expect(rec.hybrids.length).toBeGreaterThan(0);
      expect(rec.hybrids.every((h) => h.setId === DEV)).toBe(true);
      expect(restoreLobbySeatRecordings(JSON.parse(JSON.stringify(rec))).hybrids).toBe(rec.hybrids.length);
    } finally { resetLobbyDrivers(lobby.seats); }
  });

  it('never touches the live switch', () => {
    const before = Object.values(SETS).map((s) => `${s.id}:${s.enabled}`);
    const run = createLobbyRun(SEED, HERO, {}, 'practice', cfg(DEV));
    if (run.lobby) resetLobbyDrivers(run.lobby.seats);
    expect(activeSet().id).toBe(LIVE);
    expect(Object.values(SETS).map((s) => `${s.id}:${s.enabled}`)).toEqual(before);
  });

  it('picking the live set (or none) is ordinary Practice: same table, no dev-set marker', () => {
    const plain = createLobbyRun(SEED, HERO, {}, 'practice', cfg());
    const live = createLobbyRun(SEED, HERO, {}, 'practice', cfg(LIVE));
    try {
      expect(live.setId).toBe(LIVE);
      expect(isPracticeDevSetRun(live)).toBe(false);
      expect(live.practiceConfig?.setId).toBeUndefined();
      expect(live.lobby!.seats.some((s) => s.setId)).toBe(false);
      expect(live.lobby!.seats.map((s) => `${s.kind}:${s.heroId}:${s.runKey ?? ''}`)).toEqual(plain.lobby!.seats.map((s) => `${s.kind}:${s.heroId}:${s.runKey ?? ''}`));
    } finally { resetLobbyDrivers(plain.lobby!.seats); resetLobbyDrivers(live.lobby!.seats); }
  });

  it('God Mode drops the pick and plays the live set', () => {
    expect(godPracticeConfig(cfg(DEV)).setId).toBeUndefined();
  });
});
