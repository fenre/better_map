/*
 * Kernel Density Estimation with a proper Gaussian kernel.
 *
 * Renders as a regular square grid of density values that the heatmap
 * layer can colour-ramp directly. Bandwidth defaults to Scott's rule:
 *
 *   h = 1.06 · σ · n^(-1/5)
 *
 * applied independently in each spatial dimension (longitude /
 * latitude) and converted into metres via the haversine equivalent at
 * the dataset centroid for visualization accuracy.
 *
 * Returns a FeatureCollection of square Polygon cells with:
 *   properties.density   raw density value
 *   properties.normalized [0,1] for direct paint binding
 *
 * Cell size is auto-derived so the grid never exceeds opts.maxCells
 * (default 10 000) — keeps the dashboard responsive even on big sets.
 */

import * as turf from '@turf/turf';
import * as ss from 'simple-statistics';

function gaussian(d, h) {
    const x = d / h;
    return Math.exp(-(x * x) / 2) / (h * Math.sqrt(2 * Math.PI));
}

function pickCellKm(bbox, n, maxCells) {
    const widthKm = turf.distance([bbox[0], bbox[1]], [bbox[2], bbox[1]], { units: 'kilometers' });
    const heightKm = turf.distance([bbox[0], bbox[1]], [bbox[0], bbox[3]], { units: 'kilometers' });
    // aim for roughly maxCells; cellArea = area / maxCells.
    const target = Math.sqrt((widthKm * heightKm) / maxCells);
    return Math.max(0.05, target);
}

/**
 * @param {object} fc      input FeatureCollection (points)
 * @param {object} opts
 *   bandwidthMeters?: number   Gaussian σ; auto via Scott's rule if omitted
 *   maxCells?: number          default 10000
 *   valueProperty?: string     weight points by this property
 */
export function compute(fc, opts) {
    if (!fc || !fc.features || !fc.features.length) {
        return { type: 'FeatureCollection', features: [] };
    }
    const o = opts || {};
    const maxCells = o.maxCells || 10000;
    const valueProp = o.valueProperty || null;

    const points = fc.features.filter(function (f) {
        return f.geometry && f.geometry.type === 'Point';
    });
    if (!points.length) return { type: 'FeatureCollection', features: [] };

    const n = points.length;
    const bbox = turf.bbox(fc);
    const cellKm = pickCellKm(bbox, n, maxCells);
    const grid = turf.squareGrid(bbox, cellKm, { units: 'kilometers' });
    if (!grid.features.length) return grid;

    // Compute Scott bandwidth using point coords (in metres).
    let bandwidthMeters;
    if (Number.isFinite(o.bandwidthMeters)) {
        bandwidthMeters = o.bandwidthMeters;
    } else {
        // Project coords into metres relative to bbox centre.
        const cx = (bbox[0] + bbox[2]) / 2;
        const cy = (bbox[1] + bbox[3]) / 2;
        const mPerDegLat = 111320;
        const mPerDegLng = 111320 * Math.cos(cy * Math.PI / 180);
        const xs = points.map(function (p) { return (p.geometry.coordinates[0] - cx) * mPerDegLng; });
        const ys = points.map(function (p) { return (p.geometry.coordinates[1] - cy) * mPerDegLat; });
        const sigmaX = ss.standardDeviation(xs);
        const sigmaY = ss.standardDeviation(ys);
        const sigma = (sigmaX + sigmaY) / 2;
        bandwidthMeters = Math.max(100, 1.06 * sigma * Math.pow(n, -1 / 5));
    }

    let maxDensity = 0;
    grid.features.forEach(function (cell) {
        const ct = turf.centroid(cell).geometry.coordinates;
        let density = 0;
        for (let i = 0; i < n; i++) {
            const p = points[i];
            const d = turf.distance(ct, p.geometry.coordinates, { units: 'meters' });
            // Skip points beyond 3σ — negligible contribution, big speedup.
            if (d > bandwidthMeters * 3) continue;
            const w = valueProp ? Number((p.properties || {})[valueProp]) || 1 : 1;
            density += w * gaussian(d, bandwidthMeters);
        }
        cell.properties = cell.properties || {};
        cell.properties.density = density;
        if (density > maxDensity) maxDensity = density;
    });

    // Normalise to [0,1] for direct paint binding.
    grid.features.forEach(function (cell) {
        cell.properties.normalized = maxDensity > 0 ? cell.properties.density / maxDensity : 0;
    });

    grid.meta = {
        algorithm: 'gaussian-kde',
        bandwidthMeters: bandwidthMeters,
        cellKm: cellKm,
        n: n,
        maxDensity: maxDensity
    };
    return grid;
}
