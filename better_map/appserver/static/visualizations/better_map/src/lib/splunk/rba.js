/*
 * Risk-Based Alerting (RBA) helpers.
 *
 * Two surfaces:
 *
 *   1. `riskHeatmapSPL(opts)` returns a ready-to-paste SPL snippet
 *      that aggregates accumulated risk per geography. Dashboard
 *      authors drop this into a data source and the map renders the
 *      result automatically (via the choropleth or hexbin layer).
 *
 *   2. `parseRiskRows(rows)` normalises the SPL output rows into a
 *      GeoJSON FeatureCollection ready to feed into the layer
 *      dispatcher.
 *
 * The SPL helper assumes the standard ES Risk Framework schema:
 *
 *   index=risk
 *     risk_object        the entity (host, src, src_user, ...)
 *     risk_object_type   "system" | "user" | "other"
 *     risk_score         numeric impact
 *     calculated_risk_score   (preferred when available)
 *
 * For geographic aggregation we expect each risk event to carry
 * `lat`/`lng` (typically via an asset lookup). The output is bucketed
 * by hex grid or by a `region` field.
 *
 * BM-CT-1: setEnabled / isEnabled / reset.
 */

let _enabled = true;
let _defaults = {
    earliest: '-24h',
    latest: 'now',
    riskField: 'calculated_risk_score',
    riskFallback: 'risk_score',
    hexResolution: 7
};

export function configure(opts) {
    if (opts) Object.assign(_defaults, opts);
}

/**
 * Emit the SPL fragment for an accumulated-risk heatmap.
 *
 * @param {object} opts
 *   earliest?: string
 *   latest?: string
 *   filter?: string  additional SPL filter
 *   groupBy?: 'hex'|'region'  default 'hex'
 *   regionField?: string (required when groupBy='region')
 *   hexResolution?: number (1-12; default 7 — ~5km hexes)
 */
export function riskHeatmapSPL(opts) {
    const o = Object.assign({}, _defaults, opts || {});
    const filter = o.filter ? ' AND ' + o.filter : '';
    const earliest = o.earliest;
    const latest = o.latest;
    const riskField = o.riskField;
    const fallback = o.riskFallback;
    const groupBy = o.groupBy || 'hex';

    if (groupBy === 'region') {
        if (!o.regionField) return '/* riskHeatmapSPL: regionField required */';
        return ''
            + 'index=risk earliest=' + earliest + ' latest=' + latest + filter + '\n'
            + '| eval risk = coalesce(' + riskField + ', ' + fallback + ', 0)\n'
            + '| eval region = ' + o.regionField + '\n'
            + '| stats sum(risk) AS total_risk, count AS event_count, dc(risk_object) AS entity_count BY region\n'
            + '| sort - total_risk';
    }
    // Hex aggregation: requires lat/lng on every risk event.
    return ''
        + 'index=risk earliest=' + earliest + ' latest=' + latest + filter + '\n'
        + '| eval risk = coalesce(' + riskField + ', ' + fallback + ', 0)\n'
        + '| where isnotnull(lat) AND isnotnull(lng)\n'
        + '| geostats latfield=lat longfield=lng zl=' + o.hexResolution + ' sum(risk) AS total_risk count AS event_count';
}

/**
 * Convert risk-rows (output of riskHeatmapSPL or geostats) into a
 * GeoJSON FeatureCollection the layer dispatcher can render.
 */
export function parseRiskRows(rows) {
    if (!rows || !rows.length) return { type: 'FeatureCollection', features: [] };
    // geostats outputs polygons in WKT form — naïvely parse hex cells.
    // For non-geostats rows we fall back to centroid points.
    const features = rows.map(function (r) {
        if (r.geom && typeof r.geom === 'string') {
            // Splunk geostats writes geojson polygons in `geom` as a JSON string.
            try {
                const geom = JSON.parse(r.geom);
                return { type: 'Feature', geometry: geom, properties: r };
            } catch (_e) { /* swallow */ }
        }
        if (Number.isFinite(Number(r.latitude)) && Number.isFinite(Number(r.longitude))) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [Number(r.longitude), Number(r.latitude)] },
                properties: r
            };
        }
        if (Number.isFinite(Number(r.lat)) && Number.isFinite(Number(r.lng))) {
            return {
                type: 'Feature',
                geometry: { type: 'Point', coordinates: [Number(r.lng), Number(r.lat)] },
                properties: r
            };
        }
        return null;
    }).filter(Boolean);
    return { type: 'FeatureCollection', features: features };
}

/* BM-CT-1 */
export function setEnabled(on) { _enabled = !!on; }
export function isEnabled() { return _enabled; }
export function reset() {
    _defaults = {
        earliest: '-24h',
        latest: 'now',
        riskField: 'calculated_risk_score',
        riskFallback: 'risk_score',
        hexResolution: 7
    };
}
