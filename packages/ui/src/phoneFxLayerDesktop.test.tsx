// @vitest-environment jsdom
/**
 * R-TOUCH-GPU-MEMORY-01, the desktop guard: off the phone path the FX layer is unchanged. It attaches ONCE as the game
 * mounts (the title included) and keeps its contexts for the session, whatever screen is up.
 */
import { describe, expect, it, vi } from 'vitest';

const calls: string[] = [];
vi.mock('./phoneDiag', () => ({ PHONE_GPU: false }));
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

describe('PixiFxLayer on desktop', () => {
  it('attaches once on the title and never tears down between screens', async () => {
    const ui = mount(<PixiFxLayer gameplay={false} inRun={false} />);
    await flush();
    ui.render(<PixiFxLayer gameplay inRun={false} />);
    ui.render(<PixiFxLayer gameplay inRun />);
    ui.render(<PixiFxLayer gameplay={false} inRun={false} />);
    await flush();
    expect(calls).toEqual(['attach']);
    ui.unmount();
    expect(calls).toEqual(['attach', 'detach']);
  });
});
