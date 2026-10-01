import { readdir, readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * GAUNTLET STAGE — DEV-ONLY middleware behind the Stage Builder. GET `/__gauntlet/stage?number=N` returns the
 * stage JSON from disk; POST `/__gauntlet/stage` (`{ stage }`) rewrites it in
 * `packages/content/src/gauntlet/stages/`.
 *
 * `apply: 'serve'` — never part of a production build. Mirrors `qaScenarioPlugin.ts`: the whole validation
 * surface is two pure functions (`planStageSave` / `planStageRead`) unit-tested without a server; the middleware
 * is a thin shell. The destination DIRECTORY is fixed by the plugin and the FILENAME is the ONE existing file
 * whose name starts with the stage's two-digit prefix — never derived from any client-supplied path. Deep
 * semantic validation is `validateStage` (@game/content), which the client runs before posting and CI runs on
 * the committed files — this endpoint only guards the filesystem.
 */

export const MAX_STAGE_BYTES = 256 * 1024;
const MAX_STAGE_NUMBER = 10;

/** Resolve a stage number to the single existing file with its two-digit prefix (`03-` → `03-dragons.json`). */
function fileForNumber(n: number, existingFiles: readonly string[]): { error: string } | { fileName: string } {
  if (!Number.isInteger(n) || n < 1 || n > MAX_STAGE_NUMBER) return { error: `stage number must be an integer 1–${MAX_STAGE_NUMBER}` };
  const prefix = `${String(n).padStart(2, '0')}-`;
  const fileName = existingFiles.find((f) => f.startsWith(prefix) && f.endsWith('.json'));
  return fileName ? { fileName } : { error: `stage ${n} has no file yet` };
}

/** Validate a save request + produce the write plan. Pure — the whole testable surface. */
export function planStageSave(
  body: unknown,
  existingFiles: readonly string[],
): { error: string } | { fileName: string; text: string } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const { stage } = body as { stage?: unknown };
  if (!stage || typeof stage !== 'object' || Array.isArray(stage)) return { error: 'stage must be an object' };
  const s = stage as Record<string, unknown>;
  if (typeof s.number !== 'number') return { error: 'stage.number must be an integer' };
  if (!Array.isArray(s.rounds)) return { error: 'stage.rounds must be an array' };
  const target = fileForNumber(s.number, existingFiles);
  if ('error' in target) return target;
  const text = `${JSON.stringify(stage, null, 2)}\n`;
  if (Buffer.byteLength(text, 'utf8') > MAX_STAGE_BYTES) return { error: 'stage too large' };
  return { fileName: target.fileName, text };
}

/** Validate a read request (`?number=N`) → the file to read. Pure. */
export function planStageRead(
  numberParam: string | null,
  existingFiles: readonly string[],
): { error: string } | { fileName: string } {
  if (numberParam === null || !/^\d{1,2}$/.test(numberParam)) return { error: `number must be an integer 1–${MAX_STAGE_NUMBER}` };
  return fileForNumber(Number(numberParam), existingFiles);
}

export const STAGES_DIR = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/content/src/gauntlet/stages',
);

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_STAGE_BYTES * 2) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

export function gauntletStagePlugin(): Plugin {
  return {
    name: 'gauntlet-stage',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__gauntlet/stage', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          res.setHeader('content-type', 'application/json');
          try {
            const files = await readdir(STAGES_DIR);
            if (req.method === 'GET') {
              const url = new URL(req.url ?? '/', 'http://localhost');
              const plan = planStageRead(url.searchParams.get('number'), files);
              if ('error' in plan) { res.statusCode = 400; res.end(JSON.stringify({ error: plan.error })); return; }
              res.end(await readFile(path.join(STAGES_DIR, plan.fileName), 'utf8'));
              return;
            }
            if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
            const plan = planStageSave(await readBody(req), files);
            if ('error' in plan) { res.statusCode = 400; res.end(JSON.stringify({ error: plan.error })); return; }
            await writeFile(path.join(STAGES_DIR, plan.fileName), plan.text);
            res.end(JSON.stringify({ ok: true, path: `packages/content/src/gauntlet/stages/${plan.fileName}` }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        })();
      });
    },
  };
}
