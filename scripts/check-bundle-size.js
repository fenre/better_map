#!/usr/bin/env node
/*
 * Q-3 — Bundle-size budget check (ROADMAP §7b + §7c-widget).
 *
 * Goal: stop a single PR from blowing the cold-start performance contract
 *       by silently doubling the bundle size. The runtime cost of a Splunk
 *       custom viz is paid by every dashboard panel on every page load —
 *       a 600 KB regression compounds across 12 showcase panels.
 *
 * Budgets (ROADMAP §7b, baselines from v1.6 verification):
 *
 *     visualization.js  raw      ≤ 3.0 MB   (v1.6.2 actual: 2.23 MB)
 *     visualization.js  gzipped  ≤ 800 KB   (v1.6.2 actual: 576 KB)
 *     visualization.css raw      ≤ 100 KB   (v1.6.2 actual: ~51 KB)
 *
 * The CSS budget is not in the ROADMAP today; we set it at ~2x current to
 *  catch a runaway hand-authored stylesheet without false-firing on routine
 *  growth (e.g. adding a few hundred bytes per new widget).
 *
 * The headroom on the JS budgets is deliberately wide: ROADMAP §3 B1
 * (deck.gl scenegraph) and §3 F3 (Cesium/glTF) both add ~600 KB gzipped
 * each. The 800 KB gzip ceiling is the line in the sand for v2.0; this
 * check protects it from being crossed *before* those features even land.
 *
 * Strategy: pure Node + zlib (built-in). Zero new dependencies. Same
 * posture as G8 (JS↔CSS contract) and Q-2 (console noise).
 *
 * Exit codes:
 *   0  PASS  (within budget, or files missing → skipped)
 *   1  FAIL  (any budget breached)
 *   2  internal error (read / gzip failure)
 *
 * Why we wrote it ourselves instead of pulling `size-limit`:
 *   - One dependency, one transitive tree, one supply-chain risk surface
 *     per gate that we don't actually need. `size-limit` is excellent but
 *     adds ~80 packages to lock in node_modules for a 30-line check.
 *   - This script reads a single file, calls zlib once, and prints a
 *     table. The behaviour is so simple that there is no maintenance win
 *     from outsourcing it.
 *   - If a richer gate is wanted later (per-import bundle analysis,
 *     historical trend graphs), `size-limit` or `bundlewatch` can be
 *     added on top — they do not conflict with this static budget check.
 */

'use strict';

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');

const REPO_ROOT = path.resolve(__dirname, '..');
const VIZ_ROOT = path.join(
    REPO_ROOT,
    'better_map',
    'appserver',
    'static',
    'visualizations',
    'better_map',
);

const KB = 1024;
const MB = 1024 * 1024;

// -----------------------------------------------------------------------------
// Budgets — sourced from ROADMAP §7b. Keep these in sync with the roadmap;
// the table in the §7b checklist is authoritative.
// -----------------------------------------------------------------------------
const BUDGETS = [
    {
        name: 'visualization.js (raw)',
        path: path.join(VIZ_ROOT, 'visualization.js'),
        budgetBytes: 3.0 * MB,
        gzip: false,
        roadmapRef: '§7b: ≤ 3.0 MB; v1.6.2 baseline 2.23 MB',
    },
    {
        name: 'visualization.js (gzip)',
        path: path.join(VIZ_ROOT, 'visualization.js'),
        budgetBytes: 800 * KB,
        gzip: true,
        roadmapRef: '§7b: ≤ 800 KB; v1.6.2 baseline 576 KB',
    },
    {
        name: 'visualization.css (raw)',
        path: path.join(VIZ_ROOT, 'visualization.css'),
        budgetBytes: 100 * KB,
        gzip: false,
        roadmapRef: 'project-local: ≤ 100 KB; v1.6.2 baseline ~51 KB',
    },
];

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

/**
 * Format a byte count as a human-readable string (KB / MB) with one decimal.
 * Aligns visually in the report table — pad-to-width is done by the caller.
 */
function formatBytes(n) {
    if (n >= MB) {
        return (n / MB).toFixed(2) + ' MB';
    }
    if (n >= KB) {
        return (n / KB).toFixed(1) + ' KB';
    }
    return String(n) + ' B';
}

/**
 * Compute the gzipped size of a file in bytes, using zlib defaults
 * (matches what nginx/Splunk Web would serve over the wire).
 */
function gzipSize(buffer) {
    const compressed = zlib.gzipSync(buffer);
    return compressed.length;
}

/**
 * Measure a single budget entry. Returns the result row, with `skipped=true`
 * if the file does not exist (e.g. webpack build has not run yet in a fresh
 * checkout — the calling job in CI runs `npm run build` first).
 */
function measure(entry) {
    if (!fs.existsSync(entry.path)) {
        return {
            ...entry,
            skipped: true,
            actualBytes: 0,
            overBudget: false,
            pctOfBudget: 0,
        };
    }
    const raw = fs.readFileSync(entry.path);
    const actualBytes = entry.gzip ? gzipSize(raw) : raw.length;
    return {
        ...entry,
        skipped: false,
        actualBytes,
        overBudget: actualBytes > entry.budgetBytes,
        pctOfBudget: actualBytes / entry.budgetBytes,
    };
}

// -----------------------------------------------------------------------------
// Reporter.
// -----------------------------------------------------------------------------

function printReport(results) {
    console.log('Q-3 — bundle-size budget check\n');

    // Column widths sized to the longest expected entry.
    const nameW = 28;
    const actualW = 11;
    const budgetW = 11;
    const pctW = 7;
    const statusW = 14;

    const header =
        'asset'.padEnd(nameW) +
        'actual'.padStart(actualW) +
        'budget'.padStart(budgetW) +
        '%'.padStart(pctW) +
        '  ' +
        'status'.padEnd(statusW);
    console.log(header);
    console.log('-'.repeat(header.length));

    for (const r of results) {
        if (r.skipped) {
            console.log(
                r.name.padEnd(nameW) +
                    'n/a'.padStart(actualW) +
                    formatBytes(r.budgetBytes).padStart(budgetW) +
                    'n/a'.padStart(pctW) +
                    '  ' +
                    'skipped (no file)'.padEnd(statusW),
            );
            continue;
        }
        const pct = Math.round(r.pctOfBudget * 100) + '%';
        const status = r.overBudget ? 'OVER BUDGET' : 'within budget';
        console.log(
            r.name.padEnd(nameW) +
                formatBytes(r.actualBytes).padStart(actualW) +
                formatBytes(r.budgetBytes).padStart(budgetW) +
                pct.padStart(pctW) +
                '  ' +
                status.padEnd(statusW),
        );
    }
    console.log('');

    console.log('Budget rationale (ROADMAP §7b):');
    for (const r of results) {
        console.log(`  ${r.name.padEnd(nameW)} ${r.roadmapRef}`);
    }
    console.log('');

    const breaches = results.filter((r) => !r.skipped && r.overBudget);
    const measured = results.filter((r) => !r.skipped);

    if (measured.length === 0) {
        console.log(
            'SKIPPED — no bundle artifacts found. Run `npm run build` first.',
        );
        return 0;
    }
    if (breaches.length === 0) {
        console.log('PASS — all assets within budget.');
        return 0;
    }

    console.log(
        'FAIL — ' +
            breaches.length +
            ' asset(s) over budget. Investigate before merging:',
    );
    for (const b of breaches) {
        const over = b.actualBytes - b.budgetBytes;
        console.log(
            '  - ' +
                b.name +
                ': ' +
                formatBytes(b.actualBytes) +
                ' actual vs ' +
                formatBytes(b.budgetBytes) +
                ' budget (' +
                formatBytes(over) +
                ' over)',
        );
    }
    console.log(
        '\nCommon causes: a new heavy dependency, accidentally shipping a ' +
            'source-map, terser disabled, or unused imports pulling in entire ' +
            'libraries. Run `npx webpack --mode production --profile --json > ' +
            'stats.json` and inspect with `npx webpack-bundle-analyzer ' +
            'stats.json` to find the culprit.',
    );
    return 1;
}

// -----------------------------------------------------------------------------
// Entry point.
// -----------------------------------------------------------------------------

function main() {
    const results = BUDGETS.map(measure);
    return printReport(results);
}

try {
    process.exit(main());
} catch (err) {
    console.error('check-bundle-size: internal error');
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
}
