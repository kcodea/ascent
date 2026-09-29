import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { scopeCosmetics, snapshotBoard } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRun, serialize, deserialize } from '../state';
import { createLobbyRun, createRunLobby } from './runLobby';
import { deltaShopFrameOf, shopFrameOf } from '../replayV2';
import { playerRunsFrom } from './snapshotSeats';

/**
 * SKINS v1 (owner 2026-09-28): "opponents see the owner's skin", and history shows the skins RECORDED for that
 * run (handoff §5.6). The sim's half: a run carries its recorded `cosmetics`; every board it captures carries
 * them scoped to that board; a player run reassembled from the pool unions them; a lobby's snapshot seat copies
 * them at creation, so the seat is its own record through save/restore. All display-only and additive: a board
 * or seat without the field behaves exactly as before.
 *
 * Registers boards into the module-global pool, so it lives apart from the other lobby tests.
 */

const board = (author: string, heroId: string, seed: number, wave: number, cardId: string, cosmetics?: BoardSnapshot['cosmetics']): BoardSnapshot => ({
  v: 1, wave, heroId, resolve: 30, tier: 1, triples: 0,
  tribes: ['beast', 'undead', 'mech', 'dragon', 'demon'], threat: 'glass', power: 4,
  minions: [{ cardId, attack: 2, health: 2, keywords: [], golden: false }],
  seed, origin: 'self', author, setId: 'set1', ...(cosmetics ? { cosmetics } : {}),
} as BoardSnapshot);

// A skinned run: the hero skin on every board, the Brian skin only on the boards where Brian was fielded, and the
// account-wide hero attack (2026-09-28) on every board.
const SKINNED = Array.from({ length: 8 }, (_, i) => board('Skye', 'albus', 4242, i + 1, i >= 5 ? 'blackbelt' : 'pack',
  i >= 5 ? { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' }, heroAttack: 'attack_blast', title: 'title_kingbreaker' } : { heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast', title: 'title_kingbreaker' }));
// (The equipped TITLE, owner ask 2026-09-28, is account-wide like the hero attack: it rides every board.)
const SKYE = { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' }, heroAttack: 'attack_blast', title: 'title_kingbreaker' };
// A run from before skins: no field anywhere.
const LEGACY = Array.from({ length: 8 }, (_, i) => board('Olde', 'warden', 4343, i + 1, 'pack'));

beforeAll(() => { registerOpponents([...SKINNED, ...LEGACY]); });

describe('scopeCosmetics (what a captured board records)', () => {
  const c = { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_warden_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } };
  it('keeps only this board\'s hero and cards; undefined when nothing applies', () => {
    expect(scopeCosmetics(c, ['albus'], ['pack', 'blackbelt'])).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } });
    expect(scopeCosmetics(c, ['albus'], ['pack'])).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' } });
    expect(scopeCosmetics(c, ['cia'], ['pack'])).toBeUndefined();
    expect(scopeCosmetics(undefined, ['albus'], ['blackbelt'])).toBeUndefined();
  });

  it('the account-wide hero attack rides every board, even one with no skin in it (owner 2026-09-28)', () => {
    const a = { ...c, heroAttack: 'attack_blast' };
    expect(scopeCosmetics(a, ['cia'], ['pack'])).toEqual({ heroAttack: 'attack_blast' });
    expect(scopeCosmetics(a, ['albus'], [])).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, heroAttack: 'attack_blast' });
    const run = { ...createRun(7, 'albus'), cosmetics: { heroAttack: 'attack_blast' } };
    expect(snapshotBoard(run).cosmetics).toEqual({ heroAttack: 'attack_blast' });
  });
});

describe('the equipped title rides every board (owner ask 2026-09-28)', () => {
  it('scopeCosmetics keeps the title on any board, even one with no skin in it', () => {
    expect(scopeCosmetics({ title: 'title_the_unbroken' }, ['cia'], ['pack'])).toEqual({ title: 'title_the_unbroken' });
    expect(scopeCosmetics({ heroSkinByHeroId: { warden: 'skin_warden_1' }, title: 'title_ironbeard' }, ['albus'], [])).toEqual({ title: 'title_ironbeard' });
    const run = { ...createRun(7, 'albus'), cosmetics: { title: 'title_the_unbroken' } };
    expect(snapshotBoard(run).cosmetics).toEqual({ title: 'title_the_unbroken' });
  });

  it('the recorded title survives the save round trip', () => {
    const run = { ...createRun(9, 'warden'), cosmetics: { title: 'title_star_chaser' } };
    expect(deserialize(serialize(run)).cosmetics).toEqual({ title: 'title_star_chaser' });
  });
});

describe('snapshotBoard records the run\'s skins, scoped', () => {
  it('a run with cosmetics: the board carries its hero skin; a run without: no field at all (byte-identical to before)', () => {
    const plain = createRun(7, 'albus');
    const skinned = { ...plain, cosmetics: { heroSkinByHeroId: { albus: 'skin_albus_1', warden: 'skin_warden_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } };
    const snap = snapshotBoard(skinned);
    expect(snap.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' } }); // empty board: no Brian skin recorded
    expect('cosmetics' in snapshotBoard(plain)).toBe(false);
    expect(JSON.stringify(snapshotBoard(plain))).toBe(JSON.stringify({ ...snap, cosmetics: undefined }));
  });

  it('a card on the board brings its skin into the snapshot', () => {
    const run = createRun(7, 'albus');
    const withBrian = {
      ...run,
      cosmetics: { minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } },
      board: [{ uid: 'u1', cardId: 'blackbelt', attack: 3, health: 4, keywords: [], golden: true }],
    } as unknown as typeof run;
    expect(snapshotBoard(withBrian).cosmetics).toEqual({ minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
  });

  it('the recorded skins survive the save round trip', () => {
    const run = { ...createRun(9, 'warden'), cosmetics: { heroSkinByHeroId: { warden: 'skin_warden_1' } } };
    expect(deserialize(serialize(run)).cosmetics).toEqual({ heroSkinByHeroId: { warden: 'skin_warden_1' } });
  });
});

describe('the pool and the lobby carry the owner\'s skins', () => {
  it('a reassembled player run UNIONS its boards\' skins (the wave-6 Brian skin is known from round 1)', () => {
    const skye = playerRunsFrom().find((r) => r.author === 'Skye')!;
    expect(skye.cosmetics).toEqual(SKYE);
    expect(playerRunsFrom().find((r) => r.author === 'Olde')!.cosmetics).toBeUndefined();
  });

  it('a snapshot seat copies them at lobby creation; legacy and generated seats have none', () => {
    const lobby = createRunLobby(1234, 'cia');
    const skye = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'albus');
    const olde = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'warden');
    expect(skye?.cosmetics).toEqual(SKYE); // so the foe's hero attack plays when that seat strikes you
    expect(olde && 'cosmetics' in olde).toBe(false);
    for (const s of lobby.seats.filter((x) => x.kind !== 'snapshot')) expect('cosmetics' in s, s.id).toBe(false);
    // the seat is plain data: it survives the JSON round trip a save / replay frame takes
    expect(JSON.parse(JSON.stringify(skye)).cosmetics).toEqual(skye!.cosmetics);
  });
});

describe('replay v2 fidelity: the recorded skins ride the frames', () => {
  it('a shop frame carries the run skins AND every seat recorded skins, through JSON (the IndexedDB round trip)', () => {
    // (createRunLobby with no set filter, so the test pool's set-1 boards seat; createLobbyRun pins the active set)
    const run = { ...createLobbyRun(1234, 'cia', {}, 'lobby'), lobby: createRunLobby(1234, 'cia'), cosmetics: { heroSkinByHeroId: { cia: 'skin_x' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_1' } } };
    const frame = JSON.parse(JSON.stringify(shopFrameOf(run, 'turnStart', 0)));
    expect(frame.view.cosmetics).toEqual(run.cosmetics);
    const seat = frame.view.lobby.seats.find((s: { heroId: string; kind: string }) => s.kind === 'snapshot' && s.heroId === 'albus');
    expect(seat.cosmetics).toEqual(SKYE); // a replay plays the foe's recorded hero attack
    expect(seat.cosmetics.title).toBe('title_kingbreaker'); // ...and shows the title that foe wore
  });

  it('skins never change mid-run, so a delta frame never re-sends them (no replay bloat)', () => {
    const run = { ...createLobbyRun(1234, 'cia', {}, 'lobby'), cosmetics: { heroSkinByHeroId: { cia: 'skin_x' }, title: 'title_wanderer' } };
    const first = shopFrameOf(run, 'turnStart', 0);
    const next = { ...run, embers: run.embers + 1 };
    const d = deltaShopFrameOf(first.view, next, 'turnStart', 10);
    expect(JSON.stringify(d.frame)).not.toContain('cosmetics');
    expect(d.view.cosmetics).toEqual(run.cosmetics);
  });
});
