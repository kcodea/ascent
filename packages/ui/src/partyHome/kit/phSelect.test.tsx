// @vitest-environment jsdom
/**
 * PhSelect thumbnails: the open list lives in the stage layer outside the page, so a page sets its thumbs' shape through
 * `thumbAspect` / `thumbSize` (info-pages builder ask 2026-11-02: 16:9 backdrop thumbs).
 */
import { afterEach, describe, expect, it } from 'vitest';
import { act } from 'react';
import { PhSelect } from './index';
import { mount, type Mounted } from '../../renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });
const opts = [{ value: 'a', label: 'Hall', thumb: '/a.webp' }, { value: 'b', label: 'Citadel', thumb: '/b.webp' }] as const;
const openList = (): void => { act(() => { (document.querySelector('.phk-select') as HTMLButtonElement).click(); }); };

describe('PhSelect thumbnails', () => {
  it('default thumbs stay square with no inline size', () => {
    ui = mount(<PhSelect value="a" options={opts} onChange={() => {}} />);
    openList();
    const thumbs = [...document.querySelectorAll<HTMLImageElement>('.phk-selectlist .phk-selthumb')];
    expect(thumbs).toHaveLength(2);
    expect(thumbs[0]!.style.aspectRatio).toBe('');
  });
  it('thumbAspect + thumbSize shape the open list thumbs; the button thumb keeps its 28 height', () => {
    ui = mount(<PhSelect value="a" options={opts} onChange={() => {}} thumbAspect="16/9" thumbSize={40} />);
    openList();
    const t = document.querySelector<HTMLImageElement>('.phk-selectlist .phk-selthumb')!;
    expect(t.style.aspectRatio).toBe('16/9');
    expect(t.style.height).toContain('40');
    expect(t.style.width).toBe('auto');
    const b = document.querySelector<HTMLImageElement>('.phk-select .phk-selthumb')!;
    expect(b.style.aspectRatio).toBe('16/9');
    expect(b.style.height).toContain('28');
  });
});
