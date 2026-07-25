import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * DEV-ONLY middleware that lets the FX workbench write a def (and its imported art) to real files under
 * `packages/ui/src/fx/defs/`. That is the whole point of "durable defs": the artifact is git-tracked, so a
 * tuned effect survives a reload, can be shared with the other developer, and can eventually be referenced
 * by id from the game.
 *
 * `apply: 'serve'` — this plugin is NEVER part of a production build. Nothing in the shipped bundle can
 * write a file, and `npm run build:web` never even instantiates this module's middleware.
 *
 * Even so, it writes to disk on an unauthenticated local HTTP request, so every decision it makes is in ONE
 * pure function (`planWrite`) that is unit-tested without a server and without touching the filesystem:
 * slug grammar, traversal containment, size caps, and the PNG data-URL check all live there. The middleware
 * is a thin shell: read body → `planWrite` → `mkdir -p` + `writeFile`.
 */

/** Same grammar as `defStore.ts`'s `SLUG_RE`. Duplicated ON PURPOSE: this copy is the security boundary
 *  (server side, never trusts the client), the other is a pre-flight check. They must stay in lockstep. */
export const SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;

/** A def is JSON text — a few hundred lines at the very worst. */
export const MAX_DEF_BYTES = 256 * 1024;

/** Art is a normalized 128px PNG (tens of KB). 4 MB is a generous ceiling that still bounds a bad request. */
export const MAX_ART_BYTES = 4 * 1024 * 1024;

export const ART_DATA_URL_PREFIX = 'data:image/png;base64,';

/** PNG's 8-byte file signature. Belt-and-braces on top of the data-URL prefix: the prefix is a claim, this
 *  is the file actually being a PNG. */
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export type WriteKind = 'def' | 'art';

/** What `planWrite` decided. `status` 200 ⇒ `file` + `data` are present and the caller may write; anything
 *  else ⇒ `error` is present and nothing is written. */
export interface WritePlan {
  status: number;
  error?: string;
  /** Absolute, resolved, verified-inside-the-defs-directory path. */
  file?: string;
  data?: string | Buffer;
}

function bad(status: number, error: string): WritePlan {
  return { status, error };
}

function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}

/**
 * Is `target` contained by `root`? Exported so the traversal guard is testable directly — the slug regex
 * already makes `..`, `/`, `\` and absolute paths unreachable, so this second gate would otherwise have no
 * way to be exercised, and an untested guard is not a guard.
 */
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

/**
 * The entire validation surface, as a pure function. No fs, no server, no globals.
 *
 * Rejects, in order: a non-object body; a missing/ill-typed field; a slug outside `SLUG_RE` (which is what
 * kills `../`, `/abs/path`, `C:\x`, `.`, `` and anything with a separator in it); an oversized payload; art
 * that isn't a PNG data URL; and — after `path.resolve` — any target that somehow escaped the defs
 * directory.
 */
export function planWrite(kind: WriteKind, body: unknown, defsRoot: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const root = path.resolve(defsRoot);

  if (kind === 'def') {
    const { id, json } = body;
    if (typeof id !== 'string' || id === '') return bad(400, 'Missing `id`.');
    if (!SLUG_RE.test(id)) return bad(400, `'${id}' is not a valid def id (^[a-z0-9][a-z0-9-]{0,63}$).`);
    if (typeof json !== 'string') return bad(400, 'Missing `json`.');
    if (Buffer.byteLength(json, 'utf8') > MAX_DEF_BYTES) {
      return bad(413, `Def is larger than ${MAX_DEF_BYTES} bytes.`);
    }
    let parsed: unknown;
    try {
      parsed = JSON.parse(json);
    } catch {
      return bad(400, '`json` is not valid JSON.');
    }
    if (!isRecord(parsed)) return bad(400, '`json` must describe a def object.');
    const file = path.resolve(root, `${id}.json`);
    if (!isInside(root, file)) return bad(400, 'Refusing to write outside the defs directory.');
    // Re-serialized (not echoed) so what lands on disk is always well-formed, stably formatted JSON that
    // reviews cleanly in a diff.
    return { status: 200, file, data: `${JSON.stringify(parsed, null, 2)}\n` };
  }

  const { slug, dataUrl } = body;
  if (typeof slug !== 'string' || slug === '') return bad(400, 'Missing `slug`.');
  if (!SLUG_RE.test(slug)) return bad(400, `'${slug}' is not a valid art slug (^[a-z0-9][a-z0-9-]{0,63}$).`);
  if (typeof dataUrl !== 'string') return bad(400, 'Missing `dataUrl`.');
  if (!dataUrl.startsWith(ART_DATA_URL_PREFIX)) return bad(400, 'Art must be a `data:image/png;base64,` URL.');
  // Cheap length gate BEFORE decoding, so an absurd payload never gets allocated twice. base64 is 4/3 of the
  // decoded size, so this can only reject things the byte check would reject anyway.
  if (dataUrl.length > MAX_ART_BYTES * 2) return bad(413, `Art is larger than ${MAX_ART_BYTES} bytes.`);
  const buf = Buffer.from(dataUrl.slice(ART_DATA_URL_PREFIX.length), 'base64');
  if (buf.byteLength === 0) return bad(400, 'Art data URL is empty.');
  if (buf.byteLength > MAX_ART_BYTES) return bad(413, `Art is larger than ${MAX_ART_BYTES} bytes.`);
  if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return bad(400, 'Art is not a PNG.');
  const file = path.resolve(root, 'art', `${slug}.png`);
  if (!isInside(root, file)) return bad(400, 'Refusing to write outside the defs directory.');
  return { status: 200, file, data: buf };
}

// ─── the plugin ───────────────────────────────────────────────────────────────────────────────────────

/** Hard ceiling on a request body, independent of `planWrite`: the socket is torn down past this so a
 *  runaway upload can't be buffered in the first place. */
const MAX_BODY_BYTES = MAX_ART_BYTES * 2 + 4096;

const DEFAULT_DEFS_ROOT = fileURLToPath(new URL('../../packages/ui/src/fx/defs', import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (chunk: Buffer) => {
      size += chunk.length;
      if (size > MAX_BODY_BYTES) {
        reject(new Error('Request body is too large.'));
        req.destroy();
        return;
      }
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

export interface FxDefsPluginOptions {
  /** Where defs are written. Defaults to `packages/ui/src/fx/defs` relative to this file. */
  defsRoot?: string;
}

export function fxDefsPlugin(options: FxDefsPluginOptions = {}): Plugin {
  const defsRoot = path.resolve(options.defsRoot ?? DEFAULT_DEFS_ROOT);
  // Only used to make the reported path readable ("packages/ui/src/fx/defs/x.json"), never to write.
  const repoRoot = path.resolve(defsRoot, '..', '..', '..', '..', '..');

  const handle = (kind: WriteKind) => async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    if (req.method !== 'POST') {
      send(res, 405, { ok: false, error: 'POST only.' });
      return;
    }
    let body: unknown;
    try {
      body = JSON.parse(await readBody(req));
    } catch (e) {
      send(res, 400, { ok: false, error: (e as Error).message || 'Unreadable request body.' });
      return;
    }
    const plan = planWrite(kind, body, defsRoot);
    if (plan.status !== 200 || !plan.file || plan.data === undefined) {
      send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' });
      return;
    }
    try {
      await mkdir(path.dirname(plan.file), { recursive: true });
      await writeFile(plan.file, plan.data);
    } catch (e) {
      send(res, 500, { ok: false, error: `Could not write the file: ${(e as Error).message}` });
      return;
    }
    send(res, 200, { ok: true, path: path.relative(repoRoot, plan.file).split(path.sep).join('/') });
  };

  return {
    name: 'ascent:fx-defs',
    // The one line that makes this dev-only. A production build never runs it.
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fx/def', (req, res) => void handle('def')(req, res));
      server.middlewares.use('/__fx/art', (req, res) => void handle('art')(req, res));
    },
  };
}

export default fxDefsPlugin;
