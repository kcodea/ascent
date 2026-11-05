/**
 * THE SAMPLE PARTY (DEV only, the "Party home: sample party" switch): a sample teammate and sample friends, so the party
 * home and its friends list can be reviewed without a backend or a second account. Bundled hero portraits only.
 */
import { AVATAR_ART } from '../art';
import type { Friend } from '../friends/friendsRemote';

/** Bundled hero ids for the sample faces. */
export function sampleHeroes(): string[] {
  return AVATAR_ART.filter((a) => a.kind === 'hero').slice(3, 9).map((a) => a.key);
}

/** The sample teammate's id (also a sample friend, so the list can show "In party"). */
export const SAMPLE_MATE_ID = 'sample-1';

export function sampleFriends(): Friend[] {
  const heroes = sampleHeroes();
  const mk = (i: number, name: string, status: Friend['status'], mode: string | null = null): Friend => ({
    userId: `sample-${i}`, author: name, discriminator: String(1000 + i * 37), avatar: null, favoriteHero: heroes[(i - 1) % heroes.length] ?? null,
    frame: null, skin: null, status, mode, lastSeen: status === 'offline' ? new Date(Date.now() - 3_600_000 * (i + 1)).toISOString() : null,
  });
  return [mk(1, 'Mike', 'online'), mk(2, 'Brisbane', 'in_game', 'ranked'), mk(3, 'Coran', 'online'), mk(4, 'Tamby', 'in_game', 'versus_1v1'), mk(5, 'Fibbsy', 'offline'), mk(6, 'Neptus', 'offline')];
}
