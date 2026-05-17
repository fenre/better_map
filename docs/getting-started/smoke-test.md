---
title: Smoke test
description: >-
  30-second smoke test that confirms Better Map installed cleanly and
  is ready to receive your real searches.
---

# Smoke test

After installing Better Map (see [Install](index.md)), run this
30-second smoke test before pointing the viz at any production search.
Every step here is a single Splunk Web click or one keyboard shortcut.

## 1. Open a built-in showcase dashboard

The app ships **twelve** preset Dashboard Studio dashboards, all
namespaced under the `better_map` app:

| Dashboard | What it exercises |
|---|---|
| `better_map_smoke_test` | The minimum render path (no field overrides, no integrations). |
| `better_map_showcase_basemap` | The seven supported tile providers (OpenFreeMap, OpenStreetMap raster, MapTiler Streets / Topo, Stadia OSM Bright / Alidade Smooth, custom). |
| `better_map_showcase_clusters` | Cluster + heatmap + H3 hexbin + density-clustering. |
| `better_map_showcase_choropleth` | Vector-tile feature join + 3D extrusion + diverging palettes. |
| `better_map_showcase_time` | Time scrubber, comet trail, anomaly bands, multi-panel sync. |
| `better_map_showcase_drilldown` | Cross-panel `$better_map.spatial_query$` token coordination. |
| `better_map_showcase_indoor` | Indoor floor-plan overlay + image georeferencing. |
| `better_map_showcase_overlays` | KML / WMS / scenegraph / wind-field / geofence. |
| `better_map_showcase_milstd` | MIL-STD-2525C + APP-6 symbology. |
| `better_map_showcase_widgets` | Geocoder, ⌘K palette, minimap, draw tools, measure, lasso, brushing, compare, spatial query, time-window split, markdown popup. |
| `better_map_showcase_splunk` | The eight Splunk integrations (MITRE, ES notable, ITSI, SOAR, RBA, Purdue, A&I geo, AI Assistant). |
| `better_map_showcase_perf` | Bundle-size budget, perf HUD, error states, debug HUD. |

For the smoke test, open `better_map_smoke_test`.

## 2. Verify the render

You should see, within ~2 seconds of opening the dashboard:

- [x] A pan-and-zoomable basemap (OpenFreeMap Positron by default).
- [x] At least one point rendered at the search-result location.
- [x] The three BM-CT-1 controls in the bottom-right (pause/reset/disable).
- [x] Zero entries in the browser console at severity `error` (a few
      `[better_map] info` lines are expected; see
      [Q-2](../runbooks/supply-chain.md) for the console-noise
      contract).

## 3. Confirm bundle integrity

In Splunk Web, browse to:

```
/static/app/better_map/visualizations/better_map/visualization.js
```

You should see a webpack-bundled file that starts with `define([...],
function(` (NOT an arrow function — Splunk's AMD loader requires ES5
output). The file size should be ~2.2 MB raw / ~570 KB gzip (see the
[bundle-size budget](https://github.com/fenre/better_map/blob/main/scripts/check-bundle-size.js)
for the authoritative limits).

If the file is missing or shows the previous bundle's content, the
Splunk 10.2 static-asset cache hasn't flushed yet. Run
`/services/server/control/restart_webui_polite` from a Splunk CLI
session, or a full `splunkd` restart.

## 4. Run the dispatch test (optional, but recommended)

A lightweight pre-flight scans every showcase dashboard's SPL and
fails on any fatal/error from Splunk's search dispatcher. This is the
fastest way to catch a "showcase shipped with a regressed search":

```bash
ssh <splunk-host>
sudo -u splunk /opt/splunk/bin/splunk search \
  "| rest /services/saved/searches | search eai:acl.app=better_map \
     | search name=*showcase*" \
  -auth admin:CHANGE_ME -output rawxml
```

A future v1.7 PR will wire this into CI via the
[D5 end-to-end test suite](../roadmap.md), gated on the Docker-compose
harness being ready.

## What to do if the smoke test fails

| Symptom | Most likely cause | Where to look |
|---|---|---|
| Grey panel, no basemap | Splunk Web cached the old bundle | restart_webui_polite |
| Console error `splunk.custom is not defined` | `visualizations.conf` is using `schemaVersion = 3` keys; Better Map is AMD-style v2 | See `docs/_machine/agents.md` non-negotiable #3 |
| Map renders but tile provider returns 404 | Tile API key missing / CORS rejecting the host | See [Air-gapped deployment](../air-gapped.md) for the PMTiles fallback |
| BM-CT-1 controls absent | Controls have been hidden via formatter option `showMapControls=false` | Re-enable in the formatter |
| Bundle size > 3.0 MB | Webpack `mode: 'development'` shipped by mistake | Re-build with `npm run build` (NOT `npm run dev`) |

For everything else, open an issue:
[https://github.com/fenre/better_map/issues](https://github.com/fenre/better_map/issues).
