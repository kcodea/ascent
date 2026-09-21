import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import type { CombatResult, QuestObjective } from '@game/core';
import { CARD_INDEX, QUEST_DEFS } from '@game/content';
import { KEYWORD_GLOSSARY } from './keywordGlossary';
import { PATCH_NOTES } from './patchNotes';
import { combatGains } from './combatGains';
import { questObjectiveLines, questObjectiveText, questRewardText } from './questText';
import { copyCastSpellText, guelProgressText, monkProgressText, packLeaderText, taughtSpellText } from './cardText';
import { rankErrorText } from './rank/rankSource';
import { announcement, cappedDetail, deltaText, demotionGateText, gateText, outcomeText, standingGateText } from './rank/rankFormat';
import { RANK_FIXTURES } from './rank/fixtures';
import type { RankSubmission } from './rank/types';

/**
 * Owner writing rule (2026-09-21): player-facing text never uses an em dash or a double hyphen as a clause
 * separator. House style is one or two short plain sentences, what it does first. This tripwire covers the
 * surfaces the owner reads most: the keyword glossary, the patch notes, the tooltip / label attributes on the
 * menu, title, career, rankings, leaderboard, recent-games, rank, end, recruit, status-bar, compendium and rune
 * screens, and the text helpers whose output only exists at run time (post-combat gains, quest lines, the
 * spell-copier and improve-style card texts, the rank sentences).
 *
 * Source scanning (readFileSync) for the screens, so the test is fast and deterministic and does not depend on
 * which branch of a screen mounts; direct calls for the helpers, so a dash added in a template literal fails
 * here rather than on a player's screen.
 */

const EM_DASH = '—';
const DOUBLE_HYPHEN = ' -- ';

const offends = (s: string): boolean => s.includes(EM_DASH) || s.includes(DOUBLE_HYPHEN);

/** Every string a player can read on a glossary row. */
function glossaryStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const d of KEYWORD_GLOSSARY) {
    out.push({ where: `glossary ${d.id}.name`, text: d.name });
    out.push({ where: `glossary ${d.id}.def`, text: d.def });
    d.aliases.forEach((a, i) => out.push({ where: `glossary ${d.id}.aliases[${i}]`, text: a }));
  }
  return out;
}

/** Every string a player can read in the Patch Notes overlay. */
function patchNoteStrings(): { where: string; text: string }[] {
  const out: { where: string; text: string }[] = [];
  for (const note of PATCH_NOTES) {
    if (note.label) out.push({ where: `patch ${note.date}.label`, text: note.label });
    note.changes.forEach((c, i) => {
      out.push({ where: `patch ${note.date}.changes[${i}].text`, text: c.text });
      (c.details ?? []).forEach((d, j) => out.push({ where: `patch ${note.date}.changes[${i}].details[${j}]`, text: d }));
    });
  }
  return out;
}

/** Screens whose tooltip / label attributes are scanned at the source level. Paths are relative to this file. */
const TOOLTIP_SOURCES = [
  'MenuSidebar.tsx',
  'Title.tsx',
  'EscMenu.tsx',
  'Career.tsx',
  'Rankings.tsx',
  'Leaderboard.tsx',
  'RecentGames.tsx',
  'rank/RankScreen.tsx',
  'EndScreen.tsx',
  'Recruit.tsx',
  'StatusBar.tsx',
  'MinionBook.tsx',
  'RuneCard.tsx',
  'RefreshButton.tsx',
  'PracticeOptions.tsx',
  'AvatarPicker.tsx',
];

/** The JSX attributes a player reads: hover tips, native titles, screen-reader labels and the option hints. */
const ATTR = /\b(?:data-tip|title|aria-label|hint)=/g;

/**
 * Every string / template literal inside a `{...}` attribute value starting at `open` (the index of the `{`),
 * or null when the brace never closes. A small mode stack instead of a regex: braces inside string literals are
 * ignored, a template literal's `${}` expressions are walked as code (so a literal nested three deep is still
 * read), and `//` / `/* *\/` comments are skipped. A template is returned whole, expressions included; the
 * literals inside its expressions are covered by that text, so they are not returned again on their own.
 */
function bracedLiterals(src: string, open: number): string[] | null {
  type Mode = { kind: 'code'; depth: number } | { kind: 'str'; q: '"' | "'"; start: number; top: boolean } | { kind: 'tpl'; start: number; top: boolean };
  const out: string[] = [];
  const stack: Mode[] = [{ kind: 'code', depth: 1 }];
  const inTemplate = (): boolean => stack.some((m) => m.kind === 'tpl');
  let i = open + 1;
  while (i < src.length) {
    const top = stack[stack.length - 1]!;
    const c = src[i]!;
    const next = src[i + 1];
    if (top.kind === 'code') {
      if (c === '/' && next === '/') { i = src.indexOf('\n', i); if (i < 0) return null; continue; }
      if (c === '/' && next === '*') { i = src.indexOf('*/', i); if (i < 0) return null; i += 2; continue; }
      if (c === '"' || c === "'") stack.push({ kind: 'str', q: c, start: i, top: !inTemplate() });
      else if (c === '`') stack.push({ kind: 'tpl', start: i, top: !inTemplate() });
      else if (c === '{') top.depth++;
      else if (c === '}') {
        top.depth--;
        if (top.depth === 0) {
          stack.pop();
          if (stack.length === 0) return out;
        }
      }
    } else if (top.kind === 'str') {
      if (c === '\\') i++;
      else if (c === top.q || c === '\n') { stack.pop(); if (top.top) out.push(src.slice(top.start + 1, i)); }
    } else {
      if (c === '\\') i++;
      else if (c === '`') { stack.pop(); if (top.top) out.push(src.slice(top.start + 1, i)); }
      else if (c === '$' && next === '{') { stack.push({ kind: 'code', depth: 1 }); i++; }
    }
    i++;
  }
  return null;
}

/**
 * Pull every readable attribute value out of a source file: the plain `attr="..."` form and every string /
 * template literal inside `attr={...}`. Comments are not attributes, so a dash in a JSX comment never trips.
 */
function tooltipValues(src: string): string[] {
  const out: string[] = [];
  for (let m = ATTR.exec(src); m; m = ATTR.exec(src)) {
    const at = m.index + m[0].length;
    const c = src[at];
    if (c === '"') {
      const end = src.indexOf('"', at + 1);
      if (end > at) out.push(src.slice(at + 1, end));
    } else if (c === '{') {
      const lits = bracedLiterals(src, at);
      if (lits === null) throw new Error(`unterminated attribute value at offset ${at}`);
      out.push(...lits);
    }
  }
  ATTR.lastIndex = 0;
  return out;
}

describe('player-facing text carries no em dash and no double hyphen (owner rule 2026-09-21)', () => {
  it('keyword glossary: name, def and aliases', () => {
    const bad = glossaryStrings().filter((s) => offends(s.text)).map((s) => `${s.where}: ${s.text}`);
    expect(bad).toEqual([]);
  });

  it('patch notes: label, text and details', () => {
    const bad = patchNoteStrings().filter((s) => offends(s.text)).map((s) => `${s.where}: ${s.text}`);
    expect(bad).toEqual([]);
  });

  it('tooltip / label attributes (data-tip, title, aria-label, hint) on the scanned screens', () => {
    const bad: string[] = [];
    for (const rel of TOOLTIP_SOURCES) {
      const src = readFileSync(join(__dirname, rel), 'utf8');
      const values = tooltipValues(src);
      expect(values.length, `${rel} yields no attribute values; is the file still a screen?`).toBeGreaterThan(0);
      for (const v of values) if (offends(v)) bad.push(`${rel}: ${v}`);
    }
    expect(bad).toEqual([]);
  });

  it('post-combat gains (every carry-back line)', () => {
    const r: CombatResult = {
      events: [], result: 'win', playerDamage: 0, playerDeathrattles: 0, enemyDeaths: 0,
      initial: { player: [], enemy: [] },
      playerSpellPower: { attack: 2, health: 1 },
      playerMaxGoldGain: 1,
      playerUndeadBuyAtkGain: 3,
      playerImpBuffGain: { attack: 2, health: 3 },
      playerFodderBuffGain: { attack: 1, health: 1 },
      playerCardBuffs: [{ cardId: 'u1_grave_knit', attack: 1, health: 2 }],
      playerFodderGrants: 2,
      playerFreeRolls: 1,
      playerHandGrants: ['spiritfire', 'emberpouch'],
      playerPermaBuffs: [
        { sourceUid: 'a', attack: 3, health: 2, engraved: true },
        { sourceUid: 'b', attack: 1, health: 1, engraved: true },
      ],
    };
    const lines = combatGains(r);
    expect(lines.length).toBeGreaterThanOrEqual(8);
    expect(lines.filter(offends)).toEqual([]);
  });

  it('quest objective, progress lines and reward text for every authored quest, plus the hero journey', () => {
    const bad: string[] = [];
    const journey: QuestObjective = { event: 'journey', count: 20 };
    for (const [id, o] of [['journey', journey] as const, ...QUEST_DEFS.map((q) => [q.id, q.objective] as const)]) {
      for (const t of [questObjectiveText(o), ...questObjectiveLines(o, { shout: 1, echo: 2, rally: 3 }, [1, 2])]) {
        if (offends(t)) bad.push(`quest ${id} objective: ${t}`);
      }
    }
    for (const q of QUEST_DEFS) {
      for (const live of [undefined, { completed: true, shoutCharges: 2, repeatTurns: 3 }]) {
        const t = questRewardText(q.reward, live);
        if (offends(t)) bad.push(`quest ${q.id} reward: ${t}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('live card-text helpers over every card id (spell copiers, Pack Leader, Guel, Monk, taught spells)', () => {
    const bad: string[] = [];
    const names = { firstThisTurn: 'Star Crash', lastThisTurn: 'Spiritfire', keeperFirst: 'Ember Pouch' };
    const spell = Object.values(CARD_INDEX).find((c) => c.spell);
    expect(spell).toBeDefined();
    for (const id of Object.keys(CARD_INDEX)) {
      for (const golden of [false, true]) {
        const outs = [
          copyCastSpellText(id, golden, names),
          packLeaderText(id, 6, golden),
          guelProgressText(id, golden, 5),
          monkProgressText(id, golden, 7, 1),
          taughtSpellText(id, spell!.id, 'Give a friendly minion +2/+2.'),
        ];
        for (const t of outs) if (t && offends(t)) bad.push(`${id}${golden ? ' (gilded)' : ''}: ${t}`);
      }
    }
    expect(bad).toEqual([]);
  });

  it('rank sentences: every error code, every gate line, every fixture outcome', () => {
    const bad: string[] = [];
    const codes = ['timeout', 'offline', 'no_session', 'no_account', 'rate_limited', 'server_error', 'unsupported_rules', 'unsupported_season', 'bad_input', 'server_predates_medals', 'something_new'];
    const submissions: RankSubmission[] = ['pending', 'confirmed', 'retryable', 'unrated', 'rejected'];
    for (const code of codes) for (const s of submissions) {
      const t = rankErrorText(code, s);
      if (t && offends(t)) bad.push(`rankErrorText(${code}, ${s}): ${t}`);
    }
    for (let d = 0; d < 18; d++) {
      for (const t of [gateText({ divisionIndex: d, points: 100 }), demotionGateText({ divisionIndex: d, points: 0 }), standingGateText({ divisionIndex: d, points: 100 }, true) ?? '']) {
        if (offends(t)) bad.push(`gate ${d}: ${t}`);
      }
    }
    for (const f of RANK_FIXTURES) {
      const lines = [announcement(f.placement, f.result, f.submission), f.error ?? ''];
      if (f.result) lines.push(deltaText(f.result), cappedDetail(f.result) ?? '', outcomeText(f.result) ?? '');
      for (const t of lines) if (offends(t)) bad.push(`fixture ${f.id}: ${t}`);
    }
    expect(bad).toEqual([]);
  });

  it('the scanner sees every attribute form, nested templates included (self-check)', () => {
    const sample = [
      '<button data-tip="Compendium. Browse every card.">x</button>',
      "<b title={unnamed ? 'A temporary name. Click to change it.' : 'Click to change your name'}>y</b>",
      '<i title={`Round ${n}. Jump to the shop.`}>z</i>',
      '<u aria-label={`Round ${k + 1}: ${res}${cal ? `${sep} Calibration round, not scored` : \'\'}`}>w</u>',
      '<s hint={cfg.bots ? "Simple enemies." : levelHint(cfg.level)} title={/* a brace } in a comment */ "Braced comment."}>v</s>',
      '{/* a comment with a dash — never an attribute */}',
    ].join('\n');
    expect(tooltipValues(sample)).toEqual([
      'Compendium. Browse every card.',
      'A temporary name. Click to change it.',
      'Click to change your name',
      'Round ${n}. Jump to the shop.',
      "Round ${k + 1}: ${res}${cal ? `${sep} Calibration round, not scored` : ''}",
      'Simple enemies.',
      'Braced comment.',
    ]);
    expect(tooltipValues('<a data-tip="Bad — dash">q</a>').some(offends)).toBe(true);
    expect(tooltipValues('<a title={`${x ? `deep — dash` : ""}`}>q</a>').some(offends)).toBe(true);
  });
});
