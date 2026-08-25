/**
 * `npm run tutorial:sync` — pull the Learn Ascent tutorial copy from the authoring Google Sheet and write it
 * into `packages/sim/src/tutorial/learnAscent.ts`, keyed by step id.
 *
 * THE SHEET IS THE SOURCE OF TRUTH. Every title / body / why in the tutorial is authored in the sheet and this
 * tool stamps it into the code — so a wording fix made ONLY in the code is overwritten the next time this runs.
 * Fix copy in the sheet, then re-run, or your change will not survive.
 *
 *   npm run tutorial:sync              # dry run: report what WOULD change, write nothing
 *   npm run tutorial:sync -- --apply   # write the changes into learnAscent.ts
 *   npm run tutorial:sync -- --gid=NNN --sheet=ID   # point at a different tab / sheet
 *
 * After `--apply`, run the gates: `npm run typecheck && npm run lint && npm test && npm run build:web`.
 *
 * HOW IT MAPS. The sheet's `ID` column is the step id. Each step's copy lives in one of two syntactic homes,
 * and this tool DETECTS which from the source rather than hardcoding a round list:
 *   - a factory call — heroPowerReminderStep / endTurnStep / tierStep / freeBuildStep / combatDebriefStep —
 *     whose title/body/why are positional string args, or
 *   - an inline step / foundation-panel object literal with `title:` / `body:` / `why:` keys.
 * `order-demo` is the course's `orderDemo` block (body + debrief). A `why` the sheet adds to a step whose
 * form has no slot for one (a hero-power or end-turn beat) is a hard error, not a silent drop.
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { getTutorialCourse } from '@game/sim';

const APPLY = process.argv.includes('--apply');
const arg = (name: string): string | undefined =>
  process.argv.find((a) => a.startsWith(`--${name}=`))?.split('=').slice(1).join('=');

const SHEET_ID = arg('sheet') ?? '1DIaIq_dee8jCmG7u-5zfDQwvXJAdpbl4oS0EtkcO5y4';
const GID = arg('gid') ?? '854534296';
const COURSE_ID = 'learn-ascent';
const FILE = 'packages/sim/src/tutorial/learnAscent.ts';

// ─── Sheet fetch + CSV parse ────────────────────────────────────────────────────────────────────────────────

interface Copy { title: string; body: string; why: string }

function parseCsv(text: string): string[][] {
  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  for (let i = 0; i < text.length; i++) {
    const c = text[i];
    if (inQuotes) {
      if (c === '"') {
        if (text[i + 1] === '"') { field += '"'; i++; } else inQuotes = false;
      } else field += c;
    } else if (c === '"') inQuotes = true;
    else if (c === ',') { row.push(field); field = ''; }
    else if (c === '\n') { row.push(field); rows.push(row); row = []; field = ''; }
    else if (c === '\r') { /* ignore; \n ends the row */ }
    else field += c;
  }
  if (field !== '' || row.length) { row.push(field); rows.push(row); }
  return rows;
}

const normalize = (s: string | undefined): string => (s ?? '').replace(/\s+/g, ' ').trim();

async function fetchSheet(): Promise<Map<string, Copy>> {
  const url = `https://docs.google.com/spreadsheets/d/${SHEET_ID}/export?format=csv&gid=${GID}`;
  const res = await fetch(url);
  if (!res.ok) throw new Error(`sheet fetch failed: ${res.status} ${res.statusText} (${url})`);
  const rows = parseCsv(await res.text());
  const header = rows[0].map((h) => h.trim());
  const col = (name: string): number => {
    const i = header.indexOf(name);
    if (i < 0) throw new Error(`sheet is missing the "${name}" column (has: ${header.join(', ')})`);
    return i;
  };
  const [idc, tc, bc, wc] = [col('ID'), col('Title'), col('Body copy'), col('Why (rationale)')];
  const out = new Map<string, Copy>();
  for (const r of rows.slice(1)) {
    const id = (r[idc] ?? '').trim();
    if (!id) continue;
    out.set(id, { title: normalize(r[tc]), body: normalize(r[bc]), why: normalize(r[wc]) });
  }
  return out;
}

// ─── TS string-literal emit (prefer the file's single-quote style; minimal churn) ──────────────────────────

function jsLit(s: string): string {
  const esc = s.replace(/\\/g, '\\\\');
  if (!s.includes("'")) return `'${esc}'`;
  if (!s.includes('"')) return `"${esc}"`;
  return `'${esc.replace(/'/g, "\\'")}'`;
}

// ─── Call-argument parsing (quote + bracket aware) ──────────────────────────────────────────────────────────

function findCall(text: string, func: string, id: string): { start: number; argsStart: number; close: number } | null {
  const re = new RegExp(`${func}\\(\\s*'${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}'`);
  const m = re.exec(text);
  if (!m) return null;
  const open = text.indexOf('(', m.index);
  let depth = 0, str: string | null = null;
  for (let j = open; j < text.length; j++) {
    const c = text[j];
    if (str) { if (c === str && text[j - 1] !== '\\') str = null; }
    else if (c === "'" || c === '"') str = c;
    else if (c === '(') depth++;
    else if (c === ')') { depth--; if (depth === 0) return { start: m.index, argsStart: open + 1, close: j }; }
  }
  return null;
}

/** Raw arg spans (whitespace trimmed to the literal core), in order. */
function parseArgs(text: string, argsStart: number, argsEnd: number): { start: number; end: number }[] {
  const spans: { start: number; end: number }[] = [];
  let depth = 0, str: string | null = null, start = argsStart;
  for (let j = argsStart; j < argsEnd; j++) {
    const c = text[j];
    if (str) { if (c === str && text[j - 1] !== '\\') str = null; }
    else if (c === "'" || c === '"') str = c;
    else if (c === '(' || c === '[' || c === '{') depth++;
    else if (c === ')' || c === ']' || c === '}') depth--;
    else if (c === ',' && depth === 0) { spans.push({ start, end: j }); start = j + 1; }
  }
  spans.push({ start, end: argsEnd });
  return spans.map(({ start: s, end: e }) => {
    const raw = text.slice(s, e);
    const lead = raw.length - raw.trimStart().length;
    const trail = raw.length - raw.trimEnd().length;
    return { start: s + lead, end: e - trail };
  });
}

const stripQuotes = (lit: string): string => {
  const t = lit.trim();
  if ((t.startsWith("'") && t.endsWith("'")) || (t.startsWith('"') && t.endsWith('"'))) {
    return t.slice(1, -1).replace(/\\(['"\\])/g, '$1');
  }
  return t;
};

// ─── Field locate / read / write, per form ──────────────────────────────────────────────────────────────────

interface FactorySpec { func: string; title: number; body: number; why: number | null }
const FACTORIES: FactorySpec[] = [
  { func: 'heroPowerReminderStep', title: 1, body: 2, why: null },
  { func: 'endTurnStep', title: 1, body: 2, why: null },
  { func: 'tierStep', title: 2, body: 3, why: 4 },
  { func: 'freeBuildStep', title: 1, body: 2, why: 3 },
  { func: 'combatDebriefStep', title: 1, body: 2, why: 5 },
];

type Edit = { start: number; end: number; text: string };

/** Read the three copy fields for an id from the CURRENT text (or null if the id/form isn't found). */
function readCopy(text: string, id: string): Copy | null {
  const fac = FACTORIES.find((f) => findCall(text, f.func, id));
  if (fac) {
    const call = findCall(text, fac.func, id)!;
    const args = parseArgs(text, call.argsStart, call.close);
    const at = (i: number): string => (i < args.length ? stripQuotes(text.slice(args[i].start, args[i].end)) : '');
    return { title: at(fac.title), body: at(fac.body), why: fac.why != null ? at(fac.why) : '' };
  }
  const reg = literalRegion(text, id);
  if (!reg) return null;
  const slice = text.slice(reg.start, reg.end);
  const read = (key: string): string => {
    const m = new RegExp(`${key}:\\s*('[^']*'|"[^"]*")`).exec(slice);
    return m ? stripQuotes(m[1]) : '';
  };
  return { title: read('title'), body: read('body'), why: read('why') };
}

function literalRegion(text: string, id: string): { start: number; end: number } | null {
  const m = new RegExp(`\\n[ \\t]*id: '${id.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}',`).exec(text);
  if (!m) return null;
  const start = m.index;
  const next = /\n[ \t]*id: '[^']*',/.exec(text.slice(m.index + m[0].length));
  const end = next ? m.index + m[0].length + next.index : Math.min(text.length, start + 4000);
  return { start, end };
}

/** Apply one id's new copy to the text, returning the new text. Throws with a clear message on a form that
 *  cannot hold the copy (e.g. a `why` on a hero-power beat). */
function writeCopy(text: string, id: string, next: Copy): string {
  const fac = FACTORIES.find((f) => findCall(text, f.func, id));
  if (fac) return writeFactory(text, id, fac, next);
  if (literalRegion(text, id)) return writeLiteral(text, id, next);
  throw new Error(`step '${id}' not found in ${FILE}`);
}

function splice(text: string, edits: Edit[]): string {
  let out = text;
  for (const e of [...edits].sort((a, b) => b.start - a.start)) out = out.slice(0, e.start) + e.text + out.slice(e.end);
  return out;
}

function writeFactory(text: string, id: string, spec: FactorySpec, next: Copy): string {
  const call = findCall(text, spec.func, id)!;
  const args = parseArgs(text, call.argsStart, call.close);
  const edits: Edit[] = [
    { start: args[spec.title].start, end: args[spec.title].end, text: jsLit(next.title) },
    { start: args[spec.body].start, end: args[spec.body].end, text: jsLit(next.body) },
  ];
  if (next.why) {
    if (spec.why == null) throw new Error(`step '${id}' (${spec.func}) has no 'why' slot but the sheet gives one — drop it in the sheet or change the step's form.`);
    if (spec.why < args.length) edits.push({ start: args[spec.why].start, end: args[spec.why].end, text: jsLit(next.why) });
    else if (spec.why === args.length) edits.push({ start: call.close, end: call.close, text: `, ${jsLit(next.why)}` }); // append
    else throw new Error(`step '${id}' (${spec.func}) cannot hold a 'why' at arg ${spec.why}: it needs the intervening optional args present. Add them in code first.`);
  } else if (spec.why != null && spec.why < args.length) {
    edits.push({ start: args[spec.why - 1].end, end: args[spec.why].end, text: '' }); // drop the why arg + its comma
  }
  return splice(text, edits);
}

function writeLiteral(text: string, id: string, next: Copy): string {
  const reg = literalRegion(text, id)!;
  let slice = text.slice(reg.start, reg.end);
  const setKey = (key: string, val: string): void => {
    const re = new RegExp(`(${key}:\\s*)('[^']*'|"[^"]*")`);
    if (!re.test(slice)) throw new Error(`step '${id}' literal has no ${key}:`);
    slice = slice.replace(re, (_m, pre) => `${pre}${jsLit(val)}`);
  };
  setKey('title', next.title);
  setKey('body', next.body);
  const hasWhy = /\n[ \t]*why:\s*('[^']*'|"[^"]*"),/.test(slice) || /why:\s*('[^']*'|"[^"]*")/.test(slice);
  if (next.why) {
    if (hasWhy) slice = slice.replace(/(why:\s*)('[^']*'|"[^"]*")/, (_m, pre) => `${pre}${jsLit(next.why)}`);
    else slice = slice.replace(/(\n([ \t]*)body:\s*('[^']*'|"[^"]*"),)/, (_m, whole, indent) => `${whole}\n${indent}why: ${jsLit(next.why)},`);
  } else if (hasWhy) {
    slice = slice.replace(/\n[ \t]*why:\s*('[^']*'|"[^"]*"),/, '');
  }
  return text.slice(0, reg.start) + slice + text.slice(reg.end);
}

// order-demo lives in the course's `orderDemo` block, not a step.
function writeOrderDemo(text: string, next: Copy): string {
  const m = /(orderDemo: \{\s*\n\s*body: )('[^']*'|"[^"]*")(,\s*\n\s*debrief: )('[^']*'|"[^"]*")/.exec(text);
  if (!m) throw new Error('orderDemo block not found');
  return text.slice(0, m.index) + `${m[1]}${jsLit(next.body)}${m[3]}${jsLit(next.why)}` + text.slice(m.index + m[0].length);
}
function readOrderDemo(text: string): Copy | null {
  const m = /orderDemo: \{\s*\n\s*body: ('[^']*'|"[^"]*"),\s*\n\s*debrief: ('[^']*'|"[^"]*")/.exec(text);
  return m ? { title: '', body: stripQuotes(m[1]), why: stripQuotes(m[2]) } : null;
}

// ─── Main ───────────────────────────────────────────────────────────────────────────────────────────────────

const eq = (a: string, b: string): boolean => normalize(a) === normalize(b);

async function main(): Promise<void> {
  const sheet = await fetchSheet();
  const course = getTutorialCourse(COURSE_ID);
  if (!course) throw new Error(`course ${COURSE_ID} not found`);

  // The full id list the course actually contains (so a stray/extra sheet row is reported, not applied blind).
  const courseIds = new Set<string>();
  for (const p of course.foundation) courseIds.add(p.id);
  if (course.orderDemo) courseIds.add('order-demo');
  for (const s of course.lobbyIntro) courseIds.add(s.id);
  for (const t of course.turns) for (const s of t.steps) courseIds.add(s.id);

  const missing = [...courseIds].filter((id) => !sheet.has(id));
  const extra = [...sheet.keys()].filter((id) => !courseIds.has(id));
  if (missing.length) console.warn(`⚠ ${missing.length} course step(s) absent from the sheet (left unchanged): ${missing.join(', ')}`);
  if (extra.length) console.warn(`⚠ ${extra.length} sheet row(s) not in the course (ignored): ${extra.join(', ')}`);

  let text = readFileSync(FILE, 'utf8');
  const changes: string[] = [];
  for (const id of courseIds) {
    const want = sheet.get(id);
    if (!want) continue;
    const cur = id === 'order-demo' ? readOrderDemo(text) : readCopy(text, id);
    if (!cur) throw new Error(`could not read current copy for '${id}'`);
    const diffs = (['title', 'body', 'why'] as const).filter((f) => (id === 'order-demo' && f === 'title') ? false : !eq(cur[f], want[f]));
    if (!diffs.length) continue;
    changes.push(`${id}: ${diffs.join(', ')}`);
    text = id === 'order-demo' ? writeOrderDemo(text, want) : writeCopy(text, id, want);
  }

  if (!changes.length) { console.log('✓ tutorial copy already matches the sheet — nothing to do.'); return; }

  console.log(`${changes.length} step(s) ${APPLY ? 'updated' : 'would change'}:`);
  for (const c of changes) console.log(`  ${c}`);

  if (!APPLY) { console.log('\nDry run — nothing written. Re-run with --apply to write these into the file.'); return; }

  writeFileSync(FILE, text, 'utf8');

  // Verify: re-read every field back out of the written text and confirm it equals the sheet.
  const after = readFileSync(FILE, 'utf8');
  const bad: string[] = [];
  for (const id of courseIds) {
    const want = sheet.get(id);
    if (!want) continue;
    const got = id === 'order-demo' ? readOrderDemo(after) : readCopy(after, id);
    for (const f of ['title', 'body', 'why'] as const) {
      if (id === 'order-demo' && f === 'title') continue;
      if (!got || !eq(got[f], want[f])) bad.push(`${id}.${f}`);
    }
  }
  if (bad.length) {
    console.error(`\n✗ verification FAILED for ${bad.length} field(s): ${bad.join(', ')}`);
    console.error(`  The file was written but does not match the sheet. Revert with: git checkout -- ${FILE}`);
    process.exit(1);
  }
  console.log(`\n✓ wrote ${FILE} and verified every field matches the sheet.`);
  console.log('  Now run: npm run typecheck && npm run lint && npm test && npm run build:web');
}

main().catch((e) => { console.error(String(e?.stack ?? e)); process.exit(1); });
