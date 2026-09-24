import { describe, it, expect } from 'vitest';
import {
  HEROES, HERO_INDEX, getHero, isArchivedHero, playableHeroes, practiceHeroes, powerDiscoverPool,
} from './heroes';
import { createRun } from './state';
import { createRunLobby } from './lobby/runLobby';
import { createPracticeBotLobby } from './lobby/practiceBots';

/**
 * HERO ARCHIVE (owner 2026-09-24, verbatim: "Archive these heroes. (remove them from all modes but keep them in the
 * game. they should only show in scene builder)"). An archived hero is `wip: true`: it resolves by id everywhere
 * (saves, replays, recorded snapshots, leaderboards), but no NEW run can be handed it: not the Play picker, not
 * Practice, not a generated rival seat, not a Practice bot portrait, not a Mimic / Void / Power Shifter Discover.
 * The Scene Builder's hero list is pinned in `packages/ui/src/sceneBuilderPanel.test.tsx`.
 */
const ARCHIVED_2026_09_24: Record<string, string> = {
  aevor: 'Aevor',
  cindara: 'Cindara',
  devourer: 'Devourer',
  vale: 'Emissary',
  fibbsy: 'Fibbsy',
  harlan: 'Harlan',
  odelle: 'Odelle',
  tiff: 'Tiff',
  underdweller: 'Underdweller',
  runesmith: 'Runesmith',
  runeguard: 'Guardian',
  // The owner's second list, same day and same ruling, matched by name AND power:
  flint: 'Foreman Flint', // Company Rate
  gorun: 'Gorun', // Blade Mastery
  jenkins: 'Jensen', // Dynamite Dig
  membrance: 'Membrance', // Memory
  pete: 'Pete', // Contrabanana (not Re-Pete, id `repete`)
  rayse: 'Rayse', // Empowering Vines
  sable: 'Sable', // Soulbind
  rohan: 'Yirin', // Reflector
};
const IDS = Object.keys(ARCHIVED_2026_09_24);

describe('the 2026-09-24 hero archive', () => {
  it('every named hero is archived, and still resolves by id with its own name (old records render)', () => {
    for (const [id, name] of Object.entries(ARCHIVED_2026_09_24)) {
      expect(HERO_INDEX[id], `${id} must stay in the registry`).toBeDefined();
      expect(isArchivedHero(HERO_INDEX[id]!), `${id} archived`).toBe(true);
      expect(getHero(id).id, `${id} resolves to itself, never the default fallback`).toBe(id);
      expect(getHero(id).name).toBe(name);
    }
  });

  it('none is offered by the Play picker or Practice, whatever the run tribes (Tiff with Dragons included)', () => {
    for (const tribes of [undefined, ['dragon', 'beast', 'mech'] as const, ['kobold', 'dwarf', 'undead'] as const]) {
      const play = new Set(playableHeroes(tribes).map((h) => h.id));
      const practice = new Set(practiceHeroes(tribes).map((h) => h.id));
      for (const id of IDS) {
        expect(play.has(id), `${id} offered in Play`).toBe(false);
        expect(practice.has(id), `${id} offered in Practice`).toBe(false);
      }
    }
    expect(playableHeroes().length, 'the picker still has heroes to offer').toBeGreaterThanOrEqual(3);
  });

  it('none is a Mimic / Void / Power Shifter power Discover', () => {
    const pool = new Set([...powerDiscoverPool('mimic'), ...powerDiscoverPool('void')]);
    for (const id of IDS) expect(pool.has(id), `${id} discoverable`).toBe(false);
  });

  it('no generated rival seat and no Practice bot portrait wears one in a NEW lobby', () => {
    for (let seed = 1; seed <= 12; seed++) {
      const lobby = createRunLobby(seed * 977, 'warden', {}, 'set2');
      for (const seat of lobby.seats) {
        if (seat.kind === 'snapshot') continue; // a real player's RECORDED run keeps the hero it was played on
        expect(IDS, `seed ${seed}: ${seat.kind} seat ${seat.id} wears ${seat.heroId}`).not.toContain(seat.heroId);
      }
      for (const seat of createPracticeBotLobby(seed, 'warden', 3).seats.slice(1)) {
        expect(IDS, `seed ${seed}: practice bot wears ${seat.heroId}`).not.toContain(seat.heroId);
      }
    }
  });

  it('a stored run on an archived hero still starts and keeps its hero (saves / replays / Scene Builder)', () => {
    for (const id of IDS) {
      const run = createRun(7, id, 'lobby');
      expect(run.heroId).toBe(id);
    }
    // Yirin's run-start gift still arrives: the Reflector token is a hero-bound card, not a picker concern.
    expect(createRun(7, 'rohan', 'lobby').hand.some((c) => c.cardId === 'n2_reflector')).toBe(true);
  });

  it('the archive flag is the only thing withholding them (HEROES still carries every def)', () => {
    const all = new Set(HEROES.map((h) => h.id));
    for (const id of IDS) expect(all.has(id)).toBe(true);
  });
});
