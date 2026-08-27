/**
 * SCENE BUILDER ↔ QA SCENARIO bridge (Docbot handoff §4.5, PR 2) — the PURE half.
 *
 * Everything here is plain data-in/data-out so it unit-tests without a browser: build a `QaScenarioV1` from
 * the live sandbox run, name its fixture file, and print its reproduction command. The DOM plumbing (download
 * anchor, clipboard, file picker, the dev-server save POST) lives in `SceneBuilder.tsx`; the store's
 * `loadQaScenario` (import → validated sandbox hydration) lives in `store.ts` next to `loadBugScenario`, the
 * earlier bug-scenario door it deliberately mirrors.
 *
 * The envelope itself — schema, validation, runner — is `@game/sim`'s `qaScenario.ts` (PR 1, the keystone).
 * This module only ASSEMBLES envelopes; it never re-validates or re-implements them (§3.3: one format).
 */
import {
  serializeForScenario, type BoardSnapshot, type QaScenarioV1, type RunState,
} from '@game/sim';
import { activeSet } from '@game/content';

/** Where checked-in regression fixtures live — the CLI (`qa-scenario-run.ts`) resolves bare ids here, and the
 *  dev-server save endpoint (`qaScenarioPlugin.ts`) writes here. One directory, stated once. */
export const QA_SCENARIO_FIXTURE_DIR = 'packages/sim/src/docbot/scenarios';

/** The id is the fixture-filename stem, so it obeys filename discipline: lowercase slug, no path characters.
 *  Kept in sync with the save endpoint's server-side check (`qaScenarioPlugin.ts` re-validates — the server
 *  never trusts the client's spelling of a filename). */
export const QA_SCENARIO_ID_RE = /^[a-z0-9][a-z0-9_-]{0,80}$/;

/** Default id for an export: `sb-<hero>-w<wave>-<seed>` — stable for one authored setup (re-exporting the
 *  same board overwrites the same file rather than littering), distinct across heroes/waves/seeds. */
export const defaultScenarioId = (run: RunState): string =>
  `sb-${run.heroId}-w${run.wave}-${run.seed}`.toLowerCase().replace(/[^a-z0-9_-]/g, '-');

export const scenarioFileName = (id: string): string => `${id}.json`;

/** The deterministic reproduction command (§4.4). A bare id resolves in the checked-in fixture directory, so
 *  the command is runnable verbatim once the scenario is saved as a fixture (or its file is placed there). */
export const reproCommandFor = (id: string): string => `npm run docbot:scenario -- ${id}`;

/** Unique, order-stable content ids the authored setup is ABOUT: board + hand (the cards under test), not the
 *  shop (incidental stock). These feed finding-attribution; every one must resolve, which they do by
 *  construction — the rig only deals ids out of `CARD_INDEX`. */
export const exportContentIds = (run: RunState): string[] =>
  [...new Set([...run.board, ...run.hand].map((c) => c.cardId))];

export interface BuildQaScenarioOptions {
  id?: string;
  title?: string;
  notes?: string;
  /** Injected clock (ISO string) so tests are deterministic; the component passes the real time. */
  createdAt?: string;
  appVersion?: string;
}

/**
 * Serialize the CURRENT live run into a `QaScenarioV1` (source `scene-builder`).
 *
 * Mode is derived from what was authored (a judgement call, stated): a recruit-phase run with a pinned
 * served opponent for THIS wave exports as `mode: 'combat'` carrying that exact `BoardSnapshot` — the point
 * of authoring an enemy board is the fight, and combat mode is what makes the headless runner resolve it
 * through the real `faceOmen`. Anything else exports as `mode: 'recruit'` with no action — a pure
 * state-assertion scenario the author adds an action/expectations to by hand. Either way `state` embeds the
 * FULL serialized run (servedBoards included), so re-import recreates the visible setup verbatim (§4.6).
 */
export function buildQaScenario(run: RunState, opts: BuildQaScenarioOptions = {}): QaScenarioV1 {
  const pinned: BoardSnapshot | null | undefined = run.servedBoards?.[run.wave];
  const combatReady = run.phase === 'recruit' && pinned != null;
  const id = opts.id ?? defaultScenarioId(run);
  return {
    schemaVersion: 1,
    id,
    title: opts.title ?? `Scene Builder export — ${run.heroId}, wave ${run.wave}`,
    source: 'scene-builder',
    seed: run.seed,
    setId: run.setId ?? activeSet().id,
    mode: combatReady ? 'combat' : 'recruit',
    state: serializeForScenario(run),
    ...(combatReady ? { combat: { opponent: pinned } } : {}),
    metadata: {
      ...(opts.createdAt !== undefined ? { createdAt: opts.createdAt } : {}),
      ...(opts.appVersion !== undefined ? { appVersion: opts.appVersion } : {}),
      ...(opts.notes !== undefined ? { notes: opts.notes } : {}),
    },
    contentIds: exportContentIds(run),
  };
}

/** The exact bytes the export downloads / the save endpoint writes: pretty-printed + trailing newline, the
 *  same shape as the checked-in fixtures so a saved file diffs cleanly in review. */
export const scenarioFileText = (scenario: QaScenarioV1): string => `${JSON.stringify(scenario, null, 2)}\n`;
