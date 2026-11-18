// One-off: compose the placeholder stills the page shows until the real gameplay captures land.
// Run `npm run sync-art -w apps/site` first, then `node apps/site/scripts/make-placeholders.mjs`.
// Each still is built only from the synced game art (public/art), darkened, with a short honest label.
// Outputs: public/captures/<slot>.jpg (1280x720), public/captures/mode-*.jpg (640x360), public/share.jpg (1200x630).
import { mkdirSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';

const SITE = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const ART = resolve(SITE, 'public/art');
const OUT = resolve(SITE, 'public/captures');
mkdirSync(OUT, { recursive: true });

const NIGHT = '#0d1220';
const GOLD = '#e6b45a';
const CREAM = '#efe7db';
const FONT = "'Outfit', 'Segoe UI', 'Helvetica Neue', Arial, sans-serif";
const art = (key) => resolve(ART, key);

const esc = (s) => s.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;');

/** A night fade (heavier at the bottom) plus a vignette, as an SVG the size of the still. */
function shade(w, h, strength = 0.55) {
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <linearGradient id="f" x1="0" y1="0" x2="0" y2="1">
      <stop offset="0" stop-color="${NIGHT}" stop-opacity="${strength * 0.55}"/>
      <stop offset="0.55" stop-color="${NIGHT}" stop-opacity="${strength * 0.7}"/>
      <stop offset="1" stop-color="${NIGHT}" stop-opacity="${Math.min(1, strength * 1.5)}"/>
    </linearGradient>
    <radialGradient id="v" cx="0.5" cy="0.45" r="0.75">
      <stop offset="0.55" stop-color="${NIGHT}" stop-opacity="0"/>
      <stop offset="1" stop-color="${NIGHT}" stop-opacity="0.75"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#f)"/>
  <rect width="100%" height="100%" fill="url(#v)"/>
</svg>`);
}

/** The label: a small gold "Capture coming soon" eyebrow and an optional cream title, bottom left. */
function label(w, h, title) {
  const s = w / 1280;
  const x = Math.round(56 * s);
  const titleSize = Math.round(44 * s);
  const eyeSize = Math.max(13, Math.round((title ? 18 : 30) * s));
  const eyeY = title ? h - Math.round(56 * s) - titleSize - Math.round(14 * s) : h - Math.round(40 * s);
  const rule = `<rect x="${x}" y="${eyeY - eyeSize - Math.round(14 * s)}" width="${Math.round(48 * s)}" height="${Math.max(2, Math.round(3 * s))}" fill="${GOLD}"/>`;
  const eyebrow = `<text x="${x}" y="${eyeY}" font-family="${FONT}" font-size="${eyeSize}" font-weight="700" letter-spacing="${(eyeSize * 0.18).toFixed(1)}" fill="${GOLD}">CAPTURE COMING SOON</text>`;
  const head = title
    ? `<text x="${x}" y="${h - Math.round(56 * s)}" font-family="${FONT}" font-size="${titleSize}" font-weight="800" fill="${CREAM}">${esc(title)}</text>`
    : '';
  return Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">${rule}${eyebrow}${head}</svg>`);
}

/** A flat night canvas with a soft warm glow in the middle, for stills built from cut-out art. */
function stage(w, h) {
  return sharp(
    Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${w}" height="${h}">
  <defs>
    <radialGradient id="g" cx="0.5" cy="0.42" r="0.7">
      <stop offset="0" stop-color="#2a3550"/>
      <stop offset="0.6" stop-color="#141b2e"/>
      <stop offset="1" stop-color="${NIGHT}"/>
    </radialGradient>
  </defs>
  <rect width="100%" height="100%" fill="url(#g)"/>
</svg>`),
  ).png();
}

/** A rounded-corner copy of a square image, `size` px. */
async function rounded(file, size, radius) {
  const mask = Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect width="${size}" height="${size}" rx="${radius}" fill="#fff"/></svg>`,
  );
  return sharp(file).resize(size, size).composite([{ input: mask, blend: 'dest-in' }]).png().toBuffer();
}

/** A thin gold ring around a `size` px rounded square, laid over a portrait. */
function ring(size, radius) {
  return Buffer.from(
    `<svg xmlns="http://www.w3.org/2000/svg" width="${size}" height="${size}"><rect x="1.5" y="1.5" width="${size - 3}" height="${size - 3}" rx="${radius}" fill="none" stroke="${GOLD}" stroke-width="3"/></svg>`,
  );
}

async function save(img, name, quality = 78) {
  const file = resolve(OUT, name);
  await img.jpeg({ quality, mozjpeg: true }).toFile(file);
  return file;
}

/** A crop of the hero art (left/top/width/height in source px), resized to w x h, shaded and labelled. */
async function heroCrop(name, region, w, h, title, strength) {
  const base = await sharp(art('hero.webp')).extract(region).resize(w, h, { fit: 'cover' }).toBuffer();
  return save(
    sharp(base).composite([
      { input: shade(w, h, strength), top: 0, left: 0 },
      { input: label(w, h, title), top: 0, left: 0 },
    ]),
    name,
  );
}

/** Lay `files` out in one centred row on the night stage. */
async function row(name, files, { itemW, itemH, gap, y, round, title }) {
  const W = 1280;
  const H = 720;
  const total = files.length * itemW + (files.length - 1) * gap;
  const x0 = Math.round((W - total) / 2);
  const layers = [];
  for (const [i, f] of files.entries()) {
    const left = x0 + i * (itemW + gap);
    if (round) {
      layers.push({ input: await rounded(f, itemW, round), top: y, left });
      layers.push({ input: ring(itemW, round), top: y, left });
    } else {
      layers.push({ input: await sharp(f).resize(itemW, itemH, { fit: 'contain', background: '#0000' }).png().toBuffer(), top: y, left });
    }
  }
  const base = await stage(W, H).composite(layers).toBuffer();
  return save(sharp(base).composite([{ input: shade(W, H, 0.35) }, { input: label(W, H, title) }]), name);
}

const HERO = { w: 1915, h: 821 };
const sixteenNine = (left, top, width) => ({ left, top, width, height: Math.round((width * 9) / 16) });

// The four async slots: four different framings of the title-screen art, eyebrow only (each card prints its title).
await heroCrop('discover-timer.jpg', sixteenNine(0, 0, 1459), 1280, 720, null, 0.55);
await heroCrop('gold-fuse.jpg', sixteenNine(560, 120, 1000), 1280, 720, null, 0.55);
await heroCrop('rearrange.jpg', sixteenNine(HERO.w - 1459, 0, 1459), 1280, 720, null, 0.55);
await heroCrop('save-continue.jpg', sixteenNine(420, HERO.h - 619, 1100), 1280, 720, null, 0.55);

// The Runeforge: the forge's own leather surface (the window inside forge-bg.webp, x 112-1424, y 148-856). The page
// sets this still inside the forge frame, so the still itself carries no frame.
{
  const W = 1280;
  const H = 720;
  const base = await sharp(art('forge-bg.webp'))
    .extract({ left: 112, top: 148, width: 1312, height: 708 })
    .resize(W, H, { fit: 'cover' })
    .toBuffer();
  await save(sharp(base).composite([{ input: shade(W, H, 0.45) }, { input: label(W, H, 'The Runeforge') }]), 'runeforge.jpg');
}

// Ancient select: three of the Ancient portraits, the way the select offers three.
await row(
  'ancient-select.jpg',
  ['bonds', 'fortune', 'war'].map((n) => art(`ancients/${n}.webp`)),
  { itemW: 300, itemH: 300, gap: 36, y: 110, round: 24, title: 'Ancient select' },
);

// Career: the six rank medals in a row.
await row(
  'career-chart.jpg',
  ['bronze', 'silver', 'gold', 'platinum', 'diamond', 'ascendant'].map((n) => art(`ranks/${n}.webp`)),
  { itemW: 184, itemH: 184, gap: 18, y: 190, round: 92, title: 'Your Career' },
);

// Chest opening: the five chest tiers in a row.
await row(
  'chest-opening.jpg',
  ['standard', 'rare', 'epic', 'legendary', 'ancient'].map((n) => art(`chests/${n}.webp`)),
  { itemW: 236, itemH: 130, gap: 10, y: 250, title: 'Chests' },
);

// The three mode stills (640x360): small crops of the title art, eyebrow only (the card carries the name).
await heroCrop('mode-versus.jpg', sixteenNine(860, 40, 900), 640, 360, null, 0.55);
await heroCrop('mode-duos.jpg', sixteenNine(1040, 140, 820), 640, 360, null, 0.55);
await heroCrop('mode-gauntlet.jpg', sixteenNine(0, 260, 900), 640, 360, null, 0.55);

// The share card (1200x630): the title art, the crest and the headline.
{
  const W = 1200;
  const H = 630;
  const sky = await sharp(art('hero.webp')).resize(W, H, { fit: 'cover', position: 'centre' }).toBuffer();
  const crest = await sharp(art('crest.webp')).resize(250, 250).png().toBuffer();
  const words = Buffer.from(`<svg xmlns="http://www.w3.org/2000/svg" width="${W}" height="${H}">
  <text x="600" y="452" text-anchor="middle" font-family="${FONT}" font-size="92" font-weight="900" letter-spacing="10" fill="${CREAM}">ASCENT</text>
  <text x="600" y="520" text-anchor="middle" font-family="${FONT}" font-size="36" font-weight="700" fill="${GOLD}">The auto-battler that waits for you.</text>
</svg>`);
  const file = resolve(SITE, 'public/share.jpg');
  await sharp(sky)
    .composite([{ input: shade(W, H, 0.7) }, { input: crest, top: 92, left: Math.round((W - 250) / 2) }, { input: words }])
    .jpeg({ quality: 80, mozjpeg: true })
    .toFile(file);
}

console.log('placeholders written to', OUT, 'and public/share.jpg');
