/*
 * Light helpers for building GeoJSON from search results.
 *
 * Phase 1 ships only the minimum needed for the foundation viz: a row -> Point
 * Feature mapping that auto-detects common lat/lon aliases. Phase 2's
 * dataFitness module will replace this with the full alias / WKT / GeoJSON /
 * geohash detection pipeline.
 */

export const EMPTY_FEATURE_COLLECTION = Object.freeze({
    type: 'FeatureCollection',
    features: []
});

const LAT_ALIASES = ['lat', 'latitude', 'Latitude', 'lat_dd', 'geo_lat', 'y', 'Y'];
const LON_ALIASES = ['lon', 'lng', 'longitude', 'Longitude', 'lon_dd', 'geo_lon', 'x', 'X'];

export function detectLatLonFields(fields) {
    if (!Array.isArray(fields) || fields.length === 0) {
        return { lat: null, lon: null };
    }
    const names = fields.map((f) => (f && f.name) || '');
    return {
        lat: pickFirst(names, LAT_ALIASES),
        lon: pickFirst(names, LON_ALIASES)
    };
}

function pickFirst(names, candidates) {
    for (let i = 0; i < candidates.length; i++) {
        if (names.indexOf(candidates[i]) !== -1) {
            return candidates[i];
        }
    }
    return null;
}

/**
 * Build a GeoJSON FeatureCollection from Splunk-shaped row data.
 *
 * @param {object} input
 * @param {Array} input.rows    Splunk row arrays (oldest-first by convention)
 * @param {Array} input.fields  Splunk field descriptors (must include `name`)
 * @param {string} [input.latField] Override for the latitude column name
 * @param {string} [input.lonField] Override for the longitude column name
 * @returns {object} GeoJSON FeatureCollection of Point features
 */
export function rowsToPointCollection(input) {
    const rows = (input && input.rows) || [];
    const fields = (input && input.fields) || [];
    if (rows.length === 0 || fields.length === 0) {
        return cloneEmpty();
    }

    const colIdx = indexFields(fields);
    const detected = detectLatLonFields(fields);
    const latName = input.latField || detected.lat;
    const lonName = input.lonField || detected.lon;
    if (!latName || !lonName) {
        return cloneEmpty();
    }
    const latIdx = colIdx[latName];
    const lonIdx = colIdx[lonName];
    if (latIdx === undefined || lonIdx === undefined) {
        return cloneEmpty();
    }

    const features = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const lat = toNumber(row[latIdx]);
        const lon = toNumber(row[lonIdx]);
        if (!isFiniteLatLon(lat, lon)) {
            continue;
        }
        const props = {};
        for (let j = 0; j < fields.length; j++) {
            if (j === latIdx || j === lonIdx) {
                continue;
            }
            props[fields[j].name] = row[j];
        }
        features.push({
            type: 'Feature',
            id: i,
            geometry: { type: 'Point', coordinates: [lon, lat] },
            properties: props
        });
    }

    return { type: 'FeatureCollection', features: features };
}

function cloneEmpty() {
    return { type: 'FeatureCollection', features: [] };
}

function indexFields(fields) {
    const out = {};
    for (let i = 0; i < fields.length; i++) {
        if (fields[i] && fields[i].name) {
            out[fields[i].name] = i;
        }
    }
    return out;
}

function toNumber(v) {
    if (v === null || v === undefined || v === '') {
        return NaN;
    }
    const n = parseFloat(v);
    return isNaN(n) ? NaN : n;
}

function isFiniteLatLon(lat, lon) {
    return (
        Number.isFinite(lat) &&
        Number.isFinite(lon) &&
        lat >= -90 &&
        lat <= 90 &&
        lon >= -180 &&
        lon <= 180
    );
}
