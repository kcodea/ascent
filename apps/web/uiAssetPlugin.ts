import { Buffer } from 'node:buffer';
import { mkdir, writeFile } from 'node:fs/promises';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * DEV-ONLY route (`apply: 'serve'`, never in a production build) that lets the UI editor upload an image to a
 * real committed file, so a swapped asset can be wired up for real. Same shape and same security posture as
 * `fxDefsPlugin.ts`: one pure validator (`planUiAsset`) is the boundary, the middleware is a thin shell.
 * Constants are duplicated ON PURPOSE — this is an independent boundary, not a shared helper.
 */
export const UI_SLUG_RE = /^[a-z0-9][a-z0-9-]{0,63}$/;
export const MAX_ASSET_BYTES = 4 * 1024 * 1024;
export const ASSET_DATA_URL_PREFIX = 'data:image/png;base64,';
const PNG_MAGIC = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);

export interface WritePlan {
  status: number;
  error?: string;
  file?: string;
  data?: Buffer;
}

function bad(status: number, error: string): WritePlan {
  return { status, error };
}
function isRecord(v: unknown): v is Record<string, unknown> {
  return v !== null && typeof v === 'object' && !Array.isArray(v);
}
export function isInside(root: string, target: string): boolean {
  const rel = path.relative(path.resolve(root), path.resolve(target));
  return rel !== '' && !rel.startsWith('..') && !path.isAbsolute(rel);
}

export function planUiAsset(body: unknown, assetsRoot: string): WritePlan {
  if (!isRecord(body)) return bad(400, 'Expected a JSON object body.');
  const { slug, dataUrl } = body;
  if (typeof slug !== 'string' || slug === '') return bad(400, 'Missing `slug`.');
  if (!UI_SLUG_RE.test(slug)) return bad(400, `'${slug}' is not a valid asset slug.`);
  if (typeof dataUrl !== 'string') return bad(400, 'Missing `dataUrl`.');
  if (!dataUrl.startsWith(ASSET_DATA_URL_PREFIX)) return bad(400, 'Asset must be a PNG data URL.');
  if (dataUrl.length > MAX_ASSET_BYTES * 2) return bad(413, `Asset is larger than ${MAX_ASSET_BYTES} bytes.`);
  const buf = Buffer.from(dataUrl.slice(ASSET_DATA_URL_PREFIX.length), 'base64');
  if (buf.byteLength === 0) return bad(400, 'Asset data URL is empty.');
  if (buf.byteLength > MAX_ASSET_BYTES) return bad(413, `Asset is larger than ${MAX_ASSET_BYTES} bytes.`);
  if (!buf.subarray(0, PNG_MAGIC.length).equals(PNG_MAGIC)) return bad(400, 'Asset is not a PNG.');
  const root = path.resolve(assetsRoot);
  const file = path.resolve(root, `${slug}.png`);
  if (!isInside(root, file)) return bad(400, 'Refusing to write outside the assets directory.');
  return { status: 200, file, data: buf };
}

const MAX_BODY_BYTES = MAX_ASSET_BYTES * 2 + 4096;
export const DEFAULT_ASSETS_ROOT = fileURLToPath(new URL('../../packages/ui/src/assets/ui-editor', import.meta.url));

function readBody(req: IncomingMessage): Promise<string> {
  return new Promise((resolve, reject) => {
    let size = 0;
    const chunks: Buffer[] = [];
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_BODY_BYTES) { reject(new Error('Request body is too large.')); req.destroy(); return; }
      chunks.push(c);
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

export function uiAssetPlugin(options: { assetsRoot?: string } = {}): Plugin {
  const assetsRoot = path.resolve(options.assetsRoot ?? DEFAULT_ASSETS_ROOT);
  const repoRoot = path.resolve(assetsRoot, '..', '..', '..', '..', '..');
  return {
    name: 'ascent:ui-asset',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__ui/asset', (req, res) => {
        void (async () => {
          if (req.method !== 'POST') { send(res, 405, { ok: false, error: 'POST only.' }); return; }
          let body: unknown;
          try { body = JSON.parse(await readBody(req)); }
          catch (e) { send(res, 400, { ok: false, error: (e as Error).message }); return; }
          const plan = planUiAsset(body, assetsRoot);
          if (plan.status !== 200 || !plan.file || plan.data === undefined) {
            send(res, plan.status, { ok: false, error: plan.error ?? 'Rejected.' }); return;
          }
          try {
            await mkdir(path.dirname(plan.file), { recursive: true });
            await writeFile(plan.file, plan.data);
          } catch (e) { send(res, 500, { ok: false, error: (e as Error).message }); return; }
          send(res, 200, { ok: true, path: path.relative(repoRoot, plan.file).split(path.sep).join('/') });
        })();
      });
    },
  };
}

export default uiAssetPlugin;
