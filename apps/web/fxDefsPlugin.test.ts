import { Buffer } from 'node:buffer';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { Readable } from 'node:stream';
import { afterAll, describe, expect, it } from 'vitest';
import {
  ART_DATA_URL_PREFIX,
  MAX_ART_BYTES,
  MAX_DEF_BYTES,
  SLUG_RE,
  fxDefsPlugin,
  isInside,
  planBindingsWrite,
  planCardArtWrite,
  planWrite,
} from './fxDefsPlugin';

/**
 * This plugin writes files to disk in response to an unauthenticated local HTTP request, so its validation
 * surface is the thing worth testing hardest — and it is all in `planWrite`, which is pure: no server, no
 * filesystem, no globals. Every case below is a decision that, if it went the other way, would let a request
 * write somewhere it must not.
 */

const ROOT = path.resolve('/repo/packages/ui/src/fx/defs');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

function pngDataUrl(extraBytes = 0): string {
  const buf = Buffer.concat([PNG_HEADER, Buffer.alloc(extraBytes, 1)]);
  return ART_DATA_URL_PREFIX + buf.toString('base64');
}

describe('planWrite — defs', () => {
  it('accepts a valid def and targets defs/<id>.json', () => {
    const plan = planWrite('def', { id: 'crit-impact', json: '{"version":1,"duration":1000,"layers":[]}' }, ROOT);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(path.join(ROOT, 'crit-impact.json'));
    expect(plan.error).toBeUndefined();
  });

  it('pretty-prints (and re-serializes) what it will write', () => {
    const plan = planWrite('def', { id: 'x', json: '{"duration":1,"layers":[]}' }, ROOT);
    expect(plan.data).toBe('{\n  "duration": 1,\n  "layers": []\n}\n');
  });

  it('rejects a slug outside the grammar — including every path-escape shape', () => {
    for (const id of [
      '../evil',
      '../../etc/passwd',
      'a/b',
      'a\\b',
      '/abs/path',
      'C:\\windows\\system32',
      '.',
      '..',
      '',
      '-leading',
      'UPPER',
      'has space',
      'a'.repeat(65),
    ]) {
      const plan = planWrite('def', { id, json: '{}' }, ROOT);
      expect(plan.status, `id: '${id}'`).toBe(400);
      expect(plan.file, `id: '${id}'`).toBeUndefined();
    }
  });

  it('allows a trailing dash — the grammar permits it, it is still a safe filename', () => {
    // `slugify` never produces one, but a hand-typed id may; documenting it here so the two copies of the
    // regex (client + server) can't drift on a case anyone thought was rejected.
    expect(planWrite('def', { id: 'trailing-', json: '{}' }, ROOT).status).toBe(200);
  });

  it('rejects an oversized def', () => {
    const json = JSON.stringify({ pad: 'x'.repeat(MAX_DEF_BYTES) });
    const plan = planWrite('def', { id: 'big', json }, ROOT);
    expect(plan.status).toBe(413);
    expect(plan.file).toBeUndefined();
  });

  it('accepts a def right up to the size cap', () => {
    const json = JSON.stringify({ pad: 'x'.repeat(MAX_DEF_BYTES - 100) });
    expect(Buffer.byteLength(json)).toBeLessThanOrEqual(MAX_DEF_BYTES);
    expect(planWrite('def', { id: 'big', json }, ROOT).status).toBe(200);
  });

  it('rejects a missing or ill-typed field', () => {
    expect(planWrite('def', {}, ROOT).status).toBe(400);
    expect(planWrite('def', { id: 'x' }, ROOT).status).toBe(400);
    expect(planWrite('def', { json: '{}' }, ROOT).status).toBe(400);
    expect(planWrite('def', { id: 5, json: '{}' }, ROOT).status).toBe(400);
    expect(planWrite('def', { id: 'x', json: 5 }, ROOT).status).toBe(400);
  });

  it('rejects a non-object body', () => {
    for (const body of [null, undefined, 'a string', 42, [], true]) {
      expect(planWrite('def', body, ROOT).status, JSON.stringify(body)).toBe(400);
    }
  });

  it('refuses to write JSON that is not JSON, or is not an object', () => {
    expect(planWrite('def', { id: 'x', json: '{ broken' }, ROOT).status).toBe(400);
    expect(planWrite('def', { id: 'x', json: '[1,2]' }, ROOT).status).toBe(400);
    expect(planWrite('def', { id: 'x', json: 'null' }, ROOT).status).toBe(400);
  });
});

describe('planWrite — art', () => {
  it('accepts a PNG data URL and targets defs/art/<slug>.png', () => {
    const plan = planWrite('art', { slug: 'ember', dataUrl: pngDataUrl(16) }, ROOT);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(path.join(ROOT, 'art', 'ember.png'));
    expect(Buffer.isBuffer(plan.data)).toBe(true);
    expect((plan.data as Buffer).subarray(0, 8)).toEqual(PNG_HEADER);
  });

  it('rejects anything but a `data:image/png;base64,` URL', () => {
    for (const dataUrl of [
      'data:image/jpeg;base64,/9j/4AA',
      'data:image/svg+xml;base64,PHN2Zz4=',
      'data:text/html;base64,PGh0bWw+',
      'http://example.com/x.png',
      '',
      'data:image/png;base64',
    ]) {
      const plan = planWrite('art', { slug: 'ember', dataUrl }, ROOT);
      expect(plan.status, dataUrl).toBe(400);
      expect(plan.file, dataUrl).toBeUndefined();
    }
  });

  it('rejects a payload that claims PNG but is not one', () => {
    const lying = ART_DATA_URL_PREFIX + Buffer.from('<html>not a png</html>').toString('base64');
    expect(planWrite('art', { slug: 'ember', dataUrl: lying }, ROOT).status).toBe(400);
  });

  it('rejects an empty payload', () => {
    expect(planWrite('art', { slug: 'ember', dataUrl: ART_DATA_URL_PREFIX }, ROOT).status).toBe(400);
  });

  it('rejects oversized art — both by decoded bytes and by raw string length', () => {
    const oversize = planWrite('art', { slug: 'ember', dataUrl: pngDataUrl(MAX_ART_BYTES) }, ROOT);
    expect(oversize.status).toBe(413);
    const absurd = ART_DATA_URL_PREFIX + 'A'.repeat(MAX_ART_BYTES * 2 + 1);
    expect(planWrite('art', { slug: 'ember', dataUrl: absurd }, ROOT).status).toBe(413);
  });

  it('rejects a slug outside the grammar', () => {
    for (const slug of ['../evil', 'a/b', '/abs', '', '..', 'Ember', 5 as unknown as string]) {
      expect(planWrite('art', { slug, dataUrl: pngDataUrl() }, ROOT).status, String(slug)).toBe(400);
    }
  });

  it('rejects missing fields and non-object bodies', () => {
    expect(planWrite('art', { slug: 'ember' }, ROOT).status).toBe(400);
    expect(planWrite('art', { dataUrl: pngDataUrl() }, ROOT).status).toBe(400);
    expect(planWrite('art', 'nope', ROOT).status).toBe(400);
  });
});

describe('containment guard', () => {
  it('accepts only paths under the root', () => {
    expect(isInside(ROOT, path.join(ROOT, 'a.json'))).toBe(true);
    expect(isInside(ROOT, path.join(ROOT, 'art', 'a.png'))).toBe(true);
  });

  it('rejects the root itself, siblings, parents and absolute escapes', () => {
    expect(isInside(ROOT, ROOT)).toBe(false);
    expect(isInside(ROOT, path.join(ROOT, '..', 'other.json'))).toBe(false);
    expect(isInside(ROOT, path.join(ROOT, '..', '..', '..', 'package.json'))).toBe(false);
    expect(isInside(ROOT, path.resolve('/etc/passwd'))).toBe(false);
    expect(isInside(ROOT, path.resolve('/repo/packages/ui/src/fx/defs-evil/x.json'))).toBe(false);
  });

  it('every id the slug grammar admits stays inside the root', () => {
    for (const id of ['a', 'z9', 'crit-impact', '0-0', 'a'.repeat(64)]) {
      expect(SLUG_RE.test(id), id).toBe(true);
      expect(isInside(ROOT, path.resolve(ROOT, `${id}.json`)), id).toBe(true);
      expect(isInside(ROOT, path.resolve(ROOT, 'art', `${id}.png`)), id).toBe(true);
    }
  });
});

describe('the plugin itself', () => {
  it('is dev-only — apply: serve, so a production build never runs it', () => {
    const plugin = fxDefsPlugin();
    expect(plugin.apply).toBe('serve');
    expect(plugin.name).toBe('ascent:fx-defs');
    expect(typeof plugin.configureServer).toBe('function');
  });
});

/**
 * End-to-end through the actual middleware — body stream in, file on disk out — pointed at a temp directory
 * so it never touches the repo. This is what proves the pure `planWrite` is actually WIRED (a plan nobody
 * writes is just a unit test passing).
 */
describe('middleware round trip', () => {
  const tmp = mkdtemp(path.join(tmpdir(), 'fx-defs-'));
  afterAll(async () => rm(await tmp, { recursive: true, force: true }));

  type Handler = (req: IncomingMessage, res: ServerResponse) => void;

  type WatchHandler = (file: string) => void;
  interface FakeServer {
    routes: Map<string, Handler>;
    watched: string[];
    watchers: Map<string, WatchHandler[]>;
    invalidated: unknown[];
    sent: unknown[];
    /** Stand-in for a module Vite knows about, keyed by resolved id. */
    modules: Map<string, unknown>;
  }

  /**
   * A fake dev server carrying every surface the plugin touches. It grew `watcher`/`moduleGraph`/`ws` when
   * the glob-invalidation watcher landed: the previous fake stubbed only `middlewares`, so `configureServer`
   * threw on the first `server.watcher.add`. Widening the fake (rather than making the plugin defensive
   * about a server shape Vite always provides) keeps the new behaviour actually under test.
   */
  async function fakeServer(): Promise<FakeServer> {
    const root = await tmp;
    const state: FakeServer = {
      routes: new Map(),
      watched: [],
      watchers: new Map(),
      invalidated: [],
      sent: [],
      modules: new Map(),
    };
    const server = {
      middlewares: { use: (route: string, fn: Handler) => state.routes.set(route, fn) },
      watcher: {
        add: (dir: string) => state.watched.push(dir),
        on: (event: string, fn: WatchHandler) => {
          state.watchers.set(event, [...(state.watchers.get(event) ?? []), fn]);
        },
      },
      moduleGraph: {
        getModuleById: (id: string) => state.modules.get(id),
        invalidateModule: (mod: unknown) => state.invalidated.push(mod),
      },
      ws: { send: (msg: unknown) => state.sent.push(msg) },
    };
    // A distinct tmp path — not the repo's real bindings.json — so a round-trip test through /__fx/bindings
    // can never clobber the committed binding table.
    const plugin = fxDefsPlugin({ defsRoot: root, bindingsFile: path.join(root, 'bindings.json') });
    const configure = plugin.configureServer as (s: unknown) => void;
    configure(server);
    return state;
  }

  async function routes(): Promise<Map<string, Handler>> {
    return (await fakeServer()).routes;
  }

  function call(handler: Handler, body: string, method = 'POST'): Promise<{ status: number; body: unknown }> {
    return new Promise((resolve) => {
      const req = Readable.from([Buffer.from(body)]) as unknown as IncomingMessage;
      (req as { method?: string }).method = method;
      const chunks: string[] = [];
      const res = {
        statusCode: 0,
        setHeader: () => {},
        end: (chunk?: string) => {
          if (chunk) chunks.push(chunk);
          resolve({ status: res.statusCode, body: JSON.parse(chunks.join('')) as unknown });
        },
      };
      handler(req, res as unknown as ServerResponse);
    });
  }

  it('registers exactly the four endpoints', async () => {
    expect([...(await routes()).keys()].sort())
      .toEqual(['/__fx/art', '/__fx/bindings', '/__fx/cardart', '/__fx/def']);
  });

  it('writes a def file and reports its path', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    const res = await call(handler, JSON.stringify({ id: 'crit-impact', json: '{"duration":1,"layers":[]}' }));
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const written = await readFile(path.join(await tmp, 'crit-impact.json'), 'utf8');
    expect(JSON.parse(written)).toEqual({ duration: 1, layers: [] });
  });

  it('creates the art subdirectory and writes the PNG bytes', async () => {
    const handler = (await routes()).get('/__fx/art')!;
    const res = await call(handler, JSON.stringify({ slug: 'ember', dataUrl: pngDataUrl(4) }));
    expect(res.status).toBe(200);
    const written = await readFile(path.join(await tmp, 'art', 'ember.png'));
    expect(written.subarray(0, 8)).toEqual(PNG_HEADER);
    expect(written.byteLength).toBe(12);
  });

  it('answers a rejected write with the 4xx reason and writes nothing', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    const res = await call(handler, JSON.stringify({ id: '../escape', json: '{}' }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
    await expect(readFile(path.join(await tmp, '..', 'escape.json'))).rejects.toThrow();
  });

  it('writes the bindings table to its own tmp file, distinct from defs/art', async () => {
    const handler = (await routes()).get('/__fx/bindings')!;
    const body = JSON.stringify({ json: JSON.stringify({ version: 1, kinds: { scCast: { def: 'spell-cast' } }, cards: {} }) });
    const res = await call(handler, body);
    expect(res.status).toBe(200);
    expect(res.body).toMatchObject({ ok: true });
    const written = await readFile(path.join(await tmp, 'bindings.json'), 'utf8');
    expect(JSON.parse(written)).toEqual({ version: 1, kinds: { scCast: { def: 'spell-cast' } }, cards: {} });
  });

  it('rejects a malformed bindings body over the wire too, writing nothing', async () => {
    const handler = (await routes()).get('/__fx/bindings')!;
    const res = await call(handler, JSON.stringify({ json: '{"version":2,"kinds":{},"cards":{}}' }));
    expect(res.status).toBe(400);
    expect(res.body).toMatchObject({ ok: false });
  });

  it('refuses a non-POST to /__fx/bindings', async () => {
    const handler = (await routes()).get('/__fx/bindings')!;
    expect((await call(handler, '', 'GET')).status).toBe(405);
  });

  it('refuses a non-POST', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    expect((await call(handler, '', 'GET')).status).toBe(405);
  });

  it('answers an unreadable body with a 400 rather than crashing the dev server', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    expect((await call(handler, 'not json at all')).status).toBe(400);
  });
});

/**
 * The glob-invalidation watcher. `fxDefs.ts` reads the library with an EAGER `import.meta.glob`, which Vite
 * expands at transform time — so a def file appearing on disk (git pull, branch switch, an agent writing
 * one) was invisible until the whole dev server restarted, with no symptom except the library quietly not
 * listing it. Verified live too (a probe file appeared and vanished without a restart); these cases pin the
 * wiring so it can't silently regress.
 */
describe('defs-directory watcher', () => {
  const tmp = mkdtemp(path.join(tmpdir(), 'fx-defs-watch-'));
  afterAll(async () => rm(await tmp, { recursive: true, force: true }));

  type Handler = (req: IncomingMessage, res: ServerResponse) => void;
  type WatchHandler = (file: string) => void;

  async function setup(): Promise<{
    root: string;
    globOwner: string;
    artGlobOwner: string;
    watched: string[];
    fire: (event: string, file: string) => void;
    invalidated: unknown[];
    sent: unknown[];
  }> {
    const root = await tmp;
    const globOwner = path.resolve(root, '..', 'fxDefs.ts');
    // There are TWO transform-time globs over this directory tree, and they live in different modules:
    // `fxDefs.ts` expands `./defs/*.json`, `shapeLibrary.ts` expands `./defs/art/*.png`. Each needs its own
    // invalidation, so the stub graph has to be able to tell them apart.
    const artGlobOwner = path.resolve(root, '..', 'shapeLibrary.ts');
    const watched: string[] = [];
    const watchers = new Map<string, WatchHandler[]>();
    const invalidated: unknown[] = [];
    const sent: unknown[] = [];
    const modules = new Map<string, unknown>([
      [globOwner, { id: globOwner }],
      [artGlobOwner, { id: artGlobOwner }],
    ]);
    const server = {
      middlewares: { use: (_r: string, _f: Handler) => {} },
      watcher: {
        add: (dir: string) => watched.push(dir),
        on: (event: string, fn: WatchHandler) => {
          watchers.set(event, [...(watchers.get(event) ?? []), fn]);
        },
      },
      moduleGraph: {
        getModuleById: (id: string) => modules.get(id),
        invalidateModule: (mod: unknown) => invalidated.push(mod),
      },
      ws: { send: (msg: unknown) => sent.push(msg) },
    };
    const plugin = fxDefsPlugin({ defsRoot: root });
    (plugin.configureServer as (s: unknown) => void)(server);
    const fire = (event: string, file: string): void => {
      (watchers.get(event) ?? []).forEach((fn) => fn(file));
    };
    return { root, globOwner, artGlobOwner, watched, fire, invalidated, sent };
  }

  it('watches the defs directory', async () => {
    const { root, watched } = await setup();
    expect(watched).toContain(root);
  });

  it('invalidates the glob owner and reloads when a def APPEARS', async () => {
    const { root, globOwner, fire, invalidated, sent } = await setup();
    fire('add', path.join(root, 'new-effect.json'));
    expect(invalidated).toEqual([{ id: globOwner }]);
    expect(sent).toEqual([{ type: 'full-reload' }]);
  });

  it('does the same when a def is DELETED, so a stale entry cannot linger', async () => {
    const { root, fire, sent } = await setup();
    fire('unlink', path.join(root, 'gone.json'));
    expect(sent).toEqual([{ type: 'full-reload' }]);
  });

  it('ignores JSON outside the defs directory itself', async () => {
    const { root, fire, sent } = await setup();
    fire('add', path.join(root, '..', 'elsewhere.json'));
    expect(sent).toEqual([]);
  });

  /**
   * Art PNGs land in the `defs/art/` SUBdirectory and are NOT part of the def glob — they have a glob of
   * their own, in `shapeLibrary.ts`, with exactly the same transform-time staleness. This used to be the
   * documented reason to ignore them ("reloading on those would interrupt an import for nothing"), and that
   * reasoning was wrong in a way that cost the owner an afternoon: the workbench's Save uploads the PNG AND
   * rewrites the layer to `art:<slug>`, so a reload with a stale art glob renders a fallback circle and the
   * effect the author just tuned appears to have vanished. Only a dev-server restart fixed it.
   */
  it('invalidates the ART glob owner and reloads when a PNG appears in defs/art', async () => {
    const { root, artGlobOwner, fire, invalidated, sent } = await setup();
    fire('add', path.join(root, 'art', 'coin.png'));
    expect(invalidated).toEqual([{ id: artGlobOwner }]);
    expect(sent).toEqual([{ type: 'full-reload' }]);
  });

  it('does the same when committed art is DELETED', async () => {
    const { root, artGlobOwner, fire, invalidated, sent } = await setup();
    fire('unlink', path.join(root, 'art', 'coin.png'));
    expect(invalidated).toEqual([{ id: artGlobOwner }]);
    expect(sent).toEqual([{ type: 'full-reload' }]);
  });

  // The two watchers must stay disjoint: a def write must not invalidate the art module, and vice versa.
  // Invalidating the wrong one is a silent no-op that looks exactly like the bug above.
  it('routes each file kind to its OWN glob owner and no other', async () => {
    const { root, globOwner, artGlobOwner, fire, invalidated } = await setup();
    fire('add', path.join(root, 'new-effect.json'));
    fire('add', path.join(root, 'art', 'coin.png'));
    expect(invalidated).toEqual([{ id: globOwner }, { id: artGlobOwner }]);
  });

  it('ignores a non-PNG in the art directory, and a PNG anywhere else', async () => {
    const { root, fire, sent } = await setup();
    fire('add', path.join(root, 'art', 'notes.md'));
    fire('add', path.join(root, 'stray.png'));
    fire('add', path.join(root, 'art', 'nested', 'deep.png'));
    expect(sent).toEqual([]);
  });

  it('ignores non-JSON files landing in the defs directory', async () => {
    const { root, fire, sent } = await setup();
    fire('add', path.join(root, 'notes.md'));
    expect(sent).toEqual([]);
  });
});

const FILE = '/repo/packages/ui/src/choreo/bindings.json';
const ok = (kinds: unknown, cards: unknown = {}): string => JSON.stringify({ version: 1, kinds, cards });

describe('planBindingsWrite', () => {
  it('accepts a well-formed table and writes to the fixed path', () => {
    const plan = planBindingsWrite({ json: ok({ scCast: { def: 'spell-cast' } }) }, FILE);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(FILE);
    expect(String(plan.data)).toContain('"spell-cast"');
    expect(String(plan.data).endsWith('\n')).toBe(true);
  });

  it('re-serializes rather than echoing, so what lands on disk is stably formatted', () => {
    const plan = planBindingsWrite({ json: '{"version":1,"kinds":{},"cards":{}}' }, FILE);
    expect(plan.status).toBe(200);
    expect(String(plan.data)).toBe('{\n  "version": 1,\n  "kinds": {},\n  "cards": {}\n}\n');
  });

  it('rejects a non-object body, a missing json field, and unparseable json', () => {
    expect(planBindingsWrite(null, FILE).status).toBe(400);
    expect(planBindingsWrite({}, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: '{oops' }, FILE).status).toBe(400);
  });

  it('rejects a wrong version', () => {
    const plan = planBindingsWrite({ json: JSON.stringify({ version: 2, kinds: {}, cards: {} }) }, FILE);
    expect(plan.status).toBe(400);
    expect(plan.error).toContain('version');
  });

  it('rejects a missing or non-object kinds/cards', () => {
    expect(planBindingsWrite({ json: JSON.stringify({ version: 1, cards: {} }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({}, []) }, FILE).status).toBe(400);
  });

  // The def id is a filename stem on disk, so it gets the same grammar the def endpoint enforces.
  it('rejects a def id outside the slug grammar', () => {
    expect(planBindingsWrite({ json: ok({ scCast: { def: '../../etc/passwd' } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({ scCast: { def: 'Spell Cast' } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({ scCast: { def: '' } }) }, FILE).status).toBe(400);
  });

  it('rejects an unknown fanOut', () => {
    const plan = planBindingsWrite({ json: ok({ scCast: { def: 'spell-cast', fanOut: 'sideways' } }) }, FILE);
    expect(plan.status).toBe(400);
    expect(plan.error).toContain('fanOut');
  });

  it('validates nested card bindings too', () => {
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: { scCast: { def: 'ruby-lance' } } }) }, FILE).status).toBe(200);
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: { scCast: { def: 'BAD ID' } } }) }, FILE).status).toBe(400);
    expect(planBindingsWrite({ json: ok({}, { bloodbinder: 'nope' }) }, FILE).status).toBe(400);
  });

  it('rejects an oversized payload', () => {
    const huge = JSON.stringify({ version: 1, kinds: {}, cards: {}, pad: 'x'.repeat(300_000) });
    expect(planBindingsWrite({ json: huge }, FILE).status).toBe(413);
  });

  // The reader (`bindings.ts`'s `parseTable`) silently drops these keys via its own `UNSAFE_KEYS` guard, so a
  // write that accepts one would report success for a binding that can never load. Reject at all three key
  // positions: the kind key, the card-id key, and the inner per-card kind key.
  it('rejects __proto__/constructor/prototype at the kinds key', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const plan = planBindingsWrite({ json: JSON.stringify({ version: 1, kinds: { [key]: { def: 'spell-cast' } }, cards: {} }) }, FILE);
      expect(plan.status).toBe(400);
      expect(plan.error).toContain(key);
    }
  });

  it('rejects __proto__/constructor/prototype at the cards card-id key', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const plan = planBindingsWrite({ json: ok({}, { [key]: { scCast: { def: 'spell-cast' } } }) }, FILE);
      expect(plan.status).toBe(400);
      expect(plan.error).toContain(key);
    }
  });

  it('rejects __proto__/constructor/prototype at the inner per-card kind key', () => {
    for (const key of ['__proto__', 'constructor', 'prototype']) {
      const plan = planBindingsWrite({ json: ok({}, { bloodbinder: { [key]: { def: 'spell-cast' } } }) }, FILE);
      expect(plan.status).toBe(400);
      expect(plan.error).toContain(key);
    }
  });
});

/* The card-art table lands in a committed file that `cardArtConfig.ts` STATICALLY imports, so anything the
   planner lets through renders as a broken card transform later, with nothing pointing back to the write.
   These pin the shape checks that stop that. */
describe('planCardArtWrite', () => {
  const FILE = path.join(tmpdir(), 'cardArt.data.json');
  const send = (v: unknown) => planCardArtWrite({ json: JSON.stringify(v) }, FILE);

  it('accepts a well-formed table and re-serialises it stably', () => {
    const plan = send({ echohorn: { x: -4, y: 2.5, zoom: 1.2 } });
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(FILE);
    expect(String(plan.data)).toBe(`${JSON.stringify({ echohorn: { x: -4, y: 2.5, zoom: 1.2 } }, null, 2)}
`);
  });

  it('accepts an empty table — clearing every override is a legitimate save', () => {
    expect(send({}).status).toBe(200);
  });

  it('rejects a field that is not a card-art knob, rather than ignoring it', () => {
    // A typo'd key would otherwise be committed and silently do nothing forever.
    const plan = send({ echohorn: { zoomm: 1.2 } });
    expect(plan.status).toBe(400);
    expect(plan.error).toMatch(/not a card-art field/);
  });

  it('rejects a non-finite value', () => {
    // JSON has no NaN, but Infinity arrives as null and a string sails through JSON.parse untouched.
    expect(send({ echohorn: { zoom: 'big' } }).status).toBe(400);
    expect(send({ echohorn: { zoom: null } }).status).toBe(400);
  });

  it('rejects prototype-polluting keys', () => {
    const plan = planCardArtWrite({ json: '{"__proto__":{"x":1}}' }, FILE);
    expect(plan.status).toBe(400);
    expect(plan.error).toMatch(/unsafe key/);
  });

  it('rejects a non-object entry, a non-object body and invalid JSON', () => {
    expect(send({ echohorn: 5 }).status).toBe(400);
    expect(planCardArtWrite('nope', FILE).status).toBe(400);
    expect(planCardArtWrite({ json: '{oops' }, FILE).status).toBe(400);
    expect(planCardArtWrite({}, FILE).status).toBe(400);
  });

  it('rejects a table past the size cap', () => {
    const plan = planCardArtWrite({ json: `{"a":"${'x'.repeat(MAX_DEF_BYTES)}"}` }, FILE);
    expect(plan.status).toBe(413);
  });
});
