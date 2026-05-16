/*
 * CIM-aware layer auto-detection.
 *
 * Inspects the SPL output fields available on a result row and chooses
 * (a) the most appropriate layer to render and (b) the colour palette
 * that best fits the domain. The goal: a dashboard author can paste a
 * CIM-conformant `| tstats` and get a meaningful map without manually
 * picking the layer type or styling.
 *
 * Supported CIM detections (by inspecting field names):
 *
 *   Authentication      action, src_user, dest, app
 *     → markers + auth palette, color by action (success/failure)
 *   Network Traffic     src, dest, bytes_in, bytes_out
 *     → paths (arc) layer, width by bytes_total, color by action
 *   Web                 url, http_method, status, src
 *     → markers + web palette, color by status_class
 *   Intrusion Detection signature, severity, src, dest
 *     → markers + critical palette, color by severity
 *   Endpoint Processes  process, process_name, user, dest
 *     → markers + endpoint palette, color by action
 *
 * OT extensions (Operational_Telemetry data model):
 *
 *   metric_value + metric_name + asset_lat + asset_lng
 *     → choropleth/markers, color by metric_value
 *
 * Returns: { layerType, layerOptions, palette }
 */

const PALETTES = {
    auth: {
        success: '#00C853',
        failure: '#F74B4A',
        anomaly: '#FFB300',
        default: '#9B59B6'
    },
    web: {
        '2xx': '#00C853',
        '3xx': '#1FBAD6',
        '4xx': '#FFB300',
        '5xx': '#F74B4A',
        default: '#9B59B6'
    },
    severity: {
        critical: '#F74B4A',
        high: '#FB7428',
        medium: '#FFB300',
        low: '#1FBAD6',
        informational: '#00C853'
    },
    network: ['#00A4FD', '#FFB300', '#00C853', '#F74B4A', '#9B59B6'],
    endpoint: ['#1FBAD6', '#9B59B6', '#FFB300', '#F74B4A'],
    ot: ['#00A4FD', '#1FBAD6', '#00C853', '#FFB300', '#FB7428', '#F74B4A']
};

function hasFields(fields, candidates) {
    return candidates.every(function (c) { return fields.indexOf(c) !== -1; });
}

function anyField(fields, candidates) {
    return candidates.some(function (c) { return fields.indexOf(c) !== -1; });
}

/**
 * @param {string[]} fields  available field names on the result rows
 * @param {object[]} _sample first few row objects (reserved for future
 *                           value-based hints; not yet inspected by the
 *                           field-only heuristic). Underscore-prefixed to
 *                           document forward-compat surface without tripping
 *                           the no-unused-vars lint.
 * @returns {{layerType:string, layerOptions:object, palette:object, dataModel:string}}
 */
export function detect(fields, _sample) {
    const fs = (fields || []).slice();

    // --- Authentication ---
    if (hasFields(fs, ['action', 'user']) && anyField(fs, ['src', 'src_user', 'dest'])) {
        return {
            dataModel: 'Authentication',
            layerType: 'markers',
            layerOptions: {
                colorField: 'action',
                colorMap: {
                    success: PALETTES.auth.success,
                    failure: PALETTES.auth.failure,
                    default: PALETTES.auth.default
                }
            },
            palette: PALETTES.auth
        };
    }

    // --- Network Traffic ---
    if (hasFields(fs, ['src', 'dest']) && anyField(fs, ['bytes', 'bytes_in', 'bytes_out'])) {
        return {
            dataModel: 'Network Traffic',
            layerType: 'paths',
            layerOptions: {
                widthField: 'bytes',
                colorField: 'action',
                colorMap: {
                    allowed: PALETTES.auth.success,
                    blocked: PALETTES.auth.failure,
                    default: PALETTES.auth.default
                }
            },
            palette: { series: PALETTES.network }
        };
    }

    // --- Web ---
    if (hasFields(fs, ['url']) && anyField(fs, ['status', 'http_method'])) {
        return {
            dataModel: 'Web',
            layerType: 'markers',
            layerOptions: {
                colorField: 'status_class',
                colorMap: PALETTES.web
            },
            palette: PALETTES.web
        };
    }

    // --- Intrusion Detection ---
    if (hasFields(fs, ['signature']) && anyField(fs, ['severity', 'severity_id'])) {
        return {
            dataModel: 'Intrusion Detection',
            layerType: 'markers',
            layerOptions: {
                colorField: 'severity',
                colorMap: PALETTES.severity
            },
            palette: PALETTES.severity
        };
    }

    // --- Endpoint Processes ---
    if (hasFields(fs, ['process', 'user']) || hasFields(fs, ['process_name'])) {
        return {
            dataModel: 'Endpoint Processes',
            layerType: 'markers',
            layerOptions: {
                colorField: 'action',
                colorMap: {
                    allowed: PALETTES.auth.success,
                    blocked: PALETTES.auth.failure,
                    default: PALETTES.auth.default
                }
            },
            palette: { series: PALETTES.endpoint }
        };
    }

    // --- Operational Telemetry ---
    if (anyField(fs, ['metric_value']) && anyField(fs, ['metric_name'])
        && anyField(fs, ['asset_lat', 'lat']) && anyField(fs, ['asset_lng', 'lng', 'lon'])) {
        return {
            dataModel: 'Operational_Telemetry',
            layerType: 'choropleth',
            layerOptions: {
                valueField: 'metric_value',
                groupBy: 'metric_name'
            },
            palette: { series: PALETTES.ot }
        };
    }

    // --- Fallback: generic markers, value-driven if possible ---
    const valueField = anyField(fs, ['count']) ? 'count'
        : anyField(fs, ['value']) ? 'value'
        : null;
    return {
        dataModel: 'Generic',
        layerType: 'markers',
        layerOptions: valueField ? { sizeField: valueField } : {},
        palette: { series: PALETTES.network }
    };
}

/**
 * Pull field names from the first non-empty row of a Splunk result set.
 */
export function fieldsFromRows(rows) {
    if (!rows || !rows.length) return [];
    for (let i = 0; i < rows.length; i++) {
        if (rows[i] && typeof rows[i] === 'object') {
            return Object.keys(rows[i]);
        }
    }
    return [];
}
