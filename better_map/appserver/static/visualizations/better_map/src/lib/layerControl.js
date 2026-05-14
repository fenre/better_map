/*
 * Floating layer control.
 *
 * If the analysis surfaces a `layer` field on the rows, each unique value
 * becomes a checkbox in a small floating widget at the top-right of the
 * map. Users can toggle visibility per layer without re-running the
 * Splunk search. Color swatches mirror the categorical palette assigned
 * in palettes.js.
 *
 * The control is rendered as plain DOM (no React, no MapLibre IControl
 * abstraction needed) so it stays AMD-safe and works in the local test
 * harness.
 */

import { pickCategorical } from './palettes.js';

const CONTROL_CLASS = 'better_map-layer-control';
const CONTROL_HEADING_CLASS = 'better_map-layer-control__heading';
const CONTROL_ITEM_CLASS = 'better_map-layer-control__item';
const CONTROL_SWATCH_CLASS = 'better_map-layer-control__swatch';
const CONTROL_LABEL_CLASS = 'better_map-layer-control__label';
const CONTROL_CHECKBOX_CLASS = 'better_map-layer-control__checkbox';

/**
 * Build a new layer control instance attached to a DOM container.
 *
 * @param {HTMLElement} parentEl - the visualization container element
 * @param {Object} callbacks
 * @param {Function} callbacks.onToggle - (layerName: string, visible: boolean) => void
 */
export function createLayerControl(parentEl, callbacks) {
    const onToggle = (callbacks && callbacks.onToggle) || function () {};
    const root = document.createElement('div');
    root.className = CONTROL_CLASS;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Map layers');
    root.style.display = 'none';
    parentEl.appendChild(root);

    let lastNames = [];
    const visibleState = {};

    function render(layerNames) {
        const names = (layerNames || []).slice();
        // Stable order for accessibility.
        names.sort();
        if (sameArray(names, lastNames)) {
            return;
        }
        lastNames = names;

        root.innerHTML = '';
        if (!names.length) {
            root.style.display = 'none';
            return;
        }
        root.style.display = '';

        const heading = document.createElement('div');
        heading.className = CONTROL_HEADING_CLASS;
        heading.textContent = 'Layers';
        root.appendChild(heading);

        names.forEach(function (name, idx) {
            if (typeof visibleState[name] !== 'boolean') {
                visibleState[name] = true;
            }
            const row = document.createElement('label');
            row.className = CONTROL_ITEM_CLASS;

            const checkbox = document.createElement('input');
            checkbox.type = 'checkbox';
            checkbox.className = CONTROL_CHECKBOX_CLASS;
            checkbox.checked = !!visibleState[name];
            checkbox.setAttribute('aria-label', 'Toggle layer ' + name);
            checkbox.addEventListener('change', function () {
                visibleState[name] = checkbox.checked;
                onToggle(name, checkbox.checked);
            });

            const swatch = document.createElement('span');
            swatch.className = CONTROL_SWATCH_CLASS;
            swatch.style.backgroundColor = pickCategorical(idx);

            const label = document.createElement('span');
            label.className = CONTROL_LABEL_CLASS;
            label.textContent = name;

            row.appendChild(checkbox);
            row.appendChild(swatch);
            row.appendChild(label);
            root.appendChild(row);
        });
    }

    function isVisible(name) {
        return visibleState[name] !== false;
    }

    function destroy() {
        if (root.parentNode) {
            root.parentNode.removeChild(root);
        }
    }

    return {
        render: render,
        isVisible: isVisible,
        destroy: destroy
    };
}

function sameArray(a, b) {
    if (a.length !== b.length) return false;
    for (let i = 0; i < a.length; i++) {
        if (a[i] !== b[i]) return false;
    }
    return true;
}
