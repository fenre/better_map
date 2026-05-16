/*
 * v1.6 widget + layer + Splunk-integration aggregator.
 *
 * The visualization shell instantiates this once after the map is
 * live (see visualization_source.js) and stores the controller on
 * `this`. The controller exposes:
 *
 *   instances:      { geocoder, commandPalette, minimap, ... }
 *   register(builder)  - register every fancy action with the
 *                        master control panel (BM-CT-1)
 *   destroy()          - tear down everything cleanly
 *
 * Keeps visualization_source.js readable - without it the shell
 * would have ~30 import lines and ~30 registerFancyAction blocks.
 *
 * Widget factory signatures match the actual modules on disk:
 *   - widgets are (parentEl, opts) with map/viz wired via opts.builder
 *   - timeSplit is (parentEl, map, opts) - the one positional exception
 *
 * Every v2 widget defaults to DISABLED so dashboard authors opt-in via
 * the formatter or the master control panel. PMTiles is a basemap helper
 * with no UI surface - we wire up protocol registration only.
 */

import { createGeocoder } from './geocoder.js';
import { createCommandPalette } from './commandPalette.js';
import { createMinimap } from './minimap.js';
import { createMarkdownPopup } from './markdownPopup.js';
import { createDrawTools } from './drawTools.js';
import { createMeasureTool } from './measure.js';
import { createLasso } from './lasso.js';
import { createBrushing } from './brushing.js';
import { createSideBySide } from './sideBySide.js';
import { createSpatialQuery } from './spatialQuery.js';
import { createTimeSplit } from './timeSplit.js';

import * as wmsLayer from '../layers/wms.js';
import * as kmlLayer from '../layers/kml.js';
import * as tripsLayer from '../layers/trips.js';
import * as geofenceLayer from '../layers/geofence.js';
import * as windLayer from '../layers/wind.js';
import * as scenegraphLayer from '../layers/scenegraph.js';
import * as mil2525Layer from '../layers/mil2525.js';

import * as mitre from '../splunk/mitre.js';
import * as esNotable from '../splunk/esNotable.js';
import * as itsi from '../splunk/itsi.js';
import * as soar from '../splunk/soar.js';
import * as rba from '../splunk/rba.js';
import * as purdue from '../splunk/purdue.js';
import * as aiGeo from '../splunk/aiGeo.js';
import * as aiAssistant from '../splunk/aiAssistant.js';

import * as pmtilesLoader from '../basemaps/pmtilesLoader.js';

const ICONS = {
    geocoder:         '\u2315',
    commandPalette:   '\u2318',
    minimap:          '\u25A2',
    drawTools:        '\u270E',
    measure:          '\u2702',
    lasso:            '\u29BF',
    brushing:         '\u29B7',
    sideBySide:       '\u2B0C',
    spatialQuery:     '\u2756',
    timeSplit:        '\u23F1',
    wmsLayer:         '\u25A6',
    kmlLayer:         '\u25CE',
    tripsLayer:       '\u2708',
    geofenceLayer:    '\u26AB',
    windLayer:        '\u2698',
    scenegraphLayer:  '\u2691',
    mil2525Layer:     '\u2694',
    mitre:            '\u26A0',
    esNotable:        '\u26EF',
    itsi:             '\u2630',
    soar:             '\u2699',
    rba:              '\u25A8',
    purdue:           '\u29C7',
    aiGeo:            '\u2316',
    aiAssistant:      '\u263F'
};

const LABELS = {
    geocoder:         'Search box (geocoder)',
    commandPalette:   'Command palette (\u2318K)',
    minimap:          'Minimap',
    drawTools:        'Draw tools',
    measure:          'Measure tool',
    lasso:            'Lasso select',
    brushing:         'Brushing highlight',
    sideBySide:       'Side-by-side compare',
    spatialQuery:     'Spatial-query SPL emit',
    timeSplit:        'Time-window split view',
    wmsLayer:         'WMS raster layer',
    kmlLayer:         'KML import layer',
    tripsLayer:       'Trip replay layer',
    geofenceLayer:    'Geofence layer',
    windLayer:        'Wind / flow particles',
    scenegraphLayer:  'Scenegraph (3D-style icons)',
    mil2525Layer:     'MIL-STD-2525 symbology',
    mitre:            'MITRE ATT&CK overlay',
    esNotable:        'ES notable drilldown',
    itsi:             'ITSI service map',
    soar:             'SOAR playbook trigger',
    rba:              'RBA risk heatmap',
    purdue:           'OT Purdue overlay',
    aiGeo:            'A&I geo-resolution',
    aiAssistant:      'AI Assistant chat'
};

/**
 * @param {HTMLElement} rootEl        Visualization root element.
 * @param {object} builder            MapBuilder instance (must have .map after init).
 * @param {object} viz                SplunkVisualizationBase instance.
 * @param {object} [opts]             Per-widget option overrides.
 */
export function createV2Bundle(rootEl, builder, viz, opts) {
    const o = opts || {};
    const map = builder && builder.map ? builder.map : null;
    const instances = {};

    // Register PMTiles protocol once. Safe no-op if pmtiles bundle is
    // unavailable or maplibre is missing on this page.
    try {
        var maplibre = (typeof window !== 'undefined') ? window.maplibregl : null;
        if (maplibre && pmtilesLoader && typeof pmtilesLoader.registerProtocol === 'function') {
            pmtilesLoader.registerProtocol(maplibre);
        }
    } catch (_e) { /* swallow */ }

    // --- Widgets ---------------------------------------------------------
    // Every factory takes (parentEl, opts). The factories that need the
    // map look it up via opts.builder.map; the only exception is
    // createTimeSplit which takes (container, map, opts) positionally.
    instances.geocoder       = safeCreate(createGeocoder,       rootEl, mergeOpts(o.geocoder,       { builder: builder }));
    instances.commandPalette = safeCreate(createCommandPalette, rootEl, mergeOpts(o.commandPalette, { builder: builder, viz: viz }));
    instances.minimap        = safeCreate(createMinimap,        rootEl, mergeOpts(o.minimap,        { builder: builder }));
    instances.drawTools      = safeCreate(createDrawTools,      rootEl, mergeOpts(o.drawTools,      { builder: builder }));
    instances.measure        = safeCreate(createMeasureTool,    rootEl, mergeOpts(o.measure,        { builder: builder }));
    instances.lasso          = safeCreate(createLasso,          rootEl, mergeOpts(o.lasso,          { builder: builder, viz: viz }));
    instances.brushing       = safeCreate(createBrushing,       rootEl, mergeOpts(o.brushing,       { builder: builder }));
    instances.sideBySide     = safeCreate(createSideBySide,     rootEl, mergeOpts(o.sideBySide,     { builder: builder }));
    instances.spatialQuery   = safeCreate(createSpatialQuery,   rootEl, mergeOpts(o.spatialQuery,   { builder: builder, viz: viz }));
    // timeSplit signature is positional - (container, map, opts).
    if (map) {
        try { instances.timeSplit = createTimeSplit(rootEl, map, o.timeSplit || {}); }
        catch (_e) { instances.timeSplit = null; }
    }

    // markdownPopup is a passive factory (no setEnabled) - we still create
    // it so callers can grab .show()/.hide() via instances.markdownPopup,
    // but it is NOT registered as a fancy action.
    try {
        instances.markdownPopup = createMarkdownPopup(rootEl, mergeOpts(o.markdownPopup, { builder: builder }));
    } catch (_e) { instances.markdownPopup = null; }

    // --- Layer modules (BM-CT-1 adapters around module-level state) ----
    instances.wmsLayer        = makeLayerAdapter(map, wmsLayer);
    instances.kmlLayer        = makeLayerAdapter(map, kmlLayer);
    instances.tripsLayer      = makeLayerAdapter(map, tripsLayer);
    instances.geofenceLayer   = makeLayerAdapter(map, geofenceLayer);
    instances.windLayer       = makeLayerAdapter(map, windLayer);
    instances.scenegraphLayer = makeLayerAdapter(map, scenegraphLayer);
    instances.mil2525Layer    = makeLayerAdapter(map, mil2525Layer);

    // --- Splunk moat (already exposes setEnabled/isEnabled/reset) ------
    instances.mitre       = makeModuleAdapter(mitre);
    instances.esNotable   = makeModuleAdapter(esNotable);
    instances.itsi        = makeModuleAdapter(itsi);
    instances.soar        = makeModuleAdapter(soar);
    instances.rba         = makeModuleAdapter(rba);
    instances.purdue      = makeModuleAdapter(purdue);
    instances.aiGeo       = makeModuleAdapter(aiGeo);
    instances.aiAssistant = makeModuleAdapter(aiAssistant);

    // Default every v2 surface to DISABLED so dashboard authors opt-in.
    // Existing v1.5.2 fancy actions remain at their original defaults.
    Object.keys(instances).forEach(function (id) {
        var inst = instances[id];
        if (inst && typeof inst.setEnabled === 'function') {
            try { inst.setEnabled(false); } catch (_e) { /* swallow */ }
        }
    });

    function register(b) {
        if (!b || typeof b.registerFancyAction !== 'function') return;
        Object.keys(instances).forEach(function (id) {
            var inst = instances[id];
            if (!inst || typeof inst.setEnabled !== 'function') return;
            var actionId = 'v2-' + camelToKebab(id);
            b.registerFancyAction(actionId, {
                id: actionId,
                label: LABELS[id] || id,
                icon: ICONS[id] || '\u25CB',
                setEnabled: function (on) {
                    try { inst.setEnabled(on); } catch (_e) { /* swallow */ }
                },
                isEnabled: function () {
                    try { return !!inst.isEnabled(); } catch (_e) { return false; }
                },
                reset: function () {
                    try { if (typeof inst.reset === 'function') inst.reset(); }
                    catch (_e) { /* swallow */ }
                }
            });
        });
    }

    function destroy() {
        Object.keys(instances).forEach(function (id) {
            var inst = instances[id];
            if (inst && typeof inst.destroy === 'function') {
                try { inst.destroy(); } catch (_e) { /* swallow */ }
            }
        });
    }

    return {
        instances: instances,
        register: register,
        destroy: destroy
    };
}

function safeCreate(factory, parentEl, opts) {
    try { return factory(parentEl, opts); }
    catch (_e) { return null; }
}

function mergeOpts(userOpts, defaults) {
    var out = {};
    var src = defaults || {};
    var key;
    for (key in src) { if (Object.prototype.hasOwnProperty.call(src, key)) out[key] = src[key]; }
    var u = userOpts || {};
    for (key in u) { if (Object.prototype.hasOwnProperty.call(u, key)) out[key] = u[key]; }
    return out;
}

function makeLayerAdapter(map, mod) {
    var enabled = false;
    return {
        setEnabled: function (on) {
            enabled = !!on;
            if (!map) return;
            if (typeof mod.setEnabled === 'function') mod.setEnabled(map, enabled);
            else if (typeof mod.setVisible === 'function') mod.setVisible(map, enabled);
        },
        isEnabled: function () {
            if (typeof mod.isEnabled === 'function') {
                // Layer module exports vary - some take map, some don't.
                try { return !!mod.isEnabled(map); }
                catch (_e) { try { return !!mod.isEnabled(); } catch (_e2) { return enabled; } }
            }
            return enabled;
        },
        reset: function () {
            if (typeof mod.reset === 'function') {
                try { mod.reset(map); } catch (_e) { /* swallow */ }
            }
        }
    };
}

function makeModuleAdapter(mod) {
    return {
        setEnabled: function (on) {
            if (typeof mod.setEnabled === 'function') {
                try { mod.setEnabled(!!on); } catch (_e) { /* swallow */ }
            }
        },
        isEnabled: function () {
            try { return typeof mod.isEnabled === 'function' ? !!mod.isEnabled() : false; }
            catch (_e) { return false; }
        },
        reset: function () {
            if (typeof mod.reset === 'function') {
                try { mod.reset(); } catch (_e) { /* swallow */ }
            }
        }
    };
}

function camelToKebab(s) {
    return String(s).replace(/[A-Z]/g, function (m) { return '-' + m.toLowerCase(); });
}
