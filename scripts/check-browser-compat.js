#!/usr/bin/env node
/*
 * D2 — Browser compatibility audit Phase 1 + Phase 1.5.
 *
 * ROADMAP §3 D2 Phase 1 + Phase 1.5 + §4 v1.7 milestone
 * exit-criterion "12 showcases pass on Chrome, Firefox, Safari,
 * Edge × ...".
 *
 * Goal: catch the "doesn't load in Firefox / WebKit" class of bug at
 *       PR time, BEFORE a customer trips over it. The bundle ships
 *       through webpack with `target: ['web', 'es5']` (per
 *       `splunk-custom-viz-integration.mdc` §11) precisely so that
 *       Splunk's AMD loader on every browser can `require()` it, but
 *       nothing in CI before D2 asserted that the produced
 *       `visualization.js` actually parses + executes in WebKit and
 *       Firefox. This gate closes that gap on BOTH the standalone
 *       HTML surface we ship (`formatter.html`, the panel-options
 *       UI every Dashboard Studio author sees) AND the AMD bundle
 *       (`visualization.js`, the thing that actually renders the
 *       viz on every dashboard).
 *
 * Phase scoping (mirrors the D3 accessibility script's Phase
 * sequencing):
 *   - Phase 1 (test class A): `formatter.html` load test in headless
 *     {Chromium, Firefox, WebKit} on Linux. Asserts the page loads
 *     (`document.body` non-empty), no `console.error` events fired,
 *     no `pageerror` events fired. A full-page screenshot per engine
 *     is saved to `reports/browser-compat/<engine>.png` for visual
 *     reference.
 *   - Phase 1.5 (test class B — added 2026-05-18): `visualization.js`
 *     AMD-require test in the same three engines. Inlines the bundle
 *     into a wrapper page that defines an AMD `define()` shim plus
 *     minimal mocks for the two Splunk SDK externals the bundle
 *     requires (`api/SplunkVisualizationBase`,
 *     `api/SplunkVisualizationUtils`). Asserts the bundle parses,
 *     executes the AMD factory without throwing, calls `define()`
 *     with the expected two-element deps array, and the factory
 *     returns a non-null module (i.e., the entry IIFE called
 *     `SplunkVisualizationBase.extend(...)` and returned its result).
 *     Catches the "bundle parses on Chromium but webpack emitted a
 *     syntax / runtime construct WebKit / Firefox rejects" class of
 *     bug that Phase 1 cannot see (formatter.html has no script).
 *   - Both phases run on Linux only — GitHub Actions free runners
 *     are Linux. Real macOS Safari and Windows Edge fall to Phase 2.
 *   - Phase 2 (deferred): cross-OS matrix (macos-latest +
 *     windows-latest) and the 12 showcase dashboards rendered
 *     against a live Splunk Enterprise container (blocked on D5
 *     Phase 2 wiring per ROADMAP §3 D5 risk note).
 *   - Out of scope: visual-regression diff against a baseline (the
 *     formatter is hand-laid out — a 1-pixel font-metric difference
 *     between Chromium and WebKit would flake the gate without
 *     improving customer signal). Full rendering of the bundle
 *     (calling `updateView` with a real data envelope into a real
 *     DOM container) also falls to Phase 2 — needs a Splunk-style
 *     data shape, a real container with non-zero size, and a wired
 *     MapLibre source (the bundle does NOT bundle MapLibre style
 *     JSON; that comes from the host page or a CDN).
 *
 * Strategy:
 *   1. Read `formatter.html` and `visualization.js` from disk. Build
 *      two wrapper pages:
 *        - `reports/_browser-compat-wrapper.html` — minimal HTML5
 *          page containing the formatter fragment (DRY: same wrapper
 *          shape the D3 accessibility audit uses).
 *        - `reports/_browser-compat-bundle-wrapper.html` — minimal
 *          HTML5 page with the AMD shim, SDK mocks, capture
 *          variables (window.__BM_HARNESS_STATE), and the bundle
 *          inlined verbatim (~2.3 MB).
 *   2. For each engine in [chromium, firefox, webkit]:
 *      a. Launch headless via Playwright.
 *      b. Run test class A (formatter): goto wrapper, capture
 *         console / pageerror / requestfailed events, assert
 *         `document.body.children.length > 0`, screenshot.
 *      c. Run test class B (bundle): goto bundle-wrapper, capture
 *         same event classes, then `page.evaluate()` to read
 *         `window.__BM_HARNESS_STATE` and assert the AMD contract.
 *      d. Record both sub-results per engine.
 *   3. Persist the full JSON report under
 *      `reports/browser-compat-report.json` for CI artifact upload.
 *   4. Print a focused, human-readable per-engine summary covering
 *      both test classes.
 *   5. Exit 1 if any engine failed either test class; 0 otherwise.
 *
 * Why three engines specifically:
 *   - Chromium  → Chrome, Edge, Opera, Brave, every Chromium fork
 *     including Splunk Mobile Android.
 *   - WebKit    → Safari (macOS + iOS), Splunk Mobile iOS.
 *   - Firefox   → Firefox + every Gecko fork.
 *   Together these cover ~99% of real browsers in the field. (Pre-
 *   Chromium Edge is the only meaningful gap and Microsoft has
 *   sunsetted it.)
 *
 * Exit codes:
 *   0  PASS  (every browser loaded both surfaces without errors)
 *   1  FAIL  (one or more browsers failed either surface)
 *   2  internal error (Playwright launch failure, missing browser
 *      binary, file-read failure)
 *
 * Re-run locally:
 *   cd better_map/appserver/static/visualizations/better_map
 *   npm run lint:browser-compat
 *
 * (or, from repo root): node scripts/check-browser-compat.js
 *
 * First-run note: like D3, Playwright ships browser binaries
 * separately from the npm package. Install all three engines via:
 *   cd better_map/appserver/static/visualizations/better_map
 *   npx playwright install --with-deps chromium firefox webkit
 *
 * On macOS the `--with-deps` step is a no-op (deps come from the
 * Xcode CLI tools); on Ubuntu it installs ~200 MB of system
 * libraries the engines need (~3 min cold). CI caches the
 * Playwright browsers between runs once the lockfile is stable.
 *
 * CLI flags:
 *   --engine=<list>   comma-separated subset of {chromium, firefox,
 *                     webkit}; defaults to all three. Useful for
 *                     local iteration when you only want one engine.
 *   --skip-bundle     skip the Phase 1.5 bundle AMD-require test
 *                     (faster local iteration when you only care
 *                     about formatter changes). NEVER pass this in
 *                     CI — the bundle test is the primary value of
 *                     the gate; the formatter test only catches
 *                     static-HTML regressions.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VIZ_DIR = path.join(
    REPO_ROOT,
    'better_map/appserver/static/visualizations/better_map',
);
const FORMATTER_PATH = path.join(VIZ_DIR, 'formatter.html');
const BUNDLE_PATH = path.join(VIZ_DIR, 'visualization.js');
const REPORT_DIR = path.join(REPO_ROOT, 'reports');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'browser-compat');
const REPORT_PATH = path.join(REPORT_DIR, 'browser-compat-report.json');
const FORMATTER_WRAPPER_PATH = path.join(
    REPORT_DIR,
    '_browser-compat-wrapper.html',
);
const BUNDLE_WRAPPER_PATH = path.join(
    REPORT_DIR,
    '_browser-compat-bundle-wrapper.html',
);

const ALL_ENGINES = ['chromium', 'firefox', 'webkit'];
const GOTO_TIMEOUT_MS = 30000;

function parseArgs(argv) {
    const args = { engines: ALL_ENGINES.slice(), skipBundle: false };
    for (const raw of argv.slice(2)) {
        if (raw.startsWith('--engine=')) {
            const list = raw
                .slice('--engine='.length)
                .split(',')
                .map((s) => s.trim().toLowerCase())
                .filter(Boolean);
            const invalid = list.filter((e) => !ALL_ENGINES.includes(e));
            if (invalid.length > 0) {
                console.error(
                    `FATAL — unknown engine(s): ${invalid.join(', ')}. ` +
                        `Allowed: ${ALL_ENGINES.join(', ')}.`,
                );
                process.exit(2);
            }
            args.engines = list;
        } else if (raw === '--skip-bundle') {
            args.skipBundle = true;
        } else if (raw === '--help' || raw === '-h') {
            console.log(
                'D2 — Browser compatibility audit\n' +
                    '  --engine=<list>   comma-separated subset of: ' +
                    ALL_ENGINES.join(', ') +
                    '\n  --skip-bundle     skip the Phase 1.5 bundle AMD test (local iteration only)\n' +
                    '  --help            show this message\n',
            );
            process.exit(0);
        } else {
            console.error(`FATAL — unknown argument: ${raw}`);
            process.exit(2);
        }
    }
    return args;
}

function loadPlaywright() {
    try {
        return require(
            require.resolve('playwright', { paths: [VIZ_DIR] }),
        );
    } catch (err) {
        console.error('FATAL — `playwright` is not installed.');
        console.error(
            '       Run: cd better_map/appserver/static/visualizations/better_map && npm ci',
        );
        process.exit(2);
    }
}

// ---------------------------------------------------------------------------
// Formatter wrapper (Phase 1) — mirrors the D3 accessibility wrapper so a
// regression in the wrapper affects both gates identically.
// ---------------------------------------------------------------------------
function buildFormatterWrapper(fragmentHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Better Map formatter — browser-compat harness</title>
    <style>
        body {
            font-family: system-ui, -apple-system, "Segoe UI", sans-serif;
            background: #ffffff;
            color: #111111;
            margin: 0;
            padding: 16px;
        }
        h1 {
            font-size: 18px;
            font-weight: 600;
            margin: 0 0 16px 0;
        }
    </style>
</head>
<body>
    <h1>Better Map formatter (browser-compat harness)</h1>
    <main>
${fragmentHtml}
    </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Bundle wrapper (Phase 1.5) — provides an AMD `define()` shim plus minimal
// mocks for the two Splunk SDK externals the bundle requires, then inlines
// the bundle source verbatim.
//
// Why inline (not <script src="visualization.js">):
//   The wrapper lives under `reports/`, which is gitignored. The bundle
//   lives under `better_map/appserver/static/visualizations/better_map/`,
//   which is tracked. Wiring a `<script src="...">` cross-directory under
//   `file://` works on Chromium but is awkward on WebKit which has
//   stricter same-directory expectations for some sub-resources. Inlining
//   the bundle sidesteps the resolution entirely and removes one variable
//   from cross-engine differences.
//
// What the mocks need to do:
//   - SplunkVisualizationBase MUST expose `extend(properties)` returning a
//     usable constructor. Backbone-style extend. The factory IIFE in the
//     bundle calls `SplunkVisualizationBase.extend({...})` once and
//     returns its result as `o.default`. If `extend` is missing or returns
//     undefined the bundle factory will produce a null module and the
//     test will FAIL with `moduleReturned: false`.
//   - SplunkVisualizationUtils is referenced through `e.*` in the bundle.
//     The bundle does NOT call any of its methods at module-eval time
//     (they all run from `updateView` / `formatData`), so an empty object
//     would technically suffice. We still ship plausibly-shaped stubs for
//     the documented helpers in case a future bundle version starts
//     calling them at eval time.
//
// Capture surface on window.__BM_HARNESS_STATE:
//   defineCalled        bool   — did the bundle invoke `define()` at all?
//   defineCallCount     int    — how many times (anonymous bundles call once)
//   depsRequested       []str  — the deps array passed to `define`
//   factoryRan          bool   — did the factory execute to completion?
//   factoryError        str|nl — first thrown error stack if it crashed
//   moduleReturned      bool   — did factory return a non-null value?
//   mockBaseExtendCalled int   — how many times Base.extend was called
//   moduleHasShape      bool   — does the returned module have a
//                                prototype-shape that suggests it came
//                                from extend() (function + prototype obj)
// ---------------------------------------------------------------------------
function buildBundleWrapper(bundleSource) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Better Map bundle — D2 Phase 1.5 AMD harness</title>
    <style>
        body { font-family: system-ui, sans-serif; margin: 0; padding: 16px; }
    </style>
</head>
<body>
    <h1>Better Map bundle AMD harness</h1>
    <main id="root"></main>
    <script>
    (function () {
        'use strict';

        // ----- capture surface -----
        window.__BM_HARNESS_STATE = {
            defineCalled: false,
            defineCallCount: 0,
            depsRequested: null,
            factoryRan: false,
            factoryError: null,
            moduleReturned: false,
            moduleHasShape: false,
            mockBaseExtendCalled: 0
        };

        // ----- SplunkVisualizationUtils mock -----
        var mockUtils = {
            escapeHtml: function (s) { return String(s == null ? '' : s); },
            makeDrilldownLink: function (s) { return String(s); },
            extractFieldNames: function () { return []; },
            getFormattedValue: function (v) { return String(v); },
            getFormattedProperty: function () { return ''; },
            DRILLDOWN_TYPES: { ROW: 'row', CELL: 'cell' }
        };

        // ----- SplunkVisualizationBase mock (Backbone-style extend) -----
        function MockBase() {}
        MockBase.extend = function (properties) {
            window.__BM_HARNESS_STATE.mockBaseExtendCalled += 1;
            properties = properties || {};
            function ChildViz() {
                if (typeof properties.initialize === 'function') {
                    try { properties.initialize.apply(this, arguments); } catch (e) {}
                }
            }
            ChildViz.prototype = Object.create(MockBase.prototype);
            Object.keys(properties).forEach(function (k) {
                ChildViz.prototype[k] = properties[k];
            });
            ChildViz.extend = MockBase.extend;
            return ChildViz;
        };
        MockBase.prototype.getPropertyNamespaceInfo = function () {
            return { propertyNamespace: 'display.visualizations.custom.better_map.better_map.' };
        };
        MockBase.prototype.updateView = function () {};
        MockBase.prototype.formatData = function (data) { return data; };
        MockBase.prototype.reflow = function () {};
        MockBase.prototype.invalidateUpdateView = function () {};

        // ----- AMD shim -----
        var depsMap = {
            'api/SplunkVisualizationBase': MockBase,
            'api/SplunkVisualizationUtils': mockUtils
        };

        function define(deps, factory) {
            var st = window.__BM_HARNESS_STATE;
            st.defineCalled = true;
            st.defineCallCount += 1;

            // Anonymous define(factory): no deps, single factory arg.
            if (typeof deps === 'function') {
                factory = deps;
                deps = [];
            }
            st.depsRequested = (deps || []).slice();

            if (typeof factory !== 'function') {
                return;
            }

            var resolved = (deps || []).map(function (dep) {
                if (Object.prototype.hasOwnProperty.call(depsMap, dep)) {
                    return depsMap[dep];
                }
                return undefined;
            });

            try {
                var mod = factory.apply(null, resolved);
                st.factoryRan = true;
                if (mod !== undefined && mod !== null) {
                    st.moduleReturned = true;
                    // Heuristic shape: extend() returns a function (the
                    // constructor) whose prototype is an object. Anything
                    // else suggests the bundle returned something other
                    // than a viz class.
                    st.moduleHasShape = (
                        typeof mod === 'function' &&
                        mod.prototype !== null &&
                        typeof mod.prototype === 'object'
                    );
                }
            } catch (e) {
                st.factoryError = (e && e.stack) ? e.stack : String(e);
            }
        }
        define.amd = { jQuery: false };
        window.define = define;
    }());
    </script>
    <script>
${bundleSource}
    </script>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Per-engine runner. Subscribes to page-level error events, runs both test
// classes (or just the formatter if --skip-bundle), and rolls per-engine
// result up to overall PASS/FAIL.
// ---------------------------------------------------------------------------
async function runEngine(playwright, engineName, opts) {
    const launcher = playwright[engineName];
    const result = {
        engine: engineName,
        status: 'unknown',
        formatter: {
            status: 'unknown',
            errors: [],
            consoleErrors: [],
            pageErrors: [],
            requestFailures: [],
            bodyChildCount: 0,
            screenshotPath: null,
        },
        bundle: opts.skipBundle ? { status: 'skipped' } : {
            status: 'unknown',
            errors: [],
            consoleErrors: [],
            pageErrors: [],
            requestFailures: [],
            harnessState: null,
        },
    };

    if (!launcher) {
        result.status = 'fail';
        result.formatter.status = 'fail';
        result.formatter.errors.push(
            `engine '${engineName}' is not exposed by Playwright`,
        );
        return result;
    }

    let browser;
    try {
        browser = await launcher.launch();
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        result.status = 'fail';
        result.formatter.status = 'fail';
        result.formatter.errors.push(`launch failed: ${detail}`);
        if (
            detail.includes("Executable doesn't exist") ||
            detail.includes('browserType.launch')
        ) {
            result.formatter.errors.push(
                'hint: run `cd better_map/appserver/static/visualizations/' +
                    'better_map && npx playwright install --with-deps ' +
                    engineName + '`',
            );
        }
        return result;
    }

    try {
        // ----- Test class A: formatter -----
        await runFormatterTest(browser, result.formatter);

        // ----- Test class B: bundle (Phase 1.5) -----
        if (!opts.skipBundle) {
            await runBundleTest(browser, result.bundle);
        }
    } finally {
        await browser.close().catch(() => {});
    }

    // Roll up overall status.
    const formatterFailed = result.formatter.status === 'fail';
    const bundleFailed = result.bundle.status === 'fail';
    result.status = (formatterFailed || bundleFailed) ? 'fail' : 'pass';
    return result;
}

async function runFormatterTest(browser, subResult) {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            subResult.consoleErrors.push({
                text: msg.text(),
                location: msg.location(),
            });
        }
    });
    page.on('pageerror', (err) => {
        subResult.pageErrors.push(err && err.stack ? err.stack : String(err));
    });
    page.on('requestfailed', (req) => {
        const failure = req.failure();
        subResult.requestFailures.push({
            url: req.url(),
            error: failure ? failure.errorText : 'unknown',
        });
    });

    try {
        await page.goto(`file://${FORMATTER_WRAPPER_PATH}`, {
            waitUntil: 'load',
            timeout: GOTO_TIMEOUT_MS,
        });
        subResult.bodyChildCount = await page.evaluate(
            () => document.body.children.length,
        );
        if (subResult.bodyChildCount === 0) {
            subResult.errors.push(
                'document.body has zero children after load — engine rejected the HTML',
            );
        }

        const engineName = browser.browserType().name();
        const screenshotPath = path.join(SCREENSHOT_DIR, `${engineName}.png`);
        await page.screenshot({ path: screenshotPath, fullPage: true });
        subResult.screenshotPath = path.relative(REPO_ROOT, screenshotPath);
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        subResult.errors.push(`formatter page interaction failed: ${detail}`);
    } finally {
        await context.close().catch(() => {});
    }

    const failed =
        subResult.errors.length > 0 ||
        subResult.consoleErrors.length > 0 ||
        subResult.pageErrors.length > 0 ||
        subResult.requestFailures.length > 0;
    subResult.status = failed ? 'fail' : 'pass';
}

async function runBundleTest(browser, subResult) {
    const context = await browser.newContext();
    const page = await context.newPage();

    page.on('console', (msg) => {
        if (msg.type() === 'error') {
            subResult.consoleErrors.push({
                text: msg.text(),
                location: msg.location(),
            });
        }
    });
    page.on('pageerror', (err) => {
        subResult.pageErrors.push(err && err.stack ? err.stack : String(err));
    });
    page.on('requestfailed', (req) => {
        const failure = req.failure();
        subResult.requestFailures.push({
            url: req.url(),
            error: failure ? failure.errorText : 'unknown',
        });
    });

    try {
        await page.goto(`file://${BUNDLE_WRAPPER_PATH}`, {
            waitUntil: 'load',
            timeout: GOTO_TIMEOUT_MS,
        });
        // The bundle is ~2.3 MB; on slower engines (WebKit cold start)
        // it can still be evaluating after `load` fires. Give the AMD
        // capture an extra short tick to settle.
        await page.waitForFunction(
            () => window.__BM_HARNESS_STATE &&
                  window.__BM_HARNESS_STATE.defineCalled === true,
            { timeout: 5000 },
        ).catch(() => {});
        subResult.harnessState = await page.evaluate(() => ({
            defineCalled: window.__BM_HARNESS_STATE.defineCalled,
            defineCallCount: window.__BM_HARNESS_STATE.defineCallCount,
            depsRequested: window.__BM_HARNESS_STATE.depsRequested,
            factoryRan: window.__BM_HARNESS_STATE.factoryRan,
            factoryError: window.__BM_HARNESS_STATE.factoryError,
            moduleReturned: window.__BM_HARNESS_STATE.moduleReturned,
            moduleHasShape: window.__BM_HARNESS_STATE.moduleHasShape,
            mockBaseExtendCalled: window.__BM_HARNESS_STATE.mockBaseExtendCalled,
        }));

        const s = subResult.harnessState;
        if (!s.defineCalled) {
            subResult.errors.push(
                'bundle never invoked define() — engine rejected the AMD module before it reached the entry IIFE',
            );
        }
        if (s.factoryError) {
            subResult.errors.push(
                'factory threw at module-eval time: ' +
                    s.factoryError.split('\n')[0],
            );
        }
        if (s.defineCalled && !s.factoryRan) {
            subResult.errors.push(
                'define() was called but factory never completed — usually means a synchronous throw was swallowed',
            );
        }
        if (s.factoryRan && !s.moduleReturned) {
            subResult.errors.push(
                'factory returned null/undefined — likely SplunkVisualizationBase.extend() did not produce a module',
            );
        }
        if (s.moduleReturned && !s.moduleHasShape) {
            subResult.errors.push(
                'module returned but does not have constructor shape (function + prototype object)',
            );
        }
        if (
            s.depsRequested &&
            !arraysEqual(
                s.depsRequested,
                ['api/SplunkVisualizationBase', 'api/SplunkVisualizationUtils'],
            )
        ) {
            subResult.errors.push(
                'unexpected deps requested: ' + JSON.stringify(s.depsRequested) +
                    ' (contract: [api/SplunkVisualizationBase, api/SplunkVisualizationUtils])',
            );
        }
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        subResult.errors.push(`bundle page interaction failed: ${detail}`);
    } finally {
        await context.close().catch(() => {});
    }

    const failed =
        subResult.errors.length > 0 ||
        subResult.pageErrors.length > 0;
    // Note: we deliberately do NOT fail on consoleErrors for the bundle
    // test — webpack-emitted bundles routinely log to console.warn /
    // console.info at module-eval time, and gating on them would create
    // noise. Real failures surface through pageerror / harnessState.
    subResult.status = failed ? 'fail' : 'pass';
}

function arraysEqual(a, b) {
    if (!Array.isArray(a) || !Array.isArray(b)) return false;
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}

// ---------------------------------------------------------------------------
// Pretty-print one engine's results.
// ---------------------------------------------------------------------------
function printEngineSummary(result) {
    const colour = result.status === 'pass' ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(
        `  ${colour}${result.status.toUpperCase()}${reset}  ${result.engine}`,
    );

    printSubResult('formatter', result.formatter);
    if (result.bundle.status === 'skipped') {
        console.log('         bundle: SKIPPED (--skip-bundle)');
    } else {
        printSubResult('bundle', result.bundle);
    }
}

function printSubResult(label, sub) {
    const status = sub.status.toUpperCase();
    const colour = sub.status === 'pass' ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    let line = `         ${label}: ${colour}${status}${reset}`;
    if (label === 'formatter') {
        line += `  (body children: ${sub.bodyChildCount}`;
        if (sub.screenshotPath) {
            line += `, screenshot: ${sub.screenshotPath}`;
        }
        line += ')';
    } else if (label === 'bundle' && sub.harnessState) {
        const s = sub.harnessState;
        line += `  (define×${s.defineCallCount}, extend×${s.mockBaseExtendCalled}` +
                `, moduleReturned: ${s.moduleReturned})`;
    }
    console.log(line);

    if (sub.errors && sub.errors.length > 0) {
        for (const e of sub.errors) {
            console.log(`           assertion: ${e}`);
        }
    }
    if (sub.consoleErrors && sub.consoleErrors.length > 0) {
        console.log(`           console.error events: ${sub.consoleErrors.length}`);
        for (const e of sub.consoleErrors.slice(0, 5)) {
            console.log(`             - ${e.text}`);
        }
        if (sub.consoleErrors.length > 5) {
            console.log(
                `             ... and ${sub.consoleErrors.length - 5} more — see report JSON`,
            );
        }
    }
    if (sub.pageErrors && sub.pageErrors.length > 0) {
        console.log(`           pageerror events: ${sub.pageErrors.length}`);
        for (const e of sub.pageErrors.slice(0, 3)) {
            console.log(`             - ${e.split('\n')[0]}`);
        }
    }
    if (sub.requestFailures && sub.requestFailures.length > 0) {
        console.log(`           requestfailed events: ${sub.requestFailures.length}`);
        for (const r of sub.requestFailures.slice(0, 3)) {
            console.log(`             - ${r.url} (${r.error})`);
        }
    }
}

async function main() {
    if (!fs.existsSync(FORMATTER_PATH)) {
        console.error(`FATAL — formatter not found: ${FORMATTER_PATH}`);
        process.exit(2);
    }
    if (!fs.existsSync(BUNDLE_PATH)) {
        console.error(`FATAL — bundle not found: ${BUNDLE_PATH}`);
        console.error('       Run: cd better_map/appserver/static/visualizations/better_map && npm run build');
        process.exit(2);
    }

    const args = parseArgs(process.argv);
    const playwright = loadPlaywright();

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const fragment = fs.readFileSync(FORMATTER_PATH, 'utf8');
    fs.writeFileSync(
        FORMATTER_WRAPPER_PATH,
        buildFormatterWrapper(fragment),
        'utf8',
    );

    if (!args.skipBundle) {
        const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
        fs.writeFileSync(
            BUNDLE_WRAPPER_PATH,
            buildBundleWrapper(bundle),
            'utf8',
        );
    }

    const relFormatter = path.relative(REPO_ROOT, FORMATTER_PATH);
    const relBundle = path.relative(REPO_ROOT, BUNDLE_PATH);
    const relReport = path.relative(REPO_ROOT, REPORT_PATH);

    console.log('\x1b[1mD2 — Browser compatibility audit (Phase 1 + Phase 1.5)\x1b[0m');
    console.log(`  Formatter:   ${relFormatter}`);
    if (!args.skipBundle) {
        console.log(`  Bundle:      ${relBundle}`);
    } else {
        console.log(`  Bundle:      SKIPPED (--skip-bundle)`);
    }
    console.log(`  Engines:     ${args.engines.join(', ')}`);
    console.log(`  Platform:    linux (Phase 1 scope; macOS / Windows = Phase 2)`);
    console.log('');

    const results = [];
    for (const engineName of args.engines) {
        const r = await runEngine(playwright, engineName, args);
        results.push(r);
        printEngineSummary(r);
    }
    console.log('');

    const summary = {
        generator: 'scripts/check-browser-compat.js',
        formatter: relFormatter,
        bundle: args.skipBundle ? null : relBundle,
        platform: 'linux',
        engines: results,
        passCount: results.filter((r) => r.status === 'pass').length,
        failCount: results.filter((r) => r.status === 'fail').length,
    };
    fs.writeFileSync(REPORT_PATH, JSON.stringify(summary, null, 2), 'utf8');

    if (summary.failCount > 0) {
        console.log(
            `\x1b[31m  FAIL — ${summary.failCount}/${results.length} engine(s) reported errors. ` +
                `Report: ${relReport}\x1b[0m`,
        );
        console.log(
            '  Fix the underlying issue (`formatter.html` for class A, `visualization.js` for class B). ' +
                'See docs/COMPAT-MATRIX.md "Reading a failing run" for the symptom → cause table.',
        );
        process.exit(1);
    }

    const surfaces = args.skipBundle ? 'formatter' : 'formatter + bundle';
    console.log(
        `\x1b[32m  PASS — ${summary.passCount}/${results.length} engine(s) loaded ${surfaces} without errors. ` +
            `Report: ${relReport}\x1b[0m`,
    );
}

main().catch((err) => {
    console.error('FATAL — browser-compat audit script crashed:');
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
});
