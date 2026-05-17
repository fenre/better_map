/*
 * Vitest config — better_map viz unit tests.
 *
 * ROADMAP §3 Theme C (verified production code) + Theme G (operational
 * rigor). The viz package is greenfield for tests; this is the scaffold
 * the first test file lands on (T-1 ships popupSanitizer.test.js).
 *
 * Choices:
 *   * `environment: 'jsdom'` — DOMPurify (popupSanitizer.js dependency)
 *     reads `window` and `document` at import time, so a Node-only
 *     environment is not viable. jsdom is the right granularity:
 *     synchronous DOM, fast (no headless browser), well-supported by
 *     Vitest.
 *   * `globals: true` — exposes `describe / it / expect` without per-file
 *     imports. Matches the project's pre-existing test ergonomics
 *     (none — we are the first test file). Trades explicit imports for
 *     less boilerplate; revisit if it becomes a noise source.
 *   * `include` is scoped to src/lib so we don't ever pick up tests from
 *     node_modules accidentally (which slows discovery to a crawl).
 *   * `setupFiles` left empty for now — DOMPurify works out of the box
 *     under jsdom. Once we add MapLibre integration tests (the GL stub
 *     is the next interesting fixture), this is where we'd register it.
 *   * Coverage uses v8 (faster than istanbul, no Babel toolchain).
 *     Thresholds are deliberately LOW for the v1.7 scaffold:
 *     popupSanitizer.js is 100% covered, but src/lib/ as a whole has
 *     ~1% coverage on day 1 — we want the scaffold to ship even with
 *     a low aggregate so subsequent PRs raise the floor file by file.
 */
import {defineConfig} from 'vitest/config';

export default defineConfig({
    test: {
        environment: 'jsdom',
        globals: true,
        include: ['src/lib/**/*.test.js'],
        exclude: ['node_modules', 'dist', '**/node_modules/**'],
        coverage: {
            provider: 'v8',
            reporter: ['text', 'lcov'],
            // Coverage gates are deliberately advisory on the scaffold
            // commit. Once src/lib is materially covered, tighten these
            // here (PR with the bump in the commit body explains the
            // delta).
            thresholds: {
                lines: 0,
                functions: 0,
                branches: 0,
                statements: 0,
            },
            // Always show coverage even when not requested explicitly,
            // so reviewers eyeball file-by-file coverage in the PR log.
            include: ['src/lib/**/*.js'],
            exclude: ['src/lib/**/*.test.js'],
        },
        // 10s per test — generous enough for jsdom + DOMPurify cold
        // starts on CI, tight enough to catch real hangs.
        testTimeout: 10000,
        // Run tests serially when watching to keep terminal output
        // legible; CI runs in parallel via reporter='dot'.
        reporters: process.env.CI ? ['dot'] : ['default'],
    },
});
