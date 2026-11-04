import { describe, expect, it, vi } from 'vitest';
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join, relative } from 'node:path';
import { publicArtList } from '../../../apps/web/publicArt';

/**
 * ONE IMAGE PATH: THE TRIPWIRE (owner 2026-11-04: "how do we resolve that once and for all where we simply never have to
 * worry about it again?", R-PERF-ART-PLAN-COMPLETE-01). The boot gate can only hold art it knows about. Portrait frame
 * skins, emotes, pings and the Versus arena all shipped outside the plan, so a player who owned them paid a cold load
 * every time. Every image in the game now has to be accounted for: in the plan, or named here with a reason.
 */
const calls = vi.hoisted(() => [] as string[]);
vi.mock('./artPreload', () => ({
  requestArtList: (urls: Iterable<string | undefined>) => { for (const u of urls) if (u) calls.push(u); },
  requestMaskArt: () => {},
  requestHeldArtList: (urls: Iterable<string>) => { for (const u of urls) calls.push(u); },
}));

import { CARD_PLATE_LOOKS, plateLookUrls } from './cardPlate/cardPlateLook';
import { PUBLIC_MASK_ART, preloadBootArt } from './preloadPlan';

const UI = __dirname;
const WEB = join(UI, '../../../apps/web');
const IMG = /\.(webp|png|jpe?g|svg|gif)$/i;

function walk(dir: string, out: string[] = []): string[] {
  for (const e of readdirSync(dir)) {
    const p = join(dir, e);
    if (statSync(p).isDirectory()) walk(p, out);
    else out.push(p);
  }
  return out;
}
const rel = (root: string, p: string): string => relative(root, p).split('\\').join('/');

/** Bundled images deliberately outside the plan, with why. */
const EXEMPT_BUNDLED: Record<string, string> = {
  'art/pings/inspect.webp': 'kept in the folder, unused and out of the bundle (pingArt.ts)',
};

/** Public images no source names. They ship but nothing can mount them; a new one here means art went dead or the
 *  source builds its name in a way `publicArt.ts` cannot see, and the second case is a pop-in. */
const EXEMPT_PUBLIC: readonly [RegExp, string][] = [
  [/^(?:apple-touch-icon\.png|ascenticon\.png|icon-\d+\.png)$/, 'the browser and the home screen fetch these, the game never draws them'],
  [/^(?:ascentboardnostuff|augustboardcombat|augustfullboard|board1|board169|board219|board2b|newboardaugust)\.webp$|^board\.jpg$/, 'old boards nothing mounts'],
  [/^backdrop-[a-z-]+-sm\.webp$/, 'a touch device\'s small backdrop (backdropSmallUrl): desktop never loads it, a phone streams it'],
  [/^loadscreen\.webp$/, 'the splash itself: apps/web/index.html paints it on the first frame, before any plan exists'],
  [/^frames\/plates\/plate_[a-z0-9_]+-backbox\.webp$/,'the darkening of a plate tuned to darken: false: no look draws it'],
  [/^frames\/plates\/interiors\/brown\.webp$/, 'the default interior, worn by no plate today; a plate that wears it reaches the plan through its look'],
  [/^opp-rune-slot-\d\.webp$/, 'an old opponent rune socket nothing mounts'],
];

describe('every image in the game is in the preload plan or explicitly exempt', () => {
  it('bundled art: every image file under packages/ui/src', () => {
    calls.length = 0;
    preloadBootArt([], false);
    const planned = calls.map((u) => u.split('?')[0]!);
    const files = walk(UI).filter((f) => IMG.test(f)).map((f) => rel(UI, f));
    expect(files.length).toBeGreaterThan(1500); // guards against a vacuous pass
    const missing = files.filter((f) => !EXEMPT_BUNDLED[f] && !planned.some((u) => u.endsWith(`/${f}`)));
    expect(missing, `add these to preloadPlan.ts (or EXEMPT_BUNDLED with a reason): ${missing.join(', ')}`).toEqual([]);
  });

  it('public art: every image file in apps/web/public is named by the source or exempt', () => {
    // Plates are named from a constant the source scan cannot read: the plan reaches them through `CARD_PLATE_LOOKS`.
    const plates = Object.values(CARD_PLATE_LOOKS).flatMap(plateLookUrls).map((u) => u.replace(/^\.?\//, ''));
    const named = new Set([...publicArtList(join(WEB, 'public'), [UI, join(WEB, 'src')]), ...plates]);
    const files = walk(join(WEB, 'public')).filter((f) => IMG.test(f)).map((f) => rel(join(WEB, 'public'), f));
    expect(files.length).toBeGreaterThan(200);
    const unknown = files.filter((f) => !named.has(f) && !EXEMPT_PUBLIC.some(([re]) => re.test(f)));
    expect(unknown, `no source names these, so the plan skips them: ${unknown.join(', ')}`).toEqual([]);
  });

  it('headers: every public image has a Cache-Control rule (no rule = a server round trip on every mount)', () => {
    const text = readFileSync(join(WEB, 'public/_headers'), 'utf8');
    const rules = [...text.matchAll(/^(\/\S*)\r?\n\s+Cache-Control:/gm)].map((m) => new RegExp(`^${m[1]!.replace(/[.+]/g, '\\$&').replace(/\*/g, '.*')}$`));
    const live = walk(join(WEB, 'public')).filter((f) => IMG.test(f)).map((f) => `/${rel(join(WEB, 'public'), f)}`)
      .filter((f) => !EXEMPT_PUBLIC.some(([re]) => re.test(f.slice(1))) || f.endsWith('loadscreen.webp'));
    expect(live.filter((f) => !rules.some((re) => re.test(f)))).toEqual([]);
    expect(rules.some((re) => re.test('/m1/frames/oval-beast.webp')), 'the phone copies').toBe(true);
  });

  it('masks: every public image a stylesheet masks with is held in CORS mode (R-PERF-ART-MASKS-HELD-01)', () => {
    const css = walk(UI).filter((f) => f.endsWith('.css') && !f.includes('partyHome')).map((f) => readFileSync(f, 'utf8')).join('\n');
    const used = [...css.matchAll(/mask(?:-image)?\s*:[^;{}]*?url\(['"]?\/([^'")]+)/g)].map((m) => m[1]!);
    expect(used.length).toBeGreaterThan(8);
    // One memory-cache entry per URL: a mask under a plain image's URL evicts it on every mount, so it gets its own.
    expect(used.filter((u) => !u.endsWith('?mask'))).toEqual([]);
    expect([...new Set(used.map((u) => u.replace(/\?mask$/, '')))].filter((u) => !PUBLIC_MASK_ART.includes(u))).toEqual([]);
    const files = new Set(walk(join(WEB, 'public')).map((f) => rel(join(WEB, 'public'), f)));
    expect(PUBLIC_MASK_ART.filter((u) => !files.has(u))).toEqual([]);
  });

  it('public art: every public path the stylesheet or the source spells out exists (a typo is a blank, not a pop-in)', () => {
    const css = readFileSync(join(UI, 'styles.css'), 'utf8');
    const refs = [...css.matchAll(/url\(['"]?\/([^'")*?]+\.(?:webp|png|jpe?g|svg))/g)].map((m) => m[1]!);
    expect(refs.length).toBeGreaterThan(20);
    const files = new Set(walk(join(WEB, 'public')).map((f) => rel(join(WEB, 'public'), f)));
    expect(refs.filter((r) => !files.has(r))).toEqual([]);
  });
});
