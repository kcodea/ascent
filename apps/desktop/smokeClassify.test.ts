import { createRequire } from 'node:module';
import { describe, expect, it } from 'vitest';

const { isRemoteNetworkError } = createRequire(import.meta.url)('./smokeClassify.cjs') as {
  isRemoteNetworkError: (message: string, sourceId?: string) => boolean;
};

describe('smoke console-error classifier', () => {
  it('treats a CORS block against a remote https URL as a network refusal', () => {
    expect(isRemoteNetworkError("Access to fetch at 'https://w.example.workers.dev/rooms' from origin 'app://ascent' has been blocked by CORS policy: x")).toBe(true);
  });
  it('treats net::ERR_* with a remote http(s) URL (message or sourceId) as a network refusal', () => {
    expect(isRemoteNetworkError('GET https://api.example.com/x net::ERR_CONNECTION_REFUSED')).toBe(true);
    expect(isRemoteNetworkError('Failed to load resource: net::ERR_NAME_NOT_RESOLVED', 'https://api.example.com/x')).toBe(true);
  });
  it('keeps a URL-less Failed-to-load net::ERR_* (e.g. a broken app:// asset) as a plain console error', () => {
    expect(isRemoteNetworkError('Failed to load resource: net::ERR_FILE_NOT_FOUND')).toBe(false);
    expect(isRemoteNetworkError('Failed to load resource: net::ERR_FAILED', 'app://ascent/assets/x.js')).toBe(false);
  });
  it('keeps ordinary script errors as console errors', () => {
    expect(isRemoteNetworkError('Uncaught TypeError: x is undefined', 'https://example.com/a.js')).toBe(false);
  });
});
