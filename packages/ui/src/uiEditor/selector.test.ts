import { describe, it, expect } from 'vitest';
import { buildSelector } from './selector';

function node(opts: {
  tag?: string;
  attrs?: Record<string, string>;
  classes?: string[];
  parent?: Element | null;
}): Element {
  const attrs = opts.attrs ?? {};
  const classes = opts.classes ?? [];
  return {
    tagName: (opts.tag ?? 'div').toUpperCase(),
    getAttribute: (n: string) => (n in attrs ? attrs[n] : null),
    classList: {
      contains: (c: string) => classes.includes(c),
      item: (i: number) => classes[i] ?? null,
      length: classes.length,
    },
    parentElement: opts.parent ?? null,
  } as unknown as Element;
}

describe('buildSelector — this-element', () => {
  it('uses data-uid with the card class', () => {
    const el = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'] });
    expect(buildSelector(el, 'this-element')).toBe('.card[data-uid="abc"]');
  });
  it('uses data-ui when present', () => {
    const el = node({ attrs: { 'data-ui': 'hud-gold' }, classes: ['hud'] });
    expect(buildSelector(el, 'this-element')).toBe('[data-ui="hud-gold"]');
  });
});

describe('buildSelector — all-like-this', () => {
  it('scopes a card by its zone ancestor and class, dropping the uid', () => {
    const zone = node({ attrs: { 'data-zone': 'warband' } });
    const el = node({ attrs: { 'data-uid': 'abc' }, classes: ['card'], parent: zone });
    expect(buildSelector(el, 'all-like-this')).toBe('[data-zone="warband"] .card');
  });
  it('keeps a data-ui selector stable', () => {
    const el = node({ attrs: { 'data-ui': 'hud-gold' } });
    expect(buildSelector(el, 'all-like-this')).toBe('[data-ui="hud-gold"]');
  });
  it('skips a volatile first class', () => {
    const el = node({ classes: ['dragging', 'pill'] });
    expect(buildSelector(el, 'all-like-this')).toBe('.pill');
  });
});
