import { defineConfig } from 'vitest/config';

// `npm run versus:cf:test`: the Room object in REAL workerd (wrangler's local runtime), over real WebSockets. Node 22+
// (global WebSocket, and wrangler 4.149's engine floor), so it is not part of the root `npm test` (CI runs Node 20).
export default defineConfig({
  test: {
    include: ['test/it/**/*.it.ts'],
    testTimeout: 90_000,
    hookTimeout: 60_000,
    fileParallelism: false,
  },
});
