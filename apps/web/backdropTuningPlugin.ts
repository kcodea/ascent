import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * THE BACKGROUND TUNER's Save (owner 2026-10-29: "lets make a standalone background tuner. i dont want it in the scale
 * and layout"). DEV-ONLY middleware: POST /__backdrops/tuning writes ONE board backdrop's tune (zoom, position, tile
 * size, darkness, blur, tint, board shadow) into the git-tracked `packages/ui/src/backdrop-tuning.json`, which
 * `backdrop.ts` imports and lays over its presets, so a saved backdrop ships once the file is committed.
 *
 * `apply: 'serve'`, never part of a production build. Mirrors `plateTuningPlugin.ts`: the whole validation surface is
 * ONE pure function (`planBackdropTuningWrite`), unit-tested without a server or fs. The destination file is FIXED by
 * the plugin; the backdrop id is checked against a strict pattern before it reaches the file.
 */

/** The tuner's number knobs, and the range each may take (the tuner's own slider ranges). */
export const BACKDROP_TUNING_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  zoom: [1, 3],
  panX: [-100, 100],
  panY: [-100, 100],
  size: [100, 3000],
  dark: [0, 1],
  blur: [0, 40],
  tintAmount: [0, 1],
  shadow: [0, 1],
  shadowX: [-120, 120],
  shadowY: [-120, 120],
  shadeDark: [0, 1],
  shadeSoft: [0, 100],
  shadeSize: [0, 4000],
  shadeX: [-2000, 2000],
  shadeY: [-2000, 2000],
  powerShadeSize: [0, 4000],
  powerShadeX: [-2000, 2000],
  powerShadeY: [-2000, 2000],
  oppShadeSize: [0, 4000],
  oppShadeX: [-2000, 2000],
  oppShadeY: [-2000, 2000],
};
const ID_RE = /^[a-z][a-zA-Z0-9]{0,40}$/;
const HEX_RE = /^#[0-9a-f]{6}$/i;

export interface BackdropTuningPlan {
  status: number;
  error?: string;
  /** The new file contents. */
  data?: string;
}
const bad = (status: number, error: string): BackdropTuningPlan => ({ status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a save and fold it into the current file, as a pure function. The body is `{ id, values }`; `values` must
 * carry every knob plus `tint` (the tuner sends the backdrop's whole tune, so the file never holds a half-tuned one).
 * Rejects a bad id, an unknown or missing knob, a value out of range or not finite, and a tint that is not #rrggbb.
 */
export function planBackdropTuningWrite(body: unknown, current: string): BackdropTuningPlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { id, values } = body;
  if (typeof id !== 'string' || !ID_RE.test(id)) return bad(400, '`id` must be a backdrop id like castle or runicSlate.');
  if (!isRecord(values)) return bad(400, '`values` must be an object.');
  for (const key of Object.keys(values)) if (!(key in BACKDROP_TUNING_RANGES) && key !== 'tint') return bad(400, `'${key}' is not a backdrop knob.`);
  const clean: Record<string, number | string> = {};
  for (const [key, [min, max]] of Object.entries(BACKDROP_TUNING_RANGES)) {
    const v = values[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return bad(400, `'${key}' must be a finite number.`);
    if (v < min || v > max) return bad(400, `'${key}' must be between ${min} and ${max}.`);
    clean[key] = Math.round(v * 10000) / 10000;
  }
  if (typeof values.tint !== 'string' || !HEX_RE.test(values.tint)) return bad(400, '`tint` must be a colour like #472a00.');
  clean.tint = values.tint.toLowerCase();

  let parsed: unknown;
  try { parsed = JSON.parse(current); } catch { return bad(500, 'backdrop-tuning.json is not valid JSON.'); }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.backdrops)) return bad(500, 'backdrop-tuning.json has an unexpected shape.');
  // Sorted by backdrop id, so the committed file diffs cleanly.
  const backdrops = { ...parsed.backdrops, [id]: clean };
  const sorted = Object.fromEntries(Object.keys(backdrops).sort().map((k) => [k, backdrops[k]]));
  return { status: 200, data: `${JSON.stringify({ version: 1, backdrops: sorted }, null, 2)}\n` };
}

const MAX_BODY_BYTES = 8 * 1024;
/** Resolved when the dev server starts, not at import: the UI tests import this file's ranges in a browser-like env. */
const tuningFile = (): string => fileURLToPath(new URL('../../packages/ui/src/backdrop-tuning.json', import.meta.url));

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

export function backdropTuningPlugin(): Plugin {
  return {
    name: 'ascent:backdrop-tuning',
    apply: 'serve', // the one line that makes this dev-only
    configureServer(server) {
      const TUNING_FILE = tuningFile();
      server.middlewares.use('/__backdrops/tuning', (req, res) => void (async () => {
        if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only.' }); return; }
        let body: unknown;
        try { body = JSON.parse(await readBody(req)); } catch (e) { send(res, 400, { ok: false, error: (e as Error).message || 'Unreadable body.' }); return; }
        let current: string;
        try { current = await readFile(TUNING_FILE, 'utf8'); } catch (e) { send(res, 500, { ok: false, error: `Could not read: ${(e as Error).message}` }); return; }
        const plan = planBackdropTuningWrite(body, current);
        if (plan.status !== 200 || plan.data === undefined) { send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' }); return; }
        try { await writeFile(TUNING_FILE, plan.data); } catch (e) { send(res, 500, { ok: false, error: `Could not write: ${(e as Error).message}` }); return; }
        // backdrop-tuning.json is a STATIC import of backdrop.ts, so the write invalidates through the import graph and
        // the page reloads with the saved values.
        send(res, 200, { ok: true });
      })());
    },
  };
}

export default backdropTuningPlugin;
