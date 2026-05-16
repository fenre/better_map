/*
 * Local Moran's I (LISA — Local Indicators of Spatial Association).
 *
 * For each cell i:
 *   Ii = zi · Σ(wij · zj)
 * where zi is the z-score of the value at cell i, and wij is a binary
 * neighbour weight (1 if cell j is within `distanceMeters` of i).
 *
 * Combined with the sign of zi and the sign of the weighted neighbour
 * mean, each cell is classified as one of:
 *
 *   HH   high-high cluster   (hot-spot)
 *   LL   low-low cluster     (cold-spot)
 *   HL   high-low outlier
 *   LH   low-high outlier
 *   --   not significant
 *
 * Significance via two-tailed normal approximation of the Ii statistic
 * (acceptable for visualisation; rigorous permutation tests can be
 * layered on later).
 */

import * as turf from '@turf/turf';
import * as ss from 'simple-statistics';

function twoTailedP(z) {
    return 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(z)));
}

function classifyLISA(zi, neighborMean, pValue) {
    if (pValue > 0.05) return '--';
    if (zi > 0 && neighborMean > 0) return 'HH';
    if (zi < 0 && neighborMean < 0) return 'LL';
    if (zi > 0 && neighborMean < 0) return 'HL';
    if (zi < 0 && neighborMean > 0) return 'LH';
    return '--';
}

/**
 * @param {object} fc      input FeatureCollection (points or polygons)
 * @param {object} opts
 *   cellKm?: number       cell size (default 5; ignored for polygon input)
 *   distanceMeters?: number   neighbour cutoff (default 10 km)
 *   valueProperty?: string    aggregate this property; default = count
 *   gridType?: 'hex'|'square' default hex
 */
export function compute(fc, opts) {
    if (!fc || !fc.features || !fc.features.length) {
        return { type: 'FeatureCollection', features: [] };
    }
    const o = opts || {};
    const cellKm = Number(o.cellKm) || 5;
    const distanceMeters = Number(o.distanceMeters) || 10000;
    const gridType = o.gridType === 'square' ? 'square' : 'hex';
    const valueProp = o.valueProperty || null;

    // Build aggregation grid.
    const bb = turf.bbox(fc);
    const grid = gridType === 'hex'
        ? turf.hexGrid(bb, cellKm, { units: 'kilometers' })
        : turf.squareGrid(bb, cellKm, { units: 'kilometers' });
    if (!grid.features.length) return grid;

    grid.features.forEach(function (cell) {
        let val = 0;
        fc.features.forEach(function (p) {
            if (!p.geometry || p.geometry.type !== 'Point') return;
            if (!turf.booleanPointInPolygon(p, cell)) return;
            if (valueProp) {
                const v = Number((p.properties || {})[valueProp]);
                if (Number.isFinite(v)) val += v;
            } else {
                val += 1;
            }
        });
        cell.properties = cell.properties || {};
        cell.properties.value = val;
    });

    const values = grid.features.map(function (c) { return c.properties.value; });
    if (values.length < 4) return grid;
    const mean = ss.mean(values);
    const stddev = ss.standardDeviation(values);
    if (stddev === 0) return grid;

    const zScores = values.map(function (v) { return (v - mean) / stddev; });
    const centroids = grid.features.map(function (c) {
        const ct = turf.centroid(c).geometry.coordinates;
        return ct;
    });

    grid.features.forEach(function (cell, i) {
        const zi = zScores[i];
        let weightedSum = 0;
        let wSum = 0;
        for (let j = 0; j < zScores.length; j++) {
            if (i === j) continue;
            const dist = turf.distance(centroids[i], centroids[j], { units: 'meters' });
            const w = dist <= distanceMeters ? 1 : 0;
            weightedSum += w * zScores[j];
            wSum += w;
        }
        const neighborMean = wSum > 0 ? (weightedSum / wSum) : 0;
        const Ii = zi * weightedSum;
        // Expected E[Ii] = -1 / (n-1); approximate var via simple formula.
        const n = zScores.length;
        const eI = -1 / (n - 1);
        // simplified variance for binary weights:
        const varI = wSum > 0 ? (wSum * (n - wSum) / (n - 1)) : 1;
        const zI = (Ii - eI) / Math.sqrt(varI || 1);
        const pVal = twoTailedP(zI);
        cell.properties.lisa_I = Ii;
        cell.properties.lisa_z = zI;
        cell.properties.lisa_p = pVal;
        cell.properties.lisa_class = classifyLISA(zi, neighborMean, pVal);
    });

    grid.meta = {
        algorithm: 'lisa-moran-i',
        cellKm: cellKm,
        distanceMeters: distanceMeters,
        n: values.length
    };
    return grid;
}
