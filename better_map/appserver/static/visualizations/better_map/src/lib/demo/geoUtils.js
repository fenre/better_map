/*
 * demo/geoUtils.js — geographic helpers for the demo data pack.
 *
 * Just enough geometry to produce demo paths that "look like roads"
 * (jittered great-circle interpolation between waypoints) and to
 * scatter sensors believably across a building footprint.  No real
 * dependency on turf.js or proj4 — bundle weight matters and the
 * approximation error of treating lat/lon as a local plane is
 * acceptable at city scale (where every preset lives).
 */

var DEG_TO_RAD = Math.PI / 180;
var RAD_TO_DEG = 180 / Math.PI;
var EARTH_RADIUS_M = 6371000;

/**
 * Linearly interpolate two lat/lon pairs.  For very long legs (>~100
 * km) this drifts vs the great-circle, but every demo preset stays
 * inside a metro area where the drift is well under a pixel at the
 * default zoom.
 *
 * @param {[number, number]} a  [lon, lat]
 * @param {[number, number]} b  [lon, lat]
 * @param {number} t  0..1
 * @returns {[number, number]}
 */
export function lerpLatLon(a, b, t) {
    return [
        a[0] + (b[0] - a[0]) * t,
        a[1] + (b[1] - a[1]) * t
    ];
}

/**
 * Jitter a coordinate by up to `radiusM` metres in a random
 * direction.  Useful for "this truck is on a road but the GPS
 * resolution is ~10 m", or for scattering sensors across a building
 * footprint.
 *
 * @param {[number, number]} lonLat  [lon, lat]
 * @param {number} radiusM           Max displacement in metres
 * @param {{ next: () => number }} rng  Seeded RNG (see ./rng.js)
 * @returns {[number, number]}
 */
export function jitter(lonLat, radiusM, rng) {
    var lon = lonLat[0];
    var lat = lonLat[1];
    var distance = rng.next() * radiusM;
    var bearing = rng.next() * 2 * Math.PI;
    // 1 degree latitude ≈ 111_320 m (close enough at city scale).
    // 1 degree longitude shrinks with cos(lat).
    var dLat = (distance * Math.cos(bearing)) / 111320;
    var dLon = (distance * Math.sin(bearing)) /
        (111320 * Math.cos(lat * DEG_TO_RAD));
    return [lon + dLon, lat + dLat];
}

/**
 * Initial bearing in degrees from a → b on a great circle.
 * 0° = north, 90° = east.  Used by the markers/extrusion layers to
 * orient direction-aware icons (e.g. truck heading).
 */
export function bearing(a, b) {
    var lat1 = a[1] * DEG_TO_RAD;
    var lat2 = b[1] * DEG_TO_RAD;
    var dLon = (b[0] - a[0]) * DEG_TO_RAD;
    var y = Math.sin(dLon) * Math.cos(lat2);
    var x = Math.cos(lat1) * Math.sin(lat2) -
        Math.sin(lat1) * Math.cos(lat2) * Math.cos(dLon);
    return (Math.atan2(y, x) * RAD_TO_DEG + 360) % 360;
}

/**
 * Haversine distance in metres.  Used to skip waypoints that are
 * unrealistically close (e.g. truck "parked" at depot).
 */
export function distanceM(a, b) {
    var lat1 = a[1] * DEG_TO_RAD;
    var lat2 = b[1] * DEG_TO_RAD;
    var dLat = lat2 - lat1;
    var dLon = (b[0] - a[0]) * DEG_TO_RAD;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
        Math.cos(lat1) * Math.cos(lat2) *
        Math.sin(dLon / 2) * Math.sin(dLon / 2);
    return 2 * EARTH_RADIUS_M * Math.asin(Math.sqrt(h));
}

/**
 * Build a multi-waypoint route as N evenly-spaced (interpolated +
 * jittered) points.  Used to synthesise truck trajectories that
 * approximate following a road grid without needing a routing
 * engine.
 *
 * @param {[number, number][]} waypoints  ≥ 2 anchor [lon, lat] pairs
 * @param {number} count                  Total points to emit
 * @param {number} jitterM                Per-point jitter radius
 * @param {{ next: () => number }} rng
 * @returns {[number, number][]}
 */
export function pathAlong(waypoints, count, jitterM, rng) {
    if (!waypoints || waypoints.length < 2) {
        return [];
    }
    var legs = waypoints.length - 1;
    var pointsPerLeg = Math.max(1, Math.floor(count / legs));
    var out = [];
    for (var i = 0; i < legs; i++) {
        var a = waypoints[i];
        var b = waypoints[i + 1];
        var n = (i === legs - 1)
            ? count - out.length
            : pointsPerLeg;
        for (var j = 0; j < n; j++) {
            var t = (j + 0.5) / n;
            var p = lerpLatLon(a, b, t);
            out.push(jitter(p, jitterM, rng));
        }
    }
    return out;
}
