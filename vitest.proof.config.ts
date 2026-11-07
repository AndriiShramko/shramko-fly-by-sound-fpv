import { defineConfig } from 'vitest/config';

// The browser proofs of test-audio/ (pnpm proof:audio): one Node test that drives headless
// Chromium. Kept out of vitest.config.ts so `pnpm test` stays Node-only and fast.
export default defineConfig({
    test: {
        include: ['test-audio/**/*.proof.ts'],
        environment: 'node',
        testTimeout: 600000,
        hookTimeout: 600000
    }
});
