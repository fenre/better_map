#!/usr/bin/env node
/*
 * D3 — Accessibility audit (axe-core on formatter.html).
 *
 * ROADMAP §3 D3 Phase 1 + §7b "WCAG 2.2 AA conformance verified" box.
 *
 * Goal: stop a contributor from regressing the accessibility of
 *       `formatter.html` — the only standalone HTML surface better_map
 *       ships. Splunk renders it inside the visualization-options panel
 *       of Dashboard Studio v2, so it is on the critical path for every
 *       dashboard author who configures a Better Map panel. Inputs
 *       without labels, duplicate `id`s, missing ARIA attributes, or
 *       low-contrast colours degrade the experience for screen-reader
 *       users and break keyboard navigation outright.
 *
 * Phase scoping:
 *   - Phase 1 (this script): formatter.html in a headless Chromium,
 *     axe-core WCAG 2.0 / 2.1 / 2.2 A+AA. No Splunk dependency, no
 *     Docker. Hard PR-gate.
 *   - Phase 2 (deferred to D5): same axe-core run inside Playwright
 *     against the 12 showcase dashboards rendered by a real Splunk
 *     Enterprise container. Blocked on the Docker-compose harness
 *     scheduled under D5.
 *   - Out of scope here: manual screen-reader passes with VoiceOver +
 *     NVDA. Those are documented in ROADMAP §3 D3 and remain a manual
 *     acceptance step before E1 (Splunkbase listing).
 *
 * Strategy:
 *   1. Read `formatter.html` (a Splunk-rendered fragment that opens
 *      with `<div class="splunk-formatter ...">` — not a full HTML
 *      document).
 *   2. Wrap it in a minimal HTML5 page so axe-core has the page-level
 *      landmarks it expects (`<html lang>`, `<title>`, `<h1>`,
 *      `<main>`). The wrapper lives outside the manifest tree so it
 *      never ships to Splunk.
 *   3. Load the wrapper in headless Chromium via Playwright.
 *   4. Run axe-core with the WCAG 2 A/AA + 2.1 A/AA + 2.2 AA tags.
 *   5. Disable a small set of rules that genuinely do not apply to a
 *      Splunk-hosted fragment (page-has-heading-one,
 *      landmark-one-main, region) — Splunk's chrome provides the
 *      page-level landmarks.
 *   6. Persist the full JSON report under `<repo-root>/reports/` so
 *      CI can upload it as an artifact for offline triage; the dir
 *      is already gitignored.
 *   7. Print a focused, human-readable summary; exit 1 on any
 *      violation.
 *
 * Why these rules are disabled:
 *   - `page-has-heading-one` / `landmark-one-main` / `region` — the
 *     formatter is rendered inside Splunk's edit panel, which carries
 *     its own `<h1>` and `<main>`. Inserting a duplicate `<h1>` in our
 *     fragment would break Splunk's information architecture.
 *   - No other rule is disabled. If a future PR needs an exception
 *     it MUST be added here with a one-line justification and a
 *     reference to the relevant Splunk-side constraint.
 *
 * Exit codes:
 *   0  PASS  (zero violations at the configured tag set)
 *   1  FAIL  (one or more violations)
 *   2  internal error (Playwright / read failure, missing browser)
 *
 * Re-run locally:
 *   cd better_map/appserver/static/visualizations/better_map
 *   npm run lint:a11y
 *
 * (or, from repo root): node scripts/check-accessibility.js
 *
 * First-run note: Playwright ships browser binaries separately from
 * the npm package. The CI step installs them via
 * `npx playwright install --with-deps chromium`. If running locally
 * for the first time, run the same command in the viz package or
 * (ChromiumNotFound) will be the error you see.
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths — script can run from anywhere; all paths resolve from repo root.
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const VIZ_DIR = path.join(
    REPO_ROOT,
    'better_map/appserver/static/visualizations/better_map',
);
const FORMATTER_PATH = path.join(VIZ_DIR, 'formatter.html');
const REPORT_DIR = path.join(REPO_ROOT, 'reports');
const REPORT_PATH = path.join(REPORT_DIR, 'accessibility-report.json');
const WRAPPER_PATH = path.join(REPORT_DIR, '_a11y-wrapper.html');

// ---------------------------------------------------------------------------
// Audit configuration.
//
// Tags chosen so that this gate covers everything Splunkbase + most
// enterprise procurement reviews expect to see:
//   - wcag2a / wcag2aa   : WCAG 2.0 Level A + AA (the historical baseline)
//   - wcag21a / wcag21aa : WCAG 2.1 additions (touch targets, orientation)
//   - wcag22aa           : WCAG 2.2 AA additions (focus appearance, etc.)
//
// `best-practice` is intentionally excluded — it surfaces non-WCAG rules
// (heading-order, region) that turn into noise on a fragment loaded in
// someone else's chrome. We can opt into individual best-practice rules
// later if we find them valuable.
// ---------------------------------------------------------------------------
const AXE_TAGS = ['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa', 'wcag22aa'];

const DISABLED_RULES = [
    // Splunk's own page chrome provides the page-level <h1>, <main>,
    // and landmark structure. A fragment cannot satisfy these without
    // forging structure that conflicts with the host page.
    'page-has-heading-one',
    'landmark-one-main',
    'region',
];

// ---------------------------------------------------------------------------
// Lazy-load Playwright + @axe-core/playwright so a clear error message
// surfaces if they're missing instead of a useless `MODULE_NOT_FOUND`.
//
// The deps live under the viz package (`better_map/appserver/static/
// visualizations/better_map/node_modules/`), but this script lives at
// repo root under `scripts/`. We explicitly resolve from the viz dir
// so the script works from any CWD (repo root, viz dir, CI step, etc.)
// — same posture as `scripts/lint-js-css-contract.js`.
// ---------------------------------------------------------------------------
function loadDeps() {
    let playwright;
    let AxeBuilder;
    try {
        playwright = require(
            require.resolve('playwright', { paths: [VIZ_DIR] }),
        );
    } catch (err) {
        console.error('FATAL — `playwright` is not installed.');
        console.error(
            '       Run: cd better_map/appserver/static/visualizations/better_map && npm ci',
        );
        process.exit(2);
    }
    try {
        AxeBuilder = require(
            require.resolve('@axe-core/playwright', { paths: [VIZ_DIR] }),
        ).default;
    } catch (err) {
        console.error('FATAL — `@axe-core/playwright` is not installed.');
        console.error(
            '       Run: cd better_map/appserver/static/visualizations/better_map && npm ci',
        );
        process.exit(2);
    }
    return { playwright, AxeBuilder };
}

// ---------------------------------------------------------------------------
// Build the wrapper page. The fragment ships as `<div class="splunk-
// formatter ...">` so we need to give axe a real HTML document with the
// landmarks it expects from a host page. We also pin `lang="en"` so the
// `html-has-lang` rule passes — every translation will set its own lang
// once G4 lands.
// ---------------------------------------------------------------------------
function buildWrapper(fragmentHtml) {
    return `<!DOCTYPE html>
<html lang="en">
<head>
    <meta charset="utf-8">
    <meta name="viewport" content="width=device-width, initial-scale=1">
    <title>Better Map formatter — accessibility audit harness</title>
    <style>
        /* The accessibility audit only cares about semantic structure,
           focus, and contrast. We do NOT load visualization.css — the
           formatter chrome at runtime is styled by Splunk, not us.
           Background and foreground are explicitly set so axe's
           color-contrast rule has a deterministic surface to evaluate
           any text whose color we declare ourselves. */
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
    <h1>Better Map formatter (audit harness)</h1>
    <main>
${fragmentHtml}
    </main>
</body>
</html>
`;
}

// ---------------------------------------------------------------------------
// Pretty-print one axe violation. Truncates to the first 5 affected nodes
// so the log stays readable on heavily-affected runs.
// ---------------------------------------------------------------------------
function formatViolation(v) {
    const lines = [];
    const impact = v.impact ? `[${v.impact}]` : '[unknown]';
    lines.push(`  ${impact} ${v.id}: ${v.help}`);
    lines.push(`    docs: ${v.helpUrl}`);
    lines.push(`    tags: ${(v.tags || []).join(', ')}`);
    lines.push(`    ${v.nodes.length} affected node(s):`);
    const NODES_TO_SHOW = 5;
    for (const node of v.nodes.slice(0, NODES_TO_SHOW)) {
        const selector = (node.target || []).join(', ');
        lines.push(`      - ${selector}`);
        if (node.failureSummary) {
            for (const m of node.failureSummary
                .split('\n')
                .map((s) => s.trim())
                .filter(Boolean)) {
                lines.push(`          ${m}`);
            }
        }
    }
    if (v.nodes.length > NODES_TO_SHOW) {
        lines.push(
            `      ... and ${v.nodes.length - NODES_TO_SHOW} more affected node(s) — see report JSON`,
        );
    }
    return lines.join('\n');
}

async function main() {
    if (!fs.existsSync(FORMATTER_PATH)) {
        console.error(`FATAL — formatter not found: ${FORMATTER_PATH}`);
        process.exit(2);
    }

    const { playwright, AxeBuilder } = loadDeps();

    fs.mkdirSync(REPORT_DIR, { recursive: true });
    const fragment = fs.readFileSync(FORMATTER_PATH, 'utf8');
    const wrapped = buildWrapper(fragment);
    fs.writeFileSync(WRAPPER_PATH, wrapped, 'utf8');

    const relFormatter = path.relative(REPO_ROOT, FORMATTER_PATH);
    const relWrapper = path.relative(REPO_ROOT, WRAPPER_PATH);
    const relReport = path.relative(REPO_ROOT, REPORT_PATH);

    console.log('\x1b[1mD3 — axe-core accessibility audit\x1b[0m');
    console.log(`  Source:  ${relFormatter}`);
    console.log(`  Wrapper: ${relWrapper}`);
    console.log(`  Tags:    ${AXE_TAGS.join(', ')}`);
    console.log(`  Disabled rules (host-page concerns):`);
    for (const r of DISABLED_RULES) {
        console.log(`    - ${r}`);
    }
    console.log('');

    let browser;
    let results;
    try {
        browser = await playwright.chromium.launch();
        const context = await browser.newContext();
        const page = await context.newPage();
        await page.goto(`file://${WRAPPER_PATH}`, { waitUntil: 'load' });
        results = await new AxeBuilder({ page })
            .withTags(AXE_TAGS)
            .disableRules(DISABLED_RULES)
            .analyze();
    } catch (err) {
        console.error('FATAL — axe-core run failed:');
        console.error(err && err.stack ? err.stack : String(err));
        if (browser) await browser.close().catch(() => {});
        process.exit(2);
    }
    await browser.close();

    fs.writeFileSync(REPORT_PATH, JSON.stringify(results, null, 2), 'utf8');

    const summaryLines = [
        `  Tests evaluated:   ${
            results.passes.length +
            results.violations.length +
            results.incomplete.length +
            results.inapplicable.length
        }`,
        `    passes:          ${results.passes.length}`,
        `    violations:      ${results.violations.length}`,
        `    incomplete:      ${results.incomplete.length}  (need manual review)`,
        `    inapplicable:    ${results.inapplicable.length}`,
        `  Report:            ${relReport}`,
    ];
    console.log(summaryLines.join('\n'));
    console.log('');

    if (results.violations.length > 0) {
        console.log(
            '\x1b[31m  FAIL — axe-core reported violations:\x1b[0m',
        );
        console.log('');
        for (const v of results.violations) {
            console.log(formatViolation(v));
            console.log('');
        }
        console.log(
            '  Fix the markup in formatter.html, then re-run: node scripts/check-accessibility.js',
        );
        console.log(
            '  If a violation is genuinely a Splunk-host concern, add the rule id to DISABLED_RULES with a one-line justification.',
        );
        process.exit(1);
    }

    if (results.incomplete.length > 0) {
        console.log(
            `  Note: ${results.incomplete.length} rule(s) need manual review (axe could not decide).`,
        );
        console.log(
            '  These do NOT fail the gate but should be eyeballed during release prep.',
        );
        for (const inc of results.incomplete) {
            console.log(
                `    - [${inc.impact || 'n/a'}] ${inc.id}: ${inc.help} (${inc.nodes.length} node(s))`,
            );
        }
        console.log('');
    }

    console.log(
        '\x1b[32m  PASS — formatter.html has zero axe-core violations at WCAG 2.2 AA.\x1b[0m',
    );
}

main().catch((err) => {
    console.error('FATAL — accessibility audit script crashed:');
    console.error(err && err.stack ? err.stack : String(err));
    process.exit(2);
});
