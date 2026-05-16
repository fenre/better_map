/*
 * Nearest-Neighbour Distance (NND) analytics.
 *
 * For each input point, finds its nearest neighbour and records the
 * distance (metres). Returns:
 *
 *   { histogram: [...bins...], stats: {...}, perFeature: FeatureCollection }
 *
 * Also runs a Complete Spatial Randomness (CSR) test using Clark &
 * Evans' R statistic:
 *
 *   R = mean(NND) / 0.5 · √(A / N)
 *
 * Z-score is computed against the expected mean for a Poisson process
 * over the bounding-box area:
 *
 *   E[d] = 0.5 · √(A / N)
 *   σ[d] = 0.26136 · √(A / N²)
 *
 * R < 1 ⇒ clustered, R = 1 ⇒ random, R > 1 ⇒ dispersed.
 * |z| > 1.96 ⇒ significant at 95% confidence.
 */

import * as turf from '@turf/turf';
import * as ss from 'simple-statistics';

const EARTH_RADIUS_M = 6378137;

function haversineMeters(a, b) {
    const lat1 = a[1] * Math.PI / 180;
    const lat2 = b[1] * Math.PI / 180;
    const dLat = (b[1] - a[1]) * Math.PI / 180;
    const dLng = (b[0] - a[0]) * Math.PI / 180;
    const h = Math.sin(dLat / 2) ** 2 + Math.cos(lat1) * Math.cos(lat2) * Math.sin(dLng / 2) ** 2;
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

function bboxAreaM2(bb) {
    const widthKm = turf.distance([bb[0], bb[1]], [bb[2], bb[1]], { units: 'kilometers' });
    const heightKm = turf.distance([bb[0], bb[1]], [bb[0], bb[3]], { units: 'kilometers' });
    return widthKm * heightKm * 1e6;
}

/**
 * @param {object} fc      input FeatureCollection (points)
 * @param {object} opts
 *   bins?: number         histogram bin count (default 20)
 * @returns {object}       { histogram, stats, perFeature }
 */
export function compute(fc, opts) {
    if (!fc || !fc.features) return null;
    const points = fc.features.filter(function (f) {
        return f.geometry && f.geometry.type === 'Point';
    });
    if (points.length < 2) return null;
    const o = opts || {};
    const bins = o.bins || 20;

    const distances = [];
    const perFeature = [];
    for (let i = 0; i < points.length; i++) {
        let best = Infinity;
        const ci = points[i].geometry.coordinates;
        for (let j = 0; j < points.length; j++) {
            if (i === j) continue;
            const d = haversineMeters(ci, points[j].geometry.coordinates);
            if (d < best) best = d;
        }
        if (Number.isFinite(best)) {
            distances.push(best);
            perFeature.push({
                type: 'Feature',
                geometry: points[i].geometry,
                properties: Object.assign({}, points[i].properties || {}, { nnd_m: best })
            });
        }
    }

    if (!distances.length) return null;
    const meanD = ss.mean(distances);
    const minD = ss.min(distances);
    const maxD = ss.max(distances);
    const stddev = ss.standardDeviation(distances);

    // CSR statistic.
    const bb = turf.bbox(fc);
    const areaM2 = bboxAreaM2(bb);
    const n = points.length;
    const expectedMean = 0.5 * Math.sqrt(areaM2 / n);
    const expectedSigma = 0.26136 * Math.sqrt(areaM2 / (n * n));
    const R = expectedMean > 0 ? meanD / expectedMean : NaN;
    const z = expectedSigma > 0 ? (meanD - expectedMean) / expectedSigma : NaN;
    const pVal = Number.isFinite(z) ? 2 * (1 - ss.cumulativeStdNormalProbability(Math.abs(z))) : NaN;
    let conclusion;
    if (Math.abs(z) < 1.96) conclusion = 'random';
    else if (R < 1) conclusion = 'clustered';
    else conclusion = 'dispersed';

    // Histogram.
    const histogram = [];
    if (maxD > minD) {
        const w = (maxD - minD) / bins;
        const counts = new Array(bins).fill(0);
        distances.forEach(function (d) {
            const idx = Math.min(bins - 1, Math.floor((d - minD) / w));
            counts[idx] += 1;
        });
        for (let i = 0; i < bins; i++) {
            histogram.push({
                fromMeters: minD + i * w,
                toMeters: minD + (i + 1) * w,
                count: counts[i]
            });
        }
    }

    return {
        algorithm: 'nearest-neighbor-distance',
        stats: {
            n: n,
            meanMeters: meanD,
            stdDevMeters: stddev,
            minMeters: minD,
            maxMeters: maxD,
            expectedMean: expectedMean,
            R: R,
            zScore: z,
            pValue: pVal,
            conclusion: conclusion
        },
        histogram: histogram,
        perFeature: { type: 'FeatureCollection', features: perFeature }
    };
}
