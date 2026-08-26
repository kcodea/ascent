import { readFile, writeFile } from 'node:fs/promises';
import { Buffer } from 'node:buffer';
import type { IncomingMessage, ServerResponse } from 'node:http';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import type { Plugin } from 'vite';

/**
 * RULEBOOK TRIAGE — DEV-ONLY middleware that lets the Rulebook board (DEV MENU → Rulebook) commit the
 * owner's clicks to the git-tracked registry (`packages/rules/src/registry/decisions.json`). A click IS a
 * ruling: it survives reload, ships in the next commit, and every Doc Bot lane that cites the rule id reads
 * the decision from the same file.
 *
 * `apply: 'serve'` — never part of a production build. Mirrors `beatLabPlugin.ts`: the validation surface is
 * one pure function (`planDecisionWrite`) unit-tested without a server; the middleware is a thin shell. The
 * destination is FIXED by the plugin, never derived from the request.
 */

export const MAX_DECISION_BYTES = 16 * 1024;
const UNSAFE_KEYS: readonly string[] = ['__proto__', 'constructor', 'prototype'];
const DECISION_VALUES: readonly string[] = ['approve', 'revise', 'reject'];

export interface DecisionRequest { id: string; decision: string; note?: string }

/** Validate a request + produce the next decisions map. Pure — the whole testable surface. */
export function planDecisionWrite(
  current: Record<string, unknown>,
  body: unknown,
): { error: string } | { next: Record<string, unknown> } {
  if (!body || typeof body !== 'object' || Array.isArray(body)) return { error: 'body must be an object' };
  const { id, decision, note } = body as DecisionRequest;
  if (typeof id !== 'string' || !/^[Rq]-[A-Za-z0-9_-]{1,120}$/.test(id)) return { error: 'bad rule id' };
  if (UNSAFE_KEYS.includes(id)) return { error: 'bad rule id' };
  if (!DECISION_VALUES.includes(decision)) return { error: `decision must be one of ${DECISION_VALUES.join('/')}` };
  if (note !== undefined && (typeof note !== 'string' || note.length > 2000)) return { error: 'note must be a string ≤ 2000 chars' };
  if (decision === 'revise' && !note?.trim()) return { error: 'a revise decision must carry the owner’s wording in note' };
  const next = { ...current };
  next[id] = { decision, ...(note?.trim() ? { note: note.trim() } : {}), decidedAt: new Date().toISOString() };
  return { next };
}

/** Undo: delete a decision (the board's "clear" affordance). */
export function planDecisionClear(current: Record<string, unknown>, id: unknown): { error: string } | { next: Record<string, unknown> } {
  if (typeof id !== 'string' || UNSAFE_KEYS.includes(id) || !(id in current)) return { error: 'no such decision' };
  const next = { ...current };
  delete next[id];
  return { next };
}

const DECISIONS_PATH = path.resolve(
  path.dirname(fileURLToPath(import.meta.url)),
  '../../packages/rules/src/registry/decisions.json',
);

function readBody(req: IncomingMessage): Promise<unknown> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on('data', (c: Buffer) => {
      size += c.length;
      if (size > MAX_DECISION_BYTES) { reject(new Error('too large')); req.destroy(); return; }
      chunks.push(c);
    });
    req.on('end', () => {
      try { resolve(JSON.parse(Buffer.concat(chunks).toString('utf8'))); } catch { reject(new Error('bad json')); }
    });
    req.on('error', reject);
  });
}

export function rulebookPlugin(): Plugin {
  return {
    name: 'rulebook-decisions',
    apply: 'serve',
    configureServer(server) {
      server.middlewares.use('/__rulebook/decide', (req: IncomingMessage, res: ServerResponse) => {
        void (async () => {
          if (req.method !== 'POST') { res.statusCode = 405; res.end(); return; }
          try {
            const body = await readBody(req);
            const current = JSON.parse(await readFile(DECISIONS_PATH, 'utf8')) as Record<string, unknown>;
            const clear = (body as { clear?: unknown }).clear;
            const plan = clear !== undefined ? planDecisionClear(current, clear) : planDecisionWrite(current, body);
            if ('error' in plan) { res.statusCode = 400; res.end(JSON.stringify({ error: plan.error })); return; }
            await writeFile(DECISIONS_PATH, `${JSON.stringify(plan.next, null, 2)}\n`);
            res.setHeader('content-type', 'application/json');
            res.end(JSON.stringify({ ok: true }));
          } catch (e) {
            res.statusCode = 400;
            res.end(JSON.stringify({ error: (e as Error).message }));
          }
        })();
      });
    },
  };
}
