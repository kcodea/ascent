/**
 * BEAT CHOREOGRAPHER PR 10 — the authored config, loaded into LIVE playback (blueprint §9, §19).
 *
 * This module is the link that makes tuning real. The compiler has always accepted a config; nothing was
 * passing one, so committed timings were authored into a file that live playback never read. A designer
 * could tune a beat, commit it, reload, and watch the game ignore it — which is indistinguishable from the
 * tool being broken, and is the last piece of the "my edits do nothing" complaint.
 *
 * Two properties the rest of the system depends on:
 *
 *   1. **One config object for both consumers.** The live player and the tool call `shippedBeatConfig()`, so
 *      a preview cannot diverge from the game by reading different numbers.
 *   2. **v1 files still work.** The shipped file is v1 (`windup`/`hold`/`recovery`); v2 is
 *      delivery/completion/recovery + modes. Migration happens ON READ and is never written back — the
 *      blueprint is explicit that the file must not be silently rewritten on load (§9.4).
 */
import beatDefaults from '../beatLab/beat-defaults.json';
import { EMPTY_CONFIG, migrateV1Patch, type BeatConfigSnapshot } from './resolveTiming';
import type { AuthoredBeatConfig, PresentationMode } from './timelineTypes';

/** The v1 shape the shipped file uses today. */
interface V1File {
  version: 1;
  timings?: Record<string, { windupMs?: number; holdMs?: number; recoveryMs?: number }>;
  policies?: Record<string, string>;
}
/** The v2 shape (templates + sparse overrides + reclassifications). */
interface V2File {
  version: 2;
  templates?: Record<string, AuthoredBeatConfig>;
  overrides?: Record<string, AuthoredBeatConfig>;
  policies?: Record<string, PresentationMode>;
  revision?: string;
}

/** Internal policy vocabulary (what a v1 file stores) → the four presentation modes. */
const MODE_BY_POLICY: Record<string, PresentationMode> = {
  ownBeat: 'ownBeat',
  foldedCue: 'reactInsideParent',
  passive: 'silent',
  intentionallySilent: 'silent',
  // v2 files already store modes; accept them unchanged so a mixed file cannot lose entries.
  reactInsideParent: 'reactInsideParent',
  simultaneous: 'simultaneous',
  silent: 'silent',
};

const isRecord = (v: unknown): v is Record<string, unknown> => !!v && typeof v === 'object' && !Array.isArray(v);

/**
 * Normalize whatever is on disk into a v2 snapshot. Never throws: a malformed file must not be able to break
 * End Turn, so anything unreadable degrades to the shipped defaults (and the compiler's own diagnostics
 * surface the consequences).
 */
export function readBeatConfig(raw: unknown): BeatConfigSnapshot {
  if (!isRecord(raw)) return EMPTY_CONFIG;

  if (raw.version === 2) {
    const f = raw as unknown as V2File;
    const policies: Record<string, PresentationMode> = {};
    for (const [k, v] of Object.entries(f.policies ?? {})) {
      const mode = MODE_BY_POLICY[v as string];
      if (mode) policies[k] = mode;
    }
    return {
      version: 2,
      templates: f.templates ?? {},
      overrides: f.overrides ?? {},
      policies,
      revision: f.revision ?? 'file:v2',
    };
  }

  if (raw.version === 1) {
    const f = raw as unknown as V1File;
    const overrides: Record<string, AuthoredBeatConfig> = {};
    for (const [key, patch] of Object.entries(f.timings ?? {})) {
      if (!isRecord(patch)) continue;
      overrides[key] = migrateV1Patch(patch);
    }
    const policies: Record<string, PresentationMode> = {};
    for (const [k, v] of Object.entries(f.policies ?? {})) {
      const mode = MODE_BY_POLICY[v as string];
      if (mode) policies[k] = mode;
    }
    return { version: 2, templates: {}, overrides, policies, revision: 'file:v1-migrated' };
  }

  return EMPTY_CONFIG;
}

let cached: BeatConfigSnapshot | null = null;

/**
 * The committed config, shared by live playback and the tool. Cached: the file is a static import, so it
 * cannot change without a module reload, and compiling runs on every End Turn.
 */
export function shippedBeatConfig(): BeatConfigSnapshot {
  cached ??= readBeatConfig(beatDefaults);
  return cached;
}

/** Test-only: drop the cache so a fixture can be read fresh. */
export function resetBeatConfigCache(): void {
  cached = null;
}
