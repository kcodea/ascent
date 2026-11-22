// Copies the game's real art and names into the dashboard at BUILD time (like apps/site's sync-art): the page itself
// never imports game code. Writes (all gitignored, regenerated on every dev / build):
//   public/game-data.json   hero names + art paths, the active set's heroes and tribes, tribe names / colours / glyphs,
//                           medal crests, mode art
//   public/art/**           hero portraits, medal crests, mode art (resized only; never re-toned), the portrait ring,
//                           the menus' citadel backdrop, the plates' vellum grain
//   public/cursors/*.svg    the game's gauntlet cursors
// Run: `npm run sync -w apps/dash` (predev / prebuild run it).
import { copyFileSync, existsSync, mkdirSync, readFileSync, statSync, writeFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import * as React from 'react';
import { renderToStaticMarkup } from 'react-dom/server';
import sharp from 'sharp';
import { ARCHIVED_RUNES, EPIC_RUNES, RUNES, activeSet } from '@game/content';
import { ANCIENTS, HEROES, RANK_MEDALS, isArchivedHero, playableHeroes } from '@game/sim';
import { ACHIEVEMENTS, COSMETICS, TITLES, divisionName } from '@game/progression';
import { TRIBE_ICON } from '../../../packages/ui/src/gauntlet/tribeIcon';
import { TRIBE_LABEL } from '../../../packages/ui/src/careerData';

// Icon.tsx is compiled here with the classic JSX runtime, which needs a React global.
(globalThis as { React?: unknown }).React = React;
const { Icon } = await import('../../../packages/ui/src/Icon');

const DASH = fileURLToPath(new URL('..', import.meta.url));
const REPO = resolve(DASH, '../..');
const UI = resolve(REPO, 'packages/ui/src');
const PUB = resolve(DASH, 'public');

let written = 0;
let kept = 0;
async function put(src: string, to: string, resize?: { width: number; height?: number }): Promise<string> {
  const from = resolve(REPO, src);
  if (!existsSync(from)) throw new Error(`sync-game: missing source ${src}`);
  const out = resolve(PUB, to);
  if (existsSync(out) && statSync(out).mtimeMs >= statSync(from).mtimeMs) { kept++; return `/${to}`; }
  mkdirSync(dirname(out), { recursive: true });
  // Resized and re-encoded only (lossless-quality WebP, alpha kept): the art is never recoloured or re-toned.
  if (resize) await sharp(from).resize({ ...resize, fit: 'cover', withoutEnlargement: true }).webp({ quality: 88, alphaQuality: 100 }).toFile(out);
  else copyFileSync(from, out);
  written++;
  return `/${to}`;
}

const heroArtFile = (id: string): string | null => {
  for (const ext of ['webp', 'png']) {
    const p = `packages/ui/src/art/heroes/${id}.${ext}`;
    if (existsSync(resolve(REPO, p))) return p;
  }
  return null;
};

const set = activeSet();
const heroes: Record<string, { name: string; art: string | null; archived: boolean }> = {};
for (const h of HEROES) {
  const src = heroArtFile(h.id);
  heroes[h.id] = { name: h.name, art: src ? await put(src, `art/heroes/${h.id}.webp`, { width: 128, height: 128 }) : null, archived: isArchivedHero(h) };
}

// Tribe colours: the game's own `--t-<tribe>` tokens (styles.css :root), read as written.
const styles = readFileSync(resolve(UI, 'styles.css'), 'utf8');
const tribes: Record<string, { name: string; color: string | null; icon: string }> = {};
for (const [id, name] of Object.entries(TRIBE_LABEL)) {
  const color = new RegExp(`--t-${id}:\\s*(#[0-9a-fA-F]{3,8})`).exec(styles)?.[1] ?? null;
  // The tribe's glyph from the game's own Icon set (the card footer / Gauntlet emblem), as static SVG markup.
  const icon = renderToStaticMarkup(React.createElement(Icon, { name: TRIBE_ICON[id as keyof typeof TRIBE_ICON] }));
  tribes[id] = { name, color, icon };
}

const medals: Record<string, string> = {};
for (const m of RANK_MEDALS) medals[m] = await put(`packages/ui/src/art/ranks/${m.toLowerCase()}.webp`, `art/ranks/${m.toLowerCase()}.webp`, { width: 128, height: 128 });

const modes: Record<string, string> = {};
for (const m of ['lobby', 'practice', 'versus', 'gauntlet', 'learn']) modes[m] = await put(`packages/ui/src/art/modes/${m}.webp`, `art/modes/${m}.webp`, { width: 480 });

const chrome: Record<string, string> = {
  backdrop: await put('apps/web/public/backdrops/citadel-blur.webp', 'art/citadel-blur.webp'),
  vellum: await put('packages/ui/src/partyHome/ornaments/vellum.webp', 'art/vellum.webp'),
  ring: await put('packages/ui/src/hero-select/heroportrait.png', 'art/heroportrait.webp', { width: 192 }),
  logo: await put('apps/web/public/ascenticon.png', 'art/ascent-mark.webp', { width: 96, height: 96 }),
};
// Round two (owner 2026-11-22): the page header's art (the title screen's home scene and the title crest, as Mike's site
// uses them), the section medallions, rune and Ancient art, and the names the new sections print.
Object.assign(chrome, {
  hero: await put('apps/web/public/homescreen.webp', 'art/homescreen.webp', { width: 1600 }),
  crest: await put('apps/web/public/frames/title-logo.png', 'art/title-crest.webp', { width: 240 }),
});
const medallions: Record<string, string> = {};
for (const m of ['startCombat', 'rebirth', 'mode-versus', 'mode-ranked', 'health', 'watcher', 'spend', 'mode-practice'])
  medallions[m] = await put(`apps/web/public/medallions/${m}.webp`, `art/medallions/${m}.webp`, { width: 64, height: 64 });

const runeArtFile = (id: string): string | null => {
  for (const ext of ['webp', 'png']) {
    const p = `packages/ui/src/art/runes/${id}.${ext}`;
    if (existsSync(resolve(REPO, p))) return p;
  }
  return null;
};
const runes: Record<string, { name: string; art: string | null }> = {};
for (const r of [...RUNES, ...EPIC_RUNES, ...ARCHIVED_RUNES]) {
  if (runes[r.id]) continue;
  const src = runeArtFile(r.id);
  runes[r.id] = { name: r.name, art: src ? await put(src, `art/runes/${r.id}.webp`, { width: 64, height: 64 }) : null };
}
const ancients: Record<string, { name: string; art: string | null }> = {};
for (const a of Object.values(ANCIENTS)) {
  const src = `packages/ui/src/art/ancients/${a.id}.webp`;
  ancients[a.id] = { name: a.name, art: existsSync(resolve(REPO, src)) ? await put(src, `art/ancients/${a.id}.webp`, { width: 96, height: 96 }) : null };
}
const achievements = Object.fromEntries(ACHIEVEMENTS.map((a) => [a.id, a.name]));
const cosmetics = Object.fromEntries(COSMETICS.map((c) => [c.id, { name: c.name, category: c.category }]));
const titles = Object.fromEntries(Object.values(TITLES).map((t) => [t.id, t.name]));
const divisions = Array.from({ length: RANK_MEDALS.length * 3 }, (_, i) => divisionName(i));

for (const c of ['gauntlet_default.svg', 'gauntlet_open.svg']) await put(`apps/web/public/cursors/${c}`, `cursors/${c}`);

const data = {
  setId: set.id,
  activeTribes: [...set.tribes],
  activeHeroes: playableHeroes(set.tribes).map((h) => h.id),
  heroes,
  tribes,
  medals,
  modes,
  chrome,
  medallions,
  divisions,
};
// The long name lists (~100 kB) only the round-two sections print: a second file, fetched the first time one opens.
const names = { runes, ancients, achievements, cosmetics, titles };
mkdirSync(PUB, { recursive: true });
writeFileSync(resolve(PUB, 'game-data.json'), `${JSON.stringify(data)}\n`);
writeFileSync(resolve(PUB, 'game-names.json'), `${JSON.stringify(names)}\n`);
// Per-tribe colour classes (the page's CSP forbids inline style attributes, so the colours travel as a stylesheet).
const css = Object.entries(tribes).filter(([, t]) => t.color).map(([id, t]) => `.tr-${id} { --tc: ${t.color}; }`).join('\n');
writeFileSync(resolve(PUB, 'game.css'), `/* generated by scripts/sync-game.mts: the game's --t-<tribe> colours */\n${css}\n`);
console.log(`sync-game: set ${set.id}, ${Object.keys(heroes).length} heroes, ${Object.keys(tribes).length} tribes; art ${written} written, ${kept} up to date`);
