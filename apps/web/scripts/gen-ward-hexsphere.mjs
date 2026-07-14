// Regenerate the Ward hex-sphere: `node apps/web/scripts/gen-ward-hexsphere.mjs > apps/web/public/fx/ward-hexsphere.svg`
// Tweak S/H (facet density) or RHO_MAX and re-run to change how the Ward dome's hexagons read.
//
// Generate a hex-faceted SPHERE as an SVG (hexagons projected onto a hemisphere via orthographic projection):
// a flat pointy-top hex grid is laid out in ARC-distance space, and each vertex at arc distance ρ maps to
// screen radius sin(ρ). Equal arc steps → the cells COMPRESS toward the rim (ρ→π/2), matching a real hex
// force-field sphere. Output is one SVG string (viewBox 0 0 100 100, centred), gold facets.
const R2D = 180 / Math.PI;
const CX = 50, CY = 50, SCALE = 48;      // 2D unit radius → 48px (sphere ~96px across the 100 viewBox)
const S = 0.15;                           // hex-centre arc spacing (rad) — smaller = more, finer facets
const H = 0.142;                          // hex vertex radius (rad); < S → thin gaps between plates
const RHO_MAX = 1.5;                      // include hex centres out to just shy of the equator (π/2)
const HALF_PI = Math.PI / 2;

const project = (fx, fy) => {             // flat (arc-space) point → 2D screen point on the sphere
  let rho = Math.hypot(fx, fy);
  const th = Math.atan2(fy, fx);
  if (rho > HALF_PI) rho = HALF_PI;       // clamp so rim vertices flatten against the silhouette (no fold-back)
  const r = Math.sin(rho);
  return [CX + SCALE * r * Math.cos(th), CY + SCALE * r * Math.sin(th)];
};

const polys = [];
const dx = Math.sqrt(3) * S, dy = 1.5 * S;              // pointy-top axial spacing
const nR = Math.ceil(RHO_MAX / dy) + 2, nQ = Math.ceil(RHO_MAX / dx) + 2;
for (let r = -nR; r <= nR; r++) {
  for (let q = -nQ; q <= nQ; q++) {
    const fx = dx * (q + r / 2), fy = dy * r;            // hex centre in arc space
    if (Math.hypot(fx, fy) > RHO_MAX) continue;
    const pts = [];
    for (let k = 0; k < 6; k++) {                        // pointy-top vertices (start 30°)
      const a = ((60 * k + 30) / R2D);
      const [px, py] = project(fx + H * Math.cos(a), fy + H * Math.sin(a));
      pts.push(`${px.toFixed(2)},${py.toFixed(2)}`);
    }
    polys.push(`<polygon points='${pts.join(' ')}'/>`);
  }
}

// Faint translucent plate fill + a crisp bright-blue facet stroke. Screen-blended in CSS over the blue dome, so
// white-blue strokes read as glowing energy facets. The CSS layer controls overall opacity / blend / rim-mask.
const svg =
  `<svg xmlns='http://www.w3.org/2000/svg' viewBox='0 0 100 100'>` +
  `<g fill='#8fd0ff' fill-opacity='0.05' stroke='#dff2ff' stroke-width='0.32' stroke-opacity='0.92'>` +
  polys.join('') +
  `</g></svg>`;

process.stdout.write(svg); // raw SVG → saved as a real asset (apps/web/public/fx/ward-hexsphere.svg)
console.error(`\n[hexsphere] ${polys.length} facets, ${svg.length} svg chars`);
