#!/usr/bin/env node
/*
 * G8 — JS↔CSS contract lint
 *
 * Asserts that every `better_map-*` CSS class created in JS (via string
 * literals, template literals, `className =` assignments, `classList.add(...)`,
 * `setAttribute('class', ...)`, or appearing as a class selector in
 * formatter.html) has at least one matching rule in
 * `appserver/static/visualizations/better_map/visualization.css` — or is
 * declared in `scripts/css-contract-allowlist.json` with a one-line
 * justification.
 *
 * Why this exists: the v1.6.0 release shipped 12 widget root classes and
 * 9 sub-element classes with ZERO CSS rules. The widgets were created and
 * appended to the DOM but rendered behind the absolutely-positioned
 * MapLibre canvas because `position: static` left them at the bottom of
 * the stacking context. Symptom: control-panel toggles for v1.6 widgets
 * appeared to do nothing. Patched same-day in BM-FIX-01 + BM-FIX-02
 * (v1.6.1 and v1.6.2) — but nothing in the build prevented the same
 * class of bug from recurring on every future widget. This linter
 * closes that gap.
 *
 * Design notes — ROADMAP §3 G8 line-by-line:
 *  1. Scan src/lib/**\/*.js for string literals matching the better_map-
 *     prefix; collect into JS_CLASSES.
 *  2. Parse visualization.css for class selectors; collect into CSS_CLASSES.
 *  3. MISSING = JS_CLASSES − CSS_CLASSES − ALLOWLIST. Fail on non-empty.
 *  4. Provide a clear remediation hint per missing class.
 *  5. Reverse direction (dead CSS) emitted at WARN level only; does not
 *     fail the build but feeds G3 upgrade hygiene.
 *  6. Same scan also runs against formatter.html / any *.html in the viz
 *     dir (custom-viz formatter chrome uses better_map-* classes too).
 *
 * Implementation notes — no new npm deps:
 *  - File walk: fs.readdirSync recursive (Node 20 supports `recursive:
 *    true`; we fall back to a manual recursive walk to keep Node 18
 *    compatibility for CI).
 *  - JS scan: a single regex pass over the file contents catches every
 *    'better_map-foo', "better_map-foo", `better_map-foo`, and
 *    `better_map-foo bar` (multiple classes in one string). False
 *    negatives: dynamic template-literal interpolation like
 *    `better_map-${variant}` — these MUST be added to the allowlist with
 *    a wildcard suffix.
 *  - CSS scan: regex-extracts class selectors `\.better_map-[a-z0-9_-]+`.
 *    No PostCSS dependency. The CSS in this project is hand-authored
 *    and conventional; if we ever adopt a preprocessor or @apply
 *    directives, swap to PostCSS.
 *
 * Exit codes:
 *   0  — contract holds (PASS, with optional WARNs for dead CSS)
 *   1  — contract violated (FAIL; prints missing-classes table)
 *   2  — internal error (file not found, regex throw, etc.)
 *
 * Usage:
 *   node scripts/lint-js-css-contract.js [--json] [--no-warn-dead-css]
 */

'use strict';

const fs = require('fs');
const path = require('path');

// ---------------------------------------------------------------------------
// Paths — all relative to repo root (script runs from anywhere).
// ---------------------------------------------------------------------------

const REPO_ROOT = path.resolve(__dirname, '..');
const VIZ_DIR = path.join(
    REPO_ROOT,
    'better_map/appserver/static/visualizations/better_map'
);
const JS_SRC_DIR = path.join(VIZ_DIR, 'src');
const CSS_FILE = path.join(VIZ_DIR, 'visualization.css');
const ALLOWLIST_FILE = path.join(REPO_ROOT, 'scripts/css-contract-allowlist.json');

// ---------------------------------------------------------------------------
// Regex contracts.
//   CLASS_BODY_RE — matches the class name portion (no leading `.` or quote);
//                   used for both JS literal extraction and CSS selector
//                   extraction. A class name in this project is always:
//                     'better_map-' lowercase letters/digits/underscore/hyphen
//                   No camelCase, no uppercase, no escaped characters.
// ---------------------------------------------------------------------------

const CLASS_BODY_RE = /better_map-[a-z][a-z0-9_-]*/g;
const CSS_CLASS_SELECTOR_RE = /\.(better_map-[a-z][a-z0-9_-]*)/g;
const TEMPLATE_INTERP_RE = /better_map-[a-zA-Z0-9_-]*\$\{/g;

// ---------------------------------------------------------------------------
// CLI flag parsing — minimal, no commander.
// ---------------------------------------------------------------------------

const argv = process.argv.slice(2);
const FLAGS = {
    json: argv.includes('--json'),
    noWarnDeadCss: argv.includes('--no-warn-dead-css'),
    quiet: argv.includes('--quiet'),
};

// ---------------------------------------------------------------------------
// File walking.
// ---------------------------------------------------------------------------

/**
 * Recursively collect files under `root` whose basename matches any of the
 * given extensions. Symlinks and node_modules / dist are skipped.
 *
 * @param {string} root - absolute directory path
 * @param {string[]} extensions - e.g. ['.js'] or ['.html']
 * @returns {string[]} absolute file paths
 */
function walkFiles(root, extensions) {
    const out = [];
    if (!fs.existsSync(root)) return out;
    const stack = [root];
    while (stack.length) {
        const dir = stack.pop();
        let entries;
        try {
            entries = fs.readdirSync(dir, { withFileTypes: true });
        } catch (_err) {
            continue;
        }
        for (const entry of entries) {
            if (entry.name === 'node_modules' || entry.name === 'dist') continue;
            const full = path.join(dir, entry.name);
            if (entry.isDirectory()) {
                stack.push(full);
            } else if (entry.isFile()) {
                if (extensions.some((ext) => entry.name.endsWith(ext))) {
                    out.push(full);
                }
            }
        }
    }
    return out;
}

// ---------------------------------------------------------------------------
// JS / HTML scan — collect every `better_map-*` class name appearing as a
// string literal anywhere in the source. Also detect template-literal
// interpolation patterns and report them separately so the allowlist
// can pick them up explicitly.
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   classes: Map<string, Set<string>>,   // class name -> set of source files referencing it
 *   interpolations: Map<string, Set<string>>, // prefix -> source files (false-positive risk surface)
 * }}
 */
function scanSources() {
    const classes = new Map();
    const interpolations = new Map();

    const jsFiles = walkFiles(JS_SRC_DIR, ['.js']);
    const htmlFiles = walkFiles(VIZ_DIR, ['.html']).filter(
        // Avoid double-scanning the same files if html lives under src/.
        // viz_dir/*.html top-level files are formatter.html etc.
        (p) => !p.includes(`${path.sep}node_modules${path.sep}`)
    );
    const allFiles = [...jsFiles, ...htmlFiles];

    for (const file of allFiles) {
        const rel = path.relative(REPO_ROOT, file);
        let body;
        try {
            body = fs.readFileSync(file, 'utf8');
        } catch (_err) {
            continue;
        }

        // Strip JS / HTML comments first so JSDoc placeholders like
        //     better_map-scrubber__anomaly--<level>
        // don't end up in the JS_CLASSES set. We strip /* ... */ blocks
        // and // line comments for .js files, and <!-- ... --> for html.
        // We do NOT attempt to be JS-grammar-aware (no AST); the regex
        // strip is a deliberate compromise: it can technically erase
        // class names that appear inside template literals containing the
        // sequence `//` or `/*`. In practice this never happens in our
        // codebase, and adding an AST step would mean a babel/acorn dep.
        let stripped = body;
        if (file.endsWith('.js')) {
            stripped = stripJsComments(body);
        } else if (file.endsWith('.html')) {
            stripped = body.replace(/<!--[\s\S]*?-->/g, '');
        }

        // Template-literal interpolations: `better_map-${variant}` — these
        // produce class names the static scanner cannot know. Surface them
        // so a human can add an explicit allowlist entry.
        const interpMatches = stripped.match(TEMPLATE_INTERP_RE) || [];
        for (const m of interpMatches) {
            const prefix = m.replace(/\$\{$/, '');
            if (!interpolations.has(prefix)) interpolations.set(prefix, new Set());
            interpolations.get(prefix).add(rel);
        }

        // Static literal scan.
        const matches = stripped.match(CLASS_BODY_RE) || [];
        for (const cls of matches) {
            if (!classes.has(cls)) classes.set(cls, new Set());
            classes.get(cls).add(rel);
        }
    }

    return { classes, interpolations };
}

/**
 * Strip JS comments from a source string. Handles `/* ... *\/` block
 * comments and `// ...\n` line comments. Comments inside string literals
 * or regex literals are NOT preserved (we accept the rare false-negative
 * to avoid an AST dependency).
 *
 * @param {string} source
 * @returns {string}
 */
function stripJsComments(source) {
    // Block comments first (greedy non-greedy across newlines).
    let out = source.replace(/\/\*[\s\S]*?\*\//g, '');
    // Then line comments — anchor at the start or after a newline / whitespace
    // so we don't chop URLs like https:// inside a string literal.
    out = out.replace(/(^|[^:\\])\/\/[^\n\r]*/g, '$1');
    return out;
}

// ---------------------------------------------------------------------------
// CSS scan — collect every class selector. Strips CSS comments first so
// commented-out selectors (`/* .better_map-old { ... } */`) don't get
// counted as live rules.
// ---------------------------------------------------------------------------

/**
 * @returns {Set<string>}
 */
function scanCss() {
    if (!fs.existsSync(CSS_FILE)) {
        throw new Error(`CSS file not found at ${CSS_FILE}`);
    }
    const raw = fs.readFileSync(CSS_FILE, 'utf8');
    // Strip /* ... */ block comments (CSS has no // line comments).
    const stripped = raw.replace(/\/\*[\s\S]*?\*\//g, '');
    const found = new Set();
    let m;
    while ((m = CSS_CLASS_SELECTOR_RE.exec(stripped)) !== null) {
        found.add(m[1]);
    }
    return found;
}

// ---------------------------------------------------------------------------
// Allowlist — JSON with shape:
//   {
//     "intentionallyInheritanceOnly": ["better_map-foo"],
//     "stateToggleModifiers": ["better_map-foo--active"],
//     "dynamicPrefixes": ["better_map-layer-"]
//   }
// All three keys are optional. Wildcards are NOT supported in the literal
// arrays; if a class is created dynamically as `better_map-${var}` then
// the static-prefix string up to (and excluding) the interpolation MUST
// appear in `dynamicPrefixes`, and the linter will accept any class
// whose name STARTS with that prefix.
// ---------------------------------------------------------------------------

/**
 * @returns {{
 *   literal: Set<string>,    // exact class names
 *   prefixes: string[],      // dynamic-prefix entries
 *   raw: object,             // raw JSON for reporting
 * }}
 */
function loadAllowlist() {
    if (!fs.existsSync(ALLOWLIST_FILE)) {
        return { literal: new Set(), prefixes: [], raw: {} };
    }
    let raw;
    try {
        raw = JSON.parse(fs.readFileSync(ALLOWLIST_FILE, 'utf8'));
    } catch (err) {
        throw new Error(
            `Allowlist file is not valid JSON: ${ALLOWLIST_FILE}\n  ${err.message}`
        );
    }
    const literal = new Set();
    for (const arrKey of ['intentionallyInheritanceOnly', 'stateToggleModifiers']) {
        const arr = raw[arrKey] || [];
        if (!Array.isArray(arr)) {
            throw new Error(
                `Allowlist key "${arrKey}" must be an array of strings`
            );
        }
        for (const cls of arr) literal.add(cls);
    }
    const prefixes = raw.dynamicPrefixes || [];
    if (!Array.isArray(prefixes)) {
        throw new Error('Allowlist key "dynamicPrefixes" must be an array of strings');
    }
    return { literal, prefixes, raw };
}

/**
 * Test whether a class name is allowed because it matches a dynamic prefix.
 */
function matchesPrefix(cls, prefixes) {
    for (const p of prefixes) {
        if (cls.startsWith(p)) return true;
    }
    return false;
}

// ---------------------------------------------------------------------------
// Reporting helpers.
// ---------------------------------------------------------------------------

const ANSI = {
    red: (s) => `\x1b[31m${s}\x1b[0m`,
    yellow: (s) => `\x1b[33m${s}\x1b[0m`,
    green: (s) => `\x1b[32m${s}\x1b[0m`,
    grey: (s) => `\x1b[90m${s}\x1b[0m`,
    bold: (s) => `\x1b[1m${s}\x1b[0m`,
};

function printHumanReport({
    jsClasses,
    cssClasses,
    allowlist,
    missingInCss,
    deadCss,
    interpolations,
}) {
    const total = jsClasses.classes.size;
    const cssTotal = cssClasses.size;
    const allowTotal = allowlist.literal.size + allowlist.prefixes.length;

    console.log(ANSI.bold('G8 — JS↔CSS contract lint'));
    console.log(
        `  JS classes:        ${total} unique  (in ${countJsFiles(jsClasses)} source files)`
    );
    console.log(`  CSS classes:       ${cssTotal} unique`);
    console.log(
        `  Allowlist:         ${allowlist.literal.size} literal, ${allowlist.prefixes.length} dynamic-prefix`
    );
    if (interpolations.size > 0) {
        console.log(
            `  Template-interp:   ${interpolations.size} prefix(es) found — must be in dynamicPrefixes`
        );
    }
    console.log('');

    if (missingInCss.length === 0) {
        console.log(ANSI.green('  PASS — every JS class has a CSS rule or is allowlisted.'));
    } else {
        console.log(
            ANSI.red(
                `  FAIL — ${missingInCss.length} JS class(es) have no CSS rule and no allowlist entry:`
            )
        );
        console.log('');
        for (const { name, files } of missingInCss) {
            console.log(`    ${ANSI.red('•')} ${ANSI.bold(name)}`);
            const first3 = [...files].slice(0, 3);
            for (const f of first3) console.log(`        ${ANSI.grey(f)}`);
            if (files.size > 3) {
                console.log(`        ${ANSI.grey(`... and ${files.size - 3} more file(s)`)}`);
            }
        }
        console.log('');
        console.log(`  Remediation, pick ONE:`);
        console.log(
            `    a) Add a rule in ${ANSI.bold('visualization.css')} for each class above`
        );
        console.log(
            `       (even a one-liner like ".classname { position: relative; }" satisfies the lint)`
        );
        console.log(
            `    b) Add the class to ${ANSI.bold('scripts/css-contract-allowlist.json')}`
        );
        console.log(
            `       under "intentionallyInheritanceOnly" or "stateToggleModifiers"`
        );
        console.log(
            `       with a comment explaining why no CSS rule is needed.`
        );
    }

    if (!FLAGS.noWarnDeadCss && deadCss.length > 0) {
        console.log('');
        console.log(
            ANSI.yellow(
                `  WARN — ${deadCss.length} CSS class(es) defined but never referenced in JS or HTML:`
            )
        );
        const sample = deadCss.slice(0, 10);
        for (const cls of sample) {
            console.log(`    ${ANSI.yellow('•')} ${cls}`);
        }
        if (deadCss.length > sample.length) {
            console.log(`    ... and ${deadCss.length - sample.length} more`);
        }
        console.log(
            ANSI.grey(
                `  (this is a non-blocking warning; dead CSS may indicate an orphaned widget — feeds G3)`
            )
        );
    }
}

function printJsonReport(report) {
    const out = {
        ...report,
        missingInCss: report.missingInCss.map(({ name, files }) => ({
            name,
            files: [...files],
        })),
        interpolations: [...report.interpolations.entries()].map(([prefix, files]) => ({
            prefix,
            files: [...files],
        })),
        jsClassCount: report.jsClasses.classes.size,
        cssClassCount: report.cssClasses.size,
    };
    delete out.jsClasses;
    delete out.cssClasses;
    delete out.allowlist;
    console.log(JSON.stringify(out, null, 2));
}

function countJsFiles({ classes }) {
    const files = new Set();
    for (const set of classes.values()) for (const f of set) files.add(f);
    return files.size;
}

// ---------------------------------------------------------------------------
// Main.
// ---------------------------------------------------------------------------

function main() {
    const jsScan = scanSources();
    const cssClasses = scanCss();
    const allowlist = loadAllowlist();

    // MISSING = JS_CLASSES − CSS_CLASSES − ALLOWLIST(literal) − ALLOWLIST(prefix)
    const missingInCss = [];
    for (const [cls, files] of jsScan.classes.entries()) {
        if (cssClasses.has(cls)) continue;
        if (allowlist.literal.has(cls)) continue;
        if (matchesPrefix(cls, allowlist.prefixes)) continue;
        missingInCss.push({ name: cls, files });
    }
    missingInCss.sort((a, b) => a.name.localeCompare(b.name));

    // Dead CSS — informational only. A class is dead if it appears in CSS
    // but is not referenced in any JS/HTML source AND is not allowlisted
    // (the allowlist sometimes points the other way too, e.g. for classes
    // applied externally by Splunk Web).
    const deadCss = [];
    for (const cls of cssClasses) {
        if (jsScan.classes.has(cls)) continue;
        if (allowlist.literal.has(cls)) continue;
        if (matchesPrefix(cls, allowlist.prefixes)) continue;
        deadCss.push(cls);
    }
    deadCss.sort();

    const report = {
        jsClasses: jsScan,
        cssClasses,
        allowlist,
        missingInCss,
        deadCss,
        interpolations: jsScan.interpolations,
        status: missingInCss.length === 0 ? 'PASS' : 'FAIL',
    };

    if (FLAGS.json) {
        printJsonReport(report);
    } else if (!FLAGS.quiet) {
        printHumanReport(report);
    }

    return missingInCss.length === 0 ? 0 : 1;
}

try {
    process.exit(main());
} catch (err) {
    console.error(ANSI.red('G8 lint — internal error:'));
    console.error(`  ${err.message}`);
    if (err.stack && process.env.G8_DEBUG) console.error(err.stack);
    process.exit(2);
}
