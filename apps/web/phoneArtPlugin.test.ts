import { describe, expect, it } from 'vitest';
import { planPhoneArt } from './phoneArtPlugin';

/** Which files the production build writes a phone copy for (owner 2026-10-18: "the iPhone crashes a lot"). */
describe('planPhoneArt', () => {
  const assets = [
    { key: 'art/minions/whelp.webp', width: 512, height: 512 },
    { key: 'art/minions/tiny.webp', width: 200, height: 200 },
    { key: 'art/heroes/warden.webp', width: 512, height: 512 },
    { key: 'art/modes/lobby.webp', width: 1916, height: 821 },
    { key: 'art/frames/frame_gold.webp', width: 768, height: 768 },
  ];
  const pub = [
    { key: 'augustfullboard.webp', width: 3840, height: 2143 },
    { key: 'frames/oval-beast.webp', width: 1059, height: 1427 },
    { key: 'frames/standard-oval-v2.png', width: 1000, height: 1300 },
    { key: 'frames/tier-stars-1.webp', width: 300, height: 100 },
    { key: 'frames/title-logo.png', width: 2000, height: 800 },
    { key: 'cursors/gauntlet_open.svg', width: 0, height: 0 },
  ];
  const css = ".x { mask: url('/frames/standard-oval-v2.png'); } :root { --board: url('/augustfullboard.webp'); }";
  const { manifest, assets: a, pub: p } = planPhoneArt(assets, pub, css);

  it('copies bundled art larger than its folder cap; leaves small files and uncapped folders alone', () => {
    expect(manifest.assets).toEqual(['art/heroes/warden.webp', 'art/minions/whelp.webp', 'art/modes/lobby.webp']);
    expect(a.find((x) => x.key === 'art/minions/whelp.webp')!.cap).toBe(256);
    expect(a.find((x) => x.key === 'art/heroes/warden.webp')!.cap).toBe(384);
  });

  it('copies public art the UI switches per device; never a file a stylesheet names (except the board vars)', () => {
    expect(manifest.public).toEqual(['augustfullboard.webp', 'frames/oval-beast.webp']);
    expect(p.find((x) => x.key === 'augustfullboard.webp')!.cap).toBe(1920);
  });

  it('the copies live in their own versioned folder', () => {
    expect(manifest.dir).toBe('m1');
  });
});
