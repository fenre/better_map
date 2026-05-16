#!/usr/bin/env bash
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_DIR="$SCRIPT_DIR/esri_map_viz"
VIZ_DIR="$APP_DIR/appserver/static/visualizations/esri_map_viz"
APP_NAME="esri_map_viz"
OUTPUT_DIR="$SCRIPT_DIR"

VERSION=$(grep '^version' "$APP_DIR/default/app.conf" | cut -d= -f2 | tr -d ' ')
TARBALL="$OUTPUT_DIR/${APP_NAME}-${VERSION}.tar.gz"

echo "=== ESRI Web Map — Splunk App Builder ==="
echo "Version: $VERSION"
echo ""

# Step 1: Install dependencies
if [ ! -d "$VIZ_DIR/node_modules" ]; then
    echo "[1/4] Installing npm dependencies..."
    (cd "$VIZ_DIR" && npm install)
else
    echo "[1/4] Dependencies already installed, skipping."
fi

# Step 2: Build webpack bundle
echo "[2/4] Building visualization bundle..."
(cd "$VIZ_DIR" && npm run build)

# Step 3: Prepend all plugin CSS to visualization.css for packaging
echo "[3/4] Bundling CSS into visualization.css..."
LEAFLET_CSS="$VIZ_DIR/node_modules/leaflet/dist/leaflet.css"
CLUSTER_CSS="$VIZ_DIR/node_modules/leaflet.markercluster/dist/MarkerCluster.css"
CLUSTER_DEFAULT_CSS="$VIZ_DIR/node_modules/leaflet.markercluster/dist/MarkerCluster.Default.css"
GEOCODER_CSS="$VIZ_DIR/node_modules/esri-leaflet-geocoder/dist/esri-leaflet-geocoder.css"
DRAW_CSS="$VIZ_DIR/node_modules/leaflet-draw/dist/leaflet.draw.css"
MINIMAP_CSS="$VIZ_DIR/node_modules/leaflet-minimap/dist/Control.MiniMap.min.css"
VIZ_CSS="$VIZ_DIR/visualization.css"
ORIGINAL_CSS=$(cat "$VIZ_CSS")
CSS_MODIFIED=false

if [ -f "$LEAFLET_CSS" ] && ! grep -q ".leaflet-container" "$VIZ_CSS"; then
    {
        cat "$LEAFLET_CSS"
        [ -f "$CLUSTER_CSS" ] && cat "$CLUSTER_CSS"
        [ -f "$CLUSTER_DEFAULT_CSS" ] && cat "$CLUSTER_DEFAULT_CSS"
        [ -f "$GEOCODER_CSS" ] && cat "$GEOCODER_CSS"
        [ -f "$DRAW_CSS" ] && cat "$DRAW_CSS"
        [ -f "$MINIMAP_CSS" ] && cat "$MINIMAP_CSS"
        cat "$VIZ_CSS"
    } > "$VIZ_CSS.tmp" && mv "$VIZ_CSS.tmp" "$VIZ_CSS"
    CSS_MODIFIED=true
fi

# Step 4: Package
echo "[4/4] Packaging $TARBALL..."
xattr -rc "$APP_DIR" 2>/dev/null || true

COPYFILE_DISABLE=1 tar --disable-copyfile --no-xattrs --no-mac-metadata \
    --exclude='.*' --exclude='._*' --exclude='__MACOSX' \
    --exclude="$APP_NAME/appserver/static/visualizations/esri_map_viz/node_modules" \
    --exclude="$APP_NAME/appserver/static/visualizations/esri_map_viz/src" \
    --exclude="$APP_NAME/appserver/static/visualizations/esri_map_viz/package.json" \
    --exclude="$APP_NAME/appserver/static/visualizations/esri_map_viz/package-lock.json" \
    --exclude="$APP_NAME/appserver/static/visualizations/esri_map_viz/webpack.config.js" \
    -cvzf "$TARBALL" \
    -C "$SCRIPT_DIR" \
    "$APP_NAME"

# Restore original CSS
if [ "$CSS_MODIFIED" = true ]; then
    echo "$ORIGINAL_CSS" > "$VIZ_CSS"
fi

echo ""
echo "Done! Package: $TARBALL"
echo ""
echo "Install with:"
echo "  \$SPLUNK_HOME/bin/splunk install app $TARBALL"
echo ""
echo "Or upload via Splunk Web: Settings > Install app from file"
