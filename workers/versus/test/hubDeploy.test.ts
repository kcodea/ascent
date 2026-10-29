/**
 * THE FRIENDS HUB is ONE stable Worker (owner 2026-10-29), deployed only when its own code changed (R-DM-01):
 *  - its source set is the hub entry and what it imports, never the game engine (a content change never redeploys it);
 *  - the code hash is stable and moves when a hub source moves;
 *  - its config is a stable name with append-only migrations, and the Versus Worker no longer binds it;
 *  (the client trusting only the live hub URL: packages/ui/src/friends/dm/hubUrl.test.ts).
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { hubCodeHash, hubSources } from '../scripts/deploy-hub';

const dir = join(__dirname, '..');
const rel = (f: string): string => f.slice(dir.length + 1).replace(/\\/g, '/');

describe('the hub deploy (R-DM-01)', () => {
  it('hashes the hub and only the hub: no engine, no Versus room', () => {
    const files = hubSources().map(rel);
    expect(files).toEqual(expect.arrayContaining(['src/hubWorker.ts', 'src/hub.ts', 'src/hubProtocol.ts', 'src/core/hubCore.ts', 'src/dmStore.ts', 'src/auth.ts', 'hub.wrangler.toml']));
    expect(files.some((f) => /room|liveGame|index\.ts|roomCore/.test(f))).toBe(false);
    for (const f of hubSources()) expect(readFileSync(f, 'utf8')).not.toMatch(/from '@game\/(sim|content|core)/);
    expect(hubCodeHash()).toMatch(/^[0-9a-f]{16}$/);
    expect(hubCodeHash()).toBe(hubCodeHash());
    expect(hubCodeHash(hubSources().filter((f) => !f.endsWith('hub.wrangler.toml')))).not.toBe(hubCodeHash());
  });

  it('is one stable Worker with append-only migrations; the Versus Worker does not bind it', () => {
    const hub = readFileSync(join(dir, 'hub.wrangler.toml'), 'utf8');
    expect(hub).toMatch(/^name = "ascent-hub"$/m);
    expect(hub).toMatch(/class_name = "FriendHub"/);
    expect(hub).toMatch(/tag = "v1"\nnew_sqlite_classes = \["FriendHub"\]/);
    const versus = readFileSync(join(dir, 'wrangler.toml'), 'utf8');
    expect(versus).not.toMatch(/FriendHub|"HUB"/);
  });
});
