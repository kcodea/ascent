import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// R-TEXT-SHOUT-01 (owner report 2026-10-06): the on-play trigger is called "Shout" on screen. The targeted-Shout
// prompt read "Choose a minion for Baby Gastrid's Battlecry". This scans every rendered JSX text run in packages/ui
// for the retired word, so a new prompt, label or tooltip cannot bring it back. Code identifiers (`battlecryUids`,
// `replayBattlecry`) and comments are not player-facing and are ignored.

const ROOT = join(__dirname);

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...tsxFiles(p));
    else if (name.endsWith('.tsx') && !name.includes('.test.')) out.push(p);
  }
  return out;
}

/** Drop block and line comments (JSX `{/* … *\/}` included), so a code comment never trips the scan. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('on-screen text says Shout, never Battlecry', () => {
  it('no rendered JSX text in packages/ui says "Battlecry"', () => {
    const hits: string[] = [];
    for (const f of tsxFiles(ROOT)) {
      const src = stripComments(readFileSync(f, 'utf8'));
      // A JSX text run: after a tag's `>` or an expression's `}`, up to the next `<` or `{`.
      for (const m of src.matchAll(/[>}]([^<>{}]*)/g)) {
        if (/\bBattlecry\b/.test(m[1]!)) hits.push(`${relative(ROOT, f)}: ${m[1]!.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('the targeted-Shout prompt names the Shout', () => {
    const src = readFileSync(join(ROOT, 'Recruit.tsx'), 'utf8');
    expect(src).toMatch(/Choose a minion for \{[^}]+\}&rsquo;s Shout/);
  });
});
