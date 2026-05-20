/*
 * measure.test.js — v1.7.1 inline-hint regression coverage.
 *
 * Same UX rescue motivation as drawTools.test.js: clicking the ruler
 * button only TOGGLES measure mode; the user then has to click on
 * the map to add vertices. The inline hint makes that explicit.
 */
import { describe, it, expect, beforeEach } from 'vitest';
import { createMeasureTool } from '../measure.js';

function makeFakeMap() {
    const sources = new Map();
    const layers = new Map();
    return {
        getSource: (id) => sources.get(id),
        addSource: (id, def) => { sources.set(id, { ...def, setData: () => {} }); },
        getLayer: (id) => layers.get(id),
        addLayer: (def) => { layers.set(def.id, def); },
        removeLayer: (id) => { layers.delete(id); },
        removeSource: (id) => { sources.delete(id); },
        on: () => {},
        off: () => {}
    };
}

function makeFakeBuilder() {
    return { map: makeFakeMap() };
}

function makeContainer() {
    const el = document.createElement('div');
    document.body.appendChild(el);
    return el;
}

describe('createMeasureTool — inline hint (v1.7.1 UX rescue)', () => {
    let container;
    let widget;

    beforeEach(() => {
        document.body.innerHTML = '';
        container = makeContainer();
        widget = createMeasureTool(container, { builder: makeFakeBuilder() });
    });

    it('renders a hint element inside the toolbar wrapper', () => {
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint).not.toBeNull();
        expect(hint.getAttribute('role')).toBe('status');
        expect(hint.getAttribute('aria-live')).toBe('polite');
    });

    it('starts in the idle hint state', () => {
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint.textContent.toLowerCase()).toContain('click the ruler');
        expect(hint.textContent.toLowerCase()).toContain('click the map');
    });

    it('places the button row in its own .better_map-measure__row container', () => {
        const row = container.querySelector('.better_map-measure__row');
        expect(row).not.toBeNull();
        const btns = row.querySelectorAll('.better_map-measure__btn');
        expect(btns.length).toBe(2);
    });

    it('updates the hint to "click the map to add the first vertex" on activate', () => {
        // The widget exposes setEnabled/isEnabled/reset/destroy but not
        // an explicit activate() method; the start button DOM click is
        // the activation path. The first .better_map-measure__btn in
        // the row is the start button.
        const startBtn = container.querySelector('.better_map-measure__row .better_map-measure__btn');
        expect(startBtn).not.toBeNull();
        startBtn.click();
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint.textContent.toLowerCase()).toContain('measure mode');
        expect(hint.textContent.toLowerCase()).toContain('first vertex');
    });

    it('toggles back to idle when the start button is clicked again', () => {
        const startBtn = container.querySelector('.better_map-measure__row .better_map-measure__btn');
        startBtn.click();
        startBtn.click(); // toggle off
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint.textContent.toLowerCase()).toContain('click the ruler');
    });

    it('clear() while idle keeps the idle hint', () => {
        widget.reset();
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint.textContent.toLowerCase()).toContain('click the ruler');
    });

    it('the start button title (tooltip) explains the next step', () => {
        const startBtn = container.querySelector('.better_map-measure__row .better_map-measure__btn');
        const title = startBtn.getAttribute('title') || '';
        expect(title.length).toBeGreaterThan(20);
        expect(title.toLowerCase()).toMatch(/click the map/);
        expect(startBtn.getAttribute('aria-label').toLowerCase()).toMatch(/measure/);
    });

    it('setEnabled(false) blanks the hint and hides the toolbar', () => {
        const toolbar = container.querySelector('.better_map-measure');
        widget.setEnabled(false);
        const hint = container.querySelector('.better_map-measure__hint');
        expect(hint.textContent).toBe('');
        expect(toolbar.style.display).toBe('none');
    });

    it('setEnabled(true) restores the idle hint and shows the toolbar', () => {
        widget.setEnabled(false);
        widget.setEnabled(true);
        const toolbar = container.querySelector('.better_map-measure');
        const hint = container.querySelector('.better_map-measure__hint');
        expect(toolbar.style.display).toBe('');
        expect(hint.textContent.toLowerCase()).toContain('click the ruler');
    });
});
