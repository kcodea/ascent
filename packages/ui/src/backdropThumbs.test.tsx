// @vitest-environment jsdom
/**
 * Settings Board backdrop hover preview (owner 2026-10-30: "when hovering each background option in the settings, can you
 * have a little thumbnail preview of the background?"). Every backdrop has a thumbnail on disk; the open list shows the
 * hovered option's thumbnail beside it, else the chosen one's.
 */
import { existsSync } from 'node:fs';
import { resolve } from 'node:path';
import { act } from 'react';
import { afterEach, describe, expect, it } from 'vitest';
import { BACKDROP_IDS, backdropThumbUrl } from './backdrop';
import { SettingSelect } from './EscMenu';
import { mount, type Mounted } from './renderedText.mount';

let ui: Mounted | null = null;
afterEach(() => { ui?.unmount(); ui = null; });

describe('backdrop thumbnails', () => {
  it('every backdrop has its thumbnail on disk', () => {
    for (const id of BACKDROP_IDS) {
      const file = resolve(__dirname, '../../../apps/web/public', backdropThumbUrl(id).slice(1));
      expect(existsSync(file), id).toBe(true);
    }
  });

  it('the open list shows the chosen option\'s preview, then the hovered one\'s', () => {
    const options = [
      { value: 'castle', label: 'Castle', thumb: '/backdrop-thumb-castle.webp' },
      { value: 'koiPond', label: 'Koi Pond', thumb: '/backdrop-thumb-koiPond.webp' },
    ];
    ui = mount(<SettingSelect value="castle" options={options} onChange={() => {}} columns={2} />);
    const c = ui.container;
    expect(c.querySelector('.escselect-thumb')).toBeNull(); // closed: no preview
    act(() => { c.querySelector('.escselect-trigger')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    const img = (): string | null | undefined => c.querySelector('.escselect-thumb img')?.getAttribute('src');
    expect(img()).toBe('/backdrop-thumb-castle.webp');
    const koi = [...c.querySelectorAll('.escselect-opt')].find((o) => o.textContent === 'Koi Pond') as HTMLButtonElement;
    act(() => { koi.focus(); });
    expect(img()).toBe('/backdrop-thumb-koiPond.webp');
    expect(c.querySelector('.escselect-thumb')!.textContent).toContain('Koi Pond');
  });

  it('a select without thumbnails never shows a preview', () => {
    ui = mount(<SettingSelect value={60} options={[{ value: 60, label: '60' }, { value: 120, label: '120' }]} onChange={() => {}} />);
    act(() => { ui!.container.querySelector('.escselect-trigger')!.dispatchEvent(new Event('pointerdown', { bubbles: true })); });
    expect(ui.container.querySelector('.escselect-thumb')).toBeNull();
  });
});
