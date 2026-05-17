---
title: Reference
description: >-
  Authoritative reference for Better Map's formatter options, layer
  catalogue, and the BM-CT-1 enable/disable/reset contract.
---

# Reference

Three pages, three contracts:

<div class="grid cards" markdown>

-   :material-form-textbox: __Formatter options__

    ---

    All **82** formatter options, every option's default, enum
    values, help text, and Splunk property path. Generated from
    `formatter.html` by `scripts/build-formatter-schema.py`.

    [:octicons-arrow-right-24: Browse the formatter](formatter.md)

-   :material-layers-outline: __Layer catalogue__

    ---

    The ten core layer types, the optional overlay layers, and the
    eleventh "integration layer" pattern used by the eight Splunk
    integrations.

    [:octicons-arrow-right-24: Browse the layers](layers.md)

-   :material-power-plug-outline: __BM-CT-1__

    ---

    Every integration, layer, and widget exposes `setEnabled(bool)`,
    `isEnabled()`, `reset()`. The contract is checked by
    `scripts/check-bmct1-contract.js` (CI gate).

    [:octicons-arrow-right-24: Read the contract](bm-ct-1.md)

</div>

## Source of truth

- **Formatter:** `better_map/appserver/static/visualizations/better_map/formatter.html`
  + the generated
  [`docs/_machine/formatter-schema.json`](https://github.com/fenre/better_map/blob/main/docs/_machine/formatter-schema.json).
- **Layers:** `better_map/appserver/static/visualizations/better_map/src/lib/layers/**`
  + the generated `_machine/layers-schema.json` (G7 Phase 2,
  pending).
- **Integrations:** [`docs/_machine/integrations/*.yaml`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
  (G7 Phase 1, shipped).
- **BM-CT-1 contract:** `scripts/check-bmct1-contract.js` is the
  authoritative checker; this site documents the rules it enforces.

When this site disagrees with the generated machine layer, the
machine layer wins — open an issue against the docs and we'll fix the
narrative.
