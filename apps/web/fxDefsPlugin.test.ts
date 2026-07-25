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

  async function routes(): Promise<Map<string, Handler>> {
    const root = await tmp;
    const map = new Map<string, Handler>();
    const server = { middlewares: { use: (route: string, fn: Handler) => map.set(route, fn) } };
    const plugin = fxDefsPlugin({ defsRoot: root });
    const configure = plugin.configureServer as (s: unknown) => void;
    configure(server);
    return map;
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

  it('registers exactly the two endpoints', async () => {
    expect([...(await routes()).keys()].sort()).toEqual(['/__fx/art', '/__fx/def']);
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

  it('refuses a non-POST', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    expect((await call(handler, '', 'GET')).status).toBe(405);
  });

  it('answers an unreadable body with a 400 rather than crashing the dev server', async () => {
    const handler = (await routes()).get('/__fx/def')!;
    expect((await call(handler, 'not json at all')).status).toBe(400);
  });
});
