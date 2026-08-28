import { readFileSync, readdirSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * Every `playDef(...)` call that fires AT A UNIT must hand over that unit's uid.
 *
 * This guard exists because the same defect shipped three times in one day. A `react` layer animates a
 * card's DOM, so it needs `uids` — but a Pixi layer doesn't, so a call site that forgets them looks
 * completely fine and keeps working. The effect still plays; it just plays on nobody (or, before the
 * fallback was removed, on the leftmost minion). Nothing throws, nothing fails, and the symptom shows up
 * as "the wrong card reacted" three modules away from the cause.
 *
 * Grepping by hand missed `Recruit.tsx` twice — once to a truncated `head -10`. So the scan is a test.
 *
 * The rule: a call passing `uids` is fine, and a call in `UNIT_LESS` is fine. Anything else fails, and the
 * fix is either to pass the uid or to add the site here WITH a reason. Adding a line to `UNIT_LESS` is
 * deliberately a reviewable diff — that is the whole mechanism.
 */

const UI_SRC = join(__dirname, '..');

/** Call sites that genuinely have no unit — the FX plays at a cursor, a button, or a HUD box. A react layer
 *  bound into one of these defs would correctly do nothing, because there is no card for it to be about. */
const UNIT_LESS: { file: string; id: string; why: string }[] = [
  { file: 'Recruit.tsx', id: 'tallyanimation1', why: 'flies from the tally centre to the attack pill by coords, not at a unit' },
  { file: 'Recruit.tsx', id: 'click-puff', why: 'fires at the cursor' },
  { file: 'Recruit.tsx', id: 'board-wipe', why: 'races the combat-entry/exit wipe front edge to edge by screen coords, not at a unit' },
  { file: 'Recruit.tsx', id: 'coin', why: 'fires at the gold pill' },
  { file: 'EndTurnButton.tsx', id: 'impact-dust', why: 'fires at the button' },
  { file: 'RefreshButton.tsx', id: 'impact-dust', why: 'fires at the button' },
  { file: 'TavernUpButton.tsx', id: 'shop-tier-up', why: 'fires at the button' },
  { file: 'FreezeButton.tsx', id: 'freeze-blast', why: 'fires at the button' },
  { file: 'StatusBar.tsx', id: 'hero-power-spark', why: 'fires at the hero power button, not a unit' },
  { file: 'Recruit.tsx', id: 'hero-power-target', why: 'fires at the click point on the targeted unit (cursor anchor), not via slot anchors' },
  { file: 'useCiaEnchantedFx.ts', id: 'cia-hp', why: 'fires on a SHOP offer card the moment Cia enchants it (recruit phase) — anchored to the card DOM rect, not a combat slot, and never replayed' },
  { file: 'useChooseBothFx.ts', id: 'choose-one-both', why: 'a persistent MARKER on a hand / shop / Discover CARD, keyed by the `data-choose-both` DOM hook and followed by rect — a Discover option has no uid at all, and none of the three surfaces is a combat slot' },
  { file: 'QuestBadges.tsx', id: 'rune-slot-break', why: 'fires at the locked 3rd rune slot in the HUD badge row, not a unit' },
  { file: 'runeTriggerFx.ts', id: '<dynamic>', why: 'fires on a rune BADGE in the status bar — a HUD node, not a unit, so there is no uid to pass' },
];

function sourceFiles(dir: string, out: string[] = []): string[] {
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      if (name !== 'node_modules') sourceFiles(full, out);
    } else if (/\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name)) {
      out.push(full);
    }
  }
  return out;
}

/** `playDef(` … matching parens, so a multi-line call is one match rather than a truncated first line. */
function callsIn(src: string): string[] {
  const calls: string[] = [];
  for (let i = src.indexOf('playDef('); i !== -1; i = src.indexOf('playDef(', i + 1)) {
    // Skip mentions inside comments and strings — `directCallScan.ts` documents the pattern in prose.
    const lineStart = src.lastIndexOf('\n', i) + 1;
    const line = src.slice(lineStart, i);
    if (line.includes('//') || line.includes('*') || line.includes("'") || line.includes('`')) continue;
    let depth = 0;
    let j = src.indexOf('(', i);
    for (; j < src.length; j++) {
      if (src[j] === '(') depth++;
      else if (src[j] === ')' && --depth === 0) break;
    }
    calls.push(src.slice(i, j + 1));
  }
  return calls;
}

/** The def id a call names, or the `<dynamic>` sentinel when it is an expression (a resolved `binding.def`).
 *  Shared by BOTH checks below on purpose: they derived it two different ways — one parsing the literal, one
 *  substring-testing for it — so a dynamic call could satisfy the offender check and simultaneously look
 *  stale to the other. One derivation, one answer. */
function idOf(call: string): string {
  return /playDef\(\s*'([^']+)'/.exec(call)?.[1] ?? '<dynamic>';
}

describe('every playDef call at a unit passes its uid', () => {
  it('has no unit-aimed call missing `uids`', () => {
    const offenders: string[] = [];
    for (const file of sourceFiles(UI_SRC)) {
      // The bridge itself defines playDef; its own doc comments name the pattern.
      if (file.endsWith('playDef.ts') || file.includes('directCallScan')) continue;
      const short = file.split(/[\\/]/).pop() ?? file;
      for (const call of callsIn(readFileSync(file, 'utf8'))) {
        if (call.includes('uids')) continue;
        const id = idOf(call);
        if (UNIT_LESS.some((u) => u.file === short && u.id === id)) continue;
        offenders.push(`${short}: playDef('${id}') — pass uids, or add it to UNIT_LESS with a reason`);
      }
    }
    expect(offenders, offenders.join('\n')).toEqual([]);
  });

  it('has no stale UNIT_LESS entry', () => {
    // An exemption that no longer matches a real call is a lie in a list whose whole job is to be trusted.
    const all = sourceFiles(UI_SRC).flatMap((f) => {
      const short = f.split(/[\\/]/).pop() ?? f;
      return callsIn(readFileSync(f, 'utf8')).map((c) => ({ short, call: c }));
    });
    const stale = UNIT_LESS.filter(
      (u) => !all.some(({ short, call }) => short === u.file && idOf(call) === u.id && !call.includes('uids')),
    );
    expect(stale.map((s) => `${s.file}: ${s.id}`), 'UNIT_LESS entries matching nothing').toEqual([]);
  });
});
