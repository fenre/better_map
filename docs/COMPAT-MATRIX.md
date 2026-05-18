# Browser compatibility matrix

Status of Better Map across browser engines, asserted automatically
by [`scripts/check-browser-compat.js`](https://github.com/fenre/better_map/blob/main/scripts/check-browser-compat.js)
on every pull request.

## TL;DR

Better Map's `formatter.html` — the panel-options UI every Dashboard
Studio author interacts with — is asserted to load cleanly in the
**three engine families that cover ~99 % of real browsers**:
Chromium, Firefox, and WebKit. Every PR runs the check; a regression
that breaks one engine fails CI before merge.

The full dashboard-rendering compatibility matrix (12 showcases ×
{Chromium, Firefox, WebKit} × {macOS, Windows, Linux}) and the live
Splunk-hosted bundle-load test are Phase 2 work tracked in
[ROADMAP §3 D2](roadmap.md) (blocked on a self-hosted-runner
decision; GitHub Actions free runners are Linux-only).

## Phase 1 matrix (shipped — every PR)

| Surface | Chromium | Firefox | WebKit | OS | Frequency |
|---|:-:|:-:|:-:|---|---|
| `formatter.html` (panel-options UI) | ✅ | ✅ | ✅ | Linux (ubuntu-latest) | Every PR |

**What "✅" means:**

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
| `formatter.html` | ✅ | ✅ | ✅ | macOS | Deferred — needs self-hosted runner |
| `formatter.html` | ✅ | ✅ | n/a | Windows | Deferred — needs self-hosted runner |
| 12 showcase dashboards in live Splunk | ⏸ | ⏸ | ⏸ | Linux | Deferred — needs D5 Phase 2 (Playwright × Splunk container) |
| 12 showcase dashboards in live Splunk | ⏸ | ⏸ | ⏸ | macOS | Deferred — needs D5 Phase 2 + self-hosted runner |
| Visual-regression baseline | ⏸ | ⏸ | ⏸ | All | Deferred — value/flake tradeoff in `check-browser-compat.js` design notes |

(✅ = green target; ⏸ = scope acknowledged, not yet attempted.)

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

The script writes:

- `reports/browser-compat-report.json` — per-engine PASS/FAIL with
  the full error capture for offline triage.
- `reports/browser-compat/<engine>.png` — one full-page screenshot
  per engine, useful for "the layout shifts in Firefox" review.
- `reports/_browser-compat-wrapper.html` — the wrapped formatter
  page the engines actually loaded (DRY: same wrapper the D3
  accessibility audit uses).

All three paths are gitignored.

## Reading a failing run

The script prints a focused per-engine summary; the full JSON
report carries the rest. A typical failure block looks like:

```text
  FAIL  firefox  (body children: 0)
         engine-level: document.body has zero children after load — engine rejected the HTML
         console.error events: 2
           - SyntaxError: missing ) after argument list ...
```

Common failure modes and where to look:

| Symptom | Likely cause | Fix |
|---|---|---|
| `console.error` includes a syntax error | webpack target slipped — bundle contains ES2020+ syntax WebKit / Firefox rejects | confirm `webpack.config.js` still sets `target: ['web', 'es5']` and `output.environment.arrowFunction: false` per [`splunk-custom-viz-integration.mdc` §11](https://github.com/fenre/better_map/blob/main/.cursor/rules/splunk-custom-viz-integration.mdc) |
| `pageerror` references a missing global | an API used in `src/lib/**/*.js` exists in Chromium but not in WebKit / Firefox | add a feature-detect + fallback or document the gap in this file's Phase 2 row |
| `requestfailed` for a CDN URL | offline CI runner or a CSP regression | the formatter wrapper SHOULD load no external resources — investigate which file picked up a stray `<link href="https://...">` |
| `document.body.children.length === 0` | the engine outright rejected the wrapper as malformed HTML | run `cat reports/_browser-compat-wrapper.html` and visually inspect — most often a leaked `<` from formatter source |

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
