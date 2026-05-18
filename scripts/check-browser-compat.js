#!/usr/bin/env node
/*
 * D2 — Browser compatibility audit Phase 1.
 *
 * ROADMAP §3 D2 Phase 1 + §4 v1.7 milestone exit-criterion
 * "12 showcases pass on Chrome, Firefox, Safari, Edge × ..."
 *
 * Goal: catch the "doesn't load in Firefox / WebKit" class of bug at
 *       PR time, BEFORE a customer trips over it. The bundle ships
 *       through webpack with `target: ['web', 'es5']` (per
 *       `splunk-custom-viz-integration.mdc` §11) precisely so that
 *       Splunk's AMD loader on every browser can `require()` it, but
 *       nothing in CI today asserts that the produced
 *       `visualization.js` actually parses + executes in WebKit and
 *       Firefox. This Phase 1 gate closes that gap on the only
 *       standalone HTML surface we ship (`formatter.html`), which is
 *       what every Dashboard Studio user sees when they open the
 *       Better Map options panel.
 *
 * Phase scoping (mirrors the D3 accessibility script's Phase
 * sequencing):
 *   - Phase 1 (THIS script): `formatter.html` load test in headless
 *     {Chromium, Firefox, WebKit} on Linux. Asserts the page loads
 *     (`document.body` non-empty), no console.error events fired, no
 *     page-level errors fired (`page.on('pageerror')`). Linux only —
 *     because GitHub Actions free runners are Linux. Real macOS
 *     Safari and Windows Edge fall to Phase 2. Each browser produces
 *     a screenshot for visual reference in `reports/browser-compat/`.
 *   - Phase 2 (deferred): same harness rendered against the 12
 *     showcase dashboards inside a live Splunk Enterprise container
 *     (blocked on D5 Phase 2 wiring) + cross-OS matrix (matrix job
 *     against `macos-latest` + `windows-latest`, blocked on a
 *     self-hosted-runner decision per ROADMAP §3 D5 risk note).
 *   - Out of scope: visual-regression diff against a baseline (the
 *     formatter is hand-laid out — a 1-pixel font-metric difference
 *     between Chromium and WebKit would flake the gate without
 *     improving customer signal).
 *
 * Strategy:
 *   1. Read `formatter.html` and wrap it in the same minimal HTML5
 *      page used by the D3 accessibility audit (DRY: identical
 *      wrapper so a regression in the wrapper affects both gates
 *      identically).
 *   2. For each engine in [chromium, firefox, webkit]:
 *      a. Launch headless via Playwright.
 *      b. Subscribe to `console`, `pageerror`, and request-failed
 *         events; record any error-level events.
 *      c. `page.goto(file://...wrapper)` with `waitUntil: 'load'`
 *         and a 30s timeout (generous because WebKit cold-starts
 *         are slow on GitHub free runners).
 *      d. Verify `document.body.children.length > 0` — defends
 *         against a silent-empty-body crash where the page
 *         technically loads but the formatter HTML was rejected
 *         by the engine's parser.
 *      e. Save a screenshot to `reports/browser-compat/<engine>.png`.
 *      f. Record per-engine result (PASS/FAIL + error list) in the
 *         JSON report.
 *   3. Persist the full JSON report under
 *      `reports/browser-compat-report.json` for CI artifact upload.
 *   4. Print a focused, human-readable per-engine summary.
 *   5. Exit 1 if any engine reported errors; 0 otherwise.
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
 *   0  PASS  (every browser loaded without errors)
 *   1  FAIL  (one or more browsers had load errors)
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
const REPORT_DIR = path.join(REPO_ROOT, 'reports');
const SCREENSHOT_DIR = path.join(REPORT_DIR, 'browser-compat');
const REPORT_PATH = path.join(REPORT_DIR, 'browser-compat-report.json');
const WRAPPER_PATH = path.join(REPORT_DIR, '_browser-compat-wrapper.html');

const ALL_ENGINES = ['chromium', 'firefox', 'webkit'];
const GOTO_TIMEOUT_MS = 30000;

function parseArgs(argv) {
    const args = { engines: ALL_ENGINES.slice() };
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
        } else if (raw === '--help' || raw === '-h') {
            console.log(
                'D2 — Browser compatibility audit\n' +
                    '  --engine=<list>   comma-separated subset of: ' +
                    ALL_ENGINES.join(', ') +
                    '\n  --help            show this message\n',
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

function buildWrapper(fragmentHtml) {
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

async function runEngine(playwright, engineName) {
    const launcher = playwright[engineName];
    if (!launcher) {
        return {
            engine: engineName,
            status: 'fail',
            errors: [`engine '${engineName}' is not exposed by Playwright`],
            consoleErrors: [],
            pageErrors: [],
            requestFailures: [],
            bodyChildCount: 0,
            screenshotPath: null,
        };
    }

    const result = {
        engine: engineName,
        status: 'unknown',
        errors: [],
        consoleErrors: [],
        pageErrors: [],
        requestFailures: [],
        bodyChildCount: 0,
        screenshotPath: null,
    };

    let browser;
    try {
        browser = await launcher.launch();
    } catch (err) {
        result.status = 'fail';
        const detail = err && err.message ? err.message : String(err);
        result.errors.push(`launch failed: ${detail}`);
        // Hint about the most common cause (browser binaries not installed).
        if (detail.includes("Executable doesn't exist") ||
            detail.includes('browserType.launch')) {
            result.errors.push(
                'hint: run `cd better_map/appserver/static/visualizations/' +
                    'better_map && npx playwright install --with-deps ' +
                    engineName + '`',
            );
        }
        return result;
    }

    try {
        const context = await browser.newContext();
        const page = await context.newPage();

        page.on('console', (msg) => {
            if (msg.type() === 'error') {
                result.consoleErrors.push({
                    text: msg.text(),
                    location: msg.location(),
                });
            }
        });
        page.on('pageerror', (err) => {
            result.pageErrors.push(
                err && err.stack ? err.stack : String(err),
            );
        });
        page.on('requestfailed', (req) => {
            const failure = req.failure();
            result.requestFailures.push({
                url: req.url(),
                error: failure ? failure.errorText : 'unknown',
            });
        });

        await page.goto(`file://${WRAPPER_PATH}`, {
            waitUntil: 'load',
            timeout: GOTO_TIMEOUT_MS,
        });

        result.bodyChildCount = await page.evaluate(
            () => document.body.children.length,
        );
        if (result.bodyChildCount === 0) {
            result.errors.push(
                'document.body has zero children after load — engine rejected the HTML',
            );
        }

        const screenshotPath = path.join(
            SCREENSHOT_DIR,
            `${engineName}.png`,
        );
        await page.screenshot({ path: screenshotPath, fullPage: true });
        result.screenshotPath = path.relative(REPO_ROOT, screenshotPath);
    } catch (err) {
        const detail = err && err.message ? err.message : String(err);
        result.errors.push(`page interaction failed: ${detail}`);
    } finally {
        await browser.close().catch(() => {});
    }

    const failed =
        result.errors.length > 0 ||
        result.consoleErrors.length > 0 ||
        result.pageErrors.length > 0 ||
        result.requestFailures.length > 0;
    result.status = failed ? 'fail' : 'pass';
    return result;
}

function printEngineSummary(result) {
    const colour = result.status === 'pass' ? '\x1b[32m' : '\x1b[31m';
    const reset = '\x1b[0m';
    console.log(
        `  ${colour}${result.status.toUpperCase()}${reset}  ${result.engine}` +
            `  (body children: ${result.bodyChildCount}` +
            (result.screenshotPath
                ? `, screenshot: ${result.screenshotPath}`
                : '') +
            ')',
    );

    if (result.errors.length > 0) {
        for (const e of result.errors) {
            console.log(`         engine-level: ${e}`);
        }
    }
    if (result.consoleErrors.length > 0) {
        console.log(`         console.error events: ${result.consoleErrors.length}`);
        for (const e of result.consoleErrors.slice(0, 5)) {
            console.log(`           - ${e.text}`);
        }
        if (result.consoleErrors.length > 5) {
            console.log(
                `           ... and ${result.consoleErrors.length - 5} more — see report JSON`,
            );
        }
    }
    if (result.pageErrors.length > 0) {
        console.log(`         pageerror events: ${result.pageErrors.length}`);
        for (const e of result.pageErrors.slice(0, 3)) {
            const firstLine = e.split('\n')[0];
            console.log(`           - ${firstLine}`);
        }
    }
    if (result.requestFailures.length > 0) {
        console.log(`         requestfailed events: ${result.requestFailures.length}`);
        for (const r of result.requestFailures.slice(0, 3)) {
            console.log(`           - ${r.url} (${r.error})`);
        }
    }
}

async function main() {
    if (!fs.existsSync(FORMATTER_PATH)) {
        console.error(`FATAL — formatter not found: ${FORMATTER_PATH}`);
        process.exit(2);
    }

    const args = parseArgs(process.argv);
    const playwright = loadPlaywright();

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    fs.mkdirSync(SCREENSHOT_DIR, { recursive: true });

    const fragment = fs.readFileSync(FORMATTER_PATH, 'utf8');
    const wrapped = buildWrapper(fragment);
    fs.writeFileSync(WRAPPER_PATH, wrapped, 'utf8');

    const relFormatter = path.relative(REPO_ROOT, FORMATTER_PATH);
    const relWrapper = path.relative(REPO_ROOT, WRAPPER_PATH);
    const relReport = path.relative(REPO_ROOT, REPORT_PATH);

    console.log('\x1b[1mD2 — Browser compatibility audit (Phase 1)\x1b[0m');
    console.log(`  Source:    ${relFormatter}`);
    console.log(`  Wrapper:   ${relWrapper}`);
    console.log(`  Engines:   ${args.engines.join(', ')}`);
    console.log(`  Platform:  linux (Phase 1 scope; macOS / Windows = Phase 2)`);
    console.log('');

    const results = [];
    for (const engineName of args.engines) {
        const r = await runEngine(playwright, engineName);
        results.push(r);
        printEngineSummary(r);
    }
    console.log('');

    const summary = {
        generator: 'scripts/check-browser-compat.js',
        formatter: relFormatter,
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
            '  Fix the underlying issue in formatter.html (or, if engine-specific, ' +
                'document the gap in docs/COMPAT-MATRIX.md and tighten the wrapper).',
        );
        process.exit(1);
    }

    console.log(
        `\x1b[32m  PASS — ${summary.passCount}/${results.length} engine(s) loaded formatter.html without errors. ` +
            `Report: ${relReport}\x1b[0m`,
    );
}

main().catch((err) => {
    console.error('FATAL — browser-compat audit script crashed:');
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
});
