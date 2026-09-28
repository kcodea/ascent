import { beforeAll, describe, expect, it } from 'vitest';
import type { BoardSnapshot } from '../snapshot';
import { scopeCosmetics, snapshotBoard } from '../snapshot';
import { registerOpponents } from '../opponents';
import { createRun, serialize, deserialize } from '../state';
import { createRunLobby } from './runLobby';
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

// A skinned run: the hero skin on every board, the Brian skin only on the boards where Brian was fielded.
const SKINNED = Array.from({ length: 8 }, (_, i) => board('Skye', 'albus', 4242, i + 1, i >= 5 ? 'blackbelt' : 'pack',
  i >= 5 ? { heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } } : { heroSkinByHeroId: { albus: 'skin_albus_1' } }));
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
    expect(skye.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
    expect(playerRunsFrom().find((r) => r.author === 'Olde')!.cosmetics).toBeUndefined();
  });

  it('a snapshot seat copies them at lobby creation; legacy and generated seats have none', () => {
    const lobby = createRunLobby(1234, 'cia');
    const skye = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'albus');
    const olde = lobby.seats.find((s) => s.kind === 'snapshot' && s.heroId === 'warden');
    expect(skye?.cosmetics).toEqual({ heroSkinByHeroId: { albus: 'skin_albus_1' }, minionSkinByCardId: { blackbelt: 'skin_blackbelt_2' } });
    expect(olde && 'cosmetics' in olde).toBe(false);
    for (const s of lobby.seats.filter((x) => x.kind !== 'snapshot')) expect('cosmetics' in s, s.id).toBe(false);
    // the seat is plain data: it survives the JSON round trip a save / replay frame takes
    expect(JSON.parse(JSON.stringify(skye)).cosmetics).toEqual(skye!.cosmetics);
  });
});
