import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';

// R-PERSIST-EMAIL-01 (2026-09-29): profiles.email is write-only for the client. The anon / authenticated roles
// may not SELECT it (supabase/migrations/2026-09-29-hide-profile-email.sql), so no client query may ask for it,
// or for `*` (which now fails outright).
const src = (rel: string) => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), 'utf8');

describe('profiles.email stays private', () => {
  it('no client profiles query selects email or *', () => {
    for (const file of ['./remoteBoards.ts', './progression/progressionRemote.ts']) {
      const code = src(file);
      const selects = [...code.matchAll(/from\('profiles'\)\s*\.select\(([^)]*)\)/g)].map((m) => m[1]!);
      expect(selects.length, file).toBeGreaterThan(0);
      for (const arg of selects) {
        expect(arg, `${file}: ${arg}`).not.toMatch(/email|'\*'|"\*"|^\s*$/);
      }
    }
  });
  it('the migration revokes the table-wide read and never grants email', () => {
    const sql = src('../../../supabase/migrations/2026-09-29-hide-profile-email.sql');
    expect(sql).toMatch(/revoke select on public\.profiles from anon, authenticated;/);
    const grant = sql.match(/grant select \(([\s\S]*?)\) on public\.profiles/)?.[1] ?? '';
    expect(grant).toContain('user_id');
    expect(grant).not.toMatch(/\bemail\b/);
  });
});
