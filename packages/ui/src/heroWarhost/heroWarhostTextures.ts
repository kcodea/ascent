/**
 * The Warhost's textures, painted ONCE per session on a single 2D canvas (one atlas, so the whole host draws from one
 * texture source and batches together), on top of the shared Blast / Arcana set it reuses for the impact flash.
 *
 * Everything here is a little painted figure in the Ancient of War's colours (red and brass), in FULL COLOUR (a sprite
 * tints it only to shade the rear ranks), facing RIGHT (a sprite flips it), with a dark outline so the silhouette reads
 * at 30 to 45 px tall, a top-left highlight and a soft contact shadow baked under the feet:
 *  - THE FOOT SOLDIER: a brass helmet with a red crest, a red tunic, a round red shield with a brass rim and boss, a
 *    spear. Two run frames (stride, passing) and a stand; the wind-up (spear drawn back over the shoulder), the throw
 *    (arm flung forward, hand empty), the cheer (both arms up) and two empty-handed run frames (the run home).
 *  - THE ARCHER: a red hood with a brass band, a quiver on the back, a bow. Two run frames, a stand, the draw (bow up,
 *    string back, an arrow nocked) and the release (string straight).
 *  - THE RIDER: a bay horse under a red caparison with a brass hem, a helmeted rider, a couched lance with a red
 *    pennant. Two gallop frames (stretched, gathered).
 *  - THE BANNER: a pole with a brass point, a red swallow-tailed flag with a brass border and a gold sword. Two frames
 *    of the wave.
 *  - THE SPEAR and THE ARROW (pointing right, the point at the right edge), and a lumpy DUST puff (white: tinted).
 *  - THE MAGE (third pass): a little wizard in a deep blue robe with brass stars, a tall floppy hat with a brass band,
 *    a white beard and a staff with a pale gem (the scene lights it with his school's colour, live). Two frames:
 *    standing on the staff, and casting (staff thrust out and up). The staff tip is where `WARHOST_MAGE_TIP` says.
 *  - THE DRUMMER: a soldier with a red war drum on his belly, sticks up and sticks down.
 *  - THE ARCHER'S CHEER (both arms up, hood on) and THE BOULDER (a cracked grey rock; the scene sets it on fire).
 * The figures are deliberately plain: everything they DO (spells, trails, fire, rune circles, impacts) is live Pixi.
 * No hero or Ancient art is used.
 */
import { CanvasSource, Rectangle, Texture } from 'pixi.js';
import { heroArcanaTextures } from '../heroArcana/heroArcanaTextures';
import { WARHOST_FOOT_H, WARHOST_MAGE_TIP } from './heroWarhostConfig';
import type { HeroWarhostTextures } from './heroWarhostScene';

/** A foot soldier's cell: the feet at (`FOOT_AX`, `FOOT_AY`) of it; the figure stands `FOOT_H` px from sole to helmet. */
export const FOOT_W = 96;
export const FOOT_CELL_H = 124;
export const FOOT_H = 64;
export const FOOT_AX = 0.5;
export const FOOT_AY = 114 / FOOT_CELL_H;
/** A rider's cell: the hooves at (`CAV_AX`, `CAV_AY`); horse and rider stand `CAV_H` px. */
export const CAV_W = 168;
export const CAV_CELL_H = 136;
export const CAV_H = 104;
export const CAV_AX = 80 / CAV_W;
export const CAV_AY = 126 / CAV_CELL_H;
/** The banner's cell: the pole's foot at (`BANNER_AX`, `BANNER_AY`); it stands `BANNER_H` px. */
export const BANNER_W = 112;
export const BANNER_CELL_H = 176;
export const BANNER_H = 164;
export const BANNER_AX = 14 / BANNER_W;
export const BANNER_AY = 172 / BANNER_CELL_H;
export const SPEAR_W = 104;
export const SPEAR_H = 16;
export const ARROW_W = 60;
export const ARROW_H = 14;
export const DUST_PX = 64;
export const ROCK_PX = 80;

const INK = '#2a1410';
const RED = '#d8372e';
const RED_LIGHT = '#ff6a5c';
const RED_DARK = '#8f1f1c';
const BRASS = '#e2b34a';
const BRASS_LIGHT = '#ffe596';
const BRASS_DARK = '#9a6f1e';
const SKIN = '#f2c8a0';
const WOOD = '#9b6a36';
const WOOD_DARK = '#5e3d1c';
const STEEL = '#e6edf3';
const STEEL_DARK = '#8fa0ad';
const BOOT = '#3d2418';
const HORSE = '#6b4329';
const HORSE_LIGHT = '#8e5f3c';
const HORSE_DARK = '#40261a';
const ROBE = '#3646b8';
const ROBE_LIGHT = '#5f72e6';
const ROBE_DARK = '#1d2672';
const BEARD = '#f4f1ea';
const ROCK = '#8a8580';
const ROCK_LIGHT = '#bdb8b0';
const ROCK_DARK = '#4a4642';

type G = CanvasRenderingContext2D;

/** Fill a path with a dark outline round it (the silhouette). */
function shape(g: G, path: () => void, fill: string | CanvasGradient, line = 4.5): void {
  g.beginPath(); path();
  g.lineJoin = 'round'; g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = line; g.stroke();
  g.fillStyle = fill; g.fill();
}

/** A limb or a shaft: a round-capped line with an outline. */
function limb(g: G, x1: number, y1: number, x2: number, y2: number, w: number, color: string, mx?: number, my?: number): void {
  const draw = (): void => { g.beginPath(); g.moveTo(x1, y1); if (mx !== undefined && my !== undefined) g.quadraticCurveTo(mx, my, x2, y2); else g.lineTo(x2, y2); g.stroke(); };
  g.lineCap = 'round'; g.lineJoin = 'round';
  g.strokeStyle = INK; g.lineWidth = w + 4; draw();
  g.strokeStyle = color; g.lineWidth = w; draw();
}

function shadow(g: G, x: number, y: number, rx: number, ry: number): void {
  const gr = g.createRadialGradient(x, y, 0, x, y, rx);
  gr.addColorStop(0, 'rgba(24,10,4,0.42)'); gr.addColorStop(1, 'rgba(24,10,4,0)');
  g.save(); g.translate(x, y); g.scale(1, ry / rx); g.translate(-x, -y);
  g.fillStyle = gr; g.beginPath(); g.arc(x, y, rx, 0, Math.PI * 2); g.fill();
  g.restore();
}

const lit = (g: G, x0: number, y0: number, x1: number, y1: number, a: string, b: string, c: string): CanvasGradient => {
  const gr = g.createLinearGradient(x0, y0, x1, y1);
  gr.addColorStop(0, a); gr.addColorStop(0.5, b); gr.addColorStop(1, c);
  return gr;
};

function spearShaft(g: G, x1: number, y1: number, x2: number, y2: number): void {
  limb(g, x1, y1, x2, y2, 3, WOOD);
  // The point: a steel leaf past the shaft's end.
  const a = Math.atan2(y2 - y1, x2 - x1);
  g.save(); g.translate(x2, y2); g.rotate(a);
  shape(g, () => { g.moveTo(-2, -4.5); g.lineTo(13, 0); g.lineTo(-2, 4.5); g.closePath(); }, lit(g, 0, -4, 0, 4, '#fff', STEEL, STEEL_DARK), 3.5);
  g.restore();
}

type Legs = 'stride' | 'pass' | 'stand';
type Arms = 'carry' | 'wind' | 'thrown' | 'cheer' | 'bare' | 'bow' | 'draw' | 'loosed' | 'drum';

/** One foot soldier or archer, feet at (ox, oy), facing right (`hooded`: an archer whatever his arms are doing). */
function paintFoot(g: G, ox: number, oy: number, legs: Legs, arms: Arms, hooded = false): void {
  const archer = hooded || arms === 'bow' || arms === 'draw' || arms === 'loosed';
  const up = legs === 'pass' ? -3 : 0; // the passing frame rides higher (the bob)
  const lean = legs === 'stand' ? 0 : 2; // a runner leans into it
  shadow(g, ox, oy + 1, 22, 6);
  const hip = oy - 22 + up;
  // Legs (boots): the far one first.
  if (legs === 'stride') { limb(g, ox - 3, hip, ox - 15, oy - 3, 6, BOOT, ox - 12, hip + 6); limb(g, ox + 4, hip, ox + 15, oy - 2, 6, BOOT, ox + 13, hip + 8); }
  else if (legs === 'pass') { limb(g, ox + 3, hip, ox + 9, oy - 11, 6, BOOT, ox + 12, hip + 5); limb(g, ox - 1, hip, ox - 1, oy - 2, 6, BOOT); }
  else { limb(g, ox - 5, hip, ox - 6, oy - 2, 6, BOOT); limb(g, ox + 5, hip, ox + 6, oy - 2, 6, BOOT); }
  const bx = ox + lean, top = oy - 48 + up;
  const sh = { x: bx, y: top + 7 }; // the shoulder
  const cheerA = arms === 'cheer';
  // The far arm and what it holds (behind the body).
  if (arms === 'carry') spearShaft(g, bx + 9, oy - 6 + up, bx + 17, oy - 96 + up);
  if (cheerA) limb(g, sh.x + 5, sh.y, bx + 17, top - 16, 5, SKIN);
  if (archer && arms === 'bow') {
    // A quiver on the back.
    g.save(); g.translate(bx - 11, top + 10); g.rotate(-0.35);
    shape(g, () => g.roundRect(-4, -12, 8, 22, 3), WOOD_DARK, 3.5);
    g.fillStyle = RED_LIGHT; g.fillRect(-3, -17, 2.4, 6); g.fillRect(0.6, -18, 2.4, 6);
    g.restore();
  }
  // The tunic.
  shape(g, () => g.roundRect(bx - 11, top, 22, 28, 7), lit(g, bx - 11, top, bx + 11, top + 28, RED_LIGHT, RED, RED_DARK));
  g.fillStyle = BRASS; g.fillRect(bx - 10, top + 20, 20, 3.5);
  if (archer) { g.strokeStyle = BRASS; g.lineWidth = 3; g.beginPath(); g.moveTo(bx - 9, top + 3); g.lineTo(bx + 9, top + 19); g.stroke(); }
  // The head.
  const hx = bx + 2, hy = top - 8;
  shape(g, () => g.arc(hx, hy, 9.5, 0, Math.PI * 2), SKIN);
  g.fillStyle = INK; g.beginPath(); g.arc(hx + 5, hy + 1, 1.6, 0, Math.PI * 2); g.fill();
  if (archer) {
    // A red hood with a brass band.
    shape(g, () => { g.arc(hx - 0.5, hy - 1, 10.5, Math.PI * 0.95, Math.PI * 1.95); g.quadraticCurveTo(hx - 2, hy - 4, hx - 12, hy + 7); g.closePath(); }, lit(g, hx - 10, hy - 10, hx + 8, hy + 4, RED_LIGHT, RED, RED_DARK), 3.5);
    g.strokeStyle = BRASS; g.lineWidth = 2.4; g.beginPath(); g.arc(hx - 0.5, hy - 1, 9, Math.PI * 1.12, Math.PI * 1.9); g.stroke();
  } else {
    // A brass helmet: a dome, a rim, a nose guard, a red crest.
    shape(g, () => { g.moveTo(hx - 8, hy - 15); g.quadraticCurveTo(hx - 1, hy - 26, hx + 9, hy - 14); g.quadraticCurveTo(hx + 1, hy - 17, hx - 8, hy - 15); }, RED, 3.5);
    shape(g, () => { g.arc(hx, hy - 1.5, 10.5, Math.PI, Math.PI * 2); g.lineTo(hx + 10.5, hy + 0.5); g.lineTo(hx - 10.5, hy + 0.5); g.closePath(); }, lit(g, hx - 9, hy - 12, hx + 9, hy, BRASS_LIGHT, BRASS, BRASS_DARK), 3.5);
    g.fillStyle = BRASS_DARK; g.fillRect(hx + 6.5, hy - 1, 2.6, 6);
    g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(hx - 4, hy - 7.5, 3.2, 1.6, -0.6, 0, Math.PI * 2); g.fill();
  }
  // The near arm, the weapon and the shield.
  if (arms === 'wind') {
    spearShaft(g, bx - 36, top - 7, bx + 26, top - 15);
    limb(g, sh.x - 3, sh.y, bx - 12, top - 9, 5, SKIN);
  } else if (arms === 'thrown') {
    limb(g, sh.x + 2, sh.y, bx + 22, top + 1, 5, SKIN);
  } else if (cheerA) {
    limb(g, sh.x - 5, sh.y, bx - 16, top - 15, 5, SKIN);
  } else if (arms === 'bow') {
    limb(g, sh.x + 2, sh.y + 2, bx + 13, top + 18, 5, SKIN);
    bow(g, bx + 15, top + 16, 0.15, 0, false);
  } else if (arms === 'draw' || arms === 'loosed') {
    limb(g, sh.x - 2, sh.y, bx - 9, top - 1, 5, SKIN, bx - 10, top + 9);
    limb(g, sh.x + 3, sh.y, bx + 15, top - 6, 5, SKIN);
    bow(g, bx + 16, top - 7, -0.62, arms === 'draw' ? 15 : 0, arms === 'draw');
  } else if (arms === 'carry') {
    g.fillStyle = SKIN; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(bx + 11.5, top + 14, 3.2, 0, Math.PI * 2); g.fill(); g.stroke();
  }
  if (!archer && arms !== 'drum') {
    // The round shield (the host's colour): red, a brass rim, a brass boss, a highlight.
    const sx = cheerA ? bx - 17 : bx - 3, sy = cheerA ? top - 18 : top + 13, sr = cheerA ? 10 : 12.5;
    shape(g, () => g.arc(sx, sy, sr, 0, Math.PI * 2), lit(g, sx - sr, sy - sr, sx + sr, sy + sr, RED_LIGHT, RED, RED_DARK));
    g.strokeStyle = BRASS; g.lineWidth = 2.6; g.beginPath(); g.arc(sx, sy, sr - 2, 0, Math.PI * 2); g.stroke();
    g.fillStyle = BRASS_LIGHT; g.beginPath(); g.arc(sx, sy, 3.4, 0, Math.PI * 2); g.fill();
    g.strokeStyle = 'rgba(255,255,255,0.55)'; g.lineWidth = 1.6; g.beginPath(); g.arc(sx, sy, sr - 5.5, Math.PI * 1.05, Math.PI * 1.5); g.stroke();
  }
}

/** A drummer: the soldier (no shield), a red war drum on his belly, the sticks up (`hit` false) or down on the skin. */
function paintDrummer(g: G, ox: number, oy: number, hit: boolean): void {
  paintFoot(g, ox, oy, 'stand', 'drum');
  const top = oy - 48;
  const dx = ox + 6, dy = top + 24, w = 15, h = 13;
  // The far stick and arm first, then the drum, then the near ones.
  const stick = (sx: number, near: boolean): void => {
    const hx = sx + (hit ? 4 : -2), hy = hit ? dy - 6 : top - 14;
    limb(g, ox + (near ? 4 : -2), top + 8, hx, hy + (hit ? 4 : 8), 5, SKIN);
    limb(g, hx, hy + (hit ? 3 : 6), hit ? hx + 9 : hx + 5, hit ? dy - 2 : hy - 8, 2.4, WOOD_DARK);
    g.fillStyle = BRASS_LIGHT; g.beginPath(); g.arc(hit ? hx + 9 : hx + 5, hit ? dy - 2 : hy - 8, 2.6, 0, Math.PI * 2); g.fill();
  };
  stick(dx - 8, false);
  shape(g, () => { g.moveTo(dx - w, dy); g.lineTo(dx - w, dy + h); g.ellipse(dx, dy + h, w, 5, 0, Math.PI, 0, true); g.lineTo(dx + w, dy); g.closePath(); }, lit(g, dx - w, dy, dx + w, dy, RED_LIGHT, RED, RED_DARK), 3.5);
  // The brass hoops and the cords between them.
  g.strokeStyle = BRASS; g.lineWidth = 2.4;
  g.beginPath(); g.ellipse(dx, dy + h, w, 5, 0, 0, Math.PI); g.stroke();
  g.strokeStyle = BRASS_LIGHT; g.lineWidth = 1.4;
  for (let i = -2; i <= 2; i++) { g.beginPath(); g.moveTo(dx + i * 6, dy + 3); g.lineTo(dx + i * 6 + (i % 2 ? 3 : -3), dy + h + 3); g.stroke(); }
  shape(g, () => g.ellipse(dx, dy, w, 5, 0, 0, Math.PI * 2), lit(g, dx, dy - 5, dx, dy + 5, '#fff7e2', '#f1dfbc', '#c9b48b'), 3);
  stick(dx + 4, true);
}

/**
 * A mage, feet at (ox, oy), facing right: a blue robe sprinkled with brass stars, a tall floppy hat with a brass band, a
 * white beard and a staff with a pale gem at its tip (exactly at `WARHOST_MAGE_TIP`, scaled from the soldier's height).
 */
function paintMage(g: G, ox: number, oy: number, cast: boolean): void {
  const k = FOOT_H / WARHOST_FOOT_H;
  const tip = cast ? WARHOST_MAGE_TIP.cast : WARHOST_MAGE_TIP.stand;
  const tx = ox + tip.x * k, ty = oy + tip.y * k;
  shadow(g, ox, oy + 1, 22, 6);
  const top = oy - 44;
  const staffFoot = cast ? { x: ox + 4, y: top + 30 } : { x: ox + 15, y: oy - 1 };
  // The staff (behind the near arm).
  limb(g, staffFoot.x, staffFoot.y, tx, ty + 5, 3.4, WOOD);
  // The robe: a bell from the shoulders to the hem, the far sleeve, a brass sash, brass stars.
  if (cast) limb(g, ox - 3, top + 8, ox - 18, top + 14, 7, ROBE_DARK);
  shape(g, () => { g.moveTo(ox - 9, top + 2); g.lineTo(ox + 9, top + 2); g.lineTo(ox + 17, oy - 3); g.quadraticCurveTo(ox, oy + 3, ox - 17, oy - 3); g.closePath(); }, lit(g, ox - 17, top, ox + 17, oy, ROBE_LIGHT, ROBE, ROBE_DARK));
  g.fillStyle = BRASS; g.fillRect(ox - 11, top + 18, 22, 3.4);
  g.fillStyle = BRASS_LIGHT;
  for (const [sx, sy] of [[-7, 30], [6, 36], [-2, 40]] as const) { g.beginPath(); g.arc(ox + sx, top + sy, 1.8, 0, Math.PI * 2); g.fill(); }
  // The head, the beard.
  const hx = ox + 2, hy = top - 7;
  shape(g, () => g.arc(hx, hy, 8.5, 0, Math.PI * 2), SKIN);
  g.fillStyle = INK; g.beginPath(); g.arc(hx + 4.5, hy - 0.5, 1.5, 0, Math.PI * 2); g.fill();
  shape(g, () => { g.moveTo(hx - 5, hy + 2); g.quadraticCurveTo(hx + 1, hy + 22, hx + 8, hy + 3); g.quadraticCurveTo(hx + 1, hy + 6, hx - 5, hy + 2); g.closePath(); }, BEARD, 3);
  // The hat: a wide brim, a tall cone flopping backward, a brass band and a star.
  shape(g, () => { g.moveTo(hx - 9, hy - 6); g.quadraticCurveTo(hx - 3, hy - 26, hx - 14, hy - 38); g.quadraticCurveTo(hx + 4, hy - 30, hx + 9, hy - 6); g.closePath(); }, lit(g, hx - 12, hy - 36, hx + 8, hy - 6, ROBE_LIGHT, ROBE, ROBE_DARK), 3.5);
  shape(g, () => g.ellipse(hx, hy - 5, 15, 4.2, 0, 0, Math.PI * 2), lit(g, hx, hy - 9, hx, hy - 1, ROBE_LIGHT, ROBE, ROBE_DARK), 3.5);
  g.strokeStyle = BRASS; g.lineWidth = 2.6; g.beginPath(); g.moveTo(hx - 8, hy - 9); g.quadraticCurveTo(hx, hy - 12, hx + 8, hy - 9); g.stroke();
  g.fillStyle = BRASS_LIGHT; g.beginPath();
  for (let i = 0; i < 10; i++) { const a = -Math.PI / 2 + (i * Math.PI) / 5, r = i % 2 ? 1.6 : 3.8; g.lineTo(hx - 3 + Math.cos(a) * r, hy - 20 + Math.sin(a) * r); }
  g.closePath(); g.fill();
  // The near arm holding the staff, and the gem (pale: the scene lights it).
  limb(g, ox + 3, top + 7, cast ? tx - 8 : ox + 14, cast ? ty + 14 : top + 18, 6, ROBE);
  g.fillStyle = SKIN; g.strokeStyle = INK; g.lineWidth = 1.5; g.beginPath(); g.arc(cast ? tx - 7 : ox + 15, cast ? ty + 13 : top + 18, 3, 0, Math.PI * 2); g.fill(); g.stroke();
  shape(g, () => { g.moveTo(tx, ty - 6); g.lineTo(tx + 4.5, ty); g.lineTo(tx, ty + 6); g.lineTo(tx - 4.5, ty); g.closePath(); }, lit(g, tx - 4, ty - 6, tx + 4, ty + 6, '#ffffff', '#e8f4ff', '#a9c6e8'), 2.6);
}

/** The catapult's boulder: a lumpy cracked grey rock, lit from the top left (the scene sets it on fire). */
function paintRock(g: G, ox: number, oy: number): void {
  const cx = ox + ROCK_PX / 2, cy = oy + ROCK_PX / 2, r = ROCK_PX * 0.4;
  shape(g, () => {
    for (let i = 0; i < 11; i++) { const a = (i / 11) * Math.PI * 2, rr = r * (0.84 + 0.16 * Math.abs(Math.sin(i * 2.3))); if (i === 0) g.moveTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); else g.lineTo(cx + Math.cos(a) * rr, cy + Math.sin(a) * rr); }
    g.closePath();
  }, lit(g, cx - r, cy - r, cx + r, cy + r, ROCK_LIGHT, ROCK, ROCK_DARK), 4);
  g.strokeStyle = ROCK_DARK; g.lineWidth = 2.2; g.lineCap = 'round';
  g.beginPath(); g.moveTo(cx - 10, cy - 14); g.lineTo(cx - 2, cy - 3); g.lineTo(cx + 9, cy - 1); g.moveTo(cx - 2, cy - 3); g.lineTo(cx - 6, cy + 12); g.stroke();
  g.fillStyle = 'rgba(255,255,255,0.35)'; g.beginPath(); g.ellipse(cx - 11, cy - 13, 8, 4, -0.6, 0, Math.PI * 2); g.fill();
}

/** A bow gripped at (x, y), turned `rot`, its string pulled back `pull` px (an arrow nocked when `arrow`). */
function bow(g: G, x: number, y: number, rot: number, pull: number, arrow: boolean): void {
  g.save(); g.translate(x, y); g.rotate(rot);
  const r = 17;
  g.lineCap = 'round';
  g.strokeStyle = 'rgba(255,255,255,0.9)'; g.lineWidth = 1.3;
  g.beginPath(); g.moveTo(-3, -r); g.lineTo(-3 - pull, 0); g.lineTo(-3, r); g.stroke();
  for (const [w, col] of [[6.5, INK], [3.2, WOOD]] as const) {
    g.strokeStyle = col; g.lineWidth = w;
    g.beginPath(); g.moveTo(-3, -r); g.quadraticCurveTo(11, 0, -3, r); g.stroke();
  }
  if (arrow) {
    g.strokeStyle = INK; g.lineWidth = 3.6; g.beginPath(); g.moveTo(-3 - pull, 0); g.lineTo(20, 0); g.stroke();
    g.strokeStyle = BRASS_LIGHT; g.lineWidth = 1.6; g.beginPath(); g.moveTo(-3 - pull, 0); g.lineTo(19, 0); g.stroke();
    shape(g, () => { g.moveTo(18, -3.4); g.lineTo(26, 0); g.lineTo(18, 3.4); g.closePath(); }, STEEL, 2.5);
  }
  g.restore();
}

/** One rider, hooves at (ox, oy), facing right. `gather`: the gathered frame of the gallop (the other is the stretch). */
function paintRider(g: G, ox: number, oy: number, gather: boolean): void {
  const up = gather ? -5 : 0;
  shadow(g, ox, oy + 1, 52, 7);
  const by = oy - 46 + up; // the barrel's centre
  // The far legs, then the tail.
  if (gather) { limb(g, ox + 24, by + 6, ox + 30, oy - 12, 5, HORSE_DARK, ox + 36, by + 22); limb(g, ox - 24, by + 6, ox - 10, oy - 10, 5, HORSE_DARK, ox - 30, by + 24); }
  else { limb(g, ox + 26, by + 4, ox + 58, oy - 22, 5, HORSE_DARK, ox + 44, by + 6); limb(g, ox - 26, by + 4, ox - 60, oy - 16, 5, HORSE_DARK, ox - 40, by + 20); }
  limb(g, ox - 34, by - 8, ox - 62, by + (gather ? 10 : -4), 5, HORSE_DARK, ox - 52, by - 16);
  // The body, the neck and the head.
  shape(g, () => g.ellipse(ox, by, 36, 15.5, 0, 0, Math.PI * 2), lit(g, ox, by - 16, ox, by + 16, HORSE_LIGHT, HORSE, HORSE_DARK));
  const nx = ox + 46, ny = by - 34 + (gather ? 3 : 0);
  limb(g, ox + 26, by - 6, nx, ny, 13, HORSE, ox + 34, by - 26);
  limb(g, ox + 22, by - 14, nx - 6, ny - 6, 3.5, HORSE_DARK, ox + 28, by - 30); // the mane
  shape(g, () => g.ellipse(nx + 8, ny + 3, 12, 6.8, 0.5, 0, Math.PI * 2), lit(g, nx, ny - 6, nx + 14, ny + 10, HORSE_LIGHT, HORSE, HORSE_DARK), 4);
  shape(g, () => { g.moveTo(nx - 2, ny - 4); g.lineTo(nx - 1, ny - 13); g.lineTo(nx + 4, ny - 5); g.closePath(); }, HORSE, 3);
  g.fillStyle = INK; g.beginPath(); g.arc(nx + 8, ny, 1.7, 0, Math.PI * 2); g.fill();
  g.strokeStyle = RED; g.lineWidth = 2.2; g.beginPath(); g.moveTo(nx + 3, ny + 7); g.lineTo(nx + 9, ny - 4); g.stroke(); // the bridle
  g.strokeStyle = BRASS; g.lineWidth = 1.6; g.beginPath(); g.moveTo(nx + 4, ny + 6); g.quadraticCurveTo(ox + 26, by - 14, ox + 8, by - 16); g.stroke(); // the rein
  // The near legs.
  if (gather) { limb(g, ox + 20, by + 8, ox + 18, oy - 3, 6, HORSE, ox + 28, by + 26); limb(g, ox - 20, by + 8, ox - 22, oy - 2, 6, HORSE, ox - 14, by + 26); }
  else { limb(g, ox + 22, by + 8, ox + 50, oy - 9, 6, HORSE, ox + 40, by + 12); limb(g, ox - 22, by + 8, ox - 52, oy - 5, 6, HORSE, ox - 32, by + 26); }
  // The caparison: a red cloth over the barrel with a brass hem.
  shape(g, () => { g.moveTo(ox - 26, by - 13); g.quadraticCurveTo(ox - 4, by - 19, ox + 20, by - 12); g.lineTo(ox + 17, by + 15); g.quadraticCurveTo(ox - 4, by + 22, ox - 25, by + 14); g.closePath(); }, lit(g, ox - 26, by - 16, ox + 14, by + 20, RED_LIGHT, RED, RED_DARK), 4);
  g.strokeStyle = BRASS; g.lineWidth = 2.6; g.beginPath(); g.moveTo(ox - 23, by + 11.5); g.quadraticCurveTo(ox - 4, by + 18.5, ox + 15.5, by + 12); g.stroke();
  g.fillStyle = BRASS_LIGHT; g.beginPath(); g.moveTo(ox - 4, by - 4); g.lineTo(ox + 1, by + 2); g.lineTo(ox - 4, by + 8); g.lineTo(ox - 9, by + 2); g.closePath(); g.fill();
  // The lance (the far side of the rider): couched, a red pennant streaming back from under the point.
  const lx1 = ox - 18, ly1 = by - 22, lx2 = ox + 76, ly2 = by - 40;
  spearShaft(g, lx1, ly1, lx2, ly2);
  const px = lx2 - 10, py = ly2 + 2;
  shape(g, () => {
    g.moveTo(px, py); g.quadraticCurveTo(px - 12, py - (gather ? 9 : 2), px - 26, py - (gather ? 2 : 8));
    g.lineTo(px - 19, py + 4); g.lineTo(px - 27, py + (gather ? 12 : 9)); g.quadraticCurveTo(px - 12, py + (gather ? 5 : 12), px, py + 7); g.closePath();
  }, lit(g, px - 26, py - 6, px, py + 10, RED_DARK, RED, RED_LIGHT), 3.5);
  // The rider: a leg, the tunic, the head and helmet, a small shield.
  const rx = ox - 2, ry = by - 14;
  limb(g, rx + 2, ry - 2, rx + 9, by + 9, 6, BOOT, rx + 10, ry + 6);
  shape(g, () => g.roundRect(rx - 9, ry - 28, 19, 28, 7), lit(g, rx - 9, ry - 28, rx + 10, ry, RED_LIGHT, RED, RED_DARK));
  limb(g, rx + 4, ry - 20, rx + 14, ry - 12, 5, SKIN);
  const hx = rx + 3, hy = ry - 36;
  shape(g, () => g.arc(hx, hy, 8.5, 0, Math.PI * 2), SKIN);
  g.fillStyle = INK; g.beginPath(); g.arc(hx + 4.5, hy + 1, 1.5, 0, Math.PI * 2); g.fill();
  // The crest streams back.
  shape(g, () => { g.moveTo(hx + 4, hy - 12); g.quadraticCurveTo(hx - 6, hy - 22, hx - 20, hy - (gather ? 8 : 15)); g.quadraticCurveTo(hx - 9, hy - 13, hx - 6, hy - 9); g.closePath(); }, RED, 3.5);
  shape(g, () => { g.arc(hx, hy - 1.5, 9.5, Math.PI, Math.PI * 2); g.lineTo(hx + 9.5, hy + 0.5); g.lineTo(hx - 9.5, hy + 0.5); g.closePath(); }, lit(g, hx - 8, hy - 11, hx + 8, hy, BRASS_LIGHT, BRASS, BRASS_DARK), 3.5);
  g.fillStyle = 'rgba(255,255,255,0.7)'; g.beginPath(); g.ellipse(hx - 3.5, hy - 7, 2.8, 1.4, -0.6, 0, Math.PI * 2); g.fill();
  const sx = rx - 4, sy = ry - 13;
  shape(g, () => g.arc(sx, sy, 10, 0, Math.PI * 2), lit(g, sx - 10, sy - 10, sx + 10, sy + 10, RED_LIGHT, RED, RED_DARK), 4);
  g.strokeStyle = BRASS; g.lineWidth = 2.3; g.beginPath(); g.arc(sx, sy, 8, 0, Math.PI * 2); g.stroke();
  g.fillStyle = BRASS_LIGHT; g.beginPath(); g.arc(sx, sy, 2.8, 0, Math.PI * 2); g.fill();
}

/** The banner, the pole's foot at (ox, oy). `wave` picks the frame (the flag's ripple). */
function paintBanner(g: G, ox: number, oy: number, wave: 0 | 1): void {
  const top = oy - 152;
  limb(g, ox, oy, ox, top, 4, WOOD);
  shape(g, () => { g.moveTo(ox - 5, top + 1); g.lineTo(ox, top - 12); g.lineTo(ox + 5, top + 1); g.closePath(); }, lit(g, ox - 5, top, ox + 5, top, BRASS_LIGHT, BRASS, BRASS_DARK), 3.5);
  const y0 = top + 8, h = 62, w = 88;
  const s = wave ? -1 : 1;
  const x0 = ox + 2;
  shape(g, () => {
    g.moveTo(x0, y0);
    g.bezierCurveTo(x0 + w * 0.3, y0 - 9 * s, x0 + w * 0.62, y0 + 9 * s, x0 + w, y0 - 3 * s);
    g.lineTo(x0 + w * 0.8, y0 + h * 0.5 + 2 * s);
    g.lineTo(x0 + w, y0 + h + 4 * s);
    g.bezierCurveTo(x0 + w * 0.62, y0 + h + 10 * s, x0 + w * 0.3, y0 + h - 8 * s, x0, y0 + h);
    g.closePath();
  }, lit(g, x0, y0, x0 + w, y0 + h, RED_LIGHT, RED, RED_DARK));
  // A brass border just inside the edge.
  g.strokeStyle = BRASS; g.lineWidth = 2.6; g.lineJoin = 'round';
  g.beginPath();
  g.moveTo(x0 + 5, y0 + 5);
  g.bezierCurveTo(x0 + w * 0.3, y0 - 4 * s, x0 + w * 0.6, y0 + 13 * s, x0 + w - 9, y0 + 3 - 3 * s);
  g.lineTo(x0 + w * 0.74, y0 + h * 0.5 + 2 * s);
  g.lineTo(x0 + w - 9, y0 + h - 2 + 4 * s);
  g.bezierCurveTo(x0 + w * 0.6, y0 + h + 5 * s, x0 + w * 0.3, y0 + h - 13 * s, x0 + 5, y0 + h - 5);
  g.closePath(); g.stroke();
  // The emblem: a gold sword, point up, in a ring.
  const ex = x0 + w * 0.4, ey = y0 + h * 0.5 + 2 * s;
  g.strokeStyle = INK; g.lineWidth = 6.5; g.lineCap = 'round';
  g.beginPath(); g.moveTo(ex, ey + 17); g.lineTo(ex, ey - 19); g.moveTo(ex - 9, ey + 7); g.lineTo(ex + 9, ey + 7); g.stroke();
  g.strokeStyle = BRASS_LIGHT; g.lineWidth = 3.4;
  g.beginPath(); g.moveTo(ex, ey + 17); g.lineTo(ex, ey - 19); g.moveTo(ex - 9, ey + 7); g.lineTo(ex + 9, ey + 7); g.stroke();
  g.fillStyle = BRASS_LIGHT; g.beginPath(); g.moveTo(ex - 3.2, ey - 17); g.lineTo(ex, ey - 24); g.lineTo(ex + 3.2, ey - 17); g.closePath(); g.fill();
  // The fold's shade and a highlight along the top.
  g.fillStyle = 'rgba(60,8,8,0.22)';
  g.beginPath(); g.ellipse(x0 + w * (wave ? 0.3 : 0.62), y0 + h * 0.5, 9, h * 0.42, 0, 0, Math.PI * 2); g.fill();
  g.strokeStyle = 'rgba(255,255,255,0.4)'; g.lineWidth = 2;
  g.beginPath(); g.moveTo(x0 + 8, y0 + 3); g.bezierCurveTo(x0 + w * 0.3, y0 - 6 * s, x0 + w * 0.5, y0 + 6 * s, x0 + w * 0.7, y0 + 3 * s); g.stroke();
}

function paintSpear(g: G, ox: number, oy: number): void {
  const y = oy + SPEAR_H / 2;
  limb(g, ox + 5, y, ox + SPEAR_W - 18, y, 3.4, WOOD);
  g.fillStyle = RED; g.fillRect(ox + SPEAR_W - 26, y - 2.6, 5, 5.2);
  shape(g, () => { g.moveTo(ox + SPEAR_W - 19, y - 5.5); g.lineTo(ox + SPEAR_W - 1.5, y); g.lineTo(ox + SPEAR_W - 19, y + 5.5); g.closePath(); }, lit(g, 0, y - 5, 0, y + 5, '#fff', STEEL, STEEL_DARK), 3);
}

function paintArrow(g: G, ox: number, oy: number): void {
  const y = oy + ARROW_H / 2;
  g.lineCap = 'round';
  g.strokeStyle = INK; g.lineWidth = 4.4; g.beginPath(); g.moveTo(ox + 5, y); g.lineTo(ox + ARROW_W - 10, y); g.stroke();
  g.strokeStyle = BRASS_LIGHT; g.lineWidth = 2; g.beginPath(); g.moveTo(ox + 5, y); g.lineTo(ox + ARROW_W - 10, y); g.stroke();
  // The fletching (red) and the head (steel).
  shape(g, () => { g.moveTo(ox + 3, y - 5); g.lineTo(ox + 13, y - 5); g.lineTo(ox + 17, y); g.lineTo(ox + 13, y + 5); g.lineTo(ox + 3, y + 5); g.lineTo(ox + 7, y); g.closePath(); }, RED_LIGHT, 2.4);
  shape(g, () => { g.moveTo(ox + ARROW_W - 12, y - 4.2); g.lineTo(ox + ARROW_W - 1.5, y); g.lineTo(ox + ARROW_W - 12, y + 4.2); g.closePath(); }, STEEL, 2.4);
}

/** A dust puff: a lumpy soft cloud (white: the sprite tints it). */
function paintDust(g: G, ox: number, oy: number): void {
  const blobs: [number, number, number][] = [[32, 36, 22], [20, 30, 14], [44, 29, 15], [30, 22, 13], [40, 42, 12], [22, 42, 11]];
  for (const [x, y, r] of blobs) {
    const gr = g.createRadialGradient(ox + x, oy + y, 0, ox + x, oy + y, r);
    gr.addColorStop(0, 'rgba(255,255,255,0.75)'); gr.addColorStop(0.55, 'rgba(255,255,255,0.4)'); gr.addColorStop(1, 'rgba(255,255,255,0)');
    g.fillStyle = gr; g.beginPath(); g.arc(ox + x, oy + y, r, 0, Math.PI * 2); g.fill();
  }
}

type Cell = [name: string, w: number, h: number, paint: (g: G, x: number, y: number) => void];

const footCell = (name: string, legs: Legs, arms: Arms, hooded = false): Cell => [name, FOOT_W, FOOT_CELL_H, (g, x, y) => paintFoot(g, x + FOOT_W * FOOT_AX, y + FOOT_CELL_H * FOOT_AY, legs, arms, hooded)];
const figCell = (name: string, paint: (g: G, ox: number, oy: number) => void): Cell => [name, FOOT_W, FOOT_CELL_H, (g, x, y) => paint(g, x + FOOT_W * FOOT_AX, y + FOOT_CELL_H * FOOT_AY)];

const CELLS: Cell[] = [
  footCell('infA', 'stride', 'carry'), footCell('infB', 'pass', 'carry'), footCell('infStand', 'stand', 'carry'),
  footCell('spearWind', 'stand', 'wind'), footCell('spearThrown', 'stride', 'thrown'), footCell('cheer', 'stand', 'cheer'),
  footCell('bareA', 'stride', 'bare'), footCell('bareB', 'pass', 'bare'),
  footCell('archA', 'stride', 'bow'), footCell('archB', 'pass', 'bow'), footCell('archStand', 'stand', 'bow'),
  footCell('archDraw', 'stand', 'draw'), footCell('archLoose', 'stand', 'loosed'), footCell('archCheer', 'stand', 'cheer', true),
  figCell('mage', (g, x, y) => paintMage(g, x, y, false)), figCell('mageCast', (g, x, y) => paintMage(g, x, y, true)),
  figCell('drumA', (g, x, y) => paintDrummer(g, x, y, false)), figCell('drumB', (g, x, y) => paintDrummer(g, x, y, true)),
  ['cavA', CAV_W, CAV_CELL_H, (g, x, y) => paintRider(g, x + CAV_W * CAV_AX, y + CAV_CELL_H * CAV_AY, false)],
  ['cavB', CAV_W, CAV_CELL_H, (g, x, y) => paintRider(g, x + CAV_W * CAV_AX, y + CAV_CELL_H * CAV_AY, true)],
  ['bannerA', BANNER_W, BANNER_CELL_H, (g, x, y) => paintBanner(g, x + BANNER_W * BANNER_AX, y + BANNER_CELL_H * BANNER_AY, 0)],
  ['bannerB', BANNER_W, BANNER_CELL_H, (g, x, y) => paintBanner(g, x + BANNER_W * BANNER_AX, y + BANNER_CELL_H * BANNER_AY, 1)],
  ['spear', SPEAR_W, SPEAR_H, paintSpear],
  ['arrow', ARROW_W, ARROW_H, paintArrow],
  ['dust', DUST_PX, DUST_PX, paintDust],
  ['rock', ROCK_PX, ROCK_PX, paintRock],
];

export const WARHOST_ATLAS_W = 1024;
const PAD = 2;

/** Shelf-pack the cells into the atlas (in order). Pure: the layout is the same every session. */
export function warhostAtlasLayout(): { rects: Record<string, { x: number; y: number; w: number; h: number }>; height: number } {
  const rects: Record<string, { x: number; y: number; w: number; h: number }> = {};
  let x = PAD, y = PAD, shelf = 0;
  for (const [name, w, h] of CELLS) {
    if (x + w + PAD > WARHOST_ATLAS_W) { x = PAD; y += shelf + PAD; shelf = 0; }
    rects[name] = { x, y, w, h };
    x += w + PAD; shelf = Math.max(shelf, h);
  }
  return { rects, height: y + shelf + PAD };
}

let cached: HeroWarhostTextures | null = null;

/** The session's textures, painted on first use. Null when no 2D canvas is available (the style then skips Pixi). */
export function heroWarhostTextures(): HeroWarhostTextures | null {
  if (cached) return cached;
  if (typeof document === 'undefined') return null;
  const base = heroArcanaTextures();
  if (!base) return null;
  const { rects, height } = warhostAtlasLayout();
  const cv = document.createElement('canvas');
  cv.width = WARHOST_ATLAS_W; cv.height = height;
  const g = cv.getContext('2d');
  if (!g) return null;
  for (const [name, w, h, paint] of CELLS) {
    const r = rects[name]!;
    g.save();
    g.beginPath(); g.rect(r.x, r.y, w, h); g.clip();
    paint(g, r.x, r.y);
    g.restore();
  }
  const source = new CanvasSource({ resource: cv });
  const cut = (name: string): Texture => { const r = rects[name]!; return new Texture({ source, frame: new Rectangle(r.x, r.y, r.w, r.h) }); };
  cached = {
    ...base,
    infA: cut('infA'), infB: cut('infB'), infStand: cut('infStand'), spearWind: cut('spearWind'), spearThrown: cut('spearThrown'), cheer: cut('cheer'),
    bareA: cut('bareA'), bareB: cut('bareB'), archA: cut('archA'), archB: cut('archB'), archStand: cut('archStand'), archDraw: cut('archDraw'),
    archLoose: cut('archLoose'), cavA: cut('cavA'), cavB: cut('cavB'), bannerA: cut('bannerA'), bannerB: cut('bannerB'), spear: cut('spear'),
    arrow: cut('arrow'), dust: cut('dust'), archCheer: cut('archCheer'), mage: cut('mage'), mageCast: cut('mageCast'), drumA: cut('drumA'), drumB: cut('drumB'),
    rock: cut('rock'),
  };
  return cached;
}
