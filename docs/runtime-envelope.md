---
title: Runtime envelope
description: >-
  The binding contract that defines what Better Map is allowed to do
  inside a Splunk Web page. Six bullet points. Violating any one of
  them is a release blocker.
---

# Runtime envelope

Better Map runs inside Splunk Web as an AMD-style custom
visualization. It is *not* a stand-alone web app, a service worker,
or a Dashboard Studio v3 plugin. The envelope below is **binding** —
it is mirrored verbatim in
[`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
and in [ROADMAP §1a](https://github.com/fenre/better_map/blob/main/ROADMAP.md).

If a proposed feature requires you to break any of the six rules
below, the feature is **either out of scope or needs a Splunk-resident
path** (e.g. a Splunk modular input, a Splunk saved search, a
sub-search proxy). It does not go into the bundle.

## The six rules

1. **No fetches outside `splunkd:8089`.** The exceptions are:

    - Basemap tiles from the seven sanctioned providers (OpenFreeMap,
      OpenStreetMap raster, MapTiler Streets / Topo, Stadia OSM
      Bright / Alidade Smooth, `custom`).
    - Air-gapped PMTiles served from Splunk static assets — see
      [Air-gapped deployment](air-gapped.md).
    - Integration endpoints **explicitly declared** under
      [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations).
      Each integration YAML lists its endpoints, ports, auth model,
      and customer-controlled allowlist requirement.

    Every other fetch path is a release blocker.

2. **No external windows / iframes pointing outside Splunk.** No
   `window.open('https://…')`, no `<iframe src='https://…'>`.
   Drill-downs always stay inside Splunk Web (either same-page panel
   updates or new Splunk dashboards opened via Splunk's own drilldown
   API).

3. **No Service Worker registration.** Splunk Web's CSP forbids
   service workers, and they would also break Splunk's session
   cookies on certain auth proxies.

4. **No Dashboard Studio v3 plugin keys.** Better Map is a Dashboard
   Studio **v2** custom visualization. The keys `core.*`,
   `schemaVersion`, `data_contract.*`, and the v3 plugin loader path
   route the viz to the wrong loader and produce a silent grey
   placeholder bar-chart icon. See
   [`splunk-ds-onprem-custom-viz`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/aiAssistant.yaml)
   for the canonical post-mortem of this trap.

5. **One AMD module, no dynamic `import()`.** Splunk's AMD loader
   resolves the viz as a single entry. A second AMD module — even
   lazy-loaded — breaks deterministic load order, and dynamic
   `import()` is rejected by the loader in Splunk 10.x. Webpack is
   configured with `target: ['web', 'es5']` and
   `output.environment.arrowFunction: false` so the bundle parses
   under Splunk's loader.

6. **No third-party LLM API.** AI-assistant features go through
   `Splunk_AI_Assistant_Cloud` (the in-platform SPL assistant). No
   OpenAI, Anthropic, Vertex, Bedrock, or custom-endpoint calls.

## What the envelope buys you

The runtime envelope is the reason Better Map can:

- Pass AppInspect cleanly with zero waivers.
- Run in air-gapped Splunk Enterprise deployments (no inbound or
  outbound dependency on the public internet beyond customer-supplied
  basemap tiles).
- Survive Splunk Cloud Victoria's CSP without a per-customer
  exception.
- Be reviewed end-to-end by a single human in a single sitting — the
  bundle is one file, the auth surface is `splunkd:8089`, and the
  external-host list lives in
  [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations).

## Where the envelope is enforced

| Surface | Enforcement |
|---|---|
| JS source | `eslint` rule `no-restricted-globals` blocks `XMLHttpRequest`, `WebSocket`, `EventSource` constructors. Webpack `externals` block `fs`, `path`, `child_process`. |
| Webpack bundle | `scripts/check-bundle-size.js` fails on > 3.0 MB raw; `scripts/check-bundle-console-noise.js` fails on stray `console.log` outside the diagnostic gate. |
| Dashboard XML | `scripts/check-dashboard-tokens.js` cross-references emitted ↔ consumed `$better_map.*$` tokens (SPATIAL-1). |
| Integrations | `scripts/check-formatter-coverage.py` (and Phase 2's `check-integrations-coverage.py`) cross-reference declared endpoints with JS call sites. |
| Manifest | `scripts/check-manifest.py` blocks unsigned additions to the shipped tarball. |

## Where to read more

- [`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
  — the operating manual for AI agents and human contributors. The
  envelope is in §3 ("Non-negotiables").
- [ROADMAP §1a](https://github.com/fenre/better_map/blob/main/ROADMAP.md)
  — the historical motivation for each rule.
- [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
  — the canonical, machine-readable endpoint declarations the
  envelope's "exceptions" clause refers to.
