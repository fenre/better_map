#!/usr/bin/env bash
#
# Better Map build script.
#
# Builds the MapLibre/AMD bundle, verifies the AMD prefix, then packages the
# Splunk app into dist/better_map-<version>.tar.gz, excluding source files
# and tooling that Splunk does not need at runtime.
#
# Usage:  ./build.sh
#
set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "$0")" && pwd)"
APP_NAME="better_map"
APP_DIR="$SCRIPT_DIR/$APP_NAME"
VIZ_DIR="$APP_DIR/appserver/static/visualizations/$APP_NAME"
OUTPUT_DIR="$SCRIPT_DIR/dist"

if [ ! -d "$VIZ_DIR" ]; then
    echo "ERROR: viz dir not found at $VIZ_DIR" >&2
    exit 1
fi

VERSION=$(grep -E '^version[[:space:]]*=' "$APP_DIR/default/app.conf" | head -n 1 | cut -d= -f2 | tr -d '[:space:]')
if [ -z "$VERSION" ]; then
    echo "ERROR: could not parse version from $APP_DIR/default/app.conf" >&2
    exit 1
fi

TARBALL="$OUTPUT_DIR/${APP_NAME}-${VERSION}.tar.gz"

echo "=== Better Map build ==="
echo "Version: $VERSION"
echo "Output:  $TARBALL"
echo ""

# [1/4] Install npm deps for the AMD viz if missing
if [ ! -d "$VIZ_DIR/node_modules" ]; then
    echo "[1/4] Installing AMD viz npm dependencies..."
    if [ -f "$VIZ_DIR/package-lock.json" ]; then
        ( cd "$VIZ_DIR" && npm ci )
    else
        ( cd "$VIZ_DIR" && npm install )
    fi
else
    echo "[1/4] AMD viz node_modules already present, skipping install."
fi

# [2/4] Build the AMD webpack bundle. This is the canonical render path:
# Splunk Dashboard Studio loads it via visualizations.conf as
# `<app_id>.<viz_name>` (better_map.better_map). Simple XML dashboards load
# it the same way. There is no React DashboardCore alternative — v1.4.0
# removed the React rewrite scaffolding after the AMD path was proven to
# work on Splunk Enterprise 10.2.x DS (see CHANGELOG.md and
# splunk-ds-onprem-custom-viz SKILL.md Symptoms D, E, F, G, H, I, J).
echo "[2/4] Building visualization.js (webpack --mode production)..."
( cd "$VIZ_DIR" && npm run build )

if [ ! -f "$VIZ_DIR/visualization.js" ]; then
    echo "ERROR: webpack did not produce visualization.js" >&2
    exit 1
fi

# [3/4] Verify the AMD prefix. Splunk's RequireJS will silently fail to
# register the module if it does not start with `define([...], function(`.
BUNDLE_HEAD=$(head -c 256 "$VIZ_DIR/visualization.js")
if ! echo "$BUNDLE_HEAD" | grep -qE '^define\(\[[^]]*\][[:space:]]*,[[:space:]]*function[[:space:]]*\('; then
    echo "ERROR: visualization.js does not begin with 'define([...], function('" >&2
    echo "First 256 bytes were:" >&2
    echo "$BUNDLE_HEAD" >&2
    exit 1
fi
echo "[3/4] AMD prefix OK."

# Verify the AMD callback returns the unwrapped viz constructor (NOT the
# `__webpack_exports__` wrapper). See SKILL.md Symptom E for why this
# matters: without `output.library.export = 'default'` in webpack.config.js,
# the callback returns `{ default: vizClass, __esModule: true }` and DS
# silently falls back to the grey placeholder icon.
BUNDLE_TAIL=$(tail -c 60 "$VIZ_DIR/visualization.js")
if ! echo "$BUNDLE_TAIL" | grep -qE '\.default\}\(\)\}\)\;?$'; then
    echo "ERROR: visualization.js does NOT end with '.default}()});' — DS will get the webpack ESM wrapper, not the viz constructor." >&2
    echo "Last 60 bytes were:" >&2
    echo "$BUNDLE_TAIL" >&2
    echo "Fix: ensure webpack.config.js has output.library: { type: 'amd', export: 'default' }" >&2
    exit 1
fi
echo "[3/4] AMD default-export unwrap OK."

# [4/4] Package the app
mkdir -p "$OUTPUT_DIR"
xattr -rc "$APP_DIR" 2>/dev/null || true

echo "[4/4] Packaging $TARBALL ..."
COPYFILE_DISABLE=1 tar \
    --disable-copyfile \
    --no-xattrs \
    --no-mac-metadata \
    --exclude='.*' \
    --exclude='._*' \
    --exclude='__MACOSX' \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/node_modules" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/src" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/package.json" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/package-lock.json" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/webpack.config.js" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/harness.json" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/test-harness.html" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/.eslintrc*" \
    --exclude="$APP_NAME/appserver/static/visualizations/$APP_NAME/.prettierrc*" \
    -czf "$TARBALL" \
    -C "$SCRIPT_DIR" \
    "$APP_NAME"

echo ""
echo "Done."
echo ""
echo "Install with:"
echo "  curl -k -u admin:changeme \\"
echo "       -F \"filename=@$TARBALL\" \\"
echo "       https://localhost:8089/services/apps/local"
echo ""
echo "Or via Splunk Web: Manage Apps -> Install app from file."
