#!/usr/bin/env node
/*
 * Q-2 — Production-bundle console-noise check (ROADMAP §7b).
 *
 * Goal: stop debug cruft (raw `console.log` / `.debug` / `.info` / etc.) from
 *       shipping in better_map's production code, AND lock the contract that
 *       any `console.warn` / `console.error` from first-party src is
 *       (a) gated to "intentional last-resort error-telemetry surfaces" and
 *       (b) prefixed with `[better_map]` so it is attributable in DevTools.
 *
 * Why this exists:
 *   - The v1.6 ship was clean today (16 source console calls, all guarded and
 *     prefixed), but nothing prevents the next contributor from sprinkling
 *     `console.log('TODO: fix this')` into a hot path or a module.
 *   - ROADMAP §3 G2 lists this as a required PR gate: "regex-scan the
 *     minified visualization.js for unallowlisted console.warn / .error /
 *     .debug calls — debugHud.js and the explicit error-telemetry path are
 *     allowlisted; everything else fails CI".
 *   - ROADMAP §7b Quality has a checkbox: "Production-bundle console-noise
 *     check green: no unallowlisted console.warn / .error / .debug in the
 *     minified visualization.js".
 *
 * Strategy (two layers, both must pass):
 *
 *   1. SOURCE LINT (primary, where attribution works):
 *      Walk every .js file under src/ and apply these rules:
 *
 *        - Forbidden methods (any call is a FAIL):
 *            console.log, console.debug, console.info, console.trace,
 *            console.table, console.group, console.groupEnd,
 *            console.time, console.timeEnd, console.count, console.assert
 *
 *        - Conditional methods (allowed ONLY when first arg is a string
 *          literal that starts with `[better_map]`):
 *            console.warn, console.error
 *
 *        - Allowlisted files (whole file exempt, with justification):
 *            see ALLOWLISTED_FILES below.
 *
 *      Comments are stripped before matching so `// console.warn(...)` in a
 *      JSDoc block does not false-fire. We also strip whole strings before
 *      forbidden-method matching so a legit literal like the string
 *      `'console.log(...)'` inside a JS-template body does not false-fire.
 *
 *   2. BUNDLE SANITY (secondary, defends against webpack-mode mishaps):
 *      Scan the production bundle visualization.js and assert the total
 *      `console.*` call count stays within budget. We do NOT try to attribute
 *      individual calls — most of the budget is third-party (maplibre-gl,
 *      deck.gl, terraformer, etc.) which we do not control. The point of this
 *      check is to catch the day someone accidentally ships a dev-mode bundle
 *      (terser disabled) or pulls in a noisy new dep — both would balloon the
 *      count well past today's headroom.
 *
 *      Current production bundle: 74 console calls.
 *      Budget: 100 (≈35% headroom for first-party growth + small new deps).
 *
 * Exit codes:
 *   0  PASS  (or skipped if neither source nor bundle is present)
 *   1  FAIL  (source-lint violations or bundle over budget)
 *   2  internal error (file walk / read failure)
 *
 * Zero new dependencies; pure Node + regex, same posture as the G8 lint.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const VIZ_ROOT = path.join(
    REPO_ROOT,
    'better_map',
    'appserver',
    'static',
    'visualizations',
    'better_map',
);
const SRC_ROOT = path.join(VIZ_ROOT, 'src');
const BUNDLE_PATH = path.join(VIZ_ROOT, 'visualization.js');

// -----------------------------------------------------------------------------
// Allowlist — files exempt from per-call source rules.
// Keep this list short and *justified*. Every entry is an intentional surface
// where console output is part of the contract.
// -----------------------------------------------------------------------------
const ALLOWLISTED_FILES = {
    'lib/debugHud.js': {
        reason:
            'Intentional debug HUD surface. May emit any console method as ' +
            'part of its diagnostic contract; the HUD is opt-in (debugMode ' +
            'flag) and never enabled in customer-facing dashboards.',
    },
    'lib/errorStates.js': {
        reason:
            'Forward-compatible: future home for the error-telemetry ' +
            'fallback path (when no telemetry sink is configured, errors ' +
            'land in console). Currently emits nothing.',
    },
    'lib/perfHUD.js': {
        reason:
            'Performance HUD surface. May emit timing / counter logs as ' +
            'part of its diagnostic contract; opt-in via perfMode flag.',
    },
};

// -----------------------------------------------------------------------------
// Regex patterns.
// -----------------------------------------------------------------------------

// Methods that are NEVER allowed in non-allowlisted source.
const FORBIDDEN_METHODS = [
    'log',
    'debug',
    'info',
    'trace',
    'table',
    'group',
    'groupCollapsed',
    'groupEnd',
    'time',
    'timeEnd',
    'count',
    'countReset',
    'assert',
    'dir',
    'dirxml',
    'profile',
    'profileEnd',
];

// Methods that are CONDITIONALLY allowed (only with [better_map] prefix).
const GUARDED_METHODS = ['warn', 'error'];

// Match any console.<method>( on a single line, capturing method.
const CONSOLE_CALL_RE = /\bconsole\s*\.\s*([a-zA-Z]+)\s*\(/g;

// Match a guarded console call whose first argument is a string literal
// starting with `[better_map]`. Single, double, or backtick quote all accepted.
const GUARDED_OK_RE =
    /\bconsole\s*\.\s*(warn|error)\s*\(\s*['"`]\[better_map\]/;

// Match any console.<forbiddenMethod>( call.
const FORBIDDEN_RE = new RegExp(
    String.raw`\bconsole\s*\.\s*(` +
        FORBIDDEN_METHODS.join('|') +
        String.raw`)\s*\(`,
    'g',
);

// Match any console.<method>( in the minified bundle (for budget check only).
const BUNDLE_CONSOLE_RE = /\bconsole\s*\.\s*[a-zA-Z]+\s*\(/g;

// -----------------------------------------------------------------------------
// Budgets.
// -----------------------------------------------------------------------------
// Current bundle (v1.6.2): 74 console calls (all vendor + 16 first-party).
// Headroom: 35% for first-party growth and small new deps.
const BUNDLE_BUDGET = 100;

// -----------------------------------------------------------------------------
// Helpers.
// -----------------------------------------------------------------------------

/**
 * Walk a directory recursively and yield absolute paths of every file whose
 * extension matches one of `exts`. Skips node_modules and dist/build dirs.
 */
function walkFiles(root, exts) {
    /** @type {string[]} */
    const out = [];
    if (!fs.existsSync(root)) {
        return out;
    }
    const stack = [root];
    while (stack.length > 0) {
        const dir = stack.pop();
        const entries = fs.readdirSync(dir, {withFileTypes: true});
        for (const entry of entries) {
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                if (
                    entry.name === 'node_modules' ||
                    entry.name === 'dist' ||
                    entry.name === 'build' ||
                    entry.name.startsWith('.')
                ) {
                    continue;
                }
                stack.push(full);
            } else if (entry.isFile()) {
                const ext = path.extname(entry.name).toLowerCase();
                if (exts.includes(ext)) {
                    out.push(full);
                }
            }
        }
    }
    return out;
}

/**
 * Strip JS comments (line `//...` and block `/* ... *​/`) from source.
 * Does not handle every edge case (regex literals containing `//`) but is
 * adequate for first-party source where we control the code style.
 */
function stripJsComments(source) {
    // Remove block comments first (non-greedy).
    let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Then line comments. Use a multiline pattern that ignores `//` inside
    // a string literal heuristic (no quote character precedes on the line
    // since previous quote). This is imperfect but good enough for our
    // disciplined codebase.
    out = out.replace(/^([^"'`\n]*?)\/\/[^\n]*$/gm, '$1');
    return out;
}

/**
 * Strip string literals so a forbidden-method regex does not match content
 * inside a string. We only need this for the FORBIDDEN check; the GUARDED
 * check explicitly wants to *see* the string argument.
 *
 * Handles single, double, and backtick quotes. Respects backslash escapes.
 */
function stripStringLiterals(source) {
    return source.replace(
        /(['"`])(?:\\.|(?!\1)[^\\])*\1/g,
        (m) => m[0] + m[m.length - 1],
    );
}

/**
 * Compute the file's source path relative to `src/`, using forward slashes,
 * for use as an allowlist key.
 */
function srcRelative(absPath) {
    return path.relative(SRC_ROOT, absPath).split(path.sep).join('/');
}

// -----------------------------------------------------------------------------
// Source lint.
// -----------------------------------------------------------------------------

/**
 * @returns {{
 *   filesScanned: number,
 *   filesAllowlisted: number,
 *   violations: Array<{file: string, line: number, kind: string, snippet: string}>
 * }}
 */
function lintSource() {
    const files = walkFiles(SRC_ROOT, ['.js']);
    const violations = [];
    let filesAllowlisted = 0;

    for (const abs of files) {
        const rel = srcRelative(abs);
        if (ALLOWLISTED_FILES[rel]) {
            filesAllowlisted++;
            continue;
        }

        const raw = fs.readFileSync(abs, 'utf8');
        const stripped = stripJsComments(raw);

        // 1. Forbidden methods — strip string literals first so we do not
        //    false-fire on a literal `'console.log(...)'`.
        const noStrings = stripStringLiterals(stripped);
        const lines = noStrings.split('\n');
        for (let i = 0; i < lines.length; i++) {
            const line = lines[i];
            FORBIDDEN_RE.lastIndex = 0;
            let match;
            while ((match = FORBIDDEN_RE.exec(line)) !== null) {
                violations.push({
                    file: rel,
                    line: i + 1,
                    kind: 'FORBIDDEN_METHOD',
                    snippet: `console.${match[1]}(... ) — never allowed in shipping source`,
                });
            }
        }

        // 2. Guarded methods (warn / error) — must have [better_map] prefix.
        //    Use the *unstripped* source so we can see the string literal.
        const guardedLines = stripped.split('\n');
        for (let i = 0; i < guardedLines.length; i++) {
            const line = guardedLines[i];
            CONSOLE_CALL_RE.lastIndex = 0;
            let match;
            while ((match = CONSOLE_CALL_RE.exec(line)) !== null) {
                const method = match[1];
                if (!GUARDED_METHODS.includes(method)) {
                    continue;
                }
                if (!GUARDED_OK_RE.test(line)) {
                    violations.push({
                        file: rel,
                        line: i + 1,
                        kind: 'MISSING_PREFIX',
                        snippet: `console.${method}(...) — first argument must be a string literal starting with [better_map]`,
                    });
                }
            }
        }
    }

    return {
        filesScanned: files.length,
        filesAllowlisted,
        violations,
    };
}

// -----------------------------------------------------------------------------
// Bundle sanity check.
// -----------------------------------------------------------------------------

/**
 * @returns {{ exists: boolean, callCount: number, budget: number, overBudget: boolean }}
 */
function checkBundle() {
    if (!fs.existsSync(BUNDLE_PATH)) {
        return {exists: false, callCount: 0, budget: BUNDLE_BUDGET, overBudget: false};
    }
    const bundle = fs.readFileSync(BUNDLE_PATH, 'utf8');
    const matches = bundle.match(BUNDLE_CONSOLE_RE) || [];
    return {
        exists: true,
        callCount: matches.length,
        budget: BUNDLE_BUDGET,
        overBudget: matches.length > BUNDLE_BUDGET,
    };
}

// -----------------------------------------------------------------------------
// Reporter.
// -----------------------------------------------------------------------------

function formatViolation(v) {
    const file = v.file.padEnd(40);
    const where = `:${String(v.line).padStart(4)}`;
    return `  ${file}${where}  [${v.kind}]  ${v.snippet}`;
}

function printReport(source, bundle) {
    console.log('Q-2 — production-bundle console-noise check\n');

    console.log('SOURCE LINT');
    console.log(`  files scanned        : ${source.filesScanned}`);
    console.log(`  files allowlisted    : ${source.filesAllowlisted}`);
    console.log(`  violations           : ${source.violations.length}`);
    if (source.violations.length > 0) {
        console.log('');
        console.log('  Violations:');
        for (const v of source.violations) {
            console.log(formatViolation(v));
        }
    }
    console.log('');

    console.log('BUNDLE SANITY');
    if (!bundle.exists) {
        console.log(`  bundle               : NOT FOUND (skipped)`);
        console.log(`  path                 : ${path.relative(REPO_ROOT, BUNDLE_PATH)}`);
        console.log(`  note                 : run 'npm run build' in the viz dir first`);
    } else {
        console.log(`  bundle               : ${path.relative(REPO_ROOT, BUNDLE_PATH)}`);
        console.log(`  console.* calls      : ${bundle.callCount}`);
        console.log(`  budget               : ${bundle.budget}`);
        console.log(
            `  status               : ${bundle.overBudget ? 'OVER BUDGET' : 'within budget'}`,
        );
    }
    console.log('');

    const allowlistKeys = Object.keys(ALLOWLISTED_FILES);
    if (allowlistKeys.length > 0) {
        console.log('ALLOWLIST');
        for (const key of allowlistKeys) {
            console.log(`  ${key}`);
            console.log(`    ${ALLOWLISTED_FILES[key].reason}`);
        }
        console.log('');
    }

    const sourceOk = source.violations.length === 0;
    const bundleOk = !bundle.exists || !bundle.overBudget;

    if (sourceOk && bundleOk) {
        console.log('PASS — no unallowlisted console noise.');
        return 0;
    }
    if (!sourceOk) {
        console.log(
            'FAIL — first-party source emits console calls that violate the ' +
                'contract.',
        );
        console.log(
            '       Fix: either guard the call with the [better_map] prefix, ' +
                'remove it, or (if it belongs to a debug/telemetry surface) ' +
                'add the file to ALLOWLISTED_FILES with a justification.',
        );
    }
    if (!bundleOk) {
        console.log(
            'FAIL — production bundle exceeds console-noise budget (' +
                bundle.callCount +
                ' > ' +
                bundle.budget +
                ').',
        );
        console.log(
            '       Likely cause: dev-mode bundle shipped, terser disabled, ' +
                'or a new dependency added that emits a lot of console calls.',
        );
    }
    return 1;
}

// -----------------------------------------------------------------------------
// Entry point.
// -----------------------------------------------------------------------------

function main() {
    const source = lintSource();
    const bundle = checkBundle();
    return printReport(source, bundle);
}

try {
    process.exit(main());
} catch (err) {
    console.error('check-bundle-console-noise: internal error');
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
}
