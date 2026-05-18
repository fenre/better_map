/*
 * demo/index.js — preset registry and synchronous loader for the
 * Better Map "Fill with example data" feature.
 *
 * The viz JS calls `loadDemoPreset(name)` from `formatData()` /
 * `updateView()`.  When the user picks a preset from the
 * "Demo & onboarding" dropdown in the formatter, the SPL results
 * from the panel are discarded and replaced with the generated
 * dataset, so the viz renders demo data on any panel — even a panel
 * whose SPL returns nothing.
 *
 * Why a registry (instead of a switch statement)
 * ----------------------------------------------
 *  - It is the canonical "single source of truth" for valid preset
 *    names; the unit tests, formatter dropdown options, and the
 *    docs/_machine/agents.md "Adding a new preset" recipe all key
 *    off it.
 *  - Adding a fourth preset later is one entry in PRESETS plus the
 *    generator file — no edits in visualization_source.js.
 *
 * Why synchronous (instead of async + dynamic import)
 * ---------------------------------------------------
 *  - The runtime envelope (ROADMAP §1a) forbids a second AMD bundle
 *    or dynamic `import()`.  Bundling the three generators
 *    statically adds < 4 KB gzipped to visualization.js — well
 *    within budget.
 *  - Synchronous returns avoid an extra updateView round-trip and
 *    keep the scrubber from briefly seeing zero rows.
 */
import { generateFleetTelemetry }    from './presets/fleetTelemetry.js';
import { generateIotSmartBuilding }  from './presets/iotSmartBuilding.js';
import { generateCyberIncidents }    from './presets/cyberIncidents.js';

/**
 * Ordered list — the order is what the formatter dropdown shows
 * after "None". Keep "fleet-telemetry" first; it's the most visually
 * impressive preset (animated tracks + popups + 3D) and the best
 * first impression for someone evaluating the viz.
 */
export var PRESETS = [
    {
        id: 'fleet-telemetry',
        label: 'Fleet telemetry — Oslo last-mile (40 vans × 6 h)',
        description:
            'Last-mile delivery fleet across the Oslo metro area. Time scrubber + ' +
            'comet trails + per-status colouring + cargo-weight extrusion.',
        generate: generateFleetTelemetry
    },
    {
        id: 'iot-smart-building',
        label: 'Smart building IoT — Fornebu HQ (5 floors × 50 sensors)',
        description:
            'Multi-floor sensor mesh in a commercial office building. Per-sensor ' +
            'status (ok / warn / alarm), per-floor purpose, suitable for the ' +
            'indoor floor-plan overlay and heatmap layers.',
        generate: generateIotSmartBuilding
    },
    {
        id: 'cyber-incidents',
        label: 'Cyber incidents — global SOC view (600 events / 24 h)',
        description:
            'World-scale security incidents. MITRE technique IDs, RBA risk ' +
            'scores, ISO-3166 source country code for choropleth feature-join.',
        generate: generateCyberIncidents
    }
];

var REGISTRY = {};
for (var i = 0; i < PRESETS.length; i++) {
    REGISTRY[PRESETS[i].id] = PRESETS[i];
}

/**
 * Return true if `name` is a registered preset id (not "none" and
 * not undefined).  Use this from updateView to decide whether to
 * substitute the SPL data.
 *
 * @param {string} name
 * @returns {boolean}
 */
export function isDemoPreset(name) {
    if (!name || typeof name !== 'string') return false;
    if (name === 'none' || name === 'false' || name === '0') return false;
    return Object.prototype.hasOwnProperty.call(REGISTRY, name);
}

/**
 * Generate and return the preset's data in Splunk SearchResults
 * shape ({ fields, rows }), ready to feed into formatData /
 * updateView.  Returns null for unknown presets.
 *
 * The same seed is used on every call, so the data is stable across
 * re-renders.  Pass `opts.nowMs` if you need the demo to "freeze" at
 * a specific instant (e.g. screenshot tests).
 *
 * @param {string} name
 * @param {object} [opts]
 * @returns {{ fields: object[], rows: Array<Array<*>> } | null}
 */
export function loadDemoPreset(name, opts) {
    var preset = REGISTRY[name];
    if (!preset) return null;
    return preset.generate(opts || {});
}

/**
 * Return the human-readable label for a preset id.  Used by the
 * showcase dashboard / debug HUD / live-region announcements.
 *
 * @param {string} name
 * @returns {string}
 */
export function presetLabel(name) {
    var p = REGISTRY[name];
    return p ? p.label : '';
}
