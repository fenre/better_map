import { describe, it, expect } from 'vitest';
import * as scopes from '../errorScopes.js';

describe('errorScopes', () => {
    it('exports only string constants', () => {
        const values = Object.values(scopes);
        expect(values.length).toBeGreaterThan(0);
        values.forEach((v) => expect(typeof v).toBe('string'));
        values.forEach((v) => expect(v.length).toBeGreaterThan(0));
    });

    it('has unique values (no scope-string drift)', () => {
        const values = Object.values(scopes);
        const seen = new Set(values);
        expect(seen.size).toBe(values.length);
    });

    it('uses colon-separated namespaces', () => {
        const values = Object.values(scopes);
        values.forEach((v) => {
            expect(v).toMatch(/^[a-z]+(:[a-z0-9_-]+)+$/);
        });
    });

    it('exposes the lifecycle, layer, widget, data, and maplibre families', () => {
        expect(scopes.LIFECYCLE_INITIALIZE).toBe('lifecycle:initialize');
        expect(scopes.LIFECYCLE_FORMAT_DATA).toBe('lifecycle:format-data');
        expect(scopes.LAYER_MARKERS).toBe('layer:markers');
        expect(scopes.WIDGET_GEOCODER).toBe('widget:geocoder');
        expect(scopes.DATA_SPL).toBe('data:spl');
        expect(scopes.MAPLIBRE_INTERNAL).toBe('maplibre:internal');
    });
});
