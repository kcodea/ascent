import { describe, expect, it } from 'vitest';
import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join, relative } from 'node:path';
import { fileURLToPath } from 'node:url';
import ts from 'typescript';

/**
 * NO HOOK INSIDE A HOOK (owner report 2026-10-23: the shop screen crashed with "Invalid hook call. Hooks can only be called
 * inside of the body of a function component"). An edit dropped a `useEffect` INSIDE another `useEffect`'s callback in
 * Recruit.tsx. It type-checks and lints clean (this repo's ESLint has no rules-of-hooks plugin), and React only rejects it
 * at runtime, on the frame the outer effect first runs. This reads every UI component file and fails on any React hook
 * (a `use*` call) made inside the callback of another hook call.
 */
const here = dirname(fileURLToPath(import.meta.url));

function tsxFiles(dir: string): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    const p = join(dir, e.name);
    if (e.isDirectory()) out.push(...tsxFiles(p));
    else if (e.name.endsWith('.tsx') && !/\.test\.tsx$/.test(e.name)) out.push(p);
  }
  return out;
}

function nestedHooks(file: string): string[] {
  const src = ts.createSourceFile(file, readFileSync(file, 'utf8'), ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
  const isHook = (n: ts.Node): n is ts.CallExpression => ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text);
  const found: string[] = [];
  const walk = (node: ts.Node, inside: boolean): void => {
    if (isHook(node) && inside) {
      const { line } = src.getLineAndCharacterOfPosition(node.getStart());
      found.push(`${relative(here, file).replace(/\\/g, '/')}:${line + 1} ${(node.expression as ts.Identifier).text}`);
    }
    const enter = isHook(node);
    ts.forEachChild(node, (c) => walk(c, inside || (enter && (ts.isArrowFunction(c) || ts.isFunctionExpression(c)))));
  };
  walk(src, false);
  return found;
}

describe('React hooks are never called inside another hook', () => {
  it('no component file calls a hook inside a hook callback', () => {
    const offenders = tsxFiles(here).flatMap(nestedHooks);
    expect(offenders, 'a hook inside a hook callback throws "Invalid hook call" at runtime').toEqual([]);
  });

  it('the check catches the nesting that crashed the shop screen', () => {
    const tmp = 'function X() { useEffect(() => { useEffect(() => {}, []); }, []); }';
    const src = ts.createSourceFile('x.tsx', tmp, ts.ScriptTarget.Latest, true, ts.ScriptKind.TSX);
    let nested = 0;
    const walk = (n: ts.Node, inside: boolean): void => {
      const hook = ts.isCallExpression(n) && ts.isIdentifier(n.expression) && /^use[A-Z]/.test(n.expression.text);
      if (hook && inside) nested++;
      ts.forEachChild(n, (c) => walk(c, inside || (hook && ts.isArrowFunction(c))));
    };
    walk(src, false);
    expect(nested).toBe(1);
  });
});
