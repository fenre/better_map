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

* **Problem:** Last precert against v1.0.x. AppInspect catches dozens of issues (.DS_Store, missing default.meta entries, restmap.conf misconfig, insecure HTTP) that have been re-introduced repeatedly in v1.1 → v1.6.
* **Design:** Install `splunk-appinspect` via pip. Run with `--mode precert --included-tags=cloud,future` against `dist/better_map-1.6.0.tar.gz`. Fix every failure. Add as a CI step.
* **Prereqs:** None.
* **Accept:** Zero failures, zero manual-check items.

#### D2. Browser compatibility matrix — `S`

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
| D2. Browser compatibility matrix | D | 2 |
| **D3. Accessibility audit (Phase 1 SHIPPED)** | D | 2 |
| D5. End-to-end test suite (dispatch + Playwright) | D | 5 |
| **D6. Demo data pack & one-click showcase mode (SHIPPED)** | D | 2 |
| C1–C8. Eight Splunk integrations verified | C | 6×S (12) + 2×M (10) = 22 |
| E1. Splunkbase listing | E | 5 |
| **E2. Documentation site (Phase 1 SHIPPED; Phase 2 in progress — formatter, integrations, recipes auto-gen all SHIPPED)** | E | 5 |
| **E5. Per-source setup recipes (the matrix — ~75 cells)** | **E** | **5** |
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

- [ ] AppInspect cloud-cert green on Splunkbase (blocked on E1); **AppInspect runs in CI on every PR** ✅ (G2-2: PR-gate cloud+future tags, release-gate adds `--fail-on-warnings`; 0/0/0/0 baseline as of v1.6.2)
- [ ] Browser matrix green: Chrome / Firefox / Safari / Edge × macOS / Windows / Linux (12 cells, all green)
- [~] WCAG 2.2 AA conformance verified — **Phase 1 ✅** (`scripts/check-accessibility.js` runs axe-core on `formatter.html` as a PR gate, 0 violations / 0 incomplete; legacy `highContrast` duplicate + orphan `mapLabelLanguage` removed); Phase 2 (showcase dashboards under D5) and Phase 3 (manual VoiceOver + NVDA, pre-E1) still pending
- [ ] Telemetry path documented; zero data leaves by default; HEC schema published
- [ ] No regression of the v1.5.2 BM-CT-1 contract (all controls expose `setEnabled / isEnabled / reset`)
- [ ] **JS↔CSS contract lint (G8) green: every class created in `src/lib/**/*.js` has a rule in `visualization.css` or an allowlist entry; reverting to the v1.6.0 stylesheet reproducibly fails the lint**
- [ ] **Dashboard XML/JSON parse check green: every `default/data/ui/views/*.xml` parses, every embedded JSON definition parses** ✅ (Q-1, PR #2)
- [ ] **Dashboard ↔ widget token contract green: every `$better_map.*$` token referenced by a dashboard has a matching string-literal producer in `src/lib/**/*.js`** ✅ (Q-1B, defends against SPATIAL-1 regression class)
- [ ] **Release manifest matches source tree (G3): `default/_better_map_manifest.json` checked in; `scripts/check-manifest.py` CI gate PR-blocking; operator runbook `scripts/find-orphans.sh` SSHes into a deployed install and reports orphans (grouped + size-summed) — verified against `rev` 2026-05-17 with 50,994 orphan files / 667 MiB surfaced (see §1c gap 18 + verification table)** ✅ (G3 Phase 1)
- [ ] **Production-bundle console-noise check green: no unallowlisted `console.warn` / `.error` / `.debug` in the minified `visualization.js`**
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
- [~] **Per-source recipe matrix (E5) ≥ 75 verified ✓ cells published; CI gates that a new layer or new source cannot land without updating the matrix** — **Phase 1 ✅** (framework: `docs/_machine/recipes/recipe-schema.json` JSON Schema 2020-12, `scripts/check-recipe-schema.py` validator + drift gate, `scripts/build-recipe-index.py` index emitter, `docs/_machine/recipes/index.yaml` machine-readable index, CI gate in `ci.yml docs-build` job; three starter recipes shipped — CIM Network Traffic → markers, KV Store → markers, US states → choropleth — all `status: unverified` pending live-Splunk REST access); the remaining ~72 ✓ cells fill in as a maintainer with `secrets.env` against `rev` adds them
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
