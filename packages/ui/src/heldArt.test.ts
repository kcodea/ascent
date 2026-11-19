import { describe, expect, it } from 'vitest';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { heldArtNeedsRepaint, heldArtSize } from './heldArt';

/**
 * PHASE-CHANGE ART IS HELD, NOT DECODED AGAIN (R-PERF-PHASE-ART-HELD-01, 2026-11-18).
 *
 * Measured on the production build (docs/devlog/2026-11-18-perf-phase-transitions.md): the return trip's five
 * 2560 x 1440 layers were decoded again at the end of EVERY fight (25 to 73 ms each, the main thread stuck behind
 * them), because the compositor's decode cache drops big pictures that are off screen for a phase. On desktop they are
 * canvases now: painted once, kept for the session, nothing to decode when they show. The combat board stays a CSS
 * background (the browser's own scaling) and is asked for off the main thread as End Turn is pressed.
 */
const SRC = __dirname;
const recruit = readFileSync(join(SRC, 'Recruit.tsx'), 'utf8');
const css = readFileSync(join(SRC, 'styles.css'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');

describe('held art: canvas size', () => {
  it('covers the drawn size at the picture\'s own aspect, never bigger than the picture', () => {
    expect(heldArtSize(2560, 1440, 1920, 1080)).toEqual({ w: 1920, h: 1080 });
    expect(heldArtSize(2560, 1440, 3440, 1935)).toEqual({ w: 2560, h: 1440 }); // a bigger window: the picture itself
    expect(heldArtSize(2560, 1440, 1280, 1080)).toEqual({ w: 1920, h: 1080 }); // cover: the larger of the two scales
    expect(heldArtSize(2560, 1440, 0, 0)).toEqual({ w: 2560, h: 1440 }); // no size known: the picture itself
    expect(heldArtSize(0, 0, 1920, 1080)).toEqual({ w: 0, h: 0 });
  });

  it('is painted again only when it has to grow by a real margin', () => {
    expect(heldArtNeedsRepaint(1920, 1920)).toBe(false);
    expect(heldArtNeedsRepaint(1920, 1280)).toBe(false); // a smaller window keeps the sharper copy
    expect(heldArtNeedsRepaint(1920, 2000)).toBe(false); // a few px: not worth a decode
    expect(heldArtNeedsRepaint(1920, 2560)).toBe(true);
  });
});

describe('held art: the return trip', () => {
  it('every desktop vista layer mounts a held canvas; a phone keeps its one CSS picture', () => {
    expect(recruit).toContain('| null = PHONE_GPU ? null');
    expect(recruit).toContain('mountHeldArt(el, publicArt(`vista-${n}.webp`), vistaDrawnSize)');
    // All five layers carry the class and the ref (sky / far / mid through the map, shop and fore by name).
    expect(recruit.match(/\$\{VISTA_HELD \? ' canvased' : ''\}/g)?.length).toBe(3);
    expect(recruit).toContain('ref={VISTA_HELD?.[n]}');
    expect(recruit).toContain('ref={VISTA_HELD?.shop}');
    expect(recruit).toContain('ref={VISTA_HELD?.fore}');
  });

  it('a canvased layer draws no CSS picture (that one is what the compositor decodes again), unless the canvas failed', () => {
    expect(css).toContain('.wipevista-layer.canvased:not(.heldart-off) { background-image: none; }');
    expect(css).toMatch(/\.heldart \{[^}]*inset: 0;[^}]*width: 100%;[^}]*height: 100%;/);
    expect(css).toContain('.heldart-off > .heldart { display: none; }');
  });

  it('the canvas refs are stable (module level), so a re-render never re-mounts or measures', () => {
    const at = recruit.indexOf('const VISTA_HELD');
    expect(at).toBeGreaterThan(0);
    expect(at).toBeLessThan(recruit.indexOf('const [wipe, setWipe]'));
    // No layout read on the mount path.
    const held = readFileSync(join(SRC, 'heldArt.ts'), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '').replace(/\/\/.*$/gm, '');
    expect(held).not.toMatch(/getBoundingClientRect|offsetWidth|offsetHeight|clientWidth|clientHeight/);
  });
});

describe('held art: the fight-end warm-up', () => {
  it('desktop skips the invisible play (nothing to decode); only the two small door pictures are asked for', () => {
    expect(recruit).toMatch(/vistaWarmedForRef\.current = run\.lastCombat;[\s\S]{0,900}if \(!PHONE_GPU\) \{ warmVistaDoorArt\(\); return undefined; \}\s*setVistaWarm\('hold'\);/);
    const ahead = readFileSync(join(SRC, 'decodeAhead.ts'), 'utf8');
    for (const f of ['vista-doorfill.webp', 'vista-doorglow.webp']) expect(ahead).toContain(`'${f}'`);
  });

  it('the door pieces keep what they drew through the 18x dive (no redraw at the zoomed size)', () => {
    for (const sel of ['.wipevista-doorfill', '.wipevista-doordark', '.wipevista-doorglow']) {
      const rule = css.split('}').find((r) => r.trim().startsWith(`${sel} {`) && r.includes('will-change: opacity, transform;'));
      expect(rule, sel).toBeDefined();
    }
  });
});

describe('decode ahead: End Turn', () => {
  it('the gate and the combat board are asked for on hover, on the press and as the gate falls', () => {
    expect(readFileSync(join(SRC, 'EndTurnButton.tsx'), 'utf8')).toContain('onPointerEnter={combatReady || skipReady ? undefined : warmEndTurnArt}');
    expect(recruit).toMatch(/const endTurn = \(\): void => \{\s*if \(inCombat \|\| endTurnPendingRef\.current\) return;[\s\S]{0,400}warmEndTurnArt\(\);/);
    expect(recruit).toContain("if (wipe === 'chargeIn' || wipe === 'coverIn') warmEndTurnArt();");
    const ahead = readFileSync(join(SRC, 'decodeAhead.ts'), 'utf8');
    for (const f of ['frames/end_button_gem_cracked.webp', 'transition-gate.webp', 'transition-poster.webp', 'playingboard-combat.webp', 'playingboard-combat-shadow.webp']) expect(ahead).toContain(`'${f}'`);
    expect(ahead).toContain('END_TURN_ART: readonly string[] = PHONE_GPU ? []'); // phones keep their bounded picture memory
  });
});
