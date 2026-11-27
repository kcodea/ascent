/* eslint-disable @typescript-eslint/no-require-imports */
// PACK DEPTH PICTURES (the shapes scripts/pack-relief-maps.cjs builds each relief map from).
// Usage: node scripts/pack-depth-maps.cjs <model.onnx> <srcDir> <outDir> [previewPng]
//   <model.onnx>  Depth Anything V2 Small: huggingface.co/onnx-community/depth-anything-v2-small, onnx/model.onnx (99 MB).
//                 Not in the repo, and neither is its runtime: `npm install --no-save onnxruntime-node` first.
//   <srcDir>      the cut pack wrappers, normally apps/web/public/packs (<id>-pack.webp)
//   <outDir>      normally scripts/pack-depth
// Writes <outDir>/<id>.png: 518 x 770, 8-bit grey, white = nearest, stretched to the wrapper own range.
const ort = require('onnxruntime-node');
const sharp = require('sharp');
const fs = require('fs');
const [, , MODEL, SRC, OUT, PREVIEW] = process.argv;
const IW = 518, IH = 770, W = 300, H = 450;
const MEAN = [0.485, 0.456, 0.406], STD = [0.229, 0.224, 0.225];
(async () => {
  fs.mkdirSync(OUT, { recursive: true });
  const session = await ort.InferenceSession.create(MODEL);
  console.log('inputs', session.inputNames, 'outputs', session.outputNames);
  const ids = fs.readdirSync(SRC).map((f) => /^([a-z]+)-pack\.webp$/.exec(f)).filter(Boolean).map((m) => m[1]);
  const previews = [];
  for (const id of ids) {
    const file = `${SRC}/${id}-pack.webp`;
    const rgb = await sharp(file).flatten({ background: '#808080' }).resize(IW, IH, { fit: 'fill', kernel: 'cubic' }).removeAlpha().raw().toBuffer();
    const x = new Float32Array(3 * IW * IH);
    for (let i = 0; i < IW * IH; i++) for (let c = 0; c < 3; c++) x[c * IW * IH + i] = (rgb[i * 3 + c] / 255 - MEAN[c]) / STD[c];
    const res = await session.run({ [session.inputNames[0]]: new ort.Tensor('float32', x, [1, 3, IH, IW]) });
    const o = res[session.outputNames[0]];
    const oh = o.dims[o.dims.length - 2], ow = o.dims[o.dims.length - 1];
    const alpha = await sharp(file).ensureAlpha().extractChannel(3).resize(ow, oh, { fit: 'fill' }).raw().toBuffer();
    let lo = Infinity, hi = -Infinity;
    for (let i = 0; i < ow * oh; i++) if (alpha[i] > 200) { const v = o.data[i]; if (v < lo) lo = v; if (v > hi) hi = v; }
    const u8 = Buffer.alloc(ow * oh);
    for (let i = 0; i < ow * oh; i++) u8[i] = Math.round(255 * Math.max(0, Math.min(1, (o.data[i] - lo) / (hi - lo))));
    const img = sharp(u8, { raw: { width: ow, height: oh, channels: 1 } });
    await img.clone().png().toFile(`${OUT}/${id}.png`);
    previews.push({ input: await img.clone().resize(W, H, { fit: 'fill' }).png().toBuffer(), left: previews.length * (W + 10), top: 0 });
    console.log(id, ow + 'x' + oh, 'range', lo.toFixed(2), hi.toFixed(2));
  }
  if (PREVIEW) await sharp({ create: { width: previews.length * (W + 10), height: H, channels: 3, background: '#000' } }).composite(previews).png().toFile(PREVIEW);
})().catch((e) => { console.error('FAILED', e); process.exit(1); });
