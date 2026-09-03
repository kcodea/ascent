import { describe, it, expect } from 'vitest';
import { readdirSync } from 'node:fs';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';
import { familyOf } from './clipFamily';
import { DEFAULT_AUDIO_CONFIG } from './config';

/**
 * The "always has all sounds" guardrail. Every committed audio clip must resolve (via `familyOf`) to a real
 * mixer category, so it appears on the desk with a fader instead of silently riding the `ui` fallback. Drop a
 * new `.mp3` in and this fails until it has a home — its own 1:1 category or a bundle group. It cannot catch a
 * clip pointed at the WRONG group (only a human ear can), but it makes "missing entirely" impossible.
 */

const AUDIO = resolve(dirname(fileURLToPath(import.meta.url))); // packages/ui/src/audio

function allClips(dir: string, prefix = ''): string[] {
  const out: string[] = [];
  for (const e of readdirSync(dir, { withFileTypes: true })) {
    if (e.isDirectory()) out.push(...allClips(resolve(dir, e.name), `${prefix}${e.name}/`));
    else if (/\.(mp3|wav|mp4)$/.test(e.name)) out.push(`${prefix}${e.name.replace(/\.(mp3|wav|mp4)$/, '')}`);
  }
  return out;
}

describe('every committed clip has a home on the mixing board', () => {
  const clips = allClips(AUDIO);
  const categories = new Set(Object.keys(DEFAULT_AUDIO_CONFIG.categories));

  it('actually finds the clips (guards against a broken glob path)', () => {
    expect(clips.length).toBeGreaterThan(50);
  });

  it.each(clips)("'%s' resolves to a real mixer category", (clip) => {
    const family = familyOf(clip);
    expect(
      categories.has(family),
      `clip '${clip}' → '${family}', which is not a mixer category. Give it a fader: add a 1:1 category (its ` +
        `name) or route it to a group in clipFamily.ts, and register that category in config.ts.`,
    ).toBe(true);
  });
});
