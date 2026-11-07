import { defineConfig } from 'vitest/config';

// Node tests only. Browser proofs live in test-audio/ and are never globbed here, because the
// simulator's own vitest also globs packages/*/test/** when this repository is its submodule.
export default defineConfig({
    test: {
        include: ['test/**/*.test.ts'],
        environment: 'node',
        testTimeout: 30000
    }
});
