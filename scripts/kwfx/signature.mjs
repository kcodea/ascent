// The authored keyword auras' signature: the sources that define their look, with comments and whitespace removed.
// scripts/kwfx/capture.mjs stamps it into packages/ui/src/kwfx/manifest.json; kwfx.test.ts recomputes it, so an edit
// to an authored aura without a re-bake fails the suite.
import fs from 'node:fs';
import path from 'node:path';
import crypto from 'node:crypto';
import { fileURLToPath } from 'node:url';

export const REPO_ROOT = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');

export function auraSignature(root = REPO_ROOT) {
  const strip = (s) => s.replace(/\/\*[\s\S]*?\*\//g, '').replace(/(^|[^:'"])\/\/.*$/gm, '$1').replace(/\s+/g, '');
  const ui = path.join(root, 'packages/ui/src');
  const css = fs.readFileSync(path.join(ui, 'styles.css'), 'utf8');
  const a = css.indexOf('/* KWFX-LIVE-BEGIN'); const b = css.indexOf('/* KWFX-LIVE-END');
  if (a < 0 || b < 0) throw new Error('styles.css: the KWFX-LIVE-BEGIN / KWFX-LIVE-END markers are missing');
  const h = crypto.createHash('sha256');
  h.update(strip(css.slice(a, b)));
  // Card.tsx: the aura components only (the file is a hot one; the rest of it is not the look).
  const card = fs.readFileSync(path.join(ui, 'Card.tsx'), 'utf8');
  const ca = card.indexOf('// KWFX-LIVE-BEGIN'); const cb = card.indexOf('// KWFX-LIVE-END');
  if (ca < 0 || cb < 0) throw new Error('Card.tsx: the KWFX-LIVE-BEGIN / KWFX-LIVE-END markers are missing');
  h.update(strip(card.slice(ca, cb)));
  for (const f of ['executeConfig.ts', 'flurryConfig.ts', 'rebirthConfig.ts', 'rebirthCrown.ts']) h.update(strip(fs.readFileSync(path.join(ui, f), 'utf8')));
  return h.digest('hex').slice(0, 16);
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) console.log(auraSignature());
