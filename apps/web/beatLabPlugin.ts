import { writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * BEAT SYSTEM PR 8b — DEV-ONLY middleware that lets the Beat Lab commit its timing overrides to a real,
 * git-tracked file (`packages/ui/src/beatLab/beat-defaults.json`). That is what makes a tuned beat DURABLE:
 * it survives a reload, ships to the other dev, and becomes the shipped baseline everywhere `resolveBeatTiming`
 * reads (see beatTiming.ts's `SHIPPED_OVERRIDES`).
 *
 * `apply: 'serve'` — never part of a production build. Mirrors `fxDefsPlugin.ts`: the whole validation surface
 * is ONE pure function (`planBeatDefaultsWrite`) unit-tested without a server or fs; the middleware is a thin
 * shell (read body → plan → writeFile). The destination is FIXED by the plugin, never derived from the
 * request, so there's no path-traversal question — only shape, size, and value safety.
 */

/** A def is small JSON — a sparse override map. 256 KB is a generous ceiling. */
export const MAX_DEFAULTS_BYTES = 256 * 1024;

/** Rejected at every key position (prototype-pollution guard), matching the reader side. */
const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** The only fields a timing patch may carry. A typo'd key would be written and silently do nothing forever. */
const TIMING_FIELDS: readonly string[] = ['windupMs', 'holdMs', 'recoveryMs'];

/** CHOREOGRAPHER PR 10 — the v2 authored fields (delivery/completion semantics + anchors + repeats). */
const V2_FIELDS: readonly string[] = [
  'mode', 'anchor', 'deliveryOffsetMs', 'completionOffsetMs', 'recoveryMs', 'targetStaggerMs',
  'repeatMode', 'repeatGapMs', 'deliveryMarkers',
];
const V2_MODES: readonly string[] = ['ownBeat', 'reactInsideParent', 'simultaneous', 'silent'];
/** The internal policy vocabulary a pre-v2 file may still carry; `readBeatConfig` maps these onto modes. */
const LEGACY_POLICY_WORDS: readonly string[] = ['ownBeat', 'foldedCue', 'passive', 'intentionallySilent'];
const V2_ANCHORS: readonly string[] = [
  'phaseStart', 'afterPreviousBeat', 'withParentActivation', 'atParentDelivery',
  'atAttackContact', 'afterDeathCompletes', 'whenSummonAppears', 'afterAllStartOfCombat',
];
const REPEAT_MODES: readonly string[] = ['full', 'compressed', 'simultaneous', 'counter'];

/** Validate one v2 authored patch. Returns an error string, or null when the patch is sound. */
function checkV2Patch(key: string, patch: unknown): string | null {
  if (!isRecord(patch)) return `'${key}' must be an object.`;
  for (const [f, v] of Object.entries(patch)) {
    if (!V2_FIELDS.includes(f)) return `'${key}.${f}' is not an authored beat field.`;
    if (f === 'mode') {
      if (!V2_MODES.includes(v as string)) return `'${key}.mode' must be one of ${V2_MODES.join(', ')}.`;
    } else if (f === 'anchor') {
      if (!isRecord(v)) return `'${key}.anchor' must be an object.`;
      if (!V2_ANCHORS.includes(v.kind as string)) return `'${key}.anchor.kind' is not a known anchor.`;
      if (v.offsetMs !== undefined && (typeof v.offsetMs !== 'number' || !Number.isFinite(v.offsetMs))) {
        return `'${key}.anchor.offsetMs' must be a finite number.`;
      }
    } else if (f === 'repeatMode') {
      if (!REPEAT_MODES.includes(v as string)) return `'${key}.repeatMode' is not a known repeat mode.`;
    } else if (f === 'deliveryMarkers') {
      if (!isRecord(v)) return `'${key}.deliveryMarkers' must be an object.`;
      for (const [m, ms] of Object.entries(v)) {
        if (typeof ms !== 'number' || !Number.isFinite(ms) || ms < 0) return `'${key}.deliveryMarkers.${m}' must be a non-negative number.`;
      }
    } else if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) {
      return `'${key}.${f}' must be a non-negative number.`;
    }
  }
  // The one ordering invariant the compiler would otherwise have to clamp at runtime (§9.3).
  const d = (patch as Record<string, unknown>).deliveryOffsetMs;
  const c = (patch as Record<string, unknown>).completionOffsetMs;
  if (typeof d === 'number' && typeof c === 'number' && c < d) {
    return `'${key}' completion (${c}ms) is before delivery (${d}ms).`;
  }
  return null;
}

/** Override keys the Beat Lab produces (the specificity chain). Validated so a malformed key can't land. */
const KEY_RE = /^(source:(minion|rune|quest|spell|hero|system):[a-zA-Z0-9_-]+:[a-zA-Z0-9_-]+|family:[a-zA-Z0-9_-]+|trigger:[a-zA-Z0-9_-]+|policy:(ownBeat|foldedCue|passive|intentionallySilent)|global)$/;

export interface WritePlan {
  status: number;
  error?: string;
  file?: string;
  data?: string;
}
const bad = (status: number, error: string): WritePlan => ({ status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a beat-defaults commit as a pure function. Rejects: non-object body; missing/ill-typed `json`;
 * oversize; bad `version`; a `timings` that isn't an object; an unsafe or malformed override key; a patch that
 * isn't an object; an unknown field; a non-finite or negative timing value.
 */
export function planBeatDefaultsWrite(body: unknown, file: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { json } = body;
  if (typeof json !== 'string') return bad(400, 'Missing `json`.');
  if (Buffer.byteLength(json, 'utf8') > MAX_DEFAULTS_BYTES) return bad(413, `Payload larger than ${MAX_DEFAULTS_BYTES} bytes.`);
  let parsed: unknown;
  try { parsed = JSON.parse(json); } catch { return bad(400, '`json` is not valid JSON.'); }
  if (!isRecord(parsed)) return bad(400, '`json` must be an object.');
  if (parsed.version !== 1 && parsed.version !== 2) return bad(400, 'Unsupported `version` — expected 1 or 2.');

  // ── v2: templates + sparse overrides, using delivery/completion semantics ──
  if (parsed.version === 2) {
    for (const section of ['templates', 'overrides'] as const) {
      const bag = parsed[section];
      if (bag === undefined) continue;
      if (!isRecord(bag)) return bad(400, `\`${section}\` must be an object.`);
      for (const [key, patch] of Object.entries(bag)) {
        if (UNSAFE_KEYS.includes(key)) return bad(400, `'${key}' is an unsafe key and can never be loaded.`);
        if (!KEY_RE.test(key)) return bad(400, `'${key}' is not a valid timing key.`);
        const err = checkV2Patch(`${section}.${key}`, patch);
        if (err) return bad(400, err);
      }
    }
    if (parsed.policies !== undefined) {
      if (!isRecord(parsed.policies)) return bad(400, '`policies` must be an object.');
      for (const [key, mode] of Object.entries(parsed.policies)) {
        if (UNSAFE_KEYS.includes(key)) return bad(400, `'${key}' is an unsafe key and can never be loaded.`);
        if (!KEY_RE.test(key)) return bad(400, `'${key}' is not a valid policy key.`);
        // Accept BOTH vocabularies: the tool may write the user-facing mode, and an older file may carry the
        // internal policy word. `readBeatConfig` maps either onto a mode, so refusing one would reject a file
        // the reader handles perfectly well.
        if (!V2_MODES.includes(mode as string) && !LEGACY_POLICY_WORDS.includes(mode as string)) {
          return bad(400, `'${key}' mode must be one of ${V2_MODES.join(', ')}.`);
        }
      }
    }
    return { status: 200, file, data: `${JSON.stringify(parsed, null, 2)}
` };
  }

  if (!isRecord(parsed.timings)) return bad(400, '`timings` must be an object.');

  for (const [key, patch] of Object.entries(parsed.timings)) {
    if (UNSAFE_KEYS.includes(key)) return bad(400, `'${key}' is an unsafe key and can never be loaded.`);
    if (!KEY_RE.test(key)) return bad(400, `'${key}' is not a valid timing key.`);
    if (!isRecord(patch)) return bad(400, `'${key}' must be an object.`);
    for (const [f, v] of Object.entries(patch)) {
      if (!TIMING_FIELDS.includes(f)) return bad(400, `'${key}.${f}' is not a timing field.`);
      if (typeof v !== 'number' || !Number.isFinite(v) || v < 0) return bad(400, `'${key}.${f}' must be a non-negative number.`);
    }
  }
  // The policy overrides (the folded↔own toggle) — optional; same key grammar, values in the policy enum.
  if (parsed.policies !== undefined) {
    if (!isRecord(parsed.policies)) return bad(400, '`policies` must be an object.');
    for (const [key, pol] of Object.entries(parsed.policies)) {
      if (UNSAFE_KEYS.includes(key)) return bad(400, `'${key}' is an unsafe key and can never be loaded.`);
      if (!KEY_RE.test(key)) return bad(400, `'${key}' is not a valid policy key.`);
      if (!POLICY_VALUES.includes(pol as string)) return bad(400, `'${key}' policy must be one of ${POLICY_VALUES.join(', ')}.`);
    }
  }
  // Re-serialized (not echoed) so the committed file is always well-formed, stably formatted JSON.
  return { status: 200, file, data: `${JSON.stringify(parsed, null, 2)}\n` };
}

const MAX_BODY_BYTES = MAX_DEFAULTS_BYTES + 4096;
const DEFAULT_FILE = fileURLToPath(new URL('../../packages/ui/src/beatLab/beat-defaults.json', import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(chunk);
    });
    req.on('end', () => resolve(Buffer.concat(chunks).toString('utf8')));
    req.on('error', reject);
  });
}
function send(res: ServerResponse, status: number, payload: unknown): void {
  res.statusCode = status;
  res.setHeader('Content-Type', 'application/json');
  res.end(JSON.stringify(payload));
}

export interface BeatLabPluginOptions {
  /** Overridable for tests. Defaults to `packages/ui/src/beatLab/beat-defaults.json`. */
  defaultsFile?: string;
}

export function beatLabPlugin(options: BeatLabPluginOptions = {}): Plugin {
  const defaultsFile = path.resolve(options.defaultsFile ?? DEFAULT_FILE);
  // beat-defaults.json → beatLab → src → ui → packages → repo root (5 hops), so the reported path reads
  // "packages/ui/src/beatLab/beat-defaults.json".
  const repoRoot = path.resolve(defaultsFile, '..', '..', '..', '..', '..');
  return {
    name: 'ascent:beat-lab',
    apply: 'serve', // the one line that makes this dev-only
    configureServer(server) {
      server.middlewares.use('/__beat-lab/defaults', (req, res) => void (async () => {
        if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only.' }); return; }
        let bodyObj: unknown;
        try { bodyObj = JSON.parse(await readBody(req)); } catch (e) { send(res, 400, { ok: false, error: (e as Error).message || 'Unreadable body.' }); return; }
        const plan = planBeatDefaultsWrite(bodyObj, defaultsFile);
        if (plan.status !== 200 || !plan.file || plan.data === undefined) { send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' }); return; }
        try { await writeFile(plan.file, plan.data); } catch (e) { send(res, 500, { ok: false, error: `Could not write: ${(e as Error).message}` }); return; }
        // beat-defaults.json is a STATIC import, so the write invalidates through the import graph and HMR
        // reloads — no watcher needed (unlike the FX defs glob).
        send(res, 200, { ok: true, path: path.relative(repoRoot, plan.file).split(path.sep).join('/') });
      })());
    },
  };
}

export default beatLabPlugin;
