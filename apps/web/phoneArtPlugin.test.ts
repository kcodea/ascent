import { describe, expect, it } from 'vitest';
import { planPhoneArt, stripCssComments } from './phoneArtPlugin';

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
    { key: 'playingboard.webp', width: 3840, height: 2143 },
    { key: 'frames/oval-beast.webp', width: 1059, height: 1427 },
    { key: 'frames/standard-oval-v2.png', width: 1000, height: 1300 },
    { key: 'frames/tier-stars-1.webp', width: 300, height: 100 },
    { key: 'frames/title-logo.png', width: 2000, height: 800 },
    { key: 'cursors/gauntlet_open.svg', width: 0, height: 0 },
  ];
  const css = ".x { mask: url('/frames/standard-oval-v2.png'); } :root { --board: url('/playingboard.webp'); }";
  const { manifest, assets: a, pub: p } = planPhoneArt(assets, pub, css);

  it('copies bundled art larger than its folder cap; leaves small files and uncapped folders alone', () => {
    expect(manifest.assets).toEqual(['art/heroes/warden.webp', 'art/minions/whelp.webp', 'art/modes/lobby.webp']);
    expect(a.find((x) => x.key === 'art/minions/whelp.webp')!.cap).toBe(256);
    expect(a.find((x) => x.key === 'art/heroes/warden.webp')!.cap).toBe(384);
  });

  it('copies public art the UI switches per device; never a file a stylesheet names (except the board vars)', () => {
    expect(manifest.public).toEqual(['frames/oval-beast.webp', 'playingboard.webp']);
    expect(p.find((x) => x.key === 'playingboard.webp')!.cap).toBe(1920);
  });

  it("the return trip's vista gets a 1280 px copy although a stylesheet names it (a CSS var a phone re-points; R-TOUCH-RUN-MEMORY-02)", () => {
    const vistaCss = ".wipevista-flat { background-image: var(--vista-flat, url('/vista-flat.webp')); }";
    const v = planPhoneArt([], [
      { key: 'vista-flat.webp', width: 2560, height: 1440 },
      { key: 'vista-sky.webp', width: 2560, height: 1440 },
    ], vistaCss);
    expect(v.manifest.public).toEqual(['vista-flat.webp']);
    expect(v.pub.map((x) => x.cap)).toEqual([1280]);
  });

  it('hero portraits (and skins) ALSO get a 256 px thumbnail for the lobby rail; nothing else does (R-PHONE-HERO-SHARP-01)', () => {
    expect(manifest.thumbs).toEqual(['art/heroes/warden.webp']);
    expect(manifest.thumbDir).toBe('t2');
    const t = planPhoneArt([{ key: 'art/skins/skin_x_1.webp', width: 512, height: 512 }, { key: 'art/heroes/tiny.webp', width: 120, height: 120 }], [], '');
    expect(t.thumbs.map((x) => [x.key, x.cap])).toEqual([['art/skins/skin_x_1.webp', 256]]);
  });

  it('the copies live in their own versioned folder', () => {
    expect(manifest.dir).toBe('m1');
  });

  // R-PHONE-CSS-COMMENT-01 (CI phone-budgets, 2026-10-31): the shaped hit areas' stylesheet NAMED the End Turn, Tier-up
  // and Refresh art in comments (where each polygon was traced from), and that alone cost those buttons their phone copy.
  it('a file a stylesheet only mentions in a COMMENT still gets its copy; a real url() still blocks it', () => {
    const btn = [{ key: 'frames/end_button_base.webp', width: 1001, height: 1088 }, { key: 'frames/freeze_base.webp', width: 833, height: 915 }];
    const commented = '/* frames/end_button_base.webp, --grow 6 (the diamond) */ .x { clip-path: none; }\n.y { /* the freeze_base.webp diamond */ }';
    expect(planPhoneArt([], btn, commented).manifest.public).toEqual(['frames/end_button_base.webp', 'frames/freeze_base.webp']);
    expect(planPhoneArt([], btn, `${commented} .z { background: url('/frames/end_button_base.webp'); }`).manifest.public).toEqual(['frames/freeze_base.webp']);
  });

  it('stripCssComments drops every comment (multi-line too) and keeps the rules', () => {
    expect(stripCssComments('a { b: c; } /* x.webp\n y.webp */ d { e: url(f.webp); }/**/')).toBe('a { b: c; }   d { e: url(f.webp); } ');
  });
});
