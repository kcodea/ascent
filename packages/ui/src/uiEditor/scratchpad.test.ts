import { describe, it, expect } from 'vitest';
import {
  upsertProp, setAsset, removeEntry, ruleText, toSummary, serialize, deserialize,
  type Scratchpad,
} from './scratchpad';

describe('scratchpad model', () => {
  it('upserts props under a selector without mutating the input', () => {
    const a: Scratchpad = {};
    const b = upsertProp(a, '.pill', 'all-like-this', 'font-size', '22px');
    expect(a).toEqual({}); // immutability
    expect(b['.pill'].props).toEqual({ 'font-size': '22px' });
    const c = upsertProp(b, '.pill', 'all-like-this', 'color', '#fff');
    expect(c['.pill'].props).toEqual({ 'font-size': '22px', color: '#fff' });
  });
  it('records an uploaded asset', () => {
    const sp = setAsset({}, '.medallion', 'all-like-this', 'assets/ui-editor/m.png');
    expect(sp['.medallion'].assetPath).toBe('assets/ui-editor/m.png');
  });
  it('removes an entry', () => {
    const sp = upsertProp({}, '.pill', 'this-element', 'opacity', '0.5');
    expect(removeEntry(sp, '.pill')).toEqual({});
  });
});

describe('ruleText', () => {
  it('renders a selector rule with declarations and a background-image for the asset', () => {
    const entry = {
      selector: '.medallion', scope: 'all-like-this' as const,
      props: { 'border-radius': '12px' }, assetPath: 'assets/ui-editor/m.png',
    };
    expect(ruleText(entry)).toBe(
      ".medallion { border-radius: 12px; background-image: url('assets/ui-editor/m.png'); }",
    );
  });
});

describe('toSummary', () => {
  it('emits one block per entry with selector, scope, props and match count', () => {
    let sp: Scratchpad = {};
    sp = upsertProp(sp, '[data-ui="hud-gold"]', 'this-element', 'font-size', '22px');
    sp = upsertProp(sp, '[data-ui="hud-gold"]', 'this-element', 'color', '#ffd76b');
    const out = toSummary(sp, { '[data-ui="hud-gold"]': 1 });
    expect(out).toContain('UI-EDIT');
    expect(out).toContain('selector: [data-ui="hud-gold"]   (matches 1)');
    expect(out).toContain('scope: this-element');
    expect(out).toContain('font-size: 22px');
    expect(out).toContain('color: #ffd76b');
  });
});

describe('serialize / deserialize', () => {
  it('round-trips the scratchpad', () => {
    const sp = upsertProp({}, '.pill', 'this-element', 'opacity', '0.5');
    expect(deserialize(serialize(sp))).toEqual(sp);
  });
  it('returns an empty scratchpad for null or garbage', () => {
    expect(deserialize(null)).toEqual({});
    expect(deserialize('not json')).toEqual({});
  });
});
