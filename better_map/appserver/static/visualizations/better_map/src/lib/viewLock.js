/*
 * View lock & camera memory.
 *
 * Goals (per the plan):
 *   - Auto-fit the camera ONLY on the first non-empty data load. Subsequent
 *     updates must preserve the user's manual pan / zoom / pitch / bearing.
 *   - Surface a "Reset view" button so the user can return to the auto-fit
 *     bounds at will.
 *   - Surface a "Lock view" toggle so the user can pin the camera and
 *     prevent any future auto-fits (including cross-panel camera sync).
 *
 * The widget lives in the top-right corner above the attribution box.
 * It owns its own DOM and emits callbacks; mapBuilder.js consults the
 * `isLocked()` and `consumeAutoFit()` accessors before changing the
 * camera state.
 */

const CLASS = 'better_map-view-controls';
const BUTTON_CLASS = 'better_map-view-controls__btn';
const TOGGLE_ACTIVE = 'is-active';

/**
 * Track auto-fit state and expose a Reset / Lock View widget.
 *
 * @param {HTMLElement} parentEl
 * @param {object} callbacks
 * @param {Function} callbacks.onResetView - user pressed "Reset"
 * @param {Function} [callbacks.onLockChange] - lock toggled (boolean arg)
 */
export function createViewLock(parentEl, callbacks) {
    const cb = callbacks || {};
    const state = {
        // True until the first non-empty applyAnalysis() consumes the slot.
        autoFitPending: true,
        // User has manually pinned the camera (no more auto-fits).
        locked: false,
        // Last bounds we auto-fitted to (used by Reset View).
        lastFitBounds: null
    };

    const root = document.createElement('div');
    root.className = CLASS;
    root.setAttribute('role', 'group');
    root.setAttribute('aria-label', 'Map view controls');

    const resetBtn = document.createElement('button');
    resetBtn.type = 'button';
    resetBtn.className = BUTTON_CLASS;
    resetBtn.title = 'Reset to auto-fit view';
    resetBtn.setAttribute('aria-label', 'Reset view to data bounds');
    resetBtn.textContent = 'Reset view';
    resetBtn.addEventListener('click', function () {
        if (typeof cb.onResetView === 'function') cb.onResetView(state.lastFitBounds);
    });
    root.appendChild(resetBtn);

    const lockBtn = document.createElement('button');
    lockBtn.type = 'button';
    lockBtn.className = BUTTON_CLASS;
    lockBtn.title = 'Lock the current camera position';
    lockBtn.setAttribute('aria-pressed', 'false');
    lockBtn.textContent = 'Lock view';
    lockBtn.addEventListener('click', function () {
        state.locked = !state.locked;
        lockBtn.classList.toggle(TOGGLE_ACTIVE, state.locked);
        lockBtn.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
        lockBtn.textContent = state.locked ? 'Unlock view' : 'Lock view';
        if (typeof cb.onLockChange === 'function') cb.onLockChange(state.locked);
    });
    root.appendChild(lockBtn);

    parentEl.appendChild(root);

    return {
        /**
         * Returns true the first time after any data load that the caller
         * is allowed to auto-fit the camera. Subsequent calls return false
         * until `resetAutoFit()` re-arms the pending flag. The Lock View
         * toggle short-circuits to false regardless.
         */
        consumeAutoFit: function () {
            if (state.locked) return false;
            if (!state.autoFitPending) return false;
            state.autoFitPending = false;
            return true;
        },
        /**
         * Re-arm the auto-fit slot (e.g. after a full destroy or after the
         * user pressed Reset).
         */
        resetAutoFit: function () {
            state.autoFitPending = true;
        },
        isLocked: function () {
            return state.locked;
        },
        setLocked: function (locked) {
            if (locked === state.locked) return;
            state.locked = Boolean(locked);
            lockBtn.classList.toggle(TOGGLE_ACTIVE, state.locked);
            lockBtn.setAttribute('aria-pressed', state.locked ? 'true' : 'false');
            lockBtn.textContent = state.locked ? 'Unlock view' : 'Lock view';
            if (typeof cb.onLockChange === 'function') cb.onLockChange(state.locked);
        },
        /**
         * Remember the last successful auto-fit bounds so Reset can restore.
         */
        recordFitBounds: function (bounds) {
            state.lastFitBounds = bounds || null;
        },
        getFitBounds: function () {
            return state.lastFitBounds;
        },
        destroy: function () {
            if (root.parentNode) root.parentNode.removeChild(root);
        }
    };
}
