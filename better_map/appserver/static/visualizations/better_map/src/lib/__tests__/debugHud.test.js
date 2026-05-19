import { describe, it, expect, beforeEach } from 'vitest';
import { createDebugHud } from '../debugHud.js';

describe('debugHud — errors tab scaffold', () => {
    let container;
    beforeEach(() => {
        document.body.innerHTML = '';
        container = document.createElement('div');
        document.body.appendChild(container);
    });

    it('renders an errors counter row that starts at 0', () => {
        createDebugHud(container);
        const el = container.querySelector('.better_map-debug-hud');
        expect(el).not.toBeNull();
        expect(el.textContent).toContain('errors=0');
    });

    it('increments the errors counter when a better_map:error event fires', () => {
        createDebugHud(container);
        const envelope = {
            scope: 'layer:markers',
            severity: 'warning',
            recovery: 'soft',
            message: 'lat NaN',
            timestamp: Date.now()
        };
        container.dispatchEvent(new CustomEvent('better_map:error', { detail: envelope }));
        const el = container.querySelector('.better_map-debug-hud');
        expect(el.textContent).toContain('errors=1');
        expect(el.textContent).toContain('layer:markers');
    });

    it('groups counts by scope', () => {
        createDebugHud(container);
        for (let i = 0; i < 3; i++) {
            container.dispatchEvent(new CustomEvent('better_map:error', {
                detail: { scope: 'layer:markers', severity: 'warning', recovery: 'soft', message: 'x', timestamp: Date.now() }
            }));
        }
        container.dispatchEvent(new CustomEvent('better_map:error', {
            detail: { scope: 'map:create', severity: 'fatal', recovery: 'fatal', message: 'y', timestamp: Date.now() }
        }));
        const el = container.querySelector('.better_map-debug-hud');
        expect(el.textContent).toContain('layer:markers x3');
        expect(el.textContent).toContain('map:create x1');
    });
});
