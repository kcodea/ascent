import { readdirSync, readFileSync, statSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { join, relative, sep } from 'node:path';
import { describe, expect, it } from 'vitest';
import { scanDirectCalls, isScannedSource } from './directCallScan';
import { DIRECT_CALL_SITES, DYNAMIC_CALL_SITES, directCallSites, directCallDefIds } from './directCalls';

/**
 * THE guard that makes `directCalls.ts` a derivation rather than a list.
 *
 * The FX library shows a def as "played from code" on the strength of that file. If the file may drift from
 * the source, the library is back to lying — which is the bug the file was added to fix. So the scan is re-run
 * here against the REAL `packages/ui/src` on every `npm test`, and the snapshot must match it exactly. There
 * is no way to add a direct `playDef('…')` call and leave the library under-reporting: CI names the def.
 */

const UI_SRC = fileURLToPath(new URL('../', import.meta.url));

function readSources(): { file: string; text: string }[] {
  const out: { file: string; text: string }[] = [];
  const walk = (dir: string): void => {
    for (const name of readdirSync(dir)) {
      const p = join(dir, name);
      if (statSync(p).isDirectory()) walk(p);
      else {
        const file = relative(UI_SRC, p).split(sep).join('/');
        if (isScannedSource(file)) out.push({ file, text: readFileSync(p, 'utf8') });
      }
    }
  };
  walk(UI_SRC);
  return out;
}

const scan = scanDirectCalls(readSources());

describe('scanDirectCalls', () => {
  it('reads an id off a single-line call', () => {
    const s = scanDirectCalls([{ file: 'A.tsx', text: "playDef('coins', anchors);" }]);
    expect(s.literals).toEqual({ coins: ['A.tsx'] });
    expect(s.dynamic).toEqual([]);
  });

  /**
   * THE case a line-at-a-time regex gets wrong. `strike-impact` — the melee smack, about the most-played
   * effect in the game — is fired from `choreo/channels/impact.ts` as a call whose id sits on its OWN line.
   * A scanner that only looked at the `playDef(` line would file it as unresolvable and the library would go
   * on showing it as inert, which is the precise defect being fixed.
   */
  it('reads an id that sits on the line after the open paren', () => {
    const s = scanDirectCalls([{ file: 'A.ts', text: "playDef(\n  'strike-impact',\n  anchors,\n);" }]);
    expect(s.literals).toEqual({ 'strike-impact': ['A.ts'] });
  });

  it('records a non-literal id as a dynamic site instead of guessing', () => {
    const s = scanDirectCalls([{ file: 'A.ts', text: 'const id = x;\nplayDef(id, anchors);' }]);
    expect(s.literals).toEqual({});
    expect(s.dynamic).toEqual([{ file: 'A.ts', line: 2 }]);
  });

  it('collects every file that plays the same def, de-duplicated and sorted', () => {
    const s = scanDirectCalls([
      { file: 'B.tsx', text: "playDef('coins', a); playDef('coins', b);" },
      { file: 'A.tsx', text: "playDef('coins', a);" },
    ]);
    expect(s.literals.coins).toEqual(['A.tsx', 'B.tsx']);
  });

  it('ignores files the scan deliberately excludes', () => {
    const s = scanDirectCalls([
      { file: 'fx/ui/Workbench.tsx', text: "playDef('coins', a);" },
      { file: 'fx/playDef.ts', text: "playDef('coins', a);" },
      { file: 'Recruit.test.tsx', text: "playDef('coins', a);" },
      { file: 'notes.md', text: "playDef('coins', a);" },
    ]);
    expect(s.literals).toEqual({});
  });
});

describe('isScannedSource', () => {
  it('takes ordinary UI sources', () => {
    expect(isScannedSource('Recruit.tsx')).toBe(true);
    expect(isScannedSource('choreo/channels/impact.ts')).toBe(true);
  });

  // The workbench plays whatever def the author clicked. Counting that would mark EVERY def as played by
  // code, which would destroy the distinction this whole mechanism exists to draw.
  it('rejects the workbench, playDef itself, this machinery, tests and non-sources', () => {
    expect(isScannedSource('fx/ui/Workbench.tsx')).toBe(false);
    expect(isScannedSource('fx/playDef.ts')).toBe(false);
    expect(isScannedSource('fx/directCallScan.ts')).toBe(false);
    expect(isScannedSource('fx/directCalls.ts')).toBe(false);
    expect(isScannedSource('catalog.test.ts')).toBe(false);
    expect(isScannedSource('styles.css')).toBe(false);
  });
});

describe('DIRECT_CALL_SITES is a derivation, not a list', () => {
  it('matches a fresh scan of packages/ui/src exactly', () => {
    expect(
      scan.literals,
      'packages/ui/src/fx/directCalls.ts is stale. Replace DIRECT_CALL_SITES with:\n' +
        JSON.stringify(scan.literals, null, 2),
    ).toEqual(DIRECT_CALL_SITES);
  });

  /**
   * The blind spot, pinned. A new `playDef(<expression>)` outside `score.ts` would be a def the library cannot
   * see and would go on calling inert — so it fails here and has to be dealt with (bind it, use a literal, or
   * document it) rather than quietly shrinking the coverage map.
   */
  it('accounts for every non-literal call site', () => {
    const counts: Record<string, number> = {};
    for (const s of scan.dynamic) counts[s.file] = (counts[s.file] ?? 0) + 1;
    expect(
      counts,
      `unaccounted dynamic playDef sites: ${scan.dynamic.map((s) => `${s.file}:${s.line}`).join(', ')}`,
    ).toEqual(DYNAMIC_CALL_SITES);
  });

  // Everything dynamic today is the binding path. If that stops being true the note the by-event lens prints
  // ("the rest is the binding path, already listed above") becomes false. THREE resolvers now — `score.ts`
  // for combat moments, `recruitCues.ts` for shop ones, and `runeTriggerFx.ts` for the HUD (a rune badge,
  // which the score cannot anchor to — see that file's header). Same path, three times, not a new kind of
  // caller: each resolves a binding and plays its `def`.
  it('has no dynamic call site outside the binding resolvers — plus one recorded exception', () => {
    // TWO exceptions, both the EQUIPMENT USE cue (2026-08-28): the def id is data on the Equipment rather than
    // a `bindings.json` row, so it resolves at the cue site instead of in a resolver. `Recruit.tsx` is the
    // real cue; `EquipFxTuner.tsx` is the tuner's test fire, which plays the SELECTED Equipment's def so both
    // cues can be timed rather than being hardwired to Bloodpot's.
    //
    // That is real debt, not a second pattern — an Equipment-use moment belongs in `recruitCues.ts`, and
    // moving it there retires BOTH lines and shrinks this back to the four resolvers. Listed so the exception
    // stays reviewable rather than silent.
    expect(Object.keys(DYNAMIC_CALL_SITES).sort()).toEqual(['EquipFxTuner.tsx', 'Recruit.tsx', 'choreo/recruitCues.ts', 'choreo/score.ts', 'runeTriggerFx.ts', 'useCombatReplay.ts']);
  });

  // The seven migrated effects the library used to call inert, plus `ruby-gem-apply` — authored in the
  // workbench and wired to the Ruby-landed cue rather than migrated out of a `pixiFx` method, but reaching the
  // game the same way (two literal call sites: the shop cue in Recruit and the combat channel in score.ts) —
  // plus `watcher-pulse`, fired directly from `useCombatReplay.ts`'s trigger-medallion effect.
  it('finds every effect the game plays from code', () => {
    expect(directCallDefIds()).toEqual([
      // 'bloodpot' left this list on 2026-08-28: the tuner's use-test stopped naming it literally and now
      // plays whichever Equipment is selected, so it reaches the game only through the dynamic path.
      // 'board-wipe' left on 2026-08-29: the curtain moved above the FX canvas and the streak call was retired.
      'ale-bubbles', 'auctioneer-hp', 'choose-one-both', 'cia-hp', 'click-puff', 'coin', 'coins', 'consume-pull', 'damage-burst', 'death-dissolve',
      'equipment-spark', 'equipment-used-up',
      'freeze-blast', 'hero-power-spark', 'hero-power-target', 'impact-dust', 'landing-dust', 'ruby-gem-apply',
      'rune-buff-unit', 'rune-select-implosion', 'rune-slot-break', 'shop-buff-aura', 'shop-tier-up', 'strike-impact', 'tallyanimation1', 'watcher-pulse',
    ]);
  });

  it('names every def it lists as one that actually exists', async () => {
    await import('./primitives');
    const { listDefs } = await import('./fxDefs');
    const known = new Set(listDefs().map((d) => d.id));
    const missing = directCallDefIds().filter((id) => !known.has(id));
    expect(missing, `code plays defs that do not exist: ${missing.join(', ')}`).toEqual([]);
  });
});

describe('directCallSites', () => {
  it('returns the files for a def played from code', () => {
    expect(directCallSites('strike-impact')).toEqual(['choreo/channels/impact.ts']);
  });

  it('returns an empty array — never undefined — for a def nothing calls', () => {
    expect(directCallSites('burst-thin-trail')).toEqual([]);
  });
});
