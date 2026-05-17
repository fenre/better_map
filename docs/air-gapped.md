---
title: Air-gapped deployment
description: >-
  Run Better Map without any outbound internet access. PMTiles
  basemap, customer-controlled integration endpoints, signed
  release verification.
---

# Air-gapped deployment

Better Map is designed to run in **air-gapped** Splunk deployments —
no inbound or outbound dependency on the public internet beyond a
customer-supplied basemap. Three components matter:

1. The **basemap tile source** (default points to OpenFreeMap; the
   air-gapped fallback is **PMTiles** served from Splunk static
   assets).
2. The **integration endpoints** declared in
   [`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
   (all customer-controlled by default; the runtime envelope
   exception list is built from these).
3. The **release-tarball verification** flow (cosign keyless +
   CycloneDX SBOM, both retrievable from GitHub Releases at
   air-gap-prep time, then verified offline at install time).

## The PMTiles basemap fallback

[PMTiles](https://docs.protomaps.com/pmtiles/) is a single-file
basemap format that can be served by Splunk Web as a static asset —
no tile server, no per-tile request, no API key.

### Step 1 — Generate the PMTiles file (online, one-time)

On an internet-connected workstation:

```bash
# pip install pmtiles
pmtiles extract \
    https://build.protomaps.com/20260501.pmtiles \
    europe.pmtiles \
    --bbox=-12,35,30,72       # adjust to your area of interest
```

For a single-country file, the result is typically 50–200 MB. For a
global file, plan for 5–10 GB.

### Step 2 — Drop into Better Map's static assets

```
better_map/
└── appserver/
    └── static/
        └── basemaps/
            └── europe.pmtiles      # your PMTiles file
```

### Step 3 — Wire the formatter

In the Studio formatter, set:

| Option | Value |
|---|---|
| `tileProvider` | `custom` |
| `customStyleUrl` | `pmtiles:///static/app/better_map/basemaps/europe.pmtiles` |

The viz registers PMTiles support via MapLibre's `addProtocol()`
hook on first render, so the `pmtiles://` URL resolves locally. No
network call leaves Splunk Web.

!!! info "Why this works"

    See the
    [`splunk-ds-onprem-custom-viz`](https://github.com/fenre/better_map/blob/main/docs/_machine/integrations/aiAssistant.yaml)
    skill / rule for the Dashboard Studio Request-shape trap that
    once broke this flow — Better Map's MapLibre setup explicitly
    handles DS's `Request` object shape so `addProtocol()` returns
    the right ArrayBuffer payload to the tile fetcher.

## Customer-controlled integration endpoints

The eight integrations under
[`docs/_machine/integrations/`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
default to **splunkd:8089-local** endpoints. The two that need
customer infrastructure (`aiGeo.yaml`, `soar.yaml`) are **disabled
by default** and require the customer to declare:

- The endpoint URL (on the customer's network, not the public
  internet).
- The auth header (Splunk token, customer-issued API key, or
  customer-configured OAuth).
- The egress allowlist entry in the Splunk-side egress proxy
  (Splunk Cloud Victoria) or the customer's outbound firewall
  (Splunk Enterprise).

Better Map never bypasses the Splunk-side egress controls. All
HTTP calls go through the browser's `fetch` and are subject to
Splunk Web's CSP.

## Verifying the release tarball offline

Before air-gap transfer, on the internet-connected workstation:

```bash
# Fetch the release tarball + cosign signature + SBOM.
gh release download v1.6.3 \
    --repo fenre/better_map \
    --pattern '*.tar.gz' \
    --pattern '*.tar.gz.sig' \
    --pattern '*.tar.gz.crt' \
    --pattern '*.sbom.json'

# Verify the cosign keyless signature against the GitHub Actions
# OIDC identity.
COSIGN_EXPERIMENTAL=1 cosign verify-blob \
    --certificate better_map-v1.6.3.tar.gz.crt \
    --signature   better_map-v1.6.3.tar.gz.sig \
    --certificate-identity-regexp \
      'https://github.com/fenre/better_map/.github/workflows/release.yml@.*' \
    --certificate-oidc-issuer https://token.actions.githubusercontent.com \
    better_map-v1.6.3.tar.gz
```

The verification command is **offline-capable** — once cosign is
installed, the only network call is the optional Rekor transparency
log check, which you can disable with `--insecure-ignore-tlog`
inside the air gap and pre-flight at the prep workstation.

The SBOM (`better_map-v1.6.3.sbom.json`) is CycloneDX 1.6 JSON —
hand it to your SBOM management workflow.

## See also

- [Supply chain runbook](runbooks/supply-chain.md) — the full
  supply-chain story (G1).
- [Runtime envelope](runtime-envelope.md) — the binding contract
  on outbound HTTP.
- [Integrations](integrations/index.md) — per-integration endpoint
  list.
