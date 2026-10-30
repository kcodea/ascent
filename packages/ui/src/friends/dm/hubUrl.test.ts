/**
 * Where the friends hub is (R-DM-01, R-DM-HUB-URL-01): the client trusts only the live hub URL (one stable Worker for
 * every build), and uses it by default on every page the hub accepts, so a build cut without the release flag (a dev
 * server, a plain pack) still has messages instead of "Messages are not available right now.".
 */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { FRIENDS_HUB_LIVE_URL } from '@game/versus-cf/hub';
import { bakedHubUrl, defaultHubUrl, HUB_PAGE_ORIGINS, isLocalHub } from './hubUrl';

describe('the baked hub URL (R-DM-01)', () => {
  it('is the live hub or nothing', () => {
    expect(FRIENDS_HUB_LIVE_URL).toBe('https://ascent-hub.team-ascent.workers.dev');
    expect(bakedHubUrl(`${FRIENDS_HUB_LIVE_URL}/`)).toBe(FRIENDS_HUB_LIVE_URL);
    expect(bakedHubUrl('https://ascent-hub.evil.workers.dev')).toBeNull();
    expect(bakedHubUrl(undefined)).toBeNull();
  });
});

describe('the default hub (R-DM-HUB-URL-01)', () => {
  it('is the live hub on every page origin the hub accepts, with no release flag needed', () => {
    expect(defaultHubUrl('https://ascent-game-web.netlify.app')).toBe(FRIENDS_HUB_LIVE_URL);
    expect(defaultHubUrl('http://localhost:5173')).toBe(FRIENDS_HUB_LIVE_URL);
    expect(defaultHubUrl('http://127.0.0.1:4173')).toBe(FRIENDS_HUB_LIVE_URL);
  });

  it('is nothing where the hub would refuse the socket (the desktop app, any other host)', () => {
    expect(defaultHubUrl('app://ascent')).toBeNull();
    expect(defaultHubUrl('null')).toBeNull();
    expect(defaultHubUrl('https://ascent-game-web.netlify.app.evil.com')).toBeNull();
    expect(defaultHubUrl('https://evil-ascent-game-web.netlify.app')).toBeNull();
    expect(defaultHubUrl('http://localhost')).toBeNull();
    expect(defaultHubUrl(null)).toBeNull();
  });

  it('accepts exactly the origins the deployed hub allows (hub.wrangler.toml ALLOWED_ORIGINS)', () => {
    const toml = readFileSync(new URL('../../../../../workers/versus/hub.wrangler.toml', import.meta.url), 'utf8');
    const allowed = /^ALLOWED_ORIGINS\s*=\s*"([^"]*)"/m.exec(toml)?.[1]?.split(',').map((s) => s.trim());
    expect(allowed).toEqual([...HUB_PAGE_ORIGINS]);
  });

  it('dev tokens are only ever sent to a local hub', () => {
    expect(isLocalHub('http://127.0.0.1:8788')).toBe(true);
    expect(isLocalHub('http://localhost:8788')).toBe(true);
    expect(isLocalHub(FRIENDS_HUB_LIVE_URL)).toBe(false);
  });
});
