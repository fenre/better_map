---
title: Getting started
description: >-
  Install Better Map on Splunk Enterprise (or Splunk Cloud) and verify
  the viz renders before you wire it into your dashboards.
---

# Getting started

Better Map is a Splunk **custom visualization** that registers itself
as a viz type in **Dashboard Studio** (`version="2"`) and Simple XML
dashboards. It ships as a standard Splunk app tarball with a single
MIT-licensed JavaScript bundle, twelve preset dashboards, and a
machine-readable formatter schema for AI-assisted authoring.

## Requirements

| Component | Version |
|---|---|
| Splunk Enterprise | 10.2 or later |
| Dashboard format | Dashboard Studio (`version="2"`); Simple XML also supported |
| Browser | Chrome 90+ / Edge 90+ / Firefox 88+ / Safari 14+ |
| WebGL | Required (the viz shows a graceful fallback banner otherwise) |

## Install from Splunkbase (recommended)

!!! warning "Splunkbase listing pending"

    Splunkbase publication is tracked under ROADMAP item **E1** and is
    blocked on the v1.7 AppInspect re-certification (**D1**). Until E1
    lands, use the **install from file** flow below — the tarball
    ships with the same AppInspect-clean payload.

Once available:

1. Splunk Web → :material-apps: **Apps → Find more apps**.
2. Search for `better_map`.
3. Click **Install**, accept the licence, and let Splunk restart.

## Install from a release tarball

1. Download the latest `better_map-vX.Y.Z.tar.gz` from the
   [GitHub releases page](https://github.com/fenre/better_map/releases).
   Every release tarball is accompanied by:

    - A **CycloneDX 1.6 SBOM** (`better_map-vX.Y.Z.sbom.json`) listing
      every npm dependency in the runtime tree.
    - A **cosign keyless signature** (`better_map-vX.Y.Z.tar.gz.sig`
      + `.crt`) you can verify against the GitHub Actions OIDC
      identity. See the
      [supply-chain runbook](../runbooks/supply-chain.md) for the
      verification recipe.

2. Splunk Web → :material-apps: **Manage Apps → Install app from file**
   → upload the tarball → confirm.

3. **Splunk 10.2.x quirk:** a `restart_webui_polite` (or full `splunkd`
   restart) is required to flush Splunk Web's in-memory static-asset
   cache. Otherwise the previous bundle may keep being served until
   the next process restart.

4. The **Better Map** entry appears in the app launcher. Open it and
   click any of the twelve preset dashboards to verify the viz
   renders.

## Build from source

For development, customisation, or air-gapped builds:

```bash
git clone https://github.com/fenre/better_map.git
cd better_map/better_map/appserver/static/visualizations/better_map
npm ci
npm run build
# The webpack production bundle is written in place.
```

A repo-root convenience script (`./build.sh`) wraps the same flow and
also produces a Splunk-shaped tarball under `dist/` for direct
upload.

## Verify the install

Run the [smoke-test dashboard](smoke-test.md). It exercises the
following critical paths in under 30 seconds:

- The webpack bundle loads (no console errors).
- A trivial `index=_internal | head 1` search returns a row.
- The map renders the OpenFreeMap Positron basemap (default tile
  provider — no API key required).
- The BM-CT-1 controls (`setEnabled` / `isEnabled` / `reset`) are
  present and respond to clicks.

If any of those fail, see the [supply-chain
runbook](../runbooks/supply-chain.md) and the [upgrade-hygiene
runbook](../runbooks/upgrade-hygiene.md) for the most common
troubleshooting recipes.

## Next steps

- Read the [Runtime envelope](../runtime-envelope.md) to understand
  what the viz can and cannot do (this is binding — agents and
  contributors must respect it).
- Browse the [Reference](../reference/index.md) for the formatter
  options and layer catalogue.
- Open the [Integrations cookbook](../integrations/index.md) for
  ITSI / SOAR / ES / RBA / MITRE / Purdue / A&I / AI-Assistant
  wiring.
