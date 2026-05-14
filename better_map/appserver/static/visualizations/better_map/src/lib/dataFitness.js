/*
 * dataFitness - schema and geometry inference for Splunk row data.
 *
 * Better Map accepts a wide range of geographic representations without
 * requiring users to rename or reshape their search results:
 *
 *   - Point coordinates as numeric fields with any of the common aliases
 *     (`lat`/`latitude`, `lon`/`lng`/`longitude`, etc.)
 *   - Point coordinates encoded as `geohash` strings
 *   - Point/line/polygon geometry as `WKT` strings
 *     (POINT, LINESTRING, POLYGON, MULTIPOINT, MULTILINESTRING, MULTIPOLYGON)
 *   - GeoJSON Feature / Geometry strings in any field
 *   - Pre-grouped path rows tied together by a `pathId` (Phase 2 paths layer)
 *
 * The analyze() entry-point returns a structured report the layer router in
 * `lib/layers/index.js` uses to decide which layer modules to mount.
 *
 * The analyser is deliberately tolerant: malformed rows are skipped with a
 * single aggregated warning rather than throwing, so a noisy data source
 * does not break an otherwise-functional dashboard.
 */

// -----------------------------------------------------------------------
// Field-name aliases

const LAT_ALIASES = [
    'lat',
    'latitude',
    'Latitude',
    'LATITUDE',
    'lat_dd',
    'geo_lat',
    'GeoLat',
    'y',
    'Y'
];

const LON_ALIASES = [
    'lon',
    'lng',
    'longitude',
    'Longitude',
    'LONGITUDE',
    'lon_dd',
    'lng_dd',
    'geo_lon',
    'geo_lng',
    'GeoLon',
    'x',
    'X'
];

const GEOHASH_ALIASES = ['geohash', 'GeoHash', 'geo_hash'];
const WKT_ALIASES = ['wkt', 'WKT', 'geom_wkt', 'geometry_wkt'];
const GEOJSON_ALIASES = [
    'geojson',
    'GeoJSON',
    'geo_json',
    'feature',
    'geometry',
    'shape'
];
const TIME_ALIASES = ['_time', 'time', 'timestamp', 'Time'];
const LAYER_ALIASES = ['layer', 'Layer', 'layer_id', 'category'];
const PATH_ID_ALIASES = ['pathId', 'path_id', 'track_id', 'route_id', 'trip_id'];
const VALUE_ALIASES = ['value', 'metric', 'weight', 'count', 'measurement'];
const HEIGHT_ALIASES = ['height', 'elevation', 'extrusion_height'];
const FLOOR_ALIASES = ['floor', 'level', 'floor_id'];
const ID_ALIASES = ['id', 'feature_id', 'iso', 'iso2', 'iso3', 'admin1', 'state', 'country'];
const POPUP_ALIASES = ['popup', 'tooltip', 'description'];
const ICON_ALIASES = ['icon', 'symbol'];
const COLOR_ALIASES = ['color', 'colour'];
const SIZE_ALIASES = ['size', 'radius'];

// -----------------------------------------------------------------------
// Public API

/**
 * Analyse a Splunk results payload.
 *
 * @param {{ rows: any[], fields: any[] }} input - Splunk row_major output
 * @param {object}  [opts]
 * @param {string}  [opts.latField]    explicit lat field name
 * @param {string}  [opts.lonField]    explicit lon field name
 * @param {boolean} [opts.autoSwap]    auto-correct an inverted lat/lon column pair
 * @returns {object} analysis report
 */
export function analyze(input, opts) {
    const rows = (input && input.rows) || [];
    const fields = (input && input.fields) || [];
    const options = opts || {};
    const warnings = [];
    const fieldNames = fields.map((f) => (f && f.name) || '');
    const colIdx = indexFields(fields);

    const detected = {
        latField: options.latField || pickField(fieldNames, LAT_ALIASES),
        lonField: options.lonField || pickField(fieldNames, LON_ALIASES),
        geohashField: pickField(fieldNames, GEOHASH_ALIASES),
        wktField: pickField(fieldNames, WKT_ALIASES),
        geojsonField: pickField(fieldNames, GEOJSON_ALIASES),
        timeField: pickField(fieldNames, TIME_ALIASES),
        layerField: pickField(fieldNames, LAYER_ALIASES),
        pathIdField: pickField(fieldNames, PATH_ID_ALIASES),
        valueField: pickField(fieldNames, VALUE_ALIASES),
        heightField: pickField(fieldNames, HEIGHT_ALIASES),
        floorField: pickField(fieldNames, FLOOR_ALIASES),
        idField: pickField(fieldNames, ID_ALIASES),
        popupField: pickField(fieldNames, POPUP_ALIASES),
        iconField: pickField(fieldNames, ICON_ALIASES),
        colorField: pickField(fieldNames, COLOR_ALIASES),
        sizeField: pickField(fieldNames, SIZE_ALIASES)
    };

    const points = [];
    const lines = [];
    const polygons = [];
    const pathBuckets = new Map(); // pathId -> array of {lon, lat, time, props}
    let skipped = 0;
    let swapSuspect = 0;

    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const props = buildProps(fields, row, colIdx, detected);

        // Path rows take precedence over single-point coordinates: if the
        // row has a pathId AND coords, accumulate it for the paths layer.
        const lonLat = readLonLat(row, colIdx, detected);
        if (detected.pathIdField && lonLat) {
            const pid = String(row[colIdx[detected.pathIdField]] || '');
            if (pid) {
                if (!pathBuckets.has(pid)) {
                    pathBuckets.set(pid, []);
                }
                pathBuckets.get(pid).push({
                    lon: lonLat[0],
                    lat: lonLat[1],
                    time: detected.timeField
                        ? row[colIdx[detected.timeField]]
                        : undefined,
                    props: props
                });
                continue;
            }
        }

        // WKT / GeoJSON take precedence over scalar lat/lon if both exist
        // on the same row (the user explicitly supplied a richer geometry).
        let geometry = null;
        if (detected.geojsonField) {
            geometry = tryParseGeoJsonString(row[colIdx[detected.geojsonField]]);
        }
        if (!geometry && detected.wktField) {
            geometry = tryParseWkt(row[colIdx[detected.wktField]]);
        }
        if (!geometry && detected.geohashField) {
            geometry = tryGeohashToPoint(row[colIdx[detected.geohashField]]);
        }
        if (!geometry && lonLat) {
            // Heuristic lat/lon swap detection.
            const lonF = lonLat[0];
            const latF = lonLat[1];
            if (Math.abs(latF) > 90 && Math.abs(lonF) <= 90) {
                swapSuspect++;
                if (options.autoSwap) {
                    geometry = { type: 'Point', coordinates: [latF, lonF] };
                } else {
                    skipped++;
                    continue;
                }
            } else {
                geometry = { type: 'Point', coordinates: [lonF, latF] };
            }
        }

        if (!geometry) {
            skipped++;
            continue;
        }

        const feature = {
            type: 'Feature',
            id: i,
            geometry: geometry,
            properties: props
        };

        switch (geometry.type) {
            case 'Point':
            case 'MultiPoint':
                points.push(feature);
                break;
            case 'LineString':
            case 'MultiLineString':
                lines.push(feature);
                break;
            case 'Polygon':
            case 'MultiPolygon':
                polygons.push(feature);
                break;
            default:
                skipped++;
        }
    }

    // Materialise grouped paths into LineString features.
    pathBuckets.forEach((pts, pathId) => {
        if (pts.length < 2) {
            // Pathologically short paths become point markers.
            for (let j = 0; j < pts.length; j++) {
                points.push({
                    type: 'Feature',
                    id: pathId + ':' + j,
                    geometry: { type: 'Point', coordinates: [pts[j].lon, pts[j].lat] },
                    properties: Object.assign({}, pts[j].props, { pathId: pathId })
                });
            }
            return;
        }
        const coords = pts.map((p) => [p.lon, p.lat]);
        const baseProps = Object.assign({}, pts[pts.length - 1].props, {
            pathId: pathId,
            pointCount: pts.length
        });
        lines.push({
            type: 'Feature',
            id: pathId,
            geometry: { type: 'LineString', coordinates: coords },
            properties: baseProps
        });
    });

    if (skipped > 0) {
        warnings.push({
            code: 'rows_skipped',
            message:
                'Better Map: skipped ' +
                skipped +
                ' row' +
                (skipped === 1 ? '' : 's') +
                ' with missing or out-of-range coordinates.'
        });
    }
    if (swapSuspect > 0 && !options.autoSwap) {
        warnings.push({
            code: 'lat_lon_swap_suspect',
            message:
                'Better Map: ' +
                swapSuspect +
                ' row' +
                (swapSuspect === 1 ? '' : 's') +
                ' had latitude > 90 or longitude > 180. Enable "Auto-correct lat/lon swap" or fix the search.'
        });
    }

    const layerBuckets = bucketByLayer(points, lines, polygons, colIdx, detected, fields);
    const layerNames = layerBuckets
        ? Array.from(layerBuckets.keys())
        : [];
    const geomKind = pickGeomKind(points.length, lines.length, polygons.length);

    // Tabular rows (without a geometry interpretation) are exposed so the
    // feature-join layer can pair them with a vector backdrop by id.
    const tabular = buildTabularFeatures(rows, fields, colIdx, detected);

    return {
        geomKind: geomKind,
        detected: detected,
        warnings: warnings,
        points: featureCollection(points),
        lines: featureCollection(lines),
        polygons: featureCollection(polygons),
        tabular: featureCollection(tabular),
        layerBuckets: layerBuckets,
        layerNames: layerNames,
        rowCount: rows.length,
        skipped: skipped
    };
}

function buildTabularFeatures(rows, fields, colIdx, detected) {
    const out = [];
    for (let i = 0; i < rows.length; i++) {
        const row = rows[i] || [];
        const props = {};
        for (let j = 0; j < fields.length; j++) {
            const name = fields[j] && fields[j].name;
            if (!name) continue;
            props[name] = row[j];
        }
        if (detected.idField) {
            props.id = row[colIdx[detected.idField]];
        }
        if (detected.valueField) {
            props.value = toNumber(row[colIdx[detected.valueField]]);
        }
        if (detected.layerField) {
            props.layerName = row[colIdx[detected.layerField]];
        }
        out.push({ type: 'Feature', id: i, properties: props });
    }
    return out;
}

// -----------------------------------------------------------------------
// Helpers

function indexFields(fields) {
    const out = {};
    for (let i = 0; i < fields.length; i++) {
        if (fields[i] && fields[i].name) {
            out[fields[i].name] = i;
        }
    }
    return out;
}

function pickField(names, candidates) {
    for (let i = 0; i < candidates.length; i++) {
        if (names.indexOf(candidates[i]) !== -1) {
            return candidates[i];
        }
    }
    return null;
}

function readLonLat(row, colIdx, detected) {
    if (!detected.latField || !detected.lonField) {
        return null;
    }
    const lat = toNumber(row[colIdx[detected.latField]]);
    const lon = toNumber(row[colIdx[detected.lonField]]);
    if (!Number.isFinite(lat) || !Number.isFinite(lon)) {
        return null;
    }
    if (Math.abs(lat) > 90 || Math.abs(lon) > 180) {
        return [lon, lat]; // caller will run the swap heuristic
    }
    return [lon, lat];
}

function toNumber(v) {
    if (v === null || v === undefined || v === '') {
        return NaN;
    }
    const n = parseFloat(v);
    return isNaN(n) ? NaN : n;
}

function buildProps(fields, row, colIdx, detected) {
    const props = {};
    for (let i = 0; i < fields.length; i++) {
        const name = fields[i] && fields[i].name;
        if (!name) continue;
        // Skip raw lat/lon/wkt/geojson/geohash - they are already in
        // `geometry` and would otherwise bloat the popup.
        if (
            name === detected.latField ||
            name === detected.lonField ||
            name === detected.wktField ||
            name === detected.geojsonField ||
            name === detected.geohashField
        ) {
            continue;
        }
        props[name] = row[i];
    }
    // Promote well-known fields onto stable property names so layer
    // modules don't have to guess (dataFitness already detected them).
    if (detected.layerField && detected.layerField in props) {
        props.layerName = String(props[detected.layerField]);
    }
    if (detected.valueField && detected.valueField in props) {
        props.value = toNumber(props[detected.valueField]);
    }
    if (detected.heightField && detected.heightField in props) {
        props.height = toNumber(props[detected.heightField]);
    }
    if (detected.colorField && detected.colorField in props) {
        props.color = props[detected.colorField];
    }
    if (detected.sizeField && detected.sizeField in props) {
        props.size = toNumber(props[detected.sizeField]);
    }
    if (detected.popupField && detected.popupField in props) {
        props.popup = props[detected.popupField];
    }
    if (detected.iconField && detected.iconField in props) {
        props.icon = props[detected.iconField];
    }
    if (detected.timeField && detected.timeField in props) {
        const t = props[detected.timeField];
        const n = toNumber(t);
        props.time = Number.isFinite(n) ? n : Date.parse(t);
    }
    return props;
}

function pickGeomKind(pointCount, lineCount, polygonCount) {
    const counts = [pointCount, lineCount, polygonCount];
    const nonZero = counts.filter((c) => c > 0).length;
    if (nonZero === 0) return 'none';
    if (nonZero > 1) return 'mixed';
    if (pointCount > 0) return 'point';
    if (lineCount > 0) return 'line';
    return 'polygon';
}

function bucketByLayer(points, lines, polygons, colIdx, detected, _fields) {
    if (!detected.layerField) {
        return null;
    }
    const buckets = new Map();
    function bucketOf(feature) {
        const name = feature.properties && feature.properties[detected.layerField];
        if (!name) return null;
        const key = String(name);
        if (!buckets.has(key)) {
            buckets.set(key, { pointFC: featureCollection([]), lineFC: featureCollection([]), polygonFC: featureCollection([]) });
        }
        return buckets.get(key);
    }
    points.forEach((f) => {
        const b = bucketOf(f);
        if (b) b.pointFC.features.push(f);
    });
    lines.forEach((f) => {
        const b = bucketOf(f);
        if (b) b.lineFC.features.push(f);
    });
    polygons.forEach((f) => {
        const b = bucketOf(f);
        if (b) b.polygonFC.features.push(f);
    });
    return buckets;
}

function featureCollection(features) {
    return { type: 'FeatureCollection', features: features };
}

// -----------------------------------------------------------------------
// Geometry parsers

function tryParseGeoJsonString(raw) {
    if (typeof raw !== 'string' || !raw) return null;
    const trimmed = raw.trim();
    if (trimmed.length === 0 || trimmed[0] !== '{') return null;
    let parsed;
    try {
        parsed = JSON.parse(trimmed);
    } catch (_err) {
        return null;
    }
    if (!parsed || typeof parsed !== 'object') return null;
    if (parsed.type === 'Feature' && parsed.geometry) {
        return parsed.geometry;
    }
    if (
        parsed.type === 'Point' ||
        parsed.type === 'MultiPoint' ||
        parsed.type === 'LineString' ||
        parsed.type === 'MultiLineString' ||
        parsed.type === 'Polygon' ||
        parsed.type === 'MultiPolygon'
    ) {
        return parsed;
    }
    return null;
}

/* eslint-disable no-case-declarations */
function tryParseWkt(raw) {
    if (typeof raw !== 'string') return null;
    const text = raw.trim();
    if (!text) return null;
    const upper = text.toUpperCase();

    if (upper.indexOf('POINT') === 0) {
        const coord = parseCoordPair(extractParens(text));
        return coord ? { type: 'Point', coordinates: coord } : null;
    }
    if (upper.indexOf('MULTIPOINT') === 0) {
        const inner = extractParens(text);
        const parts = splitCoords(inner);
        const coords = parts.map(parseCoordPair).filter(Boolean);
        return coords.length ? { type: 'MultiPoint', coordinates: coords } : null;
    }
    if (upper.indexOf('LINESTRING') === 0) {
        const inner = extractParens(text);
        const coords = splitCoords(inner).map(parseCoordPair).filter(Boolean);
        return coords.length >= 2 ? { type: 'LineString', coordinates: coords } : null;
    }
    if (upper.indexOf('MULTILINESTRING') === 0) {
        const inner = extractParens(text);
        const lineGroups = splitGroups(inner).map(function (g) {
            return splitCoords(g).map(parseCoordPair).filter(Boolean);
        });
        return lineGroups.length
            ? { type: 'MultiLineString', coordinates: lineGroups }
            : null;
    }
    if (upper.indexOf('POLYGON') === 0 && upper.indexOf('MULTIPOLYGON') !== 0) {
        const inner = extractParens(text);
        const rings = splitGroups(inner).map(function (g) {
            return splitCoords(g).map(parseCoordPair).filter(Boolean);
        });
        return rings.length ? { type: 'Polygon', coordinates: rings } : null;
    }
    if (upper.indexOf('MULTIPOLYGON') === 0) {
        const inner = extractParens(text);
        const polys = splitGroups(inner, 2).map(function (poly) {
            return splitGroups(poly).map(function (ring) {
                return splitCoords(ring).map(parseCoordPair).filter(Boolean);
            });
        });
        return polys.length ? { type: 'MultiPolygon', coordinates: polys } : null;
    }
    return null;
}
/* eslint-enable no-case-declarations */

function extractParens(s) {
    const open = s.indexOf('(');
    const close = s.lastIndexOf(')');
    if (open < 0 || close < 0 || close <= open) return '';
    return s.substring(open + 1, close);
}

function splitCoords(s) {
    return s.split(',').map((x) => x.trim()).filter(Boolean);
}

function splitGroups(s, depthMin) {
    // Split a string on commas that are at the requested parenthesis depth.
    // For POLYGON inner we want depth-0 separators (rings); for
    // MULTIPOLYGON we want depth-0 separators between polygons (when
    // depthMin is 2 we accept the level-2 groupings of polygons).
    const out = [];
    let depth = 0;
    let start = 0;
    let target = typeof depthMin === 'number' ? depthMin - 1 : 0;
    for (let i = 0; i < s.length; i++) {
        const ch = s.charAt(i);
        if (ch === '(') depth++;
        else if (ch === ')') depth--;
        else if (ch === ',' && depth === target) {
            out.push(s.substring(start, i));
            start = i + 1;
        }
    }
    out.push(s.substring(start));
    return out.map(extractParens).filter(Boolean);
}

function parseCoordPair(text) {
    if (!text) return null;
    const parts = text.replace(/[()]/g, '').trim().split(/\s+/);
    if (parts.length < 2) return null;
    const lon = parseFloat(parts[0]);
    const lat = parseFloat(parts[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
    return [lon, lat];
}

// -----------------------------------------------------------------------
// Geohash decoder (z-curve, base32). Compact and dependency-free.

const GEOHASH_BASE32 = '0123456789bcdefghjkmnpqrstuvwxyz';

function tryGeohashToPoint(raw) {
    if (typeof raw !== 'string') return null;
    const hash = raw.toLowerCase().trim();
    if (!hash || !/^[0-9bcdefghjkmnpqrstuvwxyz]+$/.test(hash)) return null;

    let latLo = -90;
    let latHi = 90;
    let lonLo = -180;
    let lonHi = 180;
    let evenBit = true;

    for (let i = 0; i < hash.length; i++) {
        const idx = GEOHASH_BASE32.indexOf(hash.charAt(i));
        if (idx === -1) return null;
        for (let b = 4; b >= 0; b--) {
            const bit = (idx >> b) & 1;
            if (evenBit) {
                const mid = (lonLo + lonHi) / 2;
                if (bit === 1) lonLo = mid;
                else lonHi = mid;
            } else {
                const mid = (latLo + latHi) / 2;
                if (bit === 1) latLo = mid;
                else latHi = mid;
            }
            evenBit = !evenBit;
        }
    }

    return {
        type: 'Point',
        coordinates: [(lonLo + lonHi) / 2, (latLo + latHi) / 2]
    };
}
