import { describe, expect, it } from 'vitest';
import {
  fitWithin,
  imageId,
  imageSlugOf,
  isImageId,
  labelFromFilename,
  IMAGE_ID_PREFIX,
  IMAGE_MAX_PX,
  getImageTexture,
  listImageOptions,
} from './imageLibrary';

describe('image ids', () => {
  it('round-trips a slug through the `image:` namespace', () => {
    expect(imageId('coin')).toBe(`${IMAGE_ID_PREFIX}coin`);
    expect(isImageId('image:coin')).toBe(true);
    expect(imageSlugOf('image:coin')).toBe('coin');
  });

  it('rejects the bare prefix, built-in shape names, and the particle namespaces', () => {
    for (const id of ['image:', '', 'circle', 'custom:coin', 'art:coin']) {
      expect(isImageId(id), id).toBe(false);
      expect(imageSlugOf(id), id).toBe('');
    }
  });
});

describe('fitWithin', () => {
  it('never upscales — a small image keeps its own size', () => {
    expect(fitWithin(300, 200, IMAGE_MAX_PX)).toEqual({ w: 300, h: 200 });
    expect(fitWithin(IMAGE_MAX_PX, 10, IMAGE_MAX_PX)).toEqual({ w: IMAGE_MAX_PX, h: 10 });
  });

  it('fits the LONGEST side to the cap and preserves aspect, in either orientation', () => {
    expect(fitWithin(2048, 1024, 1024)).toEqual({ w: 1024, h: 512 });
    expect(fitWithin(1000, 4000, 1024)).toEqual({ w: 256, h: 1024 });
  });

  it('clamps degenerate input to 1 px so a canvas can always be allocated', () => {
    expect(fitWithin(0, 0, 1024)).toEqual({ w: 1, h: 1 });
    expect(fitWithin(5000, 0.2, 1024)).toEqual({ w: 1024, h: 1 });
  });
});

describe('labelFromFilename', () => {
  it('strips only the extension', () => {
    expect(labelFromFilename('Coin Flip.png')).toBe('Coin Flip');
    expect(labelFromFilename('sigil.v2.svg')).toBe('sigil.v2');
    expect(labelFromFilename('noext')).toBe('noext');
  });
});

describe('headless behaviour (the node test environment)', () => {
  it('a lookup for anything unresolvable is null — never a throw — so a primitive can always construct', () => {
    expect(getImageTexture('image:nothing-here')).toBeNull();
    expect(getImageTexture('')).toBeNull();
    expect(getImageTexture('circle')).toBeNull();
  });

  it('lists only committed images (none in this checkout) as picker rows', () => {
    for (const o of listImageOptions()) expect(isImageId(o.id)).toBe(true);
  });
});
