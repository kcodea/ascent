import { describe, it, expect } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';

// R-TEXT-KEYWORD-RETIRE-01 (owner 2026-10-06): the game's keywords have ASCENT names on screen — never the
// retired classic names. The on-play trigger is "Shout" (not Battlecry; owner report 2026-10-06, the targeted
// prompt read "Choose a minion for Baby Gastrid's Battlecry"), and the same holds for every renamed keyword:
//   Battlecry → Shout · Deathrattle → Echo · Divine Shield → Ward · Windfury → Flurry · Venomous → Execute · Reborn → Rise
// Card/rune bodies are auto-renamed by `terms.ts` (`renameTerms`), so the leaks this guards are the surfaces that
// BYPASS it: hardcoded JSX text (prompts, labels, tooltips) and the Rules wiki's authored prose. This scans both
// so a new one cannot silently reintroduce a retired name.
//
// Deliberately NOT flagged: `aliases:` arrays (lower/mixed-case search keywords so a player who types the classic
// word still finds the ASCENT entry — invisible, they only drive search), code identifiers (`battlecryUids`,
// `replayBattlecry`, the `reborn`/`poison` effect ids), comments, and the `terms.ts` rename table itself.

const ROOT = join(__dirname);

// The retired display terms (capitalised — the lower-case forms in `aliases` are search keywords, not shown).
const RETIRED = ['Battlecry', 'Battlecries', 'Deathrattle', 'Deathrattles', 'Divine Shield', 'Divine Shields', 'Windfury', 'Venomous', 'Reborn'];
const RETIRED_RE = new RegExp(`\\b(?:${RETIRED.map((t) => t.replace(' ', '\\s')).join('|')})\\b`);

function walk(dir: string, ext: (name: string) => boolean): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) out.push(...walk(p, ext));
    else if (ext(name) && !name.includes('.test.')) out.push(p);
  }
  return out;
}

/** Drop block and line comments (JSX `{/* … *\/}` included), so a code comment never trips the scan. */
const stripComments = (src: string): string => src.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"`])\/\/.*$/gm, '$1');

describe('on-screen text uses the ASCENT keyword names, never the retired classic ones', () => {
  it('no rendered JSX text in packages/ui names a retired keyword', () => {
    const hits: string[] = [];
    for (const f of walk(ROOT, (n) => n.endsWith('.tsx'))) {
      const src = stripComments(readFileSync(f, 'utf8'));
      // A JSX text run: after a tag's `>` or an expression's `}`, up to the next `<` or `{`.
      for (const m of src.matchAll(/[>}]([^<>{}]*)/g)) {
        if (RETIRED_RE.test(m[1]!)) hits.push(`${relative(ROOT, f)}: ${m[1]!.trim()}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('no Rules wiki answer or question names a retired keyword', () => {
    const hits: string[] = [];
    for (const f of walk(join(ROOT, 'rulesWiki'), (n) => n.endsWith('.ts'))) {
      const src = stripComments(readFileSync(f, 'utf8'));
      src.split('\n').forEach((line, i) => {
        if (/aliases\s*:/.test(line)) return; // search keywords — invisible, intentional
        if (RETIRED_RE.test(line)) hits.push(`${relative(ROOT, f)}:${i + 1}: ${line.trim()}`);
      });
    }
    expect(hits).toEqual([]);
  });

  it('the targeted-Shout prompt names the Shout', () => {
    const src = readFileSync(join(ROOT, 'Recruit.tsx'), 'utf8');
    expect(src).toMatch(/Choose a minion for \{[^}]+\}&rsquo;s Shout/);
  });
});
