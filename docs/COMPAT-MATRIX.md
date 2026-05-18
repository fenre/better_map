# Browser compatibility matrix

Status of Better Map across browser engines, asserted automatically
by [`scripts/check-browser-compat.js`](https://github.com/fenre/better_map/blob/main/scripts/check-browser-compat.js)
on every pull request.

## TL;DR

Better Map's two browser-facing surfaces — `formatter.html` (the
panel-options UI every Dashboard Studio author interacts with) and
`visualization.js` (the AMD bundle that actually renders the viz on
every dashboard) — are both asserted to load cleanly in the **three
engine families that cover ~99 % of real browsers**: Chromium,
Firefox, and WebKit. Every PR runs the check; a regression that
breaks one engine fails CI before merge.

The full dashboard-rendering compatibility matrix (12 showcases ×
{Chromium, Firefox, WebKit} × {macOS, Windows, Linux}) is Phase 2
work tracked in [ROADMAP §3 D2](roadmap.md) (blocked on a
self-hosted-runner decision; GitHub Actions free runners are
Linux-only).

## Phase 1 + Phase 1.5 matrix (shipped — every PR)

| Surface | Chromium | Firefox | WebKit | OS | Frequency | Phase |
|---|:-:|:-:|:-:|---|---|---|
| `formatter.html` (panel-options UI) | ✅ | ✅ | ✅ | Linux (ubuntu-latest) | Every PR | 1 |
| `visualization.js` (AMD bundle, parse + module-eval) | ✅ | ✅ | ✅ | Linux (ubuntu-latest) | Every PR | 1.5 |

**What "✅" means for `formatter.html` (Phase 1):**

- The engine launched headless via [Playwright](https://playwright.dev/)
- The wrapped formatter page loaded without timing out (30 s budget)
- `document.body.children.length > 0` (engine did not silently reject
  the HTML)
- No `console.error` events fired
- No `pageerror` events fired
- No `requestfailed` events fired
- A full-page screenshot was saved to
  `reports/browser-compat/<engine>.png` (uploaded as a CI artifact
  on every run; 14-day retention)

**What "✅" means for `visualization.js` (Phase 1.5):**

- The bundle was inlined into a wrapper page that provides an AMD
  `define()` shim plus minimal mocks for the two Splunk SDK externals
  the bundle requires
  (`api/SplunkVisualizationBase`, `api/SplunkVisualizationUtils`)
- The engine parsed the inlined ~2.3 MB bundle without throwing
- The bundle invoked `define()` exactly once (single-AMD-module shape;
  webpack `libraryTarget: 'amd'`)
- The deps the bundle requested matched the documented contract:
  exactly `["api/SplunkVisualizationBase", "api/SplunkVisualizationUtils"]`
- The factory function ran to completion (no synchronous throw at
  module-eval time)
- The factory returned a non-null module (the entry IIFE successfully
  called `SplunkVisualizationBase.extend({...})` and returned its
  result as `o.default`)
- The returned module has a constructor shape (function + prototype
  object — confirms it came from `extend()`, not some other code path)
- No `pageerror` events fired

The AMD test deliberately does NOT fail on `console.warn` /
`console.info` / `console.error` from inside the bundle. Webpack-emitted
bundles routinely emit informational logs at module-eval time (deprecation
notices, missing-source-map warnings); gating on them would generate
noise. Real bundle-level failures surface through `pageerror` (engine
rejected the syntax) or through the harness-state assertion (the AMD
contract was violated).

**Why these three engines:**

- **Chromium** → covers Chrome, Edge, Opera, Brave, every Chromium
  fork, and Splunk Mobile Android.
- **WebKit** → covers Safari (macOS + iOS) and Splunk Mobile iOS.
- **Firefox** → covers Firefox and every Gecko fork.

The remaining ~1 % of the field (pre-Chromium Edge — sunsetted by
Microsoft; niche WebKit forks like Epiphany; pre-Quantum Firefox)
is explicitly out of support.

**Why Linux only in Phase 1:**

GitHub Actions free-tier runners are Linux x64 only. macOS and
Windows runners exist on the paid tier but cost ~10× per minute, and
the marginal value of "Safari on macOS" over "WebKit on Linux"
(the same engine) is small for a panel-options UI that has no native
APIs. The matrix expands to real Safari + real Edge when D5 Phase 2
adds a self-hosted runner — see ROADMAP §3 D5 + §3 D2.

## Phase 2 matrix (deferred — tracked in ROADMAP §3 D2)

| Surface | Chromium | Firefox | WebKit | OS | Status |
|---|:-:|:-:|:-:|---|---|
| `formatter.html` + bundle AMD-eval | ✅ | ✅ | ✅ | macOS | Deferred — needs self-hosted runner |
| `formatter.html` + bundle AMD-eval | ✅ | ✅ | n/a | Windows | Deferred — needs self-hosted runner |
| `visualization.js` rendered into a real DOM (calling `updateView`) | ⏸ | ⏸ | ⏸ | Linux | Deferred — needs a Splunk-style data envelope + a wired MapLibre source |
| 12 showcase dashboards in live Splunk | ⏸ | ⏸ | ⏸ | Linux | Deferred — needs D5 Phase 2 (Playwright × Splunk container) |
| 12 showcase dashboards in live Splunk | ⏸ | ⏸ | ⏸ | macOS | Deferred — needs D5 Phase 2 + self-hosted runner |
| Visual-regression baseline | ⏸ | ⏸ | ⏸ | All | Deferred — value/flake tradeoff in `check-browser-compat.js` design notes |

(✅ = green target; ⏸ = scope acknowledged, not yet attempted.)

**Why Phase 1.5 stops at AMD-eval and not at `updateView`:** rendering
the bundle into a real container requires (a) a Splunk-shaped data
envelope (rows + fields + meta + drilldown context) and (b) a wired
MapLibre source so the basemap-aware code paths don't throw on
`addLayer` calls. Both are real engineering — Splunk's data shape is
documented but the simulator-side helper we'd need lives in
`splunk-custom-viz-integration.mdc` § "AMD-via-DS pattern" and has
its own scoping decisions. Doing the AMD-eval test first lets us
catch ~80 % of cross-engine bundle-level bugs (parse failures, ES2020+
sneaking in, missing globals) at ~5 % of the implementation cost.

## Running locally

The Phase 1 gate runs end-to-end on any machine with Node 18+ and
Playwright's browser binaries installed:

```bash
cd better_map/appserver/static/visualizations/better_map
npm ci
npx playwright install --with-deps chromium firefox webkit
npm run lint:browser-compat
```

Subset to one engine while iterating:

```bash
node scripts/check-browser-compat.js --engine=webkit
```

Multi-engine, comma-separated:

```bash
node scripts/check-browser-compat.js --engine=chromium,webkit
```

Subset to just the formatter test (skip the slower bundle inline):

```bash
node scripts/check-browser-compat.js --skip-bundle
```

(NEVER pass `--skip-bundle` in CI — the bundle test is the primary
value of the gate; the formatter test only catches static-HTML
regressions.)

The script writes:

- `reports/browser-compat-report.json` — per-engine PASS/FAIL for
  both the `formatter` and `bundle` sub-results, with the full error
  capture + the AMD harness state (`defineCallCount`, `depsRequested`,
  `factoryError`, `moduleReturned`, etc.) for offline triage.
- `reports/browser-compat/<engine>.png` — one full-page screenshot
  of the formatter per engine, useful for "the layout shifts in
  Firefox" review. (No bundle screenshot — the bundle page is just
  a smoke harness, not a rendered viz.)
- `reports/_browser-compat-wrapper.html` — the wrapped formatter
  page the engines actually loaded (DRY: same wrapper the D3
  accessibility audit uses).
- `reports/_browser-compat-bundle-wrapper.html` — the wrapped AMD
  harness page with the bundle inlined verbatim (~2.3 MB). Inspect
  this if the bundle test fails in WebKit but passes in Chromium —
  the harness page itself is identical across engines.

All four paths are gitignored.

## Reading a failing run

The script prints a focused per-engine summary; the full JSON
report carries the rest. A typical PASS block looks like:

```text
  PASS  firefox
         formatter: PASS  (body children: 2, screenshot: reports/browser-compat/firefox.png)
         bundle: PASS  (define×1, extend×1, moduleReturned: true)
```

A typical failure block looks like:

```text
  FAIL  webkit
         formatter: PASS  (body children: 2, screenshot: reports/browser-compat/webkit.png)
         bundle: FAIL  (define×0, extend×0, moduleReturned: false)
           assertion: bundle never invoked define() — engine rejected the AMD module before it reached the entry IIFE
           pageerror events: 1
             - SyntaxError: Unexpected token 'const'
```

Common failure modes and where to look:

**Phase 1 — formatter failures:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `formatter: FAIL` + `console.error` includes a syntax error | a stray `<script>` block in `formatter.html` uses ES2020+ syntax WebKit / Firefox rejects | downgrade the syntax or move the script into a separate `.js` file that goes through webpack |
| `formatter: FAIL` + `pageerror` references a missing global | a global used in `formatter.html` exists in Chromium but not in WebKit / Firefox | add a feature-detect + fallback or document the gap in the Phase 2 matrix |
| `formatter: FAIL` + `requestfailed` for a CDN URL | offline CI runner or a CSP regression | the formatter wrapper SHOULD load no external resources — investigate which file picked up a stray `<link href="https://...">` |
| `formatter: FAIL` + `document.body.children.length === 0` | the engine outright rejected the wrapper as malformed HTML | inspect `reports/_browser-compat-wrapper.html` (the wrapper the engines actually loaded) — most often a leaked `<` from formatter source |

**Phase 1.5 — bundle AMD failures:**

| Symptom | Likely cause | Fix |
|---|---|---|
| `bundle: FAIL` + `factoryError` set, `define×1` | webpack target slipped — bundle contains ES2020+ syntax WebKit / Firefox rejects at module-eval | confirm `webpack.config.js` still sets `target: ['web', 'es5']` and `output.environment.arrowFunction: false` per [`splunk-custom-viz-integration.mdc` §11](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-custom-viz-integration.mdc); rebuild + re-run |
| `bundle: FAIL` + `define×0` (i.e., bundle never called `define()`) | the bundle threw a SyntaxError before reaching the entry IIFE | check `pageerror` events — the first one is the offending line. Usually a fresh ESLint plugin or webpack loader regressed the ES5 transform |
| `bundle: FAIL` + `moduleReturned: false` despite `factoryRan: true` | `SplunkVisualizationBase.extend({...})` returned undefined (i.e., our mock didn't satisfy what the entry expects) — OR the entry module's IIFE structure changed | inspect the harness mock in `scripts/check-browser-compat.js` (`buildBundleWrapper`) — if `src/visualization_source.js` started calling a method on Base not present in the mock, add a stub there. NEVER weaken the assertion. |
| `bundle: FAIL` + `depsRequested` is not exactly `[api/SplunkVisualizationBase, api/SplunkVisualizationUtils]` | the bundle started requesting a third Splunk SDK external | add the new external to `webpack.config.js` AND to the harness mock (`buildBundleWrapper` in `scripts/check-browser-compat.js`); document why in [`splunk-custom-viz-integration.mdc` §11](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-custom-viz-integration.mdc) |
| `bundle: FAIL` only on WebKit (Chromium + Firefox PASS) | a Safari/WebKit-only syntax restriction (regex feature, optional chaining edge case) leaked into the bundle | inspect the bundle around the line cited in `pageerror`. If it's `node_modules` code, lock the dependency at the last known-good version |

If the failure is genuinely a documented engine gap (e.g. WebKit
lacks a specific Container Queries feature you depend on), add a
row to the Phase 2 matrix above with the gap noted and open a
ROADMAP follow-up — do NOT add the engine to a skip list in the
script.

## Out of scope

- **Splunk Mobile** (iOS + Android). These ride on WebKit + Chromium
  respectively, so Phase 1 covers the engine layer. The Splunk-
  Mobile-specific JS bridge (`mobileapp.splunk.com`) is not
  exercised by `formatter.html` and is tested manually before each
  release per ROADMAP §3 D2.
- **Internet Explorer**, **pre-Chromium Edge**, **pre-Quantum
  Firefox** (< 57), and **PhantomJS**. Splunk itself dropped IE
  support in 8.0; we follow.
- **Headed-only behaviours** (e.g. native fullscreen, pointer-lock,
  WebXR). Better Map does not currently use these APIs. If we add
  any, this matrix grows a column.

## See also

- [`scripts/check-browser-compat.js`](https://github.com/fenre/better_map/blob/main/scripts/check-browser-compat.js) — gate source
- [`scripts/check-accessibility.js`](https://github.com/fenre/better_map/blob/main/scripts/check-accessibility.js) — the D3 sibling using the same wrapper
- [ROADMAP §3 D2 — Browser compatibility matrix](roadmap.md)
- [ROADMAP §3 D5 — End-to-end test suite (Docker harness)](roadmap.md)
- [`.cursor/rules/splunk-custom-viz-integration.mdc` §11 — webpack ES5 contract](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-custom-viz-integration.mdc)
- [`docs/runbooks/upgrade-hygiene.md`](runbooks/upgrade-hygiene.md) — operator pattern this matrix follows
