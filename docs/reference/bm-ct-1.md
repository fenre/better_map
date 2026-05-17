---
title: BM-CT-1 contract
description: >-
  Every integration, layer, and widget exposes setEnabled(bool),
  isEnabled(), reset(). Three methods. Five reasons they're
  non-negotiable.
---

# BM-CT-1 — the enable / disable / reset contract

BM-CT-1 is the single most-enforced contract in Better Map. It is
checked by
[`scripts/check-bmct1-contract.js`](https://github.com/fenre/better_map/blob/main/scripts/lint-js-css-contract.js)
on every PR.

## The three methods

Every integration, layer, and widget under
`better_map/appserver/static/visualizations/better_map/src/lib/**`
MUST expose:

```js
class BetterMapThing {
  // Toggle this thing on or off without re-creating it. Idempotent.
  setEnabled(bool) { /* ... */ }

  // Current state. Cheap; no side-effects. Returns boolean.
  isEnabled() { /* ... */ }

  // Restore default state (clear filters, dispose ephemeral
  // sources, reset internal toggles). Safe to call when disabled.
  reset() { /* ... */ }
}
```

## Why this matters (the five reasons)

1. **Cross-panel coordination.** A choropleth filter applied in panel
   A must be removable from panel B without re-mounting panel B's
   viz. Without `setEnabled(false)`, panel B would have to be
   destroyed and re-created — which loses scroll, zoom, and any
   in-flight searches.

2. **BM-FIX class of bug.** Historically, layers created `better_map-*`
   DOM nodes that survived a layer disable. `reset()` is the
   contractual cleanup path; the
   [CSS contract checker](https://github.com/fenre/better_map/blob/main/scripts/lint-js-css-contract.js)
   verifies every class name a layer creates is *either* defined in
   `visualization.css` *or* removed in `reset()`.

3. **Splunk Cloud Victoria CSP.** Some widgets register listeners on
   `window` (`resize`, `beforeunload`). Without `setEnabled(false)`
   removing them, a dashboard with N copies of the viz leaks N
   listeners per page-lifecycle event. Splunk Web's perf budget
   trips at ~500 listeners.

4. **WebGL context exhaustion.** Modern browsers cap WebGL contexts
   per origin at 16. A user with 17 panels (a real number — the
   showcase dashboards average 8) would silently drop tiles in the
   18th panel unless `setEnabled(false)` releases the context.

5. **AI-agent self-healing.** Every integration YAML under
   `docs/_machine/integrations/` declares its expected BM-CT-1
   methods so AI agents triaging a failure can issue
   `setEnabled(false); reset(); setEnabled(true)` as a deterministic
   recovery sequence.

## The gate

```bash
node scripts/lint-js-css-contract.js
```

Sample passing output:

```
[lint-js-css-contract] OK — 47 files inspected, 11 layers + 8
  integrations + 11 widgets all expose setEnabled/isEnabled/reset.
```

Sample failing output (an AI agent shipped a new layer without the
contract):

```
[lint-js-css-contract] FAIL — src/lib/layers/foo.js exposes
  setEnabled() but not reset(). Add a reset() method that disposes
  the foo source from the MapLibre map and clears any internal
  filter state.
```

## Templates

When you (or an AI agent) add a new layer / integration / widget,
copy one of these templates instead of writing the contract from
scratch:

| Kind | Template |
|---|---|
| Layer (data-driven) | `src/lib/layers/_template.js` |
| Integration (decoration) | `src/lib/integrations/_template.js` |
| Widget (UI affordance) | `src/lib/widgets/_template.js` |

(The `_template.js` files were introduced in v1.5 — the templates
embed the contract, the cleanup of `better_map-*` DOM nodes, and a
Vitest suite that exercises `setEnabled(false)` + `reset()` for
leaks.)

## See also

- [Contributing](../contributing.md) — the workflow for adding a new
  layer / integration / widget.
- [Layer catalogue](layers.md) — the ten core layers and the eight
  integrations that all satisfy this contract.
- [`docs/_machine/integrations/*.yaml`](https://github.com/fenre/better_map/tree/main/docs/_machine/integrations)
  — declarative BM-CT-1 surface per integration.
