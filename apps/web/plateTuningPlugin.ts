import { execFile } from 'node:child_process';
import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * THE CARD PLATE EDITOR's Save (owner 2026-10-18: "create a tuner that would allow me to select each Card Plate and
 * individually edit the card plates frame and interior size and positioning"; "save then"). DEV-ONLY middleware:
 * POST /__plates/tuning writes ONE plate's frame + interior numbers into the git-tracked
 * `packages/ui/src/cardPlate/plate-tuning.json`, which `cardPlateLook.ts` imports and lays over its SETTINGS, so a
 * saved plate ships once the file is committed. Then it rebuilds that plate's Collection image
 * (`scripts/build-card-plate.mjs`) so the tile matches.
 *
 * `apply: 'serve'` — never part of a production build. Mirrors `beatLabPlugin.ts`: the whole validation surface is
 * ONE pure function (`planPlateTuningWrite`), unit-tested without a server or fs. The destination file is FIXED by
 * the plugin; the plate id and interior name are checked against strict patterns before they reach a file or argv.
 */

/** The editor's knobs, and the range each may take (wide enough for any real plate, narrow enough to catch a typo). */
export const TUNING_RANGES: Readonly<Record<string, readonly [number, number]>> = {
  artScale: [0.5, 2],
  frameX: [-0.5, 0.5],
  frameY: [-0.5, 0.5],
  interiorSx: [0.5, 2],
  interiorSy: [0.5, 2],
  interiorX: [-0.5, 0.5],
  interiorY: [-0.5, 0.5],
};
const ID_RE = /^plate_[a-z0-9_]+$/;
const INTERIOR_RE = /^[a-z]+$/;

export interface TuningPlan {
  status: number;
  error?: string;
  /** The new file contents. */
  data?: string;
  /** The build script's args for the Collection image (layered plates only). */
  buildArgs?: string[];
}
const bad = (status: number, error: string): TuningPlan => ({ status, error });
const isRecord = (v: unknown): v is Record<string, unknown> => v !== null && typeof v === 'object' && !Array.isArray(v);

/**
 * Validate a save and fold it into the current file, as a pure function. The body is
 * `{ id, values, layered, interior }`; `values` must carry every knob (the editor sends the plate's whole state, so
 * the file never holds a half-tuned plate). Rejects a bad id, an unknown or missing knob, a value out of range or
 * not finite, and a bad interior name on a layered plate.
 */
export function planPlateTuningWrite(body: unknown, current: string): TuningPlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { id, values, layered, interior } = body;
  if (typeof id !== 'string' || !ID_RE.test(id)) return bad(400, '`id` must look like plate_<name>.');
  if (!isRecord(values)) return bad(400, '`values` must be an object.');
  for (const key of Object.keys(values)) if (!(key in TUNING_RANGES)) return bad(400, `'${key}' is not a plate knob.`);
  const clean: Record<string, number> = {};
  for (const [key, [min, max]] of Object.entries(TUNING_RANGES)) {
    const v = values[key];
    if (typeof v !== 'number' || !Number.isFinite(v)) return bad(400, `'${key}' must be a finite number.`);
    if (v < min || v > max) return bad(400, `'${key}' must be between ${min} and ${max}.`);
    clean[key] = Math.round(v * 10000) / 10000;
  }
  if (layered !== undefined && typeof layered !== 'boolean') return bad(400, '`layered` must be a boolean.');
  if (layered && (typeof interior !== 'string' || !INTERIOR_RE.test(interior))) return bad(400, '`interior` must be a lowercase interior name.');

  let parsed: unknown;
  try { parsed = JSON.parse(current); } catch { return bad(500, 'plate-tuning.json is not valid JSON.'); }
  if (!isRecord(parsed) || parsed.version !== 1 || !isRecord(parsed.plates)) return bad(500, 'plate-tuning.json has an unexpected shape.');
  // Sorted by plate id, so the committed file diffs cleanly.
  const plates = { ...parsed.plates, [id]: clean };
  const sorted = Object.fromEntries(Object.keys(plates).sort().map((k) => [k, plates[k]]));
  const data = `${JSON.stringify({ version: 1, plates: sorted }, null, 2)}\n`;

  const buildArgs = layered
    ? ['--id', id, '--interior', interior as string,
      '--interior-sx', String(clean.interiorSx), '--interior-sy', String(clean.interiorSy),
      '--interior-x', String(clean.interiorX), '--interior-y', String(clean.interiorY),
      '--art-scale', String(clean.artScale)]
    : undefined;
  return { status: 200, data, buildArgs };
}

const MAX_BODY_BYTES = 16 * 1024;
const TUNING_FILE = fileURLToPath(new URL('../../packages/ui/src/cardPlate/plate-tuning.json', import.meta.url));
const BUILD_SCRIPT = fileURLToPath(new URL('../../scripts/build-card-plate.mjs', import.meta.url));

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
function runBuild(args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    execFile(process.execPath, [BUILD_SCRIPT, ...args], { cwd: path.dirname(path.dirname(BUILD_SCRIPT)) }, (err, stdout, stderr) => {
      if (err) reject(new Error(stderr || err.message)); else resolve(stdout.trim());
    });
  });
}

export function plateTuningPlugin(): Plugin {
  return {
    name: 'ascent:plate-tuning',
    apply: 'serve', // the one line that makes this dev-only
    configureServer(server) {
      server.middlewares.use('/__plates/tuning', (req, res) => void (async () => {
        if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only.' }); return; }
        let body: unknown;
        try { body = JSON.parse(await readBody(req)); } catch (e) { send(res, 400, { ok: false, error: (e as Error).message || 'Unreadable body.' }); return; }
        let current: string;
        try { current = await readFile(TUNING_FILE, 'utf8'); } catch (e) { send(res, 500, { ok: false, error: `Could not read: ${(e as Error).message}` }); return; }
        const plan = planPlateTuningWrite(body, current);
        if (plan.status !== 200 || plan.data === undefined) { send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' }); return; }
        // The Collection image first: if it fails, nothing is written and the save can simply be retried.
        let built = 'single-image plate: its picture IS the plate, nothing to rebuild';
        if (plan.buildArgs) {
          try { built = await runBuild(plan.buildArgs); } catch (e) { send(res, 500, { ok: false, error: `Collection image: ${(e as Error).message}` }); return; }
        }
        try { await writeFile(TUNING_FILE, plan.data); } catch (e) { send(res, 500, { ok: false, error: `Could not write: ${(e as Error).message}` }); return; }
        // plate-tuning.json is a STATIC import of cardPlateLook.ts, so the write invalidates through the import graph
        // and the page reloads with the saved values.
        send(res, 200, { ok: true, built });
      })());
    },
  };
}

export default plateTuningPlugin;
