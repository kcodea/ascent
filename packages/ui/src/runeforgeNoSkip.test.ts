/**
 * R-RUNE-34 (owner 2026-09-29: "no skipping allowed now"): the PLAYER cannot skip the Runeforge. The engine keeps
 * a `skipRuneforge` action for bots, fixtures and replays, but no player-facing UI may send it: once the forge
 * opens, the player buys a rune (the free once-per-game Re-roll is still allowed) before the turn goes on.
 *
 * Source scan, like the other UI tripwires: every non-test .ts/.tsx under packages/ui/src is read and none may
 * dispatch `{ type: 'skipRuneforge' }`. (Naming the action for a label or an announcer line is fine; only a
 * dispatch/send is a skip button.)
 */
import { describe, expect, it } from 'vitest';
import { readFileSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = dirname(fileURLToPath(import.meta.url));
const files: string[] = [];
const walk = (dir: string): void => {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) { if (name !== 'node_modules') walk(full); }
    else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) files.push(full);
  }
};
walk(root);

describe('the player cannot skip the Runeforge (R-RUNE-34)', () => {
  it('no UI code dispatches the skipRuneforge action', () => {
    const DISPATCH = /type:\s*['"]skipRuneforge['"]/;
    const offenders = files.filter((f) => DISPATCH.test(readFileSync(f, 'utf8'))).map((f) => f.slice(root.length + 1));
    expect(offenders, 'a player-facing skip for the Runeforge is not allowed (owner 2026-09-29)').toEqual([]);
  });
});
