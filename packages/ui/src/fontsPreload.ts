/**
 * Boot-time font warm-up.
 *
 * The three families are SELF-HOSTED (`@fontsource/*`, imported in apps/web/src/main.tsx) as of 2026-09-03.
 * They used to come from Google Fonts with `display=swap`, which meant (a) every screen's text painted in the
 * fallback and re-flowed when each face arrived — a first-use hitch on every screen that used a new weight —
 * and (b) the desktop exe, which has no guaranteed internet, ran on fallback fonts permanently.
 *
 * `preloadFonts` asks the browser for every face the stylesheet uses and resolves when each has loaded (or its
 * timeout passed — a face that fails just falls back, it never blocks the boot). Fonts need no user gesture, so
 * the boot loader starts this the moment the splash is up.
 */

export interface FontFaceSpec { family: string; weight: number }

/** Every (family, weight) styles.css can ask for. Keep in step with the `@fontsource` imports in main.tsx —
 *  `fontsPreload.test.ts` pins that each weight used by styles.css is listed here. */
export const FONT_FACES: readonly FontFaceSpec[] = [
  ...[400, 500, 600, 700, 800, 900].map((weight) => ({ family: 'Outfit', weight })),
  ...[400, 600, 700].map((weight) => ({ family: 'Nunito Sans', weight })),
  // Cinzel Decorative is cut in 400/700/900 only (Google Fonts too): the stylesheet's `600` for the title and
  // curtain announcements resolves to 700 by the browser's nearest-weight rule, exactly as it did before.
  ...[400, 700, 900].map((weight) => ({ family: 'Cinzel Decorative', weight })),
];

/** The CSS font shorthand `document.fonts.load` wants for one face. */
export const fontLoadSpec = (f: FontFaceSpec): string => `${f.weight} 1em "${f.family}"`;

interface FontsLike {
  load(spec: string, text?: string): Promise<unknown>;
  ready?: Promise<unknown>;
}

/**
 * Load every face in `FONT_FACES`, reporting progress. Resolves in EVERY case: no `document.fonts`
 * (tests, an old engine), a face that fails, or a face that never settles (raced with `timeoutMs`).
 */
export function preloadFonts(
  onProgress?: (loaded: number, total: number) => void,
  timeoutMs = 10000,
  fonts: FontsLike | undefined = typeof document !== 'undefined' ? (document as { fonts?: FontsLike }).fonts : undefined,
): Promise<void> {
  const total = FONT_FACES.length;
  if (!fonts || typeof fonts.load !== 'function') {
    onProgress?.(total, total);
    return Promise.resolve();
  }
  let loaded = 0;
  const one = (f: FontFaceSpec): Promise<void> =>
    new Promise<void>((resolve) => {
      let settled = false;
      const done = (): void => {
        if (settled) return;
        settled = true;
        loaded += 1;
        onProgress?.(loaded, total);
        resolve();
      };
      try {
        void fonts.load(fontLoadSpec(f)).then(done, done);
      } catch {
        done();
      }
      setTimeout(done, timeoutMs);
    });
  return Promise.all(FONT_FACES.map(one))
    .then(() => (fonts.ready ? Promise.race([fonts.ready, new Promise<void>((r) => setTimeout(r, timeoutMs))]) : undefined))
    .then(() => undefined, () => undefined);
}
