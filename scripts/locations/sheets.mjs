// The hanging parchments (sheet-<tribe>.webp), baked from the reveal's own shader at rest. Needs the dev server; loads nothing but it.
//   node scripts/locations/sheets.mjs [http://localhost:5173/]
import { chromium } from 'playwright-core';
import sharp from 'sharp';
const URL_ = process.argv[2] ?? 'http://localhost:5173/';
const SRC = new URL('../../packages/ui/src/locationReveal/revealShaders.ts', import.meta.url).pathname;
const b = await chromium.launch({ headless: true, channel: 'chrome', args: ['--use-angle=d3d11', '--ignore-gpu-blocklist'] });
const p = await b.newPage();
p.on('console', (m) => { if (/ERROR:/.test(m.text())) console.log(m.text().slice(0, 300)); }); // a shader that does not compile
await p.route('**/*', (r) => (/localhost|127.0.0.1|^data:|^blob:/.test(r.request().url()) ? r.continue() : r.abort()));
await p.goto(URL_, { waitUntil: 'commit' });
await p.waitForTimeout(10000);
/** Keep in step with `posters` in locations.ts (the order is each sheet's own crease and sway). */
const L = { outskirts: ['dragon', 'beast', 'kobold', 'dwarf', 'demon'], underbelly: ['undead', 'kobold', 'dragon', 'dwarf', 'spirit'] };
for (const [loc, tribes] of Object.entries(L)) for (let i = 0; i < tribes.length; i++) {
  const url = await p.evaluate(async ({ loc, t, i, W, H, SRC }) => {
    const SH = await (async () => { const u = performance.getEntriesByType('resource').map((r) => r.name).find((n) => /revealShaders\.ts/.test(n)); return import(u ?? `/@fs${SRC}`); })();
    const c = document.createElement('canvas'); c.width = W; c.height = H;
    const gl = c.getContext('webgl2', { alpha: true, premultipliedAlpha: true, preserveDrawingBuffer: true });
    const mk = (ty, src) => { const s = gl.createShader(ty); gl.shaderSource(s, '#version 300 es\n' + SH.common + '\n' + src); gl.compileShader(s); if (!gl.getShaderParameter(s, gl.COMPILE_STATUS)) console.log(gl.getShaderInfoLog(s)); return s; };
    const pr = gl.createProgram(); gl.attachShader(pr, mk(gl.VERTEX_SHADER, 'in vec2 a; out vec2 uv, loc; void main(){ uv = a; loc = (a - .5) * 1.5; gl_Position = vec4(a.x * 2. - 1., 1. - a.y * 2., 0., 1.); }')); gl.attachShader(pr, mk(gl.FRAGMENT_SHADER, SH.fsPost)); gl.bindAttribLocation(pr, 0, 'a'); gl.linkProgram(pr); gl.useProgram(pr);
    gl.bindBuffer(gl.ARRAY_BUFFER, gl.createBuffer()); gl.bufferData(gl.ARRAY_BUFFER, new Float32Array([0, 0, 1, 0, 0, 1, 1, 1]), gl.STATIC_DRAW); gl.enableVertexAttribArray(0); gl.vertexAttribPointer(0, 2, gl.FLOAT, false, 0, 0);
    const img = await createImageBitmap(await (await fetch(`/locations/${loc}/poster-${t}.webp`)).blob(), { premultiplyAlpha: 'none', colorSpaceConversion: 'none' });
    gl.bindTexture(gl.TEXTURE_2D, gl.createTexture()); gl.texImage2D(gl.TEXTURE_2D, 0, gl.RGBA, gl.RGBA, gl.UNSIGNED_BYTE, img); gl.generateMipmap(gl.TEXTURE_2D); gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MIN_FILTER, gl.LINEAR_MIPMAP_LINEAR);
    const u = (n) => gl.getUniformLocation(pr, n);
    gl.uniform1f(u('rev'), 1); gl.uniform1f(u('s'), 0.35); gl.uniform1f(u('seed'), i + 1.3); gl.uniform1f(u('sway'), 0); gl.uniform1f(u('curl'), 0.012); gl.uniform1f(u('fade'), 1); gl.uniform3f(u('tc'), 0, 0, 0); gl.uniform2f(u('sz'), 0.328, 0.445);
    gl.viewport(0, 0, W, H); gl.clearColor(0, 0, 0, 0); gl.clear(gl.COLOR_BUFFER_BIT); gl.drawArrays(gl.TRIANGLE_STRIP, 0, 4);
    return c.toDataURL('image/png');
  }, { loc, t: tribes[i], i, W: 1120, H: 1520, SRC }).catch((e) => { console.log(e.message.slice(0, 300)); return null; });
  if (!url) continue;
  // The shader's own margin off, then the size they hang at.
  await sharp(Buffer.from(url.split(',')[1], 'base64')).extract({ left: 67, top: 91, width: 986, height: 1338 }).resize(330, 448).webp({ quality: 88, alphaQuality: 90, effort: 6 }).toFile(`apps/web/public/locations/${loc}/sheet-${tribes[i]}.webp`);
}
await b.close();
