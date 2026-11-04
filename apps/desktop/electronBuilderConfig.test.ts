import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';

const cfg = JSON.parse(readFileSync(new URL('./electron-builder.json', import.meta.url), 'utf8'));

describe('electron-builder.json (the CI installer contract)', () => {
  it('names the app and its install identity', () => {
    expect(cfg.productName).toBe('ASCENT');
    expect(cfg.appId).toBe('com.kcodea.ascent');
  });
  it('builds a per-user one-click NSIS installer with a stable file name', () => {
    expect(cfg.win.target).toEqual(expect.arrayContaining(['nsis']));
    expect(cfg.nsis.artifactName).toBe('ASCENT-Setup.${ext}');
    expect(cfg.nsis.oneClick).toBe(true);
    expect(cfg.nsis.perMachine).toBe(false);
  });
  it('updates from the permanent latest-release URL', () => {
    expect(cfg.publish).toEqual({ provider: 'generic', url: 'https://github.com/kcodea/ascent/releases/latest/download' });
  });
  it('ships the game build as resources/dist and the bundled shell from build/', () => {
    expect(cfg.extraResources).toEqual([{ from: '../web/dist', to: 'dist' }]);
    expect(cfg.directories.app).toBe('build');
    expect(cfg.asar).toBe(true);
  });
});
