#!/usr/bin/env node
/**
 * Scaffold a new hero attack style from an existing one.
 *
 *   npm run attack:new -- <name> [--from void] [--icon ✨] [--label "Frost Lance"] [--dry-run]
 *
 * Copies `packages/ui/src/hero<From>/` and `Hero<From>Tuner.tsx` under the new name, renames every identifier, and
 * registers the style everywhere a style has to be registered (the style list, the dev override, the fight, the
 * Collection preview, the dev menu, the tuner lists, the sound clip list and the shared test sweeps). The result
 * plays at once, as a DEV-ONLY style with no cosmetic: it looks exactly like the one it was copied from until it is
 * restyled.
 *
 * It only adds. It never touches `packages/progression` (the cosmetic catalog), patch notes or the rules docs: those
 * belong to the PR that gives the style a cosmetic.
 *
 * Every edit is anchored on text that must be there; a missing anchor stops the run BEFORE anything is written, so a
 * failed run leaves the tree untouched.
 */
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..');
const SRC = path.join(ROOT, 'packages', 'ui', 'src');

function fail(msg) { console.error(`attack:new: ${msg}`); process.exit(1); }

// ---- arguments ------------------------------------------------------------------------------------------------------
const argv = process.argv.slice(2);
const flag = (n) => { const i = argv.indexOf(`--${n}`); if (i < 0) return undefined; const v = argv[i + 1]; argv.splice(i, 2); return v; };
const dryIdx = argv.indexOf('--dry-run'); const dry = dryIdx >= 0; if (dry) argv.splice(dryIdx, 1);
const from = (flag('from') ?? 'void').toLowerCase();
const icon = flag('icon') ?? '✨';
const labelArg = flag('label');
const name = argv[0];
if (!name || argv.length !== 1) fail('usage: npm run attack:new -- <name> [--from void] [--icon ✨] [--label "Name"] [--dry-run]');
if (!/^[a-z][a-z0-9]{2,19}$/.test(name)) fail(`"${name}" must be one lowercase word, 3 to 20 letters or digits (it becomes the style id, e.g. "frostlance").`);
// TypeScript words would collide with the generated object keys and identifiers.
if (['new', 'delete', 'class', 'function', 'default', 'auto', 'classic', 'attack'].includes(name)) fail(`"${name}" is reserved; pick another name.`);

const cap = (s) => s[0].toUpperCase() + s.slice(1);
const New = cap(name), NEW = name.toUpperCase();
const label = labelArg ?? New;

// The source: its folder is `hero<Pascal>` where Pascal lower-cases to the style id (heroBulletTime -> bullettime).
const folders = fs.readdirSync(SRC).filter((d) => /^hero[A-Z]/.test(d) && fs.statSync(path.join(SRC, d)).isDirectory());
const fromFolder = folders.find((d) => d.slice(4).toLowerCase() === from);
if (!fromFolder) fail(`no attack folder for "${from}". Known: ${folders.map((d) => d.slice(4).toLowerCase()).filter((s) => !['attack', 'blast'].includes(s)).join(', ')}`);
if (['attack', 'blast'].includes(from)) fail(`"${from}" is shared machinery, not a style to copy.`);
const From = fromFolder.slice(4);                      // e.g. Void, BulletTime
const FROM_SNAKE = From.replace(/([a-z0-9])([A-Z])/g, '$1_$2').toUpperCase(); // BULLET_TIME
const fromCamel = From[0].toLowerCase() + From.slice(1); // bulletTime
const FROM_FLAT = From.toUpperCase();                  // BULLETTIME
if (folders.some((d) => d.slice(4).toLowerCase() === name)) fail(`the style "${name}" already exists (packages/ui/src/hero${New}/).`);
const tunerFrom = path.join(SRC, `Hero${From}Tuner.tsx`);
if (!fs.existsSync(tunerFrom)) fail(`Hero${From}Tuner.tsx not found.`);

// ---- the rename -----------------------------------------------------------------------------------------------------
/** Rename the source style's identifiers in copied text. Bare lowercase words are left alone unless quoted as the
 *  style id: `void` is a TypeScript keyword, and prose reads fine with the capitalised name swapped. */
function rename(text) {
  let s = text;
  s = s.split(`Hero${From}`).join(`Hero${New}`);
  s = s.split(`hero${From}`).join(`hero${New}`);
  s = s.split(`HERO_${FROM_SNAKE}`).join(`HERO_${NEW}`);
  s = s.split(`HERO_${FROM_FLAT}`).join(`HERO_${NEW}`);
  s = s.split(`hero${from}`).join(`hero${name}`);       // tuner id + localStorage key
  s = s.replace(new RegExp(`(['"\`.])h${from}\\b`, 'g'), `$1h${name}`); // the root CSS class ('hvoid', '.hvoid')
  s = s.replace(new RegExp(`\\b${FROM_SNAKE}_`, 'g'), `${NEW}_`);       // VOID_DISC_FILL
  s = s.replace(new RegExp(`\\b${FROM_FLAT}_`, 'g'), `${NEW}_`);
  s = s.replace(new RegExp(`(['"\`])${from}\\1`, 'g'), `$1${name}$1`);  // the quoted style id
  s = s.replace(new RegExp(`\\b${from}(?=[A-Z])`, 'g'), name);          // camelCase helpers: voidPlan, voidCues
  s = s.replace(new RegExp(`\\b${fromCamel}(?=[A-Z])`, 'g'), name);
  s = s.replace(new RegExp(`\\b${From}\\b`, 'g'), New);                 // prose and labels
  return s;
}

/** Drop a copied test's top-level `describe('the cosmetic', …)`: the new style has no cosmetic to resolve. */
function stripCosmeticDescribe(text) {
  const lines = text.split('\n');
  const a = lines.findIndex((l) => /^describe\((['"`])the cosmetic/.test(l));
  if (a < 0) return { text, stripped: false };
  const b = lines.findIndex((l, i) => i > a && /^\}\);/.test(l));
  if (b < 0) return { text, stripped: false };
  lines.splice(a, b - a + 1);
  while (lines[a - 1] === '' && (lines[a] === '' || lines[a] === undefined)) lines.splice(a - 1, 1);
  return { text: lines.join('\n'), stripped: true };
}

// ---- staged writes (nothing touches disk until every anchor has been found) ---------------------------------------
const writes = new Map();          // absolute path -> new content
const notes = [];
const read = (rel) => { const p = path.join(SRC, rel); return writes.get(p) ?? fs.readFileSync(p, 'utf8'); };
const stage = (rel, content) => writes.set(path.join(SRC, rel), content);

/** Edit one registration file line-wise. `fn` gets the lines and helpers that throw on a missing anchor. */
function edit(rel, fn) {
  const eol = read(rel).includes('\r\n') ? '\r\n' : '\n';
  const lines = read(rel).split(eol);
  const find = (re, what) => { const i = lines.findIndex((l) => re.test(l)); if (i < 0) fail(`${rel}: anchor not found (${what}). Nothing was written.`); return i; };
  const findLast = (re, what) => { let i = -1; lines.forEach((l, k) => { if (re.test(l)) i = k; }); if (i < 0) fail(`${rel}: anchor not found (${what}). Nothing was written.`); return i; };
  fn({ lines, find, findLast, after: (i, ...add) => lines.splice(i + 1, 0, ...add), before: (i, ...add) => lines.splice(i, 0, ...add) });
  stage(rel, lines.join(eol));
}
/** Duplicate each line matching `re` (it names the source style), renamed, right under it. */
function dup(rel, re, what, also = (l) => l) {
  edit(rel, ({ lines, find }) => {
    find(re, what);
    for (let i = lines.length - 1; i >= 0; i--) if (re.test(lines[i])) lines.splice(i + 1, 0, also(rename(lines[i])));
  });
}
const esc = (s) => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

// 1) the copied folder + tuner
const BANNER = `// SCAFFOLDED from hero${From}/ by \`npm run attack:new\` (${new Date().toISOString().slice(0, 10)}). The code and the comments below were\n// copied with the names swapped: any design note, date or quote in them is about ${From}, not this style, until rewritten.\n`;
const newFolder = `hero${New}`;
for (const f of fs.readdirSync(path.join(SRC, fromFolder))) {
  const p = path.join(SRC, fromFolder, f);
  if (!fs.statSync(p).isFile()) fail(`${fromFolder}/${f} is a folder; this scaffold only copies flat style folders.`);
  if (!/\.(ts|tsx|css|json|md)$/.test(f)) { writes.set(path.join(SRC, newFolder, rename(f)), fs.readFileSync(p)); continue; }
  let text = rename(fs.readFileSync(p, 'utf8'));
  if (/\.test\.tsx?$/.test(f)) {
    const r = stripCosmeticDescribe(text);
    text = r.text;
    if (r.stripped) notes.push(`${newFolder}/${rename(f)}: the copied "the cosmetic" tests were removed (no cosmetic yet). If typecheck or lint now reports an unused import there, delete that import.`);
  }
  if (/\.tsx?$/.test(f)) text = BANNER + text;
  stage(path.join(newFolder, rename(f)), text);
}
stage(`Hero${New}Tuner.tsx`, BANNER + rename(fs.readFileSync(tunerFrom, 'utf8')).replace(new RegExp(`Hero Attack: ${New}[^'"\`]*`), `Hero Attack: ${label}`));

// 2) the style list, the dev override and its label
edit('heroBlast/heroAttackStyle.ts', ({ lines, find }) => {
  for (const c of ['HERO_ATTACK_STYLES', 'DEV_HERO_ATTACK_CHOICES']) {
    const i = find(new RegExp(`^export const ${c} = \\[.*\\] as const;`), `${c} list`);
    lines[i] = lines[i].replace('] as const;', `, '${name}'] as const;`);
  }
  const l0 = find(/^export const DEV_HERO_ATTACK_LABELS\b/, 'DEV_HERO_ATTACK_LABELS');
  const l1 = lines.findIndex((l, i) => i > l0 && /^\};/.test(l));
  if (l1 < 0) fail('heroBlast/heroAttackStyle.ts: end of DEV_HERO_ATTACK_LABELS not found. Nothing was written.');
  lines.splice(l1, 0, `  ${name}: '${label.replace(/'/g, "\\'")} (in progress, no cosmetic yet)',`);
  const d = find(/^ \* The style is the ATTACKER's/, 'the doc comment');
  lines.splice(d, 0,
    ` * \`${name}\` is IN PROGRESS and has NO cosmetic yet, so no player can equip it; it plays only through the dev`,
    ` * "Attack style" override. Scaffolded from \`${from}\` (\`npm run attack:new\`), see \`../${newFolder}/\`.`,
    ' *');
});

// 3) the fight (Recruit) and the Collection preview
dup('Recruit.tsx', new RegExp(`^import .* from './${esc(fromFolder)}/`), `the ${from} imports`);
edit('Recruit.tsx', ({ lines, find, after }) => {
  const i = find(/^\s*const runner = attackStyle === '/, 'the runner chain');
  if (!/^\s*\? \{ play: /.test(lines[i + 1] ?? '')) fail('Recruit.tsx: the runner chain is not shaped as expected. Nothing was written.');
  const pad = /^\s*/.exec(lines[i + 1])[0];
  after(i + 1, `${pad}: attackStyle === '${name}'`, `${pad}? { play: playHero${New}, preview: hero${New}PreviewSpeed() }`);
});
dup('heroBlast/HeroAttackPreview.tsx', new RegExp(`^import .* from '../${esc(fromFolder)}/`), `the ${from} imports`);
dup('heroBlast/HeroAttackPreview.tsx', new RegExp(`^  ${from}: \\{ play: `), `the ${from} preview entry`, (l) => l.replace(`  ${from}: {`, `  ${name}: {`));

// 4) the dev menu and the tuner lists
dup('DevMenu.tsx', new RegExp(`^import \\{ Hero${From}Tuner \\}`), `the ${from} tuner import`);
edit('DevMenu.tsx', ({ find, after }) => {
  const i = find(new RegExp(`^\\s*\\{ key: 'hero${from}',`), `the ${from} tuner entry`);
  after(i, `      { key: 'hero${name}', icon: '${icon}', label: 'Hero Attack: ${label.replace(/'/g, "\\'")}', C: Hero${New}Tuner, hint: 'The ${label.replace(/'/g, "\\'")} hero attack (in progress, no cosmetic yet). Play it in either direction at each tier.' },`);
});
dup('tunerAll.ts', new RegExp(`^import \\{ SPEC as Hero${From}Spec \\}`), `the ${from} spec import`);
dup('tunerAll.ts', new RegExp(`^  Hero${From}Spec,`), `the ${from} spec entry`);
edit('tunerSchema.ts', ({ find, after }) => after(find(/^  heroblast: /, 'the tuner icon map'), `  hero${name}: '${icon}',`));

// 5) the sound clip list: the new folder names the same clips as the one it was copied from
edit('audio/codeClips.ts', ({ lines, find }) => {
  const open = find(/^export const ATTACK_FX_CLIPS\b/, 'ATTACK_FX_CLIPS');
  const a = lines.findIndex((l, i) => i > open && new RegExp(`^  ${from}: \\[`).test(l));
  if (a < 0) { notes.push(`audio/codeClips.ts: "${from}" names no clips of its own, so none were added for "${name}".`); return; }
  const b = /\],\s*$/.test(lines[a]) ? a : lines.findIndex((l, i) => i > a && /^  \],/.test(l));
  if (b < 0) fail('audio/codeClips.ts: end of the source clip list not found. Nothing was written.');
  const block = lines.slice(a, b + 1); block[0] = block[0].replace(`  ${from}: [`, `  ${name}: [`);
  lines.splice(b + 1, 0, ...block);
});

// 6) the shared test sweeps
edit('heroAttack/attackTunerButtons.test.ts', ({ lines, find, after }) => {
  after(find(/^import \{ SPEC as FORMATION \}/, 'the formation import'), `import { SPEC as ${NEW} } from '../Hero${New}Tuner';`);
  const i = find(/^const SPECS = \{ /, 'SPECS');
  lines[i] = lines[i].replace('const SPECS = { ', `const SPECS = { ${NEW}, `);
});
for (const rel of ['heroAttack/damageFormation.test.ts', 'heroAttack/knockoutTier.test.ts']) {
  dup(rel, new RegExp(`^import .* from '../${esc(fromFolder)}/${esc(fromFolder)}';`), `the ${from} runner import`);
  dup(rel, new RegExp(`^\\s*\\['${from}', \\(o\\) => playHero${From}\\(`), `the ${from} runner row`);
}
dup('heroAttack/stageCamera.test.ts', new RegExp(`^import .* from '../${esc(fromFolder)}/${esc(fromFolder)}';`), `the ${from} runner import`);
edit('heroAttack/stageCamera.test.ts', ({ find, after }) => {
  after(find(new RegExp(`\\['${from}', playHero${From} as Runner\\]`), `the ${from} runner row`), `  ['${name}', playHero${New} as Runner],`);
});

// ---- write ----------------------------------------------------------------------------------------------------------
const rel = (p) => path.relative(ROOT, p).split(path.sep).join('/');
const created = [...writes.keys()].filter((p) => !fs.existsSync(p)), changed = [...writes.keys()].filter((p) => fs.existsSync(p));
console.log(`${dry ? 'Would scaffold' : 'Scaffolded'} "${name}" from "${from}":`);
for (const p of created) console.log(`  new      ${rel(p)}`);
for (const p of changed) console.log(`  changed  ${rel(p)}`);
if (!dry) for (const [p, content] of writes) { fs.mkdirSync(path.dirname(p), { recursive: true }); fs.writeFileSync(p, content); }
for (const n of notes) console.log(`note: ${n}`);
console.log(dry ? '\nDry run: nothing was written.' : `
Next:
  1. npm run dev, open the dev menu, "Hero Attack: ${label}". It plays exactly like ${From} until you restyle it.
  2. Restyle in packages/ui/src/${newFolder}/ (Config = dials and defaults, Scene = what is drawn, Textures = painted shapes).
  3. Tune in the tuner, Copy JSON, bake it into the defaults.
  4. npm run typecheck && npm run lint && npm test && npm run build:web
It has no cosmetic: players cannot equip it until one is added in packages/progression (Kevin's side).`);
