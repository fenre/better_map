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

# [1/4] Install npm deps if missing
if [ ! -d "$VIZ_DIR/node_modules" ]; then
    echo "[1/4] Installing npm dependencies (npm ci preferred when lockfile present)..."
    if [ -f "$VIZ_DIR/package-lock.json" ]; then
        ( cd "$VIZ_DIR" && npm ci )
    else
        ( cd "$VIZ_DIR" && npm install )
    fi
else
    echo "[1/4] node_modules already present, skipping install."
fi

# [2/4] Build the webpack bundle
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
