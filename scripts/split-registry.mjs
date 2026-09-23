#!/usr/bin/env node
/**
 * split-registry — moves hand-authored approved rules from the OLD monolith
 * (`packages/rules/src/registry/approved.ts`) into the per-domain files under
 * `packages/rules/src/registry/approved/<domain>.ts`, byte-for-byte.
 *
 * It was the one-shot migration tool (2026-09-23) and stays in the repo because it is also the merge tool:
 * a branch that still appends rules to the monolith can take `main` (which deleted it), keep ITS copy of
 * `approved.ts`, run this, and every rule the domain files do not yet hold is appended to the right file
 * with its source text unchanged. Nothing in a domain file is ever rewritten or reordered by a merge run.
 *
 *   node scripts/split-registry.mjs                  # split/merge packages/rules/src/registry/approved.ts
 *   node scripts/split-registry.mjs --from <path>    # read the monolith from another path (e.g. a git show)
 *   node scripts/split-registry.mjs --dry            # report what would change, write nothing
 *   node scripts/split-registry.mjs --rm             # also delete the monolith after a successful run
 *   node scripts/split-registry.mjs --prefer-monolith  # an id filed with DIFFERENT text: re-file the monolith's
 *                                                    # text in place (same position) instead of stopping — only
 *                                                    # when the monolith is known to be the newer side
 *
 * How a rule is found: the monolith's array body is walked at its top level — a rule is one `  {` … `  },`
 * object (two-space indent), together with any top-level comment lines directly above it. Its `domain`
 * and `id` are read from the four-space-indented `domain: '…'` / `id: '…'` lines. The script proves the
 * walk lost nothing by reassembling the chunks and comparing them to the original body (sha256 printed).
 *
 * Shared prelude constants (`const HANDOFF = …` and friends, with the doc comment above each) go to
 * `approved/shared.ts`; a domain file imports only the ones its rules reference.
 *
 * Exit code 1 on any ambiguity (a rule with no domain line, a domain the index does not list, a rule id
 * whose text differs from the copy already filed) — it never guesses.
 */
import { createHash } from 'node:crypto';
import { existsSync, readFileSync, unlinkSync, writeFileSync, mkdirSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const argv = process.argv.slice(2);
const has = (name) => argv.includes(`--${name}`);
const flag = (name) => {
  const i = argv.indexOf(`--${name}`);
  return i >= 0 && argv[i + 1] && !argv[i + 1].startsWith('--') ? argv[i + 1] : undefined;
};

const MONOLITH = flag('from') ?? join(ROOT, 'packages', 'rules', 'src', 'registry', 'approved.ts');
const OUT_DIR = join(ROOT, 'packages', 'rules', 'src', 'registry', 'approved');
const INDEX = join(OUT_DIR, 'index.ts');
const DRY = has('dry');

const sha = (s) => createHash('sha256').update(s).digest('hex');
const fail = (msg) => {
  console.error(`\n✗ ${msg}`);
  process.exit(1);
};

if (!existsSync(MONOLITH)) fail(`no monolith at ${MONOLITH} — nothing to split (the registry is already per-domain).`);
if (!existsSync(INDEX)) fail(`${INDEX} is missing — the domain index must exist before a split (it lists the domain order).`);

/** The fixed domain order is owned by the index: `APPROVED_DOMAIN_ORDER = ['foundation', …]`. */
function domainOrderFromIndex() {
  const src = readFileSync(INDEX, 'utf8');
  const m = src.match(/APPROVED_DOMAIN_ORDER[^=]*=\s*\[([\s\S]*?)\]/);
  if (!m) fail('could not read APPROVED_DOMAIN_ORDER from approved/index.ts');
  return [...m[1].matchAll(/'([a-z]+)'/g)].map((x) => x[1]);
}

/**
 * Split a `<NAME>_RULES: GameRule[] = [ … ];` source into { prelude, open, body, close, chunks }.
 * A chunk is { text, id, domain, comment } where text is the exact source (comment lines included).
 */
function parseRegistrySource(src, exportName) {
  const lines = src.split('\n');
  const openRe = new RegExp(`^export const ${exportName}[^=]*=\\s*\\[\\s*$`);
  const openAt = lines.findIndex((l) => openRe.test(l));
  if (openAt < 0) fail(`no \`export const ${exportName} … = [\` line found`);
  let closeAt = -1;
  for (let i = lines.length - 1; i > openAt; i--) if (lines[i] === '];') { closeAt = i; break; }
  if (closeAt < 0) fail('no closing `];` line found');
  const bodyLines = lines.slice(openAt + 1, closeAt);

  const chunks = [];
  let pending = []; // top-level comment / blank lines waiting for their rule
  let current = null;
  for (const line of bodyLines) {
    if (current) {
      current.push(line);
      if (line === '  },') {
        const text = current.join('\n') + '\n';
        chunks.push(describeChunk(text));
        current = null;
      }
      continue;
    }
    if (line === '  {') {
      current = [...pending, line];
      pending = [];
      continue;
    }
    if (line.trim() === '' || /^\s*(\/\/|\/\*|\*)/.test(line)) { pending.push(line); continue; }
    fail(`unexpected top-level line inside the array (not a rule, not a comment): ${JSON.stringify(line)}`);
  }
  if (current) fail('the last rule never closed (`  },` missing)');
  if (pending.some((l) => l.trim() !== '')) fail(`trailing comment lines with no rule after them: ${JSON.stringify(pending)}`);

  const body = bodyLines.join('\n') + (bodyLines.length ? '\n' : '');
  const reassembled = chunks.map((c) => c.text).join('') + pending.join('\n');
  return {
    prelude: lines.slice(0, openAt).join('\n') + '\n',
    open: lines[openAt],
    body,
    close: lines.slice(closeAt).join('\n'),
    chunks,
    lossless: reassembled === body || reassembled === body.replace(/\n+$/, '\n'),
  };
}

function describeChunk(text) {
  const ids = [...text.matchAll(/^    id: '([^']+)',\s*$/gm)].map((m) => m[1]);
  const domains = [...text.matchAll(/^    domain: '([^']+)',\s*$/gm)].map((m) => m[1]);
  if (ids.length !== 1) fail(`a rule chunk has ${ids.length} four-space \`id:\` lines (expected exactly one):\n${text.slice(0, 200)}`);
  if (domains.length !== 1) fail(`rule ${ids[0]} has ${domains.length} four-space \`domain:\` lines (expected exactly one)`);
  return { text, id: ids[0], domain: domains[0] };
}

/** `const NAME = …;` declarations in the prelude, each with the doc comment directly above it. */
function preludeConstants(prelude) {
  const lines = prelude.split('\n');
  const out = [];
  for (let i = 0; i < lines.length; i++) {
    const m = lines[i].match(/^const ([A-Z_][A-Z0-9_]*) = /);
    if (!m) continue;
    let start = i;
    while (start > 0 && /^(\/\*\*|\s\*|\s\*\/)/.test(lines[start - 1])) start--;
    // a `/** … */` block directly above (possibly one line), stop at a blank line
    const block = lines.slice(start, i + 1);
    out.push({ name: m[1], text: block.join('\n') + '\n' });
  }
  return out;
}

const DOMAIN_ORDER = domainOrderFromIndex();
const exportNameOf = (domain) => `${domain.toUpperCase()}_RULES`;
const src = readFileSync(MONOLITH, 'utf8');
const parsed = parseRegistrySource(src, 'APPROVED_RULES');
if (!parsed.lossless) fail('the chunk walk did not reassemble to the original array body — refusing to write anything');
console.log(`monolith ${MONOLITH}`);
console.log(`  ${parsed.chunks.length} rules · array body sha256 ${sha(parsed.body)} · reassembled from chunks: identical`);

const constants = preludeConstants(parsed.prelude);
const unknownDomains = [...new Set(parsed.chunks.map((c) => c.domain))].filter((d) => !DOMAIN_ORDER.includes(d));
if (unknownDomains.length) fail(`domain(s) not listed in approved/index.ts APPROVED_DOMAIN_ORDER: ${unknownDomains.join(', ')} — add the domain to RuleDomain (schema.ts), the order and the record in approved/index.ts, then re-run`);

const seen = new Map();
for (const c of parsed.chunks) {
  if (seen.has(c.id)) fail(`duplicate rule id in the monolith: ${c.id}`);
  seen.set(c.id, c);
}

function fileHeader(domain) {
  return `/**
 * APPROVED RULES — domain \`${domain}\`.
 *
 * One file per \`RuleDomain\` so concurrent PRs stop colliding on one tail: a new rule is APPENDED to the end
 * of THIS array (\`R-<TOPIC>-<NN>\`, ids stable and never recycled, the owner's words as evidence, the
 * regression test as \`enforcement.refs\` — recipe in CLAUDE.md, "Bug fixes become rules"). The index
 * (\`./index.ts\`) concatenates every domain file in a fixed order into \`APPROVED_RULES\`; \`approved.test.ts\`
 * fails a rule filed under the wrong domain. Never hand-edit the array's shape; never move a rule between
 * files without an owner ruling that its domain changed.
 */
`;
}

function importLines(names) {
  const lines = ["import type { GameRule } from '../../schema';"];
  if (names.length) lines.push(`import { ${names.join(', ')} } from './shared';`);
  return lines.join('\n') + '\n';
}

const usedConstants = (text) => constants.filter((k) => new RegExp(`\\b${k.name}\\b`).test(text)).map((k) => k.name);

let written = 0;
let appended = 0;
const perDomain = new Map(DOMAIN_ORDER.map((d) => [d, []]));
for (const c of parsed.chunks) perDomain.get(c.domain).push(c);

if (!DRY) mkdirSync(OUT_DIR, { recursive: true });

// shared.ts — every prelude constant, verbatim (merge: union of what is there and what the monolith has)
{
  const sharedPath = join(OUT_DIR, 'shared.ts');
  const existing = existsSync(sharedPath) ? readFileSync(sharedPath, 'utf8') : null;
  const missing = constants.filter((k) => !existing || !new RegExp(`^export const ${k.name} = `, 'm').test(existing));
  if (!existing || missing.length) {
    const head = existing ?? `/**
 * Shared evidence locators for the approved registry (imported by the domain files that cite them).
 * Add a constant here only when more than one domain file needs it; a one-file locator belongs in that file.
 */
`;
    const next = head + missing.map((k) => '\n' + k.text.replace(/^const /m, 'export const ')).join('');
    console.log(`  shared.ts ← ${missing.map((k) => k.name).join(', ') || '(unchanged)'}`);
    if (!DRY) writeFileSync(sharedPath, next);
  }
}

for (const domain of DOMAIN_ORDER) {
  const path = join(OUT_DIR, `${domain}.ts`);
  const exportName = exportNameOf(domain);
  const incoming = perDomain.get(domain);
  if (existsSync(path)) {
    const cur = parseRegistrySource(readFileSync(path, 'utf8'), exportName);
    if (!cur.lossless) fail(`${path}: could not walk the existing array losslessly — refusing to touch it`);
    const have = new Map(cur.chunks.map((c) => [c.id, c]));
    const fresh = [];
    const amended = [];
    for (const c of incoming) {
      const filed = have.get(c.id);
      if (!filed) { fresh.push(c); continue; }
      if (filed.text === c.text) continue;
      if (!has('prefer-monolith')) fail(`${c.id} is already filed in ${path} with DIFFERENT text than the monolith — merge that rule by hand (or re-run with --prefer-monolith to re-file the monolith's text in place), then re-run`);
      amended.push(c);
    }
    for (const [id, c] of have) if (c.domain !== domain) fail(`${path} holds ${id} whose domain is '${c.domain}'`);
    if (!fresh.length && !amended.length) continue;
    // an amended rule keeps its position in the domain file; only its text is replaced by the monolith's
    let body = cur.body;
    for (const c of amended) body = body.replace(have.get(c.id).text, c.text);
    if (amended.length) console.log(`  ${domain}.ts ⟲ re-filed from the monolith: ${amended.map((c) => c.id).join(', ')}`);
    const needed = usedConstants([...fresh, ...amended].map((c) => c.text).join(''));
    let prelude = cur.prelude;
    const importRe = /^import \{ ([^}]+) \} from '\.\/shared';\n/m;
    const m = prelude.match(importRe);
    const present = m ? m[1].split(',').map((s) => s.trim()) : [];
    const union = [...new Set([...present, ...needed])];
    if (union.length && union.length !== present.length) {
      const line = `import { ${union.join(', ')} } from './shared';\n`;
      prelude = m ? prelude.replace(importRe, line) : prelude.replace(/^(import type \{ GameRule \} from '\.\.\/\.\.\/schema';\n)/m, `$1${line}`);
    }
    const next = prelude + cur.open + '\n' + body + fresh.map((c) => c.text).join('') + cur.close;
    if (fresh.length) console.log(`  ${domain}.ts ← +${fresh.length}: ${fresh.map((c) => c.id).join(', ')}`);
    if (!DRY) writeFileSync(path, next);
    appended += fresh.length;
    continue;
  }
  const needed = usedConstants(incoming.map((c) => c.text).join(''));
  const body = incoming.map((c) => c.text).join('');
  const next = `${fileHeader(domain)}${importLines(needed)}\nexport const ${exportName}: GameRule[] = [\n${body}];\n`;
  console.log(`  ${domain}.ts ← ${incoming.length} rule(s)${incoming.length ? `: ${incoming.map((c) => c.id).join(', ')}` : ''}`);
  if (!DRY) writeFileSync(path, next);
  written += 1;
}

console.log(`\n${DRY ? 'DRY RUN — ' : ''}${written} domain file(s) created · ${appended} rule(s) appended to existing files · ${parsed.chunks.length} rules accounted for`);
if (has('rm') && !DRY) {
  unlinkSync(MONOLITH);
  console.log(`  removed ${MONOLITH}`);
} else if (!DRY) {
  console.log(`  next: git rm ${MONOLITH.replace(ROOT + '\\', '').replace(ROOT + '/', '')}  (or re-run with --rm), then npx vitest run packages/rules`);
}
