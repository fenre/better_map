/*
 * Scenegraph layer (lightweight).
 *
 * A full GLTF/GLB-rendering scenegraph layer requires Three.js +
 * threebox-plugin (~600 KB minified) which would balloon the bundle.
 * Instead, this v1.6 implementation provides a "scenegraph-style"
 * surface: render each point as a HIGH-DPI canvas-baked sprite that
 * looks like an iconographic representation of the asset class
 * (drone / truck / ship / aircraft / generic).
 *
 * Bearing-aware rotation, scale, and per-feature class are all
 * supported. The icon catalog is procedurally drawn — no external
 * art assets, no fetch, no DOMPurify exposure.
 *
 * For real GLTF rendering, ship a v2.1 layer that adds threebox-plugin
 * as an optional peer dependency.
 *
 * BM-CT-1 contract: setEnabled / isEnabled / reset.
 */

export const SOURCE_ID = 'better_map_scenegraph_src';
export const LAYER_SPRITES = 'better_map_scenegraph_sprites';

const ICON_SIZE_PX = 56; // canvas-baked icons are 56x56 @ 2x DPI

let _imagesAdded = false;
let _defaults = null;
let _enabled = true;

function makeCanvas(size) {
    const dpr = Math.min(2, (typeof window !== 'undefined' && window.devicePixelRatio) || 1);
    const canvas = document.createElement('canvas');
    canvas.width = size * dpr;
    canvas.height = size * dpr;
    const ctx = canvas.getContext('2d');
    ctx.scale(dpr, dpr);
    return { canvas: canvas, ctx: ctx };
}

function drawDrone(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2;
    const armR = s * 0.30;
    const propR = s * 0.10;
    ctx.fillStyle = '#1a1a2e';
    ctx.strokeStyle = '#00A4FD';
    ctx.lineWidth = 2;
    // Body.
    ctx.beginPath();
    ctx.arc(cx, cy, s * 0.12, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    // Four arms with propellers.
    for (let i = 0; i < 4; i++) {
        const a = (i * Math.PI / 2) + Math.PI / 4;
        const px = cx + Math.cos(a) * armR;
        const py = cy + Math.sin(a) * armR;
        ctx.beginPath();
        ctx.moveTo(cx, cy);
        ctx.lineTo(px, py);
        ctx.stroke();
        ctx.beginPath();
        ctx.fillStyle = '#0a0a14';
        ctx.arc(px, py, propR, 0, 2 * Math.PI);
        ctx.fill();
        ctx.stroke();
    }
}

function drawTruck(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.fillStyle = '#FFB300';
    ctx.strokeStyle = '#0a0a14';
    ctx.lineWidth = 1.5;
    const w = s * 0.65, h = s * 0.30;
    const x = (s - w) / 2, y = (s - h) / 2;
    ctx.fillRect(x, y, w * 0.7, h);
    ctx.strokeRect(x, y, w * 0.7, h);
    ctx.fillRect(x + w * 0.7, y + h * 0.2, w * 0.3, h * 0.6);
    ctx.strokeRect(x + w * 0.7, y + h * 0.2, w * 0.3, h * 0.6);
    ctx.fillStyle = '#0a0a14';
    ctx.beginPath();
    ctx.arc(x + w * 0.20, y + h, s * 0.07, 0, 2 * Math.PI);
    ctx.arc(x + w * 0.55, y + h, s * 0.07, 0, 2 * Math.PI);
    ctx.arc(x + w * 0.85, y + h, s * 0.07, 0, 2 * Math.PI);
    ctx.fill();
}

function drawShip(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2;
    ctx.strokeStyle = '#1FBAD6';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    // Hull (rounded trapezoid).
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.35, s * 0.60);
    ctx.lineTo(cx + s * 0.35, s * 0.60);
    ctx.lineTo(cx + s * 0.20, s * 0.78);
    ctx.lineTo(cx - s * 0.20, s * 0.78);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Wheelhouse.
    ctx.fillStyle = '#fff';
    ctx.fillRect(cx - s * 0.10, s * 0.40, s * 0.20, s * 0.20);
    ctx.strokeRect(cx - s * 0.10, s * 0.40, s * 0.20, s * 0.20);
    // Mast.
    ctx.beginPath();
    ctx.moveTo(cx, s * 0.40);
    ctx.lineTo(cx, s * 0.20);
    ctx.stroke();
}

function drawAircraft(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    const cx = s / 2, cy = s / 2;
    ctx.strokeStyle = '#F74B4A';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    // Fuselage.
    ctx.beginPath();
    ctx.moveTo(cx, cy - s * 0.42);
    ctx.lineTo(cx + s * 0.08, cy + s * 0.20);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.32);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.32);
    ctx.lineTo(cx - s * 0.08, cy + s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Wings.
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.40, cy);
    ctx.lineTo(cx + s * 0.40, cy);
    ctx.lineTo(cx + s * 0.04, cy - s * 0.04);
    ctx.lineTo(cx - s * 0.04, cy - s * 0.04);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
    // Tail.
    ctx.beginPath();
    ctx.moveTo(cx - s * 0.14, cy + s * 0.25);
    ctx.lineTo(cx + s * 0.14, cy + s * 0.25);
    ctx.lineTo(cx + s * 0.02, cy + s * 0.20);
    ctx.lineTo(cx - s * 0.02, cy + s * 0.20);
    ctx.closePath();
    ctx.fill();
    ctx.stroke();
}

function drawGeneric(ctx, s) {
    ctx.clearRect(0, 0, s, s);
    ctx.strokeStyle = '#9B59B6';
    ctx.fillStyle = '#1a1a2e';
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.35, 0, 2 * Math.PI);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = '#9B59B6';
    ctx.beginPath();
    ctx.arc(s / 2, s / 2, s * 0.08, 0, 2 * Math.PI);
    ctx.fill();
}

const ICONS = {
    drone: drawDrone,
    truck: drawTruck,
    ship: drawShip,
    aircraft: drawAircraft,
    generic: drawGeneric
};

function addIcons(map) {
    if (_imagesAdded || !map || !map.addImage) return;
    Object.keys(ICONS).forEach(function (name) {
        const id = 'better_map_sg_' + name;
        if (map.hasImage && map.hasImage(id)) return;
        const { canvas, ctx } = makeCanvas(ICON_SIZE_PX);
        ICONS[name](ctx, ICON_SIZE_PX);
        const imgData = ctx.getImageData(0, 0, canvas.width, canvas.height);
        try {
            map.addImage(id, { width: canvas.width, height: canvas.height, data: imgData.data }, { pixelRatio: 2 });
        } catch (_e) { /* swallow if already added by race */ }
    });
    _imagesAdded = true;
}

function ensureLayers(map) {
    addIcons(map);
    if (!map.getSource(SOURCE_ID)) {
        map.addSource(SOURCE_ID, { type: 'geojson', data: { type: 'FeatureCollection', features: [] } });
    }
    if (!map.getLayer(LAYER_SPRITES)) {
        map.addLayer({
            id: LAYER_SPRITES,
            type: 'symbol',
            source: SOURCE_ID,
            layout: {
                'icon-image': ['concat', 'better_map_sg_', ['coalesce', ['get', 'iconClass'], 'generic']],
                'icon-size': ['coalesce', ['get', 'iconScale'], 0.6],
                'icon-rotate': ['coalesce', ['get', 'bearing'], 0],
                'icon-allow-overlap': true,
                'icon-rotation-alignment': 'map',
                'icon-pitch-alignment': 'map'
            }
        });
    }
}

function classFor(props) {
    if (!props) return 'generic';
    const cls = String(props.iconClass || props.type || props.kind || '').toLowerCase();
    if (ICONS[cls]) return cls;
    if (/drone|uav|quad/.test(cls)) return 'drone';
    if (/truck|car|veh/.test(cls)) return 'truck';
    if (/ship|boat|vessel/.test(cls)) return 'ship';
    if (/aircraft|plane|jet/.test(cls)) return 'aircraft';
    return 'generic';
}

function normalise(fc) {
    if (!fc || !fc.features) return { type: 'FeatureCollection', features: [] };
    const out = fc.features.map(function (f) {
        if (!f.geometry || f.geometry.type !== 'Point') return null;
        const next = Object.assign({}, f);
        next.properties = Object.assign({}, f.properties || {});
        next.properties.iconClass = classFor(f.properties);
        // Default scale: 0.5 at zoom 4 → 1.0 at zoom 14.
        if (next.properties.iconScale == null) {
            next.properties.iconScale = 0.6;
        }
        return next;
    }).filter(Boolean);
    return { type: 'FeatureCollection', features: out };
}

export function mount(map, opts) {
    if (!map) return;
    _defaults = Object.assign({}, opts || {});
    ensureLayers(map);
}

export function update(map, fc, opts) {
    if (!map) return;
    ensureLayers(map);
    _defaults = Object.assign({}, opts || {});
    const src = map.getSource(SOURCE_ID);
    if (src) src.setData(normalise(fc));
}

export function unmount(map) {
    if (!map) return;
    if (map.getLayer(LAYER_SPRITES)) {
        try { map.removeLayer(LAYER_SPRITES); } catch (_e) { /* swallow */ }
    }
    if (map.getSource(SOURCE_ID)) {
        try { map.removeSource(SOURCE_ID); } catch (_e) { /* swallow */ }
    }
}

export function setVisible(map, visible) {
    if (!map || !map.getLayer(LAYER_SPRITES)) return;
    try {
        map.setLayoutProperty(LAYER_SPRITES, 'visibility', visible ? 'visible' : 'none');
    } catch (_e) { /* swallow */ }
}

export function mountAndUpdate(map, fc, opts) {
    mount(map, opts);
    update(map, fc, opts);
}

/* BM-CT-1 */
export function setEnabled(map, enabled) {
    _enabled = !!enabled;
    setVisible(map, _enabled);
}
export function isEnabled() { return _enabled; }
export function reset(map) {
    if (_defaults) update(map, null, _defaults);
}
