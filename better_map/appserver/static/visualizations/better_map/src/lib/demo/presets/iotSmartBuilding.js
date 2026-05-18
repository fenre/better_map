/*
 * demo/presets/iotSmartBuilding.js — multi-floor sensor mesh for a
 * 5-floor commercial office building at Fornebu (Bærum, Norway).
 *
 * Story
 * -----
 * The building runs a BACnet/MQTT sensor mesh that feeds Splunk
 * through a SC4SNMP collector.  Every floor has ~50 sensors:
 *
 *   - temperature  (°C, target 21 ± 2)
 *   - humidity     (%, target 40-55)
 *   - CO2          (ppm, alarms above 1000)
 *   - occupancy    (people count, derived from PIR + door sensors)
 *   - door state   (open / closed; used for floor egress audit)
 *
 * Each sensor reports one current reading.  The dataset is a single
 * snapshot (no time axis) so the viz shows a "right now" map of the
 * building rather than a trail.  Use the time scrubber on the Fleet
 * preset for the temporal story; use this preset for the spatial
 * story.
 *
 * Why this preset showcases Better Map
 * ------------------------------------
 *  - **Indoor floor-plan overlay**: `floor_id` is the field every
 *    indoor widget reads; the dropdown auto-populates with the five
 *    distinct values.
 *  - **Choropleth-style aggregation** by `floor` (mean CO2 / mean
 *    temp) when the user switches the aggregation widget on.
 *  - **Color-by-status**: `color` is per-row and reflects the most
 *    critical condition (ok / warn / alarm).
 *  - **Popup**: rich HTML with mini-bars for the four numeric
 *    metrics.
 *  - **Heatmap layer**: enable it from the layer control and the
 *    CO2 hot zones show up immediately (the corner conference rooms
 *    where people huddle without opening windows).
 */
import { createRng } from '../rng.js';
import { jitter } from '../geoUtils.js';

// Fornebu HQ centre (Equinor's old Statoil HQ — recognisable to
// Norwegian users, accurate enough at the demo resolution).
var BUILDING_CENTER = [10.6256, 59.8990];
// ~80 m × 60 m building footprint. Each floor is a flat rectangle
// at the same lon/lat; only `floor_id` differs.
var FLOOR_HALF_WIDTH_M  = 40;  // half-width along longitude
var FLOOR_HALF_HEIGHT_M = 30;  // half-height along latitude

var FLOORS = [
    { id: 'FL-01', name: 'Floor 1 — Lobby & cafeteria', purpose: 'common' },
    { id: 'FL-02', name: 'Floor 2 — Engineering',       purpose: 'workspace' },
    { id: 'FL-03', name: 'Floor 3 — Operations',        purpose: 'workspace' },
    { id: 'FL-04', name: 'Floor 4 — Executive + meeting rooms', purpose: 'meeting' },
    { id: 'FL-05', name: 'Floor 5 — Rooftop tech + HVAC', purpose: 'plant' }
];

var SENSOR_TYPES = [
    { type: 'temperature', unit: '°C',  mean: 21,  sd: 1.5 },
    { type: 'humidity',    unit: '%',   mean: 45,  sd: 6   },
    { type: 'co2',         unit: 'ppm', mean: 520, sd: 180 },
    { type: 'occupancy',   unit: 'ppl', mean: 4,   sd: 3   },
    { type: 'door',        unit: '',    mean: 0,   sd: 0   }
];

var STATUS_COLORS = {
    'ok':    '#a3e635',
    'warn':  '#fbbf24',
    'alarm': '#f43f5e'
};

/**
 * Distribute a sensor across the floor footprint.  We treat the
 * building as a flat rectangle and pick a point uniformly inside it,
 * then jitter slightly so neighbouring sensors don't share a pixel.
 */
function placeSensor(rng) {
    var u = rng.range(-1, 1);
    var v = rng.range(-1, 1);
    // Convert metres → degrees at the building latitude.
    var degLat = (v * FLOOR_HALF_HEIGHT_M) / 111320;
    var degLon = (u * FLOOR_HALF_WIDTH_M) /
        (111320 * Math.cos(BUILDING_CENTER[1] * Math.PI / 180));
    return jitter(
        [BUILDING_CENTER[0] + degLon, BUILDING_CENTER[1] + degLat],
        2,
        rng
    );
}

function evaluateStatus(type, value) {
    if (type === 'temperature') {
        if (value < 17 || value > 26) return 'alarm';
        if (value < 18.5 || value > 24.5) return 'warn';
        return 'ok';
    }
    if (type === 'humidity') {
        if (value < 25 || value > 65) return 'alarm';
        if (value < 35 || value > 60) return 'warn';
        return 'ok';
    }
    if (type === 'co2') {
        // ASHRAE 62.1 indicates >1000 ppm sustained as a poor-IAQ
        // signal; building automation systems typically alarm at
        // 1000 ppm and warn at 800 ppm. We follow that convention
        // so the demo reliably shows several red pins on the
        // meeting-room floor.
        if (value > 1000) return 'alarm';
        if (value > 800)  return 'warn';
        return 'ok';
    }
    if (type === 'occupancy') {
        if (value > 25) return 'warn';
        return 'ok';
    }
    if (type === 'door') {
        // Held-open after hours = warn (security policy).
        return value === 1 ? 'warn' : 'ok';
    }
    return 'ok';
}

function formatValue(type, raw) {
    if (type === 'door') {
        return raw === 1 ? 'open' : 'closed';
    }
    if (type === 'temperature' || type === 'humidity') {
        return raw.toFixed(1);
    }
    return String(Math.round(raw));
}

/**
 * @param {object} [opts]
 * @param {number} [opts.seed=137]
 * @param {number} [opts.sensorsPerFloor=50]
 * @param {number} [opts.nowMs]
 */
export function generateIotSmartBuilding(opts) {
    var o = opts || {};
    var rng = createRng(o.seed || 137);
    var sensorsPerFloor = o.sensorsPerFloor || 50;
    var nowMs = o.nowMs || Date.now();
    var nowIso = new Date(nowMs).toISOString();

    var rows = [];
    var serial = 1;

    for (var f = 0; f < FLOORS.length; f++) {
        var floor = FLOORS[f];

        // Plant floor (top floor) has slightly more alarming defaults
        // (HVAC compressor heat); cafeteria (floor 1) skews high on
        // CO2 + humidity (people + dishwashers).
        var driftCo2 = floor.purpose === 'common' ? 200 :
            floor.purpose === 'meeting' ? 350 : 0;
        var driftTemp = floor.purpose === 'plant' ? 2.5 : 0;

        for (var s = 0; s < sensorsPerFloor; s++) {
            var spec = SENSOR_TYPES[s % SENSOR_TYPES.length];
            var lonLat = placeSensor(rng);

            var raw;
            if (spec.type === 'door') {
                // 1 in 12 doors is held open. After-hours policy
                // says doors should be closed.
                raw = rng.chance(1 / 12) ? 1 : 0;
            } else {
                var mean = spec.mean +
                    (spec.type === 'co2' ? driftCo2 : 0) +
                    (spec.type === 'temperature' ? driftTemp : 0);
                raw = rng.gauss(mean, spec.sd);
                if (spec.type === 'occupancy') {
                    raw = Math.max(0, Math.round(raw));
                }
            }
            var status = evaluateStatus(spec.type, raw);
            var color = STATUS_COLORS[status] || STATUS_COLORS.ok;
            var sensorId = 'SENS-' + String(1000 + serial);
            serial++;

            var popup =
                '<div style="font-weight:600;font-size:13px">' + sensorId +
                ' (' + spec.type + ')' +
                '</div>' +
                '<div style="opacity:0.8;font-size:11px">' + floor.name + '</div>' +
                '<div style="margin-top:6px;font-size:12px">' +
                '<b>Reading</b>: ' + formatValue(spec.type, raw) + ' ' + spec.unit + '<br>' +
                '<b>Status</b>: ' + status + '<br>' +
                '<b>Reported</b>: ' + nowIso +
                '</div>';

            rows.push([
                nowIso,
                lonLat[1].toFixed(6),
                lonLat[0].toFixed(6),
                sensorId,                    // id
                floor.id,                    // floor_id  (indoor overlay key)
                floor.name,
                floor.purpose,
                spec.type,
                formatValue(spec.type, raw),
                spec.unit,
                String(Number(raw).toFixed(2)),
                status,
                color,
                popup
            ]);
        }
    }

    return {
        fields: [
            { name: '_time' },
            { name: 'lat' },
            { name: 'lon' },
            { name: 'id' },
            { name: 'floor_id' },
            { name: 'floor' },
            { name: 'floor_purpose' },
            { name: 'sensor_type' },
            { name: 'reading' },
            { name: 'unit' },
            { name: 'value' },
            { name: 'status' },
            { name: 'color' },
            { name: 'popup' }
        ],
        rows: rows
    };
}
