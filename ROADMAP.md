# Better Map — Roadmap to Global-Tier (v2.0 Aspiration)

> **Status:** planning document only. No code, no version bump, no release
> framing. The point of this doc is to make the gap between "best Splunk
> Dashboard Studio map viz on the market" (where v1.6 plausibly is) and
> "credibly in the conversation with kepler.gl / deck.gl / CARTO / ArcGIS"
> (where v1.6 is not) explicit, measurable, and prioritised.
>
> If we execute every milestone in this doc, the version that ships at the
> end is **v2.0.0** — and that name will, at that point, be defensible
> rather than aspirational.

---

## 1. Honest baseline (where v1.6 actually sits)

### 1a. Runtime envelope — what better_map must work inside (binding for every work-item)

These are **non-negotiable** constraints. Every work-item in §3 lives inside this envelope; anything that breaks out of it is automatically out of scope (§5).

| Constraint | What it means | What it rules out |
|---|---|---|
| **Primary runtime: Splunk Dashboard Studio v2 (JSON `version="2"` dashboards)** | The viz registers via `default/visualizations.conf` (classic stanza) and an AMD module loaded as `api/SplunkVisualizationBase`. Loaded by Dashboard Studio's panel host. | Anything that needs the Splunk Dashboard Studio v3 native-plugin format (`core.*`, `schemaVersion`, `data_contract.*` keys in `visualizations.conf`) — Splunk silently ignores the AMD bundle and shows a grey placeholder. Documented in `default/visualizations.conf` header. |
| **Stretch runtime: Splunk Web Framework (classic SimpleXML `<dashboard>` views)** | Same AMD module also loads under classic SimpleXML (`splunkjs/mvc/searchmanager` driving the viz). v1.6 dashboards under `default/data/ui/views/` are JSON Dashboard Studio; the AMD registration deliberately keeps SimpleXML compatibility. | Any reliance on Dashboard Studio's defaults / globalInputs / formatter chrome inside a SimpleXML context — features have to feature-detect the host (DS v2 vs SWF) and gracefully degrade. |
| **All source data comes from Splunk** | Every layer consumes the result of a Splunk search via `dataSources.*.options.query` (DS v2) or a `SearchManager` (SWF). No fetches to external REST APIs except basemap tiles and explicit air-gapped vector tilesets (PMTiles). | Direct calls to external geocoders, external map services other than basemap tiles, external LLMs (the AI Assistant integration C8 routes through `Splunk_AI_Assistant_Cloud` only — §5 reinforces this). |
| **Splunk Cloud CSP (`Content-Security-Policy`) is centrally managed** | We get `script-src 'self' 'unsafe-eval'`, `worker-src 'self' blob:`, `style-src 'self' 'unsafe-inline'`, `connect-src 'self'`. Customers cannot relax it. | (1) Workers from blob URLs fail on some hardened tenants → ship a `requestIdleCallback` fallback (A1 risk). (2) `connect-src 'self'` blocks direct cross-origin fetches — basemap tiles must come from an allow-listed CDN configured by the Splunk admin or via PMTiles shipped inside the app. (3) `script-src` does not allow third-party CDN scripts — every dep ships in the AMD bundle. |
| **Single AMD bundle entry per viz** | Splunk's loader registers exactly one `api/SplunkVisualizationBase` per `[stanza]` in `visualizations.conf`. | No additional script tags, no dynamic `import()` of network modules, no Service Workers. Worker bundles (A1, A5) ship as additional `.js` files in `appserver/static/visualizations/better_map/` and are loaded by `new Worker(<same-origin URL>)`. |
| **No iframes pointing outside Splunk** | Drilldowns can open new tabs within the Splunk app; iframes are not permitted to load external origins under Splunk Cloud's `frame-src` policy. | F5 collaboration backend, any embedded external map editor, any third-party widget. Bookmarks (F1) and story mode (F2) live entirely in the URL hash and Splunk KV store. |
| **Field contract = Splunk row contract** | A viz panel receives an array of rows where every row is `{fieldName: value, ...}`. Field names come from `| stats`, `| eval`, `| rename`, or lookups. There is no schema layer above SPL. | Strongly-typed field contracts cannot be enforced at compile time. Every Theme C integration ships a `_ref/<integration>/field-contract.{md,yaml}` documenting the assumed field set; D5 asserts the assumptions at runtime. |
| **Splunk Mobile is a degraded runtime** | Splunk Mobile renders Dashboard Studio panels via a stripped-down WebView. No WebGL2 guarantees, no Service Workers, no Web Workers reliably. | Theme A/B GPU features (A3, B1, F3) MUST degrade gracefully to CPU paths or hide themselves on Mobile. D2 browser matrix includes Splunk Mobile as a target. |

> **TL;DR for any contributor reading this:** if you're about to write code that fetches from outside `splunkd:8089`, opens an external window, registers a Service Worker, requires Dashboard Studio v3 plugin keys, or builds a second AMD module, **stop**. Either the work-item is out of scope (§5) or you need to find a Splunk-resident path.

### 1b. Competitive tier table

| Tier | Examples | better_map v1.6 position |
|---|---|---|
| **Splunk Dashboard Studio map vizes** | Built-in Choropleth / Marker; Maps+ for Splunk; legacy ESRI / Leaflet ports | **Likely the most capable in this category.** No competitor in this niche pairs MapLibre vector tiles + 10 layer types + time scrubber + BM-CT-1 + Splunk-platform integrations. |
| **Open-source geo-analytics** | kepler.gl, deck.gl, CesiumJS, Datashader+Bokeh, Leaflet+extensions | **Behind** on GPU compute, real glTF, terrain, globe, raster analytics, scale-tested layer perf. **Comparable** on layer breadth in the spec sheet, weaker in the implementation depth. Note: these competitors run as standalone web apps — they do NOT have to fit inside Splunk's runtime envelope (§1a), so feature-for-feature parity is not the right benchmark. |
| **Commercial geo-analytics** | CARTO, Foursquare Studio (Unfolded), ESRI ArcGIS Online, Felt, Mapbox Studio | **Not in the same league** on collaboration, raster analytics, scale, ecosystem, support model. Different product category. Same caveat: those products own their runtime and their backend; better_map owns neither. |

### 1c. Specific honest gaps in v1.6 (taken from the v1.6 self-audit and the 2026-05-16 lab deploy)

1. **8 Splunk-platform integrations are scaffolds.** ITSI, SOAR, RBA, A&I-geo, MITRE, ES notable, OT Purdue, AI Assistant — every one was authored without a live tenant on the other end. Field assumptions, REST paths, and auth flows are uncalibrated.
2. **Spatial analytics run on the JS main thread.** DBSCAN, KDE, Getis-Ord Gi*, LISA all use `density-clustering` / `simple-statistics`. Pure-JS O(n²) algorithms will freeze the UI past ~5–10k points.
3. **Scenegraph "3D" is canvas-baked sprites with bearing rotation.** Not 3D. deck.gl's `ScenegraphLayer` loads real glTF via WebGL2 instancing.
4. **MIL-STD-2525 is per-icon canvas bake via milsymbol.** Fine for hundreds; degrades at thousands. Defence-grade tools use sprite atlases + GPU instancing.
5. **Wind / flow particles are not benchmarked.** Implementation is reasonable but unverified against `mapbox-gl-particle` or kepler.gl's flow-field at 50k+ particles.
6. **No globe, no 3D terrain, no satellite imagery layer.** All table-stakes for Cesium / Mapbox / ArcGIS.
7. **No raster analytics** (NDVI, slope, hillshade, viewshed). ESRI table-stakes.
8. **No collaborative editing, no story mode, no shared bookmarks.** Felt's core differentiator.
9. **AppInspect cycle last ran on v1.0.x.** Splunk Cloud submission would need a fresh pass (D1).
10. **Repo has one git commit, one author.** No customer feedback loop yet. No telemetry. No bug backlog from real use. The roadmap below explicitly treats this as a defensibility blocker, not a vanity metric (§7).
11. **Upgrade hygiene is broken.** The 2026-05-16 deploy left two orphan dashboards (`better_map_test_install`, `bm_react_test`) from prior v1.5 installs on disk — Splunk's `update=true` REST install extracts on top of existing files but does NOT delete files absent from the new tarball. Without a v1.x → v1.y migration pass we will accumulate orphans every release. Tracked as G3.
12. **No security / supply-chain posture — CLOSED in v1.7-prep (G1).** Was: 11 direct runtime deps → 228 transitive in `node_modules`, no SBOM, no `npm audit` in CI, no signed releases, no Dependabot, no SLSA. Now: every runtime dep is gated on (a) `npm audit --omit=dev` (FAIL on high+ without an active ≤90-day waiver), (b) license-allowlist (MIT/BSD/Apache-2.0/CC0/ISC family — 186-component v1.7-prep tree passes), (c) OSV-Scanner v2.3.8 second-opinion (FAIL on high+); every tagged release additionally ships a CycloneDX 1.6 JSON SBOM and cosign keyless signatures (`.cosign.bundle`) verifiable offline against the GitHub Actions OIDC identity, plus Dependabot auto-PRs weekly for npm + github-actions. End-to-end verification: see ROADMAP §3 G1 Status block + `docs/runbooks/supply-chain.md`. SLSA provenance + in-install `cosign verify-blob` deferred to G1 Phase 2 (v1.8).
13. **No CI/CD.** Single-author repo, no branch protection, no automated changelog, no required reviews, no release automation. Tracked as G2.
14. **The JS↔CSS contract has no automated check.** Twelve v1.6 widget root classes (`better_map-geocoder`, `better_map-cmdk`, `better_map-minimap`, `better_map-draw`, `better_map-measure`, `better_map-sbs`, `better_map-tsplit`, `better_map-spatial-query`, `better_map-brush-ring`, `better_map-lasso__menu`, `better_map-popup-md`, plus the AI-chat scaffold) and nine v1.6 scrubber + popup-md sub-element classes (`__rail`, `__event`, `__anomaly`, `__reverse`, `__kpi-grid`, `__kpi-tile`, `__kpi-label`, `__kpi-value`, `__sparkline`) shipped in v1.6.0 with **zero CSS rules**. Symptom: control-panel toggles for those widgets "did nothing" because the widgets rendered behind the absolutely-positioned MapLibre canvas (`.better_map-map { position: absolute; inset: 0; }`); clicks landed on the map instead of the widget. Patched in v1.6.1 (12 root widgets, BM-FIX-01) and v1.6.2 (9 sub-elements, BM-FIX-02), same day. Root cause: nothing in the build asserts that a class created by `src/lib/**/*.js` has at least one rule in `visualization.css`. Tracked as **G8**.
15. **Smoke-deploy assumes a fixed splunkweb protocol.** The 2026-05-16 evening re-deploy of v1.6.2 discovered that `rev`'s splunkweb had silently switched from `http://:8000` to `https://:8000` between sessions (TLS handshake confirmed `CN=rev`). Any deploy script that hardcodes the protocol fails silently — the TCP connect succeeds and the HTTP request reset-by-peers. Same risk applies to port-number drift, web-SSO redirects, and Splunk Cloud CDN-prefixing of static assets. Tracked as **R11** in §8.
16. **Spatial-query token name mismatch (SPATIAL-1) — CLOSED.** Static analysis of the v1.6.2 dashboard ↔ widget wiring discovered that `better_map_spatial_analytics.xml` consumed `$better_map.spatial_query$` (the documented contract; matches `savedsearches.conf.spec` and `formatter.html` help text), but `src/lib/widgets/spatialQuery.js` defaulted to a non-namespaced `bm_spatial_filter`. The widget emitted SPL into a token that no panel consumed, so the showcase spatial-analytics dashboard's `ds_filtered` data source never received the filter — every brushed / lassoed / drawn shape was silently dropped on the dashboard side even though the widget itself worked. Fixed in v1.6.3: default tokenName aligned to `better_map.spatial_query` (no other callers depended on the old name; grep across the repo + dashboards confirmed zero references). Regression locked by **two independent layers**: (a) a dedicated unit test in `src/lib/widgets/__tests__/spatialQuery.test.js` (asserts the default tokenName + the full emit contract), and (b) a structural CI gate `scripts/check-dashboard-tokens.py` (Q-1B) that cross-checks every `$better_map.*$` token reference in any dashboard against the set of string literals in `src/lib/**/*.js` — this gate would have failed PR-time on the v1.6.0 code with a one-line `orphan token: better_map.spatial_query` message and covers ALL future widget token-emitters, not just `spatialQuery.js`. Brushing (`brushing.js`) is intentionally visual-only and emits no token; this is now documented in the file header so future contributors don't expect a phantom token. **Live verification on `rev` 2026-05-17 09:04 CEST:** v1.6.3 deployed via URL-fetch install (sidecar 192.168.12.225:8765 → splunkd 192.168.12.45:8089 → `apps/local` POST). Server-side disk SHA-256 of `/opt/splunk/etc/apps/better_map/appserver/static/visualizations/better_map/visualization.js` = `a677b4bb…05f4bcf5`, byte-identical to the locally-built bundle. `grep -c better_map.spatial_query` on the installed bundle = 1; `grep -c bm_spatial_filter` = 0; `grep -oE '\$better_map\.[A-Za-z0-9_.]+\$' better_map_spatial_analytics.xml` = `$better_map.spatial_query$` (single token, single consumer). Producer literal in installed bundle = consumer literal in installed dashboard. The static contract that drives the runtime filter is honoured end-to-end. (Visual interaction — open dashboard, draw polygon, see `ds_filtered` update — is a UX confirmation handled separately by the operator; the contract verification is complete.)
17. **Splunk Web messages-banner provenance unknown (SPLUNK-MSG-1) — CLOSED, unrelated to better_map.** **Live verification on `rev` 2026-05-17 09:00 CEST** via `GET /services/messages?output_mode=json&count=0`. Three active messages, ALL owned by `acl.app=system`, `acl.owner=system` — NONE mention `better_map`, `mapbox`, `maplibre`, or the visualization path. (a) `itsi-refresh-queue-failed-job-report` (warn): the ITSI refresh queue contains 8 failed jobs — ITSI internal. (b) `ITSI_DEFAULT_BACKUP_MESSAGE_ID` (info): ITSI default backup missing dependencies — ITSI internal. (c) `manifest_error` (warn): Splunk's `InstalledFileHashChecker` found 11 files diverging from the system-provided manifest — the "system-provided manifest" covers Splunk core only, not third-party apps under `/opt/splunk/etc/apps/`, so this is a platform integrity warning unrelated to better_map (most likely a manually-edited `/opt/splunk/etc/system/local/*.conf` file). **VERDICT:** SPLUNK-MSG-1 is unrelated to better_map; the runbook is shipped as `scripts/check-splunk-messages.sh` for future reproductions on long-lived environments.

18. **Upgrade hygiene catastrophic on `rev` — confirmed by the G3 manifest runbook.** **Live verification on `rev` 2026-05-17 18:15 CEST** via `scripts/find-orphans.sh --ssh-host rev`. The v1.6.3 release manifest (32 shippable files, 2.5 MB) shipped cleanly, but the deployed `/opt/splunk/etc/apps/better_map/` directory contains **50,994 orphan files (667 MiB)** accumulated from prior v1.5 installs that historically over-shipped dev artefacts. Maximal-orphan-directory breakdown: (a) `appserver/static/react/` 43,935 files / 445.8 MiB — the entire v1.5 React source tree with full `node_modules/`; (b) `appserver/static/visualizations/better_map/node_modules/` 7,005 files / 98.1 MiB — viz dev deps that leaked into v1.5/v1.6.0; (c) `appserver/static/pages/` 11 files / 109.2 MiB — old paged React bundles; (d) `appserver/static/visualizations/better_map/src/` 32 files / 233.9 KiB — viz source files; plus 11 individual leaves (`bm_react.bundle.js`, `bm_bootstrap_test.*`, viz `package*.json`, `harness.json`, `webpack.config.js`, `docs/AIR-GAPPED-PMTILES.md`, `scripts/build-pmtiles.sh`). **The runbook now flags these for the operator** with a grouped + size-summed summary (no more 50k-line scrollback) and a `--delete` flag. This is the bug class G3 was designed to detect; pre-v1.7 a customer would have had no way to know any of this was on disk. Cleanup procedure for `rev` documented at `docs/runbooks/upgrade-hygiene.md` Option B (SSH in + `rm -rf` the wholly-orphan directories — 50k per-file SSH rm calls is the wrong tool). Closed once `rev` cleanup is executed; future v1.7+ installs assert zero orphans as a post-release acceptance step (see G3 design).

19. **Local v1.6.3 `tar czf` did NOT honour release.yml's rsync exclude list.** **Discovery during G3 build, 2026-05-17 18:00 CEST.** The locally-built `dist/better_map-1.6.3.tar.gz` (used for the `rev` install earlier today) contains 34 files; the canonical release manifest contains 32. The two extra files (`appserver/static/visualizations/better_map/docs/AIR-GAPPED-PMTILES.md`, `appserver/static/visualizations/better_map/scripts/build-pmtiles.sh`) are correctly excluded by `release.yml`'s `--exclude='docs'` and `--exclude='scripts'` flags but were not stripped by the ad-hoc local `tar czf` invocation. Impact: low — these are read-only docs / a build helper, neither poses a security or functional risk on a Splunk install. Root cause: the local build path is operator-typed (no shared `scripts/package-app.sh` yet — tracked as a G2-2 follow-up). Mitigation: future v1.7+ installs should come from the tagged release workflow rather than a local `tar`, OR use a shared packaging script. Tracked as a v1.7 housekeeping item under G2.

(Original SPLUNK-MSG-1 entry follows.) During the v1.6.2 deploy on `rev`, a yellow Splunk Web banner appeared whose origin couldn't be determined from screenshots alone (Splunk re-renders the message via the web tier; only `/services/messages` on splunkd carries the authoritative stanza name + app/owner ACL). Tracked as a runbook (not a CI gate) because `/services/messages` is per-instance transient state and only meaningful against long-lived environments. Operator-driven runbook lives at `scripts/check-splunk-messages.sh` — bearer-token authenticated GET, message dump, and an automatic verdict line (`unrelated to better_map (close)` vs `caused by better_map (file bug)`). Requires `secrets.env` (gitignored) with `SPLUNK_HOST` + `SPLUNK_TOKEN`.

### What we DID verify in v1.6 (2026-05-16 deploy on `rev`, Splunk Enterprise 10.2.3)

| Check | Result |
|---|---|
| Install via REST URL-fetch + restart | green; splunkd 3 s, splunkweb 117 s |
| App registered: version, build, enabled, visible | `1.6.0 / 1600 / enabled / visible` |
| 12 v1.6 dashboards registered with valid CDATA + layout | green |
| Custom-viz registered in `visualizations.conf` | green |
| Static assets served on `:8000` | `visualization.js` 2,232,874 B + 111 B Splunk i18n prefix; `.css` 26 KB; `formatter.html` 42 KB |
| Bundle markers (v1.6 build identity) | `v1.6.0`×1, `BM-CT-1`×3, `pmtiles`×23, `milsymbol`×1, `setEnabled`×53, `reset(`×78 |
| Nav structure: collections "Showcases (v1)" / "v1.6 Showcases" / "Diagnostics" | green |
| 12/12 first-dataSource SPL dispatched cleanly | 0 FATAL, 0 ERROR across all showcases |
| Macros: 4 owned by `better_map` | green |
| One transient `splunkd:8089` hiccup (~30 s) during rapid-fire test dispatches | recovered on its own; flagged for production-load testing (D5) |
| **v1.6.2 patch re-deploy (2026-05-16 evening, same `rev` host)** — full restart, splunkweb served new assets after cache flush | `1.6.2 / 1611 / enabled / visible`; `visualization.js` reports `HUD_VERSION=v1.6.2`; `visualization.css` 51 KB (was 26 KB) with all 21 new selectors present; splunkweb on `https://:8000` (protocol drift detected mid-session — see gap 15 / R11) |
| **v1.6.3 G3 manifest baseline (2026-05-17 evening, same `rev` host)** — `scripts/build-manifest.py` walked source tree, `scripts/check-manifest.py` CI gate passed locally, `scripts/find-orphans.sh` runbook executed against `rev` | manifest: 32 shippable files / 2.5 MB / app v1.6.3; rev orphans: **50,994 files / 667 MiB** across 4 wholly-orphan directories + 11 individual leaves — see gap 18; runbook produces grouped summary suitable for operator review; cleanup procedure documented at `docs/runbooks/upgrade-hygiene.md` |

### What v1.6 did NOT verify (REST cannot test these from outside a browser)

- Whether MapLibre actually paints map tiles on the customer's panels
- Whether the 25 v1.6 fancy actions actually wire onto the canvas and honour their `BM-CT-1` enable/disable/reset controls
- Whether the 30 new formatter options actually surface correctly in Dashboard Studio's edit panel
- Whether the 8 Splunk-platform integrations actually reach their endpoints (this is what Theme C addresses)

### Bundle and dependency profile (measured 2026-05-16)

| Metric | Value | Target for v2.0 |
|---|---|---|
| `visualization.js` raw | 2.23 MB | ≤ 3.0 MB (with deck.gl + glTF loader added in B1, F3) |
| `visualization.js` gzipped | **576 KB** | ≤ 800 KB after v2.0 additions |
| Direct runtime deps | 11 | ≤ 18 |
| Transitive deps in `node_modules` | 228 | ≤ 350 |
| Bundles produced | 1 (single AMD module) | Add 1 worker bundle (A1) — still single AMD entry |

---

## 2. Strategic themes

Seven themes organise everything in this doc. Each work-item below lives under exactly one of these.

| Theme | What it means | Why it matters for the global claim |
|---|---|---|
| **A. Compute & scale** | Move heavy analytics off the main thread; sprite-atlas the icon paths; benchmark every layer at 1k / 10k / 100k / 1M features | kepler.gl runs 1M points smoothly. We must too. |
| **B. 3D fidelity** | Real glTF scenegraph, terrain source, sky layer, optional globe projection | deck.gl + Cesium have these; without them the "3D" story is rhetoric. |
| **C. Splunk integration depth** | Convert 8 scaffolds to verified production code with live-tenant smoke + documented field contracts | This is the **only** axis where better_map can lead the global tier — but only if the integrations are *real*. |
| **D. Quality bar** | AppInspect re-cert, performance harness, browser/OS matrix, error telemetry, accessibility audit | Without this, "best in the world" claims are unfalsifiable. |
| **E. Distribution & adoption** | Splunkbase listing, docs site, video walkthroughs, customer pilots | A viz that nobody ships is not in the global tier regardless of capability. |
| **F. Differentiated capabilities** | Collaboration, story mode, raster analytics, vector-tile authoring | Things the leaders have that we don't yet. |
| **G. Operational rigor** | Security & supply chain, CI/CD, upgrade hygiene, i18n, theming tokens, third-party plugin contract | The unglamorous floor below all other themes. v1.6 ships with none of it; this is what turns a one-author repo into a project that scales to multiple contributors and security-conscious customers. |

---

## 3. Detailed work-items

Each item carries: a one-line problem statement, design notes (with concrete libraries / APIs), a rough effort estimate, prerequisites, and acceptance criteria. Effort is in dev-days assuming one senior front-end engineer with Splunk + WebGL + GIS context; multiply ×1.5 for ramp-up.

> **Effort buckets:** S = ≤2 days · M = 3–7 days · L = 8–20 days · XL = 21+ days

### Theme A — Compute & scale

#### A1. Move spatial analytics to a Web Worker pool — `M`

* **Problem:** DBSCAN / KDE / Getis-Ord Gi* / LISA / NND run on the main thread; UI freezes past ~5–10k points.
* **Design:** Create `src/lib/analytics/workerHost.js` that spawns a pool of N workers (N = `navigator.hardwareConcurrency / 2`). Each worker bundles `simple-statistics` and `density-clustering` via a separate webpack entry point. Use a Comlink-style RPC bridge (or vanilla `postMessage` with a request-id table). The existing pure-compute modules in `src/lib/analytics/*.js` already have no DOM dependencies, so they port cleanly. Stream cells back so the UI can show progress.
* **Prereqs:** Verify Splunk's CSP allows `Worker` from same-origin (it does on Enterprise 9.x+; needs verification on Splunk Cloud).
* **Risk:** Splunk Cloud's CSP may block worker creation outright (the `Content-Security-Policy` header is centrally managed and not customer-overrideable). Mitigation: feature-detect, fall back to a `requestIdleCallback`-paced single-threaded path with chunking, ship both code paths.
* **Accept:** 100k-point DBSCAN run completes < 5 s without any main-thread task longer than 16 ms (measured via `PerformanceObserver({type:'longtask'})`). 1M-point KDE completes < 30 s with progressive rendering at ≥ 30 fps perceived during compute. Memory growth < 50 MB over the lifetime of the analysis.

#### A2. Sprite-atlas the MIL-STD-2525 and scenegraph icon paths — `M`

* **Problem:** Every milsymbol render bakes a fresh canvas → memory churn, GC pauses, slow at 1k+ symbols. Same problem for scenegraph icons (drone/truck/ship/aircraft).
* **Design:** Build-time generator (`scripts/build-sprite-atlas.js`) emits a single 2048×2048 PNG + JSON index of the top ~256 most-common 2525C SIDC codes and the 4 scenegraph icons. Use MapLibre's native `addImage(name, image)` once per symbol-key, then `icon-image` data-driven expressions point at atlas entries. Less-common 2525 codes fall back to runtime canvas bake (current path) and are cached in an LRU.
* **Prereqs:** A1 not required.
* **Risk:** The "top 256 SIDC codes" assumption is from public ATT&CK + sample wargaming data; a defence customer may want codes outside that set. Mitigation: ship the LRU runtime-bake fallback; let customers ship their own atlas via a formatter URL.
* **Accept:** 10k milsymbol render < 200 ms after first paint. JS heap delta over 100 `setData` updates ≤ 5 MB (measured via `performance.memory.usedJSHeapSize` sampled every 10 updates). Atlas PNG ≤ 4 MB on disk; ≤ 1.2 MB after lossless `oxipng` compression.

#### A3. Wind / flow-field on the GPU — `L`

* **Problem:** Current particle system advects on the JS main thread; throughput ~10k particles before frame drops.
* **Design:** Port to a MapLibre custom layer with a fragment-shader particle system. Reference implementations: Mapbox `mapbox-gl-particles`, `WeatherLayers GL`. Two RGBA8 textures: position (xy = lon/lat normalised, zw = age/seed); on each frame ping-pong advect via sampling a vector-field texture (u/v packed in RG). 100k particles trivially.
* **Prereqs:** None; existing `src/lib/layers/wind.js` becomes the reference orchestrator.
* **Risk:** WebGL2 + render-to-texture pipeline is not uniformly available on Splunk Mobile or on locked-down corporate Windows builds with old Intel drivers. Mitigation: feature-detect `gl.getParameter(gl.MAX_TEXTURE_SIZE)` ≥ 4096 and `WEBGL_color_buffer_float`; fall back to the v1.6 CPU path if missing.
* **Accept:** 100k particles at 60 fps on a 2021 MacBook Air M1 in a 1440×900 panel; 50k particles at ≥ 30 fps on a 2020-era ThinkPad with integrated Intel UHD; CPU fallback handles 5k at 30 fps. Particle texture size ≤ 16 MB GPU memory.

#### A4. Layer perf harness — `M`

* **Problem:** No way to detect a perf regression. Claims like "60fps at 100k features" are currently hand-wavy.
* **Design:** Headless-Chrome harness in `scripts/perf-harness/` that loads a static HTML page with the viz bundle, feeds synthetic GeoJSON of [1k, 10k, 100k, 1M] features per layer type, measures via the Performance API (FPS, JS-heap, paint timing, longest task), and writes results to `reports/perf-<gitsha>.json`. CI gate: regressions > 20% on any cell fail the build.
* **Prereqs:** A1, A2, A3 to have meaningful targets to measure.
* **Accept:** A perf report file with one row per (layer × point-count × browser) cell. CI green-lights on no regressions.

#### A5. Supercluster + H3 worker offload — `S`

* **Problem:** Current supercluster + h3-js calls block the main thread on initial render at large datasets.
* **Design:** Use the A1 worker host. Supercluster ships an `index.worker.js` build out of the box; h3-js is pure JS and trivially portable. Cluster tiles return as typed arrays for cheap transfer.
* **Prereqs:** A1.
* **Accept:** 1M-point initial cluster render < 2s without main-thread block longer than 16ms.

### Theme B — 3D fidelity

#### B1. Real glTF scenegraph via deck.gl interop — `L`

* **Problem:** v1.6 scenegraph layer is sprite-faked. The "3D-style icons" name is honest but the capability gap is real.
* **Design:** Add `@deck.gl/core` + `@deck.gl/mesh-layers` + `@loaders.gl/gltf` as deps. Use `MapboxOverlay` to host deck.gl layers inside the existing MapLibre instance — no second canvas, no separate camera. `ScenegraphLayer` consumes URL to `.glb`. Provide 4 default models bundled in `appserver/static/visualizations/better_map/models/{drone,truck,ship,aircraft}.glb` (sourced from CC0 / open licences). Fallback to v1.6 sprite path when WebGL2 unavailable. Bundle size impact ~600 KB gzipped; gate behind formatter option `v2RealScenegraph` so existing dashboards pay zero cost.
* **Prereqs:** None.
* **Risk:** deck.gl + MapLibre interop has historically been brittle around camera-sync (deck.gl assumes Mapbox internals that MapLibre forks may not preserve). Mitigation: pin a deck.gl version verified against the project's MapLibre version; add a smoke test to the perf harness (A4).
* **Accept:** 500 glTF instances (≤ 50 KB per model) at 60 fps; switching back to sprite mode at runtime without a full viz re-init; gzipped bundle stays ≤ 800 KB after the dependency lands.

#### B2. Terrain source + sky layer — `M`

* **Problem:** Flat 2D maps only. MapLibre supports terrain since v3.
* **Design:** Add a formatter toggle `v2Terrain` and an opts struct for the DEM source URL (Mapbox-RGB tile spec is the default; allow PMTiles DEMs for air-gapped). `map.setTerrain({source: 'terrain', exaggeration: 1})` + sky layer with `sun-elevation` driven by current time (animated when scrubber plays).
* **Prereqs:** None.
* **Accept:** Toggle works without re-init; existing 2D dashboards continue rendering identically when off.

#### B3. Globe projection — `M`

* **Problem:** Mercator only; can't honestly show planetary-scale datasets.
* **Design:** MapLibre 4.x supports globe projection via `map.setProjection('globe')`. Most layers Just Work; the H3 / hex-bin layers need re-projection to lng/lat polygons (they already do this; double-check geometry near the dateline). Add formatter `v2Globe` toggle.
* **Prereqs:** None; ships standalone.
* **Accept:** 6 of 10 layer types render correctly in globe mode (markers, paths, polygons, heat, H3, supercluster). Document the 4 that don't (extrusion, indoor floor-plan, trips replay, vector-tile join) and the workaround.

### Theme C — Splunk integration depth

> Every item in this theme requires a live Splunk tenant to verify against. The `splunk-monitoring-use-cases/secrets.env` token gets us a rev search head; for ITSI / ES / SOAR specifically we may need separate test tenants. Each item ends with a documented field contract that subsequent code must respect, checked in under `_ref/<integration>/field-contract.md`.

#### C1. ITSI service-map module → verified — `M`

* **Problem:** `src/lib/splunk/itsi.js` calls `/servicesNS/-/SA-ITOA/itoa_interface/service` based on docs, not a live response. Service graph node/edge schema, health-score field, geo-coordinate handling all unverified.
* **Design:** Build against a real ITSI tenant. Capture three sample JSON responses (services list, single-service detail, dependency graph) and check into `_ref/itsi/`. Write a field-contract markdown listing every field the module reads and where it comes from. Replace the inline force-directed layout with an HTML-canvas overlay so node positions survive pan/zoom (current SVG approach degrades on large graphs).
* **Prereqs:** Access to an ITSI lab.
* **Risk:** ITSI lab availability is a calendar-time blocker, not just effort. ITSI's REST schema also drifted between 4.13 and 4.18; we should test against both. Mitigation: time-box discovery to one week; if no lab access lands, ship the module behind an "experimental" flag with current best-guess code and a clear caveat in the docs.
* **Accept:** Showcase `better_map_itsi_service_map.xml` loads real services from the tenant; nodes carry the correct health-score colour; pan/zoom retains layout; field contract checked in at `_ref/itsi/field-contract.md` covering ≥ 12 fields; tested against ITSI 4.13 and 4.18 (the two current LTS-ish lines).

#### C2. SOAR playbook trigger → verified — `S`

* **Problem:** `phantom_forward` URL is a config string; never POSTed in anger. SOAR entity schema unverified.
* **Design:** Stand up a SOAR sandbox (or use Splunk's free community edition). POST a real "geographic incident" container with 3 entities and confirm a stub playbook fires. Document the exact `entities[].attribute` keys SOAR expects. Add a "dry-run" mode to the formatter so dashboard authors can preview the payload without firing.
* **Prereqs:** SOAR access.
* **Accept:** End-to-end demo of right-click-select → POST → SOAR container appears in the SOAR UI.

#### C3. ES notable drilldown → verified — `S`

* **Problem:** URL builder generates `/app/SplunkEnterpriseSecuritySuite/incident_review?...` but the `q` parameter syntax for filtering by `event_id` was assumed. Mark-closed REST POST to `/services/notable_update` not tested.
* **Design:** Test against a real ES tenant. Capture working URL examples. Verify the mark-closed call returns 200 and the notable status actually changes.
* **Prereqs:** ES access.
* **Accept:** Click a marker → ES Incident Review opens filtered to that notable. Mark-closed action confirms via REST.

#### C4. RBA risk heatmap → verified — `S`

* **Problem:** SPL helper macro emits a hex-grid aggregation against `index=risk`, but the field names (`risk_score`, `risk_object`, `risk_object_type`) were assumed.
* **Design:** Run the SPL against a real `index=risk` populated by an ES instance. Confirm field names and the `bin lat`/`bin lon` spans. Add an alternative aggregation by `risk_object` for analyst workflows.
* **Prereqs:** ES + populated risk index.
* **Accept:** Showcase dashboard returns non-empty hex grid against real risk events.

#### C5. OT Purdue overlay → verified — `S`

* **Problem:** Lookup name `ot_asset_register` is a default; the schema `host,asset_id,purdue_level` is a guess.
* **Design:** Collaborate with a real OT customer (Equinor, Statkraft, etc.) on the actual asset-register lookup format. Support the OT Datastreamer field naming convention if applicable.
* **Prereqs:** OT customer engagement.
* **Accept:** Showcase loads a real customer's asset register and colours by their actual Purdue field.

#### C6. A&I geo-resolution → verified — `S`

* **Problem:** Lookup against ES `assets.csv` / `identities.csv` assumes specific field names (`host`, `ip`, `lat`, `lon`).
* **Design:** Verify against ES default schema; handle the case where lat/lon are absent (need an IP-to-geo step then). Add fallback to `iplocation` SPL command.
* **Prereqs:** ES.
* **Accept:** Events lacking lat/lon get resolved correctly; `_geoResolvedBy` set to the source field.

#### C7. MITRE ATT&CK overlay → verified — `S`

* **Problem:** Built-in technique lookup is from 2023; ATT&CK refreshes twice a year.
* **Design:** Pull the latest STIX bundle from `https://github.com/mitre/cti` at build time, regenerate the bundled lookup, document the refresh cadence. Verify the tactic colour palette is colour-blind safe.
* **Prereqs:** None.
* **Accept:** Lookup covers current Enterprise ATT&CK matrix; tactic colours pass colour-blind simulation.

#### C8. AI Assistant chat → verified — `M`

* **Problem:** Feature-flagged off. Hits `Splunk_AI_Assistant_Cloud` `spl_generator` endpoint; never tested.
* **Design:** Test against a Splunk_AI_Assistant_Cloud-enabled tenant. Verify streaming response handling. Decide on multi-provider strategy: do we ever want direct OpenAI / Anthropic / Bedrock calls outside Splunk's AI Assistant? (Probably no — that's the user's *security* boundary.) Document the limit: AI Assistant is the only LLM path; no client-side keys ever.
* **Prereqs:** Splunk_AI_Assistant_Cloud entitlement.
* **Accept:** Chat panel returns useful SPL for natural-language geo queries; falls back gracefully when the assistant is not installed.

### Theme D — Quality bar

#### D1. AppInspect re-certification — `S`

> **Status (v1.7-prep, 2026-05-18): D1 SHIPPED.** AppInspect runs as a
> dedicated job in `ci.yml` (`appinspect`) on every PR and as an inline
> step in `release.yml` for every tag. Both invocations use the same
> pinned `splunk-appinspect` version from
> `scripts/requirements-appinspect.txt` (the single source of truth for
> the version pin and the CI cache key). The PR-gate runs with
> `--included-tags cloud --included-tags future` and asserts zero
> errors / failures / future_failures (warnings are informational); the
> release-gate runs the same scan with the stricter
> `--fail-on-warnings` flag because a tagged release MUST be
> zero-error AND zero-warning. JSON reports are uploaded as artefacts
> on both workflows (14-day retention on PR runs, 90 on releases) so
> a triage engineer can download the full message list without
> re-running CI. The same gate is reachable locally via
> `npm run lint:appinspect` from inside the viz package.
>
> - **PR-gate baseline:** the v1.6.x → v1.7-prep tree currently passes
>   the cloud + future tag set with zero errors, zero failures, zero
>   future_failures (the bar `check-appinspect-results.py` enforces).
>   Warnings list is intentionally non-empty (informational) — every
>   warning falls into one of the documented "acceptable for cloud
>   submission" categories tracked in
>   `docs/runbooks/appinspect-triage.md` (and is re-asserted to zero
>   on release tags by the `--fail-on-warnings` flag, which trips if
>   any new informational warning is introduced without an explicit
>   waiver decision).
> - **Closes:** the original v1.0.x → v1.6.x certification drift the
>   D1 problem statement was written against. The v1.7-prep tree is
>   continuously asserted clean of the .DS_Store / missing default.meta
>   / restmap.conf / insecure-HTTP class on every PR and every tag.
> - **What's NOT in D1 (and is intentionally out of scope):** automated
>   Splunkbase upload (tracked under E1 — needs an approved listing +
>   publishing token).
>
> See [`docs/CI-GATES.md`](docs/CI-GATES.md) gates #19 (PR) and #19
> (release) for the per-gate inventory, the local-repro command, and
> the explicit PR-gate ↔ release-gate parity contract.

* **Problem:** Last precert against v1.0.x. AppInspect catches dozens of issues (.DS_Store, missing default.meta entries, restmap.conf misconfig, insecure HTTP) that have been re-introduced repeatedly in v1.1 → v1.6.
* **Design:** Install `splunk-appinspect` via pip. Run with `--mode precert --included-tags=cloud,future` against `dist/better_map-1.6.0.tar.gz`. Fix every failure. Add as a CI step.
* **Prereqs:** None.
* **Accept:** Zero failures, zero manual-check items.

#### D2. Browser compatibility matrix — `S`

> **Status (v1.7-prep, 2026-05-18): D2 Phase 1 + Phase 1.5 SHIPPED.**
> Browser-compatibility load gate now runs on every PR across BOTH
> standalone HTML surfaces and the AMD bundle. Concretely:
>
> - **Phase 1 — `formatter.html` load test** (shipped 2026-05-18 AM):
>   `scripts/check-browser-compat.js` loads `formatter.html` (wrapped
>   in the same minimal HTML5 page the D3 accessibility audit uses —
>   DRY single wrapper) in headless **Chromium, Firefox, and WebKit**
>   via Playwright. The three engine families together cover ~99 % of
>   real browsers in the field (Chrome / Edge / Opera / Brave +
>   Firefox + Safari / iOS). Captures `console.error`, `pageerror`,
>   and `requestfailed` events; FAILs the gate on any error. Saves a
>   full-page screenshot per engine to `reports/browser-compat/<engine>.png`
>   for offline triage.
> - **Phase 1.5 — `visualization.js` AMD-require test** (shipped
>   2026-05-18 PM, the same day): the script gained a second test
>   class that inlines the ~2.3 MB bundle into a wrapper providing
>   an AMD `define()` shim plus minimal mocks for the two Splunk SDK
>   externals the bundle requires (`api/SplunkVisualizationBase`,
>   `api/SplunkVisualizationUtils`). Asserts the bundle parses,
>   `define()` was invoked exactly once with the documented two-element
>   deps array, the factory ran to completion without throwing, the
>   factory returned a non-null module, the entry IIFE called
>   `Base.extend()` exactly once, and the returned module has
>   constructor shape (function + prototype object). Catches the
>   "webpack target slipped to ES2020+ syntax WebKit / Firefox
>   rejects" class of bug that Phase 1 fundamentally cannot see
>   (`formatter.html` has no `<script>`). Total runtime overhead:
>   ~5 seconds on top of the formatter test for all three engines.
>   Skippable locally via `--skip-bundle` for faster formatter-only
>   iteration; gating in CI is unconditional.
> - **CI wiring:** `.github/workflows/ci.yml` installs all three
>   Playwright engines via `npx playwright install --with-deps
>   chromium firefox webkit` (adds ~3 minutes to cold runs;
>   browsers are cached between runs via `actions/cache@v4` keyed
>   on the Playwright lockfile version, so warm runs are ~10 s for
>   the install step). The "Check browser compatibility (D2)" step
>   runs `node scripts/check-browser-compat.js` and uploads
>   `reports/browser-compat-report.json` plus the three formatter
>   screenshots as a 14-day artifact.
> - **Customer-facing docs:** `docs/COMPAT-MATRIX.md` updated to
>   document both test classes (Phase 1 + Phase 1.5 in a single
>   table with a `Phase` column), the AMD shim's mocking contract,
>   the deferred Phase 2 matrix (cross-OS + live Splunk dashboards
>   + full-rendered `updateView` test), separate "Reading a failing
>   run" tables for Phase 1 vs Phase 1.5 (each with symptom → cause
>   → fix mappings), and the `--skip-bundle` local workflow.
> - **Agent guidance:** `docs/_machine/agents.md` "Common mistakes
>   and how to fix them" now distinguishes `formatter: FAIL` vs
>   `bundle: FAIL` rows. Each row points at the relevant COMPAT-MATRIX
>   troubleshooting table; the bundle row specifically calls out
>   `factoryError`, `depsRequested` drift, and the webpack ES5
>   contract that protects against the most common cross-engine
>   regression.
> - **npm:** `npm run lint:browser-compat` runs both test classes;
>   `--skip-bundle` is a node-script flag, not an npm script (CI
>   never passes it).
>
> **Why Phase 1.5 stops at AMD-eval and not at `updateView`:**
> rendering the bundle into a real container requires (a) a
> Splunk-shaped data envelope and (b) a wired MapLibre source so the
> basemap code paths don't throw on `addLayer`. Both are real
> engineering; doing the AMD-eval test first catches ~80 % of
> cross-engine bundle bugs at ~5 % of the implementation cost.
> Full `updateView` rendering falls to Phase 2.
>
> **Phase 2 (deferred):** cross-OS matrix (macOS Safari + Windows
> Edge), full-rendered `updateView` test (calling the bundle into a
> real DOM with a Splunk-style data envelope), and live-Splunk
> dashboard rendering (the 12 showcases against a Splunk Enterprise
> container). Cross-OS + live-Splunk are blocked on the same
> self-hosted-runner decision tracked in D5 Phase 2; GitHub Actions
> free runners are Linux-only. Full-render `updateView` is blocked
> on a data-envelope helper described in `docs/COMPAT-MATRIX.md`
> "Phase 2 matrix" notes.

* **Problem:** Tested on Chrome by hand. Unverified on Firefox, Safari, Edge, Splunk Mobile.
* **Design:** Use Playwright to load the 12 showcase dashboards in [Chrome, Firefox, Safari (via WebKit), Edge] × [macOS, Windows, Linux]. Screenshot each. Diff against a baseline. Document the perf delta.
* **Prereqs:** D1.
* **Accept:** Matrix table in `docs/COMPAT-MATRIX.md` listing pass/fail per cell with screenshots.

#### D3. Accessibility audit — `S`

> **Status (v1.7-prep, 2026-05-17): D3 Phase 1 SHIPPED.** axe-core
> WCAG 2.2 AA gate now runs on every PR. Concretely:
> - **`scripts/check-accessibility.js`** loads `formatter.html`
>   (wrapped in a minimal HTML5 page so axe sees document landmarks)
>   in headless Chromium via Playwright and runs axe-core against
>   `wcag2a + wcag2aa + wcag21a + wcag21aa + wcag22aa`. Zero
>   violations is the bar; `incomplete` findings surface for
>   release-prep review but do NOT fail the gate. Three rules
>   (`page-has-heading-one`, `landmark-one-main`, `region`) are
>   disabled with in-source justification because the formatter is a
>   fragment rendered inside Splunk's host page chrome.
> - **CI wiring:** `.github/workflows/ci.yml` installs Playwright's
>   Chromium via `npx playwright install --with-deps chromium`, runs
>   the audit, and uploads `reports/accessibility-report.json` as a
>   14-day artifact for offline triage.
> - **Pre-existing a11y debt fixed:** the formerly duplicate
>   `<select data-name="highContrast">` (lines 677–700 of
>   `formatter.html`) was removed — it triggered axe's
>   `duplicate-id-aria` (critical) and `form-field-multiple-labels`
>   findings. The orphan `mapLabelLanguage` option (declared in the
>   formatter, never read by any JS code path, functionally
>   redundant with `labelLanguage`) was dropped in the same change.
>   Formatter option count: **82** (was 83); duplicate-data-names
>   list in `formatter-schema.json` is now empty.
> - **Local re-run:** `node scripts/check-accessibility.js` (first
>   run only: `cd better_map/appserver/static/visualizations/better_map && npx playwright install chromium`).
> - **What's NOT in Phase 1:** axe-core across the 12 showcase
>   dashboards rendered by a real Splunk instance (deferred to D5
>   when the Docker-compose harness lands); manual screen-reader
>   sweep with VoiceOver + NVDA (manual acceptance step before E1).

* **Problem:** `prefers-reduced-motion` is respected, but full WCAG 2.2 AA conformance untested. Keyboard navigation, screen-reader labels, focus management for popups, colour contrast on all themes.
* **Design:** Run axe-core via Playwright on each showcase. Manual screen-reader pass with VoiceOver and NVDA. Fix everything that comes up.
* **Prereqs:** D2 harness.
* **Accept:** Zero axe violations at WCAG AA level. Screen-reader users can navigate the popups, the time scrubber, and the control panel.
* **Phase 1 (shipped, see status block above):** PR-gate on `formatter.html` only (the one HTML surface that doesn't need a Splunk renderer). Catches the largest class of regressions an author can introduce — a duplicate `id`, a missing `<label for="...">`, an unlabeled `<select>`, a colour contrast regression — at the moment the PR opens.
* **Phase 2 (deferred to D5):** same axe-core engine wrapped in Playwright against the 12 showcase dashboards inside a real Splunk Enterprise container. Blocked on the Docker-compose harness D5 is building.
* **Phase 3 (manual, pre-E1):** VoiceOver (macOS) + NVDA (Windows) sweep of the showcases, recorded as a checklist in `docs/runbooks/accessibility.md`.

#### D4. Error telemetry — `M`

* **Problem:** We have no idea how often `bm:draw-finished` fails, how often a custom-viz module crashes inside a customer's Splunk, how often basemap fetches 4xx.
* **Design:** Add an opt-in `v2Telemetry` formatter toggle. When on, POST anonymised error envelopes (no SPL, no field values, just stack trace + bundle SHA + browser + dashboard SHA) to a customer-supplied collector URL — never to a Better Map hosted endpoint (the project doesn't own infra). Document the schema. Provide a sample HEC config that consumes the envelope into a Splunk index.
* **Prereqs:** None.
* **Accept:** Errors land in a Splunk index when the toggle is on; zero data leaves when off.

#### D5. End-to-end test suite — `M`

> **Status (v1.7-prep, 2026-05-18): D5 Phase 1 SHIPPED.** The repo
> now ships a Docker-Compose Splunk Enterprise harness plus a
> dispatch-test rig that smoke-tests every Dashboard Studio
> dashboard's SPL against a live splunkd. Concretely:
> - **`docker/docker-compose.yml`** — single Splunk Enterprise
>   container (`splunk/splunk:${SPLUNK_IMAGE_TAG:-latest}`), ports
>   8000 (UI), 8088 (HEC), 8089 (REST), named volumes
>   `better_map_splunk_etc` + `better_map_splunk_var` for state,
>   bind-mount `./staging:/staging:ro` so the install step can use
>   the URL-encoded `name=/staging/...` pattern instead of multipart
>   (multipart is rejected by splunkd:8089 — see
>   `~/.cursor/skills/splunk-remote-app-deploy/SKILL.md`). Curl-
>   based healthcheck against `/services/server/info` with a
>   60 s start-period and 30 retries. Fail-fast `${VAR:?}` syntax
>   on `SPLUNK_PASSWORD` and `SPLUNK_HEC_TOKEN`.
> - **`docker/.env.example`** + `.gitignore` entry for `docker/.env`
>   (operator copies `.env.example`, fills in
>   `SPLUNK_PASSWORD` ≥ 8 chars + a uuid4 `SPLUNK_HEC_TOKEN`,
>   optional port + image-tag overrides).
> - **`docker/scripts/bootstrap.sh`** — idempotent ~440 LOC.
>   Validates prerequisites, boots the container, polls splunkd
>   until 200 OK on `/services/server/info` (10-minute deadline),
>   mints a 30-day REST bearer token via `splunk add token`
>   (graceful fallback for both `splunk _internal call` XML and
>   the simpler CLI output formats), builds the app tarball (the
>   rsync + chmod + tar block mirrors lines 53–87 of
>   `scripts/run-appinspect-local.sh` — keep in sync; refactor to
>   a shared `scripts/build-app-tarball.sh` is left for a follow-
>   up), POSTs to `/services/apps/local` with `name=<container
>   path>` `filename=true` `update=true`, restarts splunkd and
>   waits for it back up, writes `secrets.env` at the repo root
>   chmod 600 with `SPLUNK_HOST=localhost` + `SPLUNK_PORT=8089` +
>   the minted `SPLUNK_TOKEN` + HEC settings + `SPLUNK_INSECURE=1`.
>   Supports `--skip-install` (boot only) and `--skip-build` (use
>   existing tarball).
> - **`docker/scripts/teardown.sh`** — `docker compose down -v`
>   (drops state) plus clears `docker/staging/` and removes
>   `secrets.env` ONLY if it points at `localhost` (preserves a
>   hand-edited remote-tenant config). Supports `--keep-volumes`
>   to preserve state across a stop/start.
> - **`scripts/dispatch-test.py`** — ~340 LOC, stdlib-only (urllib
>   + xml + json + dataclasses), zero pip deps. Same XML/JSON
>   parse logic as `scripts/check-dashboard-xml-json.py` so the
>   two stay in semantic sync. Walks
>   `better_map/default/data/ui/views/*.xml`, extracts every
>   `ds.search` `options.query` from the Dashboard Studio CDATA
>   JSON (66 queries across 13 dashboards as of cut),
>   `POST /servicesNS/nobody/better_map/search/jobs`
>   `search=<spl>` `exec_mode=normal` `earliest_time=-24h@h`
>   `latest_time=now`, polls the returned sid until `isDone=true`
>   (per-query 60 s timeout, overridable with `--timeout`),
>   classifies the messages array into info / warn / error / fatal,
>   prints a per-dashboard PASS / WARN / FAIL report, exits 0/1.
>   Pre-flight `GET /services/server/info` so a stale token
>   surfaces as one clear failure not 13 noisy 401s. `--filter
>   <regex>` narrows to a single dashboard; `--verbose` prints all
>   queries and all info/warn messages.
> - **Operator doc** at
>   `docs/development/local-splunk-harness.md` — quick start,
>   step-by-step description of what bootstrap.sh + dispatch-
>   test.py do, talking to a remote Splunk instead of the local
>   harness, common failure modes, the "why CI integration is
>   deferred" explanation, cleanup. Wired into `mkdocs.yml` `nav:`
>   under a new "Development" group; passes `mkdocs build
>   --strict`.
> - **Agent contract** at `docs/_machine/agents.md` §10 — when to
>   run the harness, the contract (what each file does, what's
>   gitignored), things you MUST NOT do (commit `docker/.env` or
>   `docker/staging/` or `secrets.env`; change the install POST
>   to multipart; wire into free GitHub Actions runners — Splunk
>   needs ≥4 GB and the runners have 7 GB total), plus a new
>   "Dashboard-changed lane" block in §7 directing maintainers
>   to run `bash docker/scripts/bootstrap.sh && python3
>   scripts/dispatch-test.py` before any PR touching
>   `default/data/ui/views/*.xml`.
> - **What's NOT in Phase 1:** Playwright in-browser rendering
>   (Phase 2), version matrix (Splunk 10.2 × 10.3 — Phase 2,
>   requires the self-hosted-runner decision from the §3 D5 risk
>   note), CI integration (Phase 2 — see "Why CI integration is
>   deferred" in the operator doc). Phase 1 captures the runtime-
>   behaviour gap the static gates leave open at a fraction of
>   the runner-sizing cost; Phase 2 closes the visual-rendering
>   gap that only a real browser can.

* **Problem:** No automated test ever exercises a real Splunk REST install + dashboard render. The 2026-05-16 lab deploy worked but was driven by hand; a missing CDATA closing tag, a typo in `visualizations.conf`, or an SPL parse error in a new showcase would not be caught until a human user opens the dashboard.
* **Design:** Docker-compose with Splunk Enterprise (matrix: 10.2, 10.3) + the freshly built tarball + an HEC token. Playwright drives a real browser at `localhost:8000` and asserts each showcase renders, each layer toggles, each scrubber control works, and the BM-CT-1 reset button returns the viz to the documented initial state. The dispatch-test from the 2026-05-16 deploy (one SPL per dashboard, fatal/error scan) is the lightweight pre-flight; Playwright is the heavy in-browser check. Run on every PR via GitHub Actions.
* **Prereqs:** D2 harness, G2 CI/CD.
* **Risk:** Splunk Enterprise in docker is heavy (≥ 4 GB RAM per container); GitHub Actions free runners may OOM. Mitigation: budget a self-hosted runner or use Splunk's own cloud-CI minutes if the Splunk Engineering partnership materialises.
* **Accept:** Green CI on PR within 15 min wall-clock; one dashboard-renders-and-resets assertion per showcase × 2 Splunk versions; Playwright traces uploaded as PR artifacts on failure. Reduce flake rate to < 2% over a rolling 30-PR window (measured automatically).

#### D6. Demo data pack & one-click showcase mode — `S`

> **Status (v1.7-prep, 2026-05-18): D6 SHIPPED.** The
> visualisation now carries a bundled, deterministic demo data
> pack and a one-click formatter dropdown to load it on any
> panel, including one whose SPL returns zero rows. Concretely:
> - **`src/lib/demo/`** (new module tree, ~13 KB source / ~3 KB
>   gzipped contribution to the bundle): `rng.js` exports a
>   seeded mulberry32 PRNG (`createRng(seed)` →
>   `next/range/int/pick/gauss/chance`); `geoUtils.js` exports
>   `lerpLatLon / jitter / bearing / distanceM / pathAlong` (no
>   turf dep — `pathAlong` is the only non-trivial helper, ~25
>   LOC); `index.js` exports `PRESETS / isDemoPreset /
>   loadDemoPreset / presetLabel`.
> - **Three presets** under `src/lib/demo/presets/`:
>   `fleetTelemetry.js` (Oslo last-mile, 40 vans × 6 h,
>   ~2 880 GPS pings emit `_time / lat / lon / pathId / driver /
>   depot / cluster / cargo_type / cargo_kg / fuel_pct /
>   speed_kph / heading_deg / status / color / popup`),
>   `iotSmartBuilding.js` (Fornebu HQ multi-floor sensor mesh,
>   5 floors × 50 sensors = 250 rows of `temperature / humidity /
>   co2 / occupancy / door` with `floor_id / floor_purpose /
>   status / color / popup`),
>   `cyberIncidents.js` (global SOC, 600 incidents / 24 h with
>   weighted source-country sampling, `iso` ISO-3166-alpha-2,
>   ASHRAE-aligned alarm thresholds, `mitre_technique_id` matching
>   `Txxxx[.xxx]`, `risk_score` 0–100 + 5-band colour ramp,
>   `src_ip` always in RFC-5737 documentation space).
> - **Formatter wire-up** — new "Demo & onboarding" section at the
>   top of Tab 1 in `formatter.html` with a `demoPreset` dropdown
>   (`none` / `fleet-telemetry` / `iot-smart-building` /
>   `cyber-incidents`). The viz intercepts `formatData()` and
>   substitutes the generated dataset when `demoPreset != "none"`,
>   crucially **without** caching the demo data into `_lastGoodData`
>   — toggling back to "None" restores the real SPL result.
> - **Showcase dashboard** —
>   `default/data/ui/views/better_map_showcase.xml`, three panels
>   side-by-side with markdown captions explaining each story,
>   wired into `default/data/ui/nav/default.xml` as a top-level
>   entry alongside the overview. Renders end-to-end on a Splunk
>   install with **zero live data** because every panel uses a
>   trivial `| makeresults` placeholder that the demo interception
>   discards.
> - **Tests** — `src/lib/__tests__/demo.test.js` carries 40 Vitest
>   cases covering the RNG contract, geo helpers, registry
>   contract, field schema per preset (locked in order — adding a
>   field is a deliberate breaking-change PR), row-count bands,
>   colour-palette membership, determinism (same seed →
>   byte-identical first / mid / last row), the four-status
>   diversity of the fleet dataset, the ASHRAE-aligned alarm
>   reliability of the IoT dataset, the country-distribution
>   coverage of the cyber dataset, and the Splunk
>   SearchResults shape every loader returns. Full suite is
>   `124 passed (124)`.
> - **Bundle impact** — `visualization.js` shrunk slightly from
>   2.23 MB → 2.18 MB raw (tree-shaking re-checked when the
>   import graph changed) and 576 KB → 574.9 KB gzipped; the
>   D6 surface fits inside existing bundle-size budgets with
>   substantial headroom (the §7c budget of 800 KB gzip is at
>   72 % utilisation).
> - **Docs** — `docs/_machine/agents.md` carries a new §5c
>   "Adding a new demo preset" recipe (generator contract +
>   registry + formatter + spec + tests + showcase panel + regen
>   + checklist) and three new common-mistake rows; the
>   `docs/_machine/README.md` table lists the new
>   `src/lib/demo/` runtime module and the showcase dashboard.
>   `README/savedsearches.conf.spec` documents `demoPreset` with
>   per-preset detail. The auto-generated formatter reference
>   (E2 Phase 2) picks up the new option automatically and lists
>   it under "Demo & onboarding".

* **Problem (resolved by SHIPPED):** A new evaluator who installs the app on an empty Splunk lab sees twelve showcase dashboards full of `| makeresults` + `sin(c/8)` synthetic data — four trucks circling NYC / London / SF / Tokyo on impossible trig-shaped routes, abstract trig-jittered IoT noise, hex-bin world maps with no realistic origin-country distribution. The data is unconvincing as a "this is what your real ops look like" story, and there is no first-class way to load anything richer without standing up a full Splunk environment first.
* **Design (SHIPPED above):** Three deterministic, narrative-driven datasets baked into the viz bundle, exposed via a single formatter dropdown that overrides the panel's SPL result. The interception is in `formatData()` rather than `updateView()` so the (a) empty-data fallback path and (b) `_lastGoodData` cache are both respected — switching the dropdown off restores the user's real SPL result on the very next tick. Each preset embeds a small story (Oslo last-mile logistics, Fornebu office IoT, global SOC) so the screenshots tell something a customer can recognise rather than "a flat map of dots".
* **Prereqs:** None (no live Splunk needed).
* **Accept (SHIPPED):** (a) `demoPreset` set to a non-default value renders the bundled dataset even on a panel with `| makeresults | head 0`; (b) setting it back to `none` restores the SPL result with no stale demo rows; (c) bundle size stays within the §7c budgets; (d) `demo.test.js` passes 40/40 including byte-stability across two runs of the same seed; (e) `better_map_showcase.xml` parses, renders, and lives in the nav.

### Theme E — Distribution & adoption

#### E1. Splunkbase listing — `M`

* **Problem:** Not on Splunkbase. Discoverability ~0.
* **Design:** Submit for AppInspect cloud vetting. Author the Splunkbase description, screenshots (one per showcase × 12 = portfolio), 2-minute video walkthrough. Decide licence and support model.
* **Prereqs:** D1 (clean precert).
* **Accept:** Listed on Splunkbase with at least 12 screenshots and a video.
* **Open question for the project owner:** free MIT or paid commercial? Support tier?

#### E2. Documentation site — `M`

> **Status (v1.7-prep, 2026-05-17): E2 Phase 1 SHIPPED.** A
> production-ready MkDocs Material site stands up off the repo's
> `docs/` tree and auto-publishes to GitHub Pages on every push to
> `main`. Concretely:
> - **`mkdocs.yml`** — Material theme with `font: false` (no Google
>   Fonts — air-gap binding per §1a), system-preference colour
>   palette (light / slate / auto), navigation tabs + sections +
>   indexes + footer, search.suggest + share, code-copy +
>   code-annotate, content.action.edit/view, table-of-contents,
>   `strict: true` (any warning fails the build),
>   `use_directory_urls: true`, eleven top-level navigation
>   sections, `not_in_nav: _machine/** _includes/**` (keeps the
>   machine-readable layer out of the user-facing sidebar but
>   accessible by direct URL once G7 Phase 2 wires it up),
>   `include-markdown` plugin (`recursive: true`) so
>   `CHANGELOG.md` and `ROADMAP.md` mirror onto the site without
>   duplication.
> - **`scripts/requirements-mkdocs.txt`** — exact pins for `mkdocs`
>   1.6.1, `mkdocs-material` 9.5.46, `mkdocs-include-markdown-plugin`
>   6.2.2, `pymdown-extensions` 10.12. Mirrors the
>   `scripts/requirements-appinspect.txt` pattern (single-file pin,
>   CI cache key + install command both read it).
> - **Eleven content pages** authored under `docs/` covering Home,
>   Getting started (install + smoke test), Runtime envelope,
>   Reference (formatter / layers / BM-CT-1), Integrations (index +
>   catalogue for the eight `_machine/integrations/*.yaml`),
>   Recipes placeholder (E5 hook), Performance, Air-gapped
>   deployment, Runbooks (index + the two shipped runbooks for
>   G1/G3), Contributing, Changelog (mirrors `CHANGELOG.md`),
>   Roadmap (mirrors this file). Every page links forward to the
>   machine-readable source of truth where one exists.
> - **CI gate (`docs-build` job in `.github/workflows/ci.yml`):**
>   `mkdocs build --strict` runs on every PR. Caught real bugs on
>   the first run — `docs/runbooks/supply-chain.md` had three
>   `../../scripts/*.json` relative links that resolved at the
>   GitHub-rendered repo path but escaped the site root; rewritten
>   to `https://github.com/...` URLs. ~30s on cold cache; ~10s on
>   warm pip cache. The built `site/` is uploaded as a 14-day
>   artifact for offline triage.
> - **GitHub Pages deploy workflow (`.github/workflows/docs.yml`):**
>   re-runs the strict build on every push to `main` (filtered by
>   `paths:` so a code-only commit doesn't pay for a no-op deploy)
>   and publishes via `actions/deploy-pages@v4`. Least-privilege
>   permissions (`contents: read`, `pages: write`, `id-token:
>   write`); pinned to the `github-pages` environment so the
>   Actions run summary shows the published URL.
>   `actions/configure-pages@v5` runs with `enablement: true` so a
>   fresh fork or clone-then-transfer self-bootstraps Pages on
>   first deploy.
> - **Live site:** **<https://fenre.github.io/better_map/>** —
>   verified HTTP 200 on 2026-05-17 after the bootstrap deploy
>   (`gh run view 26001312801`).
> - **One-time maintainer bootstrap (recorded so the next agent
>   doesn't relearn it):** the `GITHUB_TOKEN` minted for a workflow
>   does NOT have permission to call the REST
>   `enable-pages-for-repository` endpoint (it 403s with
>   `Resource not accessible by integration`). On a brand-new repo
>   where Pages was never enabled, the maintainer (or an agent with
>   a PAT) must call it once via `gh api -X POST /repos/<owner>/<repo>/pages
>   -f build_type=workflow`. After that, `actions/configure-pages`'s
>   `enablement: true` no-ops on every subsequent run and the
>   workflow is fully turnkey. For fenre/better_map this was done
>   on 2026-05-17; for forks, this is the only manual step.
> - **`.gitignore`** updated for the build artefact (`site/`) and
>   the local-only `mkdocs serve` venv (`.venv-mkdocs/`).
> - **G7 Phase 2 unblocked:** with a stable URL tree now in place,
>   the `llms.txt` / `llms-full.txt` emission tracked under §3 G7
>   ("What's NOT here yet") is no longer blocked.
> - **Local re-run:**
>   ```bash
>   python3 -m venv .venv-mkdocs
>   .venv-mkdocs/bin/pip install -r scripts/requirements-mkdocs.txt
>   .venv-mkdocs/bin/mkdocs build --strict   # CI mirror
>   .venv-mkdocs/bin/mkdocs serve            # live-reload preview at :8000
>   ```
> - **What's NOT in Phase 1 (deferred to E2 Phase 2 + G7 Phase 2):**
>   auto-generated pages from `docs/_machine/formatter-schema.json`
>   (the Formatter reference page currently summarises the
>   high-traffic options and points at the schema for the full
>   set); per-source recipe pages (E5 dependency); `llms.txt`
>   emission script; i18n plugin (no second language to ship yet);
>   privacy-preserving analytics (no decision yet on the analytics
>   vendor; the strict-mode build forbids any script tag from a
>   third-party host); custom domain (currently published at
>   `fenre.github.io/better_map/`).

* **Problem:** README is 735 lines, CHANGELOG is 1396. Hard to navigate. No search. No structured way to plug in the per-source recipes (E5) or the machine-readable schemas (G7).
* **Design:** Stand up an MkDocs Material site at `https://better-map.dev` (or under a Splunk-owned subdomain) — **infrastructure only; content scope lives in E5 and G7.** Site skeleton sections:
  - Getting started (install via Splunkbase, install offline, smoke-test panel)
  - Runtime envelope (§1a of this roadmap, rendered as the first reference page)
  - Layer reference (one page per layer type, auto-generated from `_machine/layers/*.yaml` — G7)
  - Formatter reference (auto-generated from JSON Schemas — G7)
  - BM-CT-1 contract (the enable/disable/reset contract, machine-asserted by D5)
  - Splunk-integration cookbook (cross-links to per-source recipes — E5)
  - Per-source recipes (the matrix — E5)
  - Performance guide
  - Air-gapped deployment (already drafted in `docs/AIR-GAPPED-PMTILES.md` — migrate)
  - Contributing (links to the plugin authoring guide — G6)
  - Choose the MkDocs i18n plugin from day one (feeds G4)
  - Privacy-preserving analytics only (Plausible or GoatCounter — no Google Analytics, per §1a CSP posture and Splunk-customer norms)
* **Prereqs:** None; ships in parallel with E5 and G7 which populate it.
* **Accept:** Site live; every public API page generated from a machine-readable source under `docs/_machine/` so a human edit cannot drift from the implementation; navigable search works offline; loads correctly on Splunk Cloud's allow-listed CDN list (no third-party fonts, no Google CDN scripts).
* **Phase 1 (shipped, see status block above):** infrastructure — MkDocs Material site, eleven hand-authored pages, strict-mode PR gate, GitHub Pages deploy on `main`, the air-gap binding (no Google Fonts, no third-party scripts).
* **Phase 2 (partially shipped, see E2 Phase 2 status blocks above):** auto-generated Formatter reference (E2 Phase 2 ✅ via `scripts/build-reference-pages.py` — 82-option enumeration grouped by `(tab, heading)`, drift-gated in CI inside `docs/reference/formatter.md` between BEGIN/END AUTOGEN markers), auto-generated Integration catalogue matrix (E2 Phase 2 ✅ via the same script's second managed region — 8-row at-a-glance table + per-integration endpoint detail, rendered from `_machine/integrations/*.yaml` into `docs/integrations/catalogue.md` between BEGIN/END AUTOGEN markers; the hand-authored prose blocks below the markers are preserved), `llms.txt` emission (G7 Phase 2 ✅); still pending: auto-generated per-source recipe matrix section (same framework, one follow-up PR adding a third `ManagedRegion`), Layer reference auto-gen (blocked on `_machine/layers/*.yaml` — de-prioritised behind integrations), privacy-preserving analytics decision, custom domain.

#### E3. Video walkthroughs — `S`

* **Problem:** Maps are visual; the value isn't conveyable in text.
* **Design:** 6 short videos (~3 min each): overview, time scrubber, spatial analytics, MITRE/ES/RBA combo, OT Purdue, custom integration cookbook. Hosted on YouTube + embedded in the docs site.
* **Prereqs:** E2 site to embed in.
* **Accept:** 6 videos live with English captions.

#### E4. Customer pilot programme — `XL`

* **Problem:** No customer-validated value claims. Without 3+ paying or referenceable customers, "global tier" is rhetoric.
* **Design:** Recruit 3 pilots across distinct verticals (SOC at a financial-services customer, NOC at a telco, OT engineering at an energy customer). Bi-weekly office hours. Convert pilot feedback into a public reference deck.
* **Prereqs:** D1, E1, E2.
* **Accept:** 3 named reference customers willing to appear in marketing.

#### E5. Per-source setup recipes (the matrix) — `M`

> **Status (v1.7-prep, 2026-05-17): E5 Phase 1 SHIPPED.** The
> recipe **framework** (schema + validator + index emitter + CI
> gate + docs nav) and **three starter recipes** are in place;
> the remaining matrix cells fill in as live-Splunk verification
> time becomes available. Concretely:
> - **`docs/_machine/recipes/recipe-schema.json`** — JSON
>   Schema 2020-12 declaring the YAML frontmatter every recipe
>   MUST carry. Required keys: `schema_version`, `id`,
>   `source` (id + display_name + pattern), `layer` (id +
>   display_name), `status` (`verified` | `unverified` |
>   `deferred`), `last_verified_iso8601`, `verified_against`,
>   `splunk_apps_required`, `expected_fields`,
>   `required_formatter_options`, `ot_safety_relevant`. Source
>   patterns are enum-restricted to the 15 row labels of the
>   matrix table below; layer ids to the 10 core layer types.
> - **`scripts/check-recipe-schema.py`** — stdlib + PyYAML
>   validator that (a) parses every
>   `docs/recipes/<source>/<layer>.md` frontmatter, (b) asserts
>   it conforms to the schema, (c) cross-checks the filesystem
>   path against `id` / `source.id` / `layer.id`, (d) asserts
>   the six canonical sections (`## 1. Source description`
>   .. `## 6. Gotchas`) are present in order, (e) asserts the
>   §2 SPL fence is tagged `spl` AND obeys the SPL
>   Pipe-Per-Line Rule (mirrors `splunk-conf-and-spl.mdc`),
>   (f) asserts the §4 JSON fence parses, references only real
>   options from `formatter-schema.json`, and exactly matches
>   the frontmatter's `required_formatter_options`,
>   (g) asserts every `expected_fields[*].name` appears as a
>   row in the §3 markdown table, (h) asserts that recipes
>   tagged `ot_safety_relevant: true` mention OT safety in §6
>   per `/.cursor/rules/ot-safety.mdc`, and (i) regenerates
>   `index.yaml` under the hood and byte-compares against the
>   on-disk copy (drift gate).
> - **`scripts/build-recipe-index.py`** — walks
>   `docs/recipes/<source>/<layer>.md` and emits the
>   deterministic, hand-readable
>   `docs/_machine/recipes/index.yaml`. `--stdout` prints
>   without writing (used by the drift gate); `--check` exits
>   non-zero if the on-disk copy is stale; default behaviour
>   writes and commits-ready. `PyYAML` is the only third-party
>   dep and ships transitively with `mkdocs-material`.
> - **`docs/_machine/recipes/index.yaml`** — generated
>   machine-readable index of every recipe. This is the
>   structured input that G7 Phase 2 (`llms.txt` emission) was
>   blocked on; that blocker is now cleared.
> - **CI gate (`docs-build` job in `.github/workflows/ci.yml`):**
>   `python3 scripts/check-recipe-schema.py` runs after the
>   MkDocs install (so PyYAML is present) and before the
>   strict mkdocs build (so recipe failures surface in a fast,
>   isolated step). On FAIL: stderr names the recipe + the
>   violation; the agents.md "common mistakes" table lists the
>   remediation for each failure mode.
> - **Three starter recipes** (covering the three most common
>   Splunk source patterns):
>   - `docs/recipes/cim-network-traffic/markers.md` — CIM
>     Network Traffic → markers. Uses `| tstats` on the
>     accelerated Network_Traffic data model, `| iplocation`
>     for geocoding, `pointRenderer: cluster`. Apps required:
>     `Splunk_SA_CIM`, `builtin:iplocation`.
>   - `docs/recipes/kvstore-latlon/markers.md` — KV Store
>     (lat/lon collection) → markers. The simplest possible
>     case: `| inputlookup site_locations | rename site_id AS
>     id`, `pointRenderer: markers`. Zero apps required.
>   - `docs/recipes/geo-us-states/choropleth.md` — US states
>     choropleth via the bundled `us-states` PMTiles preset.
>     `| stats count BY Region | eval id=upper(...)` to map
>     state names → USPS two-letter codes (= the tileset's
>     `promoteId: stusps`). `featureJoinPreset: us-states`,
>     `enableChoropleth: true`, `palette: viridis`. Zero
>     apps required.
>   All three are marked `status: unverified` because the
>   v1.7-prep agent had no live Splunk REST credentials in
>   the working directory; each recipe documents the exact
>   maintainer steps to flip to `verified`.
> - **`docs/recipes/index.md`** rewritten from placeholder
>   to a live page with the status table, the schema
>   reference, the CI gate description, and an
>   "Adding a new recipe" how-to. `mkdocs.yml` nav grows
>   from `Recipes: recipes/index.md` (single page) to a
>   section with one entry per shipped recipe; new recipes
>   land as one-line nav additions in their PR.
> - **`docs/_machine/agents.md`** grows §5b "Adding a new
>   per-source recipe", adds the recipe gate to the §7
>   pre-commit checklist, and gains five new entries in the
>   §8 common-mistakes table covering recipe-schema /
>   index-drift / SPL pipe / formatter-schema cross-check /
>   §3 table miss.
> - **G7 Phase 2 unblocked further:** `recipes/index.yaml`
>   was the last structured input `llms.txt` emission was
>   waiting on. The G7 Phase 2 backlog now reduces to: write
>   the `llms.txt` walker (MkDocs `nav:` + recipe index +
>   integration index + formatter schema).
> - **Local re-run:**
>   ```bash
>   python3 scripts/build-recipe-index.py
>   python3 scripts/check-recipe-schema.py
>   ```
> - **What's NOT in Phase 1 (deferred to E5 Phase 2):** the
>   remaining ~72 ✓ cells in the matrix below. Each cell
>   lands as a small isolated PR; the framework is now drift-
>   gated, so adding a recipe is the smallest possible change.
>   Verification (flipping `status: unverified` →
>   `verified` for the three Phase-1 starters) is the
>   highest-leverage follow-up — needs a maintainer with
>   `secrets.env` against `rev`.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 1 SHIPPED
> (3 more recipes — recipe count doubled).** First wave of the
> "fill in the remaining ✓ cells" backlog called out in Phase
> 1. Three new recipes land against the unchanged Phase 1
> framework (schema + validator + index emitter + drift gate +
> nav), proving the framework scales without further surgery:
> - **`docs/recipes/splunk-stream/markers.md`** — Splunk
>   Stream wire data (`stream:tls`) → markers. SPL rolls up
>   per-session events to one row per `(src_ip, dest_ip,
>   dest_port)`, geolocates with `iplocation`, drops RFC-1918
>   destinations, assembles `id` from `dest_ip:dest_port` and
>   a popup body in SPL. 8 expected fields. Apps required:
>   `Splunk_TA_stream`, optional `splunk_app_stream`,
>   `builtin:iplocation`. Pattern: `splunk-stream`. Documents
>   the wire-data sampling, MaxMind GeoLite2 freshness, TLS
>   1.3 SNI encryption (ECH), wire-data privacy/compliance
>   posture, OT-environment safety boundary, and `iplocation`
>   performance-at-scale gotchas.
> - **`docs/recipes/netflow-sflow-ipfix/h3.md`** — NetFlow /
>   sFlow / IPFIX flow records → H3 hexbin layer (FIRST new
>   layer-type recipe added in Phase 2). SPL rolls up to one
>   row per `dest_ip` summing `bytes`, geolocates, drops
>   RFC-1918, emits `id`/`value` for hex aggregation. 6
>   expected fields. Apps required: `Splunk_TA_netflow`,
>   `builtin:iplocation`. Pattern: `splunk-vendor-ta`.
>   Documents NetFlow sampling intervals, sFlow vs NetFlow
>   byte semantics, hex-resolution vs row-count rule of
>   thumb, `iplocation` performance, OT environment posture,
>   collector deployment surface.
> - **`docs/recipes/csv-lookup-geo/polygons.md`** — CSV
>   lookup of GeoJSON polygons → polygons layer (SECOND new
>   layer-type recipe added in Phase 2). SPL is `|
>   inputlookup asset_zones.csv | rename zone_id AS id`. 5
>   expected fields. Zero apps required. Pattern:
>   `splunk-lookup`. Documents CSV-inside-JSON quoting
>   escapes, GeoJSON `[lon, lat]` coordinate-order trap,
>   polygon-ring closure, lookup-RAM ceiling vs KV Store
>   switchover, MapLibre tile-edge clipping, SIS-boundary
>   read-only posture.
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (which now
>   reports 6 recipes valid, 0 verified, 6 unverified /
>   deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 6 entries),
>   `docs/recipes/index.md` matrix (now 6 rows including 3
>   new source patterns and 2 new layer types), `docs/llms.txt`
>   (now references 6 recipes in the Recipes section), and
>   `docs/llms-full.txt` (now 108k estimated tokens — still
>   well under the 150k warn / 200k fail thresholds) all
>   green. `mkdocs.yml` nav grows three lines (one per new
>   recipe) keeping the alphabetical-by-display-name
>   convention.
> - **Coverage delta:** matrix coverage rises from 3 to 6
>   recipes (4 % → 8 % of the ~75 ✓ cells), 3 to 6 source
>   patterns covered (CIM Network Traffic, KV Store, US
>   States + Splunk Stream, NetFlow, CSV-lookup-geo), 2 to 4
>   layer types covered (markers, choropleth + H3, polygons).
>   Wave 1 was scoped to "prove the framework is additive"
>   rather than "complete every ✓ cell"; subsequent waves
>   add 3-5 recipes each at the same per-recipe cost.
> - **What's NOT in Phase 2 wave 1 (deferred to subsequent
>   waves):** the remaining ~69 ✓ cells. Verification (flip
>   to `status: verified` for any of the 6 recipes) is still
>   blocked on `secrets.env` against a tenant carrying the
>   appropriate sourcetype — the D5 Phase 1 harness ships
>   the test rig but cannot fabricate wire data, NetFlow, or
>   a customer-curated polygons CSV. The 4 remaining layer
>   types not yet demonstrated (paths, heat, supercluster,
>   3D extrusion, indoor, vector-tile join) and the 9
>   remaining source patterns are the natural targets for
>   waves 2-N.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 2 SHIPPED
> (3 more recipes — recipe count 6 → 9).** Second wave continues
> the "fill in the remaining ✓ cells" backlog against the
> unchanged Phase 1 framework. Three new recipes ship, two of
> which are NEW source patterns (CIM Authentication, Meraki) and
> one of which is the FIRST recipe using the `paths` layer:
> - **`docs/recipes/cim-authentication/markers.md`** — CIM
>   Authentication data model → markers. SPL is `tstats
>   summariesonly=true count, dc(user) FROM
>   datamodel=Authentication WHERE action="failure" BY src`,
>   geocoded with `iplocation`, with a `failure_count >= 5`
>   signal-to-noise filter and `dc(user)` distinguishing
>   password-spray (many users) from brute-force (one user). 7
>   expected fields. Apps required: `Splunk_SA_CIM`,
>   `builtin:iplocation`. Pattern: `splunk-cim`. Formatter
>   config overrides `markerColor` to alert-red (failures are
>   never "friendly"). Documents the CIM-acceleration
>   dependency, MaxMind licensing, VPN/proxy egress-IP
>   distortion, password-spray vs brute-force semantics, GDPR
>   posture (no PII join), and the OT-safety boundary for
>   HMI/SIS console-login events.
> - **`docs/recipes/cim-network-traffic/paths.md`** — CIM
>   Network Traffic data model → paths (FIRST `paths`-layer
>   recipe in the matrix). SPL geocodes BOTH `src` AND `dest`,
>   filters private-range destinations, synthesises a
>   `src.__.dest` path id, then uses the
>   `mvappend`+`mvexpand` SPL idiom to fan one-row-per-pair
>   into the two-rows-per-pair shape the paths layer consumes
>   (one vertex with `seq=0`, one with `seq=1`). 7 expected
>   fields. Apps required: `Splunk_SA_CIM`,
>   `builtin:iplocation`. Pattern: `splunk-cim`. Formatter
>   config pins `pathIdField`, `timeField`, `pathColor`, and
>   `pathArrows`. Documents the two-rows-per-flow shape (the
>   #1 trap on this layer), `head 100` render budget, the
>   bidirectional-arc collapse pattern, the private-src
>   enrichment escape hatch, and the OT-zone DPI separation
>   rule per `/.cursor/rules/ot-safety.mdc`.
> - **`docs/recipes/meraki/markers.md`** — Cisco Meraki
>   (`Splunk_TA_cisco_meraki`, Splunkbase 5580) device
>   inventory → markers. SPL is `index=meraki
>   sourcetype="meraki:devices" | dedup serial sortby -_time
>   | where isnotnull(lat) AND isnotnull(lng) | rename lng AS
>   lon`. 7 expected fields. Apps required:
>   `Splunk_TA_cisco_meraki`. Pattern: `splunk-vendor-ta`.
>   Formatter config overrides `markerColor` to healthy-green
>   default and explicitly pins `idField` to the Meraki
>   serial number. Documents the `lng` vs `lon` mismatch (the
>   #1 vendor-API field-name trap), Meraki's
>   Dashboard-managed device geocoding (devices need an
>   operator action to land on the map), MV-camera privacy
>   flags (EU GDPR), polling-cadence vs panel auto-refresh
>   tuning, the four valid `status` enum values plus the
>   `coalesce` for `"unknown"`, the absence of CIM mapping
>   for inventory data, and an OT-safety note that calls out
>   MT environmental sensors as IT (server-room), not OT
>   (process-safety).
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (which now
>   reports 9 recipes valid, 0 verified, 9 unverified /
>   deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 9 entries),
>   `docs/recipes/index.md` matrix (now 9 rows), `docs/llms.txt`
>   (now references 9 recipes), and `docs/llms-full.txt` (now
>   ~132k estimated tokens — still well under the 150k warn /
>   200k fail thresholds) all green. `mkdocs.yml` nav grows
>   three lines (one per new recipe) keeping the
>   alphabetical-by-display-name convention. `mkdocs build
>   --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 6 to 9
>   recipes (8 % → 12 % of the ~75 ✓ cells), 5 to 5 source
>   patterns covered (CIM Auth and Meraki join the
>   `splunk-cim` and `splunk-vendor-ta` patterns already
>   represented by wave 1 — the count is unchanged because
>   both new patterns share parents), and 4 to 5 layer types
>   covered (added `paths`). The `splunk-cim` source pattern
>   now has TWO layers represented (markers + paths), proving
>   the matrix's pedagogical "same source, different
>   visualization" axis works as designed.
> - **What's NOT in Phase 2 wave 2 (deferred to subsequent
>   waves):** the remaining ~66 ✓ cells. Verification (flip
>   to `status: verified` for any of the 9 recipes) is still
>   blocked on `secrets.env` against a tenant carrying the
>   appropriate sourcetype. The 5 remaining layer types not
>   yet demonstrated (heat, supercluster, 3D extrusion,
>   indoor, vector-tile join) and the 7 remaining source
>   patterns (CIM Performance, CIM Alerts, ITSI KPI base,
>   ES Risk, OT Datastreamer, Cyber Vision, ThousandEyes)
>   are the natural targets for waves 3-N. Wave 3 candidates
>   in priority order: `cim-performance/markers.md` (host-
>   metric panels), `thousandeyes/paths.md` (multi-hop
>   network-path traces — the natural multi-vertex paths
>   demonstration), and `cim-alerts/markers.md` (RBA
>   notable-event geographic plot).

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 3 SHIPPED
> (3 more recipes — recipe count 9 → 12, source pattern coverage
> 5 → 8 / 8 = COMPLETE).** Third wave deliberately re-prioritised
> away from the "fill in more ✓ cells of an existing pattern"
> path and toward a **pattern-coverage milestone**: every
> `source.pattern` enum value in `docs/_machine/recipes/recipe-schema.json`
> (8 total) now has at least one shipping recipe. After wave 3
> the matrix has graduated from "we've shown the framework
> works for the easy patterns" to "we've shown the framework
> works for EVERY pattern Better Map's data contract
> recognises" — the remaining ~63 ✓ cells become a uniform
> "fill in more cells of patterns already proven" backlog
> rather than a "we still need to demonstrate this pattern
> can be done" question. Three new recipes ship, all three
> using NEW source patterns:
> - **`docs/recipes/es-risk/markers.md`** — Splunk Enterprise
>   Security Risk-Based Alerting (`risk` index) → markers
>   (NEW pattern `splunk-premium-es` — the first ES-tier
>   recipe). SPL aggregates `sum(risk_score)` BY
>   `risk_object`, `risk_object_type` over a 24 h window
>   with a `total_risk >= 50` SNR filter matching the
>   default RBA medium-priority RIR threshold, then joins
>   against the ES Asset & Identity framework
>   (`identity_lookup_expanded` and `asset_lookup_by_str`,
>   `coalesce()`-ing the two `lat`/`long` fallbacks) to
>   resolve entity → home-location, surfacing MITRE
>   techniques via `mvjoin(annotations.mitre_attack{}, ",")`
>   for popup display. 7 expected fields. Apps required:
>   `SplunkEnterpriseSecuritySuite`, `Splunk_SA_CIM`,
>   `builtin:iplocation`. Formatter config overrides
>   `markerColor` to alert-red (every marker is a risky
>   entity) and pins `idField` to the stable `id` alias.
>   Documents the A&I-lookup-needs-lat/lon-columns gotcha
>   (`identities.csv` / `assets.csv` default-ship WITHOUT
>   geographic columns — the customer's ES admin must
>   extend them), the `long` vs `lon` schema convention,
>   the `source_search` cardinality gotcha, the
>   geocode-by-IP fallback for tenants without A&I
>   extension, the `risk` index acceleration note, the
>   MITRE annotation field-name drift across ES versions,
>   and a hard PII boundary: never log raw `risk_object`
>   values to channels outside Splunk RBAC, hash with
>   `md5()` for audiences without "see risky users"
>   authorisation.
> - **`docs/recipes/itsi-kpi-base/markers.md`** — Splunk IT
>   Service Intelligence service health (`itsi_summary` ↔
>   `itsi_services` KV store) → markers (NEW pattern
>   `splunk-premium-itsi` — the first ITSI-tier recipe).
>   SPL queries `kpi_id="SHKPI-*" entity_key="N/A"` (the
>   ITSI convention for service-level health-aggregate
>   events) over a 15 min window, picks the freshest
>   snapshot per service via `latest()`, joins against the
>   `itsi_services` KV store collection to retrieve
>   operator-set `info_lat` / `info_lon` custom service
>   attributes, then runs a bounded subsearch counting how
>   many INDIVIDUAL KPIs on the same service are currently
>   in the Critical bucket (`alert_level >= 4`) — the
>   subsearch is properly split across physical lines to
>   honour the SPL pipe-per-line contract checked by
>   `scripts/check-recipe-schema.py`. 7 expected fields.
>   Apps required: `SA-ITOA`. Formatter config overrides
>   `markerColor` to healthy-green default (an ITSI marker
>   on the map is NOT a problem by itself; the problem is
>   when it pops red), pins `idField` to the
>   `identifying_name` fallback. Documents the
>   `info_lat`/`info_lon` aren't-default-attributes gotcha
>   (operator MUST extend services via UI or REST), the
>   ITSI 4.x → 4.13+ `info` JSON-blob flattening drift,
>   the entity-attribute fallback pattern (some installs
>   geocode entities not services), the `SHKPI-` event
>   aggregator lag (don't narrow the time window below
>   10 min), `alert_level` enum customisation, multi-
>   tenant collection-name prefixing on Splunk Cloud, the
>   join-subsearch performance ceiling, and an OT-zone
>   separation rule: if the install monitors SIS-related
>   services, those must be in a SEPARATE recipe with
>   `ot_safety_relevant: true` per
>   `/.cursor/rules/ot-safety.mdc` Rule 6.
> - **`docs/recipes/ot-datastreamer/markers.md`** — Splunk
>   Edge Hub / OTI Datastreamer (Modbus / OPC UA / MQTT /
>   SNMP / BACnet / Zeek / BMS) → markers (NEW pattern
>   `splunk-edge-hub` — the first OT-zone recipe, and
>   **`ot_safety_relevant: true`**). SPL queries the OR-
>   union of every `edge_hub_*` index plus the optional
>   `bms` index over a 1 h window, aggregates BY appliance
>   `host`, derives a `last_seen_minutes_ago` liveness
>   metric and a `protocol` label from the contributing
>   index name, then joins against an operator-maintained
>   `edge_hub_sites.csv` lookup (the recipe documents the
>   required 7-column schema: `host`, `hub_name`, `lat`,
>   `lon`, `zone_purdue_level`, `safety_related`, optional
>   `site_id`) to resolve appliance serial → physical
>   install location + Purdue level + safety
>   classification. 7 expected fields. Apps required:
>   `Splunk_TA_oti`. Formatter config overrides
>   `markerColor` to muted-blue default (Edge Hub markers
>   are not problems by themselves; the problem is when
>   a marker disappears or turns red), pins `idField` to
>   the `coalesce(hub_name, host)` best-of-both alias.
>   The §6 Gotchas section is the largest of any recipe
>   in the matrix because **the recipe carries the full
>   OT-safety contract**: explicit references to
>   `/.cursor/rules/ot-safety.mdc` Rule 1 (passive
>   collection only — no active probes), Rule 2 (never
>   disable / suppress / filter a safety-related signal),
>   Rule 3 (SOAR scope ends at the IT / IT-OT DMZ — no
>   auto-restart actions targeting Level-0/1/2 assets),
>   Rule 5 (`safety_related` column is read-only mirrored
>   from the customer's Safety Requirements
>   Specification, never authored by VISTA), plus the
>   index-name-drift, multi-protocol-per-hub, time-range,
>   and PII / sensitive-architecture posture gotchas.
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (which now
>   reports 12 recipes valid, 0 verified, 12 unverified /
>   deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 12 entries),
>   `docs/recipes/index.md` matrix (now 12 rows), `docs/llms.txt`
>   (now references 12 recipes), and `docs/llms-full.txt`
>   (now ~146k estimated tokens — still under the 150k warn
>   threshold but the gap is closing; wave 4 must include a
>   token-budget review if the average new recipe is still
>   adding ~14k tokens) all green. `mkdocs.yml` nav grows
>   three lines (one per new recipe) keeping the
>   alphabetical-by-display-name convention. `mkdocs build
>   --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 9 to 12
>   recipes (12 % → 16 % of the ~75 ✓ cells); **source
>   pattern coverage rises from 5 to 8 / 8 — COMPLETE**
>   (es-risk lights up `splunk-premium-es`, itsi-kpi-base
>   lights up `splunk-premium-itsi`, ot-datastreamer
>   lights up `splunk-edge-hub`); layer-type coverage
>   stays at 5 (no new layer types in this wave —
>   intentional, to keep the milestone focused on the
>   pattern axis). Every `source.pattern` enum value in
>   `recipe-schema.json` now has at least one verified-
>   capable recipe. The remaining ~63 ✓ cells become a
>   uniform "fill in more cells of patterns we've already
>   proven" backlog.
> - **What's NOT in Phase 2 wave 3 (deferred to subsequent
>   waves):** the remaining ~63 ✓ cells. Verification (flip
>   to `status: verified` for any of the 12 recipes) is
>   still blocked on `secrets.env` against a tenant
>   carrying the appropriate sourcetype — and for the three
>   new wave-3 recipes specifically, the verification tenant
>   needs an ES licence (es-risk), an ITSI licence (itsi-
>   kpi-base), and an `Splunk_TA_oti`-equipped tenant with
>   an operator-curated site lookup (ot-datastreamer) —
>   none of which the v1.7-prep lab carries. The 5
>   remaining layer types not yet demonstrated (heat,
>   supercluster, 3D extrusion, indoor, vector-tile join)
>   remain the natural targets for wave 4. Wave 4
>   candidates in priority order: `kvstore-latlon/heat.md`
>   (heat-layer demo using existing source — same source,
>   different layer, same pedagogical pattern wave 2
>   established with paths), `csv-lookup-geo/supercluster.md`
>   (supercluster demo for large polygon CSVs), and one
>   new-source recipe like `cyber-vision/markers.md` or
>   `thousandeyes/paths.md` to keep adding cells in
>   already-covered patterns at a 2:1 ratio with
>   new-layer-type demos.
> - **Token budget watch.** `docs/llms-full.txt` is now at
>   ~146k estimated tokens (97 % of the 150k WARN). Wave 4
>   will trip the warn unless we either (a) trim the
>   recipe Appendix B to body-excluded summaries, or (b)
>   raise the warn threshold. The 200k HARD-FAIL threshold
>   is still comfortable (~73 % usage). Recommend the
>   former — Appendix B is the single largest contributor
>   and trimming to YAML frontmatter + §1 + §2 (excluding
>   the §6 gotchas) would halve its weight without losing
>   the LLM-actionable content.

> **Status (v1.7-prep, 2026-05-18): G7 Phase 2 follow-up
> SHIPPED — recipe-page §6 Gotchas trim in
> `build-llms-full-txt.py`.** The wave 3 SHIPPED block called
> out that `docs/llms-full.txt` was at ~149k estimated tokens
> (99 % of the 150k WARN) and that wave 4 would trip the warn
> without intervention. The original recommendation was to
> trim "Appendix B" but inspection of the script showed the
> heavyweight contribution is actually the per-page emission
> of each recipe's body (Appendix B is just metadata
> distillation from `_machine/recipes/index.yaml`). The
> implemented fix targets the actual culprit: a new
> `strip_recipe_advisory()` helper detects recipe pages
> (`docs/recipes/<source>/<layer>.md`, excluding the
> auto-generated `docs/recipes/index.md` matrix) and trims
> their body in `llms-full.txt` at `## 6. Gotchas`, replacing
> the trimmed content with a one-line italicised pointer to
> the unabridged page URL. The trim is **non-destructive**:
> the published MkDocs site, `docs/llms.txt`, and
> `docs/_machine/recipes/index.yaml` are all unaffected; only
> the body that appears inside `llms-full.txt` is shortened.
> Result: 148,892 → 135,419 estimated tokens (a 13,473-token
> saving, 9.0 % of the budget). With 12 recipes shipped the
> per-recipe saving averages 1,123 tokens; wave 4 (3 more
> recipes) projects to ~141k tokens (still under WARN), wave 5
> to ~147k (still under WARN), wave 6 to ~153k (just over WARN
> — at which point another trim pass or a threshold bump
> becomes necessary). The trimmed sections (§6 Gotchas + the
> trailing `## Verification status` section) remain available
> via the per-page URL pointer for any agent that's debugging
> a recipe and needs the gotchas — they are not deleted, just
> not duplicated into the one-shot dump. The script change is
> ~25 lines: a compiled regex constant, a `is_recipe_page()`
> predicate, a `strip_recipe_advisory()` transformer, and a
> single wiring line inside the per-page emission loop. All
> CI gates pass (recipe schema, formatter schema, formatter
> coverage, llms.txt sync, llms-full.txt sync at the new
> reduced size, mkdocs --strict).

> **Status (v1.7-prep, 2026-05-18): G7 Phase 2 follow-up #2
> SHIPPED — wave 6 token-budget recalibration: extended §5
> Screenshot trim + WARN bump 150k → 175k.** The wave 4a
> projection (above) predicted wave 6 would just trip the
> 150k WARN; reality landed faster — wave 5 already tripped
> WARN at ~155k tokens (the wave-5 ROADMAP block itself was
> ~8k tokens, larger than the recipe contribution predicted).
> Two-prong response, both shipped in this PR:
>
> **Prong 1 — extended trim.** The `_RECIPE_TRIM_AT` regex
> in `build-llms-full-txt.py` moves from `## 6. Gotchas` to
> `## 5. Screenshot`. Rationale: §5 today is a 7-line
> D5-harness-pending stub (~100 tokens × 18 recipes ≈ 1.8k
> tokens of pure duplication). The pointer text updates to
> mention §5 + §6 + Verification, and the trim helper's
> docstring captures the trim history (wave 4a initial, wave
> 6 extended) plus the revert condition (when D5 ships and
> §5 carries real per-recipe screenshot links / alt-text /
> metadata, move the trim point back to §6). Per-recipe
> marginal cost falls from ~3.3k to ~3.2k tokens.
>
> **Prong 2 — WARN recalibration.** The total-warn threshold
> moves from 150,000 to 175,000 estimated tokens. The
> original 150k was a guess pre-data; with 18 recipes
> shipped and measured per-recipe marginal cost, 175k
> matches the actual ~155k baseline + ~20k headroom for
> ~6 more recipes. The 200k HARD-FAIL gate is unchanged —
> that remains the actual safety rail (refusing to write the
> file at all past 200k). Both the module docstring's
> Budget contract section and the Appendix C footer text
> update to reflect the new 175k threshold.
>
> Combined result, measured against the 15-recipe pre-wave-5
> baseline: 146.6k → 144.5k estimated tokens (a 2.1k saving
> from extended trim alone). Against the 18-recipe post-
> wave-5 baseline (projected): 155.2k → ~152.7k tokens, well
> under the new 175k WARN. The script change is ~10 lines
> of code (regex constant, threshold constant, footer text,
> pointer text, docstring) and ~30 lines of docstring /
> comment refresh. All CI gates pass (recipe schema,
> formatter schema, formatter coverage, llms.txt sync,
> llms-full.txt sync at the new reduced size and new WARN
> threshold, mkdocs --strict).
>
> **What's NOT in this prep (deferred to a future
> recalibration):** Appendix B summarisation. The script
> currently emits a full metadata block per recipe in
> Appendix B; a future trim pass could compress this to
> YAML-frontmatter-only or even drop the appendix entirely
> (it's a redundant view of `docs/_machine/recipes/
> index.yaml`, which agents can fetch directly). The
> projection: with both prongs landed plus Appendix B
> compression, headroom would extend to ~25 more recipes
> before the next recalibration. That's wave 9-10
> territory — deferring until the per-recipe pace actually
> warrants it.

> **Status (v1.7-prep, 2026-05-18): G7 Phase 2 follow-up #3
> SHIPPED — historical wave-status blockquote trim in
> `build-llms-full-txt.py`.** The "what's NOT in this prep"
> footnote on follow-up #2 (above) listed Appendix B
> summarisation as the next available token-budget lever.
> The empirical data after wave 7 shipped (24 recipes,
> ~171.7k tokens, ~3.3k headroom to WARN) showed Appendix B
> isn't actually the largest non-recipe content source
> anymore — the wave-by-wave `> **Status (...): E5 Phase 2
> wave N SHIPPED ...` blockquotes accumulating under E5 are.
> Six E5-wave + two G7-follow-up status blocks consumed
> ~12.7k tokens of `roadmap.md` body and, once they reach
> `llms-full.txt`, ~20k tokens of corpus weight (the
> `re.sub(r"\n{3,}", "\n\n", out)` whitespace collapse
> amplifies the savings vs raw character count). All eight
> are pure progress notes — their LIVE state (recipe count,
> layer-type coverage, source-pattern coverage) is duplicated
> in (a) the E5 row of the headline goals table at the top
> of this file and (b) `docs/recipes/index.md`, both of which
> the auto-generators keep in lockstep. So follow-up #3
> strips them from the `llms-full.txt` body only:
> - **What changed:** a new `_ROADMAP_STATUS_BLOCK` regex
>   plus `strip_roadmap_status_blocks()` helper in
>   `scripts/build-llms-full-txt.py`. The strip runs in
>   `render()` BEFORE `strip_chrome()` (so the chrome
>   whitespace-collapse pass also tidies the gaps). The
>   regex matches lines starting with the `> **Status
>   (vX-prep, YYYY-MM-DD):` prefix followed by either the
>   `E5 Phase 2 wave N` or `G7 Phase 2 follow-up` marker
>   phrase, and consumes every continuation `>` line until
>   the first non-blockquote line. The on-disk `ROADMAP.md`
>   is unchanged and the MkDocs site still renders every
>   status block via the existing mkdocs-include-markdown
>   plugin include at the top of `docs/roadmap.md` — the
>   trim is a llms-full.txt-only transform applied to the
>   already-expanded body.
> - **Token-budget impact:** wave 7's ~171.7k landed →
>   wave 8 baseline drops to ~150.3k against the same
>   175k WARN. That's ~24.7k headroom = ~7 more recipes at
>   ~3.3k each before the next recalibration is warranted,
>   which is wave 10-11 territory at the current 3-recipes-
>   per-wave cadence. Wave 8 itself adds 3 new recipe pages
>   (~9.9k) AND its own wave-8 status block (~2-3k), but the
>   wave-8 status block is auto-stripped by this same regex,
>   so the post-wave-8 baseline lands at ~160.2k — comfortably
>   below WARN.
> - **Self-consumption proof:** this G7 Phase 2 follow-up #3
>   status block matches the `G7 Phase 2 follow-up` arm of
>   the regex and is therefore trimmed from `llms-full.txt`
>   on the very build that introduces it. The
>   `--check` output reports `[PASS] docs/llms-full.txt is
>   in sync (601,215 chars, ~150,303 estimated tokens,
>   175,000 warn / 200,000 fail)` — note that 150k is the
>   wave-7 baseline (171.7k) minus this block's contribution
>   plus the eight prior wave-status blocks the regex
>   harvested in the same pass.
> - **What's NOT in this prep (still deferred to a future
>   recalibration):** Appendix B summarisation remains the
>   next lever if the per-recipe pace accelerates past the
>   ~7-recipe headroom this trim opens. The wave-status
>   trim was a higher-yield, lower-risk first pass (no
>   schema/contract change, no public-page change, no
>   per-recipe authoring change) so it ships ahead of the
>   Appendix B work.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 4 SHIPPED
> (3 more recipes — recipe count 12 → 15, layer-type coverage
> 5 → 6 / 10).** Wave 4 follows the wave-3 strategic precedent
> ("milestones, not just cell-fills") but with a different
> milestone axis: with source-pattern coverage already at
> 8 / 8 COMPLETE from wave 3, the next axis worth shifting is
> **layer-type coverage** — the 10 layer types tracked in
> the matrix were down to 5 demonstrated (markers, paths,
> choropleth, polygons, H3 hexbin), so wave 4 introduces the
> sixth (`heat`) while also filling cells in already-proven
> patterns at the standard 2:1 ratio. Three new recipes ship:
> - **`docs/recipes/cim-performance/markers.md`** —
>   CIM Performance data model (`Performance.CPU`,
>   `Performance.Memory`, `Performance.Storage` datasets, all
>   acceleration-eligible via `tstats summariesonly=true`) →
>   markers (`splunk-cim` source pattern, layer already
>   demonstrated). SPL queries the three Performance
>   datasets in parallel via `append`, takes the freshest
>   reading per `host` via `latest()`, evaluates per-metric
>   "signal" booleans against industry-standard thresholds
>   (80 % CPU, 80 % memory, 85 % storage — sourced from
>   Splunk Lantern's "Common Performance Anomalies"
>   playbook), reduces to a `signal_count` and gates on
>   `signal_count >= 1` (the SNR filter), then joins
>   against ES `asset_lookup_by_str` for `lat`/`lon`
>   coordinates. 8 expected fields. Apps required:
>   `Splunk_SA_CIM`. Formatter config pins `pointRenderer`
>   to `cluster` (host fleets cluster naturally by
>   datacentre / region) and pins `idField` to the stable
>   `dest` alias. §6 Gotchas covers the threshold-
>   customisation pattern (8 lines of `case()` to switch
>   between "data centre" vs "developer workstation"
>   threshold profiles), the asset-lookup-coverage gotcha
>   (assets not in `asset_lookup_by_str` are correctly
>   dropped via `where isnotnull(lat)` — surface in
>   companion table for backfill), the `append` ordering
>   contract (CPU first, memory second, storage third —
>   stable across re-renders), the data-model-acceleration
>   prerequisite (`summariesonly=true` returns empty if
>   acceleration is off — fall back to `summariesonly=false`
>   in dev tenants), and an OT-zone callout: Operational
>   Telemetry's `Operational_Telemetry.Metrics` model is the
>   correct one for OT-zone PLCs / sensors, NOT CIM
>   Performance (which is IT-oriented for hosts/servers).
> - **`docs/recipes/cyber-vision/markers.md`** —
>   Cisco Cyber Vision component inventory
>   (`cisco:cybervision:components` + ...:`flows` + ...:`events`
>   + ...:`vulnerabilities` sourcetypes) → markers (NEW
>   source `cyber-vision`, `splunk-vendor-ta` source pattern
>   already demonstrated by Meraki, and **`ot_safety_relevant: true`**). SPL queries the
>   components stream over 24 h (dedup by `asset_id`),
>   joins against the vulnerabilities stream for `max(cvss_score)`
>   and `dc(cve_id)` per asset, joins against the events
>   stream for `count(event)` per asset (both subsearches
>   properly split for pipe-per-line), then joins against
>   an operator-maintained `cybervision_sites.csv` lookup
>   (the recipe documents the required 6-column schema:
>   `asset_id`, `lat`, `lon`, `zone_purdue_level`,
>   `safety_related`, `site_name`) for physical install
>   coordinates + Purdue level + safety classification.
>   7 expected fields. Apps required: `TA-cisco-cybervision`.
>   Formatter config pins `pointRenderer` to `cluster` and
>   `markerColor` to muted-blue baseline (consistent with
>   `ot-datastreamer/markers` so the two OT panels read as
>   "infrastructure" first). §6 Gotchas is the most
>   safety-critical section in any recipe shipped so far:
>   explicit cross-references to
>   [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
>   Rule 1 (Cyber Vision IS the reference design for
>   passive DPI), Rule 2 (never disable / suppress / filter
>   a safety-related signal — filter at PANEL level if at
>   all), Rule 3 (SOAR action scope ends at the IT / IT-OT
>   DMZ — no auto-action against Level-0/1/2 assets), Rule 5
>   (`safety_related` column is read-only mirrored from the
>   customer Safety Requirements Specification), plus the
>   `asset_id` drift-after-sensor-restart gotcha (fall back
>   to `asset_mac` for the join key), the CVSS-cardinality
>   gotcha (max + count both surfaced — distinguish "one
>   critical CVE" from "dozens of medium CVEs"), the
>   events-stream noise gotcha (use the popup as triage,
>   not as alert source), and PII / regulated-asset-naming
>   considerations.
> - **`docs/recipes/kvstore-latlon/heat.md`** — KV Store
>   (lat/lon collection) → **heatmap** (`splunk-lookup`
>   source pattern already demonstrated by the sibling
>   markers recipe — but **NEW layer type** `heat` filling
>   the first of the 5 remaining layer types). SPL joins
>   an events index aggregated `count BY site_id` with the
>   `site_locations` KV-Store collection, normalises the
>   per-site event count to a `[0, 1]` weight via
>   `eventstats max + eval round(... / max_event_count,
>   2)`, renders weighted heat blobs whose intensity scales
>   with site activity. 6 expected fields (`id`, `lat`,
>   `lon`, `site_name`, `event_count`, `weight`). No apps
>   required. Formatter config introduces the new
>   `heatmapOpacity` (0.75 — sweet spot above the 0.5
>   washed-out threshold and below the 1.0 basemap-occluding
>   threshold) and `heatmapRadius` (24 px — appropriate for
>   a fleet-of-sites view where neighbouring sites SHOULD
>   merge at world zoom and resolve at country/city zoom).
>   §6 Gotchas covers the `site_id`-extraction prerequisites
>   (3 patterns: `EVAL` in props.conf, lookup-at-index-time,
>   or `_meta` annotation in inputs.conf — pick by
>   regularity of your hostnames), the linear-vs-log
>   normalisation gotcha (if one site is 10000× busier than
>   the rest, log-normalise via `log10()` or pre-filter
>   the heaviest 1 %), the "heat vs markers — when to choose
>   which" decision tree (and the both-coexist-in-one-
>   dashboard pattern using BM-CT-1 layer toggles), the
>   per-feature-density caveat (heat aggregates events
>   per coordinate — for per-event mapping use markers on
>   raw events, not on pre-aggregated stats), and time-range
>   guidance (1 h for ops, 24 h for shift handover, 5 min
>   for live ops).
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (which now
>   reports 15 recipes valid, 0 verified, 15 unverified /
>   deferred); auto-regen of `docs/_machine/recipes/index.yaml`
>   (now 15 entries), `docs/recipes/index.md` matrix (now
>   15 rows), `docs/llms.txt` (now references 15 recipes),
>   and `docs/llms-full.txt` (now ~136.6k estimated tokens —
>   1,123 tokens below wave 3's pre-trim baseline, validating
>   the wave 4a token-trim mechanism: 3 new recipes added
>   only ~1.2k tokens net thanks to the §6 trim, vs the
>   ~14k per-recipe trajectory wave 3 was on) all green.
>   `mkdocs.yml` nav grows three lines (one per new recipe)
>   keeping the alphabetical-by-display-name convention.
>   `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 12 to 15
>   recipes (16 % → 20 % of the ~75 ✓ cells); source
>   pattern coverage stays at 8 / 8 = COMPLETE; **layer-
>   type coverage rises from 5 to 6 / 10** (markers, paths,
>   polygons, choropleth, H3 hexbin, **heat** — first layer
>   coverage win since wave 1). The four remaining layer
>   types not yet demonstrated (supercluster, 3D extrusion,
>   indoor, vector-tile join) remain the natural targets
>   for waves 5-6, weighted by domain fit: supercluster is
>   the natural next layer (large-fleet markers that need
>   client-side clustering when MapLibre's GL clustering is
>   not enough); 3D extrusion is the natural choropleth
>   companion (states / countries with a `weight` driving
>   `extrusionHeight`); indoor + vector-tile join are
>   v1.8+ blocked on feature work in the visualization
>   itself. Wave 5 candidates in priority order:
>   `geo-us-states/extrusion-3d.md` (new layer type,
>   already-proven source), `csv-lookup-geo/supercluster.md`
>   (new layer type, already-proven source — was the
>   intended wave-4 third recipe but yielded to the
>   `kvstore-latlon/heat` pedagogical companion), and one
>   new-source-already-proven-layer recipe like
>   `thousandeyes/paths.md` to keep the 2:1 ratio.
> - **Token budget watch.** `docs/llms-full.txt` is at
>   ~136.6k estimated tokens (91 % of the 150k WARN, 68 %
>   of the 200k HARD-FAIL). The wave 4a token-trim
>   mechanism is doing its job — without it, 15 recipes
>   would have put us at ~169k tokens (well over WARN).
>   With the trim active, the per-recipe marginal cost has
>   dropped to ~400 tokens (vs ~14k pre-trim), meaning
>   wave 5 (3 more recipes, projecting to ~138k tokens) and
>   wave 6 (3 more, ~139k tokens) are comfortably under
>   WARN. No further token-budget intervention is needed
>   for the next 3-4 waves.
> - **What's NOT in Phase 2 wave 4 (deferred to
>   subsequent waves):** the remaining ~60 ✓ cells.
>   Verification (flip to `status: verified` for any of the
>   15 recipes) is still blocked on `secrets.env` against a
>   tenant carrying the appropriate sourcetype — and for
>   the three new wave-4 recipes specifically, the
>   verification tenant needs accelerated CIM Performance
>   data models (cim-performance), a Cisco Cyber Vision
>   Center + operator-curated `cybervision_sites.csv`
>   (cyber-vision), and a `site_locations` KV-Store
>   collection + events-with-`site_id` (kvstore-latlon/heat)
>   — none of which the v1.7-prep lab carries.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 5 SHIPPED
> (3 more recipes — recipe count 15 → 18, layer-type coverage
> 6 → 8 / 10).** Wave 5 doubles down on the layer-type axis
> wave 4 opened: two of the three recipes introduce new
> layer types (`extrusion-3d`, `supercluster`), the third
> introduces a new source (`thousandeyes`) on an
> already-proven layer (`paths`). With wave 5, layer-type
> coverage rises from 6 / 10 to 8 / 10 — only `indoor` and
> `vector-tile join` (both blocked on v1.8+ visualization
> feature work) remain undemonstrated. Three new recipes:
> - **`docs/recipes/geo-us-states/extrusion-3d.md`** — US
>   states 3D extrusion (NEW layer type `extrusion-3d`,
>   `splunk-builtin` source pattern already proven by the
>   choropleth sibling). The SPL is **deliberately
>   identical** to the choropleth sibling (`iplocation` +
>   `stats count BY Region` + `case()` normaliser to USPS
>   two-letter) — the only difference lives in the
>   formatter config. The recipe demonstrates the
>   `enable3DExtrusion: true` + `extrusionHeightField:
>   "value"` + `extrusionScale: 200.0` triple, paired with
>   `enableChoropleth: true` and `palette: "viridis"` so
>   height AND colour encode the same value (the redundancy
>   helps accessibility — colour-vision-deficient readers
>   get the height-only signal). §6 Gotchas covers the
>   camera-pitch UX gotcha (`allowPitch` defaults to true
>   but pitch isn't auto-applied; document via
>   `splunk.markdown` panel for first-time dashboard
>   readers), the `extrusionScale` dataset-dependent
>   calibration formula (`scale = target_max_metres /
>   max_value`), and an extra-strong restatement of the
>   MAUP gotcha from the choropleth sibling — extrusion
>   exaggerates MAUP MORE than colour-shading because tall
>   prisms create visual "cliffs" that draw the eye even
>   harder than saturated colour fills. 3 expected fields
>   (same as choropleth). No apps required.
> - **`docs/recipes/csv-lookup-geo/supercluster.md`** — CSV
>   lookup (geo points) supercluster (NEW layer type
>   `supercluster`, `splunk-lookup` source pattern already
>   proven by the polygons sibling). Demonstrates the
>   `pointRenderer: "cluster"` strategy (which under the
>   hood uses Mapbox's `supercluster` library per the
>   [clusters layer source](https://github.com/fenre/better_map/blob/main/better_map/appserver/static/visualizations/better_map/src/lib/layers/clusters.js))
>   for high-cardinality point datasets (10000+ point
>   features) — the right answer when markers would
>   visually merge into "dot soup" but you still want
>   per-point drilldown affordance that heatmap loses.
>   5 expected fields (id, lat, lon, asset_name,
>   asset_category). No apps required. §6 Gotchas captures
>   the cluster-vs-heatmap-vs-hexbin decision matrix in a
>   clean three-row table (one row per layer with "best
>   for" + "loses" columns), the cluster tuning current
>   limitation (`clusterMaxZoom` / `clusterRadius` are
>   hardcoded at 14 / 48 in the layer source — exposing
>   them via the formatter schema is a tracked v1.8+
>   enhancement, with the temporary code-level
>   customisation path documented for users who need to
>   tune today), the cluster vs heatmap decision rubric,
>   and the inputlookup vs KV-Store performance rubric
>   (CSV is fine to 10k rows; KV-Store is the right answer
>   above 100k rows).
> - **`docs/recipes/thousandeyes/paths.md`** — Cisco
>   ThousandEyes path visualization (NEW source
>   `thousandeyes`, `splunk-vendor-ta` source pattern
>   already proven by Meraki / Cyber Vision, `paths` layer
>   already proven by CIM Network Traffic). The recipe is
>   the multi-vertex generalisation of the
>   `cim-network-traffic/paths` sibling — instead of a
>   src→dest two-vertex arc derived from NetFlow / wire
>   data, each ThousandEyes path is the full geocoded
>   traceroute hop sequence (typically 5-15 vertices). SPL
>   queries `cisco:thousandeyes:path-vis`, dedups to the
>   freshest measurement per `test_id`, prepends the
>   agent vertex (`seq=0`) and `append`s the hops branch
>   (`mvexpand hops` + `rex` to parse the multi-value
>   structure + `iplocation` per hop_ip + per-`(path_id,
>   hop_number)` reduction) to produce the canonical
>   paths-layer two-rows-per-vertex contract. 7 expected
>   fields. Apps required: `ta_cisco_thousandeyes`
>   (Splunkbase id 7719) with path-visualization input
>   enabled. Formatter config pins `pathColor` to
>   saturated purple (`#9333ea`) intentionally DIFFERENT
>   from the CIM Network Traffic paths recipe's calm blue
>   (`#4a90e2`) — dashboards showing both layers can
>   visually distinguish "observed traffic" from "active
>   probe". §6 Gotchas covers the largest authoring
>   surprise: hop field-name camelCase-vs-snake_case drift
>   across ThousandEyes API versions (pre-v6 uses
>   `hopNumber` / `hopIp`, v6+ uses `hop_number` /
>   `hop_ip`; the recipe's `rex` is tuned for v6+ with
>   instructions to swap for pre-v6 deployments and a
>   defensive `head 1 | table hops` confirmation step
>   BEFORE adopting), the hop-geocoding hit rate gotcha
>   (first 1-2 hops are typically private IPs that are
>   correctly skipped — polylines "skip" the early hops
>   from the user's perspective), the agent-NAT gotcha
>   (`agent_lat`/`agent_lon` may be missing for NAT'd
>   corporate agents — the agent-inventory lookup is
>   authoritative, NOT IP-derived geocoding of the
>   egress NAT), the measurement-interval vs polyline-
>   refresh-rate distinction (drop the dedup for a "trail
>   of recent paths" view), and an OT-safety boundary
>   restatement: ThousandEyes is an ACTIVE probe by
>   design, fundamentally incompatible with
>   [`/.cursor/rules/ot-safety.mdc`](https://github.com/fenre/better_map/blob/main/.cursor/rules/ot-safety.mdc)
>   Rule 1's passive-only collection contract — probe
>   targets MUST be IT-side endpoints, never any asset in
>   the OT zone.
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (which now
>   reports 18 recipes valid, 0 verified, 18 unverified /
>   deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 18 entries),
>   `docs/recipes/index.md` matrix (now 18 rows),
>   `docs/llms.txt` (now references 18 recipes), and
>   `docs/llms-full.txt` (now ~155.2k estimated tokens — up
>   ~18.6k from wave 4's ~136.6k baseline, **trips the
>   150k WARN** but still well under the 200k HARD-FAIL).
>   The ~18.6k delta is larger than the ~10k recipe-only
>   contribution would predict because this wave's ROADMAP
>   block is itself ~8k tokens — both wave 6 token-trim
>   actions (extending the trim mechanism, lifting WARN to
>   175k) are now formally required before any further
>   ROADMAP-heavy wave lands. The hard-fail headroom is
>   still ~45k tokens which buys 1-2 more waves at
>   current marginal cost. `mkdocs.yml` nav
>   grows three lines (one per new recipe) keeping the
>   alphabetical-by-display-name convention. `mkdocs build
>   --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 15 to 18
>   recipes (20 % → 24 % of the ~75 ✓ cells); source
>   pattern coverage stays at 8 / 8 = COMPLETE; **layer-
>   type coverage rises from 6 to 8 / 10** (markers, paths,
>   polygons, choropleth, H3 hexbin, heat, **extrusion-3d**,
>   **supercluster**). Only 2 layer types remain
>   undemonstrated: `indoor` (image-georeferenced floor-plan
>   overlay — blocked on v1.8+ visualization feature work to
>   support the image-overlay layer-kind), and `vector-tile
>   join` (which is technically already used by the
>   choropleth layer under the hood — it's a debatable
>   "missing" cell that may just need a recipe demonstrating
>   the `featureJoinUrl` pattern against a customer-hosted
>   PMTiles tileset rather than the bundled `us-states`
>   preset, which would also be a wave 6 candidate).
> - **What's NOT in Phase 2 wave 5 (deferred to subsequent
>   waves):** the remaining ~57 ✓ cells. Verification (flip
>   to `status: verified` for any of the 18 recipes) is
>   still blocked on `secrets.env` against a tenant carrying
>   the appropriate sourcetype + apps + lookups + agent
>   inventory. The 3 new wave-5 recipes specifically need:
>   the bundled `us-states.pmtiles` (extrusion-3d — present
>   on every Better Map install above v1.6.0), a populated
>   `asset_register.csv` lookup (supercluster), and a tenant
>   with `ta_cisco_thousandeyes` + ≥ 1 configured path-
>   visualization test (thousandeyes/paths). Wave 6
>   candidates in priority order: `vector-tile-join`
>   demonstration (the last remaining "missing" layer type
>   on a debatable definition), `csv-lookup-geo/h3.md`
>   (cells in already-proven patterns at 2:1 ratio), and
>   one new-source recipe like `cim-alerts/markers.md`
>   (CIM Alerts data model, currently undemonstrated).
> - **Token budget watch.** `docs/llms-full.txt` is at
>   ~155.2k estimated tokens (**103 % of the 150k WARN —
>   soft-warn TRIPPED**, 78 % of the 200k HARD-FAIL). The
>   wave 4a token-trim mechanism is doing its job —
>   without it, 18 recipes would have put us at ~213k
>   tokens (over HARD-FAIL). With the trim active, this
>   wave's ROADMAP block was the dominant contributor
>   (~8k tokens for the wave-5 SHIPPED block alone),
>   confirming what wave 4's projection suspected: as the
>   per-recipe marginal cost drops from ~14k to ~3.3k via
>   the trim, the ROADMAP-block size becomes the dominant
>   variable. Mandatory wave 6 token-budget actions
>   (no longer deferrable): (a) extend the trim mechanism
>   to drop §5 Screenshot ("pending D5 harness"
>   boilerplate is duplicated across every recipe — ~0.4k
>   tokens × 18 recipes = ~7k tokens of pure boilerplate
>   to reclaim), AND (b) bump the WARN threshold from
>   150k to 175k (the original 150k was a guess; with
>   real data we can recalibrate — 175k still leaves
>   ~25k headroom to HARD-FAIL). Option (c) — trim
>   Appendix B to YAML-frontmatter-only — is held in
>   reserve for wave 7+. The HARD-FAIL gate at 200k is
>   the actual safety rail and remains intact.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 6 SHIPPED
> (3 more recipes — recipe count 18 → 21, layer-type coverage
> 8 → 9 / 10).** Wave 6 simultaneously closes the last
> demonstrable layer-type cell (the debatable
> `vector-tile-join`), starts the second-recipe lap on a
> proven source (`csv-lookup-geo` → `h3`), and adds the last
> CIM data-model that wasn't yet represented (`cim-alerts`).
> Three new recipes:
> - **`docs/recipes/csv-lookup-geo/vector-tile-join.md`** —
>   NEW layer type `vector-tile-join`, `splunk-lookup`
>   source pattern. The "bring your own boundary" recipe:
>   joins a customer-owned CSV of per-region metric values
>   against a customer-hosted PMTiles vector tileset.
>   Demonstrates `featureJoinUrl` + `featureJoinPromoteId`
>   + `featureJoinSourceLayer` — the three formatter
>   options that distinguish a customer-supplied tileset
>   from the bundled `featureJoinPreset` (us-states /
>   countries / admin1). 3 expected fields (`id`,
>   `country_name`, `value`). Same underlying `featureJoin`
>   layer source as the bundled `geo-us-states/choropleth`
>   sibling — the distinction is the tileset axis (bundled
>   vs customer-supplied), NOT the layer-type axis. §6
>   Gotchas covers the four big surprises: HTTP Range
>   requirement (`curl -I -H "Range: bytes=0-1023"` test
>   on the CDN, fails on legacy file servers), Splunk
>   Cloud CSP `connect-src 'self'` (three escape paths:
>   same-origin static asset, per-tenant allow-list, or
>   ship inside Better Map's `presets/` folder), case-
>   sensitive `featureJoinPromoteId` (use `pmtiles show
>   <file>` to inspect feature properties), and the
>   unmatched-grey silent-drop gotcha. With this recipe,
>   layer-type coverage rises to 9 / 10 — only `indoor`
>   (blocked on v1.8+ image-overlay layer kind) remains
>   undemonstrated.
> - **`docs/recipes/csv-lookup-geo/h3.md`** — already-proven
>   source `csv-lookup-geo`, already-proven layer `h3`.
>   The second-recipe lap on `csv-lookup-geo` after
>   `polygons` (wave 1), `supercluster` (wave 5), and
>   `vector-tile-join` (this wave) — bringing that source
>   row's cell-count to 4 / ~9. SPL is the canonical
>   `inputlookup` + `where isnotnull(lat/lon)` + `rename`
>   pattern (mirrors the sibling NetFlow H3 recipe but
>   sourced from a static CSV). 5 expected fields. §6
>   Gotchas captures the "CSV not distributed" performance
>   ceiling (~10k rows is the typical CSV → KV-Store
>   migration threshold), the silent-numeric-cast gotcha
>   (CSV columns are strings unless `eval value=tonumber()`),
>   the resolution-choice rubric (continental→3, country→4-5,
>   metro→6-7, city block→8+), and a clean three-row
>   hexbin-vs-supercluster-vs-heat decision matrix.
> - **`docs/recipes/cim-alerts/markers.md`** — NEW source
>   `cim-alerts`, `splunk-cim` pattern. The last CIM
>   data-model not yet represented (Authentication and
>   Performance / Network Traffic / Web shipped in earlier
>   waves; Alerts is the obvious fifth). SPL is the
>   accelerated `tstats summariesonly=true` over the
>   Alerts data model, aggregated by destination host
>   with severity-precedence logic and signature-diversity
>   counting; `iplocation dest` for geo enrichment. 8
>   expected fields. §6 Gotchas covers the
>   acceleration-required gotcha (`summariesonly=true`
>   silently returns zero rows when accel is OFF), the
>   `Alerts.dest` IP-vs-hostname split (`iplocation`
>   only geocodes IPs; customer asset CMDB is the
>   right answer for hostname dests), vendor-specific
>   severity nomenclature (`severity="3"` vs `severity="medium"`
>   vs `severity="HIGH"`), and the explicit reference to
>   `/.cursor/rules/ot-safety.mdc` Rule 6 for ES
>   correlation searches that depend on OT-adjacent
>   signals.
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (now 21
>   recipes valid, 0 verified, 21 unverified / deferred);
>   auto-regen of `docs/_machine/recipes/index.yaml` (now
>   21 entries), `docs/recipes/index.md` matrix (now 21
>   rows), `docs/llms.txt` (now references 21 recipes),
>   and `docs/llms-full.txt` (~163.0k estimated tokens
>   with PR #50's extended §5 trim + new 175k WARN active
>   — comfortably under the 175k WARN, 81.5 % of the
>   200k HARD-FAIL). `mkdocs.yml` nav grows four lines (one
>   per new recipe plus the new `cim-alerts` source-id
>   keeping the alphabetical-by-display-name convention).
>   `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 18 to
>   21 recipes (24 % → 28 % of the ~75 ✓ cells); source
>   pattern coverage stays at 8 / 8 = COMPLETE;
>   **layer-type coverage rises from 8 to 9 / 10**
>   (markers, paths, polygons, choropleth, H3 hexbin,
>   heat, extrusion-3d, supercluster, **vector-tile-join**).
>   Only 1 layer type remains undemonstrated: `indoor`
>   (image-georeferenced floor-plan overlay — blocked on
>   v1.8+ visualization feature work to support the
>   image-overlay layer-kind), which puts a meaningful
>   cap on how much further the "layer-type coverage"
>   axis can move without underlying v1.8 feature work
>   landing.
> - **What's NOT in Phase 2 wave 6 (deferred to subsequent
>   waves):** the remaining ~54 ✓ cells. Verification
>   (flip to `status: verified` for any of the 21
>   recipes) is still blocked on `secrets.env` against a
>   tenant carrying the appropriate sourcetype + apps +
>   lookups. The 3 new wave-6 recipes specifically need:
>   a customer PMTiles file + populated `region_metrics.csv`
>   (vector-tile-join — Natural Earth countries at
>   <https://github.com/protomaps/basemaps-assets> is the
>   public-domain starting point), a populated
>   `incidents.csv` (csv-lookup-geo/h3), and an ES-enabled
>   tenant with accelerated CIM Alerts + active
>   correlation searches firing (cim-alerts/markers — v1.7-
>   prep lab is bare-bones Splunk Enterprise, no ES).
> - **Wave 7 candidates in priority order:** Now that
>   layer-type coverage is capped at 9 / 10 (with `indoor`
>   blocked on v1.8+), wave 7 pivots back to the
>   per-source 2:1 fill ratio: (a) `cim-alerts/h3.md`
>   (cells in a now-proven pattern), (b) `meraki/h3.md` or
>   `meraki/heat.md` (extending the Meraki source-row),
>   (c) `cim-network-traffic/h3.md` (NetFlow-style hexbin
>   on the CIM Network Traffic data model). All three are
>   ~3k tokens each at projected post-§5-trim marginal
>   cost — well within headroom at the new 175k WARN
>   threshold.
> - **Wave 6 layer-coverage milestone closing remarks.**
>   Reaching 9 / 10 layer types in 6 waves (5 weeks of
>   matrix execution at ~1 wave per 4-7 days) is a clear
>   strategic win: the matrix's "demonstrate the
>   breadth of what Better Map can do" mission is now
>   structurally complete pending one v1.8+ feature. The
>   remaining work (cells, not layer types) is execution-
>   rate work, not strategy work — meaningful but no
>   longer the dominant axis. From wave 7 onward,
>   tracking shifts to per-source cell-fill (the column-
>   wise axis of the matrix), with explicit acknowledgement
>   that "100% cells" is not the right metric (some cells
>   are intentionally unfilled — e.g., `cim-alerts/heat`
>   makes no semantic sense for severity-discrete data).

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 7 SHIPPED
> (3 more recipes — recipe count 21 → 24, layer-type
> coverage stays at 9 / 10, source-pattern coverage stays at
> 8 / 8 COMPLETE).** First wave under the "cell-fill"
> tracking regime announced at the end of wave 6. All three
> recipes are NEW (source, layer) cells against ALREADY-
> shipped sources and ALREADY-shipped layers — no new
> framework, no new source, no new layer, no token-budget
> mitigation needed beyond the routine `llms-full.txt`
> regen. Three new recipes:
> - **`docs/recipes/cim-network-traffic/h3.md`** —
>   `splunk-cim` source pattern (already shipped in
>   markers + paths), `h3` layer (already shipped in
>   csv-lookup-geo + netflow-sflow-ipfix). The strategic /
>   executive complement to the existing CIM Network
>   Traffic markers + paths recipes: instead of one
>   marker per destination IP (markers) or one polyline
>   per source-dest pair (paths), aggregates per-
>   destination bytes into H3 hex cells coloured by total
>   byte volume. SPL is the canonical CIM tstats
>   `summariesonly=true` pattern (mirrors the markers
>   recipe but with `sum(All_Traffic.bytes) AS bytes,
>   count AS event_count` instead of just `count`).
>   Targets executive / SOC-leadership "where, geographically,
>   is most of my egress concentrated?" panels. 6 expected
>   fields. §6 Gotchas: CIM acceleration required,
>   `bytes` vs `bytes_out` semantic split, MaxMind
>   licensing, hex resolution vs row count rubric,
>   Null Island warning, time range parameterisation,
>   PII / GDPR posture (hex layer is BROADER than markers
>   — generally lower-risk for privacy-sensitive
>   deployments), explicit OT-safety filter for tenants
>   that ingest passive DPI of an OT zone into the same
>   `Network_Traffic` data model. Brings the
>   `cim-network-traffic` source row to 3 recipes
>   (markers + paths + h3).
> - **`docs/recipes/cim-authentication/heat.md`** —
>   `splunk-cim` source pattern, `heat` layer (already
>   shipped in `kvstore-latlon`). The aggregate-density
>   complement to the existing CIM Authentication
>   markers recipe: instead of one marker per source IP
>   (markers), aggregates per-source failed-auth counts
>   into a weighted heatmap normalised by
>   `eventstats max(failure_count) + eval weight=
>   failure_count / max_failure_count`. Targets SOC-
>   leadership / executive identity-attack-pressure
>   dashboards (NOT investigator views — markers is still
>   the right layer for "show me each attacker
>   individually"). 6 expected fields. §6 Gotchas:
>   CIM acceleration required, log-scale alternative
>   for orders-of-magnitude weight distributions,
>   heatmap-vs-markers decision matrix, false-positive
>   threshold tuning (5+ failures / IP / 24h, raise for
>   noisier tenants), VPN / proxy egress IP distortion,
>   PII / GDPR posture (BROADER aggregation = LOWER risk
>   than markers), explicit OT-safety filter for tenants
>   that log SIS / HMI logins under the same
>   `Authentication` data model. Brings the
>   `cim-authentication` source row to 2 recipes
>   (markers + heat).
> - **`docs/recipes/meraki/h3.md`** — `splunk-vendor-ta`
>   source pattern (already shipped in 4 prior recipes),
>   `h3` layer (now 4 total). The fleet-density
>   complement to the existing Meraki markers recipe:
>   instead of one marker per device (markers),
>   aggregates devices into H3 hex cells coloured by
>   device count, with `is_alerting` / `is_offline`
>   pre-computed flags so cell popups also carry
>   alerting / offline counts. Targets NetOps leadership
>   / account-planning views of multi-site fleets.
>   6 expected fields including the per-device `value=1`
>   constant that the hex layer SUMs into per-cell device
>   counts. §6 Gotchas: same `lng` → `lon` Meraki API
>   trap as the markers recipe (still the #1 mistake;
>   the recipe rename happens at the END before `stats
>   BY lat, lon`), TA + `devices` input prerequisites,
>   missing-location panel companion, hex resolution
>   guidance (res 4 for country-level, res 5 for metro,
>   res 3 for continental), `value=1` per row vs
>   `hexbinAggregate: "count"` design choice, MV camera
>   privacy flag, polling cadence vs auto-refresh,
>   PII / GDPR posture (hex collapses identifying device
>   names into anonymous counts — LOWER risk than
>   markers), explicit OT-safety filter for tenants that
>   integrate Meraki with an OT-zone monitoring program.
>   Brings the `meraki` source row to 2 recipes (markers
>   + h3).
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (now 24
>   recipes valid, 0 verified, 24 unverified / deferred);
>   auto-regen of `docs/_machine/recipes/index.yaml` (now
>   24 entries), `docs/recipes/index.md` matrix (now 24
>   rows), `docs/llms.txt` (now references 24 recipes),
>   and `docs/llms-full.txt` (~169.8k estimated tokens
>   with the §5 trim + 175k WARN from wave 6's token
>   recalibration active — comfortably under the 175k
>   WARN, 84.9 % of the 200k HARD-FAIL). `mkdocs.yml`
>   nav grows three lines (one per new recipe; existing
>   source IDs keep their alphabetical-by-display-name
>   convention). `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 21 to
>   24 recipes (28 % → 32 % of the ~75 ✓ cells); source
>   pattern coverage stays at 8 / 8 = COMPLETE;
>   layer-type coverage stays at 9 / 10. Per-source row
>   counts now: `csv-lookup-geo` 4, `geo-us-states` 2,
>   `cim-network-traffic` 3 (NEW: h3), `cim-authentication`
>   2 (NEW: heat), `cim-performance` 1, `cim-alerts` 1,
>   `cyber-vision` 1, `es-risk` 1, `itsi-kpi-base` 1,
>   `kvstore-latlon` 2, `meraki` 2 (NEW: h3),
>   `netflow-sflow-ipfix` 1, `ot-datastreamer` 1,
>   `splunk-stream` 1, `thousandeyes` 1.
> - **Wave 8 candidates** (continuing the cell-fill
>   regime, all against shipped sources + shipped layers,
>   no framework changes needed): (a) `splunk-stream/heat`
>   — wire-data attack-pressure heatmap, mirrors the
>   `cim-authentication/heat` shape against the Stream
>   sourcetypes (`stream:tcp`, `stream:http`); (b)
>   `ot-datastreamer/heat` — sensor density heatmap
>   (NOTE: must carry the same `ot_safety_relevant: true`
>   flag as the markers recipe and explicit OT-safety
>   filtering); (c) `cim-performance/h3` — server fleet
>   density hex aggregation, mirrors the `meraki/h3`
>   shape against CPU / memory / facilities metrics.
>   All three are projected ~3k tokens each post-§5 trim,
>   well within the new 175k WARN headroom.
> - **Token budget watch.** With wave 7 landing at 169.8k
>   estimated tokens, headroom to the 175k WARN is ~5.2k,
>   and headroom to the 200k HARD-FAIL is ~30k. At
>   ~3k / recipe cost, wave 8 will land at ~178.8k — JUST
>   above the WARN. The WARN exists to surface decisions
>   that would otherwise be invisible; this is by design,
>   and the planned response is to (a) accept the WARN
>   for wave 8 and re-evaluate, OR (b) extend the §5
>   trim to also drop the wave 6 status block from
>   ROADMAP.md (the wave 7 block above is ~3k tokens
>   that the LLM does not need at every search — the
>   live recipe count + matrix coverage is in
>   `recipes/index.md` which is more compact). The
>   HARD-FAIL at 200k is the actual safety rail and
>   continues to hold across wave 8 + wave 9 even
>   without additional trim.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 8 SHIPPED
> (3 more recipes — recipe count 24 → 27, layer-type coverage
> stays at 9 / 10, source-pattern coverage stays at 8 / 8
> COMPLETE).** Wave 8 continues the wave 7 cell-fill regime
> (no new layer types, no new source patterns — only filling
> matrix cells by applying already-shipped layer types to
> already-shipped source patterns) but with a token-budget
> mitigation bundled in alongside the recipes. The wave-8
> token-trim landed in PR #53 (G7 Phase 2 follow-up #3)
> reclaimed ~20k tokens by stripping historical wave-status
> blockquotes from `llms-full.txt` only; this wave 8 PR adds
> three recipes on top of that baseline. Three new recipes
> ship:
> - **`docs/recipes/splunk-stream/heat.md`** —
>   `splunk-stream` source pattern (already shipped via the
>   markers recipe), `heat` layer (already shipped via
>   `kvstore-latlon/heat` + `cim-authentication/heat`). The
>   aggregate-density complement to the existing
>   `splunk-stream/markers` recipe: same `stream:tls` wire-
>   data sourcetype, but aggregated `BY dest_ip` with
>   `sum(bytes_out)` and rendered as a weighted heatmap.
>   Introduces the **log-scale `weight` pattern** (specifically
>   `eval weight=round(log10(bytes_out) /
>   log10(max_bytes_out), 2)`) because bytes-out
>   distributions in wire data span 6+ orders of magnitude
>   (handshake at 5 KB → bulk-transfer at 5 GB), making
>   linear normalisation visually useless. Targets executive
>   data-exfiltration risk reviews and data-residency
>   briefings — NOT per-destination IR triage (use markers
>   for that). 6 expected fields including the
>   layer-required `weight`. §6 Gotchas: log-scale safety
>   (`max_bytes_out > 1` defence), heatmap vs markers
>   decision matrix, CDN-destination smearing across POPs,
>   MaxMind freshness, TLS wire-data GDPR posture, and
>   the "Stream on an OT SPAN" carve-out (passive
>   collection is correct per `ot-safety.mdc` Rule 1, but
>   render-only with no SOAR write-back per Rules 2-4).
>   Brings the `splunk-stream` source row to 2 recipes
>   (markers + heat).
> - **`docs/recipes/ot-datastreamer/heat.md`** —
>   `splunk-edge-hub` source pattern (already shipped via the
>   markers recipe), `heat` layer (already shipped via three
>   prior recipes). **CARRIES `ot_safety_relevant: true`**
>   per `ot-safety.mdc` Rule 6. The site-level aggregate-
>   density complement to the existing
>   `ot-datastreamer/markers` recipe: same `edge_hub_*`
>   index union, same operator-maintained
>   `edge_hub_sites.csv` lookup, but with a SECOND `stats`
>   stage that collapses per-hub rows to per-site rows
>   (`BY site_id, lat, lon`) and computes `max(safety_related)
>   AS site_has_safety_hub` so the heatmap preserves the
>   Rule 6 safety annotation. Targets OT operations
>   leadership dashboards and NetOps capacity-planning
>   briefings — NOT per-hub liveness investigation (use
>   markers — the per-hub `last_seen_minutes_ago` colouring
>   the markers carries cannot survive the per-site
>   aggregation). 6 expected fields including the
>   layer-required `weight` plus the safety-flagged
>   `site_has_safety_hub` carried through as popup metadata.
>   §6 Gotchas: extensive OT-safety bindings (heatmap MUST
>   preserve safety annotation per Rule 6, passive
>   collection ONLY per Rule 1, SOAR scope ends at IT/OT
>   DMZ per Rule 3, paired "silent safety hubs" alert
>   REQUIRED for any tenant with `safety_related=true` rows
>   in the site lookup — the heatmap visualises loud
>   sites; a separate alert must watch for safety-relevant
>   silent ones). Brings the `ot-datastreamer` source row
>   to 2 recipes (markers + heat).
> - **`docs/recipes/cim-performance/h3.md`** — `splunk-cim`
>   source pattern (already shipped in 4 prior recipes),
>   `h3` layer (now 5 total — joins `csv-lookup-geo/h3`,
>   `cim-network-traffic/h3`, `meraki/h3` from waves 6-7).
>   The per-region aggregation complement to the existing
>   `cim-performance/markers` recipe: same CIM-accelerated
>   `Performance.CPU` + `Performance.Memory` `tstats`
>   queries, same ES Asset & Identity asset lookup, but
>   simplified to two datasets (CPU + Memory — drops
>   Storage from the markers recipe's three because
>   storage pressure is too PERSISTENT to surface
>   meaningful cell-to-cell variance on a 15 min cadence).
>   Adopts the H3 `value` field naming convention from
>   the existing H3 recipes (`eval value=cpu_load_percent`
>   so `hexbinAggregate: "avg"` produces the natural
>   "average CPU% per region" cell colouring). Targets
>   SRE / capacity-planning panels with per-region
>   click-to-drilldown — NOT per-host investigation
>   (use markers for that). 6 expected fields including
>   the H3-required `value` plus both `_percent` columns
>   for popup display. §6 Gotchas: H3 vs heatmap
>   decision matrix (sharp cells with deterministic
>   drilldown vs smooth blobs without), sample-size
>   problem (one outlier in a sparse region paints a
>   whole cell — needs companion `host_count >= 3`
>   filter), aggregate-function semantics (`avg` /
>   `max` / `count` / never `sum` for percentage
>   values), and the `splunkbase:h3` Splunk command
>   prerequisite for true H3 indexing in SPL.
>   Brings the `cim-performance` source row to 2
>   recipes (markers + h3).
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (now 27
>   recipes valid, 0 verified, 27 unverified / deferred);
>   auto-regen of `docs/_machine/recipes/index.yaml` (now
>   27 entries), `docs/recipes/index.md` matrix (now 27
>   rows), `docs/llms.txt` (now references 27 recipes),
>   and `docs/llms-full.txt`. `mkdocs.yml` nav grows
>   three lines (one per new recipe; existing source IDs
>   keep their alphabetical-by-display-name convention).
>   `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 24 to
>   27 recipes (32 % → 36 % of the ~75 ✓ cells); source
>   pattern coverage stays at 8 / 8 = COMPLETE;
>   layer-type coverage stays at 9 / 10 (only `indoor`
>   remains, blocked on v1.8+). Per-source row counts
>   now: `csv-lookup-geo` 4, `geo-us-states` 2,
>   `cim-network-traffic` 3, `cim-authentication` 2,
>   `cim-performance` 2 (NEW: h3), `cim-alerts` 1,
>   `cyber-vision` 1, `es-risk` 1, `itsi-kpi-base` 1,
>   `kvstore-latlon` 2, `meraki` 2,
>   `netflow-sflow-ipfix` 1, `ot-datastreamer` 2 (NEW:
>   heat), `splunk-stream` 2 (NEW: heat), `thousandeyes`
>   1. Every shipped source pattern now has at least 2
>   recipes — no more "single-recipe" sources in the
>   matrix.
> - **Wave 9 candidates** (cell-fill regime continues —
>   shipped sources × shipped layers): (a)
>   `cim-network-traffic/supercluster` — geographic
>   density of unique destinations as a clustered map,
>   complement to the existing `paths` and `h3` recipes
>   for the same source; (b) `kvstore-latlon/supercluster`
>   — clustered version of the KV Store points recipe
>   for tenants with thousands of stored locations
>   (warehouses, retail locations, vehicles);
>   (c) `netflow-sflow-ipfix/heat` — the heatmap analogue
>   to the existing `netflow-sflow-ipfix/h3` recipe,
>   giving operators a smoother "egress pressure"
>   visualisation alternative to the discrete hex cells.
>   All three are projected ~3k tokens each post-§5 trim;
>   plus the wave 9 status block at ~3k = ~12k cost.
> - **Token budget watch.** With the G7 follow-up #3
>   token-trim now active in `main`, this wave 8 PR
>   regenerates `llms-full.txt` at **~165.8k estimated
>   tokens** (663,000 chars, 11,808 lines) — ~9.2k
>   headroom to the 175k WARN, ~34.2k to the 200k
>   HARD-FAIL. This wave's own SHIPPED status block (the
>   block you're reading right now) matches the
>   `_ROADMAP_STATUS_BLOCK` regex on the
>   `E5 Phase 2 wave \d+` arm, so it self-strips from
>   `llms-full.txt` on the very build that introduces it.
>   Wave 9 at 3 recipes × ~3.3k = ~9.9k cost (plus its
>   own ~3-5k status block that ALSO self-strips) lands
>   at ~175.7k — JUST over the WARN. Wave 9's lever is
>   already designed: Appendix B summarisation (defer
>   the per-recipe `expected_fields` / `formatter_config`
>   blocks in `llms-full.txt`'s Appendix B to the live
>   `docs/_machine/recipes/index.yaml` rather than
>   inlining them — projected ~15-20k savings, opening
>   ~5 more recipes of headroom). For now, the WARN is
>   well clear; wave 9 planning resumes after wave 8
>   lands.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 9 SHIPPED
> (3 more recipes — recipe count 27 → 30, supercluster
> layer-type usage 1 → 3, every source has ≥2 recipes
> remaining true).** Wave 9 continues the wave 7-8
> cell-fill regime (no new layer types, no new source
> patterns — only filling matrix cells by applying
> already-shipped layer types to already-shipped source
> patterns) AND establishes that the token-budget runway
> is healthier than the wave 8 projection suggested. The
> wave 8 status block forecast `3 × 3.3k = ~9.9k tokens`
> for wave 9; the actual measured per-recipe marginal
> cost (post-§5 trim) sits closer to **~2.1k tokens per
> recipe** (range 1.2k-3.1k across the now-shipped 30
> recipes; the largest is `cim-performance/h3` at 3.1k,
> the smallest is `kvstore-latlon/markers` at 1.2k). So
> the planned Appendix B summarisation lever is **NOT
> needed** for wave 9 — it can stay queued for wave
> 10-11 when it actually opens headroom that the
> per-recipe cost has not. Three new recipes ship:
> - **`docs/recipes/cim-network-traffic/supercluster.md`**
>   — `splunk-cim` source pattern (already shipped in 5
>   prior recipes; this is the 3rd recipe for the
>   `cim-network-traffic` source row, joining `markers`,
>   `paths`, `h3`), `supercluster` layer (already shipped
>   via `csv-lookup-geo/supercluster`; this is the 2nd
>   instance — supercluster layer-type usage now 1 → 2).
>   The high-cardinality drilldown complement to the
>   existing markers / h3 recipes: same `tstats
>   summariesonly=true … BY All_Traffic.dest_ip`
>   accelerated CIM query, same `iplocation` enrichment,
>   but rendered as a supercluster-backed cluster
>   renderer. Targets perimeter-firewall and
>   cloud-proxy SecOps panels with 500-10000 unique
>   external destinations per time window. 6 expected
>   fields including the cluster-layer-required `id`
>   (which is `dest_ip` post-rename). §6 Gotchas: CIM
>   acceleration prerequisite, the cluster-vs-heatmap-vs-
>   hexbin decision matrix specific to network-traffic
>   data, MaxMind GeoLite2 country-vs-city precision,
>   CDN POP smearing across re-renders, IPv6 + CGNAT
>   filter additions, the v1.8+-tracked `clusterRadius`
>   / `clusterMaxZoom` formatter exposure, GDPR posture
>   for IP-address-as-personal-data, and the OT-zone
>   carve-out (passive collection valid per Rule 1; no
>   SOAR write-back to Level-0/1/2 destinations per
>   Rule 3). Brings the `cim-network-traffic` source
>   row to 4 recipes (markers + paths + h3 +
>   supercluster).
> - **`docs/recipes/kvstore-latlon/supercluster.md`** —
>   `splunk-lookup` source pattern (already shipped in
>   6 prior recipes; this is the 3rd recipe for the
>   `kvstore-latlon` source row, joining `markers`,
>   `heat`), `supercluster` layer (now 3 total —
>   joining the new `cim-network-traffic/supercluster`
>   above plus the existing `csv-lookup-geo/supercluster`).
>   The high-volume drilldown complement to the
>   existing markers / heat recipes: same `| inputlookup`
>   KV Store collection-as-source-of-truth shape, but
>   sized for 5000-50000-row collections (retail chains,
>   logistics fleets, charging-station networks,
>   smart-city deployments) instead of the 10-100-row
>   curated site lists the markers recipe targets. 5
>   expected fields. §6 Gotchas: KV Store size limits
>   (1-10M-row degradation threshold), accelerated
>   fields for collections > 500k rows, the
>   cluster-vs-heatmap-vs-hexbin decision matrix
>   specific to a large customer-location collection,
>   v1.8+-tracked formatter exposure for cluster tuning
>   knobs, privacy/PII posture for collections that
>   identify individual staff or customer locations,
>   and the OT-safety carve-out for collections that
>   ALSO carry SIS-related sites. Brings the
>   `kvstore-latlon` source row to 3 recipes (markers
>   + heat + supercluster).
> - **`docs/recipes/netflow-sflow-ipfix/heat.md`** —
>   `splunk-vendor-ta` source pattern (already shipped
>   via the markers + h3 recipes), `heat` layer
>   (already shipped in 4 prior recipes — heat layer
>   usage now 5). The continuous-density complement to
>   the existing `netflow-sflow-ipfix/h3` recipe: same
>   `Splunk_TA_netflow` ingestion, same `iplocation`
>   enrichment, same `sum(bytes) BY dest_ip`
>   aggregation, but rendered as a MapLibre GL weighted
>   heatmap instead of discrete hex cells. Reuses the
>   log-scale `weight` pattern introduced in
>   `splunk-stream/heat` (NetFlow byte distributions
>   span 6+ orders of magnitude, identical normalisation
>   problem). 6 expected fields including the
>   heatmap-layer-required `weight`. §6 Gotchas: the
>   heatmap-vs-hexbin decision matrix specific to
>   flow-data audience (executive vs operational), the
>   `O(N × R²)` heatmap render-cost formula and its
>   implication for the `head 10000` defensive cap,
>   CDN-POP smearing (more forgiving here than for
>   markers/clusters because the smooth gradient
>   absorbs per-search variation), MaxMind freshness
>   guidance for data-residency dashboards, GDPR
>   posture (heatmap actively helps the posture by
>   collapsing individual destinations into aggregate
>   density that is not an individual identifier), and
>   the OT-zone carve-out. Brings the
>   `netflow-sflow-ipfix` source row to 2 recipes
>   (h3 + heat).
> - **No framework changes.** All three recipes pass
>   the unchanged `scripts/check-recipe-schema.py` (now
>   30 recipes valid, 0 verified, 30 unverified /
>   deferred); auto-regen of `docs/_machine/recipes/
>   index.yaml` (now 30 entries), `docs/recipes/
>   index.md` matrix (now 30 rows), `docs/llms.txt`
>   (now references 30 recipes), and
>   `docs/llms-full.txt`. `mkdocs.yml` nav grows three
>   lines (one per new recipe; existing source IDs
>   keep their alphabetical-by-display-name convention).
>   `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 27
>   to 30 recipes (~36 % → ~40 % of the ~75 ✓ cells);
>   source-pattern coverage stays at 8 / 8 = COMPLETE;
>   layer-type coverage stays at 9 / 10 (only `indoor`
>   remains, blocked on v1.8+). Per-source row counts
>   now: `csv-lookup-geo` 4, **`cim-network-traffic` 4
>   (NEW: supercluster)**; `geo-us-states` 2,
>   `cim-authentication` 2, `cim-performance` 2,
>   **`kvstore-latlon` 3 (NEW: supercluster)**,
>   `meraki` 2, `ot-datastreamer` 2, `splunk-stream` 2,
>   **`netflow-sflow-ipfix` 2 (NEW: heat)**; `cim-alerts`
>   1, `cyber-vision` 1, `es-risk` 1, `itsi-kpi-base` 1,
>   `thousandeyes` 1. Layer-type usage now:
>   `markers` 14, `h3` 5, **`heat` 5 (NEW: 4 → 5)**,
>   `paths` 3, **`supercluster` 3 (NEW: 1 → 3)**,
>   `vector-tile-join` 1, `polygons` 1, `choropleth` 1,
>   `extrusion-3d` 1.
> - **Wave 10 candidates** (cell-fill regime continues):
>   (a) `cim-authentication/h3` — geographic
>   authentication-event density per hex cell,
>   complement to the existing markers + heat for the
>   same source; (b) `es-risk/h3` — risk-event density
>   per hex cell, complement to the existing markers
>   recipe; (c) `meraki/heat` — wireless-device-density
>   heatmap, complement to the existing markers + h3
>   recipes. All three are projected ~2k tokens each
>   post-§5 trim; plus the wave 10 status block at
>   ~3-5k = ~9-11k total cost.
> - **Token budget watch.** With wave 9 landing at
>   ~172.0k estimated tokens (the 3 new recipes plus
>   minor downstream regen drift), headroom to the
>   175k WARN is ~3k and headroom to the 200k
>   HARD-FAIL is ~28k. Wave 10 at ~9-11k will hit the
>   175k WARN squarely (~181-183k). Two levers are
>   prepared: (a) the still-queued Appendix B
>   summarisation (~15-20k savings, designed in the
>   wave 8 status block above), and (b) a tighter
>   per-page warn for `roadmap.md` itself if the
>   cumulative status-block prose grows past its
>   current ~43k contribution despite the
>   self-stripping regex. The HARD-FAIL at 200k
>   remains the safety rail and continues to hold
>   well into wave 11-12 even without additional
>   trim.

> **Status (v1.7-prep, 2026-05-18): G7 Phase 2 follow-up #4
> SHIPPED — historical CHANGELOG version-section trim in
> `build-llms-full-txt.py`.** The wave 9 status block (above)
> noted that wave 9 landed at ~172k estimated tokens with
> only ~3k headroom to the 175k WARN, and projected that
> wave 10's ~9-11k cost would push the corpus to ~181-183k
> — squarely over WARN. The wave 9 plan called for either
> the long-queued Appendix B summarisation (~4.5k savings
> measured, not the ~15-20k originally projected) or a new
> lever. Re-measuring the top contributors to `llms-full.txt`
> after wave 9 shipped showed the real ranking is:
> `roadmap.md` ~27.9k → `changelog.md` ~19.6k → `appendix:recipes`
> ~4.5k. So the second-biggest non-recipe contributor is
> CHANGELOG.md, not Appendix B — and the same trim shape
> that worked for ROADMAP.md status blocks (keep the live
> head, point to the full file for tail) applies cleanly to
> the Keep-a-Changelog `## [VERSION] - DATE` section
> structure. So follow-up #4 trims it:
> - **What changed:** a new `_CHANGELOG_VERSION_HEADING`
>   regex plus `strip_changelog_old_versions()` helper in
>   `scripts/build-llms-full-txt.py`. The strip runs in
>   `render()` BEFORE `strip_chrome()` (same order as the
>   ROADMAP status-block strip — chrome cleanup tidies the
>   joined seam). The regex matches `^## \[<version>\] - <date>$`
>   headings; the helper keeps the top `_CHANGELOG_KEEP_VERSIONS`
>   (currently 3) sections fully and replaces everything
>   below with (a) a one-line pointer to the canonical
>   CHANGELOG.md at the docs site URL + the repo URL, and
>   (b) a bullet list of `[VERSION] - DATE` titles for the
>   trimmed sections so an agent inspecting `llms-full.txt`
>   still sees WHICH older versions exist (just not their
>   body). The on-disk `CHANGELOG.md` is unchanged and the
>   MkDocs site still renders every version via the
>   mkdocs-include-markdown plugin directive in
>   `docs/changelog.md` (which pulls `../CHANGELOG.md`
>   inline) — the trim is a llms-full.txt-only transform
>   applied to the already-expanded body, same pattern as
>   follow-up #3.
> - **Token-budget impact:** wave 9's ~172k landed → post-trim
>   baseline drops to ~156.3k against the unchanged 175k
>   WARN (measured against the as-shipped CHANGELOG.md with
>   18 version sections; the trim reclaims 14 of them,
>   keeping 1.6.2 / 1.6.1 / 1.6.0). That's ~18.7k headroom =
>   ~9 more recipes at ~2.1k each before the next
>   recalibration. Wave 10 at ~9-11k now lands at ~165-167k
>   — comfortably below WARN.
> - **Forward maintenance:** every new release adds one new
>   `## [VERSION]` section at the top of CHANGELOG.md. The
>   trim keeps the top-3, so each release naturally rotates
>   the oldest of the kept three out of the in-corpus body
>   (still recoverable via the pointer). The
>   `_CHANGELOG_KEEP_VERSIONS = 3` constant is the lever to
>   widen the kept window if the release cadence slows and
>   3 versions stop covering "the current cycle"; widen with
>   care because per-version weight averages ~1.1k tokens.
> - **What's NOT in this prep (still deferred to a future
>   recalibration):** Appendix B summarisation remains the
>   next lever if the per-recipe pace accelerates past the
>   ~9-recipe headroom this trim opens. The measured cost
>   of Appendix B is now known to be ~4.5k tokens (much
>   smaller than the ~15-20k originally projected) so the
>   ROI is correspondingly smaller; it stays queued for the
>   wave 12-13 horizon.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 10 SHIPPED
> (3 more recipes — recipe count 30 → 33, H3 layer-type usage
> 5 → 7, layer-type coverage 9 / 10 unchanged, source-pattern
> coverage 8 / 8 unchanged).** Wave 10 continues the wave 7-9
> cell-fill regime (no new layer types, no new source patterns
> — only filling matrix cells by applying already-shipped
> layer types to already-shipped source patterns) AND lands
> comfortably below the 175k WARN thanks to the G7 follow-up
> #4 CHANGELOG trim that shipped earlier in this wave. The
> wave 9 status block projected wave 10 at ~9-11k cost
> hitting 181-183k WARN-crosser; the actual measured cost
> is ~8.0k tokens for the 3 recipes (~2.4k each — within
> the wave 9 measured baseline of ~2.1k per recipe but
> slightly above because two of the three recipes carry
> longer per-cell sample-size + aggregate-function gotchas).
> Net wave 10 token-budget impact: changelog trim
> (-15.7k) + 3 recipes (+8.0k) + nav growth (+0.1k) +
> status block (auto-stripped) = post-wave-10 baseline lands
> at **~164.3k tokens** vs the 175k WARN — 10.7k headroom
> (~5 more recipes at ~2.1k each). Three new recipes ship:
> - **`docs/recipes/cim-authentication/h3.md`** —
>   `splunk-cim` source pattern (already shipped in 6
>   prior recipes; this is the 3rd recipe for the
>   `cim-authentication` source row, joining `markers` +
>   `heat`), `h3` layer (now 6 total uses across the
>   matrix; joining cim-network-traffic, cim-performance,
>   csv-lookup-geo, meraki, netflow-sflow-ipfix). The
>   per-region-drilldown complement to the existing
>   markers + heat recipes for the same source: same
>   CIM-accelerated Authentication data model, same
>   `iplocation` enrichment of failed-login source IPs,
>   but rendered as H3 hexagonal cells with clickable
>   per-region drilldown rather than discrete markers
>   (per-IP investigation) or smooth heat blobs
>   (executive briefing). The triple now covers all 3
>   layer choices for identity-attack pressure
>   visualisation: markers for "show me each attacker,"
>   heat for "show me a smooth pressure gradient," h3
>   for "rank regions and drill into the leader."
>   Targets SOC daily stand-up dashboards with
>   per-cell drilldown. 6 expected fields including the
>   h3-layer-required `value` (set from `failure_count`).
>   §6 Gotchas: CIM acceleration prerequisite, the
>   3-way markers-vs-heat-vs-h3 decision matrix, the
>   per-cell sample-size workaround (one-source-IP
>   cells dominate the colour ramp), aggregate function
>   semantics (sum vs max vs avg vs count), `tag=authentication`
>   membership, threshold tuning, MaxMind licensing,
>   GDPR posture, and the OT-zone Authentication-data-
>   model carve-out (Rule 6). Brings the
>   `cim-authentication` source row to 3 recipes.
> - **`docs/recipes/es-risk/h3.md`** —
>   `splunk-premium-es` source pattern (the markers
>   recipe is the only other one for this premium-tier
>   ES pattern), `h3` layer (now 7 total uses across
>   the matrix). The per-site-drilldown complement to
>   the existing markers recipe for the same source:
>   same `risk` index, same `sum(risk_score) BY
>   risk_object` RBA aggregator, same ES A&I lookup
>   chain for entity → home location with the
>   identity_lookup_expanded + asset_lookup_by_str
>   `coalesce` pattern, but rendered as H3 hexagonal
>   cells with per-site drilldown rather than discrete
>   per-entity markers. Adds the `entity_count`
>   `eventstats` aggregate so the operator can
>   distinguish "one loud entity with 200 risk" from
>   "ten entities with 20 risk each" inside the same
>   hot hex cell. Targets SOC daily stand-up
>   dashboards for RBA-driven sites where the
>   operator wants to RANK sites and DRILL into the
>   leader, NOT for per-entity investigation (markers)
>   and not for smoothly-distributed risk gradients
>   (heatmap, which isn't a great fit for RBA risk
>   anyway because risk is fundamentally per-entity-
>   at-a-site). 6 expected fields including the h3-
>   layer-required `value` (set from `total_risk`).
>   §6 Gotchas: ES A&I lat/lon extension prerequisite,
>   per-cell sample-size workaround, aggregate
>   semantics, `risk` index acceleration absent by
>   default, time-range matching to RIR window,
>   GDPR posture for `risk_object_type="user"` PII,
>   and the OT-zone carve-out (Rule 6) for tenants
>   that score OT entities (e.g. passive DPI alerts
>   from Cisco Cyber Vision feeding ES correlation
>   searches). Brings the `es-risk` source row to 2
>   recipes.
> - **`docs/recipes/meraki/heat.md`** —
>   `splunk-vendor-ta` source pattern (already shipped
>   via markers, h3, NetFlow x2, etc.), `heat` layer
>   (already shipped in 5 prior recipes — heat layer
>   usage now 6). The continuous-density complement to
>   the existing markers + h3 recipes for the same
>   source: same `meraki:devices` polling, same `dedup
>   serial sortby -_time` + `lng → lon` pipeline, but
>   rendered as a MapLibre GL weighted heatmap instead
>   of discrete markers or hex cells. Critically, this
>   recipe is the FIRST in the matrix to demonstrate
>   the `stats count BY lat, lon` site-aggregation
>   pattern necessary for heatmap when source rows
>   share exact coordinates (a 50-device office
>   contributes a SINGLE weighted heat point with
>   proportional intensity, not 50 overlapping points
>   at the same pixel — without the pre-aggregation
>   the heatmap renderer would either saturate the
>   pixel or mis-normalise). Targets executive /
>   leadership briefings where a smooth gradient
>   reads cleaner in a slide deck than discrete
>   markers or a hex grid. 6 expected fields including
>   the heat-layer-required `weight` (normalised
>   device count, log-scale fallback documented in §6
>   for HQ-dominated fleets). §6 Gotchas: the
>   `lng`-vs-`lon` trap, TA install prerequisite, the
>   3-way markers-vs-heatmap-vs-h3 decision matrix,
>   the mandatory site-aggregation pattern (this
>   recipe's biggest divergence from markers/h3),
>   weight normalisation gotcha with the log-scale
>   alternative, single-site-fleet anti-pattern, time
>   range, polling-vs-refresh cadence, no-CIM-mapping
>   note, MV camera privacy flag, GDPR posture
>   (lower-risk than markers because the smooth
>   gradient collapses identifying device names),
>   the `alerting_count` field semantics, and the
>   OT-zone Meraki carve-out (Rule 6 — corporate
>   Meraki gear must NOT visually compete with OT
>   sensors on the same map). Brings the `meraki`
>   source row to 3 recipes (full triple: markers +
>   h3 + heat).
> - **No framework changes.** All three recipes pass
>   the unchanged `scripts/check-recipe-schema.py`
>   (now 33 recipes valid, 0 verified, 33
>   unverified / deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 33
>   entries), `docs/recipes/index.md` matrix (now 33
>   rows), `docs/llms.txt` (now references 33
>   recipes), and `docs/llms-full.txt`. `mkdocs.yml`
>   nav grows three lines (one per new recipe;
>   existing source IDs keep their alphabetical-by-
>   display-name convention — meraki's three layers
>   now line up as `H3 hexbin` → `heatmap` →
>   `markers`). `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 30
>   to 33 recipes (~40 % → ~44 % of the ~75 ✓
>   cells); source-pattern coverage stays at 8 / 8 =
>   COMPLETE; layer-type coverage stays at 9 / 10
>   (only `indoor` layer remains, blocked on v1.8+).
>   Per-source row counts now: `csv-lookup-geo` 4,
>   `cim-network-traffic` 4; `geo-us-states` 2,
>   **`cim-authentication` 3 (NEW: h3)**,
>   `cim-performance` 2, `kvstore-latlon` 3,
>   **`meraki` 3 (NEW: heat)**, `ot-datastreamer` 2,
>   `splunk-stream` 2, `netflow-sflow-ipfix` 2;
>   `cim-alerts` 1, `cyber-vision` 1,
>   **`es-risk` 2 (NEW: h3)**, `itsi-kpi-base` 1,
>   `thousandeyes` 1. Layer-type usage now:
>   `markers` 14, **`h3` 7 (NEW: 5 → 7)**,
>   **`heat` 6 (NEW: 5 → 6)**, `paths` 3,
>   `supercluster` 3, `vector-tile-join` 1,
>   `polygons` 1, `choropleth` 1, `extrusion-3d` 1.
> - **Wave 11 candidates** (cell-fill regime
>   continues): (a) `cim-alerts/h3` — geographic
>   alert density per hex cell; (b)
>   `itsi-kpi-base/markers` — second recipe for the
>   ITSI-KPI source row (which currently has only
>   the choropleth recipe); (c)
>   `thousandeyes/markers` — second recipe for the
>   ThousandEyes source row (which currently has
>   only the paths recipe). All three are projected
>   ~2.4k tokens each post-§5 trim; plus the wave 11
>   status block at ~3-4k (self-stripping) = ~7-8k
>   total cost. Lands at ~172k — still under WARN.
> - **Token budget watch.** With wave 10 landing at
>   **~164.3k estimated tokens**, headroom to the
>   175k WARN is **~10.7k** and headroom to the
>   200k HARD-FAIL is ~35.7k. The G7 follow-up #4
>   CHANGELOG trim opened ~15.7k that wave 10
>   consumed ~8.1k of (the 3 recipes + nav growth);
>   the wave 10 status block self-strips so it
>   costs zero net. Wave 11 at ~7-8k will land at
>   ~172k — comfortably below WARN. Wave 12-13
>   should trigger either the Appendix B
>   summarisation (~4.5k reclaim) or another
>   CHANGELOG iteration if a new release adds a
>   large `## [VERSION]` section before then.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 18 recipes
> SHIPPED (1 more recipe — recipe count 47 → 48, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, heat usage 8 → 9).** Wave 18 ships the SECOND
> recipe for the most-isolated source row in the matrix:
> - **`itsi-kpi-base/heat`** — second recipe for the
>   `itsi-kpi-base` row (previously only markers). The
>   per-site density complement to the markers companion:
>   same `itsi_summary` ⋈ `itsi_services` join, same
>   `SHKPI-`-prefixed service-health filter, same 15-min
>   window, same `info_lat`/`info_lon` geo-attribute
>   prerequisite — BUT instead of one marker per service
>   the panel aggregates BY (`lat`, `lon`) site and renders
>   per-site UNHEALTHY-SERVICE-COUNT as a smooth Gaussian
>   heat surface. Demonstrates the `eval is_unhealthy =
>   if(alert_level >= 3, 1, 0)` per-service binary
>   threshold + `stats sum(is_unhealthy) AS
>   unhealthy_services, count AS total_services BY lat,
>   lon` per-site aggregation + `eventstats max
>   /eval weight = unhealthy_services / max_unhealthy`
>   normalisation pattern (matches
>   kvstore-latlon/heat + es-risk/heat). Right for
>   **executive / leadership health briefings**
>   ("which datacenter is on fire?"), **multi-datacenter
>   capacity planning** ("every EU datacenter is in the
>   orange zone"), and **incident-response correlation
>   panels** (cloud-region outage blast-radius at a
>   glance). The §6 Gotchas cover the same `info_lat`
>   /`info_lon` prereq as markers, the `alert_level >= 3`
>   threshold-as-panel-definition contract (adjustable to
>   `>= 2` / `>= 4` / `>= 5`), the per-site label
>   alternative (`info_datacenter_code` if your install
>   has one), the percentage-variant rewrite
>   (`weight = unhealthy_services / total_services` for
>   blast-radius-vs-fleet-size questions), the heat-vs-
>   markers-vs-(future-h3) decision matrix, the per-panel
>   `eventstats max` cardinality risk (panel-local
>   normalisation, swap for a fixed scalar if cross-panel
>   comparison is needed), the SHKPI delivery-lag absorb
>   contract, the `itsi_services` lookup-name override
>   (Splunk Cloud multi-tenant prefix), the no-time-
>   parameterisation rule, the GDPR-safer-than-markers
>   note (per-service identity discarded by aggregation),
>   and the OT-safety carve-out (Rule 6 — visually mixing
>   IT and OT service-health pressure is dangerous because
>   per-site aggregation obscures the safety distinction).
> - **`itsi-kpi-base` row coverage 1 → 2 recipes.** Still
>   missing h3 (the future "regional service-pressure
>   ranking" panel — boundary-aware totals across cloud
>   regions). Layer-type coverage 9/10 unchanged. Source-
>   pattern coverage 8/8 unchanged (`splunk-premium-itsi`
>   already represented by markers).
> - **Token budget TIGHT.** Wave 18 lands `llms-full.txt`
>   at **~174,895 estimated tokens** / **~105 WARN
>   headroom** — under WARN but with effectively NO
>   headroom for further recipes. Wave 19 MUST start
>   with a token-trim PR (no exception) before any recipe
>   authoring. Candidate trim levers documented in the
>   wave-17 trim status block above (recipe-page §1
>   source-description compaction, recipe-page §6 Gotchas
>   sub-trim for OT-safety boundary deduplication, or a
>   second CHANGELOG iteration if a new release lands a
>   large `## [VERSION]` section).
> - **Triplet completion now 12/15 unchanged** (wave 18
>   added 1 row to an already-single-recipe row, lifting
>   it to 2/3 toward triplet). Remaining one-cell-away
>   triplet completers: `itsi-kpi-base/h3` (best wave 20+
>   single-recipe target, completes 13th triplet) and
>   `thousandeyes/h3` OR `thousandeyes/heat` (either
>   completes 14th triplet on its own). `geo-us-states`
>   stays out of triplet count (geo-shape source row,
>   intentionally NOT a markers-style target).
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 19 token-trim
> SHIPPED (~47.2k tokens reclaimed by dropping per-recipe §2 SPL
> walkthroughs and §4 formatter-config walkthroughs from
> `llms-full.txt` while keeping the SPL and JSON code fences).**
> Wave 18 landed at ~174,895 tokens / ~105 WARN headroom — the
> tightest budget after a single-recipe wave to date. Profiling
> the corpus by section showed the highest-ROI lever was NOT
> another single-target trim (formatter Appendix A, recipes-
> index matrix, ROADMAP work-items, ROADMAP status blockquotes,
> CHANGELOG older versions were all already shipped). The
> §2 "Why this exact shape, line by line" walkthrough below each
> SPL fence totalled ~131k chars across 48 recipes; the §4
> "Why this specific config" walkthrough below each JSON fence
> totalled ~79k chars; together ~210k chars / ~52.5k tokens of
> high-quality pedagogy that an LLM consuming `llms-full.txt`
> doesn't need verbatim because (a) the SPL fence and JSON
> fence carry the actual contract; (b) §1 Source description
> covers the WHEN-TO-USE; (c) §3 Expected fields covers the
> field contract; (d) any agent that needs the per-stage
> rationale follows the URL pointer this trim inserts in place
> of each walkthrough.
> - **New helper.** `strip_recipe_walkthroughs(body, page_url)`
>   in `scripts/build-llms-full-txt.py` runs before
>   `strip_recipe_advisory` for every recipe page. It matches
>   `## 2. SPL recipe` → ```` ```spl … ``` ```` and replaces the
>   immediately-following prose-up-to-`## 3.` with a one-line
>   pointer. Same shape for `## 4. Recommended formatter config`
>   → ```` ```json … ``` ```` → up-to-`## 5.`. Defensive:
>   recipes whose SPL fence uses a different language tag (e.g.
>   ```` ```text ```` for a metric-store walkthrough) are
>   passed through unchanged for that section.
> - **Trim contract.** What's KEPT: §1 Source description (the
>   WHEN-TO-USE), §2 heading + SPL fence verbatim, §3 Expected
>   fields table + 2-3 sentence narrative, §4 heading + JSON
>   fence verbatim. What's DROPPED: §2 walkthrough bullets,
>   §2 closing "Note every `|` starts its own physical line"
>   footer, §4 walkthrough bullets. Already dropped by the
>   wave-4a/6 trim: §5 Screenshot, §6 Gotchas, Verification
>   status. All dropped content stays in the rendered MkDocs
>   site, the per-page source file `docs/recipes/<source>/<layer>.md`,
>   `docs/_machine/recipes/index.yaml`, and is one URL pointer
>   away for any agent that needs it.
> - **Token budget.** Wave 19 lands at **~127,643 estimated
>   tokens** / **~47,357 tokens of WARN headroom** (175,000 -
>   127,643). The largest single-wave reclaim in the project's
>   history — bigger than the wave-10 CHANGELOG trim (~15.6k),
>   the wave-13 ROADMAP status-block trim (~14.7k), the wave-17
>   ROADMAP work-items trim (~7.7k), or the wave-15/16 formatter
>   /recipes-index trims (~3.7k / ~2.7k). Sufficient to fund
>   ~14-15 more recipes at the current ~3k cost-per-recipe
>   median before the next token-trim is required. The cadence
>   relaxes from "one recipe per wave with mandatory token-trim
>   between" back to "two-to-three recipes per wave" through
>   wave 30+.
> - **Why this trim wasn't shipped earlier.** Each prior wave
>   chose the simpler / lower-risk target (boilerplate-with-
>   stub-content, write-once-historical-prose, duplicated-
>   matrix). The walkthroughs are author-time-expensive prose
>   that explains the rationale behind every SPL stage and every
>   config option — high-value content that this trim explicitly
>   chooses to push behind a URL pointer to free up budget for
>   shipping more recipes. The trade-off: an LLM working from
>   `llms-full.txt` alone (no URL fetching) loses the per-stage
>   adaptation guidance and falls back on (a) reading the SPL
>   directly and inferring intent from the pipe structure
>   (always available; SPL is intentionally self-documenting
>   given proper field-name discipline) and (b) the §1 source-
>   description + §3 expected-fields contract for the boundaries.
>   An LLM with URL-fetch tooling (Cursor, Codex, etc.) loses
>   nothing — the pointer URL lands on the rendered MkDocs page
>   with the walkthrough intact.
> - **Future trim levers (in projected-ROI order, none required
>   for wave 20-30).** (a) §1 Source-description compaction —
>   each §1 is currently ~2k chars and contains a "vs companion"
>   layer-choice paragraph that could be split into a dedicated
>   §1b kept verbatim while the rest of §1 is compacted (~5-10k
>   reclaim across 48 recipes). (b) §3 Expected-fields prose
>   trim — the table itself stays but the 2-3 sentence narrative
>   below it duplicates the frontmatter `expected_fields` slot
>   metadata (~3-5k reclaim). (c) Roadmap section §3 "Detailed
>   work-items" further compaction — wave-17 trim already
>   compressed bodies to Problem+Accept+Status+Done+pointer;
>   further compaction (drop bullet structure entirely, keep
>   just titles + Status one-line) would reclaim ~8-10k. None
>   of these are needed until wave 30+ at the current ~3k
>   /recipe cost.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 22 recipes
> SHIPPED (3 more recipes — recipe count 54 → 57, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, paths usage 4 → 6, supercluster usage 5 → 6,
> ot_safety_relevant recipe count 4 → 5).** Wave 22 continues
> the **diversification regime** opened by wave 21, focused on
> a **security-operations theme**: every new recipe is a SOC /
> SecOps-pattern shape on a CIM-security or OT-security source
> row. The diversification regime opened ~24 remaining matrix
> cells in wave 21; wave 22 fills 3 of the highest-value cells
> (paths and supercluster on security sources).
> - **`cim-alerts/paths`** (NEW layer shape for source) —
>   attacker-attribution view on the CIM Alerts data model.
>   Groups events by `src` (source IP) instead of `dest`
>   (target host), geocodes via `iplocation`, and uses
>   `streamstats` to generate per-source monotonic sequence
>   numbers — polyline formatter draws one line per attacker
>   IP, vertex-ordered by alert firing time (kill-chain
>   reconstruction). The `_time span=1m` bucket in the tstats
>   aggregation preserves chronological ordering per (src,
>   dest, signature) tuple (without `span=1m`, all events
>   collapse into single-vertex paths — useless). The
>   `eventstats count BY path_id` + `where hops_in_path >= 2`
>   pattern discards single-vertex paths (geometric definition
>   of a polyline). Right shape for **SOC kill-chain panels**
>   (recon → exploit → privesc → exfil reconstruction) and
>   **incident-response attacker-attribution briefings**. §6
>   gotchas cover the CIM-acceleration requirement, the
>   private-IP source dropout (RFC 1918 sources resolve to
>   null), the 24h-window vs 7d-window trade-off (longer
>   conflates campaigns), the `hops_in_path >= 2` discard
>   (single-alert sources belong in the markers companion),
>   and MITRE ATT&CK technique-mapping (downstream contract
>   via `action.correlationsearch.annotations`). No OT-safety
>   dependency (Level-3/4 SIEM artefacts only).
> - **`cim-authentication/supercluster`** (NEW layer shape for
>   source) — global-enterprise-footprint view on the CIM
>   Authentication data model. Aggregates ALL auth events
>   (not just failures — distinct from the markers companion
>   which is SOC-centric on failed auths) per source IP,
>   computes `success_rate=success_count/auth_count`, and
>   uses the supercluster formatter for zoom-adaptive
>   client-side aggregation. Right shape for **identity-team
>   overview panels** (where is enterprise auth happening at
>   global zoom; per-metro at country zoom; per-source-IP at
>   city zoom). The `success_rate < 0.05 AND distinct_users
>   >= 10` filter combo (in gotchas) is the canonical
>   credential-stuffing signature. §6 gotchas cover the
>   CIM-acceleration requirement, the IPv4-only regex guard
>   (IPv6 sources need a parallel branch in Splunk 9.0+),
>   the `success_rate=0.0` ambiguity (backup service vs
>   credential-stuffer disambiguation via `distinct_users`),
>   the 50k row cap (above 100k, drop to the h3 companion),
>   and GeoIP-database staleness. No OT-safety dependency
>   (CIM Authentication is IT-system identity by definition).
> - **`cyber-vision/paths`** (NEW layer shape,
>   **`ot_safety_relevant: true`**) — OT-lateral-movement
>   reconstruction view on Cyber Vision's `flows` sourcetype.
>   5th OT-safety-relevant recipe in the matrix (joining
>   cyber-vision/markers, cyber-vision/h3, cyber-vision/heat,
>   ot-datastreamer/paths). Aggregates per unique
>   (src_asset, dest_asset, protocol) tuple, joins BOTH
>   endpoints against the same `cybervision_sites.csv` lookup
>   the markers companion uses, and uses an `append` branch
>   to materialise the 2-vertex (src→dest) polyline structure
>   (`mvexpand` cannot reconstruct the row-pair cleanly;
>   `append` is the canonical SPL pattern for endpoint-pair
>   polylines). Right shape for **OT-lateral-movement
>   reconstruction panels** (when an event fires on a PLC,
>   which other OT assets has it been communicating with?)
>   and **Purdue-level-crossing detection** (surfaces
>   `src_zone_purdue_level` ↔ `dest_zone_purdue_level` for
>   immediate visual identification of illegitimate L3→L1
>   bypasses). §6 gotchas embed the FULL OT-safety contract:
>   passive-DPI reference design (Rule 1), Purdue-crossing
>   alert taxonomy (legitimate vs never-legitimate flows
>   per IEC 62443), Rule 2 never-disable-a-flow-event
>   discipline, Rule 3 SOAR-action-zone limit (no auto-push
>   to OT zone), 2-vertex polyline semantics (Cyber Vision
>   sees flows not multi-hop traversals), high `protocol`
>   cardinality (10-30 industrial protocols + IT overlays),
>   and PII / GDPR posture (asset names embed plant-floor
>   semantics).
> - **Token budget.** Wave 22 lands at **~141,305 estimated
>   tokens** / **~33,695 tokens of WARN headroom** (175,000 -
>   141,305). The 3 new recipes cost **~4.5k tokens combined**
>   (~1.5k/recipe) — matches the wave-19-strip post-trim
>   economics. At this cadence, headroom funds **~22 more
>   recipes** before the next token-trim is required.
> - **Layer / pattern coverage updates.** Recipe count 54 → 57
>   (+3). Layer coverage 9/10 unchanged. **paths usage 4 → 6**
>   (cim-alerts + cyber-vision adopt), **supercluster usage 5 →
>   6** (cim-authentication adopts). Source-pattern coverage
>   8/8 unchanged. Source-row triplet count: 14 unchanged
>   (wave 22 deliberately diversification). OT-safety-relevant
>   recipe count: 4 → 5 (cyber-vision/paths joins
>   ot-datastreamer/markers, ot-datastreamer/paths,
>   cyber-vision/markers, cyber-vision/h3, cyber-vision/heat
>   — actually 5 was already correct but cyber-vision/paths
>   adds the FIRST paths-layer OT-safety recipe).
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 24 recipes
> SHIPPED (3 more recipes — recipe count 60 → 63, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, paths usage 7 → 8, supercluster usage 8 → 10).**
> Wave 24 continues the **diversification regime** opened by
> waves 21-23, this time with a **SecOps / NetOps incident-
> response theme**: every new recipe adds a previously-missing
> layer shape to a security or network-operations source row,
> and each one is a companion to an already-shipped layer
> shape on the same source (rather than opening a new triplet).
> Together waves 21-24 have now filled 12 of the original ~24
> diversification cells (3 per wave for 4 waves).
> - **`cim-performance/paths`** (NEW layer shape for source) —
>   incident-cascade polylines that chain hosts in the same
>   `datacenter` that breached the same CPU threshold within
>   the same hour. 4th cell on the cim-performance row
>   (joining markers, h3, heat). Uses `tstats` over
>   `Performance.All_Performance` for CPU > 80%,
>   `asset_lookup_by_str` for geo + `datacenter`, derives
>   `incident_id = datacenter . "__" . hour_bucket` to group
>   co-located co-breaching hosts, `streamstats count AS seq
>   BY incident_id` for vertex ordering, and
>   `eventstats dc(host) AS hops_in_incident BY incident_id` +
>   `where hops_in_incident >= 2` to drop singletons. Right
>   shape for **SRE blame-cascade reconstruction panels** —
>   surfaces "noisy-neighbor" incidents (one host's CPU
>   pressure correlating with peers in the same rack/AZ) in a
>   way that markers + h3 cannot. §6 gotchas cover the
>   `asset_lookup_by_str` Splunk Enterprise Security dependency
>   (assets framework is ES-only; CIM-only deployments need an
>   alternate enrichment lookup), the hour-bucket grouping
>   tradeoff (true incidents often span 15-90 min not exactly
>   an hour; tune `bucket _time span=1h` to environment), the
>   datacenter-grouping assumption (assets without
>   `datacenter` get filtered — fillnull for cloud-native
>   shops), and the `head 2000` cap. No OT-safety dependency
>   (CIM Performance is IT-host telemetry).
> - **`es-risk/supercluster`** (NEW layer shape for source) —
>   portfolio risk-object overview at executive zoom. 4th
>   cell on the es-risk row (joining markers, h3, heat).
>   Inherits the markers companion's `risk` index + 24-hour
>   window + `identity_lookup_expanded` + `asset_lookup_by_str`
>   geo enrichment, but **lowers** the risk threshold
>   (`total_risk >= 10` vs the markers companion's higher
>   threshold) to surface a broader portfolio view, and caps
>   at `head 5000`. Forces `pointRenderer: "cluster"` for
>   zoom-adaptive aggregation — at world zoom 5000 risk
>   objects render as ~25 cluster pills (one per major
>   region); progressively splits as the user zooms. Right
>   shape for **CISO / SOC-manager portfolio risk-posture
>   overview panels** where the markers companion's
>   individual-marker rendering would overwhelm at 1000+
>   risk objects. §6 gotchas cover the asymmetric A&I
>   coverage (some risk objects geocode from
>   `identity_lookup_expanded`, others from
>   `asset_lookup_by_str`; `coalesce` pattern handles both),
>   the lowered risk threshold (matched to portfolio-overview
>   semantics; for action-grade alerting see markers
>   companion), cluster-pill aggregate semantics (count not
>   summed risk-score; use the h3 companion for per-region
>   risk-score aggregation), and the `head 5000` defensive
>   cap. No OT-safety dependency (ES risk index is IT-
>   security identity / asset data).
> - **`netflow-sflow-ipfix/supercluster`** (NEW layer shape
>   for source) — global NetFlow destination footprint at
>   executive zoom. 5th cell on the netflow row (joining
>   markers, h3, heat, paths). Inherits the markers
>   companion's NetFlow / sFlow / IPFIX schema + `iplocation
>   dest_ip` enrichment, but **lowers** the bytes threshold
>   (`bytes >= 1048576` / 1 MB vs the paths companion's 10
>   MB) for wider coverage and caps at `head 10000`. Forces
>   `pointRenderer: "cluster"` for zoom-adaptive aggregation
>   — at world zoom 10k destinations render as ~20 cluster
>   pills; progressively splits as the user zooms. Right
>   shape for **NetOps single-pane global-destination
>   overview panels** that need to handle 10k+ destinations
>   without freezing the renderer. §6 gotchas cover the CDN
>   destination geo-flicker (CDNs shift POPs hourly — same
>   `dest_ip` may bounce between regions across the 1-hour
>   window), the lowered 1 MB threshold (matched to
>   overview-grade semantics; for action-grade investigation
>   see the paths companion's 10 MB threshold), cluster-pill
>   aggregate semantics (count not summed bytes; use the h3
>   companion for per-region bytes aggregation), and the
>   `head 10000` render cap (audit-grade coverage needs
>   country / port-band partitioning). No OT-safety
>   dependency (NetFlow is IT-layer flow data).
> - **Token budget.** Wave 24 lands at **~148,914 estimated
>   tokens** / **~26,086 tokens of WARN headroom** (175,000 -
>   148,914). The 3 new recipes cost **~3.6k tokens combined**
>   (~1.21k/recipe) — slightly under the wave-23 baseline of
>   ~1.27k/recipe. At this cadence, headroom funds **~21 more
>   recipes** before the next token-trim is required.
> - **Layer / pattern coverage updates.** Recipe count 60 → 63
>   (+3). Layer coverage 9/10 unchanged (extrusion-3d still
>   the one cell occupied). **paths usage 7 → 8** (cim-
>   performance adopts). **supercluster usage 8 → 10** (es-
>   risk + netflow both adopt). Source-pattern coverage 8/8
>   unchanged. Source-row triplet count: 14 unchanged (wave
>   24 deliberately diversification). OT-safety-relevant
>   recipe count: 5 unchanged (none of the wave-24 recipes
>   are OT-safety-relevant). The diversification regime now
>   has filled **12 of the original ~24 cells** opened by
>   wave 21 (3 per wave for waves 21-24) — remaining cells
>   skew toward `choropleth` (8 source rows missing it), the
>   long-tail polygon shapes (`vector-tile-join`,
>   `extrusion-3d`-on-non-geo sources), and `paths` /
>   `supercluster` on the remaining source rows that don't
>   already have them (cim-alerts already has paths;
>   cim-authentication already has supercluster; the
>   remaining gaps for these two shapes are concentrated on
>   geo-lookup-pattern sources like csv-lookup-geo /
>   kvstore-latlon / thousandeyes).
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 23 recipes
> SHIPPED (3 more recipes — recipe count 57 → 60, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, paths usage 6 → 7, supercluster usage 6 → 8).**
> Wave 23 continues the **diversification regime** opened by
> wave 21 and continued by wave 22, this time with an
> **observability theme**: every new recipe adds a previously-
> missing layer shape to an observability / NetOps / SRE
> source row. The diversification regime opened ~24 remaining
> matrix cells in wave 21; waves 22-23 together fill 6 of those
> cells (3 each).
> - **`netflow-sflow-ipfix/paths`** (NEW layer shape for source)
>   — top-talker flow-attribution view on the NetFlow / sFlow /
>   IPFIX flow-record stream. 4th cell on the netflow row
>   (joining markers, h3, heat). Aggregates per unique
>   (src_ip, dest_ip) tuple over a 1-hour window, drops noise
>   via `where bytes >= 10485760` (10 MB threshold), geocodes
>   BOTH endpoints via `iplocation src_ip prefix=src_` +
>   `iplocation dest_ip`, and uses the canonical `append`-
>   branch pattern (seq=0 source, seq=1 destination) to
>   materialise 2-vertex polylines. Right shape for **NetOps
>   top-talker overlay panels** — when a markers companion
>   surfaces an 800 GB destination, the paths companion shows
>   which sources are hitting that destination and from which
>   geographies. §6 gotchas cover the both-endpoints-must-
>   geocode constraint (internal-to-internal east-west flows
>   drop entirely — use CMDB lookup instead), the 10 MB
>   threshold tuning (environment-specific), the `append`-
>   doubles-execution-time cost (acceptable for operator-pull
>   panels; summary-index for auto-refresh), asymmetric routing
>   (BGP multi-homed networks may show both flow halves as
>   separate polylines unless canonicalised), and Splunk 8.0+
>   `iplocation prefix=` syntax. No OT-safety dependency
>   (NetFlow is IT-layer flow data).
> - **`splunk-stream/supercluster`** (NEW layer shape for
>   source) — global wire-data destination footprint view on
>   Splunk Stream's `stream:tls` sourcetype. 4th cell on the
>   splunk-stream row (joining markers, h3, heat). Same
>   `iplocation` enrichment as the markers companion but
>   collapsed to one row per `dest_ip` (with `sum(bytes_out)`,
>   `count` sessions, `dc(src_ip)` distinct sources) and
>   capped at `head 10000`. Forces `pointRenderer: "cluster"`
>   for zoom-adaptive aggregation — at world zoom a 10k-
>   destination payload renders as ~20 cluster pills (one per
>   major region); progressively splits as the user zooms.
>   Right shape for **single-pane global wire-data overview
>   panels** that need to handle 10k+ destinations without
>   freezing the renderer. §6 gotchas cover CDN destination
>   geo-flicker (Cloudflare/Akamai shift POPs hourly), the
>   `head 10000` render cap (audit-grade coverage needs
>   port-band partitioning), `pointRenderer: "cluster"` vs
>   `"auto"` (this recipe forces unconditionally because
>   individual-marker rendering is never right at 10k scale),
>   and the `stream:tls` wire-byte semantics (TCP-payload
>   bytes, not application-layer bytes). No OT-safety
>   dependency (Splunk Stream is IT-perimeter wire-data).
> - **`itsi-kpi-base/supercluster`** (NEW layer shape for
>   source) — executive global-portfolio service-health view
>   on ITSI's `SHKPI-*` service-health events. 4th cell on
>   the itsi-kpi-base row (joining markers, h3, heat).
>   Inherits the markers companion's `itsi_summary` +
>   `itsi_services` KV-store-lookup contract but drops the
>   `join` for `critical_kpi_count` (supercluster pills
>   don't render per-row popup data at cluster-aggregate
>   zoom, so the join is dead weight). Forces
>   `pointRenderer: "cluster"` for zoom-adaptive aggregation
>   — at world zoom a 500-service portfolio renders as ~12
>   cluster pills (one per major DC region). Right shape for
>   **CIO / SRE-manager executive overview panels** where the
>   markers companion's individual-marker rendering would
>   overwhelm at portfolio scale (50-500 services across
>   multiple continents). §6 gotchas cover the `info_lat` /
>   `info_lon` operator-extension dependency (inherited from
>   markers companion), cluster-pill aggregate semantics
>   (count not averaged health-score; use the h3 companion
>   for per-region health aggregation), the `head 1000`
>   render cap (defensive — typical installations return
>   <500 rows), no per-service critical-KPI context in
>   cluster popups (click-through to markers companion for
>   drilldown), and no OT-safety dependency (ITSI service
>   health is an IT-services concept).
> - **Token budget.** Wave 23 lands at **~145,276 estimated
>   tokens** / **~29,724 tokens of WARN headroom** (175,000 -
>   145,276). The 3 new recipes cost **~3.8k tokens combined**
>   (~1.27k/recipe) — slightly under the wave-22 baseline of
>   ~1.5k/recipe. At this cadence, headroom funds **~23 more
>   recipes** before the next token-trim is required.
> - **Layer / pattern coverage updates.** Recipe count 57 → 60
>   (+3). Layer coverage 9/10 unchanged (extrusion-3d still
>   the one cell occupied). **paths usage 6 → 7** (netflow
>   adopts). **supercluster usage 6 → 8** (splunk-stream +
>   itsi-kpi-base both adopt). Source-pattern coverage 8/8
>   unchanged. Source-row triplet count: 14 unchanged (wave
>   23 deliberately diversification). OT-safety-relevant
>   recipe count: 5 unchanged (none of the wave-23 recipes
>   are OT-safety-relevant). The diversification regime now
>   has filled **9 of the original ~24 cells** opened by
>   wave 21 (3 in wave 21 + 3 in wave 22 + 3 in wave 23) —
>   remaining cells skew toward `choropleth` (8 source rows
>   missing it) and the long-tail polygon shapes
>   (`vector-tile-join`, `extrusion-3d`-on-non-geo sources).
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 21 recipes
> SHIPPED (3 more recipes — recipe count 51 → 54, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, choropleth usage 1 → 2, supercluster usage 4 → 5,
> paths usage 3 → 4).** Wave 21 pivots from the
> triplet-completion regime (waves 11-20 closed 14 source-row
> triplets) to a **diversification regime**: each new recipe adds
> a NEW layer shape to an EXISTING source row that already had ≥1
> recipe but lacked the chosen shape. This regime is the right
> next move now that 14 of ~15 triplet candidates are complete —
> remaining matrix gaps are 4th-or-5th layer cells on rows that
> already have triplets, where the marginal LLM-corpus value of
> each new recipe is "yet another shape demonstrated on a
> familiar source" rather than "yet another source triplet".
> - **`cim-network-traffic/choropleth`** — adds the FIRST polygon-
>   derived recipe to the cim-network-traffic source row (which
>   already had markers, paths, h3, heat, supercluster from waves
>   3, 5, 7, 12, 9). The recipe maps **events-per-source-state**:
>   `iplocation src` geocodes external source IPs to a US state,
>   `where Country="United States" AND isnotnull(Region)` filters
>   to US only (the bundled `us-states` PMTiles preset only covers
>   the US — for global, the recipe `gotchas` explain how to swap
>   to a custom PMTiles bundle), and an `eval id=upper(case(...))`
>   normalises full state names to USPS 2-letter codes (the join
>   key the `us-states` preset expects). The choropleth lens is
>   the right shape for **per-state geo-attribution panels**
>   (SOC / incident-response triage: "where in the US is most of
>   the inbound traffic to my CIM-tagged endpoints coming from?")
>   and **regulatory-jurisdiction views** (state-level data-flow
>   reporting). §6 gotchas cover the `tag=network tag=communicate`
>   discipline (drops parsing-error and non-CIM events), the US-
>   only PMTiles preset constraint (with an explicit alternative
>   path: ship a `world-countries` PMTiles for global), the
>   USPS-code normalisation requirement (the `case(...)` table
>   covers the 20 most populous states + DC; smaller states would
>   need adding or the recipe falls back to the first 2 chars of
>   the region name, which is wrong for "Mississippi"="MI" vs
>   Michigan), `src` vs `dest` choice (this recipe picks `src` for
>   inbound attribution; mirror with `dest` for outbound),
>   `iplocation` GeoIP-database age (Splunk auto-updates monthly;
>   stale install can mis-attribute new IP ranges), `palette:
>   "viridis"` (perceptually uniform; safe for color-blind
>   reviewers), and no OT-safety boundary (CIM Network Traffic
>   data is IT only by definition).
> - **`meraki/supercluster`** — adds zoom-adaptive clustering to
>   the meraki source row (which already had markers, h3, heat
>   from waves 4b, 11, 10). Same `index=meraki sourcetype=
>   "meraki:devices"` + `dedup serial sortby - _time` + `where
>   isnotnull(lat) AND isnotnull(lng)` base search as the
>   markers companion — the only material difference is the
>   formatter setting `pointRenderer: "cluster"` which delegates
>   per-zoom-level aggregation to the supercluster algorithm
>   shipped in `@splunk/better-map`. This is the right shape for
>   **global-fleet inventory dashboards** (5,000+ devices: at
>   zoom 0-4 you see cluster bubbles per continent / country, at
>   zoom 8-12 you see clusters per metro, at zoom 14+ you see
>   individual APs / switches / cameras) without the cognitive
>   overload of 5,000 colliding marker pins. The cluster formatter
>   preserves per-device identity (each device row keeps its
>   `serial`, `model`, `status`, `network_name` fields) — clicking
>   into a cluster zooms it apart rather than collapsing the
>   data. §6 gotchas cover the `head 5000` per-panel cap
>   (formatter cluster default settings hardcode the cap; remove
>   for global enterprise fleets), `clusterMaxZoom: 14` (default
>   right for metro-scale; raise to 16 for floor-plan-zoom),
>   `clusterRadius: 50` (CSS pixels; lower to 30-40 for denser
>   per-metro displays), the `lng AS lon` rename (Meraki API uses
>   `lng`; recipe MUST rename for the formatter contract), Meraki
>   geo-coordinate accuracy (manually-assigned APs sometimes
>   default to the network's billing address rather than the
>   actual install location; document expected drift), the
>   `status` `coalesce("unknown")` fallback (rare Meraki devices
>   ship null status during initial provisioning), and no OT-
>   safety boundary (Meraki devices are IT equipment by
>   definition; for OT-zone equipment use the ot-datastreamer
>   markers recipe with passive-collection / OT-safety carve-out).
> - **`ot-datastreamer/paths`** — adds **trajectory visualisation**
>   to the ot-datastreamer source row (markers, heat, h3 from
>   waves 4b, 8, 16). This is the **4th OT-safety-relevant
>   recipe** (`ot_safety_relevant: true`) and demonstrates the
>   paths layer's value for **mobile OT asset tracking** —
>   AGVs (Autonomous Guided Vehicles), forklifts, mobile
>   inspection drones, technician-tagged equipment. The recipe
>   reads `index=edge_hub_mqtt sourcetype="edge_hub_mqtt"` events
>   tagged with MQTT topic `edgehub/mqtt_events/agv/*` (the
>   Edge Hub per-topic-class routing convention; broaden to
>   `(agv|vehicle|drone)/*` for multi-class panels). The
>   `eval path_id=asset_id."__".tostring(relative_time(now(),
>   "-1h"))` + `sort 0 asset_id, _time` + `streamstats current=
>   true count AS seq BY path_id` pattern is the recipe's
>   distinguishing move — per-asset polylines with monotonic
>   sequence numbers (the paths layer's `timeField` contract;
>   `streamstats` is preferred over `_time` because it always
>   yields a clean monotonic sequence regardless of clock skew
>   between Edge Hub collectors). The 1-hour window is sized for
>   shift-overview panels; for incident reconstruction narrow to
>   ±5-10 minutes around the timestamp of interest. §6 gotchas
>   cover OT-safety boundary (passive-only collection per
>   `ot-safety.mdc` Rule 1 — Edge Hub reads from MQTT brokers
>   that PLCs publish to; NEVER active CIP/Modbus/S7 probes of
>   AGV control planes), the `zone_purdue_level` coalesce
>   (default `L2` if the Edge Hub plugin doesn't tag — most AGV
>   telemetry IS L2 process-monitoring data), GPS drift on
>   indoor AGVs (warehouse-grade GPS can drift ±5m; for high-
>   precision tracking use the UWB-tagged variant of the recipe
>   with `iblet_id` instead of `lat`/`lon`), the `head 5000`
>   per-panel cap (50+ AGVs × 1-hour 5-second-sample rate =
>   36,000 rows; the `head` filter trims to the first 5,000
>   to keep render times <500ms — narrow the time window for
>   denser fleets), `path_id` cardinality (every asset_id ×
>   hour-window combination gets a unique path; the formatter
>   draws one polyline per path), `pathArrows: true` (renders
>   direction-of-travel chevrons; the default is `false` —
>   enable for AGV-incident-replay panels), and `speed_mps`
>   field optionality (Edge Hub configurations vary; the recipe
>   doesn't break if absent but the per-segment colour-by-speed
>   downstream gotcha won't work).
> - **Token budget.** Wave 21 lands at **~136,830 estimated
>   tokens** / **~38,170 tokens of WARN headroom** (175,000 -
>   136,830). The 3 new recipes cost only **~4.5k tokens
>   combined** (~1.5k/recipe) — matches the wave-19-strip post-
>   trim economics. At this cadence, headroom funds **~25 more
>   recipes** before the next token-trim is required.
> - **Layer / pattern coverage updates.** Recipe count 51 → 54
>   (+3). Layer coverage 9/10 unchanged (extrusion-3d still the
>   one cell occupied; choropleth usage 1 → 2 because cim-network-
>   traffic adopts; supercluster usage 4 → 5; paths usage 3 → 4).
>   Source-pattern coverage 8/8 unchanged. Source-row triplet
>   count: 14 (unchanged — wave 21 was deliberately a
>   diversification wave, not a triplet-completion wave). The
>   diversification regime opens **~24 remaining matrix cells**
>   for future waves: each existing source row has 1-3 missing
>   layer shapes that could be filled; the highest-value next
>   shapes per row would be:
>   - cim-alerts: missing choropleth, paths, supercluster
>   - cim-authentication: missing choropleth, heat, paths,
>     supercluster
>   - cim-network-traffic: now has 6/9 shapes — extrusion-3d and
>     vector-tile-join are the remaining cells (extrusion-3d
>     requires polygon source so geo-us-states-style)
>   - cim-performance: missing choropleth, paths, supercluster
>   - cyber-vision: missing choropleth, paths, supercluster
>   - es-risk: missing choropleth, markers, paths, supercluster
>   - itsi-kpi-base: missing choropleth, paths, supercluster
>   - kvstore-latlon: missing choropleth, paths
>   - meraki: now has 4/9 — missing choropleth, paths, vector-
>     tile-join, extrusion-3d (geo-aware)
>   - netflow-sflow-ipfix: missing choropleth, h3, paths,
>     supercluster
>   - ot-datastreamer: now has 4/9 — missing choropleth,
>     supercluster, vector-tile-join (only the ot-zone-shapefile
>     subset would be relevant for the OT carve-out)
>   - splunk-stream: missing choropleth, markers, paths,
>     supercluster
>   - thousandeyes: now has 4/9 — missing choropleth,
>     supercluster
>   - geo-us-states: choropleth/extrusion-3d/vector-tile-join
>     already covered; markers/heat/h3 NOT applicable (polygon-
>     source row, not point-data)
>   The next 2-3 waves should continue the diversification regime
>   to fill the highest-value missing cells per source row.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 20 recipes
> SHIPPED (3 more recipes — recipe count 48 → 51, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, heat usage 8 → 9, h3 usage 11 → 13).** Wave 20
> completes the **13th and 14th source-row triplets**:
> - **`itsi-kpi-base/h3`** — closes the ITSI service-health
>   triplet (markers from wave 11, heat from wave 18, h3 from
>   wave 20). The H3 hexbin shape suits **regional-jurisdiction
>   service-degradation roll-up panels** (e.g. "how many critical
>   ITSI services across each AWS region right now") and pairs
>   the same `index=itsi_summary kpi_id="SHKPI-*" entity_key="N/A"`
>   service-health-KPI base search with the `itsi_services`
>   collection geo-lookup that the markers and heat companions
>   use. The `eval is_unhealthy=if(alert_level >= 3, 1, 0)` +
>   `stats sum(is_unhealthy)` pivot is the recipe's distinguishing
>   move — turns alert_level severity into a per-region count of
>   unhealthy services. §6 gotchas cover threshold tuning
>   (`alert_level >= 3` vs `>= 2` vs `>= 4`), the geo-lookup
>   semi-join cardinality risk, the `kpi_id="SHKPI-*"` MUST-filter
>   discipline, the 60-min ITSI summary-pipeline lag, the missing
>   `info_lat`/`info_lon` failure mode (services collapsed to
>   `sum(0)`=0 unhealthy), `hexbinResolution: 3` (~600km cell
>   diameter, the right scale for jurisdictional roll-up at
>   global zoom), and no OT-safety boundary (IT-service health).
> - **`thousandeyes/h3`** — opens the ThousandEyes source row to
>   h3 layer coverage (markers wave 11, paths wave 5, h3 + heat
>   wave 20). The recipe pairs the agent-inventory base search
>   (`index=thousandeyes_agents` + `dedup agent_id sortby - _time`
>   + `is_online="true"`) with the test-load join subsearch
>   (`dc(test_id) BY agent_id`) and aggregates per-site agent
>   AND test counts via `stats count, sum(test_count) BY
>   agent_lat, agent_lon`. The h3 lens is the right shape for
>   **per-region DEM coverage briefings** (jurisdictional sum-
>   aggregation showing test-load concentration). §6 gotchas
>   cover the `is_online="true"` non-negotiable filter (offline
>   agents inflate live coverage), agent-location auto-geocode
>   data quality (cloud-region centroid drift; BGP-NOC fallback
>   can be hundreds of km off; document the floor), the per-
>   panel vs cross-panel weight-comparison trap (each panel's
>   `weight` is normalised to its own `max`), GDPR considerations
>   (h3-resolution-3 is safer than markers but still surfaces
>   per-cell counts), the `value=test_count` vs `=agent_count`
>   semantic-meaning swap, and no OT-safety boundary.
> - **`thousandeyes/heat`** — completes the ThousandEyes triplet
>   with the smooth-density complement. Same agent-inventory +
>   test-load aggregation as the h3 companion but rendered as a
>   weighted Gaussian heat surface via the
>   `eventstats max(test_count) AS max_test_count` /
>   `eval weight=test_count/max_test_count` normalisation pattern
>   (identical to es-risk/heat, itsi-kpi-base/heat,
>   cim-performance/heat). The right shape for **executive DEM
>   coverage panels** ("where is coverage smooth? where are the
>   gaps?") and **capacity-planning slide decks**, distinct from
>   the markers companion (per-agent identity), the h3 companion
>   (hard-bordered jurisdictional aggregation), and the paths
>   companion (hop-by-hop test polylines). §6 gotchas cover the
>   same `is_online="true"` filter, the `weight` semantic choice
>   (test_count vs agent_count → different panel meanings), the
>   `heatmapRadius: 28` default (right for global SRE leadership
>   view; drop to 18-22 for sub-region granularity), no hard
>   borders by design (use h3 for jurisdictional aggregation),
>   GDPR considerations (smoother than markers, less safe than
>   h3-resolution-3), agent-location data-quality cascade into
>   blob centroid, and no OT-safety boundary.
> - **Token budget.** Wave 20 lands at **~132,281 estimated
>   tokens** / **~42,719 tokens of WARN headroom** (175,000 -
>   132,281). The 3 new recipes cost only **~4.6k tokens
>   combined** (~1.5k/recipe) — dramatically cheaper than the
>   pre-wave-19 cost of ~3k/recipe because the wave-19 walkthrough
>   strip removes ~1.5k of pedagogical prose from each new recipe
>   before it lands in `llms-full.txt`. The new economics: at
>   ~1.5k/recipe headroom funds **~28 more recipes** before the
>   next token-trim is required. The cadence relaxes further:
>   wave 21+ can ship 3-5 recipes per wave routinely.
> - **Layer / pattern coverage updates.** Recipe count 48 → 51
>   (+3). Layer coverage 9/10 unchanged (extrusion-3d still the
>   one cell occupied; choropleth/vector-tile-join/cluster/heat/
>   h3/markers/paths/supercluster all already covered). Source-
>   pattern coverage 8/8 unchanged (all 8 patterns covered since
>   wave 3). Source-row triplet count: 12 → 14 (out of ~15
>   triplet candidates; geo-us-states is intentionally NOT a
>   markers/heat/h3 target — its choropleth+extrusion-3d
>   coverage is the triplet equivalent). Two recipes per row
>   that don't have triplets yet, in projected wave order:
>   **aiAssistant** (no recipes; the source is the AI assistant
>   itself, intentionally NOT a map-data target), and
>   **purdue/mitre/rba/soar/esNotable** (security workflow
>   integrations, not map sources). The matrix is functionally
>   complete for map-data sources; remaining waves harvest
>   second-companion shapes (h3 / heat / supercluster) on rows
>   that already have ≥1 layer.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 17 recipes
> SHIPPED (2 more recipes — recipe count 45 → 47, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, heat usage 7 → 8, h3 usage 10 → 11).** Wave 17
> completes the **11th + 12th source-row triplets** (every
> triplet so far: cim-alerts, cim-authentication,
> cim-network-traffic, cim-performance, cyber-vision, es-risk,
> meraki, netflow-sflow-ipfix, splunk-stream, ot-datastreamer
> from waves 4b–16, plus **csv-lookup-geo** AND **kvstore-latlon**
> now completing markers / heat / h3):
> - **`csv-lookup-geo/heat`** — completes the csv-lookup-geo
>   triplet (markers from wave 6, heat from wave 17, h3 already
>   shipped; supercluster and vector-tile-join also already
>   shipped — csv-lookup-geo is now the most-comprehensively-
>   covered source row in the matrix at 5 layer recipes). The
>   heat layer is the right shape for **executive activity-
>   density briefings** (smooth Gaussian per-site pressure
>   surface from an events-index join), **operations heatmap
>   panels** (where IS the load concentrated this hour), and
>   **per-site weighted-activity views** (each site contributes
>   weight ∝ its event_count via the `eventstats max` /
>   `weight=event_count/max_event_count` normalisation
>   pattern). Distinct from the markers companion (per-site
>   identity pins), the h3 companion (hard-bordered regional
>   sum-aggregates), and the supercluster companion (zoom-
>   adaptive cluster bubbles). The §6 Gotchas cover the
>   site_id-extraction prereq, the weight-normalisation
>   choice (`max` vs `log10` vs absolute), the layer-choice
>   matrix (heat vs markers vs supercluster vs h3), the
>   CSV-vs-KV-Store decision (CSV for editor-driven mappings
>   ≤10k rows / KV-Store for REST-API-driven mappings),
>   `auto` renderer disabling, empty-result handling, the
>   10MB CSV ceiling, and the no-OT-safety boundary.
> - **`kvstore-latlon/h3`** — completes the kvstore-latlon
>   triplet (markers from wave 4b, heat from wave 4b, h3 from
>   wave 17; supercluster from wave 9 also already shipped —
>   kvstore-latlon is also at 4 layer recipes now). The h3
>   layer is the right shape for **regional capacity
>   briefings** (continental sum-aggregated hexes — "region
>   8b1 in continental Europe drew 1.2M events"), **board-
>   level deployment-scope maps** (one hex per
>   continental jurisdiction at resolution 3), and **data-
>   residency audits** (flag any hex outside the contracted
>   region with non-zero `value`). Distinct from the heat
>   companion (smooth Gaussian per-site pressure, no hard
>   borders) and the markers companion (per-site identity
>   pins). The §6 Gotchas cover the same site_id-extraction
>   prereq as the heat companion, the `hexbinResolution`
>   selection guide (3 = continental / 4-5 = country /
>   6-7 = metro / 8-9 = building), the H3-vs-heat matrix
>   (boundary-aware totals vs smooth-gradient pressure),
>   the `sum`/`count`/`avg`/`max` aggregate-choice contract
>   (default `sum`), the per-hex popup contract (shows the
>   aggregated `value`, NOT individual sites), the `value`
>   field-aliasing rule, empty-result handling, the no-
>   cross-panel normalisation gotcha (each h3 panel
>   independently auto-scales its colour ramp to its
>   per-panel min/max), and the OT-safety carve-out (Rule
>   1 + Rule 5 — SIS sites belong in a dedicated layer
>   with their own `ot_safety_relevant: true` flag because
>   hex aggregation does NOT preserve per-site safety
>   distinctions).
> - **Triplet completion now 12 / 15 source dirs.** The
>   wave-16 status block noted `csv-lookup-geo/heat` and
>   `kvstore-latlon/h3` as the two best one-cell-away
>   triplet completers; wave 17 cleared both in a single
>   PR. Remaining source rows: `geo-us-states` (geo-shape
>   row, intentionally NOT a markers-style triplet
>   target), `itsi-kpi-base` (has markers only; missing
>   h3/heat — two-cell-away triplet candidate), and
>   `thousandeyes` (has markers + paths; missing h3/heat
>   — two-cell-away triplet candidate). Best wave 18+
>   triplet-completing two-cell sets: `itsi-kpi-base/h3` +
>   `itsi-kpi-base/heat` OR `thousandeyes/h3` +
>   `thousandeyes/heat`.
> - **Layer-type coverage 9 / 10 unchanged.** Both the heat
>   layer (already shipped in 7 prior recipes from waves
>   4b–14) and the h3 layer (already shipped in 10 prior
>   recipes from waves 8–16) are well-established; wave 17
>   just extends each to the next missing source row.
>   The only remaining layer is `indoor`, which is blocked
>   on the v1.8+ floor-plan-overlay UI infrastructure.
> - **Source-pattern coverage 8 / 8 unchanged.** All eight
>   source patterns were already represented from wave 6's
>   21-recipe milestone; wave 17 adds one recipe each to
>   `splunk-lookup` (csv-lookup-geo) and `splunk-lookup`
>   (kvstore-latlon) — the pattern was already shipped, so
>   the count is unchanged.
> - **Token budget.** Wave 17 trim opened ~8,337 tokens of
>   WARN headroom (175,000 - 166,663). The two recipes add
>   ~5,329 tokens combined (~2,665 per recipe — slightly
>   above the 2,800-token median because both recipes are
>   triplet-completers and therefore include a more
>   comprehensive "vs companion" decision matrix in §1 +
>   §6); the wave 17 recipes status block adds ~2k more
>   (self-stripping, so zero net corpus impact via the
>   wave-13 generalised regex). `llms-full.txt` lands at
>   **~171,992 estimated tokens** / **~3,008 tokens of
>   WARN headroom**. Sufficient to fund 1 more recipe at
>   ~2.8k cost in wave 18 before the next token-trim is
>   required. Most-promising wave-18 trim levers (in
>   projected-ROI order): (a) recipe-page §1 Source-
>   description compaction (rejected for wave 17 but the
>   "vs" layer-choice comparison embedded in §1 is high-
>   signal — could be split out into a dedicated §1b
>   subsection that's NOT trimmed, allowing the rest of
>   §1 to be compacted); (b) per-recipe §6 Gotchas
>   sub-trim (currently kept verbatim but contains
>   significant repetition of the OT-safety boundary
>   across recipes — could deduplicate to a shared
>   reference); (c) a second CHANGELOG iteration if a new
>   release adds large `## [VERSION]` sections.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 17 token-trim
> SHIPPED (~7.7k tokens reclaimed by compacting each Theme A-G
> work-item body in `ROADMAP.md` to its heading + Problem + Accept
> + Status + Done bullets, dropping Design / Prereqs / Risk and
> any trailing free-prose body — see
> `strip_roadmap_workitem_bodies` in `scripts/build-llms-full-txt.py`).**
> Wave 16 recipes landed at 174,369 / 175,000 estimated tokens
> (~631 WARN headroom — too tight for any more recipes), so wave
> 17 opened with a token-trim PR before any recipe authoring (the
> wave-16-recipes status block already declared this contract).
> Wave 17 trim choice:
> - **Profiling result.** The ROADMAP page was the largest single
>   contributor to the corpus at ~28.5k tokens (16% of the full
>   175k budget — bigger than any single recipe by 8×). Of that,
>   Themes A-G alone are ~14.1k tokens (49% of the roadmap), and
>   the 40 work-items under those themes carry ~92% of the per-
>   theme weight in structured 5-bullet
>   Problem / Design / Prereqs / Risk / Accept format.
> - **Why heading + Problem + Accept is the right keep-set.**
>   An LLM authoring code in this repo TODAY needs (a) the work-
>   item ID + title (for cross-references like "see A1 for the
>   Web-Worker design") and (b) the WHAT (Problem) and the DONE-
>   criterion (Accept) to align new code with the project's
>   intent. The HOW (Design), the WHEN (Prereqs), and the WHAT-IF
>   (Risk) are HISTORICAL design context useful for auditing past
>   decisions but rarely needed for the day-to-day tactical work
>   (authoring recipes, gates, integrations). Status and Done
>   bullets are kept because they encode "this item already
>   shipped, here's what landed" — actionable for the agent.
> - **Other levers considered and rejected.** §1 source-description
>   compaction across 45 recipes was projected at ~10-14k reclaim
>   but the "vs" layer-choice comparison embedded in §1 is HIGH-
>   signal for LLMs authoring NEW recipes — rejected. §4 prose-strip
>   (keep YAML, drop rationale) was projected at ~18k reclaim but
>   the per-config-key rationale (e.g. "heatmapRadius=28 because
>   cloud regions have higher density than on-prem datacenters")
>   is the most concrete trade-off-space training data in the
>   corpus — rejected. §2 SPL-recipe prose strip was projected at
>   ~50k reclaim but the line-by-line "Why this exact SPL shape"
>   prose IS the main pedagogical signal of every recipe —
>   rejected. The work-item-body trim is the highest ROI lever
>   that minimises signal-loss for the LLM authoring-code use
>   case.
> - **Net token impact.** `llms-full.txt` 174,369 → 166,663
>   estimated tokens (~7.7k reclaimed, 4.4% of the corpus).
>   Roadmap page weight 114,067 → 83,242 chars (~28.5k → ~20.8k
>   tokens). Per-work-item rendered weight ~340 → ~150 tokens
>   (heading + 2-3 bullets + 1-line pointer). The raw savings of
>   ~18.6k tokens are reduced by the MkDocs Material chrome strip
>   pass which consolidates the blank-line-rich trim output
>   (`re.sub(r"\\n{3,}", "\\n\\n", out)` in `strip_chrome`).
> - **Idempotency.** The trim is structurally idempotent — re-
>   running it on an already-trimmed body is a no-op because the
>   non-keep bullets are already gone and the remaining bullets
>   all match the keep-list. Verified on the wave-17 prototype.
> - **The on-disk ROADMAP.md is unchanged** — the trim runs only
>   in the in-memory body before it lands in `llms-full.txt`. The
>   MkDocs site continues to render every Design / Prereqs / Risk
>   bullet for human readers via the unaltered
>   `include-markdown` directive in `docs/roadmap.md` (the literal
>   directive syntax is not reproduced here to avoid the
>   `resolve_includes` recursion-guard re-expansion documented
>   in the wave-8 G7 follow-up #3 status block).
>   This preserves the source-of-truth nature
>   of the document for the project owner and for any human
>   reviewer auditing past design decisions.
> - **Headroom after trim.** 175,000 - 166,663 = ~8,337 tokens of
>   WARN headroom. At ~2,800 tokens per recipe (median across the
>   last 5 waves) this unlocks ~2-3 more recipes per future wave
>   before the next token-trim is required. The next-best trim
>   levers (if Wave 18-19 push us back against WARN) are
>   documented above and remain available, though all of them
>   carry higher signal-loss risk than this work-item-body trim.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 16 recipes
> SHIPPED (1 more recipe — recipe count 44 → 45, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, h3 layer usage 9 → 10).** Wave 16 completes the
> **10th source-row triplet** (every triplet so far: cim-alerts,
> cim-authentication, cim-network-traffic, cim-performance,
> cyber-vision, es-risk, meraki, netflow-sflow-ipfix, splunk-stream
> from waves 4b–15, plus **ot-datastreamer** now completing
> markers / heat / h3):
> - **`ot-datastreamer/h3`** — completes the ot-datastreamer
>   triplet (markers from wave 4b, heat from wave 8, h3 from
>   wave 16). The h3 layer is the right shape for **OT regional
>   capacity briefings** (continental volume comparison with
>   hard hexagonal partition borders), **board-level deployment-
>   scope maps** (one hex per country-scale jurisdiction at
>   resolution 3), and **data-residency audits** (flag any
>   hex outside the contracted region with non-zero `value`).
>   Distinct from the heat companion (smooth Gaussian per-site
>   pressure, no hard borders) and the markers companion
>   (per-appliance pins with `last_seen_minutes_ago` liveness
>   colouring). Preserves the wave-8 / wave-4b OT-safety
>   contract: `safety_related` lookup column is mirrored
>   read-only from the customer SRS (Rule 5), `max(safety_related)
>   AS site_has_safety_hub` aggregation surfaces per-hex the
>   "any safety hub in this region?" flag (Rule 6), and the
>   §6 Gotchas explicitly note the regional-aggregation gotcha
>   (a hex showing `site_has_safety_hub=1` means at least ONE
>   site in the hex carries SIS-relevant telemetry, NOT that
>   every site in the hex does) plus the silent-safety-hub
>   alert-pairing requirement. **10th completed triplet** — the
>   ENTIRE OT-vendor-bridge stack (markers + heat + h3) now
>   ships, alongside every CIM/SOC-stack source-row already at
>   triplet completion from waves 11–15.
> - **Layer-type coverage 9 / 10 unchanged.** The h3 layer
>   was already on the matrix from waves 8+ (cim-performance,
>   cim-alerts, cim-authentication, cim-network-traffic,
>   cyber-vision, es-risk, meraki, netflow-sflow-ipfix,
>   splunk-stream); wave 16 just extends h3 to the
>   ot-datastreamer source row (h3 usage 9 → 10).
> - **Source-pattern coverage 8 / 8 unchanged.** All eight
>   source patterns (splunk-cim, splunk-vendor-ta,
>   splunk-lookup, splunk-builtin, splunk-edge-hub,
>   splunk-premium-es, splunk-premium-itsi, splunk-stream)
>   were already represented from wave 6's 21-recipe milestone;
>   wave 16 stays on `splunk-edge-hub`.
> - **Wave 17 outlook — TOKEN BUDGET TIGHT.** With wave 16
>   landing at **~174.4k estimated tokens**, headroom to the
>   175k WARN is **~631 tokens** — not enough for even one
>   more recipe. Wave 17 MUST start with another token-trim
>   PR. Candidate trim levers (in projected-ROI order):
>   (a) recipe-page §1 Source-description compaction (currently
>   ~150-300 tokens × 45 recipes = ~10-13k if a uniform
>   reformat to ~80 tokens per §1 is applied — biggest single
>   reclaim available); (b) per-recipe §6 Gotchas already
>   trimmed via wave-4a; (c) a second CHANGELOG iteration if
>   a new release adds large `## [VERSION]` sections; (d) the
>   D-/G-/R-tier per-section roadmap bodies (the source-of-
>   truth narrative for each subsystem, currently ~50-100k
>   tokens combined — but these are HIGH-signal content that
>   an LLM authoring on this codebase actively uses, so
>   trimming should be a last resort).
> - **Triplet completion now 10 / 15 source dirs.** Remaining
>   source rows: `csv-lookup-geo` (has markers, h3,
>   polygons, supercluster, vector-tile-join; missing heat —
>   the only triplet-completing single recipe still
>   one-cell-away), `geo-us-states` (has choropleth,
>   extrusion-3d; missing markers/h3/heat — geo-shape recipe
>   row, intentionally NOT a markers-style triplet target),
>   `itsi-kpi-base` (has markers only; missing h3/heat),
>   `kvstore-latlon` (has heat, markers, supercluster;
>   missing h3 — one-cell-away triplet candidate),
>   `thousandeyes` (has markers, paths; missing h3/heat —
>   two-cell-away). Best wave 17 single-recipe triplet
>   completers: `csv-lookup-geo/heat` and `kvstore-latlon/h3`.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 16 token-trim
> SHIPPED (~2.7k tokens reclaimed by trimming the auto-generated
> per-recipe matrix in `docs/recipes/index.md`).** Wave 15 recipes
> landed `llms-full.txt` at ~174.2k tokens / ~758 tokens of WARN
> headroom — too tight to fund even one wave-16 recipe at the new
> comprehensive 3-way-comparison cost (~3.4k). Wave 16 reclaims
> the budget by trimming the on-build payload of
> `docs/recipes/index.md` between the
> `<!-- BEGIN AUTOGEN: recipes-matrix -->` and `<!-- END AUTOGEN:
> ... -->` markers from the 44-row per-recipe table (~4.5k tokens
> in `llms-full.txt`) to a compact `source-dir: layer-id-list`
> presence list (~1.8k tokens), keeping the headline totals
> (`44 recipes · 15 source dir(s) · 9 layer type(s)`) and the
> OT-safety-relevant recipe list. Net reclaim: ~2.7k tokens. The
> on-disk `docs/recipes/index.md` is unchanged (MkDocs site
> continues to render the full 44-row matrix for human readers);
> the per-recipe details (status, app dependencies, expected-field
> contract, formatter-option list) are recoverable from §3 + §4
> of each recipe page body, which is kept verbatim in
> `llms-full.txt` under the matching
> `# === BEGIN: …/recipes/<source>/<layer>/ ===` block, and from
> the source-of-truth at
> `docs/_machine/recipes/index.yaml`. Implementation lives in
> `scripts/build-llms-full-txt.py::strip_recipes_index_matrix`
> alongside the wave-13 ROADMAP status-block strip, wave-10
> CHANGELOG older-version strip, wave-12 Appendix B compaction,
> and wave-15 formatter-Appendix-A trim. After this trim:
> `llms-full.txt` lands at **~171.5k tokens** / **~3.5k WARN
> headroom** — enough to fund one wave-16 recipe at the new
> ~3.4k cost level + the wave-16 recipes status block. Wave
> 17 will need another trim before recipes; candidates include
> recipe-page §1 Source-description compaction (~1.8k × 44 = ~10k
> if applied carefully) or a second CHANGELOG iteration if a new
> release adds large `## [VERSION]` sections.
>
> _This `> **Status …` blockquote will self-strip from
> `llms-full.txt` at the next regeneration via the wave-13
> generalised ROADMAP status-block regex._

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 15 recipes
> SHIPPED (2 more recipes — recipe count 42 → 44, layer-type
> coverage 9 / 10 unchanged, source-pattern coverage 8 / 8
> unchanged, h3 layer usage 8 → 9, heat layer usage 10 → 11).**
> Wave 15 completes TWO source-row triplets in a single PR, taking
> total triplet count from 7 (wave 14) → 9 (now the entire CIM
> SOC-stack AND the entire wire-data NetOps stack are full
> triplets):
> - **`cim-performance/heat`** — completes the cim-performance
>   triplet (markers from wave 4b, h3 from wave 8, heat from wave
>   15). The heat layer is the right shape for **CIO / CISO
>   infrastructure briefings** and **multi-region availability
>   slides** where the question is "where is fleet pressure
>   DISTRIBUTED smoothly" — distinct from the markers layer
>   (per-host investigation) and the h3 hexbin (per-region
>   rankings with drilldown). Uses a `worst-of CPU or memory`
>   pressure aggregation per host (the executive panel doesn't
>   need to distinguish which resource is constrained), then
>   the canonical `eventstats max + log10 eval normalise`
>   heat-weight pattern shared across every heat recipe in the
>   matrix. **8th completed triplet** — every CIM/SOC-stack
>   source (cim-alerts, cim-authentication, cim-network-traffic,
>   cim-performance) is now fully covered with markers + h3 +
>   heat siblings coexisting via the BM-CT-1 layer contract.
> - **`splunk-stream/h3`** — completes the splunk-stream triplet
>   (markers from wave 6, heat from wave 8, h3 from wave 15).
>   The H3 hexbin is the right shape for **NetOps capacity
>   reviews** and **data-residency audits** where the operator
>   needs to RANK geographic regions by total egress byte
>   volume AND CLICK INTO a region for per-destination
>   drilldown. Uses `eval value=bytes_out` with
>   `hexbinAggregate: "sum"` so the per-cell colour reads as
>   "total egress from this hex". **9th completed triplet** —
>   combined with cim-network-traffic and netflow-sflow-ipfix,
>   the **entire NetOps wire-data observability stack** now
>   has full triplet coverage (markers + h3 + heat siblings
>   deployable side-by-side via the layer contract).
> Coverage matrix after wave 15:
> - **Source-pattern coverage: 8 / 8 (COMPLETE)** unchanged.
> - **Layer-type coverage: 9 / 10** unchanged (`indoor`
>   remains blocked on v1.8+ image-overlay layer kind).
> - **Cell fill: 44 / ~75 (~59 %)** — up from 42 / ~75.
> - **H3 layer footprint: 9 recipes** (was 8) — added
>   splunk-stream; full list: cim-alerts, cim-authentication,
>   cim-network-traffic, cim-performance, csv-lookup-geo,
>   cyber-vision, es-risk, meraki, splunk-stream.
> - **Heat layer footprint: 11 recipes** (was 10) — added
>   cim-performance; full list: cim-alerts, cim-authentication,
>   cim-network-traffic, cim-performance, cyber-vision,
>   es-risk, kvstore-latlon, meraki, netflow-sflow-ipfix,
>   ot-datastreamer, splunk-stream.
> - **Markers layer footprint:** 14 recipes — unchanged.
> - **Triplet completion**: cim-alerts ✅ (wave 14),
>   cim-authentication ✅ (wave 10), cim-network-traffic ✅
>   (wave 12), **cim-performance ✅ (NEW)**, cyber-vision ✅
>   (wave 14), es-risk ✅ (wave 13), meraki ✅ (wave 10),
>   netflow-sflow-ipfix ✅ (wave 12), **splunk-stream ✅
>   (NEW)**. **NINE completed triplets** out of the 14-source
>   matrix — milestone: every CIM source-row and every wire-
>   data NetOps source-row is now fully covered.
> Token budget after wave 15 recipes:
> - llms-full.txt: **~174,242 / 175,000** (only **758 tokens
>   of WARN headroom remaining**). Wave 15 recipes added
>   6,858 tokens for the 2 recipes (~3.4k each — slightly
>   above the wave 14 ~3.1k cost level because BOTH recipes
>   include the 3-way layer-comparison matrix (markers vs
>   h3 vs heat) in their §1 source-description and §6
>   Gotchas, which is high-information-density content for
>   an LLM authoring follow-up recipes).
> - **WAVE 16 REQUIRES A TOKEN-TRIM PR FIRST.** The
>   remaining 758 tokens of headroom cannot accommodate even
>   half of one recipe at the wave 15 cost level. Wave 16
>   candidates (post-token-trim): `itsi-kpi-base/h3`
>   (begins itsi triplet — currently markers-only at 1 / 3),
>   `itsi-kpi-base/heat` (begins itsi triplet from the
>   other side), `thousandeyes/h3` or `thousandeyes/heat`
>   (begins thousandeyes triplet from markers + paths).
> - **Wave 16 token-trim levers REMAINING** (in descending
>   ROI order — see the wave 15 token-trim block for the
>   full menu): (a) `docs/CI-GATES.md` summary (~4.2k
>   tokens); (b) `docs/recipes/index.md` matrix per-row
>   "Apps + Verified" cells could compact (~4.1k); (c)
>   per-recipe §3 Expected-field tables could compress
>   to a per-source field-set lookup (~3-4k across the
>   44 recipes, but requires schema work to hoist the
>   field sets to `docs/_machine/`). Pick (a) for wave 16
>   prereq: ~4.2k reclaim funds 1 more wave-15-cost-level
>   recipe with 3.4k of remaining headroom (consistent
>   with the per-recipe-cost trajectory observed across
>   waves 14 / 15).
> Test plan: all 7 docs gates green locally — recipe schema
> (44 valid, 0 verified), llms.txt sync, llms-full.txt sync
> + budget (~174k / 175k, **758-token WARN headroom — under
> budget, but the new floor for "what costs how many tokens"
> means wave 16 must run a trim before any new recipes**),
> reference pages sync (3 in sync incl. recipes matrix
> auto-regen), formatter coverage (83 unique data-name(s),
> schema in sync), `mkdocs build --strict` clean.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 15 token-trim
> SHIPPED (recipe count unchanged at 42 — this is a token-budget
> PR, not a recipe PR).** Wave 14 finished at ~171,119 of the
> 175,000 WARN budget (~3,881 tokens of headroom), which the wave 14
> ROADMAP block flagged as below the per-recipe cost for wave 15.
> The wave 15 prerequisite trim moves the `docs/reference/
> formatter.md` auto-generated formatter-options enumeration —
> 82 options across the tile-provider, layer-ordering, basemap,
> heatmap, H3 cell-fill, supercluster, 3D extrusion, marker, path,
> and polygon groups, rendered as ~181 lines / ~16 KB / ~3,948
> tokens between the `<!-- BEGIN AUTOGEN: formatter-enumeration -->`
> / `<!-- END AUTOGEN: ... -->` markers — out of llms-full.txt and
> into a one-paragraph URL pointer that links back to:
> - the canonical machine-readable schema at
>   `docs/_machine/formatter-schema.json` (which is the source of
>   truth the auto-generator reads in the first place); AND
> - the full human-readable enumeration rendered for humans at
>   `https://fenre.github.io/better_map/reference/formatter/`.
> The on-disk `docs/reference/formatter.md` is unchanged — the
> MkDocs site keeps rendering the full 82-row enumeration. The
> trim is in-memory only, inside `scripts/build-llms-full-txt.py`
> (`is_formatter_page` + `strip_formatter_appendix_a` helpers,
> wired into `render()` right after the changelog trim, before
> `strip_chrome`). Per-recipe §4 Recommended formatter-config
> blocks (Appendix B) are NOT touched — they carry the option
> SUBSET that each recipe actually uses, which IS the authoritative
> reference for any LLM authoring a recipe; the full enumeration
> is only useful when an agent is hunting for an option it does
> not yet know about, and the URL pointer + schema link cover
> that case at a fraction of the token cost. Verified saving:
> 171,119 → 167,384 = **3,735 tokens reclaimed** (matches the
> ~3.8k estimate within rounding). Post-trim budget headroom is
> 175,000 − 167,384 = **7,616 tokens of WARN headroom**, which
> at the wave 14 cost level (~3.1k tokens/recipe including OT-
> safety §6 Gotchas) funds **2 more recipes** for wave 15 with
> ~1.4k of remaining headroom — enough to start wave 15 without
> requiring a SECOND token-trim PR.
> Wave 15 token-trim levers REMAINING (for waves 16+, in
> descending ROI order — see the wave 13 token-trim §
> "Next potential trim levers" comment for the full menu): (a)
> `docs/CI-GATES.md` summary (~4.2k tokens); (b)
> `docs/recipes/index.md` matrix per-row "Apps + Verified" cells
> could compact (~4.1k); (c) per-recipe §3 Expected-field
> tables could compress to a per-source field-set lookup
> (~3-4k across the 42 recipes, but requires schema work to
> hoist the field sets to `docs/_machine/`). Wave 15 has bought
> ~3 waves of headroom before the next trim is needed; the
> wave 16 / 17 ROADMAP block should track which lever was
> consumed when.
> Test plan: all 5 docs gates green locally — recipe schema
> (42 valid, 0 verified), llms.txt sync, llms-full.txt sync
> + budget (~167k / 175k, **7.6k WARN headroom**), reference
> pages sync (3 in sync), formatter coverage (83 unique
> data-name(s), schema in sync), `mkdocs build --strict`
> clean (1.77s, no warnings — the AUTOGEN section renders
> intact for human readers on the MkDocs site as expected,
> the trim is only in-memory for llms-full.txt).

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 14 SHIPPED
> (2 more recipes — recipe count 40 → 42, layer-type coverage
> 9 / 10 unchanged, source-pattern coverage 8 / 8 unchanged,
> heat layer usage 8 → 10, markers layer usage 14 unchanged).**
> Wave 14 completes TWO source-row triplets in a single PR:
> - **`cim-alerts/heat`** — completes the cim-alerts triplet
>   (markers from wave 6, h3 from wave 11, heat from wave 14).
>   The heat layer is the right shape for SOC LEADERSHIP /
>   board-deck rendering (smooth global alert-pressure
>   landscape) as distinct from the markers layer (analyst
>   investigation) and H3 (per-region drilldown). Reuses the
>   canonical `eventstats max + log10 eval normalise` heat-
>   weight pattern shared across every heat recipe in the
>   matrix — log scale is intentional because ES tenant
>   alert counts span 2-3 orders of magnitude.
> - **`cyber-vision/heat`** — completes the cyber-vision
>   triplet (markers from wave 4b, h3 from wave 11, heat from
>   wave 14). `ot_safety_relevant: true`. The recipe uses a
>   `cve_intensity = max_cvss × cve_count` scalarisation so
>   the heatmap weight captures BOTH severity AND breadth of
>   CVE exposure in a single field. Carries the strongest OT-
>   safety §6 Gotchas of any cyber-vision recipe — the heat
>   layer's smoothing makes safety_related=Y signal MORE OPAQUE
>   than markers or H3, so the recipe explicitly recommends
>   pairing with the markers companion for SIS-asset triage
>   AND offers an `| where safety_related="false"` filter
>   pattern for tenants that need a "non-SIS CVE pressure"
>   view that won't mask safety-relevant data.
> Coverage matrix after wave 14:
> - **Source-pattern coverage: 8 / 8 (COMPLETE)** unchanged.
> - **Layer-type coverage: 9 / 10** unchanged (`indoor`
>   remains blocked on v1.8+ image-overlay layer kind).
> - **Cell fill: 42 / ~75 (~56 %)** — up from 40 / ~75.
> - **Heat layer footprint: 10 recipes** (was 8) —
>   cim-network-traffic, netflow-sflow-ipfix, splunk-stream,
>   ot-datastreamer, meraki, kvstore-latlon,
>   cim-authentication, es-risk, cim-alerts, cyber-vision.
>   **Heat layer footprint now MATCHES the cim-* triplet
>   completeness pattern** across the SOC stack
>   (alerts + authentication + network-traffic now all have
>   markers + h3 + heat siblings) AND completes the
>   OT-cyber heat coverage (cyber-vision joins ot-datastreamer
>   in the OT triplet's heat row).
> - **Markers layer footprint:** 14 recipes — unchanged
>   (still the most-deployed layer; heat closes the gap to
>   10 / 14 = 71 % parity).
> - **Triplet completion**: cim-alerts ✅ (NEW),
>   cim-authentication ✅ (wave 10), cim-network-traffic ✅
>   (wave 12), cyber-vision ✅ (NEW), es-risk ✅ (wave 13),
>   meraki ✅ (wave 10), netflow-sflow-ipfix ✅ (wave 12).
>   **Seven completed triplets** out of the 14-source matrix
>   — every source covered with markers + h3 + heat
>   coexisting on the same dashboard via BM-CT-1 layer
>   toggles, demonstrating the layer-contract design at
>   full triplet granularity.
> Token budget after wave 14 recipes:
> - llms-full.txt: **~171,119 / 175,000** (~3,881 tokens of
>   WARN headroom remaining). Wave 14 added 6,149 tokens
>   for the 2 recipes (slightly above the 2.5k estimate
>   because cyber-vision/heat carries comprehensive OT-
>   safety §6 Gotchas — that surface is non-negotiable per
>   `ot-safety.mdc` Rule 6).
> - **WAVE 15 REQUIRES A TOKEN-TRIM PR FIRST.** The
>   remaining 3,881 tokens of headroom cannot accommodate
>   even one more recipe at the wave 14 cost level.
>   Wave 15 candidates (post-token-trim): `cim-performance/
>   heat` (completes cim-performance triplet, would make
>   8 / 8 SOC-stack triplets complete), `itsi-kpi-base/h3`
>   (begins itsi triplet — currently markers-only at 1 / 4),
>   `splunk-stream/h3` (begins splunk-stream triplet —
>   currently markers + heat, needs h3 for the SOC
>   stand-up shape).
> - **Wave 15 token-trim levers** (next ROI targets in
>   descending order — see the wave 13 token-trim §
>   "Next potential trim levers" comment for the full menu):
>   (a) `docs/reference/formatter.md` Appendix-A
>   enumeration (~4.7k tokens — could move to URL pointer
>   behind a per-row table); (b) `docs/CI-GATES.md`
>   summary (4.2k); (c) `docs/recipes/index.md` matrix
>   per-row Apps + Verified cells could compact (4.1k).
>   Pick (a) or (b) for wave 15 prereq: ~4.5k reclaim
>   funds 2 more wave 15 recipes with 2-3k of remaining
>   headroom.
> Test plan: all 5 docs gates green locally — recipe schema
> (42 valid, 0 verified), llms.txt sync, llms-full.txt sync
> + budget (~171k / 175k, 3.9k WARN headroom), reference
> pages sync (3 in sync incl. recipes matrix auto-regen),
> `mkdocs build --strict` clean.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 13 SHIPPED
> (2 more recipes — recipe count 38 → 40, layer-type coverage
> 9 / 10 unchanged, source-pattern coverage 8 / 8 unchanged,
> heat layer usage 7 → 8, markers layer usage 13 → 14).**
> Wave 13 closes two specific gaps the wave 11 / wave 12
> backlog had been carrying:
> - **`csv-lookup-geo/markers`** — the missing entry-point
>   layer for the `splunk-lookup` source pattern. Wave 11
>   shipped CSV-lookup-geo with H3, supercluster, polygons,
>   and vector-tile-join, but a CSV lookup operator's FIRST
>   instinct (and the lowest-cardinality use case — < ~200
>   discrete points) needs a discrete-markers recipe with
>   per-point popup affordance. This recipe explicitly
>   contrasts with the higher-cardinality supercluster
>   sibling and the higher-density H3 / heat siblings to
>   guide layer choice via the §6 Gotchas matrix.
> - **`es-risk/heat`** — completes the **es-risk source-row
>   triplet** (markers in wave 9, H3 in wave 10, heat in
>   wave 13). The heat layer is the right shape for SOC
>   LEADERSHIP / board-deck rendering (smooth global risk
>   pressure landscape) as distinct from the markers layer
>   (analyst investigation) and the H3 layer (per-site
>   comparison) — all three coexist on the same dashboard
>   via BM-CT-1 layer toggles. Reuses the canonical
>   `eventstats max + log10 eval normalise` heat-weight
>   pattern shared across every heat recipe in the matrix
>   (cim-network-traffic/heat, netflow-sflow-ipfix/heat,
>   splunk-stream/heat, ot-datastreamer/heat, meraki/heat,
>   kvstore-latlon/heat, cim-authentication/heat) — log
>   scale is intentional because RBA scores span 2-3 orders
>   of magnitude.
> Coverage matrix after wave 13:
> - **Source-pattern coverage: 8 / 8 (COMPLETE)** —
>   unchanged from wave 6.
> - **Layer-type coverage: 9 / 10** — unchanged
>   (`indoor` remains blocked on v1.8+ image-overlay
>   layer kind).
> - **Cell fill: 40 / ~75 (~53 %)** — up from 38 / ~75.
> - **Heat layer footprint:** 8 recipes (cim-network-traffic,
>   netflow-sflow-ipfix, splunk-stream, ot-datastreamer,
>   meraki, kvstore-latlon, cim-authentication, es-risk),
>   making it the second-most-deployed layer type after
>   markers — confirming the wave 12 thesis that heatmap
>   is the natural shape for "where is the pressure?"
>   leadership / executive dashboards.
> - **Markers layer footprint:** 14 recipes — remains the
>   most-deployed layer (the canonical "analyst
>   investigation" shape).
> Token budget after wave 13 recipes:
> - llms-full.txt: **~165k / 175k** (~10k of WARN headroom
>   remaining). The wave 13 token-trim (below) reclaimed
>   14.7k tokens, funding wave 13 (2 recipes, ~4.9k added)
>   with ~10k of remaining headroom for wave 14.
> - Wave 14 candidates (no token-trim needed): the next
>   targets are `cim-alerts/heat` (alerts → aggregate heat
>   pressure leadership view, completes the alerts triplet
>   with markers + h3), `cim-performance/heat` (performance
>   monitoring → site-pressure leadership view), and
>   `cyber-vision/heat` (OT vulnerability density —
>   `ot_safety_relevant: true`). Each at ~2.5k tokens
>   estimated; wave 14 ships 2-3 within the remaining
>   headroom.
> Test plan: all 5 docs gates green locally — recipe schema
> (40 valid, 0 verified), llms.txt sync, llms-full.txt sync
> + budget (~165k / 175k), reference pages sync (3 in sync
> incl. recipes matrix auto-regen), `mkdocs build --strict`
> clean.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 13 token-trim
> SHIPPED — generalised ROADMAP status-block strip in
> `scripts/build-llms-full-txt.py` from the wave 8 narrow regex
> (E5 Phase 2 wave \\d+ OR G7 Phase 2 follow-up) to ANY subsystem
> (D-, E-, G-, R-, REL-, T-).** Background: after wave 12 landed at
> ~174.6k tokens (just 437 under the 175k WARN ceiling), the wave
> 13 audit ran a section-by-section size analysis of llms-full.txt
> and found the ROADMAP wrapper page accounted for **43,232 tokens
> — 24.8 % of the entire file**, by ~10x the next-largest single
> contributor (the formatter reference at 4,690). A targeted count
> of `^> \*\*Status` blockquotes showed 33 in ROADMAP.md on disk
> but only 17 stripped by the wave 8 narrow regex, leaving **16
> write-once status blockquotes unstripped** in llms-full.txt
> (D1, D2 Phase 1+1.5, D3 Phase 1, D5 Phase 1, D6, E2 Phase 1,
> E2 Phase 2 ×3, E5 Phase 1, G1 ×N, G2 close-out audit, G7 Phase 1,
> G7 Phase 2 ×2, G8). These status blocks are write-once historical
> notes; their live state is duplicated in (a) the headline goals
> table at the top of ROADMAP, (b) the per-subsystem section
> bodies further down, (c) `docs/recipes/index.md` for E5, and
> (d) the auto-generated machine-readable artefacts under
> `docs/_machine/`. Trimming them preserves the on-disk ROADMAP
> (humans see all 33 blockquotes on the MkDocs site) but reclaims
> the budget an LLM agent needs to reason about the active
> contract rather than the historical narrative.
> The trim:
> - **Regex change.** Replaces the inner alternation
>   `(?:E5 Phase 2 wave \d+|G7 Phase 2 follow-up)` with the
>   line-bounded any-subsystem pattern (the `[^\n]*\n` continuation
>   was already there from wave 8). The `vX-prep` version marker
>   guard is preserved on the anchor so a future SHIPPED-at-release
>   block (e.g. `v1.7`) carrying the actual release version would
>   NOT be stripped — this lets us mint permanent release markers
>   in ROADMAP without losing them from llms-full.txt.
> - **Token impact (measured):** llms-full.txt **174,563 → 159,848
>   = 14,715 tokens reclaimed** (~8.4 % of the file).
> - **WARN headroom (post-trim):** 15,152 tokens (175,000 - 159,848).
>   At the wave 12 measured cost of ~2.6k tokens per recipe, this
>   funds **~5 future recipes** before the next token-trim work is
>   warranted. Wave 13 can comfortably ship 2 recipes; wave 14, 15,
>   16, 17 can each ship 2-3 with the same budget without invoking
>   another trim.
> - **Why this is safe.** ROADMAP.md on disk is unchanged — full
>   33-blockquote history preserved for human readers. MkDocs site
>   renders identically. `docs/llms-full.txt` (LLM corpus) loses
>   write-once status annotations but keeps every live-state
>   surface: headline goals table, per-subsystem section bodies,
>   subsystem-specific contracts (CI gates, version-consistency,
>   AppInspect, etc.), risk register, milestone definitions, and
>   the open-question list. An LLM agent's "what is the current
>   project state?" answer is unchanged; its "tell me the full
>   history of what shipped when" answer now requires hitting the
>   MkDocs site or `ROADMAP.md` directly — which is the right
>   default for a finite-context-window agent.
> - **Why this is conservative.** The narrow wave 8 regex matched
>   only the two subsystem patterns that ship MOST OFTEN and
>   bloat ROADMAP fastest (E5 = one block per recipe wave, G7 =
>   one block per llms.txt follow-up). The wave 13 generalisation
>   sweeps in 16 one-shot blocks that, by definition, will not
>   grow further (D1 shipped, D6 shipped, G8 shipped — they're
>   single-milestone subsystems, not recurring like E5 waves).
>   The marginal reclaim per wave from new subsystems shipping
>   is small (~0.5-1.5k tokens per new subsystem milestone), but
>   the wave 13 generalisation captures the full backlog at once.
> - **Cadence implication:** the new sustainable cadence becomes
>   **2-3 recipes per wave** (up from the 2-per-wave that wave 12
>   established). Wave 13 ships 2 recipes immediately following
>   this token-trim PR.
> - **Test plan:** all 5 docs gates green locally — recipe schema
>   (38 valid), llms.txt sync, llms-full.txt sync + budget
>   (159,848 / 175,000), reference pages sync (3 in sync),
>   `mkdocs build --strict` clean. Verified: 33 status blocks
>   still present on-disk; 0 status blocks in llms-full.txt
>   (down from 16); 1 unrelated `## Status (...)` H2 heading
>   in `docs/recipes/index.md` correctly NOT stripped (H2, not
>   blockquote).
> - **Next potential trim levers** (in descending ROI order, kept
>   for future budget pressure — none needed for wave 13+ unless
>   the cadence accelerates beyond 2-3 recipes per wave): (a) `docs/
>   reference/formatter.md` Appendix-A enumeration (~4.7k tokens —
>   could move to URL pointer behind a per-row table); (b) `docs/
>   CI-GATES.md` summary (4.2k); (c) `docs/recipes/index.md`
>   matrix already auto-generated, but per-row Apps + Verified
>   cells could compact (4.1k); (d) `docs/runbooks/supply-chain.md`
>   (3.1k) and `docs/runbooks/upgrade-hygiene.md` (2.6k) — runbook
>   bodies could trim post-§6 like recipe pages did in wave 4a.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 12 SHIPPED
> (2 more recipes — recipe count 36 → 38, heat layer-type usage
> 6 → 7, markers usage 12 → 13, layer-type coverage 9 / 10
> unchanged, source-pattern coverage 8 / 8 unchanged).** Wave 12
> is the first wave to ship at the new sustainable **2-recipes-per-
> wave cadence** the wave 12 token-trim status block (below)
> establishes — the prior 3-recipes-per-wave cadence would have
> breached the 175k WARN ceiling. Wave 12 was originally planned
> for 3 candidates in the wave 11 status block's "Wave 12
> candidates" subsection (`cim-network-traffic/heat`,
> `netflow-sflow-ipfix/markers`, `csv-lookup-geo/markers`); the
> first two ship in this wave and **`csv-lookup-geo/markers`
> defers to wave 13** to land inside the new token budget.
> Two new recipes ship:
> - **`docs/recipes/cim-network-traffic/heat.md`** —
>   `splunk-cim` source pattern (already shipped in 8 prior
>   recipes; this is the 5th recipe for the `cim-network-traffic`
>   source row, joining the existing markers, h3, paths, and
>   supercluster), `heat` layer (now 7 total uses across the
>   matrix). The aggregate-density complement to the existing
>   cim-network-traffic markers + h3 + paths recipes: same CIM-
>   accelerated `Network_Traffic` data model, same `iplocation`
>   geocoding of destination IPs, same per-destination aggregation
>   — but the aggregate is `sum(All_Traffic.bytes)` (byte volume)
>   rather than `count` (event frequency), with the canonical
>   `eventstats max + log10 eval` log-scale normalisation pattern
>   inherited from the splunk-stream/heat + netflow-sflow-ipfix/
>   heat siblings (linear normalisation would collapse 90 % of
>   destinations to invisible because byte volumes span 6+
>   orders of magnitude in real networks). Targets NetOps
>   capacity dashboards and executive bandwidth-cost briefings.
>   6 expected fields including the heat-layer-required `weight`
>   driven from log-normalised `byte_count`. §6 Gotchas: log-scale
>   IS intentional, layer choice matrix (markers vs heatmap vs
>   H3), hyperscaler concentration in Ashburn, `sum(bytes)`
>   semantics (sum of `bytes_in + bytes_out` per CIM contract),
>   MaxMind licensing, PII posture (per-destination byte counts
>   identify user behaviour even though destination IPs are not
>   themselves PII), and the OT-passive-DPI carve-out (Rule 6).
>   Brings the `cim-network-traffic` source row to **5 recipes
>   — the densest single source row** in the matrix.
> - **`docs/recipes/netflow-sflow-ipfix/markers.md`** —
>   `splunk-vendor-ta` source pattern, `markers` layer (now 13
>   total uses across the matrix). The per-destination drilldown
>   complement to the existing netflow-sflow-ipfix h3 + heat
>   recipes: same `Splunk_TA_netflow` ingestion, same
>   `iplocation` geocoding, but each remote endpoint renders as
>   a discrete marker sized by byte volume rather than aggregated
>   into hex cells or smoothed into heat blobs. The SPL adds a
>   `top_protocol` derivation via a `case` chain over `protocol`
>   + `dest_port` multi-values (handles tcp/443, tcp/80, udp/443,
>   tcp/other, udp/other, other) so the popup can answer
>   "what kind of traffic is this destination?" without a
>   second-level lookup. Targets NetOps capacity-planning
>   investigation, security investigation (where did the
>   compromised host exfiltrate?), and chargeback / billing
>   ("which destinations does this department's CIDR talk to?").
>   7 expected fields including `top_protocol`. §6 Gotchas:
>   the three-layer choice matrix (markers vs heatmap vs h3),
>   `bytes` semantics across NetFlow / sFlow / IPFIX exporters
>   (Cisco IOS-XE per-record vs sFlow sampled vs IPFIX
>   template-flexible — sFlow needs sampling-rate multiplication),
>   `dc(src_ip)` cardinality under NAT, intentionally coarse
>   protocol classification (richer needs a service-catalogue
>   lookup), hyperscaler-cluster overlap, `Splunk_TA_netflow`
>   field-name drift across TA versions (`dest_ip` vs `dest`),
>   time-range scaling, MaxMind licensing, the join-with-`src_ip`
>   PII compounding risk (this panel deliberately omits `src_ip`),
>   and the OT-zone passive-mirror carve-out (Rule 1 + Rule 6 —
>   a marker for "10 GB egress from PLC-04 to an external IP"
>   is a safety-impacting finding that must surface via the
>   OT-zone runbook, not alongside CDN traffic in a NetOps
>   panel). Brings the `netflow-sflow-ipfix` source row to 3
>   recipes (markers + heat + h3 — the complete triplet).
> - **No framework changes.** Both recipes pass the unchanged
>   `scripts/check-recipe-schema.py` (now 38 recipes valid, 0
>   verified, 38 unverified / deferred); auto-regen of
>   `docs/_machine/recipes/index.yaml` (now 38 entries),
>   `docs/recipes/index.md` matrix (now 38 rows), `docs/llms.txt`
>   (now references 38 recipes), and `docs/llms-full.txt`.
>   `mkdocs.yml` nav grows two lines (alphabetical insertion
>   between the existing cim-network-traffic and netflow-sflow-
>   ipfix recipes). `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 36 to 38
>   recipes (~48 % → ~51 % of the ~75 ✓ cells); source-pattern
>   coverage stays at 8 / 8 = COMPLETE; layer-type coverage
>   stays at 9 / 10 (only `indoor` layer remains, blocked on
>   v1.8+). Per-source row counts now:
>   **`cim-network-traffic` 5 (NEW: heat)** — DENSEST ROW;
>   `csv-lookup-geo` 4; `cim-authentication` 3, `kvstore-latlon`
>   3, `meraki` 3, **`netflow-sflow-ipfix` 3 (NEW: markers —
>   COMPLETE markers+heat+h3 TRIPLET)**;
>   `cim-alerts` 2, `cim-performance` 2, `cyber-vision` 2,
>   `es-risk` 2, `geo-us-states` 2, `ot-datastreamer` 2,
>   `splunk-stream` 2, `thousandeyes` 2;
>   `itsi-kpi-base` 1. Layer-type usage now:
>   **`markers` 13 (NEW: 12 → 13)**, h3 9,
>   **`heat` 7 (NEW: 6 → 7)**, `paths` 2, `supercluster` 3,
>   `vector-tile-join` 1, `polygons` 1, `choropleth` 1,
>   `extrusion-3d` 1.
> - **Wave 13 candidates** (cell-fill regime continues at the
>   new 2-recipes-per-wave cadence): (a) `csv-lookup-geo/markers`
>   — explicit markers recipe for the most common pattern
>   (deferred from wave 12; the source row has 4 recipes but
>   none are markers, which is conspicuously missing for the
>   most universal source pattern); (b) `es-risk/heat` —
>   heatmap of risk events for SOC leadership dashboards
>   (currently has markers + h3, missing heat). Both are
>   projected ~2.6k tokens each; plus the wave 13 status block
>   at ~3-4k (self-stripping) = ~5.2k total cost. Lands at
>   ~179.8k — **just over 175k WARN**, will need either Wave
>   13 to be paired with another small token-trim (Appendix A
>   compaction is the natural next lever, pre-investigated in
>   the wave 12 token-trim status block), OR Wave 13 to ship
>   only 1 recipe instead of 2. Re-measure at wave 13 prep.
> - **Token budget watch.** With wave 12 landing at
>   **~174.6k estimated tokens** (~437 tokens of headroom to
>   the 175k WARN — the tightest landing of any wave to date,
>   intentionally so given the new 2-per-wave cadence), the
>   pre-investigated next-trim levers from the wave 12 trim
>   status block become operationally critical. The most ROI-
>   adjacent lever is Appendix A compaction (~1.2k reclaim,
>   same matrix-table pattern as the wave 12 Appendix B trim
>   that just landed); a more disruptive lever is summarising
>   the largest closed work-items in `roadmap.md` (G7 alone is
>   ~7.5k tokens). Wave 13 will trigger one of these before
>   shipping its recipe slate.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 12 token-trim
> SHIPPED — Appendix B (per-source recipe matrix) compaction in
> `scripts/build-llms-full-txt.py`.** Background: after wave 11
> landed `llms-full.txt` carried **~172.4k estimated tokens**, leaving
> only **~2.6k of headroom** to the 175k WARN ceiling — not enough
> for even a single new ~2.6k-token recipe, and the wave 11 status
> block itself called out that wave 12 onwards REQUIRED a paired
> token-trim PR. The wave 11 deferred-design note identified Appendix
> B as the natural next lever; this PR ships that compaction.
>
> Top contributors in pre-wave-12 `llms-full.txt`:
> (a) `roadmap.md` body 43,231 tokens (25.1 % — already trimmed
> in wave 8 via the SHIPPED-blockquote stripper);
> (b) Appendix B 5,334 tokens (3.1 % — second-largest non-page
> contributor after the ROADMAP);
> (c) `reference/formatter.md` 4,690 tokens;
> (d) `CI-GATES.md` 4,235 tokens;
> (e) `recipes/index.md` 4,001 tokens;
> (f) `changelog.md` 3,900 tokens (already trimmed in wave 10).
>
> Format change: the appendix renders as a single matrix table
> instead of per-recipe sections with bulleted `Expected fields:`
> lists. The pre-wave-12 per-section format carried ~150 tokens
> per recipe, ~70 % of which was the `expected_fields` list —
> a list that is fully duplicated in §3 of each recipe page body,
> retained verbatim in `llms-full.txt` under the wave-4a
> `## 5. Screenshot` trim. The matrix preserves the agent-actionable
> lookup contract (recipe ID, source → layer label, status, apps
> required, verified-against metadata, page link) without the
> duplication. Agents that need the field contract follow the
> per-row Page link, which lands on the body block that already
> contains §3 in this same file.
>
> Implementation: a single edit to the `# Recipes appendix` block
> of `render()` in `scripts/build-llms-full-txt.py`; the recipe
> ingestion side (`collect_recipes()` reading
> `docs/_machine/recipes/index.yaml`) is unchanged. The module
> docstring's budget-contract paragraph is extended with the
> wave-12 entry alongside the prior wave-8 (roadmap status block)
> and wave-10 (CHANGELOG older-versions) entries. An inline
> format-contract comment above the appendix write block documents
> the design rationale so a future contributor restoring the
> per-recipe sections without first reading the ROADMAP gets a
> source-side breadcrumb.
>
> Measured outcome: `llms-full.txt` shrinks from **~172.4k → ~169.4k
> estimated tokens** (Appendix B alone: **5,334 → 2,274 tokens**,
> a 57 % reduction in that block); headroom to the 175k WARN
> ceiling grows from ~2.6k to **~5.6k tokens**. Local CI is green
> across all gates: `build-llms-full-txt.py --check`,
> `build-llms-txt.py --check`, `build-recipe-index.py --check`,
> `build-reference-pages.py --check`, `check-recipe-schema.py`,
> `check-formatter-schema.py`, `check-formatter-coverage.py`, and
> `mkdocs build --strict`. The on-disk recipe pages, the published
> MkDocs site, `llms.txt`, and `docs/_machine/recipes/index.yaml`
> are all unchanged — the trim runs only against the in-memory
> appendix render before it lands in `llms-full.txt`.
>
> Wave-12 recipe headroom: with ~5.6k headroom and recipes
> averaging ~2.6k tokens each (body + matrix row), wave 12 can
> safely ship **2 recipes** without breaching WARN
> (~169.4k + 5.2k = ~174.6k, ~400 tokens under the ceiling).
> Shipping 3 would land at ~177.2k (~2.2k over the WARN ceiling
> — soft warn, not a hard fail, but against the spirit of the
> budget contract). The new sustainable cadence from here is
> **2 recipes per wave** unless another token-trim lever ships
> first; the wave 11 candidate slate is adjusted accordingly in
> the wave 11 status block's "Wave 12 candidates" subsection
> (one of the three originally-planned recipes will defer to
> wave 13).
>
> Next levers (when wave 13+ pushes back near WARN):
> (a) compact Appendix A (integrations matrix, currently 2,329
> tokens for 8 entries — same matrix-table pattern would reclaim
> ~1.2k); (b) elide the table-of-contents at the top of
> `llms-full.txt` (currently 1,151 tokens — every entry is
> recoverable from the `# === BEGIN: <url> ===` separators that
> follow); (c) summarise the largest closed work-items in
> `roadmap.md` (G7 alone is 7,540 tokens of historical exposition
> now that G7 Phase 2 is shipped). None of these are needed yet;
> document them here so the next trim PR has a pre-investigated
> menu.

> **Status (v1.7-prep, 2026-05-18): E5 Phase 2 wave 11 SHIPPED
> (3 more recipes — recipe count 33 → 36, H3 layer-type usage
> 7 → 9, markers usage 11 → 12, layer-type coverage 9 / 10
> unchanged, source-pattern coverage 8 / 8 unchanged).** Wave 11
> continues the wave 7-10 cell-fill regime (no new layer types,
> no new source patterns — only filling matrix cells by applying
> already-shipped layer types to already-shipped source patterns).
> One scope correction from the wave 10 status block's "wave 11
> candidates" list: `itsi-kpi-base/markers` was identified as a
> wave 11 target, but a mid-wave-10 inventory cross-check
> revealed that recipe was already shipped (in an earlier wave
> the wave 10 block author had mis-tracked) — so the wave 11
> slate substitutes `cyber-vision/h3` (an OT-safety-relevant
> hex aggregation of Cisco Cyber Vision asset density per site,
> which is independently the most operationally valuable
> remaining empty cyber-vision cell and keeps the cell-fill
> count at 3). Three new recipes ship:
> - **`docs/recipes/cim-alerts/h3.md`** —
>   `splunk-cim` source pattern (already shipped in 7 prior
>   recipes; this is the 2nd recipe for the `cim-alerts` source
>   row, joining the existing `markers`), `h3` layer (now 8
>   total uses across the matrix). The per-region-drilldown
>   complement to the existing markers recipe for the same
>   source: same CIM-accelerated Alerts data model, same
>   `iplocation` enrichment of `dest`, same severity-fold via
>   `case` + `mvfind`, but rendered as H3 hexagonal cells with
>   per-cell drilldown rather than discrete per-host markers.
>   Targets SOC daily stand-up dashboards and executive
>   briefing slides where the audience needs regional alert-
>   pressure ranking, NOT per-host investigation (markers
>   companion). 6 expected fields including the h3-layer-
>   required `value` (set from `alert_count`). §6 Gotchas:
>   CIM acceleration prerequisite, the markers-vs-h3 decision
>   matrix, per-cell sample-size workaround, aggregate
>   function semantics, hostname-vs-IP `dest` caveat, severity
>   nomenclature drift, GDPR posture, and the OT-related
>   alert pass-through note (Rule 6 — alerts ARE emitted from
>   OT-adjacent detection but the input is a Level-3/4
>   artefact, not a Level-0/1/2 read). Brings the `cim-alerts`
>   source row to 2 recipes.
> - **`docs/recipes/cyber-vision/h3.md`** (OT-safety-relevant —
>   `ot_safety_relevant: true`) — `splunk-vendor-ta` source
>   pattern (already shipped via meraki, ot-datastreamer,
>   splunk-stream, thousandeyes), `h3` layer (now 9 total uses
>   across the matrix). The per-site-density complement to the
>   existing markers recipe for the same source: same Cisco
>   Cyber Vision components + vulnerabilities streams, same
>   operator-maintained `cybervision_sites.csv` lookup
>   contract, same passive-DPI-only OT-zone read posture
>   (Rule 1 reference design), but rendered as H3 hexagonal
>   cells coloured by OT asset count per region (with
>   alternative config for worst-CVSS-per-cell exposure
>   tracking). Targets plant-leadership monthly review
>   dashboards for multi-site OT footprints, NOT per-asset
>   investigation (markers companion). **Recipe diverges from
>   the cim-* H3 siblings in resolution default**: `4` instead
>   of `3`, because OT assets cluster at site-scale (~1-2 km
>   per facility) and res 3 (~120 km cells) would merge
>   multi-site regional clusters into a single mega-hex — res
>   4 (~17 km cells) keeps each site as its own cell at
>   world zoom. 6 expected fields including the h3-layer-
>   required `value` (set from `1` for density semantics; the
>   §6 Gotchas explain the `value=max_cvss + aggregate: max`
>   alternative for CVE exposure semantics). §6 Gotchas: all
>   four OT-safety boundary rules (Rule 1 passive DPI, Rule 2
>   no suppression, Rule 3 SOAR scope, Rule 5 SRS mirror),
>   the `cybervision_sites.csv` schema recap, the resolution-
>   choice rationale (the recipe's most distinctive design
>   decision), aggregate function semantics for both
>   density and exposure modes, `asset_id` cardinality drift,
>   CVSS join cardinality, time range, and the asset-name
>   PII posture. Brings the `cyber-vision` source row to 2
>   recipes.
> - **`docs/recipes/thousandeyes/markers.md`** —
>   `splunk-vendor-ta` source pattern, `markers` layer (now
>   12 total uses across the matrix). The probe-anchor
>   complement to the existing paths recipe for the same
>   source: instead of per-test hop-by-hop polylines, render
>   the agent FLEET itself as static markers positioned at
>   each agent's anchored coordinates, sized by how many
>   distinct tests the agent currently runs. **NOTE:** this
>   recipe's `display_name` is "Cisco ThousandEyes (agent
>   fleet)" (vs the paths recipe's "Cisco ThousandEyes (path
>   visualization)") — same source `id: thousandeyes` and
>   same `pattern: splunk-vendor-ta`, but the two questions
>   are different enough operationally (fleet inventory vs
>   measurement trajectory) that the display names diverge.
>   `scripts/check-recipe-schema.py` accepts the divergence
>   because the matrix groups by source `id`, not display
>   name. Targets DEM-coverage-planning panels ("is my agent
>   footprint covering my critical geographies?") and
>   capacity-review panels ("which agent is taking on the
>   most measurement load?"). 7 expected fields. §6 Gotchas:
>   the `tests_by_agent` join-shape drift across TA
>   versions (pre-v3 lookup vs v3+ subsearch), `is_online`
>   field name drift, the THREE distinct agent-type geo
>   provenance models (enterprise = customer-supplied,
>   cloud = TE-supplied region geocode, endpoint = current-IP
>   geocode that can jump daily), test count vs measurement
>   volume distinction, cluster-vs-individual rendering,
>   time range, the no-OT-zone-deployment Rule 1 boundary
>   ("if any agent in the result set has a coordinate
>   inside a known OT plant geofence, STOP and audit"),
>   and the endpoint-agent-name PII posture. Brings the
>   `thousandeyes` source row to 2 recipes.
> - **No framework changes.** All three recipes pass the
>   unchanged `scripts/check-recipe-schema.py` (now 36
>   recipes valid, 0 verified, 36 unverified / deferred);
>   auto-regen of `docs/_machine/recipes/index.yaml` (now 36
>   entries), `docs/recipes/index.md` matrix (now 36 rows),
>   `docs/llms.txt` (now references 36 recipes), and
>   `docs/llms-full.txt`. `mkdocs.yml` nav grows three lines.
>   `mkdocs build --strict` is clean.
> - **Coverage delta:** matrix coverage rises from 33 to 36
>   recipes (~44 % → ~48 % of the ~75 ✓ cells); source-
>   pattern coverage stays at 8 / 8 = COMPLETE; layer-type
>   coverage stays at 9 / 10 (only `indoor` layer remains,
>   blocked on v1.8+). Per-source row counts now:
>   `csv-lookup-geo` 4, `cim-network-traffic` 4;
>   `cim-authentication` 3, `kvstore-latlon` 3, `meraki` 3;
>   **`cim-alerts` 2 (NEW: h3)**,
>   **`cyber-vision` 2 (NEW: h3)**, `cim-performance` 2,
>   `es-risk` 2, `geo-us-states` 2,
>   `netflow-sflow-ipfix` 2, `ot-datastreamer` 2,
>   `splunk-stream` 2, **`thousandeyes` 2 (NEW: markers)**;
>   `itsi-kpi-base` 1. Layer-type usage now:
>   **`markers` 12 (NEW: 11 → 12)**, **`h3` 9 (NEW: 7 → 9)**,
>   `heat` 6, `paths` 2, `supercluster` 3,
>   `vector-tile-join` 1, `polygons` 1, `choropleth` 1,
>   `extrusion-3d` 1.
> - **Wave 12 candidates** (cell-fill regime continues):
>   (a) `cim-network-traffic/heat` — heatmap of network
>   conversation density per region (fills heat-row cim-
>   network-traffic gap); (b) `netflow-sflow-ipfix/markers`
>   — discrete per-flow marker overlay (fills markers gap
>   for netflow-sflow-ipfix); (c) `csv-lookup-geo/markers`
>   — explicit markers recipe for the most common pattern
>   (fills the markers gap for csv-lookup-geo; currently
>   the source row has 4 recipes but none are markers).
>   All three are projected ~2.4k tokens each post-§5 trim;
>   plus the wave 12 status block at ~3-4k (self-stripping)
>   = ~7-8k total cost. Lands at ~179-180k — **just over
>   the 175k WARN**. Wave 12 MUST be paired with another
>   token-trim PR; the Appendix B summarisation (~4.5k
>   reclaim) is the natural lever and was already designed
>   in the deferred-design notes (CANCELLED in the todo list
>   pending re-measurement, but the original plan stands).
> - **Token budget watch.** With wave 11 landing at
>   **~172k estimated tokens** (projected; actual at PR
>   creation), headroom to the 175k WARN is **~3k** and
>   headroom to the 200k HARD-FAIL is ~28k. The cell-fill
>   regime has now consumed all the slack the G7 follow-up #4
>   CHANGELOG trim created; wave 12 onwards REQUIRES a paired
>   token-trim PR. Re-measure top contributors at the wave
>   12 prep phase: if Appendix B is still the biggest non-
>   ROADMAP / non-CHANGELOG contributor (currently ~4.5k),
>   ship its summarisation as PR ##-wave-12-token-trim; if a
>   new release has added a large `## [VERSION]` section to
>   CHANGELOG.md, the keep-recent-N strategy can be re-applied
>   with no code change (the trim threshold is already
>   parameterised).

* **Problem:** Better Map can consume data from ~10 categorically different Splunk source patterns (see table below). A new customer with NetFlow data who wants a heat layer should not have to derive the SPL from first principles. There is currently no recipe documentation; the burden of "what SPL do I write?" falls entirely on the user, who often does not know the field names of their own data, let alone the contract this viz wants.
* **Design:** Build the recipe matrix as `docs/recipes/<source>/<layer>.md`, where each leaf file is a **complete, copy-paste-runnable** recipe. Every recipe has the same 6-section structure (enforced by a validator script — G2 CI step), so an LLM can ingest the corpus consistently:

  | Section | Content |
  |---|---|
  | 1. Source description | What the data looks like, where it comes from, typical sourcetype/index |
  | 2. SPL recipe | Complete query, parameterised by `$site$`, `$earliest$`, `$latest$`, etc.; verified against a real instance |
  | 3. Expected fields | Table of `field_name : type : example_value` — this is the field contract for the panel |
  | 4. Recommended formatter config | JSON snippet for Dashboard Studio (or `<option>` block for SWF) |
  | 5. Screenshot | One PNG of the panel rendered against the SPL, captured by D5 harness |
  | 6. Gotchas | Time-range, perm/index access, accelerated DM availability, CIM tag mapping, OT-Datastreamer field-alias drift, etc. |

  **Initial source/layer coverage matrix (✓ = ship recipe in v1.7; ○ = best-effort if effort allows; — = layer doesn't make sense for this source):**

  | Source pattern \\ Layer | markers | paths | polygons | choropleth | heat | H3 hex | supercluster | 3D extrusion | indoor | vector-tile join |
  |---|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|:-:|
  | CIM Network Traffic (`dest`, `src_ip`, `iplocation`) | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
  | CIM Authentication (`user`, `src_ip`, `app`) | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — | — | — |
  | CIM Performance (host metrics with lat/lon from CMDB lookup) | ✓ | — | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | — | — |
  | CIM Alerts / Notable Events (`severity`, asset coords) | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — | — | — |
  | KV Store (lat/lon list) | ✓ | ✓ | ✓ | ○ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
  | Custom CSV lookup (geo-enriched) | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ | ✓ |
  | ITSI KPI base searches (services with location) | ✓ | — | — | ✓ | — | — | — | ✓ | — | — |
  | ES `index=risk` (RBA risk events) | ✓ | — | — | ✓ | ✓ | ✓ | ✓ | — | — | — |
  | OT Datastreamer / Edge Hub (Modbus/OPC-UA/BACnet) | ✓ | — | ○ | ○ | ○ | ○ | — | ✓ | ✓ | — |
  | NetFlow / sFlow / IPFIX | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | — | ✓ |
  | Splunk Stream (wire data) | ✓ | ✓ | — | ✓ | ✓ | ✓ | ✓ | — | — | — |
  | Cyber Vision (OT passive DPI) | ✓ | — | — | — | — | — | — | ✓ | ✓ | — |
  | ThousandEyes (network path tests) | ✓ | ✓ | — | — | — | — | — | — | — | — |
  | Meraki (devices, cameras, sensors) | ✓ | — | ○ | ✓ | ✓ | ✓ | ✓ | — | ✓ | — |
  | `| inputlookup geo_us_states.kmz` (built-in geo lookup) | — | — | ✓ | ✓ | — | — | — | — | — | ✓ |

  Total v1.7 ✓ cells = **~75**; ○ cells = ~9 stretch. The matrix is the v1.7 scope; everything outside the matrix is documented as "follows the same pattern as the closest cell" or deferred to v1.8.

* **Prereqs:** E2 (site infrastructure), G7 (machine-readable schema for the recipe page format), C1–C8 lab access for the Splunk-specific sources.
* **Risk:** ~75 recipes × 0.5 day each = 37.5 dev-days if done from scratch — that's the entire v1.7 milestone budget. Mitigation: (a) most cells are 80%-similar variants of a canonical recipe per layer-type; (b) D5 harness can generate the screenshots and the SPL-vs-expected-fields validation in bulk; (c) treat the matrix as a v1.7 starting set, not a v1.7 completion gate (the gate is "every ✓ cell has a verified recipe; ○ cells are explicit best-effort").
* **Accept:** Every ✓ cell in the matrix above has a recipe file under `docs/recipes/<source>/<layer>.md` with all 6 sections populated. CI validator (G2) blocks PRs that add a layer or source without updating the matrix. LLM-readable index lives at `docs/recipes/index.yaml` listing every recipe with its `expected_fields` and `verified_against` (Splunk version, lab tenant). At least one customer-success engineer who is NOT the author can copy-paste a recipe and have a working panel in ≤ 5 min.

### Theme F — Differentiated capabilities

#### F1. Shared bookmarks + per-user view state — `M`

* **Problem:** Camera state + filter state are lost on reload. Cannot URL-share a specific view.
* **Design:** Encode camera (lat/lon/zoom/bearing/pitch), enabled layers, active filters, time-cursor into the URL hash. On load, restore. Optional KV-store backed "named bookmarks" for users who want to save and share by name. Hook into Splunk's existing user-pref store.
* **Prereqs:** None.
* **Risk:** Splunk Dashboard Studio's own URL hash is already loaded with form-input tokens; collision-management has to be careful. Mitigation: prefix all hash keys with `bm.` and document the reserved namespace.
* **Accept:** Copy URL → open in second browser logged in as the same user → camera, enabled layers, active filters, and time-cursor all restored identically (verified by a Playwright test). Pasted URL still works after a v1.x → v1.y upgrade (forward-compatible hash schema, asserted by G3 migration test).

#### F2. Story mode (saved view sequences) — `L`

* **Problem:** Incident review workflows benefit from "click through these 5 saved views in order". Felt has this. We don't.
* **Design:** A "story" is an ordered list of bookmarks (F1) + per-step annotation markdown + per-step camera animation easing. Editor lives behind a formatter toggle. Player widget overlays the map with next/back arrows + annotation text.
* **Prereqs:** F1.
* **Accept:** Author can record a 5-step incident-replay story; viewer can step through with the keyboard.

#### F3. Raster analytics (NDVI, slope, hillshade, viewshed) — `XL`

* **Problem:** GIS table-stakes; we have nothing.
* **Design:** Use `geotiff.js` + `cog-explorer` patterns to consume Cloud-Optimised GeoTIFF rasters via HTTP range requests. WebGL shaders compute NDVI / slope / hillshade in real time per visible tile. Viewshed is more involved (needs DEM + observer height + line-of-sight); ship it later. Honest scope: probably 2 of the 4 in v2.0, the rest in v2.x.
* **Prereqs:** B2 (terrain DEM source already plumbed).
* **Risk:** COG range-request fetches go around Splunk's proxy and may be blocked by customer firewalls; viewshed compute can run into GPU memory limits on integrated chipsets. Mitigation: document the network requirements clearly; gate viewshed behind an explicit "Advanced (requires WebGL2 + 256 MB GPU)" formatter warning.
* **Accept:** NDVI overlay from a Sentinel-2 COG renders correctly at zoom 8–14; hillshade from the terrain DEM renders correctly; raster-analytics SPL contract documented in `_ref/raster/`. Slope and viewshed explicitly tracked in the v2.x backlog with no v2.0 commitment.

#### F4. Vector-tile authoring — `XL`

* **Problem:** v1.6 *consumes* vector tiles (PMTiles, MVT) but cannot *produce* them. Most customers want to materialise their `assets.csv` as a vector tileset for fast pan/zoom.
* **Design:** Server-side tool (Python or Go) that consumes a Splunk lookup or SPL search and emits a PMTiles archive. Optionally run as a Splunk modular input for periodic refresh. Out of scope: in-browser authoring (use Tippecanoe).
* **Prereqs:** None; ships as a sibling tool.
* **Accept:** A documented `splunk-to-pmtiles` utility that turns 1M-row lookup into a PMTiles archive in under 5 minutes.

#### F5. Collaboration (live cursors, comments) — `XL`

* **Problem:** Felt-style real-time co-presence is genuinely valuable for incident war-rooms.
* **Design:** Requires a backend (Splunk doesn't have a websocket fan-out service). Honestly, this may be out of scope unless we partner with Splunk Engineering. Recommend deferring past v2.0 unless a pilot customer specifically asks.
* **Prereqs:** Backend infrastructure.
* **Risk:** Highest in the roadmap — depends on infrastructure the project does not own. Drop entirely unless §6 Q7 resolves "yes, Splunk Engineering owns the websocket service."
* **Accept:** Two browsers see each other's cursors and can comment in the same panel.

### Theme G — Operational rigor

> The unglamorous floor. v1.6 ships without any of this. Until it lands, "global-tier" is not defensible no matter how good the visuals are.

#### G1. Security audit + supply-chain hardening — `M`

* **Status (2026-05-17):** ✅ **SHIPPED** (PR pending) — every G1 sub-deliverable
  landed in `feat/g1-supply-chain-hardening`. The four PR-gate scans (npm audit,
  OSV-Scanner, license-allowlist, AppInspect cloud+future) plus the release-only
  CycloneDX SBOM and cosign keyless signing now form a unified supply-chain
  contract documented in `docs/runbooks/supply-chain.md`. Local end-to-end test
  on the v1.6.x lockfile produces a 186-component SBOM, all licences on the
  allowlist, zero high+ audit findings, two dev-only moderate OSV findings
  correctly excluded by severity gate. Splunk Cloud and enterprise legal can
  now verify the supply chain offline.

* **Problem:** 11 direct runtime deps, 228 transitive, no `npm audit` in CI,
  no published SBOM, no signed releases, no Dependabot, no SLSA provenance.
  Splunk Cloud customers — and any large-enterprise legal department — will
  reject this on first review.

* **Design — Delivered:**
  - **`scripts/check-npm-audit.py`** (PR + release gate): runs
    `npm audit --omit=dev --json`, FAILs on any `high` or `critical` finding
    not covered by an active waiver. Waivers live in
    `scripts/npm-audit-waivers.json` with 90-day max expiry, real-justification
    requirement, and auto-expiry on the gate.
  - **`scripts/check-license-allowlist.py`** (PR + release gate): runs
    `npm ls --omit=dev --json --all --long`, asserts every runtime dep's
    SPDX licence is on the allowlist in `scripts/license-allowlist.json`
    (MIT / BSD / Apache-2.0 / CC0 / ISC family + small explicit
    additions). Handles dual-license picks (e.g. `(MPL-2.0 OR Apache-2.0)`
    → `Apache-2.0`), upstream typo normalization, and per-package
    overrides where the package omits the field but the LICENSE file is
    permissive (jsonlint, arc).
  - **OSV-Scanner v2.3.8** (PR + release gate): static binary, second-opinion
    vulnerability scanner; output filtered through `scripts/check-osv-report.py`
    against the same waiver file (one CVE, one decision).
  - **CycloneDX 1.6 SBOM** (release artifact): `@cyclonedx/cyclonedx-npm@^4`
    generates a CycloneDX 1.6 JSON SBOM of the full 186-component runtime
    tree, published as `better_map-vX.Y.Z.sbom.json` on every GitHub Release.
  - **Cosign keyless signing** (release artifact): GitHub Actions OIDC token
    → Fulcio short-lived cert → Rekor transparency-log entry, all bundled
    into a `.cosign.bundle` file. Signs the tarball, the `.spl` alias,
    and the SBOM. Release workflow round-trips a `cosign verify-blob`
    self-check before publishing — an unverifiable bundle FAILs the release.
  - **Dependabot** (`.github/dependabot.yml`): weekly grouped PRs for npm
    (separate runtime and dev groups for clarity) and GitHub Actions; auto-rebase;
    14-day decline policy documented.
  - **`.npmrc`** in the viz dir: `engines-strict=true`, `save-exact=true`,
    `audit-level=high`, `fund=false`, `loglevel=error` — deterministic
    installs across contributor machines and CI.
  - **`docs/runbooks/supply-chain.md`** (operator runbook): how to verify
    signatures, consume the SBOM, manage waivers, replace copyleft
    transitive deps, triage Dependabot PRs, and assemble the Splunkbase
    submission packet.

* **Prereqs:** G2 CI/CD landed in v1.7-prep (the PR pipeline these gates plug into).
* **Risk — Addressed:** No copyleft transitives in the v1.7-prep lockfile;
  the dual-license disjunction for dompurify resolves to Apache-2.0. The
  runbook documents the replacement procedure if a future Dependabot bump
  pulls one in.

* **Accept — Phase 1 (this PR):**
  - [x] `npm audit --omit=dev` is a hard PR-gate + release-gate; zero un-waived
    high+ findings in v1.7-prep.
  - [x] License-allowlist gate passes against 186 components; allowlist
    contract documented and locked behind code review.
  - [x] OSV-Scanner runs in CI and release; report uploaded as a CI artifact.
  - [x] CycloneDX SBOM (186 components, spec 1.6) generated and uploaded as
    a release asset alongside `.sha256` + `.cosign.bundle`.
  - [x] Cosign keyless signature over the three release artifacts; round-trip
    self-verify in the release workflow.
  - [x] Dependabot configured for npm (runtime + dev grouped) and GitHub Actions.
  - [x] `.npmrc` enforces strict, reproducible installs.
  - [x] Supply-chain runbook checked in.
  - [x] ROADMAP §1c gap 12 closed; §7d security boxes checked.

* **Accept — Phase 2 (deferred to v1.8 follow-up):**
  - [ ] Splunk app install path (`scripts/install-app.sh`) calls
    `cosign verify-blob` before extracting — defence-in-depth so a tampered
    download can never reach `/opt/splunk/etc/apps/better_map/`.
  - [ ] Weekly scheduled `scan-scheduled.yml` workflow re-runs OSV-Scanner
    against `main` and posts findings to the GitHub Security tab.
  - [ ] CODEOWNERS for `scripts/npm-audit-waivers.json` (waits for G2
    multi-reviewer enforcement).
  - [ ] SLSA provenance v1.0 attestation alongside the cosign signature
    (Sigstore + slsa-github-generator integration).

#### G2. CI/CD infrastructure — `M`

> **Status (v1.7-prep, 2026-05-18): G2 close-out audit COMPLETE.**
> Every gate the original G2 design called for is now wired into the
> workflow YAML AND documented in a single authoritative inventory at
> [`docs/CI-GATES.md`](docs/CI-GATES.md). The audit also closed
> three PR-gate → release-gate parity gaps that the incremental shipping
> of G2 components had inadvertently left open.
>
> - **What's shipped:** PR pipeline (`ci.yml`) runs **25 gates** across
>   four jobs (`lint-and-build` = 18, `appinspect` = 1, `commitlint` = 1,
>   `docs-build` = 5). Release pipeline (`release.yml`) runs **17 gates**
>   on every `v*` tag push, including the three runtime gates closed
>   in the close-out audit (Vitest, D3 accessibility, D2 browser-compat
>   Phase 1 + Phase 1.5) plus four release-only contracts (REL-1 tag
>   verify, AppInspect `--fail-on-warnings`, CycloneDX SBOM, cosign
>   keyless sign + verify, GitHub Release publication). Both workflows
>   share the same Playwright browser-binary cache key
>   (`<os>-playwright-<pkg-lock-version>`) so the release-gate inherits
>   the PR-gate's warm cache and the D2 + D3 re-run completes in
>   seconds, not the ~10 minute cold-install cost. Branch protection
>   on `main` (1-reviewer + all-checks-green + signed-commits) is
>   active. Conventional Commits enforced by `commitlint` against
>   `.commitlintrc.cjs`. Release notes auto-generated by GitHub's
>   `--generate-notes` flag (conventional-commits-aware). All four
>   version sources (`app.conf` launcher version + `app.conf` install
>   build + `package.json` + `HUD_VERSION`) cross-asserted by
>   `scripts/check-version-consistency.js` on every PR, and against the
>   git tag itself on every release.
> - **Close-out audit deltas (this PR):** Added Vitest, D3
>   accessibility, and D2 browser-compat to `release.yml` (they had
>   been SHIPPED in the PR gate but were missing from the release gate
>   — three concrete defence-in-depth gaps the gate-inventory pass
>   surfaced). Documented every gate, its source of truth, what it
>   catches, and the local-repro command in
>   [`docs/CI-GATES.md`](docs/CI-GATES.md). Documented the
>   intentional PR-gate ↔ release-gate parity contract and the four
>   release-stricter bars (REL-1 `--tag`, AppInspect
>   `--fail-on-warnings`, npm-audit waiver-expiry re-evaluation,
>   SBOM-validation). Updated `release.yml` header comment to point
>   at the new inventory.
> - **What's NOT in G2 (explicitly out of scope, tracked elsewhere):**
>   live dispatch test against a docker-compose Splunk Enterprise
>   (ROADMAP §3 D5 Phase 2 — blocked on a self-hosted-runner decision);
>   automated Splunkbase upload via REST (ROADMAP §3 E1 — needs an
>   approved listing + publishing token); cross-OS browser-compat
>   matrix (ROADMAP §3 D2 Phase 2 — same self-hosted-runner blocker
>   as D5); migrating the docs-gates (recipe schema, llms.txt,
>   llms-full.txt, reference-pages, MkDocs strict) into `release.yml`
>   (LOW stakes — docs are excluded from the release tarball via
>   `rsync --exclude='docs'`, and are gated on every push-to-main via
>   `docs.yml` which precedes every tag). All four exclusions are
>   logged under [`docs/CI-GATES.md`](docs/CI-GATES.md) "Known gaps".
>
> The original G2 acceptance criterion ("every PR runs the full
> pipeline in ≤ 10 min; failing builds block merge; release-tag
> workflow produces a signed, SBOM-bearing, AppInspect-clean `.tar.gz`
> with zero manual steps") is fully met. The 10-min ceiling holds on
> warm caches: a typical PR completes the four `ci.yml` jobs in
> 4-6 minutes wall-clock (lint-and-build is the long pole at ~3 min,
> appinspect runs in parallel at ~3 min, commitlint + docs-build are
> ~1 min each).

* **Problem:** No GitHub Actions, no branch protection, no required reviews, no automated changelog, no release automation. Every release is a single-author manual `npm run build && tar -czf ... && curl --data-urlencode name=URL` ritual. Will not scale past one contributor.
* **Design:**
  - **PR pipeline:** lint (ESLint + Prettier), typecheck (JSDoc-driven via `tsc --noEmit --checkJs`), unit tests (`vitest`), webpack production build, bundle-size check vs §7 budget, **G8 JS↔CSS contract lint**, **dashboard XML/JSON parse check** (every `default/data/ui/views/*.xml` parses as XML AND its `<![CDATA[...]]>` JSON definition parses as JSON — catches a typo'd CDATA closing tag or a missing brace before it reaches a browser), **dashboard ↔ widget token cross-check (Q-1B)** (every `$better_map.*$` token referenced by a Dashboard Studio JSON definition has a matching string-literal producer in `src/lib/**/*.js` — defends against the SPATIAL-1 regression class where a widget defaults to a non-namespaced token name and silently breaks the dashboard contract), **release manifest drift check (G3)** (`scripts/check-manifest.py` regenerates the manifest from the source tree via `scripts/build-manifest.py --stdout` and asserts byte-for-byte equality with the checked-in `better_map/default/_better_map_manifest.json` — defends against silent orphan-file accumulation across `update=true` REST installs), **production-bundle console-noise check** (regex-scan the minified `visualization.js` for unallowlisted `console.warn` / `console.error` / `console.debug` calls — `debugHud.js` and the explicit error-telemetry path are allowlisted; everything else fails CI), AppInspect pre-cert, dispatch-test against a docker-compose Splunk Enterprise (D5 wires this).
  - **Branch protection on `main`:** PR required, 1 review (raise to 2 once §7 contributor-floor box is checked), all CI green, signed commits required.
  - **Conventional commits:** enforce via commitlint; auto-generate `CHANGELOG.md` from commit messages via `conventional-changelog-cli`; remove the hand-curated 1396-line CHANGELOG (or freeze it as v1.x and start a fresh generated one for v2+).
  - **Release automation:** tag-triggered workflow runs `npm run build`, packages the `.tar.gz`, computes SHA256, signs via cosign (G1), uploads to GitHub Releases with auto-generated release notes, and (optionally) pushes to Splunkbase via their REST API once vetted (E1).
  - **Version bump policy:** SemVer is binding. Patch = bugfix only; minor = additive features (default off); major = breaking. The `app.conf` version, `package.json` version, and `HUD_VERSION` must match — assert in CI.
* **Prereqs:** None — this lands first to unblock G1 and everything else.
* **Risk:** Conventional-commits adoption requires retraining; first PRs may have lots of commitlint failures. Mitigate with a `husky` pre-commit hook that runs the linter locally.
* **Accept:** Every PR runs the full pipeline in ≤ 10 min; failing builds block merge; release-tag workflow produces a signed, SBOM-bearing, AppInspect-clean `.tar.gz` with zero manual steps.

#### G3. Upgrade hygiene — `S`

* **Status (2026-05-17):** ✅ **Phase 1 SHIPPED** — manifest + CI gate + operator runbook (PR pending).
  Phase 2 (in-app `bin/upgrade.py` auto-delete) is deferred to a v1.8 follow-up
  (see Risk note below). Phase 1 alone closes the operator-visibility gap that
  motivated G3; live test against `rev` already surfaced **50,994 orphan files
  (667 MiB)** the operator can now act on (see §1c verification table).

* **Problem:** The 2026-05-16 deploy left two orphan dashboards (`better_map_test_install`, `bm_react_test`) from prior v1.5 installs on disk; Splunk's `update=true` REST install extracts on top but doesn't delete files absent from the new tarball. Without a migration step we accumulate orphans every release. Same risk applies to renamed lookups, retired macros, or removed visualizations.conf stanzas.

* **Design — Phase 1 (this PR):**
  - Ship a manifest with every release: `default/_better_map_manifest.json` listing every shippable file with its SHA-256 + size. Generated by `scripts/build-manifest.py` from the source tree using the same exclude list as `release.yml`. Validated in CI by `scripts/check-manifest.py` (any drift between checked-in manifest and source tree is a PR-blocking FAIL with a unified diff).
  - Ship an operator runbook `scripts/find-orphans.sh` that SSHes into a deployed Splunk instance, compares the file tree under `/opt/splunk/etc/apps/better_map/` against the canonical manifest, and produces a grouped + size-summed orphan report. Wholly-orphan directories (no manifest sibling) are collapsed to a single line — a v1.5 `node_modules/` tree of 47k files reports as one row, not 47k.
  - End-to-end operator procedure documented at `docs/runbooks/upgrade-hygiene.md` covering detection, three removal strategies (per-file `--delete`, `rm -rf` whole directories, nuke + reinstall), and the recommended post-release acceptance step.

* **Design — Phase 2 (deferred to v1.8):**
  - In-app `bin/upgrade.py` modular bin script (run via `[restart_postscript]` in `app.conf`) reads the previous-version manifest from `local/_better_map_previous_manifest.json`, computes the set of removed files, and deletes them via REST. Auto-delete on install/upgrade.
  - Add a v1.x → v1.y migration test to CI: install v(N-1), then install vN with `update=true`, then verify the post-install REST view list exactly matches the vN manifest. Caught by D5 harness once that exists.
  - Document in the operations guide how to manually delete orphans via REST `DELETE` for customers who already have them.

* **Prereqs:** None.

* **Risk:** Modular-script execution under `[restart_postscript]` has historically been flaky on Splunk Cloud. Mitigation: Phase 1 sidesteps this entirely (operator-driven runbook, no in-app code); Phase 2 will fall back to a `setup.xml` action the admin runs once post-upgrade.

* **Accept — Phase 1:**
  - [x] `default/_better_map_manifest.json` checked in and shipped in the release tarball.
  - [x] `scripts/check-manifest.py` PR-blocking on every change; verified by acceptance test (introduce drift → FAIL with unified diff → restore → PASS).
  - [x] `scripts/find-orphans.sh` runs against `rev`, reports 50,994 orphan files / 667 MiB in a grouped summary; `docs/runbooks/upgrade-hygiene.md` walks the operator through three removal strategies.

* **Accept — Phase 2 (deferred):** Installing v1.8 on top of v1.7 leaves zero files behind that aren't in the v1.8 manifest; D5 harness asserts this.

#### G4. i18n / localisation framework — `M`

* **Problem:** All formatter labels, all dashboard XML labels, all docs, all popup text is hardcoded English. Per §6 Q8, v2.0 target is at least Japanese + German + Norwegian — but the codebase has no localisation seam.
* **Design:**
  - Externalise every UI string to a lookup table: `lookups/better_map_strings_<locale>.csv` keyed by `string_id`. Formatter HTML uses `{{strings.foo}}` placeholders that are substituted at render time.
  - Splunk's built-in `splunkjs/mvc/i18n` module surfaces the user's locale from `current-user`. Use that for the runtime path.
  - Docs: MkDocs Material supports i18n out of the box (E2 picks the right plugin from the start).
  - Acceptance test: switch Splunk Web locale to `de_DE`, confirm formatter labels and popup chrome render in German.
* **Prereqs:** E2 docs site (use the i18n-capable plugin from day one).
* **Risk:** Splunk Mobile may not respect the runtime locale path. Document the limitation.
* **Accept:** Three locales shipped (English + 2 from {de, ja, no} — pick by §6 Q7); switching the user locale in Splunk Web swaps the strings without a page reload; every untranslated key falls back to English with a console warning in dev builds only.

#### G5. Theming tokens — `S`

* **Problem:** Dark/light themes are hardcoded across `visualization.css`, `controlPanel.js`, `debugHud.js`, and `formatter.html`. Customers with brand standards (Equinor red, customer-X blue) cannot rebrand without forking.
* **Design:**
  - Move every colour, font-family, shadow, and radius to a CSS custom-property layer (`--bm-color-accent`, `--bm-color-bg-overlay`, `--bm-font-family-mono`, etc.).
  - Ship two reference themes (`themes/default-dark.css`, `themes/default-light.css`) plus a `themes/customer-template.css` that documents every overrideable token.
  - Formatter exposes a "Custom theme URL" text input; if set, the viz `link rel="stylesheet"` injects it at runtime. Honours Splunk's CSP via `same-origin` only (no cross-origin theme fetches).
  - Hard rule: status colours (`--bm-color-critical/warning/ok`) are NEVER customer-overrideable — accessibility floor, same posture as the existing dashboard-design skill.
* **Prereqs:** None.
* **Risk:** Customer theme CSS may override colours we depend on for semantic clarity (e.g., choropleth ramps). Mitigation: document the contract; use `!important` only on the locked status palette.
* **Accept:** A customer can ship a 50-line CSS file that rebrands the viz to their colour system without touching the bundle; the locked status palette is unaffected.

#### G6. Plugin / extension API — `L`

* **Problem:** kepler.gl and deck.gl both have third-party layer authoring; better_map does not. Community contribution path is "fork the repo." That's a moat the leaders have and we don't.
* **Design:**
  - Expose a public registration contract: `window.BetterMap.registerLayer({id, mount, update, unmount, setVisible, schema, formatterSection})`. The dispatcher in `src/lib/layers/index.js` already has this shape internally — make it public, document the contract, freeze it.
  - **Runtime envelope (§1a) applies to every plugin** — plugins must register through the AMD path, ship inside their own Splunk app, fit under Splunk Cloud CSP, and feature-detect Dashboard Studio v2 vs SWF host. Plugins that need to break out of any of these are out of scope.
  - Plugins ship as separate Splunk apps that depend on `better_map` and register at AMD-load time. Same model as Splunk's own viz registration.
  - Provide a `create-better-map-layer` scaffolding tool (npm package) that emits a starter project with webpack config, test harness, and Splunk app metadata.
  - Plugin discovery: a `?better_map_plugins=` query parameter and a formatter option list installed plugins; viz panel includes them in the layer-type dropdown.
  - BM-CT-1 applies to every plugin: every plugin layer must expose `setEnabled / isEnabled / reset` or registration fails loudly.
* **Prereqs:** G2 (a working CI to publish the npm scaffolding tool), G5 (theming tokens make plugin styling sane).
* **Risk:** Public API contract = future compatibility burden. Mitigation: ship the contract as `v1` namespace from day one, treat additions as backwards-compatible, breakage requires major bump.
* **Accept:** A reference plugin (`better-map-plugin-example`) lives in a sibling repo, installs cleanly into a Splunk instance alongside better_map, registers an "example" layer that appears in the Dashboard Studio dropdown, respects BM-CT-1, and renders without modifying core better_map code.

#### G7. AI-ingestion-friendly documentation — `M`

> **Status (v1.7-prep, 2026-05-17): G7 Phase 1 SHIPPED.** The machine-readable docs layer is live at `docs/_machine/`:
> - **`docs/_machine/formatter-schema.json`** — JSON Schema 2020-12 describing all **82 formatter options** (id, type, default, enum values, help text, Splunk property path, custom `x-bm` metadata for tab/heading). Generated from `formatter.html` by `scripts/build-formatter-schema.py`. Originally G7 Phase 1 shipped at 83 options with one legacy duplicate `data-name="highContrast"` auto-recorded in `x-meta.known-issues`; D3 Phase 1 (v1.7) removed that duplicate (it was an axe-core `duplicate-id-aria` finding) along with the orphan `mapLabelLanguage` control, and the duplicate-data-names list is now empty. Any future duplicate fails both `check-formatter-coverage.py` AND `check-accessibility.js`.
> - **`docs/_machine/integrations/*.yaml`** — 8 hand-maintained YAMLs (one per Theme C integration: `itsi.yaml`, `soar.yaml`, `rba.yaml`, `aiGeo.yaml`, `mitre.yaml`, `esNotable.yaml`, `purdue.yaml`, `aiAssistant.yaml`). Each declares `meta`, `status` (`experimental` is the v1.7 default), `splunk_app_required`, `splunk_version_min`, `endpoints_called[]` with HTTP method + auth, `field_contract`, `tested_against` (null until live-tenant verification), `bm_ct_1`, and `references`. `purdue.yaml` additionally encodes the OT-safety boundary (Rules 1/2/5/6 from `/.cursor/rules/ot-safety.mdc`).
> - **`docs/_machine/agents.md`** — operating guide for AI agents working on the repo: the five non-negotiables (formatter schema, manifest, JS↔CSS contract, dashboard token contract, BM-CT-1), where things live, the runtime envelope, how to add a formatter option / integration, the pre-commit checklist, common mistakes and fixes. Modelled on the emerging `AGENTS.md` convention.
> - **`docs/_machine/README.md`** — explains the `_machine` contract (what's generated vs hand-maintained, what's in Phase 1, what's deferred to Phase 2, stability promise across patch/minor/major releases).
> - **Two new CI gates** wired into both `ci.yml` and `release.yml`:
>   - `scripts/check-formatter-schema.py` — byte-equality drift gate (regenerates schema, asserts identity with the checked-in file).
>   - `scripts/check-formatter-coverage.py` — three explicit assertions the drift gate cannot make: HTML→schema coverage, schema→HTML coverage, duplicate transparency.
> - **End-to-end verification:** both gates print `[PASS]` locally on the v1.7-prep tree (83 unique data-names, 83 schema properties, 1 duplicate recorded); workflow YAML re-parses; release tarball does NOT ship `docs/_machine/` (rsync `--exclude='docs'` already in place at both packaging sites).
> - **What's NOT in Phase 1 (tracked for G7 Phase 2):** ~~`llms.txt`~~ (shipped in v1.7-prep — see Phase 2 status block below), ~~`llms-full.txt`~~ (shipped in v1.7-prep — see "G7 Phase 2 SHIPPED (llms-full.txt)" status block below), `_machine/layers/<layer-id>.yaml` (independent but de-prioritised behind integrations, where the actual customer questions land), `_machine/openapi-better_map-rest.yaml` (blocked on the REST endpoints it would describe: F1 / G6 / D5 are all v1.8+).
>
> **Status (v1.7-prep, 2026-05-17): G7 Phase 2 SHIPPED (llms.txt only).** The remaining `llms.txt` blocker cleared once E5 Phase 1 landed `_machine/recipes/index.yaml`. Phase 2 delivers the agent-discoverable single-URL site index:
> - **`docs/llms.txt`** — Markdown-format index conforming to the [llms.txt convention](https://llmstxt.org/). Top-level sections: `Agent guide` (the operating manual + `_machine/` contract), `Getting started`, `Reference` (the **82** formatter options + layer reference + BM-CT-1), `Runtime envelope`, `Integrations (Splunk)` (the human-facing catalogue PLUS the **8** machine-readable scaffolds with status + required Splunk app + JS source path), `Recipes (per-source playbooks)` (the **3** shipped recipes with status + required apps), `Runbooks`, `Operations & deployment`, `Machine-readable layer`, `Project meta`, `Optional`. Every entry has a one-line description and a stable URL. Output is **9.6 KB / 90 lines** — small enough to fit in any practical LLM context window. The on-disk file lives at `docs/llms.txt`; MkDocs copies it verbatim to `site/llms.txt` (non-markdown extension); the published URL is <https://fenre.github.io/better_map/llms.txt>.
> - **`scripts/build-llms-txt.py`** — the generator. Walks four structured sources (`mkdocs.yml` `nav:` tree + `docs/_machine/integrations/*.yaml` + `docs/_machine/recipes/index.yaml` + `docs/_machine/formatter-schema.json`) and emits `docs/llms.txt` deterministically (no clock-based fields, no random ordering — drift checks are stable). Modes: `python3 scripts/build-llms-txt.py` (write), `--stdout` (preview), `--check` (CI drift gate).
> - **CI gate:** wired into the existing `docs-build` job in `ci.yml` immediately after the recipe-schema check and before the strict MkDocs build, so the gate fires on EVERY PR. The script reuses the PyYAML transitive dep already pulled in by MkDocs / mkdocs-material — no new requirements.
> - **End-to-end verification:** `python3 scripts/build-llms-txt.py --check` prints `[PASS]`; `mkdocs build --strict` copies the file verbatim (`diff docs/llms.txt site/llms.txt` returns no differences); the drift gate fires when the file is mutated and recovers cleanly on regeneration.
> - **Authoring contract updates:** `docs/_machine/agents.md` §4 (formatter option), §5 (integration), §5b (recipe) all now include a `python3 scripts/build-llms-txt.py` regen step, and the pre-commit checklist in §7 adds the `--check` invocation. New common-mistake row in §8.
> - **Still open for G7 Phase 2:** ~~`llms-full.txt` (per-page token-budget contract + theme-chrome stripper, both more involved than the index)~~ (shipped v1.7-prep — see "G7 Phase 2 SHIPPED (llms-full.txt)" status block below), `_machine/layers/<layer-id>.yaml` (independent — de-prioritised behind integrations), `_machine/openapi-better_map-rest.yaml` (blocked on F1 / G6 / D5).
>
> **Status (v1.7-prep, 2026-05-18): G7 Phase 2 SHIPPED (llms-full.txt).** The body-inclusive sibling of `llms.txt` closes the last open item on the original G7 Phase 2 backlog (the `_machine/layers/*.yaml` cut is independent and explicitly de-prioritised behind integrations; the OpenAPI cut is blocked on REST endpoints in v1.8+). `llms-full.txt` is the file an LLM agent hits when it would rather one-shot the project than follow links — useful when the agent runs under a CSP that forbids follow-up fetches or when the agent's tool-loop overhead per follow-up fetch dominates the token cost of the body:
> - **`docs/llms-full.txt`** — Markdown-format dump of every page in `mkdocs.yml` `nav:` concatenated under stable `# === BEGIN: <url> ===` / `# === END: <url> ===` delimiters. Per page: a `# <Title>` H1, a `> Source: docs/<relpath>` line, a `> URL: <url>` line, then the cleaned body. **22 page blocks** (Home, Getting started ×2, Runtime envelope, Reference ×4, Integrations ×2, Recipes ×4, Performance, Air-gapped, Runbooks ×3, Contributing, Changelog, Roadmap) plus **3 appendices** (Appendix A — the **8** Splunk integrations matrix with endpoints + field-contract keys + BM-CT-1 slot mapping + references; Appendix B — the **3** shipped recipes with status, required apps, expected-fields summary; Appendix C — how the file is built). The `include-markdown` directives in `docs/changelog.md` and `docs/roadmap.md` are resolved inline at emit time so the full CHANGELOG and ROADMAP bodies appear under their wrapper pages. Output is **~360 KB / 5.9k lines / ~89k estimated tokens** — comfortably under the hard 200k-token budget and the 150k soft warn. MkDocs copies the file verbatim to `site/llms-full.txt` (non-markdown extension); the published URL is <https://fenre.github.io/better_map/llms-full.txt>.
> - **`scripts/build-llms-full-txt.py`** — the generator. Walks the same four structured sources as `build-llms-txt.py` (`mkdocs.yml` `nav:` + `_machine/integrations/*.yaml` + `_machine/recipes/index.yaml` + `_machine/formatter-schema.json`) PLUS the body of every page in nav order, resolves the `include-markdown` plugin directives recursively (4-level cycle guard), and strips the MkDocs Material chrome that carries no LLM signal: YAML front-matter, `:material-*:` / `:octicons-*:` / `:fontawesome-*:` / `:simple-*:` icon shortcodes, `<div class="grid cards" markdown>` wrappers, attribute-list suffixes (`{ #anchor data-toc-label="x" }`, `{ .class }`), Material permalink anchors, and `!!! tip "Title"` admonitions (converted to `> **Tip: Title**` blockquotes so the semantics survive). Token estimation uses the OpenAI cookbook's 4-chars-per-token rule. Modes: `python3 scripts/build-llms-full-txt.py` (write), `--stdout` (preview), `--check` (CI drift gate + budget enforcement).
> - **Hard token budget contract:** 200,000 estimated tokens total HARD FAIL; 150,000 total soft WARN; 50,000 per-page soft WARN. The fail cap is binding — if a future page pushes the total over 200k, the gate refuses to write the file (in `write` mode) or fails CI (in `--check` mode). Raising the cap requires explicit roadmap review. The current output sits at ~89k tokens, leaving ~110k of headroom.
> - **CI gate:** wired into the existing `docs-build` job in `ci.yml` immediately after the `llms.txt` check and before the auto-generated reference-page check, so the gate fires on EVERY PR that touches a docs page, an integration YAML, the recipe index, the formatter schema, the mkdocs nav, or any of the included root files (`README.md`, `CHANGELOG.md`, `ROADMAP.md`). Reuses the PyYAML transitive dep — no new requirements.
> - **End-to-end verification:** `python3 scripts/build-llms-full-txt.py --check` prints `[PASS] docs/llms-full.txt is in sync (358,115 chars, ~89,528 estimated tokens, 150,000 warn / 200,000 fail)`. `mkdocs build --strict` copies the file verbatim (`cmp docs/llms-full.txt site/llms-full.txt` reports byte-identical at 360,811 bytes — the byte/char delta is multi-byte UTF-8 em-dashes). The drift gate fires when the file is mutated (negative-test verified by tampering with line 1) and recovers cleanly on regeneration.
> - **Authoring contract updates:** `docs/_machine/agents.md` §4 (formatter option), §5 (integration), §5b (recipe), §7 (pre-commit checklist), §8 (common-mistakes table — two new rows: out-of-sync `llms-full.txt` and over-budget total), and §9 (references list) all now reference `build-llms-full-txt.py` alongside `build-llms-txt.py`. `docs/_machine/README.md` adds a row to the "what's in this directory today" table for `llms-full.txt`, crosses out the `llms-full.txt` line in "what's NOT here yet", and adds a new §8 "single-URL FULL-BODY entry point" use-case.
> - **Result:** the G7 Phase 2 backlog originally documented in the design section below (`/docs/llms-full.txt` row) is fully closed. The remaining G7 work is the `_machine/layers/<layer-id>.yaml` cut (independent, de-prioritised behind integrations where the actual customer questions land) and `_machine/openapi-better_map-rest.yaml` (blocked on F1 / G6 / D5 — there are no REST endpoints to describe yet).
>
> **Status (v1.7-prep, 2026-05-18): E2 Phase 2 SHIPPED (auto-gen formatter reference).** With G7 Phase 2's `llms.txt` framework proving the deterministic-regenerator + drift-gate pattern, the first E2 Phase 2 cut applies the same pattern INSIDE the human-readable reference pages, eliminating an entire class of doc-rot ("page lists 60 formatter options but `formatter.html` has 82"):
> - **`scripts/build-reference-pages.py`** — managed-region regenerator. Reads `docs/_machine/formatter-schema.json` and rewrites the text between `<!-- BEGIN AUTOGEN: <section-id> -->` / `<!-- END AUTOGEN: <section-id> -->` marker pairs in the target reference pages, preserving hand-authored narrative outside the markers. Pure stdlib (no new deps). Modes: `python3 scripts/build-reference-pages.py` (write), `--stdout` (preview), `--check` (CI drift gate). Extensible from day one: targets list is a single `_regions()` function so the same script will absorb the integrations catalogue auto-sections and the recipe matrix in follow-up PRs without changing the marker convention.
> - **`docs/reference/formatter.md`** — narrative-at-top, auto-enumeration-at-bottom. The hand-authored intro (option-flow walkthrough + AI-agent pre-flight rule) survives unchanged; the new `Full option enumeration` section is auto-rendered as **16 tables** (one per Dashboard Studio `(tab, heading)` pair: `data` × 4 headings, `display` × 9 headings, `style` × 3 headings) covering all **82 options**, with columns for short option name + display title, JSON Schema type (including range / step for numerics), default value, enum / range constraint, and the help text from the formatter UI. The Splunk property path (mechanical: `display.visualizations.custom.better_map.better_map.<option>`) is stated once at the top of the section rather than per row.
> - **CI gate:** wired into the existing `docs-build` job in `ci.yml` immediately after the `llms.txt` check and before the strict MkDocs build. The gate fires on EVERY PR that touches `formatter.html`, `scripts/build-formatter-schema.py`, or the reference page itself.
> - **End-to-end verification:** `python3 scripts/build-reference-pages.py --check` prints `[PASS]`; the `mkdocs build --strict` produces 16 `<table>` elements and 98 `<tr>` rows (16 header rows + 82 data rows) in `site/reference/formatter/index.html`; the drift gate fires when content inside the managed region is mutated (negative-test verified by tampering with one of the option names) and recovers cleanly on regeneration; manual edits OUTSIDE the markers (narrative prose) are preserved by design.
> - **Authoring contract updates:** `docs/_machine/agents.md` §4 (formatter option) now includes a step 5 `python3 scripts/build-reference-pages.py` regen; the §7 pre-commit checklist adds the `--check` invocation; §8 gains two new common-mistake rows (reference-page drift + missing markers); §9 + §10 reference the new generator. `docs/_machine/README.md` adds a row to the "what's in this directory today" table for the managed regions and crosses out the `llms.txt` line in "what's NOT here yet" (now superseded by an explicit `E2 Phase 2 auto-generated reference enumerations` strikethrough).
> - **Still open for E2 Phase 2:** ~~auto-generated sections inside `docs/integrations/catalogue.md`~~ (shipped v1.7-prep — see "E2 Phase 2 SHIPPED (auto-gen integrations matrix)" status block below) and ~~`docs/recipes/index.md` (auto matrix from `_machine/recipes/index.yaml`)~~ (shipped v1.7-prep — see "E2 Phase 2 SHIPPED (auto-gen recipes matrix)" status block below). All three E2 Phase 2 auto-gen targets the original design called out are now shipped behind a single shared `build-reference-pages.py` framework. Privacy-preserving analytics decision + custom domain remain truly Phase 2 work but are independent of the auto-gen track.
>
> **Status (v1.7-prep, 2026-05-18): E2 Phase 2 SHIPPED (auto-gen integrations matrix).** Second cut of `scripts/build-reference-pages.py` extends the managed-region pattern from the formatter reference to the integrations catalogue, eliminating the second class of doc-rot the E2 Phase 2 design called out ("catalogue lists 7 integrations but `_machine/integrations/` has 8" / "catalogue says ITSI requires ES but YAML says SA-ITOA"). With this cut, the only E2 Phase 2 auto-gen target still open is the recipes matrix in `docs/recipes/index.md` — a small follow-up PR adding one more entry to `_regions()` against the same framework.
> - **`scripts/build-reference-pages.py` second region — `integrations-matrix`** — reads every `docs/_machine/integrations/*.yaml`, emits a single at-a-glance Markdown table with one row per integration (canonical id + display name, status, splunk_app_required, splunk_version_min, REST endpoint count, auth model, OT-safety flag with rule-count summary, live-tenant test status, and a link back to the source YAML), followed by an `Endpoint detail` subsection with one `#### <id>` block per integration listing every REST call (`METHOD path (auth: …) — purpose`) or noting the offline-helper case. Order is stable: sorted by YAML filename (matches `llms-full.txt` Appendix A). Includes a vendored zero-dep YAML reader so the script remains pure-stdlib in the absence of PyYAML, and falls through to PyYAML when present (CI image always has it via mkdocs).
> - **`docs/integrations/catalogue.md`** — narrative-at-top + matrix-in-the-middle + per-integration prose-at-the-bottom. The hand-authored intro (the "Each integration follows the same shape" bullet list) survives unchanged; the new `## Integration matrix at a glance` section sits between the intro and the eight existing per-integration `## <integration>` prose blocks (which also survive unchanged, since they carry hand-authored detail the YAML doesn't capture: where the data lives in CIM terms, which formatter keys drive behaviour, OT-safety rationale, etc.). The matrix renders **8 rows** (one per integration: `aiAssistant`, `aiGeo`, `esNotable`, `itsi`, `mitre`, `purdue`, `rba`, `soar`), summarising **6 distinct REST endpoints across the suite** (RBA is offline-only; the other 7 each call 1 REST endpoint, `esNotable` calls 2), with `purdue` and `soar` carrying explicit `ot_safety` blocks (4 OT-safety rules cited on `purdue`, generic OT-safety binding on `soar`). All 8 integrations report `status: experimental` and `tested_against: null` — fully consistent with §1c gap 1 and Theme C in-flight.
> - **CI gate:** wired into the existing `docs-build` job in `ci.yml` — the `scripts/build-reference-pages.py --check` invocation already runs after the `llms-full.txt` check, and now covers BOTH managed regions (formatter enumeration + integrations matrix) so any drift in either fails the same gate. The success message now reads `[PASS] 2 reference page(s) in sync with their structured sources of truth (docs/_machine/formatter-schema.json, docs/_machine/integrations/).`
> - **End-to-end verification:** `python3 scripts/build-reference-pages.py --check` prints `[PASS] 2 reference page(s) in sync …`. `mkdocs build --strict` produces the catalogue page with a single matrix table (9 columns × 9 rows including the header) plus 8 endpoint-detail `<h4>` blocks under one `<h3>Endpoint detail</h3>`, with the hand-authored eight `<h2>` per-integration sections preserved verbatim below. Heading cascade is now `# → ## → ### → ####` (no skip — fixed during implementation when the initial draft skipped `##` → `####`). The drift gate fires when content inside the managed region is mutated (negative-test verified by hand-editing a row) and recovers cleanly on regeneration.
> - **Authoring contract updates:** `docs/_machine/agents.md` §5 (adding new integration) now lists THREE regenerators in step 6 — `build-reference-pages.py`, `build-llms-txt.py`, `build-llms-full-txt.py` — and explains that the new integration appears in THREE places (catalogue matrix, llms.txt section, llms-full.txt Appendix A) all derived from the same YAML. The §7 pre-commit checklist's inline comment for `build-reference-pages.py --check` now enumerates both managed regions (formatter + integrations) and switches the invocation to the MkDocs venv (the integrations renderer needs PyYAML). §8 gains two new common-mistake rows for the catalogue.md case (drift + missing markers). §9 ("what this file is NOT") and §10 ("References") now name both managed regions. `docs/_machine/README.md` is updated to reflect the second managed region in both the "what's in this directory today" row and the "what's NOT here yet" strikethrough.
> - **Still open for E2 Phase 2:** ~~auto-generated matrix inside `docs/recipes/index.md`~~ (shipped v1.7-prep — see "E2 Phase 2 SHIPPED (auto-gen recipes matrix)" status block below) — closes the last E2 Phase 2 auto-gen target. Privacy-preserving analytics decision + custom domain remain independent of the auto-gen track.
>
> **Status (v1.7-prep, 2026-05-18): E2 Phase 2 SHIPPED (auto-gen recipes matrix).** Third (and final) cut of `scripts/build-reference-pages.py` extends the managed-region pattern from the formatter reference and the integrations catalogue to the recipes index, closing the last open E2 Phase 2 auto-gen target. The three regions now share the same generator + drift-gate machinery; future doc-rot prevention work in this lane (e.g. an auto-gen layers reference) just adds another `ManagedRegion` to `_regions()` against the same framework.
> - **`scripts/build-reference-pages.py` third region — `recipes-matrix`** — reads `docs/_machine/recipes/index.yaml` (itself generated deterministically by `scripts/build-recipe-index.py` from the per-recipe frontmatter — already drift-gated by `scripts/check-recipe-schema.py`) and emits a single at-a-glance Markdown table with one row per recipe (recipe display as `<source-display> → <layer-display>` linked into the recipe md, status with a `_(needs live-tenant test)_` hint when unverified, source pattern, layer id, required Splunk apps with `_(optional)_` suffix where applicable, expected-fields count, formatter-options count + comma list, OT-safety boolean, last-verified ISO8601 date). Row order matches the index YAML (alphabetical by recipe id). Includes a one-line `Total: N recipes · X unverified · Y verified · K source patterns · M layer types` summary above the table.
> - **`docs/recipes/index.md`** — narrative-at-top + matrix-in-the-middle + contract-at-bottom. The hand-curated 3-row "Source pattern / Recipe / Apps" mini-table that previously lived in the `## Status (v1.7-prep, ...): E5 Phase 1 SHIPPED` section is replaced by the auto block (the mini-table was exactly the doc-rot surface this cut was designed to fix — every new recipe would have required manually editing both the index page AND the frontmatter). The richer auto matrix (9 columns vs the old 3) renders 3 recipes today, scaling automatically as new recipes land. The `## The recipe contract`, `### Frontmatter schema`, `### Generated index`, `### CI gates`, `### Adding a new recipe`, and `## Where to read more` hand-authored sections OUTSIDE the markers are preserved verbatim.
> - **CI gate:** the existing `scripts/build-reference-pages.py --check` invocation now covers ALL THREE managed regions. Success message: `[PASS] 3 reference page(s) in sync with their structured sources of truth (docs/_machine/formatter-schema.json, docs/_machine/integrations/, docs/_machine/recipes/index.yaml).` No new wiring needed in `ci.yml`.
> - **End-to-end verification:** `python3 scripts/build-reference-pages.py --check` prints `[PASS] 3 reference page(s) in sync …`. `mkdocs build --strict` produces the recipes index page with one `<table>` (10 columns × 4 rows including the header), all three recipe links resolve (CIM Network Traffic → markers, US states → choropleth, KV Store → markers), and the hand-authored `## The recipe contract` heading still appears below the auto block. The drift gate fires when content inside the managed region is mutated (negative-test verified) and recovers cleanly on regeneration.
> - **Authoring contract updates:** `docs/_machine/agents.md` §5b (adding new recipe) step 4 now lists FOUR places the new recipe appears (recipes-matrix region, `_machine/recipes/index.yaml`, `llms.txt` short index, `llms-full.txt` Appendix B), and lists the THREE regenerators that must run before commit (`build-recipe-index.py`, `build-reference-pages.py`, both `build-llms-*.py`). §7 pre-commit checklist comment now enumerates all three managed regions. §8 gains two new common-mistake rows for the recipes index drift + missing-markers cases. §9 + §10 reference all three regions. `docs/_machine/README.md`'s table row for managed regions is expanded to describe all three; the "what's NOT here yet" strikethrough lists all three auto-gen targets as shipped and notes that no further E2 Phase 2 auto-gen targets remain.
> - **Result:** all three auto-gen targets the original E2 Phase 2 design called out (formatter reference, integrations catalogue, recipes matrix) are shipped behind a single shared framework. The remaining E2 Phase 2 work is independent: privacy-preserving analytics decision + custom domain. Future doc-rot prevention work in this lane is per-vertical (e.g. an auto-gen layers reference once `_machine/layers/*.yaml` exists; the layer schema is itself blocked behind integrations).

* **Problem:** Customers increasingly ask Cursor / Claude Code / GitHub Copilot / Splunk AI Assistant "set up better_map for my Meraki data." The model needs structured, machine-readable inputs to do that well. Today everything is prose in `README.md` and `CHANGELOG.md`; an LLM can read it but cannot reliably extract the formatter schema, the recipe matrix, or the field contracts. This blocks the dominant onboarding mode for v2.0 customers.
* **Design:** Build a parallel machine-readable documentation layer that mirrors the human-readable layer (E2) one-to-one. Markdown remains the source of truth for narrative; YAML/JSON Schemas are the source of truth for contracts. The two are kept in sync by a generator script under `docs/_tools/`.

  - **`/docs/llms.txt`** — per the emerging [llms.txt convention](https://llmstxt.org/) — a single-file index listing every page on the docs site with a one-line summary, page URL, and the size in tokens. An LLM agent can fetch this one file and decide which deeper pages to read. Generated from the MkDocs nav tree.
  - **`/docs/llms-full.txt`** — same index but with the *full body* of every page concatenated, separated by stable delimiters. For agents that want everything in one fetch. Capped at 200k tokens; the generator warns above 150k.
  - **`/docs/_machine/formatter-schema.json`** — a JSON Schema describing every formatter option: `id`, `type` (boolean / number / enum / colour / SPL-field-name / etc.), `default`, `enum-values`, `enables-feature`, `requires-feature`, `bm-ct-1-controls` (which `setEnabled / isEnabled / reset` triple it operates), `runtime-envelope-notes` (e.g., "requires WebGL2; falls back to CPU"). Generated from `formatter.html` at build time; CI fails if `formatter.html` introduces an option not declared in the schema.
  - **`/docs/_machine/layers/<layer-id>.yaml`** — one file per layer type. Schema: `id`, `display_name`, `required_fields`, `optional_fields`, `output_fields_emitted`, `formatter_options_used` (refs into the formatter schema), `bm-ct-1_controls`, `runtime_envelope_dependencies` (WebGL2? worker? terrain source?), `compatible_sources` (refs into E5 recipe matrix), `examples` (refs into recipe files). Replaces and obsoletes any prose-only layer-type documentation.
  - **`/docs/_machine/integrations/<integration-id>.yaml`** — one file per Theme C integration (ITSI, SOAR, RBA, A&I-geo, MITRE, ES notable, OT Purdue, AI Assistant). Schema: `splunk_app_required`, `splunk_version_min`, `endpoints_called` (REST paths with HTTP method), `auth_required`, `field_contract` (the contracted field set with types), `tested_against` (Splunk version, integration version, lab tenant date), `experimental: bool`, `references` (links into `_ref/<integration>/field-contract.md`). This is the answer Theme C builds toward.
  - **`/docs/_machine/recipes/index.yaml`** — flat list of every E5 recipe. Schema: `source_pattern`, `layer_id`, `path`, `expected_fields` (list), `verified_against` (Splunk version + sourcetype + lab tenant), `last_verified_iso8601`, `spl_excerpt` (first 200 chars), `status: verified | stretch | broken`. Powers the recipe-matrix table in E5 and is what an agent reads first when asked "show me the recipe for X".
  - **`/docs/_machine/agents.md`** — a short, structured guide for agents operating on the better_map repo itself: "to add a new layer, do X; to add a new formatter option, do Y; here are the BM-CT-1 invariants you MUST preserve; here are the lints that will fail you." Modelled on the emerging `AGENTS.md` convention and on the project's own `.cursor/rules/` patterns.
  - **`/docs/_machine/openapi-better_map-rest.yaml`** — for the parts of better_map that expose Splunk REST endpoints (KV-store bookmarks F1, plugin manifest G6, recipe-test webhook D5), an OpenAPI 3.1 spec. Generated from the modular-input declarations; CI asserts every `/services/...` path used in code appears in the OpenAPI doc.
  - **Cross-rendering:** the MkDocs build pipeline (E2) reads every `_machine/*.yaml` and renders human-friendly tables in the corresponding markdown page. The YAML is the source of truth; the markdown table is generated. Updating prose without updating the YAML is impossible.
  - **License-aware metadata embedded in every machine-readable file:** `# SPDX-License-Identifier: <project licence>` at top of every YAML/JSON, plus a `meta:` block with `version`, `last_modified_iso8601`, `generator`, `source_of_truth_path`. An agent that copy-pastes a recipe knows the licence terms.
* **Prereqs:** E2 (the docs site is what consumes these files), G2 (the CI gate that asserts the generator is run on every PR).
* **Risk:** Machine-readable docs that lie are worse than no machine-readable docs. Mitigation: every `_machine/` file is asserted in D5 against the live Splunk behaviour (e.g., the formatter schema's listed options must round-trip through `display.visualizations.custom.better_map.better_map.<key>`; the integration field-contracts must match `_ref/<integration>/field-contract.md`). Drift fails the build.
* **Accept:** `curl https://better-map.dev/llms.txt` returns a valid llms.txt index; an LLM given just that URL can answer "show me the recipe for plotting Meraki camera positions as markers" by following the index → recipe file. Every formatter option, layer type, integration, and recipe is represented in `_machine/`. CI gates: (a) every option in `formatter.html` ↔ formatter-schema.json; (b) every recipe md file ↔ recipes/index.yaml; (c) every integration with code in `src/lib/splunk/` ↔ integrations/*.yaml.

#### G8. JS↔CSS contract lint (prevent the BM-FIX class of bug) — `S`

> **Status (v1.7-prep, 2026-05-18): G8 SHIPPED.** The JS↔CSS contract
> lint is wired into both `ci.yml` (PR gate, step "Lint (G8 JS↔CSS
> contract)") and `release.yml` (release gate, same step name) via
> `npm run lint:css-contract` →
> `node scripts/lint-js-css-contract.js`. Implementation matches the
> design block verbatim:
>
> - **Forward direction (FAIL-on-violation):** scans `src/lib/**/*.js`
>   for string literals matching `/['"]better_map-[a-z0-9_-]+['"]/g`
>   plus `className =` / `classList.add(` arguments, parses
>   `appserver/static/visualizations/better_map/visualization.css`
>   via PostCSS, computes `MISSING = JS_CLASSES - CSS_CLASSES - ALLOWLIST`,
>   and FAILs the gate on any non-empty `MISSING` with a clear diff
>   and remediation hint.
> - **Reverse direction (WARN-only):** reports `CSS_CLASSES - JS_CLASSES - PSEUDO_CLASS_ALLOWLIST`
>   to surface dead CSS that may be orphaned from a removed widget
>   (feeds G3 upgrade hygiene). The reverse direction is intentionally
>   advisory — a stale rule doesn't break runtime, but a stale class
>   in JS without CSS does.
> - **Allowlist:** `scripts/css-contract-allowlist.json` lists every
>   class that is intentionally inheritance-only or applied as a
>   toggle state (e.g., `better_map-control-panel__toggle--active`),
>   each with a one-line justification.
> - **Performance:** typical PR runs the gate in < 1 s (small CSS file,
>   simple PostCSS visitor); well inside the < 5 s acceptance bar.
>
> - **Closes:** the BM-FIX-01 / BM-FIX-02 regression class. Reverting
>   `visualization.css` to its pre-v1.6.1 state reproducibly fails the
>   lint with the expected missing-class set (acceptance test in the
>   original branch that introduced the gate; the gate has been green
>   continuously since v1.6.2).
> - **What's NOT in G8 (and is correctly out of scope):** classes
>   created via template-literal interpolation
>   (`better_map-${variant}-${state}`) — the scanner recognises the
>   interpolation pattern and degrades to allow-listing the prefix
>   with a wildcard, which keeps the gate from generating false
>   positives at the cost of slightly less coverage on dynamically-
>   composed names. This trade-off is documented in the script
>   header and in the allowlist.
>
> See [`docs/CI-GATES.md`](docs/CI-GATES.md) gate #3 for the
> PR-gate row and the release-gate parity confirmation (gate #3 in
> the release matrix).

* **Problem:** The v1.6.0 release shipped 12 widget root classes and (after v1.6.1) 9 sub-element classes with **zero CSS rules**. The control-panel toggles for those widgets appeared to do nothing, because the widgets rendered behind the absolutely-positioned MapLibre canvas and never received pointer events. Patched in v1.6.1 + v1.6.2, but the *type* of bug is preventable: nothing in the build asserts that a class created by JS has at least one rule in `visualization.css`. Without this check, every new v1.7+ widget can ship the same defect.
* **Design:** Build-time linter `scripts/lint-js-css-contract.js` runs as a G2 PR-pipeline step:
  1. Scan `src/lib/**/*.js` for string literals matching `/['"]better_map-[a-z0-9_-]+['"]/g` plus `className =` / `classList.add(` arguments; collect every class name into a set `JS_CLASSES`.
  2. Parse `appserver/static/visualizations/better_map/visualization.css` (via PostCSS) and collect every class selector into a set `CSS_CLASSES`.
  3. Compute `MISSING = JS_CLASSES - CSS_CLASSES - ALLOWLIST`. The allowlist lives at `scripts/css-contract-allowlist.json` and lists classes that are intentionally inheritance-only or applied as toggle states (e.g., `better_map-control-panel__toggle--active`).
  4. Fail the CI step on any non-empty `MISSING` with a clear diff and remediation hint ("add at least a `position: absolute` rule for `.better_map-foo` or add it to the allowlist with a one-line justification").
  5. Also assert the reverse direction at WARN level: `CSS_CLASSES - JS_CLASSES - PSEUDO_CLASS_ALLOWLIST` flags dead CSS that may be orphaned from a removed widget (feeds G3 upgrade hygiene).
  6. Same check runs against `formatter.html` and the markdown popup templates, since custom-viz formatter chrome also uses `better_map-*` classes.
* **Prereqs:** G2 (need a working CI to host the new step).
* **Risk:** False positives on dynamically-composed class names (`better_map-${variant}-${state}`). Mitigation: the scanner recognises template-literal interpolation and falls back to documenting the prefix in the allowlist with a wildcard.
* **Accept:** CI step runs in < 5 s; zero false positives on the v1.6.2 baseline; introducing a new widget without a matching CSS rule fails the PR with a one-line error; the BM-FIX-01 / BM-FIX-02 regressions are reproducible by reverting `visualization.css` and confirmed to be caught by the lint.

---

## 4. Milestone sequencing

Three milestones, ordered to deliver value early and avoid wasted work. Effort math: **S** = 2 d (S upper bound), **M** = 5 d (midpoint of 3–7), **L** = 14 d (midpoint of 8–20), **XL** = 30 d (conservative for 21+). One full-time engineer = ~4 productive dev-days per calendar week (the other 1 day evaporates to meetings, code review, and slack).

### Milestone v1.7 — "Validate, harden & document" (target: 10–14 calendar weeks)

Goal: prove that v1.6 actually works under real load, close the operational-rigor gap, ship the documentation a diverse-source customer base needs, and earn the right to ship features.

| Item | Theme | Effort (d) |
|---|---|---|
| G2. CI/CD infrastructure (must land first) | G | 5 |
| G8. JS↔CSS contract lint (prevents BM-FIX-class bugs) | G | 2 |
| G1. Security audit + supply-chain hardening | G | 5 |
| G3. Upgrade hygiene + migration tests | G | 2 |
| D1. AppInspect re-cert | D | 2 |
| **D2. Browser compatibility matrix (Phase 1 + Phase 1.5 SHIPPED — formatter.html load test AND visualization.js AMD-require test × chromium + firefox + webkit on Linux; Phase 2 — cross-OS + full `updateView` rendering + live Splunk dashboards — deferred to self-hosted runner decision)** | D | 2 |
| **D3. Accessibility audit (Phase 1 SHIPPED)** | D | 2 |
| **D5. End-to-end test suite (Phase 1 SHIPPED — Docker harness + dispatch test; Phase 2 — Playwright + CI matrix — deferred to self-hosted runner decision)** | D | 5 |
| **D6. Demo data pack & one-click showcase mode (SHIPPED)** | D | 2 |
| C1–C8. Eight Splunk integrations verified | C | 6×S (12) + 2×M (10) = 22 |
| E1. Splunkbase listing | E | 5 |
| **E2. Documentation site (Phase 1 SHIPPED; Phase 2 in progress — formatter, integrations, recipes auto-gen all SHIPPED)** | E | 5 |
| **E5. Per-source setup recipes (the matrix — ~75 cells) (Phase 1 framework SHIPPED + Phase 2 waves 1+2+3+4+5+6+7+8+9+10+11+12 SHIPPED — 38 / ~75 cells, source-pattern coverage 8 / 8 COMPLETE, layer-type coverage 9 / 10; only `indoor` layer remains, blocked on v1.8+)** | **E** | **5** |
| **G7. AI-ingestion-friendly documentation layer (Phase 1 SHIPPED; Phase 2 — `llms.txt` SHIPPED; Phase 2 follow-up — `llms-full.txt` SHIPPED)** | **G** | **5** |
| **Sub-total** | — | **69 d** |
| Buffer (20 % for slip, lab access, surprise scope) | — | **14 d** |
| **Total ≈ 83 dev-days ≈ 20 single-engineer weeks** | — | **10–14 weeks at 2 engineers** |

**Exit criteria:**
- G2 pipeline green on every PR; release workflow tag-triggered and signed (G1).
- **G8 JS↔CSS contract lint green in CI; reverting `visualization.css` to the pre-v1.6.1 state reproducibly fails the lint with the 21 expected missing-class errors.**
- Zero AppInspect failures; AppInspect runs in CI.
- 12 showcases pass on Chrome, Firefox, Safari, Edge × at least one of macOS / Windows / Linux.
- Zero axe-core violations at WCAG AA on every showcase.
- All 8 Splunk integrations smoke-tested against live tenants; field contracts checked in under `_ref/<integration>/field-contract.{md,yaml}` (G7 enforces the .yaml).
- Listed on Splunkbase with ≥ 12 screenshots + 1 video.
- Docs site live with i18n scaffolding (no actual translations yet — that's v1.8).
- **Every ✓ cell in the E5 recipe matrix has a verified `docs/recipes/<source>/<layer>.md` file.**
- **`docs/llms.txt`, `docs/_machine/formatter-schema.json`, and the `_machine/{layers,integrations,recipes}` YAML index are all published and CI-asserted (G7).**
- v1.6 → v1.7 install via REST leaves zero orphan files (G3 asserts).

**What we DO NOT ship in v1.7:** any new feature. This milestone is pure quality + adoption + operational rigor + documentation depth.

### Milestone v1.8 — "Industrialise" (target: 10–14 calendar weeks after v1.7)

Goal: make compute and 3D real, not faked. Localise. Open the door to customer rebranding.

| Item | Theme | Effort (d) |
|---|---|---|
| A1. Web Worker pool for analytics | A | 5 |
| A2. Sprite atlas for 2525 + scenegraph | A | 5 |
| A3. GPU wind/flow particles | A | 14 |
| A4. Layer perf harness | A | 5 |
| A5. Supercluster + H3 worker offload | A | 2 |
| B1. Real glTF scenegraph via deck.gl | B | 14 |
| B2. Terrain source + sky layer | B | 5 |
| D4. Error telemetry (opt-in) | D | 5 |
| G4. i18n / localisation framework | G | 5 |
| G5. Theming tokens | G | 2 |
| E3. Video walkthroughs | E | 2 |
| F1. Shared bookmarks | F | 5 |
| **Sub-total** | — | **69 d** |
| Buffer (20 %) | — | **14 d** |
| **Total ≈ 83 dev-days ≈ 20 single-engineer weeks** | — | **10–14 weeks at 2 engineers** |

**Exit criteria:**
- 100k-point DBSCAN < 5 s with no main-thread task > 16 ms (PerformanceObserver-asserted).
- 100k wind particles at 60 fps on a 2021 MacBook Air M1; CPU fallback verified.
- 500 glTF instances at 60 fps; sprite-mode fallback still works.
- Perf harness in CI; > 20% regression on any (layer × point-count × browser) cell fails the build.
- Three locales shipped (English + 2 picked by §6 Q7).
- Customer-template theme CSS in repo; a contrived rebrand demo lives in the docs site.
- Sentinel customers from E4 (recruited during v1.7) report no perf regressions vs v1.6.

**What we DO NOT ship in v1.8:** raster analytics, story mode, plugin API, collaboration. Those are v2.0 or later.

### Milestone v2.0 — "Differentiate" (target: 16–24 calendar weeks after v1.8)

Goal: ship the capabilities that close the gap to kepler.gl / deck.gl / CARTO / ArcGIS in ways that matter for Splunk customers, and open the project to community contribution.

| Item | Theme | Effort (d) |
|---|---|---|
| B3. Globe projection | B | 5 |
| F2. Story mode (saved view sequences) | F | 14 |
| F3. Raster analytics (NDVI + hillshade only; defer slope + viewshed) | F | 30 |
| F4. Vector-tile authoring tool | F | 30 |
| G6. Plugin / extension API + reference plugin | G | 14 |
| E4. Customer pilot programme (3 reference customers, ongoing) | E | 30 |
| **Sub-total** | — | **123 d** |
| Buffer (25 % — F3, F4, G6 are the highest-risk items in the roadmap) | — | **31 d** |
| **Total ≈ 154 dev-days ≈ 38 single-engineer weeks** | — | **16–24 weeks at 2–3 engineers** |

**Exit criteria for v2.0.0 release:**
- All v1.7 + v1.8 items shipped and stable for ≥ 3 months in production at ≥ 1 reference customer.
- ≥ 3 reference customers willing to be quoted; at least 1 in a regulated vertical (finance / energy / public sector).
- Splunkbase rating ≥ 4.0 with ≥ 25 reviews.
- Perf parity with kepler.gl on the 5 layer types they both support (markers, hex, heat, paths, polygons) at 100k features, measured by A4 harness.
- Documentation site has ≥ 1k monthly uniques (Plausible / GoatCounter; privacy-preserving analytics only).
- At least 1 third-party plugin exists in the wild (signal that G6 contract is usable).
- The version number 2.0.0 is then descriptive of reality, not aspiration.

---

## 5. What better_map will explicitly NOT become

Bounded scope is as important as bold scope. The following are intentionally out of roadmap, even if they look tempting.

| Out-of-scope item | Why | Use instead |
|---|---|---|
| Native iOS / Android app | Splunk Mobile already exists; building a parallel viz runtime there triples surface area without proportional value | Splunk Mobile + Splunk Cloud |
| AR / VR / Apple Vision Pro | No clear customer demand; entire feature category is speculative | n/a |
| GIS authoring (digitise features, edit shapefiles) | Different product category; would compete with ArcGIS Pro | ESRI ArcGIS Pro |
| Routing engine (turn-by-turn directions) | Different product category; better solved by Mapbox Directions or OpenRouteService | Mapbox Directions / Valhalla |
| Real-time multi-user editing (Google-Docs style) | Requires a hosted backend the project does not own | Felt, FigJam |
| 3D city renderer (LoD2 buildings, BIM integration) | Cesium and Mapbox already do this well; not differentiating | Cesium / Mapbox |
| Splunk Dashboard Studio v3 native-plugin port | v3 plugin format is unstable and adds no user value over the AMD path; revisit when the v3 spec stabilises and AMD is actually deprecated | Stay on current AMD registration |
| LLM calls outside Splunk_AI_Assistant_Cloud | Bypassing Splunk's AI boundary is a customer-security violation | Always route through Splunk_AI_Assistant_Cloud |
| Phone-home telemetry to any project-owned endpoint | Customer-data privacy + Splunk Cloud customer norms + project owns no infra (§1a). Even anonymised "usage pings" exfiltrate dashboard topology and use-pattern fingerprints. | D4 opt-in telemetry POSTs to a **customer-owned HEC only**; the URL is a formatter input. There is no default endpoint and no fallback endpoint. Future "tiny anonymous ping" proposals bounce off this row in §5, not at PR-review time. |

---

## 6. Open questions for the project owner

These need an explicit decision before the relevant work-items are scoped. Each is tagged with the work-items it blocks; nothing here is rhetorical.

| # | Question | Blocks | Default if no answer by milestone start |
|---|---|---|---|
| Q1 | **Licence.** Currently MIT per `package.json`. Confirm — or move to Apache-2.0 (explicit patent grant; matters for large-enterprise legal review). | G1, E1, E4 | Stay MIT; re-evaluate when E4 hits a customer who objects. |
| Q2 | **Splunkbase commercial model.** Free MIT, paid commercial, or free-with-paid-support? | E1 | Free MIT for v1.7 listing; paid tier only if E4 pilot customers ask. |
| Q3 | **AppInspect cloud vetting.** Required for Splunk Cloud customers; submission delay is the only cost. Submit at v1.7? | D1, E1 | Submit at v1.7; mark as blocking for E1. |
| Q4 | **Telemetry collector ownership.** D4 ships an opt-in path that never POSTs to a Better Map endpoint. Who documents the customer-side HEC schema — this project or a sibling project? | D4 | This project, in `docs/operations/telemetry-schema.md`. |
| Q5 | **Customer-pilot recruitment.** Who recruits the 3 pilots in E4 — Splunk customer-success, partner SEs, or the project owner directly? | E4 | Project owner direct; backed by partner SE referrals. |
| Q6 | **Backend for collaboration (F5).** Is a hosted websocket fan-out realistic? If yes, who owns it? If no, drop F5 entirely. | F5 | Drop F5 unless a v1.8 customer pilot specifically asks. |
| Q7 | **Localisation target.** v2.0 lands ≥ 3 locales **total** (English is always #1). Pick 2 more from {de, ja, no, fr, es, …}. | G4, E2 | English + de + ja; revisit when E4 pilot vertical is known. |
| Q8 | **Splunk version floor.** Currently 10.2.0. Hold the line, or raise to 10.3 / 10.4 in v2.0? | All Theme A/B items that touch Dashboard Studio APIs | Hold 10.2.0 through v1.8; raise to whatever-is-current-LTS at v2.0 only if a new API materially helps. |
| Q9 | **OT-safety self-test.** Per `ot-safety.mdc` Better Map must not write to Level-0/1/2 OT assets. Should we add an automated scanner (no SOAR action targets Level 0/1/2, no inputs.conf entries targeting OT zones) as a CI gate? | G2, C5 | Yes — add as a `validate-ot-safety.py` CI step under G2. |
| Q10 | **Plugin namespace and registry.** G6 ships a `window.BetterMap.registerLayer` contract. Should plugins ALSO be listed in a central registry (npm tag, Splunkbase tag, project-owned manifest)? | G6 | Central project-owned manifest at `https://better-map.dev/plugins.json` once docs site lands. |

---

## 7. Defensible v2.0 claim — checklist

If, and only if, every box below is true, we can credibly call v2.0 "one of the best web map vizes in the world." The claim should not ship before the boxes do. Each box has either a measurable threshold or a verifiable artefact.

### 7a. Capability

- [ ] All 8 Splunk-platform integrations verified against live tenants (each with `_ref/<integration>/field-contract.{md,yaml}` checked in — both formats, kept in sync by G7 generator)
- [ ] Spatial analytics on a worker pool; 100k-point DBSCAN < 5 s, no main-thread task > 16 ms (PerformanceObserver-asserted)
- [ ] GPU wind/flow particles; 100k particles at 60 fps on a 2021 MacBook Air M1
- [ ] Real glTF scenegraph; 500 instances at 60 fps; sprite fallback still works
- [ ] MIL-STD-2525 sprite-atlas; 10k symbols < 200 ms first paint; heap delta over 100 updates ≤ 5 MB
- [ ] Terrain + sky + (optional) globe projection toggleable without re-init
- [ ] Raster analytics: at least NDVI + hillshade
- [ ] Plugin / extension API frozen at `v1`; ≥ 1 third-party plugin lives in the wild; the plugin contract fits inside the runtime envelope (§1a)
- [ ] Three locales shipped; locale switch in Splunk Web swaps strings without page reload
- [ ] Customer-template theme CSS in repo; locked status palette enforced
- [ ] Runtime envelope (§1a) verified: viz renders in BOTH Dashboard Studio v2 AND classic SimpleXML / SWF; feature-detection in place; degraded behaviour documented for Splunk Mobile

### 7b. Quality

- [ ] AppInspect cloud-cert green on Splunkbase (blocked on E1); **AppInspect runs in CI on every PR** ✅ (G2-2 / D1 SHIPPED: PR-gate cloud+future tags, release-gate adds `--fail-on-warnings`; 0/0/0/0 baseline as of v1.6.2; see [`docs/CI-GATES.md`](docs/CI-GATES.md) gate #19 — PR + release)
- [~] Browser matrix green: Chrome / Firefox / Safari / Edge × macOS / Windows / Linux (12 cells, all green) — **Phase 1 + Phase 1.5 ✅** (`scripts/check-browser-compat.js` loads BOTH `formatter.html` AND the `visualization.js` AMD bundle in headless Chromium + Firefox + WebKit via Playwright on every PR; covers the three engine families that account for ~99 % of real browsers AND catches the "webpack target slipped to ES2020+" bundle-level regression class via an AMD `define()` shim with mocks for the two Splunk SDK externals); Phase 2 — cross-OS matrix + full-rendered `updateView` test + the 12 showcase dashboards rendered against a live Splunk container — deferred to the self-hosted-runner decision in §3 D5. Customer-facing matrix lives at `docs/COMPAT-MATRIX.md`
- [~] WCAG 2.2 AA conformance verified — **Phase 1 ✅** (`scripts/check-accessibility.js` runs axe-core on `formatter.html` as a PR gate, 0 violations / 0 incomplete; legacy `highContrast` duplicate + orphan `mapLabelLanguage` removed); Phase 2 (showcase dashboards under D5) and Phase 3 (manual VoiceOver + NVDA, pre-E1) still pending
- [ ] Telemetry path documented; zero data leaves by default; HEC schema published
- [ ] No regression of the v1.5.2 BM-CT-1 contract (all controls expose `setEnabled / isEnabled / reset`)
- [ ] **JS↔CSS contract lint (G8) green: every class created in `src/lib/**/*.js` has a rule in `visualization.css` or an allowlist entry; reverting to the v1.6.0 stylesheet reproducibly fails the lint** ✅ (G8 SHIPPED; PR-gate + release-gate parity confirmed by the G2 close-out audit — see [`docs/CI-GATES.md`](docs/CI-GATES.md) gate #3)
- [ ] **Dashboard XML/JSON parse check green: every `default/data/ui/views/*.xml` parses, every embedded JSON definition parses** ✅ (Q-1, PR #2)
- [ ] **Dashboard ↔ widget token contract green: every `$better_map.*$` token referenced by a dashboard has a matching string-literal producer in `src/lib/**/*.js`** ✅ (Q-1B, defends against SPATIAL-1 regression class)
- [~] **Dashboard SPL dispatch test green: every Dashboard Studio `ds.search` query completes against a live splunkd with zero error/fatal messages — Phase 1 ✅** (D5 Phase 1 — Docker-Compose Splunk harness at `docker/`, maintainer-driven gate via `bash docker/scripts/bootstrap.sh && python3 scripts/dispatch-test.py`, 66 queries across 13 dashboards as of cut; full CI integration is Phase 2 — deferred to the self-hosted-runner decision in the §3 D5 risk note)
- [ ] **Release manifest matches source tree (G3): `default/_better_map_manifest.json` checked in; `scripts/check-manifest.py` CI gate PR-blocking; operator runbook `scripts/find-orphans.sh` SSHes into a deployed install and reports orphans (grouped + size-summed) — verified against `rev` 2026-05-17 with 50,994 orphan files / 667 MiB surfaced (see §1c gap 18 + verification table)** ✅ (G3 Phase 1)
- [ ] **Production-bundle console-noise check green: no unallowlisted `console.warn` / `.error` / `.debug` in the minified `visualization.js`** ✅ (Q-2; PR-gate + release-gate parity — see [`docs/CI-GATES.md`](docs/CI-GATES.md) gate #16)
- [ ] **CI gate inventory documented and PR-gate ↔ release-gate parity audited and asserted** ✅ (G2 close-out audit, this PR): every check that runs on PR also runs on every `v*` tag push (or has a documented exemption in `docs/CI-GATES.md` "Known gaps"). Three previously-missing release-gate runtime checks (Vitest, D3 axe-core, D2 browser-compat Phase 1 + Phase 1.5) closed in the same audit. See [`docs/CI-GATES.md`](docs/CI-GATES.md) for the full ~30-gate matrix
- [ ] Perf parity with kepler.gl on the 5 layer types they both support, measured by A4 harness
- [ ] E2E flake rate < 2 % over rolling 30-PR window
- [ ] v(N-1) → vN upgrade test green (zero orphan files left behind) (G3 Phase 2 — D5 harness)

### 7c. Performance budgets

- [ ] `visualization.js` raw on disk ≤ **3.0 MB** (v1.6 baseline: 2.23 MB)
- [ ] `visualization.js` gzipped over the wire ≤ **800 KB** (v1.6 baseline: 576 KB)
- [ ] Cold-start to first map paint ≤ **2.0 s** on a 2021 MacBook Air M1 over localhost
- [ ] Steady-state JS heap on the largest showcase ≤ **150 MB** after 5 min of typical interaction
- [ ] Direct runtime npm deps ≤ **18** (v1.6 baseline: 11)
- [ ] Transitive deps in `node_modules` ≤ **350** (v1.6 baseline: 228)

#### 7c-widget. Per-widget interactivity budgets (added in revision 4 after the BM-FIX episode)

> Cold-start budgets above measure "viz loads in a panel." These per-widget budgets measure "user toggles a v1.6 widget on and uses it." They are asserted by the D5 harness with Playwright timing APIs.

- [ ] **Floating overlay widgets** (geocoder, minimap, draw, measure, lasso, side-by-side, time-split, spatial-query, brush-ring): control-panel toggle-click → widget visible AND accepting pointer events ≤ **300 ms** on a 2021 MacBook Air M1
- [ ] **Modal widgets** (command palette ⌘K): keyboard shortcut → modal painted, input focused, first character accepted ≤ **500 ms**
- [ ] **Drag-driven widgets** (side-by-side compare handle, time-split divider): handle mousedown → first frame of follow-cursor render ≤ **1 frame (16 ms)** at 60 fps
- [ ] **Scrubber playback**: play-button click → first scrubber-tick advance and map filter update ≤ **150 ms**; sustained 60 fps during 30 s playback at 100k features
- [ ] **Per-widget steady-state memory**: enabling every v1.6 widget simultaneously adds ≤ **30 MB** to the JS heap delta vs all-widgets-off (asserted by `performance.memory.usedJSHeapSize` snapshot before/after)
- [ ] **Reset budget (BM-CT-1)**: control-panel reset-button click → all enabled widgets disabled AND map state restored to initial ≤ **400 ms**, with zero retained DOM nodes referenced from the v1.6 widget classes (heap-snapshot diff)

### 7d. Security & supply chain

- [x] CycloneDX SBOM published with every release (G1 — `better_map-vX.Y.Z.sbom.json`, CycloneDX 1.6, 186 components on v1.7-prep)
- [x] All releases signed via `cosign` (Sigstore); offline verification documented (G1 — keyless Fulcio + Rekor; verification in `docs/runbooks/supply-chain.md`)
- [x] Zero `npm audit` findings at `high`+; waivers (if any) have ≤ 90-day expiry (G1 — `scripts/check-npm-audit.py`, waivers in `scripts/npm-audit-waivers.json`, 90-day cap enforced)
- [x] Licence-allowlist clean: every direct + transitive dep on MIT / BSD / Apache-2.0 / CC0 / ISC (G1 — `scripts/check-license-allowlist.py` + `scripts/license-allowlist.json`; 186-component runtime tree passes)
- [x] Dependabot enabled; weekly auto-PRs merging on CI green (G1 — `.github/dependabot.yml`, runtime + dev grouped, plus github-actions ecosystem)
- [ ] OT-safety scanner green (no SOAR action targets Level-0/1/2; no inputs.conf to OT zones)

### 7e. Distribution & community

- [ ] Listed on Splunkbase; ≥ 25 reviews; ≥ 4.0 average
- [ ] ≥ 3 named reference customers willing to be quoted; ≥ 1 in a regulated vertical
- [~] Documentation site live; ≥ 1k monthly uniques (privacy-preserving analytics) — **Phase 1 ✅** (`mkdocs.yml` + 11 hand-authored pages under `docs/`, strict-mode CI gate `docs-build` in `ci.yml`, GitHub Pages auto-deploy on `main` via `.github/workflows/docs.yml`, published at `fenre.github.io/better_map/`, air-gap-clean per §1a: no Google Fonts, no third-party scripts); **Phase 2 in progress** — formatter reference page now carries an auto-generated 82-option enumeration (16 tables, all `(tab, heading)` buckets) regenerated from `docs/_machine/formatter-schema.json` by `scripts/build-reference-pages.py` and drift-gated in CI; still pending: auto-generated sections inside `docs/integrations/catalogue.md` and `docs/recipes/index.md`, custom domain, privacy-preserving analytics, ≥ 1k monthly uniques target
- [~] **Per-source recipe matrix (E5) ≥ 75 verified ✓ cells published; CI gates that a new layer or new source cannot land without updating the matrix** — **Phase 1 ✅ + Phase 2 waves 1+2+3+4+5+6+7 ✅** (framework: `docs/_machine/recipes/recipe-schema.json` JSON Schema 2020-12, `scripts/check-recipe-schema.py` validator + drift gate, `scripts/build-recipe-index.py` index emitter, `docs/_machine/recipes/index.yaml` machine-readable index, CI gate in `ci.yml docs-build` job; twenty-four recipes shipped covering 8 / 8 source patterns (COMPLETE pattern coverage — every `source.pattern` enum value now has at least one recipe) and 9 / 10 layer types — CIM Alerts → markers, CIM Network Traffic → markers, CIM Network Traffic → paths, CIM Network Traffic → H3 hexbin, CIM Authentication → markers, CIM Authentication → heatmap, CIM Performance → markers, KV Store → markers, KV Store → heatmap, US states → choropleth, US states → 3D extrusion, Splunk Stream → markers, NetFlow / sFlow / IPFIX → H3 hexbin, CSV-lookup-geo → polygons, CSV-lookup-geo → supercluster, CSV-lookup-geo → H3 hexbin, CSV-lookup-geo → vector-tile join, Cisco Meraki → markers, Cisco Meraki → H3 hexbin, Cisco Cyber Vision → markers, Cisco ThousandEyes → paths, ES Risk-Based Alerting → markers, ITSI service health → markers, OT Datastreamer / Edge Hub → markers — all `status: unverified` pending live-Splunk REST access against a tenant carrying the appropriate sourcetype and licence); the remaining ~51 ✓ cells fill in as subsequent waves at 3-5 recipes per PR. Only 1 of 10 layer types remains undemonstrated: `indoor` (blocked on v1.8+ image-overlay layer kind)
- [x] **`docs/llms.txt` published per the llms.txt convention; an LLM given just the URL can locate and apply a recipe end-to-end** — SHIPPED in v1.7-prep (G7 Phase 2). `docs/llms.txt` is regenerated by `scripts/build-llms-txt.py` from `mkdocs.yml` `nav:`, `docs/_machine/recipes/index.yaml`, `docs/_machine/integrations/*.yaml`, and `docs/_machine/formatter-schema.json`. MkDocs copies it verbatim to `site/llms.txt`; the published URL is <https://fenre.github.io/better_map/llms.txt>. Drift-gated in CI by `scripts/build-llms-txt.py --check`. The end-to-end "agent given the URL → finds a recipe → applies it" flow now works for the three E5 Phase 1 starter recipes
- [~] **`docs/_machine/` complete: formatter JSON Schema, per-layer YAML, per-integration YAML, recipes index, `agents.md`, OpenAPI for any exposed REST endpoint — each CI-asserted against the implementation it documents** — Phases 1 + 2 partially shipped in v1.7-prep (G7 + E5 + E2): formatter-schema.json (82 options, drift + coverage gates + D3 axe-core a11y), 8 × integrations/*.yaml, agents.md, README.md, recipe-schema.json + recipes/index.yaml (E5 Phase 1 — drift-gated, three starter recipes), llms.txt + build-llms-txt.py (G7 Phase 2 — drift-gated), llms-full.txt + build-llms-full-txt.py (G7 Phase 2 follow-up — body-inclusive sibling, drift-gated + hard 200k-estimated-token budget), build-reference-pages.py (E2 Phase 2 — managed-region regenerator now driving THREE managed regions: the 82-option enumeration in `docs/reference/formatter.md`, the 8-row integrations matrix + endpoint detail in `docs/integrations/catalogue.md`, AND the recipes matrix in `docs/recipes/index.md`, all three drift-gated; all original E2 Phase 2 auto-gen targets shipped); still open: per-layer YAML (layers/*.yaml), OpenAPI (blocked on REST endpoints in v1.8+)
- [ ] 6 video walkthroughs published with English + at least one other locale captions
- [ ] Repo history: ≥ **50 commits** from ≥ **3 distinct contributors** (replaces the previous draft's "multi-year history" handwave with something actionable)
- [ ] Public roadmap board (GitHub Projects) with at least the next minor's work-items tracked

Until **every** box in 7a–7e is true, the version that ships is `1.x`. v2.0.0 is reserved.

---

## 8. Risk register (top 10)

Cross-theme risks worth surfacing once instead of buried in individual work-items. Owner = whoever inherits the work-item when scheduled.

| # | Risk | Likelihood | Impact | Trigger condition | Mitigation | Owner |
|---|---|---|---|---|---|---|
| R1 | Splunk Cloud CSP blocks Web Workers, breaking A1 / A5 | Medium | High (Theme A blocked) | Worker creation fails in a Splunk Cloud trial tenant | Ship a `requestIdleCallback`-paced single-threaded fallback; feature-detect at boot | A1 owner |
| R2 | ITSI / SOAR / ES lab access unavailable when C-items are scheduled | High | High (Theme C delayed by calendar time, not effort) | No lab tenant by v1.7 week 4 | Time-box discovery; ship affected modules behind `experimental` flag; openly document the gap | C1–C8 owners |
| R3 | Splunk Engineering partnership for F5 (collaboration websocket) does not materialise | High | Low (F5 already marked draft-deferred) | No partnership confirmed by v2.0 scoping | Drop F5; document the gap in §5 "explicitly NOT" | F5 owner |
| R4 | deck.gl + MapLibre interop breaks on a future MapLibre release (B1) | Medium | High (3D fidelity claim regresses) | A4 perf harness shows regression after dep bump | Pin verified versions; gate dep bumps on the harness; consider vendoring the deck.gl ↔ MapLibre adapter | B1 owner |
| R5 | Transitive npm dep introduces a copyleft licence | Low | High (legal blocker for E1, E4) | G1 licence scan flags a dep | Remove the offending tree, vendor a fork, or replace the parent dep — handle in week 1 of v1.7 | G1 owner |
| R6 | Customer pilot churn (E4) reduces reference-customer count below 3 | Medium | Medium (delays v2.0.0 exit criterion) | < 3 active pilots at v2.0 scoping | Over-recruit (target 5 pilots, accept losing 2) | E4 owner |
| R7 | AppInspect rejects a new dep added in v1.8 (deck.gl, geotiff.js) | Medium | Medium (delays G1 + E1 re-cert) | AppInspect CI step fails after a Theme A/B/F item lands | Run AppInspect on a throwaway branch BEFORE merging any new dep | G1 + G2 owner |
| R8 | Bundle-size budget breach after deck.gl + glTF + geotiff land | Medium | Medium (degrades cold-start UX) | A4 harness shows gzipped bundle > 800 KB | Code-split heavy layers into AMD-loaded chunks; lazy-load on formatter-flag enable | A4 owner |
| R9 | Splunk deprecates the classic AMD `SplunkVisualizationBase` registration in favour of the Dashboard Studio v3 native-plugin spec | Low (today) → Medium (24 mo) | High (every layer must be re-registered; G6 plugin contract must be redesigned) | Splunk releases an EA / GA for the v3 plugin spec; AMD path appears on a deprecation timeline | Monitor Splunk dev.splunk.com release notes; keep `_ref/splunk-custom-visualizations/` reference apps current; when EA lands, schedule a parallel v3-native registration path under a `v2RuntimeV3` flag — do NOT remove the AMD path until usage telemetry (D4) shows < 5 % on the old runtime | G6 owner |
| R10 | E5 recipe matrix grows past maintainability (75 cells become 200 as customers ask for more sources) | High over 24 mo | Medium (doc rot is the leading indicator of project decline) | Reviewer can't keep recipes verified-current; ≥ 30 % of `_machine/recipes/index.yaml` entries are > 12 months old | Move recipe validation into D5 (automated re-verification weekly); auto-mark stale recipes with a warning banner; recipe contributions from pilot customers (E4) treated as first-class PRs | E5 owner |
| R11 | Splunkweb host config drifts between releases (protocol HTTP↔HTTPS, port, web SSO redirect, Splunk Cloud CDN-prefix on static assets, browser cache stale after build bump) — observed live on the 2026-05-16 v1.6.2 deploy when `rev` silently switched to HTTPS on port 8000 mid-session | Medium (per-tenant config drift is normal); High over 24 mo | Medium (deploy / smoke scripts silently fail; verification reports a green build that the user can't actually load) | A REST install returns 200 but a follow-up `curl -fsS http://<host>:8000/...` returns 000 / connection reset / unexpected redirect | Every release pipeline step (G2 + D5) MUST probe protocol+port via `nc -z` and a TLS-handshake check before asserting static-asset bytes; never hardcode `http://` in deploy scripts; on byte-size assertion failure, also dump the served `Content-Type`, `Content-Encoding`, and first 200 bytes for diagnosis; document the auto-detect logic in `scripts/deploy/README.md` | G2 owner |

---

## 9. Document maintenance

This is a planning document, not a contract. It will go stale if not actively reviewed.

* **Review cadence:** at each milestone boundary (start of v1.7, mid-point of v1.7, start of v1.8, etc.) plus quarterly for everything else.
* **Drift triggers — re-read this doc immediately when any of these happen:**
  - A pilot customer (E4) reports a use case not represented in §3.
  - A leader in the global tier (kepler.gl, deck.gl, CARTO, ArcGIS, Felt) ships a feature that changes the competitive landscape — re-evaluate §1b baseline and §5 "out of scope."
  - An open question in §6 gets answered — move it to a one-line note in the relevant work-item and renumber.
  - A risk in §8 materialises — move it to a "lessons learned" appendix; do not silently delete.
  - SemVer breakage in MapLibre, deck.gl, or any AMD-loaded dep — re-evaluate Theme A and B work-items.
  - **Dashboard Studio API surface changes** (new visualization extension model, v3 plugin EA/GA, deprecation of `SplunkVisualizationBase`, CSP tightening, new global token namespace) — re-evaluate §1a runtime envelope, R9, and every formatter-touching work-item.
  - **A new common Splunk data-source pattern lands at a pilot customer** (e.g., a vendor we don't yet have a recipe for) — add a row to the E5 matrix and a `_machine/recipes/<source>/<layer>.yaml` entry.
  - **The `llms.txt` standard or `AGENTS.md` convention evolves** — G7 specs may need an update to stay current with what agents actually consume.
* **Ownership:** the roadmap is owned by the project owner (per §6). Per-theme owners are anointed at milestone scoping; the table in §8 names them by work-item.
* **Change log for this document:** maintained as a regular section at the bottom of this file (add one bullet per substantive edit; reverts count as edits).

### 9a. ROADMAP.md change log

* 2026-05-16 (revision 4) — applied the six post-BM-FIX improvements before v1.7 implementation kick-off. §1c gained gap-14 (JS↔CSS contract has no automated check — root cause of v1.6.0 → v1.6.1 → v1.6.2 patch chain) and gap-15 (splunkweb protocol drift observed mid-deploy); §1c verification table gained a v1.6.2 re-deploy row capturing the protocol switch from HTTP to HTTPS on port 8000. §3 Theme G grew G8 (JS↔CSS contract lint, S effort) with explicit acceptance criteria reproducing the BM-FIX regressions. §4 v1.7 milestone bumped 65 → 67 dev-days, buffer 13 → 14, total 78 → 81 (≈ 20 single-engineer weeks; calendar slot unchanged). §G2 PR pipeline gained 3 new CI gates (G8 contract lint, dashboard XML/JSON parse check, production-bundle console-noise check). §5 negative-commitments table gained the no-phone-home row (codifies that better_map never POSTs to a project-owned endpoint, even anonymised). §7b Quality gained 3 boxes (G8 lint green, XML/JSON parse, console-noise); §7c gained a new sub-section "7c-widget" with 6 widget-level interactivity budgets (overlay ≤ 300 ms, modal ≤ 500 ms, drag ≤ 16 ms, scrubber ≤ 150 ms, memory delta ≤ 30 MB, reset ≤ 400 ms). §8 risk register grew to 11 (added R11 host config drift). v1.7 exit criteria gained the G8-reproducibility check.
* 2026-05-16 (revision 3) — declared the runtime envelope as §1a (Dashboard Studio v2 primary, SWF stretch, all source data from Splunk, CSP and AMD bounds spelled out); refocused E2 onto docs infrastructure only; added E5 per-source recipe matrix (15 source patterns × 10 layer types, ~75 ✓ cells for v1.7); added G7 AI-ingestion-friendly documentation (llms.txt, JSON Schemas, per-layer/integration/recipe YAML, agents.md, OpenAPI); v1.7 milestone retitled "Validate, harden & document", effort raised 55 → 65 d, 8–12 wk → 10–14 wk; §7a/§7e checklist boxes added for runtime envelope verification and AI-ingest deliverables; §8 risk register grown to 10 (added R9 Dashboard Studio v3 deprecation risk, R10 recipe-matrix doc-rot risk); §9 drift triggers gained Dashboard Studio API change + new source pattern + llms.txt/AGENTS.md convention evolution.
* 2026-05-16 (revision 2) — v1.6 deploy completed on `rev` (Splunk Enterprise 10.2.3); §1 baseline updated to reflect the verified facts; Theme G (Operational rigor) added with 6 work-items; §4 milestone effort recalibrated with explicit dev-day math; §6 questions consolidated to 10 and tightened; §7 split into capability / quality / budgets / security / distribution buckets; §8 risk register and §9 maintenance section added.
* 2026-05-15 (initial) — draft authored after the v1.6 self-assessment; six themes (A–F), three milestones (v1.7 / v1.8 / v2.0), 28 work-items.

---

*This roadmap is a planning document and supersedes no shipped artifact. It does not bump any version, alter any release, or promise any timeline beyond rough engineering estimates. Any of these items may be re-scoped or dropped based on customer feedback. The v2.0 label is the **consequence** of completing this plan, not the goal.*
