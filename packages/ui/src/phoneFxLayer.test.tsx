// @vitest-environment jsdom
/**
 * R-TOUCH-GPU-MEMORY-01: on a PHONE the FX layer makes no WebGL context on the menus, brings the board layer up for
 * hero select, the slot canvases and Discover only for the run, and tears all of it down on the way back. (The
 * desktop path, one attach for the whole session, is pinned by phoneFxLayerDesktop.test.tsx.)
 */
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('./phoneDiag', () => ({ PHONE_GPU: true }));
vi.mock('./crashLog', () => ({ crumb: () => {} }));
vi.mock('./wipeFx', () => ({ wipeFx: { release: () => calls.push('wipe release') } }));
vi.mock('./pixiFx', () => ({
  pixiFx: {
    attach: () => { calls.push('attach'); return Promise.resolve(); },
    detach: () => calls.push('detach'),
    ensureUnderSlot: () => { calls.push('under'); return Promise.resolve(); },
    ensureAboveSlot: () => { calls.push('above'); return Promise.resolve(); },
    setUnderHost: () => {},
  },
  discoverFx: { detach: () => calls.push('discover detach') },
  warmDiscoverFx: () => calls.push('discover warm'),
  resetDiscoverWarm: () => calls.push('discover reset'),
}));

import { act } from 'react';
import { mount } from './renderedText.mount';
import { PixiFxLayer } from './PixiFxLayer';

const flush = (): Promise<void> => act(async () => { await Promise.resolve(); await Promise.resolve(); });

describe('PixiFxLayer on a phone', () => {
  it('menus: nothing; hero select: the board layer; the run: slots + Discover; back to the menus: all freed', async () => {
    const ui = mount(<PixiFxLayer gameplay={false} inRun={false} />);
    await flush();
    expect(calls).toEqual([]); // the title / mode home: no context at all

    ui.render(<PixiFxLayer gameplay inRun={false} />);
    await flush();
    expect(calls).toEqual(['attach']); // hero select: the board layer only

    ui.render(<PixiFxLayer gameplay inRun />);
    await flush();
    expect(calls).toEqual(['attach', 'attach', 'discover warm', 'under', 'above']);

    calls.length = 0;
    ui.render(<PixiFxLayer gameplay={false} inRun={false} />);
    await flush();
    expect(calls).toEqual(['detach', 'discover detach', 'discover reset', 'wipe release']);
    ui.unmount();
  });
});
