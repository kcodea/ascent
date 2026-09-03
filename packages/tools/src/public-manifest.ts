/**
 * `npm run assets:manifest` — regenerate `packages/ui/src/publicAssets.generated.ts`, the list of every
 * image/SVG under `apps/web/public/` that the boot preloader warms.
 *
 * Why a committed file rather than a Vite virtual module: the ui package's tests run under Vitest without the
 * app's plugin stack, and a generated-then-verified file is the pattern the repo already uses for content
 * counts (docs/CONTENT.md) — the test in `publicAssets.test.ts` fails when this is stale.
 */
import { writeFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { listPublicAssets, renderPublicManifest } from './public-manifest.lib';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '../../..');
const PUBLIC = resolve(ROOT, 'apps/web/public');
const OUT = resolve(ROOT, 'packages/ui/src/publicAssets.generated.ts');

const paths = listPublicAssets(PUBLIC);
writeFileSync(OUT, renderPublicManifest(paths));
console.log(`✓ ${paths.length} public assets → ${OUT}`);
