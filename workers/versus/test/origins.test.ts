/**
 * THE ORIGIN ALLOWLIST is config (R-VERSUS-CF-CUTOVER-01): wrangler.toml's default is exactly the game's Netlify site
 * plus local dev ports (owner 2026-10-28: https://ascent-game-web.netlify.app, no *.netlify.app wildcard), and a deploy
 * can replace it from `VERSUS_ALLOWED_ORIGINS` (validated by `validOrigin`) with no code change.
 */
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { originAllowed, validOrigin } from '../src/origins';

const toml = readFileSync(join(fileURLToPath(new URL('.', import.meta.url)), '../wrangler.toml'), 'utf8');
const DEFAULT = /^ALLOWED_ORIGINS = "([^"]*)"$/m.exec(toml)?.[1];

describe('Versus Worker origins', () => {
  it('defaults to the Netlify site and local dev only', () => {
    expect(DEFAULT).toBe('https://ascent-game-web.netlify.app,http://localhost:*,http://127.0.0.1:*');
    expect(originAllowed('https://ascent-game-web.netlify.app', DEFAULT)).toBe(true);
    expect(originAllowed('http://localhost:5173', DEFAULT)).toBe(true);
    expect(originAllowed('http://127.0.0.1:5291', DEFAULT)).toBe(true);
    // No other Netlify site (the old wildcard), no lookalike, no https localhost trick.
    expect(originAllowed('https://someone-else.netlify.app', DEFAULT)).toBe(false);
    expect(originAllowed('https://ascent-game-web.netlify.app.evil.com', DEFAULT)).toBe(false);
    expect(originAllowed('https://deploy-preview-1--ascent-game-web.netlify.app', DEFAULT)).toBe(false);
    expect(originAllowed('http://ascent-game-web.netlify.app', DEFAULT)).toBe(false);
    expect(originAllowed(null, DEFAULT)).toBe(true); // no Origin: server-to-server; the bearer token is the gate
  });

  it('a custom domain is one config entry', () => {
    const list = `${DEFAULT},https://play.example-ascent.com`;
    expect(originAllowed('https://play.example-ascent.com', list)).toBe(true);
    expect(originAllowed('https://evil.example-ascent.com', list)).toBe(false);
  });

  it('validates a deploy-time list', () => {
    for (const ok of ['https://ascent-game-web.netlify.app', 'https://play.example.com', 'http://localhost:*', 'http://127.0.0.1:5173', 'https://*.example.com']) {
      expect(validOrigin(ok), ok).toBe(true);
    }
    for (const bad of ['https://*', 'https://*.com', 'http://example.com', 'https://example.com/path', 'example.com', '*', '']) {
      expect(validOrigin(bad), bad).toBe(false);
    }
  });
});
