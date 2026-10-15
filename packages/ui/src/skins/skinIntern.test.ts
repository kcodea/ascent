/**
 * SNAPSHOT INTERNING KEYS THE WHOLE SNAPSHOT (owner report 2026-10-15: "i equipped the magma card plate and i only see
 * the default in game, in a ranked game, and in practice"). `internSnapshot` hands one canonical object per snapshot
 * CONTENT; its key used to list five fields by hand, so a run's snapshot that ADDED a card plate matched an older one
 * without it (the same frame / skins) and the plate was dropped. Every field must tell two snapshots apart, while a
 * clone with its keys in another order still interns to the same object. Oracle R-PROG-SKINS-16.
 */
import { describe, expect, it } from 'vitest';
import { internSnapshot, snapshotKey } from './skinArt';

describe('internSnapshot', () => {
  it('a snapshot that adds a card plate is never collapsed onto the plateless one', () => {
    const before = internSnapshot({ portraitFrame: 'frame_fire', heroAttack: 'attack_blast' });
    const withPlate = internSnapshot({ portraitFrame: 'frame_fire', heroAttack: 'attack_blast', cardPlate: 'plate_magma' });
    expect(withPlate).not.toBe(before);
    expect(withPlate?.cardPlate).toBe('plate_magma');
  });

  it('every field counts: card plate, announcer and emotes each change the key', () => {
    const base = { portraitFrame: 'frame_fire' };
    const keys = new Set([
      snapshotKey(base),
      snapshotKey({ ...base, cardPlate: 'plate_magma' }),
      snapshotKey({ ...base, cardPlate: 'plate_beach' }),
      snapshotKey({ ...base, announcer: 'announcer_lemon' }),
      snapshotKey({ ...base, emotes: { 0: 'emote_zen_brian' } }),
    ]);
    expect(keys.size).toBe(5);
  });

  it('a clone with the same content, keys in any order, interns to the same object', () => {
    const a = internSnapshot({ cardPlate: 'plate_bamboo', minionSkinByCardId: { x: 's1', y: 's2' }, title: 'title_wanderer' });
    const b = internSnapshot({ title: 'title_wanderer', minionSkinByCardId: { y: 's2', x: 's1' }, cardPlate: 'plate_bamboo' });
    expect(b).toBe(a);
  });
});
