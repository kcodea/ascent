/**
 * The SCANNER behind `directCalls.ts` — a pure text pass that finds every `playDef(…)` call in the UI source
 * and sorts it into "names a def id literally" vs "names it with an expression".
 *
 * It exists so the FX library's "played from code" column is DERIVED rather than authored. A hand-kept list of
 * "these defs are called directly" is exactly the thing that rots: the migration that adds the next direct
 * call forgets the list, and the library goes back to displaying a playing effect as inert — the defect this
 * whole mechanism was built to fix. Instead `directCalls.ts` is a committed snapshot of THIS function's
 * output, and `directCalls.test.ts` re-runs the scan against the real files on every CI run and fails if the
 * two disagree. The list cannot drift without turning CI red.
 *
 * DELIBERATELY not imported by anything that ships: the browser reads the committed snapshot, so no source
 * text and no `fs` reach the bundle. Only the test imports this.
 *
 * The text is scanned RAW, comments included. That direction of error is the safe one: a comment containing a
 * literal `playDef('x'` would add a row to the snapshot (visible in review), whereas stripping comments risks
 * eating a real call that happens to sit after a `//` inside a string, i.e. a silent UNDER-report — the same
 * failure mode as a rotting list.
 */

/** One call site, as `<path>:<line>` material. Paths are `packages/ui/src`-relative, POSIX, e.g. `Recruit.tsx`. */
export interface DirectCallSite {
  file: string;
  line: number;
}

export interface DirectCallScan {
  /** def id → the files that call `playDef('<id>', …)`. Sorted, de-duplicated. */
  literals: Record<string, string[]>;
  /**
   * Call sites whose first argument is an expression. These are the scan's BLIND SPOT — it cannot say which
   * def they play, because only runtime knows. They are enumerated (rather than dropped) so the test can pin
   * the known ones and a new one is forced into review instead of silently shrinking the coverage map.
   */
  dynamic: DirectCallSite[];
}

/**
 * Which `packages/ui/src`-relative paths take part in the scan.
 *
 * Four exclusions, each for its own reason:
 * - `fx/playDef.ts` — the definition and its own doc comments/warning template, not a caller.
 * - `fx/directCallScan.ts` + `fx/directCalls.ts` — this machinery talks ABOUT calls; its own prose examples
 *   are the one place the raw-text pass reliably sees a `playDef('…')` that never runs.
 * - `fx/ui/**` — the workbench previews an arbitrary def by id. That is the AUTHOR pressing play, not the
 *   game playing an effect, and counting it would mark literally every def as "played from code".
 * - `*.test.ts(x)` — a test firing a def proves nothing about the shipped game.
 */
export function isScannedSource(file: string): boolean {
  if (file === 'fx/playDef.ts') return false;
  if (file === 'fx/directCallScan.ts' || file === 'fx/directCalls.ts') return false;
  if (file.startsWith('fx/ui/')) return false;
  if (/\.test\.tsx?$/.test(file)) return false;
  return /\.tsx?$/.test(file);
}

/**
 * `playDef(` then, across any whitespace INCLUDING newlines, an optional quoted string.
 *
 * The newline tolerance is the whole trick. `strike-impact` is played from `choreo/channels/impact.ts` as a
 * three-line call — `playDef(\n  'strike-impact',\n  {…},\n)` — so a line-at-a-time regex sees `playDef(` with
 * nothing after it and files the most prominent migrated effect in the game as UNKNOWN. That is precisely the
 * under-report this mechanism must not commit, so the match runs over the whole file text.
 */
const CALL = /\bplayDef\s*\(\s*(?:'([^'\n]*)'|"([^"\n]*)")?/g;

/** Line number (1-based) of an index into `text`. */
function lineOf(text: string, index: number): number {
  let line = 1;
  for (let i = 0; i < index; i++) if (text.charCodeAt(i) === 10) line++;
  return line;
}

export function scanDirectCalls(files: { file: string; text: string }[]): DirectCallScan {
  const literals = new Map<string, Set<string>>();
  const dynamic: DirectCallSite[] = [];

  for (const { file, text } of files) {
    if (!isScannedSource(file)) continue;
    CALL.lastIndex = 0;
    let m: RegExpExecArray | null;
    while ((m = CALL.exec(text)) !== null) {
      const id = m[1] ?? m[2];
      if (id === undefined) {
        dynamic.push({ file, line: lineOf(text, m.index) });
        continue;
      }
      const set = literals.get(id) ?? new Set<string>();
      set.add(file);
      literals.set(id, set);
    }
  }

  const out: Record<string, string[]> = {};
  for (const id of [...literals.keys()].sort()) out[id] = [...(literals.get(id) as Set<string>)].sort();
  dynamic.sort((a, b) => a.file.localeCompare(b.file) || a.line - b.line);
  return { literals: out, dynamic };
}
