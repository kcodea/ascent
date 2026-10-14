/**
 * RETIRED TERMS GUARD (R-TERM-01, owner 2026-10-14): "remove oath everywhere, and any mention of climb. this is
 * not the terminology or story we are using".
 *
 * "Oath" was the display name of the retired Line (the old per-run win target), and "the climb" was the old story
 * for a run. Neither may reach a player. This test covers two surfaces:
 *
 *  1. UI SOURCE. Every string a player can read in `packages/ui/src` (string literals, template text and JSX text,
 *     found with the TypeScript parser so comments never count). Dev-only surfaces are skipped: the tuners, the
 *     FX workbench, the perf HUD, and the patch-note HISTORY (`patchNotes.ts`, checked separately below).
 *  2. GAME DATA. Card, quest, rune and hero text, hero tips, build tags, achievements, the Rules Wiki and the
 *     tutorial, read through the packages' public entrypoints.
 *
 * A few CONTENT NAMES still carry the words and are waiting on an owner rename (renaming a card also re-keys its
 * art). They are allow-listed by exact phrase in ALLOWED_PHRASES; delete an entry once the rename lands.
 */
import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import ts from 'typescript';
import { CARD_INDEX, EPIC_RUNES, QUEST_DEFS, RUNES } from '@game/content';
import { HEROES, HERO_TIPS, LEARN_ASCENT, TAG_INFO } from '@game/sim';
import { ACHIEVEMENTS } from '@game/progression';
import { PATCH_NOTES } from './patchNotes';

/** "oath" as a word start (Oath, oaths, Oathshield) and "climb" in any form (climb, climbs, climber, the Climb). */
const RETIRED = /\boath|\bclimb/i;

/** Content names pending an owner rename. Stripped before the check, so the rest of the text is still checked. */
const ALLOWED_PHRASES = ['Oathshield Orin', 'Twin Sun Oath', 'Crest of the Climb'];

const clean = (s: string): string => ALLOWED_PHRASES.reduce((acc, p) => acc.split(p).join(''), s);
const offends = (s: string): boolean => RETIRED.test(clean(s));

// ── 1. UI source ─────────────────────────────────────────────────────────────────────────────────────────────
const UI_SRC = resolve(__dirname);

/** Dev-only or history-only files and folders (relative to packages/ui/src, forward slashes). */
const SKIP = [
  /\.test\.tsx?$/,
  /\.mount\.tsx?$/,
  /Tuner\.tsx$/, // dev tuning panels
  /Config\.ts$/, // tuner slider hints (dev)
  /^fx\//, // FX workbench / library (dev)
  /^perf/i, /\/perf/i, /PerfHud/, // perf HUD + diagnostics (dev)
  /^patchNotes\.ts$/, // history, checked from the cutover date below
];

/** Strings in UI source that are not prose: CSS class names and the like. Exact match. */
const NON_PROSE = new Set([' climb']);

function walk(dir: string, out: string[]): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) walk(full, out);
    else if (/\.tsx?$/.test(name)) out.push(full);
  }
  return out;
}

function stringsOf(file: string): string[] {
  const text = readFileSync(file, 'utf8');
  const sf = ts.createSourceFile(file, text, ts.ScriptTarget.Latest, false, file.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const found: string[] = [];
  const visit = (node: ts.Node): void => {
    if (ts.isStringLiteral(node) || ts.isNoSubstitutionTemplateLiteral(node) || ts.isTemplateHead(node)
      || ts.isTemplateMiddle(node) || ts.isTemplateTail(node)) found.push(node.text);
    else if (ts.isJsxText(node)) found.push(node.text);
    // Import specifiers name modules, not prose.
    if (ts.isImportDeclaration(node) || ts.isExportDeclaration(node)) return;
    ts.forEachChild(node, visit);
  };
  visit(sf);
  return found;
}

describe('retired terms (R-TERM-01): no "Oath" or "climb" in player-facing text', () => {
  it('UI source strings', () => {
    const files = walk(UI_SRC, []).filter((f) => {
      const rel = relative(UI_SRC, f).replace(/\\/g, '/');
      return !SKIP.some((re) => re.test(rel));
    });
    expect(files.length).toBeGreaterThan(100); // the scan really ran
    const hits: string[] = [];
    for (const f of files) {
      for (const s of stringsOf(f)) {
        if (!NON_PROSE.has(s) && offends(s)) hits.push(`${relative(UI_SRC, f)}: ${JSON.stringify(s.trim().slice(0, 120))}`);
      }
    }
    expect(hits).toEqual([]);
  });

  it('patch notes from 2026-10-14 on', () => {
    const hits = PATCH_NOTES.filter((n) => n.date >= '2026-10-14')
      .flatMap((n) => n.changes.flatMap((c) => [c.text, ...(c.details ?? [])]))
      .filter(offends);
    expect(hits).toEqual([]);
  });

  // ── 2. Game data ───────────────────────────────────────────────────────────────────────────────────────────
  it('cards, quests and runes', () => {
    const hits: string[] = [];
    const check = (where: string, ...texts: (string | undefined)[]): void => {
      for (const t of texts) if (t && offends(t)) hits.push(`${where}: ${t}`);
    };
    for (const c of Object.values(CARD_INDEX)) check(`card ${c.id}`, c.name, c.text);
    for (const q of QUEST_DEFS) check(`quest ${q.id}`, q.name);
    for (const r of [...RUNES, ...EPIC_RUNES]) check(`rune ${r.id}`, r.name, r.text);
    expect(hits).toEqual([]);
  });

  it('heroes, hero tips, build tags, achievements and the tutorial', () => {
    const hits: string[] = [];
    const check = (where: string, ...texts: (string | undefined)[]): void => {
      for (const t of texts) if (t && offends(t)) hits.push(`${where}: ${t}`);
    };
    for (const h of HEROES) check(`hero ${h.id}`, h.name, h.blurb, h.power.name, h.power.text);
    for (const [id, t] of Object.entries(HERO_TIPS)) check(`hero tip ${id}`, t.tip);
    for (const [tag, info] of Object.entries(TAG_INFO)) check(`build tag`, tag, info);
    for (const a of ACHIEVEMENTS) check(`achievement ${a.id}`, a.name, a.requirement);
    // Every string in the tutorial course except ids (a step id is not shown; the opening step is still `climb`).
    check('tutorial', JSON.stringify(LEARN_ASCENT, (k, v: unknown) => (k === 'id' ? undefined : v)));
    expect(hits).toEqual([]);
  });

  it('the check itself catches the retired words', () => {
    expect(offends('Oath 9')).toBe(true);
    expect(offends('The climb is complete')).toBe(true);
    expect(offends('Unnamed climber')).toBe(true);
    expect(offends('Oathbringer')).toBe(true);
    expect(offends('Crest of the Climb')).toBe(false); // allow-listed name
    expect(offends('Finish in the top 4 to gain Rating.')).toBe(false);
  });
});
