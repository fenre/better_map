/*
 * Spatial join helpers — backed by turf.
 *
 * Three operations:
 *
 *   pointInPolygon(points, polygons, opts)
 *     For each point, find the polygon containing it and copy
 *     `opts.copyProperties` from polygon to point.
 *
 *   distanceAlongLine(points, line, opts)
 *     For each point, snap to the nearest position on the line and
 *     record the along-distance in metres.
 *
 *   buffer(features, radiusMeters)
 *     Standard turf.buffer wrapped so units are always metres.
 *
 * Returns derived FeatureCollections — never mutates the inputs.
 *
 * Companion: this module also emits "SPL helper macros" via
 * `spatialJoinSPL()` so dashboard authors can run the same join
 * server-side. The macros use Splunk's `geomatch` and `geom` commands.
 */

import * as turf from '@turf/turf';

function pointsOnly(fc) {
    if (!fc || !fc.features) return [];
    return fc.features.filter(function (f) {
        return f.geometry && f.geometry.type === 'Point';
    });
}

function polygonsOnly(fc) {
    if (!fc || !fc.features) return [];
    return fc.features.filter(function (f) {
        return f.geometry && (f.geometry.type === 'Polygon' || f.geometry.type === 'MultiPolygon');
    });
}

/**
 * Point-in-polygon join.
 *
 * @param {object} pointsFC
 * @param {object} polygonsFC
 * @param {object} opts
 *   copyProperties?: string[]   keys to copy from polygon to point
 *   resultProperty?: string     name of the boolean "matched" property (default 'matched')
 */
export function pointInPolygon(pointsFC, polygonsFC, opts) {
    const o = opts || {};
    const copy = o.copyProperties || [];
    const matchKey = o.resultProperty || 'matched';
    const points = pointsOnly(pointsFC);
    const polys = polygonsOnly(polygonsFC);
    const out = points.map(function (p) {
        const next = {
            type: 'Feature',
            geometry: p.geometry,
            properties: Object.assign({}, p.properties || {})
        };
        next.properties[matchKey] = false;
        for (let i = 0; i < polys.length; i++) {
            try {
                if (turf.booleanPointInPolygon(p, polys[i])) {
                    next.properties[matchKey] = true;
                    const pp = polys[i].properties || {};
                    copy.forEach(function (k) {
                        if (pp[k] !== undefined) next.properties[k] = pp[k];
                    });
                    break;
                }
            } catch (_e) { /* swallow */ }
        }
        return next;
    });
    return { type: 'FeatureCollection', features: out };
}

/**
 * For each point, compute distance along the line.
 *
 * @param {object} pointsFC
 * @param {object} lineFeature      Feature<LineString>
 * @param {object} opts
 *   resultProperty?: string        property name for the along-meters value (default 'alongMeters')
 */
export function distanceAlongLine(pointsFC, lineFeature, opts) {
    const o = opts || {};
    const key = o.resultProperty || 'alongMeters';
    const points = pointsOnly(pointsFC);
    if (!lineFeature || !lineFeature.geometry) return { type: 'FeatureCollection', features: [] };
    const out = points.map(function (p) {
        const snapped = turf.nearestPointOnLine(lineFeature, p, { units: 'meters' });
        const along = snapped && snapped.properties ? snapped.properties.location * 1000 : null;
        return {
            type: 'Feature',
            geometry: p.geometry,
            properties: Object.assign({}, p.properties || {}, { [key]: along })
        };
    });
    return { type: 'FeatureCollection', features: out };
}

/**
 * Buffer a feature collection by radius (meters).
 */
export function buffer(fc, radiusMeters) {
    if (!fc) return null;
    try {
        return turf.buffer(fc, radiusMeters, { units: 'meters' });
    } catch (_e) {
        return null;
    }
}

/**
 * Emit ready-to-paste SPL macros for the equivalent server-side join.
 * Dashboard authors can drop these into `macros.conf`.
 */
export function spatialJoinSPL() {
    return {
        pointInPolygon: ''
            + '`bm_point_in_polygon(point_index, polygon_lookup, out_field)`\n'
            + '-- Definition (macros.conf):\n'
            + '-- definition = | inputlookup $polygon_lookup$ | geom\n'
            + '--              | rename featureId AS $out_field$\n'
            + '--              | join type=outer src_ip\n'
            + '--                [ search index=$point_index$ | geomatch $polygon_lookup$ ]\n',
        bufferAroundIncident: ''
            + '`bm_buffer_around(point_index, lat, lng, radius_meters)`\n'
            + '-- Returns events within radius_meters of (lat, lng) using haversine eval.\n'
            + '-- definition = search index=$point_index$\n'
            + '--   | eval _dist_m = 6371000 * acos(\n'
            + '--       cos(pi()/180 * $lat$) * cos(pi()/180 * lat) *\n'
            + '--       cos(pi()/180 * lng - pi()/180 * $lng$) +\n'
            + '--       sin(pi()/180 * $lat$) * sin(pi()/180 * lat))\n'
            + '--   | where _dist_m <= $radius_meters$\n'
    };
}
