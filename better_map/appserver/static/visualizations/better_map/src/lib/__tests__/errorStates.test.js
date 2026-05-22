import { describe, it, expect, beforeEach } from 'vitest';
import {
    renderErrorBanner,
    clearErrorBanner,
    pushBanner,
    dismissBanner,
    getActiveBanners,
    __resetBannerState
} from '../errorStates.js';

describe('errorStates — existing API regression', () => {
    let el;
    beforeEach(() => {
        document.body.innerHTML = '';
        el = document.createElement('div');
        document.body.appendChild(el);
        __resetBannerState();
    });

    it('renderErrorBanner with a string renders a fatal banner', () => {
        renderErrorBanner(el, 'boom');
        const banner = el.querySelector('.better_map-error');
        expect(banner).not.toBeNull();
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('boom');
    });

    it('renderErrorBanner with options object honours kind', () => {
        renderErrorBanner(el, { kind: 'warning', message: 'soft' });
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('warning');
    });

    it('clearErrorBanner hides the banner', () => {
        renderErrorBanner(el, 'boom');
        clearErrorBanner(el);
        const banner = el.querySelector('.better_map-error');
        expect(banner.style.display).toBe('none');
    });
});

describe('errorStates.pushBanner — stacking', () => {
    let el;
    beforeEach(() => {
        document.body.innerHTML = '';
        el = document.createElement('div');
        document.body.appendChild(el);
        __resetBannerState();
    });

    function envelope(scope, severity, message) {
        return { scope, severity, message, recovery: 'soft', timestamp: Date.now() };
    }

    it('pushes a single envelope and renders it', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'lat NaN'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('warning');
        expect(banner.textContent).toContain('lat NaN');
    });

    it('fatal beats warning in the single slot', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'warn first'));
        pushBanner(el, envelope('map:create', 'fatal', 'fatal second'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('fatal second');
    });

    it('warning does NOT replace an active fatal', () => {
        pushBanner(el, envelope('map:create', 'fatal', 'fatal first'));
        pushBanner(el, envelope('layer:markers', 'warning', 'warn after'));
        const banner = el.querySelector('.better_map-error');
        expect(banner.dataset.kind).toBe('fatal');
        expect(banner.textContent).toContain('fatal first');
    });

    it('shows "+N more" badge when multiple envelopes active', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        pushBanner(el, envelope('layer:heatmap', 'warning', 'b'));
        pushBanner(el, envelope('layer:paths', 'warning', 'c'));
        const badge = el.querySelector('.better_map-error__badge');
        expect(badge).not.toBeNull();
        expect(badge.textContent).toContain('+2 more');
    });

    it('dismissBanner removes one envelope and re-renders next', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        pushBanner(el, envelope('layer:heatmap', 'warning', 'b'));
        dismissBanner(el, 'layer:markers');
        const banner = el.querySelector('.better_map-error');
        expect(banner.textContent).toContain('b');
        expect(banner.textContent).not.toContain('a');
        const badge = el.querySelector('.better_map-error__badge');
        expect(badge).toBeNull();
    });

    it('getActiveBanners returns a copy of active envelopes', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        const list = getActiveBanners(el);
        expect(list).toHaveLength(1);
        list.length = 0;
        expect(getActiveBanners(el)).toHaveLength(1);
    });

    it('replacing an envelope with the same scope updates in place', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'first'));
        pushBanner(el, envelope('layer:markers', 'warning', 'second'));
        expect(getActiveBanners(el)).toHaveLength(1);
        const banner = el.querySelector('.better_map-error');
        expect(banner.textContent).toContain('second');
    });

    it('__resetBannerState clears all active envelopes', () => {
        pushBanner(el, envelope('layer:markers', 'warning', 'a'));
        __resetBannerState();
        expect(getActiveBanners(el)).toHaveLength(0);
    });
});
