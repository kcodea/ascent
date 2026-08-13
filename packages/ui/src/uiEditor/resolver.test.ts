import { describe, it, expect } from 'vitest';
import { resolveAnchor, selectParent, isAnchor } from './resolver';

/** Minimal fake Element: only the members resolver reads. */
function node(opts: {
  attrs?: Record<string, string>;
  classes?: string[];
  parent?: Element | null;
}): Element {
  const attrs = opts.attrs ?? {};
  const classes = new Set(opts.classes ?? []);
  return {
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    classList: { contains: (c: string) => classes.has(c) },
    parentElement: opts.parent ?? null,
  } as unknown as Element;
}

describe('resolveAnchor', () => {
  it('returns the nearest known-class ancestor, not the outermost', () => {
    const card = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'] });
    const cgem = node({ classes: ['cgem'], parent: card });
    const glyph = node({ parent: cgem }); // clicked target
    expect(resolveAnchor(glyph)).toBe(cgem);
  });
  it('resolves an element that is itself an anchor to itself', () => {
    const pill = node({ classes: ['pill'] });
    expect(resolveAnchor(pill)).toBe(pill);
  });
  it('falls back to the original element when nothing up-chain is an anchor', () => {
    const outer = node({});
    const inner = node({ parent: outer });
    expect(resolveAnchor(inner)).toBe(inner);
  });
  it('treats any anchor data-attr as an anchor', () => {
    expect(isAnchor(node({ attrs: { 'data-ui': 'hud-gold' } }))).toBe(true);
    expect(isAnchor(node({}))).toBe(false);
  });
});

describe('selectParent', () => {
  it('skips the element itself and returns the next anchor above', () => {
    const zone = node({ attrs: { 'data-zone': 'warband' } });
    const card = node({ classes: ['card'], parent: zone });
    expect(selectParent(card)).toBe(zone);
  });
  it('returns null when there is no anchor above', () => {
    const root = node({});
    const card = node({ classes: ['card'], parent: root });
    expect(selectParent(card)).toBeNull();
  });
});
