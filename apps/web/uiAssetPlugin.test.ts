import { Buffer } from 'node:buffer';
import path from 'node:path';
import { describe, it, expect } from 'vitest';
import { planUiAsset, ASSET_DATA_URL_PREFIX, MAX_ASSET_BYTES } from './uiAssetPlugin';

const ROOT = path.resolve('/repo/packages/ui/src/assets/ui-editor');
const PNG_HEADER = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
const pngDataUrl = (extra = 0) =>
  ASSET_DATA_URL_PREFIX + Buffer.concat([PNG_HEADER, Buffer.alloc(extra, 1)]).toString('base64');

describe('planUiAsset', () => {
  it('accepts a valid PNG and targets <root>/<slug>.png', () => {
    const plan = planUiAsset({ slug: 'medallion-v2', dataUrl: pngDataUrl(10) }, ROOT);
    expect(plan.status).toBe(200);
    expect(plan.file).toBe(path.join(ROOT, 'medallion-v2.png'));
  });
  it('rejects a bad slug', () => {
    expect(planUiAsset({ slug: '../evil', dataUrl: pngDataUrl() }, ROOT).status).toBe(400);
  });
  it('rejects a non-PNG payload', () => {
    expect(planUiAsset({ slug: 'x', dataUrl: 'data:image/png;base64,AAAA' }, ROOT).status).toBe(400);
  });
  it('rejects an oversize payload', () => {
    const big = ASSET_DATA_URL_PREFIX + 'A'.repeat(MAX_ASSET_BYTES * 2 + 4);
    expect(planUiAsset({ slug: 'x', dataUrl: big }, ROOT).status).toBe(413);
  });
});
