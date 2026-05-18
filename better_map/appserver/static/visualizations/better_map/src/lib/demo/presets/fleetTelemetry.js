/*
 * demo/presets/fleetTelemetry.js — last-mile delivery fleet across
 * the Oslo metro area.
 *
 * Story
 * -----
 * A regional logistics operator runs 40 delivery vans from three
 * depots — Alnabru (industrial, east), Lørenskog (rim, north-east),
 * and Drammen-Lierstranda (south-west). Each van has a fixed daily
 * route between the depot and a delivery cluster. The dataset
 * covers six hours of operations sampled every five minutes, so
 * every van contributes ~73 GPS pings (≈ 2 900 features total — well
 * inside the viz's 50 k cap).
 *
 * Why this preset showcases Better Map
 * ------------------------------------
 *  - **Time scrubber + comet trails**: the `_time` field is per-row
 *    and `pathId` groups by `vehicle_id`, so the scrubber animates
 *    each van moving along its route with a fading tail.
 *  - **Cluster + layer-by-status**: `status` flips between
 *    `in-transit / idle / breakdown / loading`; the layer-control
 *    widget surfaces each as a toggleable layer.
 *  - **3D extrusion**: `cargo_kg` is the height field — heavy vans
 *    tower visibly over empty returns.
 *  - **Popups**: `popup` is pre-built HTML (DOMPurify-safe) showing
 *    driver, route, cargo, fuel.
 *  - **Color coding**: `color` is per-row hex so the markers/paths
 *    layer honours the status colour without a palette config.
 *
 * Determinism
 * -----------
 * Seeded by `seed` (default 42). Same seed → byte-identical rows.
 */
import { createRng } from '../rng.js';
import { pathAlong, bearing, distanceM } from '../geoUtils.js';

// Three depots and four delivery clusters across the Oslo metro
// area.  Coordinates are [lon, lat] (MapLibre convention).
var DEPOTS = [
    { id: 'OSL-ALN', name: 'Alnabru Depot',         lonLat: [10.81, 59.93] },
    { id: 'OSL-LOR', name: 'Lørenskog Hub',         lonLat: [10.96, 59.93] },
    { id: 'OSL-DRM', name: 'Drammen-Lierstranda',   lonLat: [10.20, 59.74] }
];

var CLUSTERS = [
    { id: 'C-SENTRUM',     name: 'Sentrum',            lonLat: [10.74, 59.91] },
    { id: 'C-BJORVIKA',    name: 'Bjørvika',           lonLat: [10.76, 59.91] },
    { id: 'C-MAJORSTUEN',  name: 'Majorstuen',         lonLat: [10.72, 59.93] },
    { id: 'C-NORDSTRAND',  name: 'Nordstrand',         lonLat: [10.80, 59.86] },
    { id: 'C-FORNEBU',     name: 'Fornebu Business',   lonLat: [10.62, 59.90] },
    { id: 'C-BARUM',       name: 'Bærum Retail',       lonLat: [10.55, 59.92] }
];

var CARGO_TYPES = [
    { type: 'Refrigerated produce', minKg: 800,  maxKg: 1800 },
    { type: 'Pharma + medical',     minKg: 200,  maxKg: 900  },
    { type: 'Industrial parts',     minKg: 1200, maxKg: 2400 },
    { type: 'Electronics',          minKg: 400,  maxKg: 1500 },
    { type: 'General parcels',      minKg: 600,  maxKg: 1700 }
];

// Status palette matches the v1.6 fleet-tracking dashboard colour
// language for visual continuity, but the value set is richer.
var STATUS_COLORS = {
    'in-transit':  '#22d3ee',
    'idle':        '#fbbf24',
    'loading':     '#a3e635',
    'breakdown':   '#f43f5e'
};

// Driver-name pool. First-name + last-name are sampled independently
// so the same driver string is unlikely to repeat across runs.
var FIRST_NAMES = [
    'Astrid', 'Bjørn', 'Camilla', 'Dag', 'Eivind', 'Frida', 'Gunnar',
    'Hilde', 'Ivar', 'Jens', 'Kari', 'Lars', 'Mette', 'Nils', 'Oda',
    'Pål', 'Ragnhild', 'Sven', 'Tor', 'Unni', 'Viktor', 'Wenche',
    'Aleks', 'Ingrid', 'Mari', 'Sander', 'Tone', 'Yusuf'
];
var LAST_NAMES = [
    'Hansen', 'Johansen', 'Olsen', 'Larsen', 'Andersen', 'Pedersen',
    'Nilsen', 'Kristiansen', 'Jensen', 'Karlsen', 'Berg', 'Haugen',
    'Halvorsen', 'Lund', 'Strand', 'Solberg', 'Eriksen', 'Knutsen',
    'Bakken', 'Aas'
];

/**
 * Generate the fleet-telemetry preset.
 *
 * @param {object} [opts]
 * @param {number} [opts.seed=42]       RNG seed
 * @param {number} [opts.vehicleCount=40]
 * @param {number} [opts.hours=6]       Window length
 * @param {number} [opts.pingIntervalSec=300]  5 min default
 * @param {number} [opts.nowMs]         "Now" anchor for _time
 * @returns {{ fields: object[], rows: Array<Array<*>> }}
 */
export function generateFleetTelemetry(opts) {
    var o = opts || {};
    var rng = createRng(o.seed || 42);
    var vehicleCount = o.vehicleCount || 40;
    var hours = o.hours || 6;
    var pingIntervalSec = o.pingIntervalSec || 300;
    var nowMs = o.nowMs || Date.now();

    var totalSeconds = hours * 3600;
    var pingsPerVehicle = Math.floor(totalSeconds / pingIntervalSec);
    var earliestMs = nowMs - totalSeconds * 1000;

    var rows = [];

    for (var v = 0; v < vehicleCount; v++) {
        var vehicleId = 'VAN-' + String(101 + v);
        var depot = DEPOTS[v % DEPOTS.length];
        var cluster = CLUSTERS[(v + 1) % CLUSTERS.length];
        var cargoSpec = CARGO_TYPES[v % CARGO_TYPES.length];
        var driver =
            FIRST_NAMES[rng.int(0, FIRST_NAMES.length)] + ' ' +
            LAST_NAMES[rng.int(0, LAST_NAMES.length)];

        // Out + return + a small detour through the city centre to
        // make the lines visually interesting. Each vehicle gets a
        // slightly different mid-point so the routes don't perfectly
        // overlap.
        var midPoint = [
            (depot.lonLat[0] + cluster.lonLat[0]) / 2 + rng.range(-0.015, 0.015),
            (depot.lonLat[1] + cluster.lonLat[1]) / 2 + rng.range(-0.010, 0.010)
        ];
        var waypoints = [
            depot.lonLat,
            midPoint,
            cluster.lonLat,
            midPoint,
            depot.lonLat
        ];
        var path = pathAlong(waypoints, pingsPerVehicle, 40, rng);

        // Cargo decays linearly over the shift (parcels delivered);
        // fuel decays nonlinearly. Both start at a per-vehicle peak.
        var maxCargo = rng.range(cargoSpec.minKg, cargoSpec.maxKg);
        var maxFuel = rng.range(70, 100);

        // 1 vehicle in 8 has a breakdown event somewhere mid-shift.
        var breakdownIdx = rng.chance(0.125)
            ? rng.int(Math.floor(pingsPerVehicle * 0.3), Math.floor(pingsPerVehicle * 0.8))
            : -1;

        // 1 vehicle in 4 has an extended idle (traffic / break).
        var idleStart = rng.chance(0.25)
            ? rng.int(Math.floor(pingsPerVehicle * 0.15), Math.floor(pingsPerVehicle * 0.55))
            : -1;
        var idleLen = idleStart >= 0 ? rng.int(3, 9) : 0;

        for (var i = 0; i < path.length; i++) {
            var lonLat = path[i];
            var t = i / Math.max(1, path.length - 1);
            var tsMs = earliestMs + Math.floor(t * totalSeconds * 1000);

            var status = 'in-transit';
            if (i === 0 || i === path.length - 1) {
                status = 'loading';
            } else if (breakdownIdx >= 0 && i >= breakdownIdx && i < breakdownIdx + 6) {
                status = 'breakdown';
            } else if (idleStart >= 0 && i >= idleStart && i < idleStart + idleLen) {
                status = 'idle';
            }

            // Speed correlates with status; idle/breakdown ≈ 0.
            var speedKph;
            if (status === 'idle' || status === 'breakdown' || status === 'loading') {
                speedKph = Math.round(rng.range(0, 4));
            } else {
                // Realistic city-delivery speeds: 25–55 km/h with some
                // spread for arterials. Gauss → most values near
                // typical traffic flow.
                speedKph = Math.max(8, Math.round(rng.gauss(38, 9)));
            }

            // Cargo decays a little each ping while in-transit (delivered
            // parcels); fuel decays everywhere except when idle.
            var cargoKg = Math.max(0, Math.round(maxCargo * (1 - t * 0.65)));
            var fuelPct = Math.max(5, Math.round(maxFuel - t * 28 - (status === 'in-transit' ? 0 : -1)));

            // Heading: derived from the next step so the arrow icon
            // points along motion. Last point reuses the previous.
            var headingDeg;
            if (i < path.length - 1) {
                headingDeg = Math.round(bearing(lonLat, path[i + 1]));
            } else if (i > 0) {
                headingDeg = Math.round(bearing(path[i - 1], lonLat));
            } else {
                headingDeg = 0;
            }

            var color = STATUS_COLORS[status] || STATUS_COLORS['in-transit'];

            // Popup HTML — sanitised at runtime by popupSanitizer.js.
            // Keep it terse: large popup text fights the time scrubber.
            var popup =
                '<div style="font-weight:600;font-size:13px">' + vehicleId +
                '</div>' +
                '<div style="opacity:0.8;font-size:11px">' + driver + '</div>' +
                '<div style="margin-top:6px;font-size:12px">' +
                '<b>Status</b>: ' + status + '<br>' +
                '<b>Speed</b>: ' + speedKph + ' km/h<br>' +
                '<b>Heading</b>: ' + headingDeg + '°<br>' +
                '<b>Cargo</b>: ' + cargoKg + ' kg (' + cargoSpec.type + ')<br>' +
                '<b>Fuel</b>: ' + fuelPct + '%<br>' +
                '<b>Depot</b>: ' + depot.name + '<br>' +
                '<b>Cluster</b>: ' + cluster.name +
                '</div>';

            rows.push([
                // _time as ISO 8601 — geojson.js + time/scrubber.js
                // both accept either ISO or epoch seconds.
                new Date(tsMs).toISOString(),
                lonLat[1].toFixed(6),  // lat
                lonLat[0].toFixed(6),  // lon
                vehicleId,             // pathId  (groups markers into a path)
                vehicleId,             // id
                driver,
                depot.id,
                depot.name,
                cluster.id,
                cluster.name,
                cargoSpec.type,
                String(cargoKg),
                String(fuelPct),
                String(speedKph),
                String(headingDeg),
                status,
                color,
                popup
            ]);
        }
    }

    // Skip rows where consecutive points landed on top of each other
    // (jitter occasionally produces a near-duplicate). Keeps the path
    // layer from drawing a zero-length segment.
    var dedup = [];
    var lastByVehicle = {};
    for (var k = 0; k < rows.length; k++) {
        var r = rows[k];
        var vid = r[3];
        var prev = lastByVehicle[vid];
        var p = [parseFloat(r[2]), parseFloat(r[1])];
        if (prev && distanceM(prev, p) < 5) {
            continue;
        }
        lastByVehicle[vid] = p;
        dedup.push(r);
    }

    return {
        fields: [
            { name: '_time' },
            { name: 'lat' },
            { name: 'lon' },
            { name: 'pathId' },
            { name: 'id' },
            { name: 'driver' },
            { name: 'depot_id' },
            { name: 'depot' },
            { name: 'cluster_id' },
            { name: 'cluster' },
            { name: 'cargo_type' },
            { name: 'cargo_kg' },
            { name: 'fuel_pct' },
            { name: 'speed_kph' },
            { name: 'heading_deg' },
            { name: 'status' },
            { name: 'color' },
            { name: 'popup' }
        ],
        rows: dedup
    };
}
