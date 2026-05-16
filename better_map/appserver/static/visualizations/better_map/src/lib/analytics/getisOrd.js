/*
 * Getis-Ord Gi* hot-spot analysis.
 *
 * Aggregates input points into a uniform grid (hex or square) and
 * computes the Gi* statistic per cell:
 *
 *   Gi* = (Σ wij·xj − x̄ · Σwij) / (s · √((n·Σwij² − (Σwij)²) / (n−1)))
 *
 * where wij is a binary weight (1 if cell j is within `distanceMeters`
 * of cell i, else 0), x̄ is the global mean, s is the global std-dev.
 *
 * The Gi* z-score has an approximate normal distribution; cells with
 * z > 1.96 are 95% significant hot-spots, z < −1.96 are 95% cold-spots.
 *
 * Returns a FeatureCollection of cell polygons with:
 *   properties.value    aggregated count or sum
 *   properties.zScore   Gi* statistic
 *   properties.pValue   two-tailed p
 *   properties.bucket   'hot-99' | 'hot-95' | 'neutral' | 'cold-95' | 'cold-99'
 *
 * Uses turf for grid + spatial ops, simple-statistics for distributions.
 */

import * as turf from '@turf/turf';
import * as ss from 'simple-statistics';

function bucket(z) {
    if (z >= 2.58) return 'hot-99';
    if (z >= 1.96) return 'hot-95';
    if (z <= -2.58) return 'cold-99';
    if (z <= -1.96) return 'cold-95';
    return 'neutral';
}

function twoTailedP(z) {
    return 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(z)));
}

function getBboxPadded(fc, padPct) {
    const bb = turf.bbox(fc);
    const w = bb[2] - bb[0];
    const h = bb[3] - bb[1];
    const px = w * padPct;
    const py = h * padPct;
    return [bb[0] - px, bb[1] - py, bb[2] + px, bb[3] + py];
}

/**
 * @param {object} fc      input FeatureCollection (points)
 * @param {object} opts
 *   cellKm?: number       grid cell size in km (default 5)
 *   distanceMeters?: number   weight cutoff distance (default 10 × cellKm)
 *   valueProperty?: string    sum this property per cell instead of count
 *   gridType?: 'hex'|'square' default 'hex'
 * @returns {object} cell FeatureCollection
 */
export function compute(fc, opts) {
    if (!fc || !fc.features || !fc.features.length) {
        return { type: 'FeatureCollection', features: [] };
    }
    const o = opts || {};
    const cellKm = Number(o.cellKm) || 5;
    const distanceMeters = Number(o.distanceMeters) || (cellKm * 1000 * 2);
    const gridType = o.gridType === 'square' ? 'square' : 'hex';
    const valueProp = o.valueProperty || null;

    const bbox = getBboxPadded(fc, 0.05);
    const grid = gridType === 'hex'
        ? turf.hexGrid(bbox, cellKm, { units: 'kilometers' })
        : turf.squareGrid(bbox, cellKm, { units: 'kilometers' });
    if (!grid.features.length) return grid;

    // Aggregate per cell.
    grid.features.forEach(function (cell) {
        let sum = 0;
        fc.features.forEach(function (p) {
            if (!p.geometry || p.geometry.type !== 'Point') return;
            if (turf.booleanPointInPolygon(p, cell)) {
                if (valueProp) {
                    const v = Number((p.properties || {})[valueProp]);
                    if (Number.isFinite(v)) sum += v;
                } else {
                    sum += 1;
                }
            }
        });
        cell.properties = cell.properties || {};
        cell.properties.value = sum;
        cell.properties._cx = turf.centroid(cell).geometry.coordinates[0];
        cell.properties._cy = turf.centroid(cell).geometry.coordinates[1];
    });

    const values = grid.features.map(function (c) { return c.properties.value; });
    const n = values.length;
    if (n < 2) return grid;
    const mean = ss.mean(values);
    const stddev = ss.standardDeviation(values);
    if (stddev === 0) {
        grid.features.forEach(function (c) {
            c.properties.zScore = 0;
            c.properties.pValue = 1;
            c.properties.bucket = 'neutral';
        });
        return grid;
    }

    // Pre-compute centroids for distance.
    const centroids = grid.features.map(function (c) {
        return [c.properties._cx, c.properties._cy];
    });

    // Compute Gi* per cell.
    grid.features.forEach(function (cell, i) {
        let sumWX = 0;
        let sumW = 0;
        let sumW2 = 0;
        const ci = centroids[i];
        for (let j = 0; j < n; j++) {
            const cj = centroids[j];
            const dist = turf.distance(ci, cj, { units: 'meters' });
            const w = dist <= distanceMeters ? 1 : 0;
            sumW += w;
            sumW2 += w * w;
            sumWX += w * values[j];
        }
        const numerator = sumWX - mean * sumW;
        const denominator = stddev * Math.sqrt(((n * sumW2) - (sumW * sumW)) / (n - 1));
        const z = denominator === 0 ? 0 : numerator / denominator;
        cell.properties.zScore = z;
        cell.properties.pValue = twoTailedP(z);
        cell.properties.bucket = bucket(z);
    });

    grid.meta = {
        algorithm: 'getis-ord-gi-star',
        cellKm: cellKm,
        distanceMeters: distanceMeters,
        gridType: gridType,
        n: n,
        mean: mean,
        stddev: stddev
    };
    return grid;
}
