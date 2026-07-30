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

// Duplicated ON PURPOSE across THREE sites that must stay in lockstep: here, `FAN_OUTS` in
// `packages/ui/src/choreo/bindings.ts` (the reader), and the `FxBinding['fanOut']` TypeScript union. `ui`
// is off-limits to import from `apps/web` (package-boundary rule in CLAUDE.md) and `FAN_OUTS` isn't on
// `bindings.ts`'s public entrypoint anyway, so a shared constant isn't available — this comment is the
// lockstep mechanism instead of a shared value.
const BINDING_FAN_OUTS: readonly string[] = ['primary', 'damaged', 'selfBuffed'];

/** Rejected at every key position, mirroring `bindings.ts`'s own `UNSAFE_KEYS` guard on the read side. A key
 *  the reader is guaranteed to drop must never earn a 200 here: the file would claim a binding the game can
 *  never play, and the only signal would be one dev-console line. */
const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];

/** One binding entry: `{ def, fanOut? }`. Returns an error string, or null when it is fine. */
function badBinding(v: unknown, where: string): string | null {
  if (!isRecord(v)) return `${where} is not an object.`;
  // The def id becomes a filename stem on disk, so it gets exactly the grammar the def endpoint enforces.
  if (typeof v.def !== 'string' || !SLUG_RE.test(v.def)) {
    return `${where}.def must match ${String(SLUG_RE)}.`;
  }
  if (v.fanOut !== undefined && (typeof v.fanOut !== 'string' || !BINDING_FAN_OUTS.includes(v.fanOut))) {
    return `${where}.fanOut must be one of ${BINDING_FAN_OUTS.join(', ')}.`;
  }
  return null;
}

/**
 * The validation surface for a bindings commit, as a pure function — same contract as `planWrite`: no fs, no
 * server, no globals.
 *
 * NOTE the surface here is SMALLER than `planWrite`'s, not larger. The destination path is fixed by the
 * plugin and never derived from the request, so the traversal question `planWrite` exists to answer simply
 * does not arise: the client supplies content only. What is left is shape, size, and the slug grammar on def
 * ids (which do become filenames, indirectly, when something later loads them).
 */
export function planBindingsWrite(body: unknown, file: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { json } = body;
  if (typeof json !== 'string') return bad(400, 'Missing `json`.');
  if (Buffer.byteLength(json, 'utf8') > MAX_DEF_BYTES) {
    return bad(413, `Bindings are larger than ${MAX_DEF_BYTES} bytes.`);
  }
  let parsed: unknown;
  try {
    parsed = JSON.parse(json);
  } catch {
    return bad(400, '`json` is not valid JSON.');
  }
  if (!isRecord(parsed)) return bad(400, '`json` must describe a bindings object.');
  if (parsed.version !== 1) return bad(400, 'Unsupported bindings `version` — expected 1.');
  if (!isRecord(parsed.kinds)) return bad(400, '`kinds` must be an object.');
  if (!isRecord(parsed.cards)) return bad(400, '`cards` must be an object.');

  for (const [kind, v] of Object.entries(parsed.kinds)) {
    if (UNSAFE_KEYS.includes(kind)) return bad(400, `kinds.${kind} is an unsafe key and can never be loaded.`);
    const err = badBinding(v, `kinds.${kind}`);
    if (err) return bad(400, err);
  }
  for (const [cardId, byKind] of Object.entries(parsed.cards)) {
    if (UNSAFE_KEYS.includes(cardId)) {
      return bad(400, `cards.${cardId} is an unsafe key and can never be loaded.`);
    }
    if (!isRecord(byKind)) return bad(400, `cards.${cardId} is not an object.`);
    for (const [kind, v] of Object.entries(byKind)) {
      if (UNSAFE_KEYS.includes(kind)) {
        return bad(400, `cards.${cardId}.${kind} is an unsafe key and can never be loaded.`);
      }
      const err = badBinding(v, `cards.${cardId}.${kind}`);
      if (err) return bad(400, err);
    }
  }
  // Re-serialized (not echoed) so what lands on disk is always well-formed, stably formatted JSON that
  // reviews cleanly in a diff.
  return { status: 200, file, data: `${JSON.stringify(parsed, null, 2)}\n` };
}

// ─── the plugin ───────────────────────────────────────────────────────────────────────────────────────

/** Hard ceiling on a request body, independent of `planWrite`: the socket is torn down past this so a
 *  runaway upload can't be buffered in the first place. */
const MAX_BODY_BYTES = MAX_ART_BYTES * 2 + 4096;

const DEFAULT_DEFS_ROOT = fileURLToPath(new URL('../../packages/ui/src/fx/defs', import.meta.url));

const DEFAULT_BINDINGS_FILE = fileURLToPath(
  new URL('../../packages/ui/src/choreo/bindings.json', import.meta.url),
);

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
  /** Where the FX binding table is committed. Defaults to `packages/ui/src/choreo/bindings.json`. */
  bindingsFile?: string;
}

export function fxDefsPlugin(options: FxDefsPluginOptions = {}): Plugin {
  const defsRoot = path.resolve(options.defsRoot ?? DEFAULT_DEFS_ROOT);
  const bindingsFile = path.resolve(options.bindingsFile ?? DEFAULT_BINDINGS_FILE);
  // Only used to make the reported path readable ("packages/ui/src/fx/defs/x.json"), never to write.
  const repoRoot = path.resolve(defsRoot, '..', '..', '..', '..', '..');

  /**
   * The shared shell for every write endpoint: read the body, hand it to whichever pure planner the route
   * closed over, and act on the resulting `WritePlan`. `planWrite` (client-supplied id/slug → path under
   * `defsRoot`) and `planBindingsWrite` (fixed path, content-only body) have genuinely different signatures —
   * that's why they're not one function — but the shell around "plan it, then mkdir+writeFile it" is
   * identical either way, so it lives here once.
   */
  const respondToWrite = (planFn: (body: unknown) => WritePlan) =>
    async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
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
      const plan = planFn(body);
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

  const handle = (kind: WriteKind) => respondToWrite((body) => planWrite(kind, body, defsRoot));

  /**
   * Commit the FX binding table. Its own route rather than a third `WriteKind`, because the destination is
   * fixed by the plugin instead of derived from the request — sharing `planWrite`'s signature would imply a
   * client-supplied path that does not exist here.
   *
   * No watcher is needed on this file (unlike the defs directory): `bindings.json` is a STATIC import, so a
   * write invalidates through the normal import graph and HMR picks it up. The `import.meta.glob` staleness
   * that forced the defs watcher does not apply.
   */
  const handleBindings = respondToWrite((body) => planBindingsWrite(body, bindingsFile));

  return {
    name: 'ascent:fx-defs',
    // The one line that makes this dev-only. A production build never runs it.
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__fx/def', (req, res) => void handle('def')(req, res));
      server.middlewares.use('/__fx/art', (req, res) => void handle('art')(req, res));
      server.middlewares.use('/__fx/bindings', (req, res) => void handleBindings(req, res));

      /**
       * Make a def file that appears on disk actually SHOW UP without restarting the dev server.
       *
       * `fxDefs.ts` reads the library with `import.meta.glob(..., { eager: true })`, which Vite expands at
       * TRANSFORM time. Adding or deleting a file in the globbed directory does not invalidate the module
       * that contains the glob, so its expansion stays frozen at whatever existed when it was last
       * transformed. In-app Saves route around this (`registerSavedDef` overlays the new def in the running
       * session), but that only covers defs created THROUGH the app — a def arriving any other way (git
       * pull, a branch switch, a file written by an agent) stayed invisible until a full restart, with no
       * symptom except the library silently not listing it.
       *
       * So: watch the defs directory, and on add/unlink invalidate the glob's own module and reload. Scoped
       * to `add`/`unlink` deliberately — a CHANGE to an existing def already invalidates normally through
       * the import graph, and reloading on every keystroke-triggered write would fight the editor.
       */
      const globOwner = path.resolve(defsRoot, '..', 'fxDefs.ts');
      server.watcher.add(defsRoot);
      const onDefFileAppearOrVanish = (file: string): void => {
        if (path.dirname(path.resolve(file)) !== defsRoot || !file.endsWith('.json')) return;
        const mod = server.moduleGraph.getModuleById(globOwner);
        if (mod !== undefined) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onDefFileAppearOrVanish);
      server.watcher.on('unlink', onDefFileAppearOrVanish);

      /**
       * The exact same treatment for imported ART, which had none — and that omission is a bug the owner hit:
       * import a PNG, tune it, Save, reload, and the effect renders a fallback circle.
       *
       * `shapeLibrary.ts` globs `./defs/art/*.png` with the same eager, transform-time expansion, and Save
       * REWRITES the layer's local-only `custom:<slug>` to the committed `art:<slug>` — so after the reload the
       * def names an id whose only resolver is a glob that was frozen before the file existed. Restarting the
       * dev server fixed it, which was the tell. Invalidating the art glob's owner on add/unlink is what makes
       * the reload the def write already triggers land on a module that can actually see the new PNG.
       *
       * Scoped to `defsRoot/art` and `.png` for the same reasons as the def watcher above. The client keeps a
       * belt to this braces (`shapeLibrary.registerSavedArt`) for a write this watcher never sees.
       */
      const artRoot = path.resolve(defsRoot, 'art');
      const artGlobOwner = path.resolve(defsRoot, '..', 'shapeLibrary.ts');
      const onArtFileAppearOrVanish = (file: string): void => {
        if (path.dirname(path.resolve(file)) !== artRoot || !file.endsWith('.png')) return;
        const mod = server.moduleGraph.getModuleById(artGlobOwner);
        if (mod !== undefined) server.moduleGraph.invalidateModule(mod);
        server.ws.send({ type: 'full-reload' });
      };
      server.watcher.on('add', onArtFileAppearOrVanish);
      server.watcher.on('unlink', onArtFileAppearOrVanish);
    },
  };
}

export default fxDefsPlugin;
