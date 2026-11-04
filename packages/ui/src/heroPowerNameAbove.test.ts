import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';

// R-HUD-HEROPOWER-NAME-01 (owner 2026-11-04: "certain portraits block the name of the hero power, can we move it
// above?"). The main hero power's name pill sits ABOVE the power art, out of flow, so the hero portrait's art and FX
// (which reach up under the power) never cover it, and the art never shifts. With a counter pill it stacks above the
// counter; the hover tip clears it. Phone / touch zoom grows it upward (away from the art).

const read = (f: string): string => readFileSync(join(__dirname, f), 'utf8').replace(/\/\*[\s\S]*?\*\//g, '');
const MAIN = '.statusbar .heropanel:not(.heropanel2):not(.equipslot)';

function body(css: string, selector: string): string {
  const esc = selector.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const m = new RegExp(`(?:^|[}\\s])${esc}\\s*\\{([^}]*)\\}`).exec(css);
  return m?.[1] ?? '';
}

describe('R-HUD-HEROPOWER-NAME-01: the hero power name sits above the art', () => {
  const styles = read('styles.css');

  it('the main power name is out of flow and anchored to the top of the panel', () => {
    const b = body(styles, `${MAIN} > .hplabel`);
    expect(b).toMatch(/position:\s*absolute/);
    expect(b).toMatch(/bottom:\s*calc\(100%/);
  });

  it('it stacks above the counter pill and the Clearance pip', () => {
    expect(body(styles, `${MAIN}:has(> .hpwrap > .hpb-pill) > .hplabel`)).toMatch(/bottom:\s*calc\(100% \+ var\(--hpb-name-above/);
    expect(body(styles, `${MAIN}:has(> .hpwrap > .clearance-uses) > .hplabel`)).toMatch(/bottom:\s*calc\(100% \+ \(var\(--hpb-name-above/);
  });

  it('the hover tip opens above the raised name', () => {
    expect(body(styles, `${MAIN} > .herotip`)).toMatch(/bottom:\s*calc\(100% \+ \d+ \* var\(--u\)\)/);
  });

  it('phone and touch zoom grow the name upward', () => {
    expect(body(read('phoneLayout.css'), `html[data-phone-layout] ${MAIN} > .hplabel`)).toMatch(/transform-origin:\s*50% 100%/);
    expect(body(read('touchUi.css'), `html[data-touch-ui][data-phone-zoom] ${MAIN} > .hplabel`)).toMatch(/transform-origin:\s*50% 100%/);
  });
});
