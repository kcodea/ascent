import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { join } from 'node:path';

/**
 * R-PROFILE-AVATAR-READ-01: every `profiles` column a client read names is in the client roles' column grant.
 *
 * 2026-09-29-hide-profile-email.sql turned the table-wide SELECT into a column list; a column added later is unreadable
 * until it joins the grant. `avatar` (2026-10-16) never did, so every read naming it failed with 42501 "permission denied
 * for table profiles" (the live log, 2026-10-25) and fell back to a second read. This test reads the grants from the
 * migrations and the column names from every `.from('profiles').select(...)` in the UI, so a new column cannot ship
 * unreadable again.
 */
const root = join(__dirname, '../../..');
const MIG = join(root, 'supabase/migrations');

function grantedColumns(): Set<string> {
  const cols = new Set<string>();
  for (const f of readdirSync(MIG).filter((x) => x.endsWith('.sql')).sort()) {
    const sql = readFileSync(join(MIG, f), 'utf8').replace(/--[^\n]*/g, '');
    if (/revoke\s+select\s+on\s+public\.profiles\s+from/i.test(sql)) cols.clear();
    for (const m of sql.matchAll(/grant\s+select\s*\(([^)]*)\)\s*on\s+public\.profiles\s+to[^;]*anon/gi)) {
      for (const c of m[1]!.split(',')) cols.add(c.trim().toLowerCase());
    }
  }
  return cols;
}

/** The column names the UI's profiles reads ask for (string literals and the column constants they splice in). */
function readColumns(): Map<string, string> {
  const out = new Map<string, string>();
  const files = ['remoteBoards.ts', 'progression/progressionRemote.ts', 'versus/versusSeatCard.ts'];
  for (const f of files) {
    const src = readFileSync(join(__dirname, f), 'utf8');
    const consts = new Map<string, string>();
    for (const m of src.matchAll(/const\s+([A-Z_]+)\s*=\s*'([^']*)'/g)) consts.set(m[1]!, m[2]!);
    const add = (text: string): void => {
      for (const tok of text.split(/[\s,]+/)) if (/^[a-z_]+$/.test(tok)) out.set(tok, f);
    };
    for (const m of src.matchAll(/from\('profiles'\)\.select\(\s*(['`])([^'`]*)\1/g)) {
      const s = m[2]!.replace(/\$\{([A-Z_]+)\}/g, (_, k: string) => consts.get(k) ?? '');
      add(s.replace(/\$\{[^}]*\}/g, ''));
    }
    // Column lists passed to a local reader (`read('user_id, ..., avatar')`, `rankedSelect(', equipped_title_id, avatar')`).
    for (const m of src.matchAll(/(?:read|rankedSelect)\(\s*'([^']*)'\s*\)/g)) add(m[1]!);
  }
  return out;
}

describe('R-PROFILE-AVATAR-READ-01: the client can read every profiles column it asks for', () => {
  it('every column named by a UI profiles read is granted to anon / authenticated', () => {
    const granted = grantedColumns();
    const asked = readColumns();
    expect(asked.has('avatar')).toBe(true); // the scan sees the reads that failed live
    const missing = [...asked].filter(([c]) => !granted.has(c)).map(([c, f]) => `${c} (${f})`);
    expect(missing).toEqual([]);
  });

  it('email stays hidden from the client roles', () => {
    expect(grantedColumns().has('email')).toBe(false);
  });
});
