/*
 * DBSCAN client-side clustering analytics.
 *
 * Uses `density-clustering` to run DBSCAN over the input point
 * FeatureCollection. Returns a derived FeatureCollection where each
 * feature has:
 *
 *   properties.cluster   number   cluster id (-1 = noise)
 *   properties.isNoise   boolean  true when cluster === -1
 *
 * If `epsilonMeters` is not supplied, an auto value is derived from
 * the median nearest-neighbour distance over a small random sample
 * (Scott-like heuristic adapted for spatial). This is "good enough"
 * for dashboard exploration — production analytics should pin epsilon.
 *
 * BM-CT-1 contract: pure analytics — no map state, no global state.
 * The owning layer module (analytics/index.js) handles enable / disable
 * / reset by calling compute() or not.
 */

import { DBSCAN } from 'density-clustering';

const EARTH_RADIUS_M = 6378137;

function toRadians(d) { return d * Math.PI / 180; }

function haversineMeters(a, b) {
    const lat1 = toRadians(a[1]);
    const lat2 = toRadians(b[1]);
    const dLat = toRadians(b[1] - a[1]);
    const dLng = toRadians(b[0] - a[0]);
    const h = Math.sin(dLat / 2) ** 2 +
        Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function pointsFromFC(fc) {
    if (!fc || !fc.features) return [];
    return fc.features
        .filter(function (f) { return f.geometry && f.geometry.type === 'Point'; });
}

function autoEpsilonMeters(features) {
    const n = features.length;
    if (n < 5) return 1000;
    const sampleSize = Math.min(50, n);
    const indices = [];
    for (let i = 0; i < sampleSize; i++) {
        indices.push(Math.floor(Math.random() * n));
    }
    const dists = indices.map(function (i) {
        let best = Infinity;
        for (let j = 0; j < n; j++) {
            if (j === i) continue;
            const d = haversineMeters(features[i].geometry.coordinates, features[j].geometry.coordinates);
            if (d < best) best = d;
        }
        return best;
    }).sort(function (a, b) { return a - b; });
    const median = dists[Math.floor(dists.length / 2)];
    // 2× nearest-neighbour median is a reasonable starting epsilon.
    return Math.max(100, median * 2);
}

/**
 * Run DBSCAN over the supplied GeoJSON FeatureCollection.
 *
 * @param {object} fc          input FeatureCollection (points)
 * @param {object} opts
 *   epsilonMeters?: number    if omitted, auto-derived
 *   minPoints?: number        default 4
 * @returns {object}           derived FeatureCollection
 */
export function compute(fc, opts) {
    const features = pointsFromFC(fc);
    if (!features.length) return { type: 'FeatureCollection', features: [] };
    const o = opts || {};
    const minPoints = o.minPoints || 4;
    const epsilonMeters = Number.isFinite(o.epsilonMeters)
        ? o.epsilonMeters
        : autoEpsilonMeters(features);

    const dataset = features.map(function (f) {
        return [f.geometry.coordinates[0], f.geometry.coordinates[1]];
    });

    const dbscan = new DBSCAN();
    const clusters = dbscan.run(
        dataset,
        epsilonMeters,
        minPoints,
        function (a, b) { return haversineMeters(a, b); }
    );
    const noise = dbscan.noise || [];

    const clusterByIdx = {};
    clusters.forEach(function (cluster, clusterId) {
        cluster.forEach(function (idx) {
            clusterByIdx[idx] = clusterId;
        });
    });
    noise.forEach(function (idx) {
        clusterByIdx[idx] = -1;
    });

    const out = features.map(function (f, i) {
        const cid = clusterByIdx[i] !== undefined ? clusterByIdx[i] : -1;
        return {
            type: 'Feature',
            geometry: f.geometry,
            properties: Object.assign({}, f.properties || {}, {
                cluster: cid,
                isNoise: cid === -1
            })
        };
    });

    return {
        type: 'FeatureCollection',
        features: out,
        meta: {
            algorithm: 'dbscan',
            epsilonMeters: epsilonMeters,
            minPoints: minPoints,
            clusterCount: clusters.length,
            noiseCount: noise.length
        }
    };
}
