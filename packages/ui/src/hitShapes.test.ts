import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import sharp from 'sharp';
import { describe, expect, it } from 'vitest';

/**
 * R-HIT-SHAPE-01 (owner 2026-10-31: "make the other buttons as clean cut as you did with end turn so that mousing over
 * them feels snappy and accurate"). Every board / HUD control takes the pointer only through its DRAWN shape, in every
 * mode: the box and the art are click-through, one shaped hit layer takes the pointer.
 *
 * jsdom has no layout or hit testing, so this holds the contract two ways:
 *   1. THE TRACED POLYGONS STILL FIT THEIR ART. Each `clip-path: polygon()` in hitShapes.css is checked against the art
 *      file it was traced from: it must cover the art's opaque pixels (no dead zone inside the drawing) and stay off its
 *      empty ones (no live zone outside it). A new art file with a different silhouette fails here until it is re-traced
 *      (`node scripts/trace-hit-shape.mjs`).
 *   2. THE STYLESHEET WIRING per control: the box is click-through, the hit layer is live and shaped, a card drag drops
 *      through it.
 * The live check (elementFromPoint on a grid inside / outside each control's painted alpha, before and after) is in the
 * PR notes.
 */
const css = readFileSync(join(__dirname, 'hitShapes.css'), 'utf8');
const bare = css.replace(/\/\*[\s\S]*?\*\//g, '');
const rules = [...bare.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map((m) => ({ sel: m[1]!.trim().replace(/\s+/g, ' '), body: m[2]! }));
const bodyOf = (sel: string): string => rules.filter((r) => r.sel === sel).map((r) => r.body).join(';');
const art = (f: string): string => join(__dirname, '../../../apps/web/public/frames', f);

type Pt = [number, number];
const polygonOf = (sel: string): Pt[] => {
  const m = new RegExp(`${sel.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}\\s*\\{\\s*clip-path:\\s*polygon\\(([^)]*)\\)`).exec(bare);
  if (!m) throw new Error(`no traced polygon for ${sel}`);
  return m[1]!.split(',').map((p) => p.trim().split(/\s+/).map((v) => parseFloat(v)) as Pt);
};
const inside = (poly: Pt[], [x, y]: Pt): boolean => {
  let c = false;
  for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
    const [xi, yi] = poly[i]!, [xj, yj] = poly[j]!;
    if (yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) c = !c;
  }
  return c;
};

/** Coverage of the art by the polygon, in the box's percent space (`contain` = object-fit: contain in a box of that aspect). */
async function fit(file: string, poly: Pt[], contain?: [number, number]): Promise<{ covered: number; spill: number }> {
  const { data, info } = await sharp(art(file)).ensureAlpha().raw().toBuffer({ resolveWithObject: true });
  const W = info.width, H = info.height;
  let toPct = (x: number, y: number): Pt => [(x / W) * 100, (y / H) * 100];
  if (contain) {
    const [bw, bh] = contain;
    const k = Math.min(bw / W, bh / H), ox = (bw - W * k) / 2, oy = (bh - H * k) / 2;
    toPct = (x, y) => [((ox + x * k) / bw) * 100, ((oy + y * k) / bh) * 100];
  }
  let solid = 0, solidIn = 0, empty = 0, emptyIn = 0;
  for (let y = 0; y < H; y += 3) for (let x = 0; x < W; x += 3) {
    const a = data[(y * W + x) * 4 + 3]!;
    const hit = inside(poly, toPct(x + 0.5, y + 0.5));
    if (a >= 200) { solid++; if (hit) solidIn++; } else if (a <= 8) { empty++; if (hit) emptyIn++; }
  }
  return { covered: solidIn / solid, spill: emptyIn / Math.max(1, solidIn + emptyIn) };
}

describe('the traced hit polygons fit their art (R-HIT-SHAPE-01)', () => {
  const cases: [string, string, [number, number]?][] = [
    ['.tvbwrap::after', 'tavernup_base.webp'],
    ['.frzwrap::after', 'freeze_base.webp'],
    ['.etbwrap::after', 'end_button_base.webp'],
    // drawn `object-fit: contain` in the 170 x 72 button box (styles.css `.rfbwrap` / `.rfb-art`)
    ['.rfbwrap::after', 'refresh_button1.webp', [170, 72]],
  ];
  for (const [sel, file, contain] of cases) {
    it(`${sel} covers ${file}`, async () => {
      const { covered, spill } = await fit(file, polygonOf(sel), contain);
      expect(covered, 'opaque art outside the hit shape (a dead zone)').toBeGreaterThan(0.995);
      expect(spill, 'empty pixels inside the hit shape (a live zone)').toBeLessThan(0.04);
    });
  }
  it('the Refresh box still has the aspect its polygon was traced into', () => {
    const rfb = readFileSync(join(__dirname, 'styles.css'), 'utf8').match(/\.rfbwrap \{[^}]*width: calc\((\d+) \* var\(--u\)\); height: calc\((\d+) \* var\(--u\)\)/);
    expect(rfb?.slice(1, 3).map(Number)).toEqual([170, 72]);
    expect(readFileSync(join(__dirname, 'styles.css'), 'utf8')).toMatch(/\.rfb-art \{[^}]*object-fit: contain/);
  });
});

describe('every HUD control takes the pointer only through its shape (R-HIT-SHAPE-01)', () => {
  it('the board art buttons: box and art click-through, a shaped ::after takes the pointer, in every layout', () => {
    const off = bodyOf(':is(.tvbwrap, .frzwrap, .rfbwrap, .etbwrap)');
    expect(off).toMatch(/pointer-events:\s*none/);
    expect(bodyOf(':is(.tvbwrap, .frzwrap, .rfbwrap, .etbwrap)::after')).toMatch(/content:\s*'';[^;]*;?\s*position:\s*absolute;\s*inset:\s*0;[\s\S]*pointer-events:\s*auto/);
    // not keyed to any rail look (the old rule only held while the Docked rail was on)
    for (const r of rules.filter((x) => /(tvbwrap|frzwrap|rfbwrap|etbwrap)/.test(x.sel))) expect(r.sel).not.toMatch(/data-lobby-rail/);
    // the label pills and cost chips are drawn as part of the button and take the pointer through their own rounded box
    expect(bodyOf('.tvbwrap :is(.tvb-cost, .tvb-tierpill), .frzwrap .frz-pill, .rfbwrap .rfb-cost')).toMatch(/pointer-events:\s*auto/);
  });

  it('a dragged card drops through every hit layer', () => {
    expect(bodyOf('body.dragging .tvbwrap::after, body.dragging .frzwrap::after, body.dragging .rfbwrap::after, body.dragging .etbwrap::after, body.dragging .tvbwrap .tvb-cost, body.dragging .tvbwrap .tvb-tierpill, body.dragging .frzwrap .frz-pill, body.dragging .rfbwrap .rfb-cost')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('body.dragging .statusbar .heropanel .heropowerbtn .hpb-artwrap, body.dragging .statusbar .heropanel .heropowerbtn .hpb-glow')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('body.dragging .statusbar .hero .hpbox')).toMatch(/pointer-events:\s*none/);
  });

  it('hero powers (first, second, Equipment) and the foe power icon: the round art window is the shape, not the square box', () => {
    expect(bodyOf('.statusbar .heropanel, .statusbar .heropanel .hpwrap, .statusbar .heropanel .heropowerbtn')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('.statusbar .heropanel .heropowerbtn .hpb-artwrap')).toMatch(/pointer-events:\s*auto/);
    expect(bodyOf('.heropowerbtn.opp-power')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('.heropowerbtn.opp-power .hpb-artwrap')).toMatch(/pointer-events:\s*auto/);
    // the art window is the circle (styles.css)
    expect(readFileSync(join(__dirname, 'styles.css'), 'utf8')).toMatch(/\.heropowerbtn \.hpb-artwrap \{[^}]*border-radius: 50%/);
    // the panel's other live pieces keep their pointer (inheritance would have switched them off)
    expect(bodyOf('.statusbar .heropanel:not(.heropanel2):not(.equipslot) > :is(.hplabel, .anc-pill, .hmn-btn)')).toMatch(/pointer-events:\s*auto/);
  });

  it('the turn clock reaches over the strip rim; the Health plaque holds the pointer over the portrait foot', () => {
    expect(bodyOf('.statstrip > .statcell.time:only-child::after')).toMatch(/inset:\s*-2px;[\s\S]*border-radius:\s*calc\(13 \* var\(--u\)\)/);
    expect(bodyOf('.statusbar .hero .hpbox')).toMatch(/pointer-events:\s*auto/);
  });

  it('corner plaques: the hit covers the plaque AND its hard bottom edge, and counter-moves the hover lift (no edge flicker)', () => {
    const sel = ':is(.gearbtn, .bookbtn, .rulesbtn, .fdock-btn)';
    expect(bodyOf(sel)).toMatch(/pointer-events:\s*none/);
    expect(bodyOf(`${sel}::before`)).toMatch(/inset:\s*-1\.5px -1\.5px calc\(-1\.5px - 4px\)/);
    // the plaque lifts 2px on hover and drops 3px on press (styles.css); the hit layer moves back by the same
    expect(readFileSync(join(__dirname, 'styles.css'), 'utf8')).toMatch(/\.gearbtn:hover \{[^}]*transform: translateY\(-2px\)/);
    expect(bodyOf(`${sel}:hover::before`)).toMatch(/translate:\s*0 2px/);
    expect(bodyOf(`${sel}:active::before`)).toMatch(/translate:\s*0 -3px/);
  });

  it('rune and quest badges: the badge circle, not the 1.39x art image', () => {
    expect(bodyOf('.questbadge .questbadge-art')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('.questbadge.runebadge::before')).toMatch(/border-radius:\s*50%/);
  });

  it('the teammate dock: the disc is the way back, not the square dock box', () => {
    expect(bodyOf('.duosdock.self.self, .app.viewing .duosdock.self.self[role="button"]')).toMatch(/pointer-events:\s*none/);
    expect(bodyOf('.duosdock.self:not(.combat) .duosdock-hold')).toMatch(/pointer-events:\s*auto/);
  });

  it('is static: nothing in the file animates, and no bare keyword cursor', () => {
    expect(bare).not.toMatch(/animation|@keyframes/);
    expect(bare).not.toMatch(/cursor:\s*(pointer|default)\s*;/);
  });

  it('is loaded after every sheet it overrides', () => {
    const game = readFileSync(join(__dirname, 'Game.tsx'), 'utf8');
    const at = (f: string): number => game.indexOf(`import './${f}'`);
    expect(at('hitShapes.css')).toBeGreaterThan(at('styles.css'));
    expect(at('hitShapes.css')).toBeGreaterThan(at('phoneLayout.css'));
    expect(at('hitShapes.css')).toBeGreaterThan(at('runeCard.css'));
  });
});
