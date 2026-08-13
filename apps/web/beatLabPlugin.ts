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
  if (parsed.version !== 1) return bad(400, 'Unsupported `version` — expected 1.');
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
