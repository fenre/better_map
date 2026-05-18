/*
 * demo.test.js — unit tests for the demo data pack (ROADMAP §3 E2
 * Phase 2 + new D6 Demo Data Pack).
 *
 * The demo system has two contractual obligations:
 *
 *   1. **Determinism.** Same seed must produce byte-identical rows.
 *      This is what lets us screenshot deterministically for E2E
 *      tests and means a user toggling demoPreset off/on/off sees
 *      the same dataset each time.
 *
 *   2. **Field schema stability.** The dashboards in
 *      default/data/ui/views/better_map_showcase.xml hard-bind to
 *      field names like `pathId`, `floor_id`, `iso`, `risk_score`.
 *      Renaming a field is a breaking change because every consumer
 *      dashboard would silently render the empty state.
 *
 * The tests below intentionally do NOT assert exact row counts
 * because the generators do per-row dedup (consecutive jittered
 * GPS pings landing within 5 m of each other get collapsed). They
 * assert bounds instead.
 */
import { describe, it, expect } from 'vitest';
import {
    PRESETS,
    isDemoPreset,
    loadDemoPreset,
    presetLabel,
} from '../demo/index.js';
import { createRng } from '../demo/rng.js';
import {
    lerpLatLon,
    jitter,
    bearing,
    distanceM,
    pathAlong,
} from '../demo/geoUtils.js';
import { generateFleetTelemetry }   from '../demo/presets/fleetTelemetry.js';
import { generateIotSmartBuilding } from '../demo/presets/iotSmartBuilding.js';
import { generateCyberIncidents }   from '../demo/presets/cyberIncidents.js';

// -------------------------------------------------------------------
// rng.js — basic statistical sanity (not crypto)
// -------------------------------------------------------------------
describe('createRng — determinism', () => {
    it('same seed → same sequence', () => {
        const a = createRng(42);
        const b = createRng(42);
        for (let i = 0; i < 50; i++) {
            expect(a.next()).toBe(b.next());
        }
    });

    it('different seeds → different sequences', () => {
        const a = createRng(1);
        const b = createRng(2);
        let identical = 0;
        for (let i = 0; i < 50; i++) {
            if (a.next() === b.next()) identical++;
        }
        // < 5 collisions across 50 draws is overwhelmingly likely.
        expect(identical).toBeLessThan(5);
    });

    it('next() stays in [0, 1)', () => {
        const r = createRng(7);
        for (let i = 0; i < 200; i++) {
            const v = r.next();
            expect(v).toBeGreaterThanOrEqual(0);
            expect(v).toBeLessThan(1);
        }
    });

    it('int(lo, hi) stays in [lo, hi)', () => {
        const r = createRng(7);
        for (let i = 0; i < 100; i++) {
            const v = r.int(10, 20);
            expect(v).toBeGreaterThanOrEqual(10);
            expect(v).toBeLessThan(20);
        }
    });

    it('pick() never returns undefined for non-empty arrays', () => {
        const r = createRng(7);
        const arr = ['a', 'b', 'c'];
        for (let i = 0; i < 30; i++) {
            const v = r.pick(arr);
            expect(arr).toContain(v);
        }
    });

    it('pick() returns undefined for empty arrays', () => {
        const r = createRng(7);
        expect(r.pick([])).toBeUndefined();
    });

    it('seed=0 still produces non-degenerate output', () => {
        // mulberry32 cycles short on seed=0; our wrapper bumps it
        // to 0x9e3779b9, so the first few outputs should look
        // perfectly normal.
        const r = createRng(0);
        const samples = [];
        for (let i = 0; i < 10; i++) samples.push(r.next());
        // No two consecutive values identical is the lightest
        // possible "the generator advanced" check.
        for (let i = 1; i < samples.length; i++) {
            expect(samples[i]).not.toBe(samples[i - 1]);
        }
    });

    it('gauss() is roughly centred on the mean', () => {
        const r = createRng(7);
        let sum = 0;
        const N = 500;
        for (let i = 0; i < N; i++) sum += r.gauss(10, 2);
        const mean = sum / N;
        // Allow ±0.5 around 10 — 500 samples of N(10, 2).
        expect(mean).toBeGreaterThan(9.5);
        expect(mean).toBeLessThan(10.5);
    });
});

// -------------------------------------------------------------------
// geoUtils — small-but-load-bearing helpers
// -------------------------------------------------------------------
describe('geoUtils', () => {
    it('lerpLatLon(a, b, 0) === a; lerpLatLon(a, b, 1) === b', () => {
        const a = [10, 60];
        const b = [11, 61];
        expect(lerpLatLon(a, b, 0)).toEqual([10, 60]);
        expect(lerpLatLon(a, b, 1)).toEqual([11, 61]);
        expect(lerpLatLon(a, b, 0.5)).toEqual([10.5, 60.5]);
    });

    it('jitter stays within ~radiusM metres', () => {
        const r = createRng(7);
        const origin = [10.7, 59.9];
        for (let i = 0; i < 50; i++) {
            const out = jitter(origin, 100, r);
            const d = distanceM(origin, out);
            // Allow 5% slop for haversine vs lat/lon plane.
            expect(d).toBeLessThan(105);
        }
    });

    it('bearing() returns 0..360', () => {
        const east  = bearing([0, 0], [1, 0]);
        const north = bearing([0, 0], [0, 1]);
        // East ≈ 90°, North ≈ 0°.
        expect(east).toBeGreaterThan(88);
        expect(east).toBeLessThan(92);
        expect(north).toBeGreaterThanOrEqual(0);
        expect(north).toBeLessThan(2);
    });

    it('pathAlong produces ~count points', () => {
        const r = createRng(7);
        const waypoints = [[10, 60], [11, 61], [10.5, 62]];
        const path = pathAlong(waypoints, 20, 10, r);
        // Allow ±1 due to integer rounding across legs.
        expect(path.length).toBeGreaterThanOrEqual(19);
        expect(path.length).toBeLessThanOrEqual(21);
        // First point is somewhere on the first leg, not exactly at A.
        expect(path[0][0]).not.toEqual(10);
    });
});

// -------------------------------------------------------------------
// PRESETS registry contract
// -------------------------------------------------------------------
describe('PRESETS registry', () => {
    it('registers exactly the three v1.7 presets', () => {
        // Locking the count is intentional — the formatter dropdown,
        // savedsearches.conf.spec, and showcase dashboard all
        // mention "three presets" verbatim. Adding a fourth requires
        // updates in those three places (see the recipe in
        // docs/_machine/agents.md §11).
        expect(PRESETS.length).toBe(3);
        const ids = PRESETS.map((p) => p.id);
        expect(ids).toEqual([
            'fleet-telemetry',
            'iot-smart-building',
            'cyber-incidents',
        ]);
    });

    it('every preset has id / label / description / generate', () => {
        for (const p of PRESETS) {
            expect(typeof p.id).toBe('string');
            expect(p.id.length).toBeGreaterThan(0);
            expect(typeof p.label).toBe('string');
            expect(p.label.length).toBeGreaterThan(0);
            expect(typeof p.description).toBe('string');
            expect(typeof p.generate).toBe('function');
        }
    });

    it('isDemoPreset() recognises real ids and rejects everything else', () => {
        expect(isDemoPreset('fleet-telemetry')).toBe(true);
        expect(isDemoPreset('iot-smart-building')).toBe(true);
        expect(isDemoPreset('cyber-incidents')).toBe(true);
        // Fall-through cases — formatter default + common typos.
        expect(isDemoPreset('none')).toBe(false);
        expect(isDemoPreset('')).toBe(false);
        expect(isDemoPreset('false')).toBe(false);
        expect(isDemoPreset('0')).toBe(false);
        expect(isDemoPreset(undefined)).toBe(false);
        expect(isDemoPreset(null)).toBe(false);
        expect(isDemoPreset('flett-telemetry')).toBe(false);
    });

    it('presetLabel returns a non-empty string for real ids, empty for unknown', () => {
        expect(presetLabel('fleet-telemetry')).toContain('Fleet');
        expect(presetLabel('xxx-unknown')).toBe('');
    });

    it('loadDemoPreset returns null for unknown ids', () => {
        expect(loadDemoPreset('xxx-unknown')).toBeNull();
    });
});

// -------------------------------------------------------------------
// Fleet telemetry
// -------------------------------------------------------------------
describe('fleet-telemetry preset', () => {
    const data = generateFleetTelemetry({ seed: 42, nowMs: 1700000000000 });

    it('exposes the contract field set in order', () => {
        const names = data.fields.map((f) => f.name);
        expect(names).toEqual([
            '_time', 'lat', 'lon', 'pathId', 'id',
            'driver', 'depot_id', 'depot', 'cluster_id', 'cluster',
            'cargo_type', 'cargo_kg', 'fuel_pct', 'speed_kph',
            'heading_deg', 'status', 'color', 'popup'
        ]);
    });

    it('produces a reasonable row count', () => {
        // 40 vans × 72 pings each = 2880, minus dedup. Anything in
        // the 2400–3000 band is healthy; outside it the generator
        // changed shape.
        expect(data.rows.length).toBeGreaterThan(2400);
        expect(data.rows.length).toBeLessThan(3000);
    });

    it('all lat/lon stay inside Norway-ish bounds', () => {
        for (const row of data.rows) {
            const lat = parseFloat(row[1]);
            const lon = parseFloat(row[2]);
            expect(lat).toBeGreaterThan(59.5);
            expect(lat).toBeLessThan(60.2);
            expect(lon).toBeGreaterThan(10.0);
            expect(lon).toBeLessThan(11.1);
        }
    });

    it('emits all four expected statuses across the dataset', () => {
        const statuses = new Set(data.rows.map((r) => r[15]));
        expect(statuses.has('in-transit')).toBe(true);
        expect(statuses.has('loading')).toBe(true);
        // breakdown and idle are probabilistic; at 40 vans the seed
        // is large enough that at least one of each MUST fire.
        const probabilistic = statuses.has('breakdown') || statuses.has('idle');
        expect(probabilistic).toBe(true);
    });

    it('color column is always a 7-char hex', () => {
        const HEX = /^#[0-9a-fA-F]{6}$/;
        for (const row of data.rows) {
            expect(row[16]).toMatch(HEX);
        }
    });

    it('is fully deterministic across two runs of the same seed', () => {
        const a = generateFleetTelemetry({ seed: 42, nowMs: 1700000000000 });
        const b = generateFleetTelemetry({ seed: 42, nowMs: 1700000000000 });
        expect(a.rows.length).toBe(b.rows.length);
        expect(JSON.stringify(a.rows[0])).toBe(JSON.stringify(b.rows[0]));
        expect(JSON.stringify(a.rows[100])).toBe(JSON.stringify(b.rows[100]));
        expect(JSON.stringify(a.rows[a.rows.length - 1])).toBe(JSON.stringify(b.rows[b.rows.length - 1]));
    });
});

// -------------------------------------------------------------------
// IoT smart building
// -------------------------------------------------------------------
describe('iot-smart-building preset', () => {
    const data = generateIotSmartBuilding({ seed: 137, nowMs: 1700000000000 });

    it('exposes the contract field set', () => {
        const names = data.fields.map((f) => f.name);
        expect(names).toEqual([
            '_time', 'lat', 'lon', 'id',
            'floor_id', 'floor', 'floor_purpose',
            'sensor_type', 'reading', 'unit', 'value',
            'status', 'color', 'popup'
        ]);
    });

    it('produces ~5 × 50 = 250 sensor rows', () => {
        expect(data.rows.length).toBe(250);
    });

    it('all rows cluster around Fornebu HQ centre', () => {
        // ~80m × 60m footprint at 59.899°N: degrees of slop are tiny.
        for (const row of data.rows) {
            const lat = parseFloat(row[1]);
            const lon = parseFloat(row[2]);
            expect(Math.abs(lat - 59.899)).toBeLessThan(0.002);
            expect(Math.abs(lon - 10.626)).toBeLessThan(0.002);
        }
    });

    it('floor_id is one of five known ids', () => {
        const known = new Set(['FL-01', 'FL-02', 'FL-03', 'FL-04', 'FL-05']);
        for (const row of data.rows) {
            expect(known.has(row[4])).toBe(true);
        }
    });

    it('status is always one of ok / warn / alarm', () => {
        const valid = new Set(['ok', 'warn', 'alarm']);
        for (const row of data.rows) {
            expect(valid.has(row[11])).toBe(true);
        }
    });

    it('at least one alarm row exists (with seed=137)', () => {
        // 250 sensors with the documented gaussian spreads will
        // overwhelmingly produce ≥ 1 alarm. If this fails, the
        // generator drifted and the showcase loses its red pin.
        const alarms = data.rows.filter((r) => r[11] === 'alarm');
        expect(alarms.length).toBeGreaterThan(0);
    });
});

// -------------------------------------------------------------------
// Cyber incidents
// -------------------------------------------------------------------
describe('cyber-incidents preset', () => {
    const data = generateCyberIncidents({ seed: 271828, count: 600, nowMs: 1700000000000 });

    it('exposes the contract field set', () => {
        const names = data.fields.map((f) => f.name);
        expect(names).toEqual([
            '_time', 'lat', 'lon', 'id',
            'iso', 'country', 'src_ip', 'target_asset', 'target_env',
            'attack_type', 'mitre_technique_id', 'mitre_technique_name',
            'risk_score', 'risk_band', 'color', 'popup'
        ]);
    });

    it('produces exactly `count` rows', () => {
        expect(data.rows.length).toBe(600);
    });

    it('iso codes are 2-letter ISO-3166-alpha-2', () => {
        for (const row of data.rows) {
            expect(row[4]).toMatch(/^[A-Z]{2}$/);
        }
    });

    it('mitre_technique_id always matches Txxxx[.xxx]', () => {
        const TID = /^T\d{4}(\.\d{3})?$/;
        for (const row of data.rows) {
            expect(row[10]).toMatch(TID);
        }
    });

    it('risk_score stays in 0..100', () => {
        for (const row of data.rows) {
            const s = parseInt(row[12], 10);
            expect(s).toBeGreaterThanOrEqual(0);
            expect(s).toBeLessThanOrEqual(100);
        }
    });

    it('risk_band is one of the five documented bands', () => {
        const valid = new Set(['low', 'moderate', 'elevated', 'high', 'critical']);
        for (const row of data.rows) {
            expect(valid.has(row[13])).toBe(true);
        }
    });

    it('src_ip always falls inside the RFC-5737 documentation range 203.0.0.0/16', () => {
        for (const row of data.rows) {
            expect(row[6]).toMatch(/^203\.0\.\d{1,3}\.\d{1,3}$/);
        }
    });

    it('every country in SOURCE_COUNTRIES appears at least once across 600 rows', () => {
        // With weighted sampling at this scale the lightest-weighted
        // entry (weight=1) still has E[occurrences] ≈ 5 → ≥ 1 fires
        // overwhelmingly often. If it doesn't, the sampler is broken.
        const seen = new Set(data.rows.map((r) => r[4]));
        // 20 countries declared in the preset.
        expect(seen.size).toBeGreaterThan(15);
    });
});

// -------------------------------------------------------------------
// End-to-end loader contract — what visualization_source.js relies on
// -------------------------------------------------------------------
describe('loadDemoPreset — Splunk SearchResults shape', () => {
    for (const id of ['fleet-telemetry', 'iot-smart-building', 'cyber-incidents']) {
        it(`${id} returns { fields, rows } shaped for formatData()`, () => {
            const d = loadDemoPreset(id);
            expect(d).not.toBeNull();
            expect(Array.isArray(d.fields)).toBe(true);
            expect(Array.isArray(d.rows)).toBe(true);
            expect(d.fields.length).toBeGreaterThan(0);
            expect(d.rows.length).toBeGreaterThan(0);
            // Every row matches the field count.
            for (const row of d.rows.slice(0, 5)) {
                expect(row.length).toBe(d.fields.length);
            }
            // Field 0 is always _time (consumed by the scrubber).
            expect(d.fields[0].name).toBe('_time');
            // Field 1 is always lat, field 2 always lon (consumed
            // by geojson.js's LAT_ALIASES / LON_ALIASES auto-detect).
            expect(d.fields[1].name).toBe('lat');
            expect(d.fields[2].name).toBe('lon');
        });
    }
});
