/** The client trusts only the live friends hub URL (one stable Worker for every build; R-DM-01). */
import { describe, expect, it } from 'vitest';
import { FRIENDS_HUB_LIVE_URL } from '@game/versus-cf/hub';
import { bakedHubUrl } from './hubUrl';

describe('the baked hub URL (R-DM-01)', () => {
  it('is the live hub or nothing', () => {
    expect(FRIENDS_HUB_LIVE_URL).toBe('https://ascent-hub.team-ascent.workers.dev');
    expect(bakedHubUrl(`${FRIENDS_HUB_LIVE_URL}/`)).toBe(FRIENDS_HUB_LIVE_URL);
    expect(bakedHubUrl('https://ascent-hub.evil.workers.dev')).toBeNull();
    expect(bakedHubUrl(undefined)).toBeNull();
  });
});
