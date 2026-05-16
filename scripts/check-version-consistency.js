#!/usr/bin/env node
/*
 * REL-1 — Version-consistency check (ROADMAP §3 G2).
 *
 * Goal: assert that the three version fields better_map ships in agree.
 *       Mismatch between them is a recurring root cause of confusing
 *       support tickets ("the dashboard shows v1.6.0 in the HUD but the
 *       UI lists v1.6.2 in Settings → Apps") and is exactly the failure
 *       mode that produced the v1.6.0 → v1.6.1 → v1.6.2 patch chain.
 *
 * Authoritative quote from ROADMAP §3 G2:
 *   "Version bump policy: SemVer is binding. Patch = bugfix only;
 *    minor = additive features (default off); major = breaking. The
 *    app.conf version, package.json version, and HUD_VERSION must
 *    match — assert in CI."
 *
 * Three version sources:
 *
 *   1. better_map/default/app.conf
 *        - [launcher] version = X.Y.Z       (SemVer; user-visible in Apps UI)
 *        - [install]  build   = N           (monotonic integer; cache-bust)
 *   2. better_map/appserver/static/visualizations/better_map/package.json
 *        - "version": "X.Y.Z"                (matches launcher.version)
 *   3. better_map/appserver/static/visualizations/better_map/src/lib/debugHud.js
 *        - const HUD_VERSION = 'vX.Y.Z';     (matches launcher.version with v-prefix)
 *
 * When invoked WITHOUT --tag the script just checks that the three
 * sources agree with each other. This is the PR-gate mode and runs on
 * every push to a feature branch.
 *
 * When invoked WITH --tag=vX.Y.Z (passed by the release workflow before
 * cutting a GitHub Release) the script ALSO requires that the tag's
 * semver (sans `v` prefix) matches all three sources. This catches the
 * "I tagged v1.7.0 but forgot to bump app.conf" failure mode at the
 * tag-push step, BEFORE the release artifacts are built.
 *
 * Exit codes:
 *   0  PASS  (all sources agree; tag agrees too if --tag was passed)
 *   1  FAIL  (any disagreement)
 *   2  internal error (file missing, regex didn't match, etc)
 *
 * Zero new dependencies; pure Node + regex.
 */

'use strict';

const fs = require('fs');
const path = require('path');

const REPO_ROOT = path.resolve(__dirname, '..');
const APP_CONF = path.join(REPO_ROOT, 'better_map', 'default', 'app.conf');
const VIZ_PKG = path.join(
    REPO_ROOT,
    'better_map',
    'appserver',
    'static',
    'visualizations',
    'better_map',
    'package.json',
);
const DEBUG_HUD = path.join(
    REPO_ROOT,
    'better_map',
    'appserver',
    'static',
    'visualizations',
    'better_map',
    'src',
    'lib',
    'debugHud.js',
);

// -----------------------------------------------------------------------------
// Parse CLI args.
// -----------------------------------------------------------------------------
const args = process.argv.slice(2);
let tagArg = null;
for (const a of args) {
    if (a.startsWith('--tag=')) {
        tagArg = a.slice('--tag='.length);
    } else if (a === '--help' || a === '-h') {
        printUsage();
        process.exit(0);
    } else if (a.startsWith('-')) {
        console.error('Unknown argument: ' + a);
        printUsage();
        process.exit(2);
    }
}

function printUsage() {
    console.log('Usage:');
    console.log('  node scripts/check-version-consistency.js [--tag=vX.Y.Z]');
    console.log('');
    console.log(
        'Without --tag: assert app.conf, package.json, and HUD_VERSION agree.',
    );
    console.log(
        'With --tag=vX.Y.Z: also assert the tag matches the three sources.',
    );
}

// -----------------------------------------------------------------------------
// Extractors.
// -----------------------------------------------------------------------------

const SEMVER_RE = /^[0-9]+\.[0-9]+\.[0-9]+$/;

/**
 * Read app.conf [launcher] version and [install] build values.
 * Naive .ini-style parser; sufficient for our well-formed app.conf.
 */
function readAppConfVersions() {
    const text = fs.readFileSync(APP_CONF, 'utf8');
    let currentSection = null;
    let launcherVersion = null;
    let installBuild = null;
    for (const rawLine of text.split('\n')) {
        const line = rawLine.trim();
        if (line.length === 0 || line.startsWith('#')) {
            continue;
        }
        const sectionMatch = line.match(/^\[(.+?)\]$/);
        if (sectionMatch) {
            currentSection = sectionMatch[1];
            continue;
        }
        const kvMatch = line.match(/^([A-Za-z_][A-Za-z0-9_]*)\s*=\s*(.+?)\s*$/);
        if (!kvMatch) {
            continue;
        }
        const key = kvMatch[1];
        const value = kvMatch[2];
        if (currentSection === 'launcher' && key === 'version') {
            launcherVersion = value;
        } else if (currentSection === 'install' && key === 'build') {
            installBuild = value;
        }
    }
    return {launcherVersion, installBuild};
}

/**
 * Read package.json `version` field. We deliberately parse with JSON.parse
 * rather than a regex so any malformed JSON fails loudly here.
 */
function readPackageJsonVersion() {
    const text = fs.readFileSync(VIZ_PKG, 'utf8');
    const pkg = JSON.parse(text);
    return pkg.version || null;
}

/**
 * Read HUD_VERSION constant from debugHud.js.
 */
function readHudVersion() {
    const text = fs.readFileSync(DEBUG_HUD, 'utf8');
    // Match: const HUD_VERSION = 'vX.Y.Z';  (single or double quotes)
    const match = text.match(/const\s+HUD_VERSION\s*=\s*['"]([^'"]+)['"]/);
    if (!match) {
        throw new Error(
            'Could not find `const HUD_VERSION = ...` in ' +
                path.relative(REPO_ROOT, DEBUG_HUD),
        );
    }
    return match[1];
}

/**
 * Strip leading `v` from a version string. Returns null if input is null.
 */
function stripVPrefix(s) {
    if (s == null) {
        return null;
    }
    return s.startsWith('v') ? s.slice(1) : s;
}

// -----------------------------------------------------------------------------
// Report.
// -----------------------------------------------------------------------------

function pad(s, n) {
    return String(s == null ? '<missing>' : s).padEnd(n);
}

function main() {
    console.log('REL-1 — version-consistency check\n');

    const {launcherVersion, installBuild} = readAppConfVersions();
    const pkgVersion = readPackageJsonVersion();
    const hudVersion = readHudVersion();

    const launcherClean = launcherVersion;
    const pkgClean = pkgVersion;
    const hudClean = stripVPrefix(hudVersion);
    const tagClean = stripVPrefix(tagArg);

    // Print a compact table.
    const nameW = 36;
    const rawW = 16;
    const cleanW = 12;
    console.log(
        'source'.padEnd(nameW) +
            'raw value'.padEnd(rawW) +
            'as semver'.padEnd(cleanW),
    );
    console.log('-'.repeat(nameW + rawW + cleanW));
    console.log(
        pad('app.conf [launcher] version', nameW) +
            pad(launcherVersion, rawW) +
            pad(launcherClean, cleanW),
    );
    console.log(
        pad('app.conf [install]  build', nameW) +
            pad(installBuild, rawW) +
            pad('(N/A)', cleanW),
    );
    console.log(
        pad('package.json "version"', nameW) +
            pad(pkgVersion, rawW) +
            pad(pkgClean, cleanW),
    );
    console.log(
        pad('debugHud.js HUD_VERSION', nameW) +
            pad(hudVersion, rawW) +
            pad(hudClean, cleanW),
    );
    if (tagArg) {
        console.log(
            pad('--tag (release input)', nameW) +
                pad(tagArg, rawW) +
                pad(tagClean, cleanW),
        );
    }
    console.log('');

    const failures = [];

    // Semver shape checks.
    if (!launcherClean || !SEMVER_RE.test(launcherClean)) {
        failures.push(
            'app.conf [launcher] version "' +
                launcherClean +
                '" is not a SemVer X.Y.Z',
        );
    }
    if (!pkgClean || !SEMVER_RE.test(pkgClean)) {
        failures.push(
            'package.json "version" "' +
                pkgClean +
                '" is not a SemVer X.Y.Z',
        );
    }
    if (!hudClean || !SEMVER_RE.test(hudClean)) {
        failures.push(
            'debugHud.js HUD_VERSION "' +
                hudClean +
                '" is not a SemVer X.Y.Z (with v-prefix)',
        );
    }
    if (!installBuild || !/^[0-9]+$/.test(installBuild)) {
        failures.push(
            'app.conf [install] build "' +
                installBuild +
                '" is not a positive integer',
        );
    }
    if (tagArg && (!tagClean || !SEMVER_RE.test(tagClean))) {
        failures.push(
            '--tag "' + tagArg + '" is not vX.Y.Z',
        );
    }

    // Cross-source agreement.
    const triple = [launcherClean, pkgClean, hudClean];
    const uniqueTriple = Array.from(new Set(triple));
    if (uniqueTriple.length > 1) {
        failures.push(
            'three sources disagree (launcher / package.json / HUD_VERSION):' +
                ' [' +
                triple.join(' | ') +
                ']',
        );
    }

    // Tag vs triple (only when --tag was passed).
    if (tagClean) {
        if (launcherClean && tagClean !== launcherClean) {
            failures.push(
                'tag (' +
                    tagClean +
                    ') does not match app.conf launcher.version (' +
                    launcherClean +
                    ')',
            );
        }
        if (pkgClean && tagClean !== pkgClean) {
            failures.push(
                'tag (' +
                    tagClean +
                    ') does not match package.json version (' +
                    pkgClean +
                    ')',
            );
        }
        if (hudClean && tagClean !== hudClean) {
            failures.push(
                'tag (' +
                    tagClean +
                    ') does not match HUD_VERSION (' +
                    hudClean +
                    ')',
            );
        }
    }

    if (failures.length === 0) {
        if (tagClean) {
            console.log(
                'PASS — all four version sources agree on ' + tagClean + '.',
            );
        } else {
            console.log(
                'PASS — three version sources agree on ' + launcherClean + '.',
            );
        }
        return 0;
    }

    console.log('FAIL — version consistency violations:');
    for (const f of failures) {
        console.log('  - ' + f);
    }
    console.log('');
    console.log('Fix all four (or three, if not releasing) of these files:');
    console.log(
        '  - ' + path.relative(REPO_ROOT, APP_CONF) + ' ([launcher] version)',
    );
    console.log(
        '  - ' + path.relative(REPO_ROOT, VIZ_PKG) + ' ("version")',
    );
    console.log(
        '  - ' + path.relative(REPO_ROOT, DEBUG_HUD) + ' (const HUD_VERSION)',
    );
    if (tagClean) {
        console.log('  - the git tag itself (vX.Y.Z)');
    }
    return 1;
}

try {
    process.exit(main());
} catch (err) {
    console.error('check-version-consistency: internal error');
    console.error(err && err.stack ? err.stack : err);
    process.exit(2);
}
