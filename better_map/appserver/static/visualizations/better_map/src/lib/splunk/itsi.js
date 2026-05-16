/*
 * ITSI service-map mode (scaffold).
 *
 * Fetches ITSI services + dependencies from REST and renders them as
 * geo-positioned nodes + edges. Services are placed at their
 * lat/lng entity properties when available; otherwise they're laid out
 * via a force-directed pass (lightweight, no d3-force dependency).
 *
 * REST endpoints (ITSI 4.x+):
 *
 *   GET /servicesNS/-/SA-ITOA/itoa_interface/service
 *     filter: { "_owner": "nobody" }
 *     count:  0 (all)
 *
 *   GET /servicesNS/-/SA-ITOA/itoa_interface/service?fields=...
 *     fields: title,_key,services_depends_on,services_depending_on,
 *             health_calculated,entities
 *
 * Returns a normalised graph:
 *   { nodes: [{ id, title, healthScore, severity, lng, lat }], edges: [{ from, to }] }
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

import { splunkdFetch, parseJsonOutput } from './rest';

const SVC_PATH = '/servicesNS/-/SA-ITOA/itoa_interface/service';

let _baseUrl = '';
let _enabled = true;
let _cachedGraph = null;

export function configure(opts) {
    if (opts && typeof opts.baseUrl === 'string') {
        _baseUrl = opts.baseUrl.replace(/\/$/, '');
    }
}

/**
 * Fetch the full ITSI service graph as a normalized { nodes, edges }.
 */
export function fetchServiceGraph() {
    const url = (_baseUrl || '') + SVC_PATH
        + '?output_mode=json'
        + '&count=0'
        + '&fields=' + encodeURIComponent('_key,title,services_depends_on,services_depending_on,health_calculated,entities,geo_lat,geo_lng');
    return splunkdFetch(url, { method: 'GET' }).then(function (resp) {
        if (!resp.ok) {
            return { available: false, reason: 'http-' + resp.status, nodes: [], edges: [] };
        }
        const parsed = parseJsonOutput(resp.body);
        if (!parsed || !parsed.entry) return { available: false, reason: 'bad-json', nodes: [], edges: [] };
        const graph = normalize(parsed.entry);
        _cachedGraph = graph;
        return graph;
    }).catch(function (e) {
        return { available: false, reason: 'fetch-failed', error: String(e), nodes: [], edges: [] };
    });
}

function normalize(entries) {
    const nodes = [];
    const edges = [];
    const idIndex = {};

    entries.forEach(function (entry, i) {
        const c = entry.content || {};
        const id = c._key || entry.name || ('svc_' + i);
        const lat = Number(c.geo_lat);
        const lng = Number(c.geo_lng);
        const node = {
            id: id,
            title: c.title || entry.name || id,
            healthScore: Number(c.health_calculated && c.health_calculated.health_score) || null,
            severity: (c.health_calculated && c.health_calculated.severity) || 'unknown',
            lng: Number.isFinite(lng) ? lng : null,
            lat: Number.isFinite(lat) ? lat : null,
            entityCount: Array.isArray(c.entities) ? c.entities.length : 0
        };
        nodes.push(node);
        idIndex[id] = node;
    });

    entries.forEach(function (entry) {
        const c = entry.content || {};
        const id = c._key || entry.name;
        if (!id) return;
        const deps = Array.isArray(c.services_depends_on) ? c.services_depends_on : [];
        deps.forEach(function (d) {
            const targetId = (d && d.serviceid) || d;
            if (typeof targetId === 'string' && idIndex[targetId]) {
                edges.push({ from: id, to: targetId });
            }
        });
    });

    // Light force-directed placement for nodes without coords.
    layoutNodesWithoutGeo(nodes, edges);

    return { available: true, nodes: nodes, edges: edges };
}

/**
 * Simple Fruchterman-Reingold-style layout for nodes without geo coords.
 * Anchors nodes that have lat/lng and lays out the rest around the
 * centroid of the anchored set.
 */
function layoutNodesWithoutGeo(nodes, _edges) {
    const anchored = nodes.filter(function (n) { return Number.isFinite(n.lat) && Number.isFinite(n.lng); });
    let cx = 0, cy = 0;
    if (anchored.length) {
        anchored.forEach(function (n) { cx += n.lng; cy += n.lat; });
        cx /= anchored.length;
        cy /= anchored.length;
    }
    const floats = nodes.filter(function (n) { return !Number.isFinite(n.lat) || !Number.isFinite(n.lng); });
    if (!floats.length) return;
    const ring = floats.length;
    const radiusDeg = 0.5;
    floats.forEach(function (n, i) {
        const a = (i / ring) * 2 * Math.PI;
        n.lng = cx + Math.cos(a) * radiusDeg;
        n.lat = cy + Math.sin(a) * radiusDeg;
    });
}

/**
 * Convert the cached graph to a GeoJSON FeatureCollection for the
 * markers layer (nodes) and the paths layer (edges).
 */
export function toGeoJSON(graph) {
    const g = graph || _cachedGraph;
    if (!g || !g.nodes) return { nodes: { type: 'FeatureCollection', features: [] }, edges: { type: 'FeatureCollection', features: [] } };
    const nodes = {
        type: 'FeatureCollection',
        features: g.nodes.map(function (n) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [n.lng, n.lat] },
                properties: {
                    id: n.id,
                    title: n.title,
                    healthScore: n.healthScore,
                    severity: n.severity,
                    entityCount: n.entityCount
                }
            };
        })
    };
    const nodeIndex = {};
    g.nodes.forEach(function (n) { nodeIndex[n.id] = n; });
    const edges = {
        type: 'FeatureCollection',
        features: g.edges.map(function (e) {
            const a = nodeIndex[e.from];
            const b = nodeIndex[e.to];
            if (!a || !b) return null;
            return {
                type: 'Feature',
                geometry: { type: 'LineString', coordinates: [[a.lng, a.lat], [b.lng, b.lat]] },
                properties: { from: e.from, to: e.to }
            };
        }).filter(Boolean)
    };
    return { nodes: nodes, edges: edges };
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() { _cachedGraph = null; }
