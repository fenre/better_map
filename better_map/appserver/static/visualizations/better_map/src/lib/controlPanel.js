/*
 * Control Panel — on-map runtime toggle widget (BM-CT-1 contract).
 *
 * Implements Layers B + C of the three-layer control model documented
 * in `.cursor/rules/bm-control-trio.mdc`:
 *
 *   Layer A — Dashboard-author defaults  (formatter.html)
 *   Layer B — User runtime overrides     (this widget)
 *   Layer C — Reset operations           (this widget's [↻] buttons)
 *
 * UI shape (collapsed → expanded):
 *
 *   ┌─────────┐                ┌────────────────────────────────────┐
 *   │   ⚙     │  →  click  →   │  ⚙ Controls                  [—]  │
 *   └─────────┘                ├────────────────────────────────────┤
 *                              │  ◯ Arc comets            [⚙][↻]  │
 *                              │  ◯ Marching dashes       [⚙][↻]  │
 *                              │  ◯ Marker heartbeat      [⚙][↻]  │
 *                              │  ◯ Breathing extrusion   [⚙][↻]  │
 *                              │  ◯ Camera auto-orbit     [⚙][↻]  │
 *                              ├────────────────────────────────────┤
 *                              │  ⏸ Pause all motion         [   ]│
 *                              │  ↻ Reset view                     │
 *                              └────────────────────────────────────┘
 *
 * Each row is contributed by a layer/animation module via
 * `MapBuilder.registerFancyAction(...)`. The panel reads the registry
 * on every render() and re-builds its row list — so adding a new fancy
 * action automatically gives it a UI slot, no controlPanel.js edits
 * required.
 *
 * Reset semantics (the [↻] button):
 *   - Calls the action's registered `reset()` method
 *   - That method re-reads the dashboard-author default from
 *     `MapBuilder.getDashboardDefaults()` and re-applies it
 *   - The row's toggle state is re-synced from `isEnabled()` after
 *
 * Accessibility:
 *   - All buttons have aria-label and title attributes
 *   - The collapsed launcher is a single button with role="button"
 *   - The expanded panel is role="dialog" with aria-modal="false"
 *     (it's an overlay, not a true modal)
 *   - Keyboard: ESC closes; Tab order follows visual order
 *   - Focus is restored to the launcher when the panel collapses
 */

const PANEL_CLASS = 'better_map-control-panel';
const PANEL_LAUNCHER_CLASS = 'better_map-control-panel__launcher';
const PANEL_BODY_CLASS = 'better_map-control-panel__body';
const PANEL_HEADER_CLASS = 'better_map-control-panel__header';
const PANEL_TITLE_CLASS = 'better_map-control-panel__title';
const PANEL_CLOSE_CLASS = 'better_map-control-panel__close';
const PANEL_ROW_CLASS = 'better_map-control-panel__row';
const PANEL_ROW_LABEL_CLASS = 'better_map-control-panel__row-label';
const PANEL_ROW_ICON_CLASS = 'better_map-control-panel__row-icon';
const PANEL_TOGGLE_CLASS = 'better_map-control-panel__toggle';
const PANEL_RESET_CLASS = 'better_map-control-panel__reset';
const PANEL_FOOTER_CLASS = 'better_map-control-panel__footer';
const PANEL_MASTER_PAUSE_CLASS = 'better_map-control-panel__master-pause';
const PANEL_MASTER_RESET_CLASS = 'better_map-control-panel__master-reset';
const PANEL_EMPTY_CLASS = 'better_map-control-panel__empty';

/**
 * Build a new control-panel instance attached to the viz container.
 *
 * @param {HTMLElement} parentEl  the visualization root
 * @param {object} opts
 * @param {object} opts.builder            the MapBuilder instance — used
 *                                          for getFancyActions() /
 *                                          setMotionPaused() / resetView()
 * @param {Function} [opts.onMotionPauseToggle] optional listener fired
 *                                          when the master pause flips
 * @param {Function} [opts.onResetView]    optional listener fired when
 *                                          the master Reset View is
 *                                          pressed (so the viz can also
 *                                          reset the scrubber etc.)
 */
export function createControlPanel(parentEl, opts) {
    const options = opts || {};
    const builder = options.builder;
    if (!parentEl || !builder) {
        return null;
    }

    const root = document.createElement('div');
    root.className = PANEL_CLASS;
    root.setAttribute('data-state', 'collapsed');
    parentEl.appendChild(root);

    // --- Launcher (collapsed state) ---------------------------------
    const launcher = document.createElement('button');
    launcher.type = 'button';
    launcher.className = PANEL_LAUNCHER_CLASS;
    launcher.setAttribute('aria-label', 'Open map controls');
    launcher.setAttribute('aria-expanded', 'false');
    launcher.title = 'Map controls — animations, motion pause, reset view';
    // Two-character icon (gear + chevron) is unambiguous in both light
    // and dark themes and survives the system-font fallback chain.
    launcher.textContent = '\u2699';
    root.appendChild(launcher);

    // --- Expanded body ----------------------------------------------
    const body = document.createElement('div');
    body.className = PANEL_BODY_CLASS;
    body.setAttribute('role', 'dialog');
    body.setAttribute('aria-modal', 'false');
    body.setAttribute('aria-label', 'Map controls');
    body.style.display = 'none';
    root.appendChild(body);

    const header = document.createElement('div');
    header.className = PANEL_HEADER_CLASS;

    const title = document.createElement('span');
    title.className = PANEL_TITLE_CLASS;
    title.textContent = 'Map controls';
    header.appendChild(title);

    const closeBtn = document.createElement('button');
    closeBtn.type = 'button';
    closeBtn.className = PANEL_CLOSE_CLASS;
    closeBtn.setAttribute('aria-label', 'Close map controls');
    closeBtn.title = 'Close';
    closeBtn.textContent = '\u2014'; // em-dash for "minimise"
    header.appendChild(closeBtn);
    body.appendChild(header);

    const rowList = document.createElement('div');
    body.appendChild(rowList);

    // --- Footer (master controls) -----------------------------------
    const footer = document.createElement('div');
    footer.className = PANEL_FOOTER_CLASS;

    const masterPauseRow = document.createElement('div');
    masterPauseRow.className = PANEL_ROW_CLASS;

    const masterPauseIcon = document.createElement('span');
    masterPauseIcon.className = PANEL_ROW_ICON_CLASS;
    masterPauseIcon.textContent = '\u23F8'; // pause symbol
    masterPauseRow.appendChild(masterPauseIcon);

    const masterPauseLabel = document.createElement('label');
    masterPauseLabel.className = PANEL_ROW_LABEL_CLASS;
    masterPauseLabel.textContent = 'Pause all motion';
    masterPauseRow.appendChild(masterPauseLabel);

    const masterPauseToggle = document.createElement('input');
    masterPauseToggle.type = 'checkbox';
    masterPauseToggle.className = PANEL_MASTER_PAUSE_CLASS + ' ' + PANEL_TOGGLE_CLASS;
    masterPauseToggle.setAttribute('aria-label', 'Pause all map animations');
    masterPauseToggle.title = 'Disable every animation in the bundle (independent of your OS reduce-motion preference)';
    // Generate a unique id so the label can `for=` it correctly.
    const pauseId = 'bm-master-pause-' + Math.random().toString(36).slice(2, 8);
    masterPauseToggle.id = pauseId;
    masterPauseLabel.setAttribute('for', pauseId);
    masterPauseRow.appendChild(masterPauseToggle);
    footer.appendChild(masterPauseRow);

    const masterResetBtn = document.createElement('button');
    masterResetBtn.type = 'button';
    masterResetBtn.className = PANEL_MASTER_RESET_CLASS;
    masterResetBtn.setAttribute('aria-label', 'Reset view to dashboard defaults');
    masterResetBtn.title = 'Restore camera + animations + scrubber to the dashboard-author defaults';
    // Two-glyph: refresh icon + label. Putting the icon first matches
    // the per-row [↻] visual rhythm so the user reads "reset something".
    masterResetBtn.innerHTML = '<span aria-hidden="true">\u21BB</span> Reset view';
    footer.appendChild(masterResetBtn);

    body.appendChild(footer);

    // --- State + behaviour ------------------------------------------
    let expanded = false;
    let lastRowIds = '';

    function open() {
        if (expanded) return;
        expanded = true;
        body.style.display = '';
        launcher.style.display = 'none';
        launcher.setAttribute('aria-expanded', 'true');
        root.setAttribute('data-state', 'expanded');
        render();
        // Focus management — drop focus on the first interactive
        // control in the body for keyboard users.
        const firstFocusable = body.querySelector('button, input, [tabindex]');
        if (firstFocusable) firstFocusable.focus();
    }

    function close() {
        if (!expanded) return;
        expanded = false;
        body.style.display = 'none';
        launcher.style.display = '';
        launcher.setAttribute('aria-expanded', 'false');
        root.setAttribute('data-state', 'collapsed');
        launcher.focus();
    }

    function render() {
        if (!expanded) return;

        // Sync master pause from the source of truth so toggling
        // setMotionPaused() programmatically (e.g. from Reset view)
        // updates the checkbox.
        masterPauseToggle.checked = !!builder.isMotionPaused();

        const actions = builder.getFancyActions ? builder.getFancyActions() : [];
        // Cheap dirty-check so we don't rebuild the DOM every frame
        // when the panel is open during an applyAnalysis cycle.
        const fingerprint = actions.map(function (a) { return a.id; }).join('|');
        if (fingerprint === lastRowIds) {
            // Same set of actions — just refresh the toggle states.
            refreshToggleStates(actions);
            return;
        }
        lastRowIds = fingerprint;

        rowList.innerHTML = '';

        if (actions.length === 0) {
            const empty = document.createElement('p');
            empty.className = PANEL_EMPTY_CLASS;
            empty.textContent = 'No animations on this map.';
            rowList.appendChild(empty);
            return;
        }

        // Stable sort by label so re-renders don't jump rows around.
        actions.sort(function (a, b) {
            return (a.label || '').localeCompare(b.label || '');
        });

        actions.forEach(function (action) {
            rowList.appendChild(buildRow(action));
        });
    }

    function refreshToggleStates(actions) {
        actions.forEach(function (action) {
            const toggle = rowList.querySelector(
                'input[data-action-id="' + cssEscape(action.id) + '"]'
            );
            if (toggle) {
                toggle.checked = !!action.isEnabled();
            }
        });
    }

    function buildRow(action) {
        const row = document.createElement('div');
        row.className = PANEL_ROW_CLASS;
        row.setAttribute('data-action-id', action.id);

        const icon = document.createElement('span');
        icon.className = PANEL_ROW_ICON_CLASS;
        icon.textContent = action.icon || '\u25CB';
        icon.setAttribute('aria-hidden', 'true');
        row.appendChild(icon);

        const label = document.createElement('label');
        label.className = PANEL_ROW_LABEL_CLASS;
        label.textContent = action.label || action.id;
        row.appendChild(label);

        const toggleId = 'bm-action-' + action.id.replace(/[^a-z0-9_-]/gi, '_');
        const toggle = document.createElement('input');
        toggle.type = 'checkbox';
        toggle.id = toggleId;
        toggle.className = PANEL_TOGGLE_CLASS;
        toggle.setAttribute('data-action-id', action.id);
        toggle.setAttribute('aria-label', (action.label || action.id) + ' on/off');
        toggle.title = 'Toggle ' + (action.label || action.id);
        toggle.checked = !!action.isEnabled();
        label.setAttribute('for', toggleId);
        toggle.addEventListener('change', function () {
            try {
                action.setEnabled(toggle.checked);
            } catch (_e) { /* swallow per-action failures */ }
        });
        row.appendChild(toggle);

        const reset = document.createElement('button');
        reset.type = 'button';
        reset.className = PANEL_RESET_CLASS;
        reset.setAttribute('aria-label', 'Reset ' + (action.label || action.id) + ' to dashboard default');
        reset.title = 'Reset to dashboard default';
        reset.innerHTML = '<span aria-hidden="true">\u21BB</span>';
        reset.addEventListener('click', function () {
            try {
                action.reset();
                // Re-sync the toggle from the module's actual post-reset
                // state in case reset re-enabled / disabled it.
                toggle.checked = !!action.isEnabled();
            } catch (_e) { /* swallow */ }
        });
        row.appendChild(reset);

        return row;
    }

    // --- Wire-up ----------------------------------------------------
    launcher.addEventListener('click', open);
    closeBtn.addEventListener('click', close);
    masterPauseToggle.addEventListener('change', function () {
        try {
            builder.setMotionPaused(masterPauseToggle.checked);
        } catch (_e) { /* swallow */ }
        if (typeof options.onMotionPauseToggle === 'function') {
            try { options.onMotionPauseToggle(masterPauseToggle.checked); } catch (_e) { /* swallow */ }
        }
    });
    masterResetBtn.addEventListener('click', function () {
        try { builder.resetView(); } catch (_e) { /* swallow */ }
        if (typeof options.onResetView === 'function') {
            try { options.onResetView(); } catch (_e) { /* swallow */ }
        }
        // After reset, re-sync UI state.
        render();
    });
    body.addEventListener('keydown', function (e) {
        if (e.key === 'Escape') {
            close();
        }
    });

    // Initial render so the launcher shows even before first expansion.
    return {
        /**
         * Re-read the fancy-actions registry and rebuild rows if the
         * set of registered actions changed. Cheap to call after every
         * applyAnalysis().
         */
        render: render,
        /**
         * Programmatic open — used by `viewLock.js` "Reset view" or by
         * the v1.5.2 launch experience to draw the user's attention.
         */
        open: open,
        close: close,
        /**
         * Return true if the panel is currently expanded. Used by
         * tests + tooltip placement to avoid covering the panel.
         */
        isExpanded: function () { return expanded; },
        destroy: function () {
            if (root.parentNode) {
                root.parentNode.removeChild(root);
            }
        }
    };
}

/*
 * Minimal CSS-escape polyfill. Used for the toggle querySelector
 * inside refreshToggleStates(). Action IDs are stable strings like
 * "paths.comet" — none of the characters we use are CSS-special, but
 * defensive escaping costs nothing and prevents a future "marker.click"
 * style ID from silently breaking the refresh.
 */
function cssEscape(s) {
    if (typeof CSS !== 'undefined' && CSS.escape) {
        return CSS.escape(s);
    }
    return String(s).replace(/([!"#$%&'()*+,./:;<=>?@\[\\\]^`{|}~])/g, '\\$1');
}
