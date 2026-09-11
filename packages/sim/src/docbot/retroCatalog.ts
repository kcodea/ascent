/**
 * THE RETRO CATALOG — Doc Bot's forward catch-rate ledger (2026-09-11; replaces packages/tools/retro/reinject.py).
 *
 * Doc Bot's one honest effectiveness number is its FORWARD catch rate: of the bugs players and Mike actually
 * report, what fraction would the generic lanes have caught? Each entry here is one shipped bug, reduced to a
 * MINIMAL SOURCE PATCH anchored on today's code (the fix commit run backwards). `npm run docbot:retro`
 * (packages/tools/src/retro-reinject.ts) applies one patch at a time in a THROWAWAY git worktree, runs the
 * cited lanes plus the whole docbot directory, and records CAUGHT / MISSED / UNPATCHABLE. The verdicts stored
 * in `verifiedBy` are what the last run MEASURED — never typed from memory.
 *
 * THE DOCTRINE, restated for this file:
 *  - A CAUGHT entry is a regression guard: if a later run reads MISSED, a generic oracle silently lost its
 *    teeth and the weekly workflow (.github/workflows/docbot-retro.yml) fails.
 *  - A MISSED entry is NOT a failure. It is the build order — the next generic oracle to write. It stays
 *    MISSED, dated, until a lane catches it; nobody edits a verdict by hand.
 *  - GENERIC detection only. `lanes` may cite Doc Bot lanes; the dedicated regression pin every fix ships with
 *    (`regressionLanes`) is listed for the record but is NOT run and can never make an entry CAUGHT — a pin
 *    written for the bug proves nothing about the next bug.
 *  - Patches anchor on TODAY's source. `retroCatalog.test.ts` fails the PR gate the moment an anchor drifts,
 *    so an UNPATCHABLE verdict can only appear on a branch that also broke the gate.
 *
 * The citation half — WHICH generalized family or lane owns each bug CLASS and why — stays in
 * `retroInteractionMap.ts`; `retroMapErrors()` reads this catalog's id list so the two can never drift.
 *
 * Adding an entry: `npm run bugs:catalog -- <report-id>` appends a stub from a closed Bug Board report
 * (packages/tools/src/bugs-catalog.ts); fill in `patch` from the fix commit, run `npm run docbot:retro --
 * --only <id>`, and paste the measured verdict.
 */

export type RetroVerdict = 'CAUGHT' | 'MISSED' | 'UNPATCHABLE' | 'UNMEASURABLE';

/** One anchored text substitution. `find` must match EXACTLY ONCE in `file` unless `all: true` (then ≥ 1). */
export interface RetroPatchOp {
  /** Repo-relative path, forward slashes. */
  file: string;
  find: string;
  replace: string;
  /** Replace every occurrence (the historical bug lacked the guard at every site — a one-site reinjection
   *  is masked by a neighbouring fixed site; the `c8a214d7` lesson). */
  all?: boolean;
}

export type RetroVerifiedBy =
  /** A recorded `npm run docbot:retro` run: the date it ran and what it measured. */
  | { kind: 'reinject-run'; date: string; verdict: RetroVerdict; caughtBy?: string[] }
  /** No run has measured this entry yet — a stub from `bugs:catalog` awaiting its patch. */
  | { kind: 'pending' };

export interface RetroCatalogEntry {
  /** Stable id: `<pr-or-short-sha>-<slug>`. The retroInteractionMap row is keyed on it. */
  id: string;
  title: string;
  /** The fix commit(s) — short shas, or `#<pr>` when the squash commit is the fix. */
  fixCommits: string[];
  /** Bug Board report ids (short), when the bug came through the in-game reporter. */
  reportIds?: string[];
  /** ISO date the bug was REPORTED: the Bug Board `createdAt`, or — for pre-board entries — the fix commit's
   *  date (the closest recorded moment). Drives the trailing-30-day catch rate. */
  reportDate: string;
  /** The reinjection. Empty only on a `pending` stub. */
  patch: RetroPatchOp[];
  /** Generic Doc Bot lanes expected to go red (repo-relative). Run IN ADDITION to the whole docbot directory. */
  lanes: string[];
  /** The bug's own regression pin(s). Listed for the record; never run by the harness, never a CAUGHT. */
  regressionLanes?: string[];
  /** Why this bug is (or is not) inside Doc Bot's generic remit. `out-of-scope` entries still run — a
   *  surprise CAUGHT is recorded — but they are excluded from the forward catch rate. */
  scope: { kind: 'generic' } | { kind: 'out-of-scope'; reason: string };
  verifiedBy: RetroVerifiedBy;
}

const SIM = 'packages/core/src/combat/simulate.ts';
const FAC = 'packages/core/src/effects/factories.ts';
const RED = 'packages/sim/src/reducer.ts';
const REC = 'packages/sim/src/recruit.ts';

const generic = { kind: 'generic' } as const;
const run = (date: string, verdict: RetroVerdict, caughtBy?: string[]): RetroVerifiedBy =>
  ({ kind: 'reinject-run', date, verdict, ...(caughtBy && caughtBy.length > 0 ? { caughtBy } : {}) });

export const RETRO_CATALOG: readonly RetroCatalogEntry[] = [
  // ── wave 1 (2026-08-26/27): the eight out-of-sample bugs that built combatModLane + missDrivenOracles ──
  {
    id: '1176-avenge-arrival',
    title: 'a summoned Avenge counts the whole fight, not from its arrival',
    fixCommits: ['#1176'],
    reportDate: '2026-08-24',
    patch: [{ file: SIM,
      find: 'minion.avengeBaseline = deaths[side];',
      replace: 'minion.avengeBaseline = 0; // REINJECT: summoned Avenge counts the whole fight' }],
    lanes: ['packages/sim/src/docbot/temporalWindow.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/temporalWindow.test.ts']),
  },
  {
    id: '897-stag-multiplier',
    title: 'Stag-forced Echoes consult no Echo multiplier (Echohorn dropped Sylus)',
    fixCommits: ['#897'],
    reportDate: '2026-08-07',
    // replace-ALL: the shared triggerEcho body and Deathsayer's strict reading both consult the multiplier.
    patch: [{ file: FAC, all: true,
      find: 'const procs = (1 + (ctx.echoExtras?.(target) ?? 0)) * mul(self);',
      replace: 'const procs = mul(self); // REINJECT: Stag consults no Echo multiplier' }],
    lanes: ['packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/interactionFamilyMatrix.test.ts', 'packages/sim/src/docbot/missDrivenOracles.test.ts']),
  },
  {
    id: '933-triple-temp-keywords',
    title: 'triples keep temporary keywords',
    fixCommits: ['#933'],
    reportDate: '2026-08-08',
    patch: [{ file: RED,
      find: 'const tempOnly = (k: Keyword): boolean =>',
      replace: 'const tempOnly = (_k2: Keyword): boolean => false; // REINJECT\n  const tempOnlyUnused = (k: Keyword): boolean =>' }],
    lanes: ['packages/sim/src/docbot/missDrivenOracles.test.ts', 'packages/sim/src/docbot/carryOver.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles.test.ts']),
  },
  {
    id: '941-aftershocks-per-watcher',
    title: 'Rune of Aftershocks pays once per death WATCHER instead of once per Echo trigger',
    fixCommits: ['#941'],
    reportDate: '2026-08-09',
    patch: [{ file: SIM,
      find: "const ownEcho = effect.on === 'onDeath' && (payload as { minion?: Minion } | undefined)?.minion === minion;",
      replace: "const ownEcho = effect.on === 'onDeath'; // REINJECT: every watcher wraps as an Echo trigger" }],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/docbot/interactionFamilyMatrix.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/combatModLane.test.ts']),
  },
  {
    id: '832-soulbind-uid',
    title: 'Soulbind matches the wrong uid, so a bond never finds its combat clone',
    fixCommits: ['#832'],
    reportDate: '2026-08-03',
    patch: [{ file: SIM,
      find: 'const idOf = (m: Minion): string => m.sourceUid ?? m.uid;',
      replace: 'const idOf = (m: Minion): string => m.uid; // REINJECT: bond never matches combat clones' }],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/snapshotFidelity.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/combatModLane.test.ts']),
  },
  {
    id: '1111-beefy-fizzle',
    title: 'Beefy and Lantern Light fizzle without counting when cast in combat',
    fixCommits: ['#1111'],
    reportDate: '2026-08-19',
    patch: [{ file: FAC,
      find: "'spellBuffTargetAndNeighbours', 'spellBuffByTier', // Beefy + Lantern Light (2026-08-19)",
      replace: '// REINJECT: Beefy + Lantern Light fizzle in combat' }],
    lanes: ['packages/sim/src/docbot/factoryPhase.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles.test.ts']),
  },
  {
    id: '932-undertow-uncapped',
    title: 'Undertow wards without a cap',
    fixCommits: ['#932'],
    reportDate: '2026-08-08',
    patch: [{ file: SIM,
      find: "undertowUsed[side] < (typeof undertow === 'number' ? undertow : 4)",
      replace: 'true /* REINJECT: unbounded Undertow */' }],
    lanes: ['packages/sim/src/docbot/combatModLane.test.ts', 'packages/sim/src/docbot/conservationLaws.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/combatModLane.test.ts']),
  },
  {
    id: '986-summon-order',
    title: 'summon augmenters apply right→left',
    fixCommits: ['#986'],
    reportDate: '2026-08-12',
    patch: [{ file: SIM,
      find: 'for (const w of [...boards[s]]) {',
      replace: 'for (const w of [...boards[s]].reverse()) { // REINJECT: augmenters right→left' }],
    lanes: ['packages/sim/src/docbot/orderGoldens.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles.test.ts']),
  },
  // ── wave 2 (2026-08-26): 2 predicted-CAUGHT confirmations, 4 probes that built missDrivenOracles2 ──
  {
    id: '8f98da40-spellpower-fold',
    title: 'a stat spell stops folding spell power',
    fixCommits: ['8f98da40'],
    reportDate: '2026-08-02',
    // replace-ALL: every stat-spell factory folds through the same two lines; the bug class is 'a factory skipped
    // the fold', and stripping all six is what the historical run measured against.
    patch: [{ file: REC, all: true,
      find: '      attack += spellAttackBonus(ctx.state);\n      health += spellHealthBonus(ctx.state);',
      replace: '      // REINJECT: stat spell stops folding spell power (#8f98da40 class)' }],
    lanes: ['packages/sim/src/docbot/spellPowerFolding.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/interactionSweep.test.ts', 'packages/sim/src/docbot/spellPowerFolding.test.ts', 'packages/sim/src/docbot/textOracle.test.ts']),
  },
  {
    // replace-ALL: the historical bug lacked the universalTribe arm at every mech-aura site, and the first
    // narrow (one-site) reinjection was masked by a neighbouring fixed site still granting the buff.
    id: 'c8a214d7-alltypes-aura',
    title: 'all-types bodies dropped from every mech aura',
    fixCommits: ['c8a214d7'],
    reportDate: '2026-07-20',
    patch: [{ file: SIM, all: true,
      find: "m.tribe === 'mech' || m.tribe2 === 'mech' || !!m.universalTribe",
      replace: "m.tribe === 'mech' || m.tribe2 === 'mech' /* REINJECT */" }],
    lanes: ['packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/missDrivenOracles2.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles2.test.ts']),
  },
  {
    id: 'bf996507-tribe-gate',
    title: 'the reducer trusts the aim UI\'s target uid (no tribe gate)',
    fixCommits: ['bf996507'],
    reportDate: '2026-08-04',
    patch: [{ file: RED,
      find: 'if (ptDef?.targetTribe && !isTribe(target, ptDef.targetTribe)) return state;',
      replace: '// REINJECT: the reducer accepts whatever target uid it is handed (#849 class)' }],
    lanes: ['packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/targetCardinality.test.ts', 'packages/sim/src/docbot/missDrivenOracles2.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles2.test.ts']),
  },
  {
    id: '69d6a8e5-fizzle-consumed',
    title: 'an unusable untargeted spell is consumed doing nothing',
    fixCommits: ['69d6a8e5'],
    reportDate: '2026-08-03',
    patch: [{ file: RED,
      find: '          if (spellFizzles(s, def)) return state;',
      replace: '          // REINJECT: an unusable untargeted spell is consumed doing nothing (#847 class)' }],
    lanes: ['packages/sim/src/docbot/playDifferential.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/playDifferential.test.ts']),
  },
  {
    id: '7af61a35-maxgold-cap',
    title: 'a max-Gold lead evaporates at the cap',
    fixCommits: ['7af61a35'],
    reportDate: '2026-07-22',
    patch: [{ file: RED,
      find: 's.maxGoldBonus = (s.maxGoldBonus ?? 0) + reps;',
      replace: 's.maxEmbers += reps; // REINJECT: the lead evaporates at the cap (#642 class)' }],
    lanes: ['packages/sim/src/docbot/economyScan.test.ts', 'packages/sim/src/docbot/missDrivenOracles2.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/heroPowerStagers.test.ts', 'packages/sim/src/docbot/missDrivenOracles2.test.ts', 'packages/sim/src/docbot/textOracleEconomy.test.ts']),
  },
  {
    id: 'f45525c9-chipper-random',
    title: 'Chipper feeds a random friendly instead of itself',
    fixCommits: ['f45525c9'],
    reportDate: '2026-08-01',
    patch: [{ file: REC,
      find: 'if (params.self !== true) {',
      replace: 'if (true) { // REINJECT: Chipper feeds a random friendly instead of itself (#803 class)' }],
    lanes: ['packages/sim/src/docbot/targetCardinality.test.ts', 'packages/sim/src/docbot/interactionMatrix.test.ts', 'packages/sim/src/docbot/missDrivenOracles2.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'CAUGHT', ['packages/sim/src/docbot/missDrivenOracles2.test.ts']),
  },
  // ── wave 3 (2026-09-11): Bug Board round 2 (PR #1374) — the four engine fixes, verdicts as measured ──
  {
    id: '9852e16f-gifts-no-target',
    title: 'the cast path sends `{ minion }` only, so every targeted Gift consumes the card and changes nothing',
    fixCommits: ['02378164'],
    reportIds: ['9852e16f'],
    reportDate: '2026-09-05',
    patch: [{ file: REC,
      find: "() => captureBuffFx(ctx.state, undefined, 'spell', () => fn(ctx, target as BoardCard, params, { minion: target as BoardCard, target: target as BoardCard })),",
      replace: "() => captureBuffFx(ctx.state, undefined, 'spell', () => fn(ctx, target as BoardCard, params, { minion: target as BoardCard })), // REINJECT: cast path drops the target (Bug Board 9852e16f)" }],
    lanes: ['packages/sim/src/docbot/playDifferential.test.ts'],
    regressionLanes: ['packages/sim/src/gifts.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'MISSED'),
  },
  {
    id: '7e04222d-free-rally-watchers',
    title: '`fireFreeRally` runs only the rallier\'s own effects — Hawkus / Paragon / Mineral Master never hear a free Rally',
    fixCommits: ['02378164'],
    reportIds: ['7e04222d'],
    reportDate: '2026-09-01',
    patch: [{ file: SIM,
      find: "if (effect.on === 'onAttack' && FREE_RALLY_WATCHER_EFFECTS.has(effect.do)) {",
      replace: "if (false as boolean && effect.on === 'onAttack' && FREE_RALLY_WATCHER_EFFECTS.has(effect.do)) { // REINJECT: watchers skipped (Bug Board 7e04222d)" }],
    lanes: ['packages/sim/src/docbot/combatDifferential.test.ts', 'packages/sim/src/docbot/combatModLane.test.ts'],
    regressionLanes: ['packages/core/src/combat/freeRallyWatchers.test.ts'],
    scope: generic,
    verifiedBy: run('2026-09-11', 'MISSED'),
  },
  {
    id: 'bb5195d5-nested-scope-double-emit',
    title: 'a recruit beat scope opened inside another emits the parent\'s window again (Rope Wrangler shows 2× its steals)',
    fixCommits: ['02378164'],
    reportIds: ['bb5195d5', 'af51e5a3'],
    reportDate: '2026-08-31',
    patch: [
      { file: REC, find: '  parent?.flush();\n', replace: '  // REINJECT: no parent flush (Bug Board bb5195d5)\n' },
      { file: REC, find: '    parent?.rebase();\n', replace: '    // REINJECT: no parent rebase\n' },
    ],
    lanes: [],
    regressionLanes: ['packages/sim/src/eotNestedGrantEmission.test.ts'],
    scope: { kind: 'out-of-scope', reason: 'presentation-beat emission (the consequence collector), not gameplay — Doc Bot audits what is WIRED, and the game state here was always right' },
    verifiedBy: run('2026-09-11', 'MISSED'),
  },
  {
    id: 'cb45dc41-skybound-tier-clamp',
    title: 'Skybound Ascendant clamps its transform to the run\'s Tier-7 access instead of always 7',
    fixCommits: ['94681a18'],
    reportIds: ['cb45dc41'],
    reportDate: '2026-09-01',
    patch: [{ file: REC,
      find: '    const ceiling = 7;\n    const i = ctx.state.board.indexOf(self);',
      replace: '    const ceiling = hasTier7Access(ctx.state) ? 7 : maxTierFor(ctx.state.rift); // REINJECT: bound by the shop gate (Bug Board cb45dc41)\n    const i = ctx.state.board.indexOf(self);' }],
    lanes: ['packages/sim/src/docbot/textNumbers.test.ts'],
    regressionLanes: ['packages/sim/src/runeMinionsAug20.test.ts'],
    scope: { kind: 'out-of-scope', reason: 'an owner RULING (2026-09-09) changed the intended ceiling — the old behaviour matched its own text; no generic oracle can know a design decision before it is made' },
    verifiedBy: run('2026-09-11', 'MISSED'),
  },
  // ── bugs:catalog appends stubs ABOVE this line (npm run bugs:catalog -- <report-id>) ──
];

/** The extra non-docbot lanes the harness has always run alongside the docbot directory (reinject.sh's SUITE). */
export const RETRO_SUITE_EXTRA: readonly string[] = [
  'packages/ui/src/docbotLiveText.test.ts',
  'packages/sim/src/snapshotFidelity.test.ts',
];

export const RETRO_CATALOG_IDS: readonly string[] = RETRO_CATALOG.map((e) => e.id);

// ── pure helpers (shared by the harness, the report and the PR-gate test) ──────────────────────────────────

export interface PatchApplyResult {
  ok: boolean;
  text: string;
  /** Per-op match counts, in order. */
  matches: number[];
  error?: string;
}

/** Apply one op to a source string. Exactly one match unless `all`; never touches the filesystem. */
export function applyPatchOp(source: string, op: RetroPatchOp): PatchApplyResult {
  const n = source.split(op.find).length - 1;
  if (n < 1) return { ok: false, text: source, matches: [n], error: `anchor not found in ${op.file}` };
  if (!op.all && n > 1) return { ok: false, text: source, matches: [n], error: `anchor matches ${n}× in ${op.file} — narrow it or set all: true` };
  return { ok: true, text: source.split(op.find).join(op.replace), matches: [n] };
}

/** Structural sanity, independent of the filesystem: ids, dates, scope/verdict coherence. */
export function retroCatalogErrors(catalog: readonly RetroCatalogEntry[] = RETRO_CATALOG): string[] {
  const errors: string[] = [];
  const seen = new Set<string>();
  const iso = /^\d{4}-\d{2}-\d{2}$/;
  for (const e of catalog) {
    if (seen.has(e.id)) errors.push(`duplicate catalog id '${e.id}'`);
    seen.add(e.id);
    if (!/^[a-z0-9]+(-[a-z0-9]+)+$/.test(e.id)) errors.push(`'${e.id}' is not a kebab id`);
    if (!iso.test(e.reportDate)) errors.push(`'${e.id}' reportDate '${e.reportDate}' is not YYYY-MM-DD`);
    if (e.fixCommits.length === 0) errors.push(`'${e.id}' names no fix commit`);
    if (e.verifiedBy.kind === 'reinject-run') {
      if (!iso.test(e.verifiedBy.date)) errors.push(`'${e.id}' verifiedBy.date '${e.verifiedBy.date}' is not YYYY-MM-DD`);
      if (e.patch.length === 0) errors.push(`'${e.id}' claims a reinject run but has no patch`);
      if (e.verifiedBy.verdict === 'CAUGHT' && !(e.verifiedBy.caughtBy?.length)) errors.push(`'${e.id}' is CAUGHT but names no lane that went red`);
      if (e.verifiedBy.verdict === 'CAUGHT' && e.verifiedBy.caughtBy?.some((l) => (e.regressionLanes ?? []).includes(l))) {
        errors.push(`'${e.id}' credits its own regression pin as the catch — pins are never generic evidence`);
      }
    }
    for (const op of e.patch) {
      if (!op.file.startsWith('packages/')) errors.push(`'${e.id}' patches outside packages/: ${op.file}`);
      if (op.find === op.replace) errors.push(`'${e.id}' has a no-op patch op on ${op.file}`);
    }
    for (const l of e.lanes) if ((e.regressionLanes ?? []).includes(l)) errors.push(`'${e.id}' lists ${l} as both a generic lane and its regression pin`);
  }
  return errors;
}

export interface RetroCatchRate {
  /** Entries in Doc Bot's generic remit with a measured verdict. */
  overall: { caught: number; total: number };
  /** The same, restricted to bugs REPORTED inside the trailing window. */
  trailing: { caught: number; total: number; days: number; from: string; to: string };
  /** Generic entries still MISSED — the build order, oldest report first. */
  missed: string[];
  outOfScope: number;
  pending: number;
}

/** Derived, never typed: the forward catch rate over the generic entries. `today` is injected so the report
 *  can be deterministic under test. */
export function retroCatchRate(catalog: readonly RetroCatalogEntry[], today: string, days = 30): RetroCatchRate {
  const toMs = (d: string): number => Date.parse(`${d}T00:00:00Z`);
  const end = toMs(today);
  const start = end - days * 86_400_000;
  const from = new Date(start).toISOString().slice(0, 10);
  const generic = catalog.filter((e) => e.scope.kind === 'generic');
  const measured = generic.filter((e) => e.verifiedBy.kind === 'reinject-run');
  const caught = (list: readonly RetroCatalogEntry[]): number =>
    list.filter((e) => e.verifiedBy.kind === 'reinject-run' && e.verifiedBy.verdict === 'CAUGHT').length;
  const inWindow = measured.filter((e) => { const t = toMs(e.reportDate); return t > start && t <= end; });
  return {
    overall: { caught: caught(measured), total: measured.length },
    trailing: { caught: caught(inWindow), total: inWindow.length, days, from, to: today },
    missed: measured
      .filter((e) => e.verifiedBy.kind === 'reinject-run' && e.verifiedBy.verdict !== 'CAUGHT')
      .sort((a, b) => (a.reportDate < b.reportDate ? -1 : a.reportDate > b.reportDate ? 1 : 0))
      .map((e) => e.id),
    outOfScope: catalog.length - generic.length,
    pending: generic.length - measured.length,
  };
}
