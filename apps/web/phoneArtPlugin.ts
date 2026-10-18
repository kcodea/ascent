import { createHash } from 'node:crypto';
import { existsSync, mkdirSync, readdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import type { Plugin } from 'vite';
import { PHONE_ART_DIR, PHONE_ART_VERSION, PHONE_ASSET_CAPS, phonePublicCap, type PhoneArtManifest } from '../../packages/ui/src/phoneArt';

/**
 * PHONE ART COPIES (owner 2026-10-18: "the iPhone crashes a lot"). A production build writes a downscaled copy of the
 * big art next to the original, and bakes the list of copies into the bundle as `__PHONE_ART__`; on a phone the art
 * lookups (`packages/ui/src/phoneArt.ts`) return the copy. Desktop never requests one.
 *
 *   bundled art  `packages/ui/src/art/<dir>/x.webp` → `assets/x-HASH.webp`  ⇒ copy `assets/m1/x-HASH.webp`
 *   public art   `apps/web/public/frames/y.webp`    → `frames/y.webp`       ⇒ copy `m1/frames/y.webp`
 *
 * A file gets a copy only when it is LARGER than its cap (`PHONE_ASSET_CAPS` / `phonePublicCap`), and a public file
 * only when no stylesheet names it (a CSS url() cannot be switched per device, so a copy would just be a second
 * download). The two boards are the exception: they are CSS custom properties `applyPhoneCssArt` re-points.
 *
 * Nothing is committed: the copies exist only in `dist/`, so the art tree's file budget (`artNoRedundantMasters`) is
 * unaffected. They do add files to `dist/` (the itch zip); `ASCENT_PHONE_ART=0` builds without them (phones then get
 * the originals, and everything else about the phone path still applies). Resized copies are cached under
 * `node_modules/.cache/phone-art`, keyed by the source bytes + cap, so a rebuild only resizes what changed.
 */

/** The board images `applyPhoneCssArt` re-points; every other CSS-named public file is left alone. */
const CSS_OVERRIDDEN = new Set(['augustfullboard.webp', 'augustboardcombat.webp']);

export interface PhoneArtCandidate { key: string; width: number; height: number; cap: number }

/**
 * Pure: which files get a phone copy. `assets` are bundled art keyed by their path under `packages/ui/src/`
 * (`art/minions/x.webp`); `pub` are public paths (`frames/y.webp`). `cssText` is every stylesheet the UI ships.
 * Exported for its test.
 */
export function planPhoneArt(
  assets: ReadonlyArray<{ key: string; width: number; height: number }>,
  pub: ReadonlyArray<{ key: string; width: number; height: number }>,
  cssText: string,
): { manifest: PhoneArtManifest; assets: PhoneArtCandidate[]; pub: PhoneArtCandidate[] } {
  const a: PhoneArtCandidate[] = [];
  for (const f of assets) {
    const dir = /^art\/([^/]+)\/[^/]+\.(?:webp|png)$/i.exec(f.key)?.[1];
    const cap = dir ? PHONE_ASSET_CAPS[dir] : undefined;
    if (cap && Math.max(f.width, f.height) > cap) a.push({ ...f, cap });
  }
  const p: PhoneArtCandidate[] = [];
  for (const f of pub) {
    if (!/\.(?:webp|png|jpe?g)$/i.test(f.key)) continue;
    const cap = phonePublicCap(f.key);
    if (!cap || Math.max(f.width, f.height) <= cap) continue;
    const base = f.key.slice(f.key.lastIndexOf('/') + 1);
    if (!CSS_OVERRIDDEN.has(f.key) && cssText.includes(base)) continue;
    p.push({ ...f, cap });
  }
  return { manifest: { dir: PHONE_ART_DIR, assets: a.map((x) => x.key).sort(), public: p.map((x) => x.key).sort() }, assets: a, pub: p };
}

async function dims(file: string): Promise<{ width: number; height: number }> {
  const sharp = (await import('sharp')).default;
  const m = await sharp(file).metadata();
  return { width: m.width ?? 0, height: m.height ?? 0 };
}

function walkCss(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = path.join(dir, e);
    if (statSync(p).isDirectory()) { if (e !== 'node_modules') walkCss(p, out); } else if (e.endsWith('.css')) out.push(p);
  }
  return out;
}

async function resize(source: Buffer, cap: number, ext: string, cacheDir: string): Promise<Buffer> {
  const key = createHash('sha1').update(source).update(`|${cap}|${ext}|v${PHONE_ART_VERSION}`).digest('hex');
  const cached = path.join(cacheDir, `${key}${ext}`);
  if (existsSync(cached)) return readFileSync(cached);
  const sharp = (await import('sharp')).default;
  let img = sharp(source).resize({ width: cap, height: cap, fit: 'inside', withoutEnlargement: true });
  img = ext === '.png' ? img.png({ compressionLevel: 9 }) : ext === '.jpg' || ext === '.jpeg' ? img.jpeg({ quality: 82 }) : img.webp({ quality: 82, alphaQuality: 90 });
  const out = await img.toBuffer();
  try { mkdirSync(cacheDir, { recursive: true }); writeFileSync(cached, out); } catch { /* cache is best-effort */ }
  return out;
}

/** Run `fn` over `items`, `n` at a time. */
async function pool<T>(items: readonly T[], n: number, fn: (t: T) => Promise<void>): Promise<void> {
  let i = 0;
  await Promise.all(Array.from({ length: Math.min(n, items.length) }, async () => { while (i < items.length) await fn(items[i++]!); }));
}

export function phoneArtPlugin(opts: { uiSrc: string; publicDir: string; publicArt: readonly string[]; cacheDir: string }): Plugin {
  const enabled = process.env.ASCENT_PHONE_ART !== '0';
  let plan: ReturnType<typeof planPhoneArt> | null = null;
  return {
    name: 'ascent-phone-art',
    apply: 'build',
    async config() {
      if (!enabled) return { define: { __PHONE_ART__: 'null' } };
      const assets: Array<{ key: string; width: number; height: number }> = [];
      for (const dir of Object.keys(PHONE_ASSET_CAPS)) {
        const abs = path.join(opts.uiSrc, 'art', dir);
        if (!existsSync(abs)) continue;
        for (const f of readdirSync(abs)) {
          if (!/\.(?:webp|png)$/i.test(f)) continue;
          assets.push({ key: `art/${dir}/${f}`, ...(await dims(path.join(abs, f))) });
        }
      }
      const pub: Array<{ key: string; width: number; height: number }> = [];
      for (const rel of opts.publicArt) {
        if (!phonePublicCap(rel) || !/\.(?:webp|png|jpe?g)$/i.test(rel)) continue;
        pub.push({ key: rel, ...(await dims(path.join(opts.publicDir, rel))) });
      }
      const css = walkCss(opts.uiSrc).map((f) => readFileSync(f, 'utf8')).join('\n');
      plan = planPhoneArt(assets, pub, css);
      return { define: { __PHONE_ART__: JSON.stringify(plan.manifest) } };
    },
    async generateBundle(_out, bundle) {
      if (!plan) return;
      const caps = new Map(plan.assets.map((a) => [a.key, a.cap] as const));
      const jobs: Array<{ fileName: string; source: Buffer; cap: number; ext: string }> = [];
      const seen = new Set<string>();
      const matched = new Set<string>();
      for (const item of Object.values(bundle)) {
        if (item.type !== 'asset') continue;
        for (const orig of item.originalFileNames ?? []) {
          const posix = orig.split('\\').join('/');
          const i = posix.lastIndexOf('packages/ui/src/');
          const key = i >= 0 ? posix.slice(i + 'packages/ui/src/'.length) : posix;
          const cap = caps.get(key);
          if (!cap) continue;
          matched.add(key);
          const fileName = `assets/${PHONE_ART_DIR}/${item.fileName.slice(item.fileName.lastIndexOf('/') + 1)}`;
          if (seen.has(fileName)) continue;
          seen.add(fileName);
          const src = typeof item.source === 'string' ? Buffer.from(item.source) : Buffer.from(item.source);
          jobs.push({ fileName, source: src, cap, ext: path.extname(item.fileName).toLowerCase() });
        }
      }
      for (const p of plan.pub) {
        jobs.push({ fileName: `${PHONE_ART_DIR}/${p.key}`, source: readFileSync(path.join(opts.publicDir, p.key)), cap: p.cap, ext: path.extname(p.key).toLowerCase() });
      }
      let inBytes = 0;
      let outBytes = 0;
      await pool(jobs, 8, async (j) => {
        const out = await resize(j.source, j.cap, j.ext, opts.cacheDir);
        inBytes += j.source.length;
        outBytes += out.length;
        this.emitFile({ type: 'asset', fileName: j.fileName, source: out });
      });
      const missing = plan.assets.filter((a) => !matched.has(a.key)).length;
      // Every key in the manifest must have produced a file (a lookup can only point at a file that exists). Bundled
      // art Vite never emitted (an unused glob entry is still emitted, so this means a path mismatch) fails the build.
      if (missing > 0) this.error(`[phone-art] ${missing} manifest entries produced no copy: the source-path match is broken`);
      console.log(`[phone-art] ${jobs.length} phone copies, ${(outBytes / 1048576).toFixed(1)} MB (originals ${(inBytes / 1048576).toFixed(1)} MB)`);
    },
  };
}
