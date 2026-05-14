/*
 * Layer dispatcher.
 *
 * Takes an Analysis object from dataFitness.js and reconciles the set of
 * mounted MapLibre layers. Each layer module exports the same shape:
 *
 *     mount(map, opts)       - first install
 *     update(map, fc, opts)  - swap in new data
 *     unmount(map)           - clean up
 *     setVisible(map, bool)  - hide/show without unmounting
 *
 * Adding a new layer module is a matter of appending its strategy here.
 * The dispatcher remembers which layers were mounted on the last cycle so
 * it can unmount the ones that are no longer required (e.g. user changed
 * options or the search produced no polygons this time around).
 */

import * as markers from './markers.js';
import * as clusters from './clusters.js';
import * as heatmap from './heatmap.js';
import * as paths from './paths.js';
import * as polygons from './polygons.js';
import * as choropleth from './choropleth.js';
import * as hexbin from './hexbin.js';
import * as extrusion from './extrusion.js';
import * as featureJoin from './featureJoin.js';
import * as indoor from './indoor.js';

const ALL = {
    markers: markers,
    clusters: clusters,
    heatmap: heatmap,
    paths: paths,
    polygons: polygons,
    choropleth: choropleth,
    hexbin: hexbin,
    extrusion: extrusion,
    featureJoin: featureJoin,
    indoor: indoor
};

const ORDER = [
    'indoor',
    'featureJoin',
    'polygons',
    'choropleth',
    'extrusion',
    'hexbin',
    'heatmap',
    'paths',
    'clusters',
    'markers'
];

export function reconcile(map, analysis, options, state) {
    if (!map || !analysis) {
        return state || {};
    }
    const next = state ? Object.assign({}, state) : {};
    const opts = options || {};

    // Decide which strategies are active for this cycle.
    const active = decideActive(analysis, opts);

    // Mount or update active layers in the configured render order.
    ORDER.forEach(function (id) {
        if (!active[id]) return;
        const strategy = ALL[id];
        const fc = active[id].fc;
        const layerOpts = active[id].opts;
        if (!next[id]) {
            strategy.mount(map, layerOpts);
            next[id] = true;
        }
        // All strategies accept (map, fc, opts); most ignore opts but
        // hexbin and choropleth use it to re-aggregate / re-ramp.
        strategy.update(map, fc, layerOpts);
    });

    // Unmount strategies that were active last cycle but not this cycle.
    Object.keys(next).forEach(function (id) {
        if (!active[id] && ALL[id]) {
            ALL[id].unmount(map);
            delete next[id];
        }
    });

    return next;
}

export function setLayerVisibility(map, strategyId, visible) {
    if (!map) return;
    const strategy = ALL[strategyId];
    if (strategy && strategy.setVisible) {
        strategy.setVisible(map, visible);
    }
}

/**
 * Apply visibility for a *layer name* (a unique value in the user's `layer`
 * SPL field). This is layered on top of the strategy-level visibility:
 * the dispatcher always keeps the strategy mounted but uses a filter to
 * hide features whose `layerName` property does not match the visible set.
 */
export function applyLayerNameFilter(map, visibleLayerNames) {
    if (!map) return;
    const visibleSet = visibleLayerNames || null;
    Object.keys(ALL).forEach(function (id) {
        const strategy = ALL[id];
        // Each strategy may publish one or more layer IDs that accept a filter.
        const ids = collectMapLibreLayerIds(strategy);
        ids.forEach(function (mlId) {
            if (!map.getLayer(mlId)) return;
            const existing = map.getFilter(mlId) || null;
            const baseFilter = stripLayerFilter(existing);
            if (!visibleSet || !visibleSet.length) {
                if (baseFilter) {
                    map.setFilter(mlId, baseFilter);
                } else {
                    map.setFilter(mlId, null);
                }
                return;
            }
            const layerFilter = ['match', ['get', 'layerName'], visibleSet, true, false];
            if (baseFilter) {
                map.setFilter(mlId, ['all', baseFilter, layerFilter]);
            } else {
                map.setFilter(mlId, layerFilter);
            }
        });
    });
}

function decideActive(analysis, opts) {
    const out = {};
    const pointsFC = analysis.points;
    const linesFC = analysis.lines;
    const polysFC = analysis.polygons;
    const tabularFC = analysis.tabular;

    if (opts.indoor && opts.indoor.enabled) {
        out.indoor = {
            fc: tabularFC || { type: 'FeatureCollection', features: [] },
            opts: opts.indoor
        };
    }

    if (opts.featureJoin && opts.featureJoin.enabled) {
        out.featureJoin = {
            fc: tabularFC || { type: 'FeatureCollection', features: [] },
            opts: opts.featureJoin
        };
    }

    if (pointsFC && pointsFC.features.length) {
        const renderMode = pickPointRenderer(pointsFC, opts);
        if (renderMode === 'hexbin') {
            out.hexbin = {
                fc: pointsFC,
                opts: opts.hexbin || {}
            };
        } else if (renderMode === 'heatmap') {
            out.heatmap = {
                fc: pointsFC,
                opts: opts.heatmap || {}
            };
        } else if (renderMode === 'cluster') {
            out.clusters = {
                fc: pointsFC,
                opts: opts.clusters || {}
            };
        } else {
            out.markers = {
                fc: pointsFC,
                opts: opts.markers || {}
            };
        }
    }

    if (linesFC && linesFC.features.length) {
        out.paths = {
            fc: linesFC,
            opts: opts.paths || {}
        };
    }

    if (polysFC && polysFC.features.length) {
        if (opts.extrusion && opts.extrusion.enabled) {
            out.extrusion = {
                fc: polysFC,
                opts: opts.extrusion
            };
        } else if (opts.choropleth && opts.choropleth.enabled) {
            out.choropleth = {
                fc: polysFC,
                opts: opts.choropleth
            };
        } else {
            out.polygons = {
                fc: polysFC,
                opts: opts.polygons || {}
            };
        }
    }

    return out;
}

function pickPointRenderer(pointsFC, opts) {
    const requested = (opts && opts.pointRenderer) || 'auto';
    if (
        requested === 'heatmap' ||
        requested === 'cluster' ||
        requested === 'markers' ||
        requested === 'hexbin'
    ) {
        return requested;
    }
    const n = pointsFC.features.length;
    if (n > 5000) return 'heatmap';
    if (n > 200) return 'cluster';
    return 'markers';
}

function collectMapLibreLayerIds(strategy) {
    // Each strategy exports its layer IDs as named exports prefixed with LAYER_.
    const ids = [];
    Object.keys(strategy).forEach(function (key) {
        if (key.indexOf('LAYER_') === 0 && typeof strategy[key] === 'string') {
            ids.push(strategy[key]);
        }
    });
    return ids;
}

/**
 * If our previous applyLayerNameFilter wrapped a baseFilter inside an `all`
 * tuple, peel it back so we don't keep nesting.
 */
function stripLayerFilter(existing) {
    if (!existing || !Array.isArray(existing)) return existing || null;
    if (existing[0] !== 'all') return existing;
    // We previously inserted ['all', base, ['match', ['get', 'layerName'], ...]]
    const inner = existing.slice(1).filter(function (sub) {
        if (!Array.isArray(sub) || sub.length < 4) return true;
        // Drop our match-on-layerName filter.
        return !(sub[0] === 'match' &&
            Array.isArray(sub[1]) &&
            sub[1][0] === 'get' &&
            sub[1][1] === 'layerName');
    });
    if (!inner.length) return null;
    if (inner.length === 1) return inner[0];
    return ['all'].concat(inner);
}
