#!/usr/bin/env bash
#
# build-pmtiles.sh
#
# Build a self-contained .pmtiles vector basemap archive suitable for
# air-gapped Splunk Enterprise deployments. The output is a single file
# that the Better Map viz can consume via pmtiles:// — no external tile
# server, no internet egress.
#
# Prerequisites (install on a build host with internet access; the
# resulting .pmtiles file is then air-gapped):
#
#   - tippecanoe (Apple Silicon: brew install tippecanoe)
#   - pmtiles    (cargo install pmtiles  OR  go install github.com/protomaps/go-pmtiles/cmd/pmtiles@latest)
#   - curl       (for downloading source GeoJSON if you don't have one)
#
# Usage:
#
#   ./build-pmtiles.sh -o basemap.pmtiles \
#       --source ne_10m_admin_0_countries.geojson \
#       --minzoom 0 --maxzoom 8
#
# Output:
#
#   basemap.pmtiles    — drop into appserver/static/ on the host Splunk
#
# Reference data sources (CC-BY or PD, suitable for redistribution):
#
#   Natural Earth (recommended for low-zoom basemap):
#     https://www.naturalearthdata.com/downloads/
#
#   OpenMapTiles / Protomaps daily extracts (city scale):
#     https://maps.protomaps.com/
#
# Verify the resulting archive before shipping:
#
#   pmtiles show basemap.pmtiles
#   pmtiles serve --port 8081 basemap.pmtiles  # local sanity check
#

set -euo pipefail

OUT=""
SOURCE=""
MINZ=0
MAXZ=8
NAME="Better Map air-gapped basemap"
ATTRIBUTION="Natural Earth + OpenStreetMap contributors"
LAYER="basemap"

usage() {
    cat <<EOF
build-pmtiles.sh — build a vector basemap archive for Better Map air-gapped use

Required:
    -o, --output FILE         path to the output .pmtiles file
    -s, --source FILE         input GeoJSON / GeoJSONseq file

Optional:
    --minzoom N               minimum zoom level (default 0)
    --maxzoom N               maximum zoom level (default 8)
    --layer NAME              source-layer name written into PMTiles (default 'basemap')
    --name TEXT               human-readable archive name
    --attribution TEXT        attribution string baked into the archive

Example:

    curl -L -o ne_countries.geojson https://naciscdn.org/naturalearth/10m/cultural/ne_10m_admin_0_countries.geojson
    $(basename "$0") -o basemap.pmtiles -s ne_countries.geojson --maxzoom 6
EOF
}

while [[ $# -gt 0 ]]; do
    case "$1" in
        -o|--output) OUT="$2"; shift 2;;
        -s|--source) SOURCE="$2"; shift 2;;
        --minzoom) MINZ="$2"; shift 2;;
        --maxzoom) MAXZ="$2"; shift 2;;
        --layer) LAYER="$2"; shift 2;;
        --name) NAME="$2"; shift 2;;
        --attribution) ATTRIBUTION="$2"; shift 2;;
        -h|--help) usage; exit 0;;
        *) echo "Unknown arg: $1" >&2; usage; exit 1;;
    esac
done

if [[ -z "$OUT" || -z "$SOURCE" ]]; then
    usage
    exit 1
fi

if ! command -v tippecanoe >/dev/null 2>&1; then
    echo "ERROR: tippecanoe is not installed. brew install tippecanoe" >&2
    exit 1
fi

if ! command -v pmtiles >/dev/null 2>&1; then
    echo "ERROR: pmtiles CLI is not installed. See https://github.com/protomaps/go-pmtiles" >&2
    exit 1
fi

if [[ ! -f "$SOURCE" ]]; then
    echo "ERROR: source file not found: $SOURCE" >&2
    exit 1
fi

TMPDIR="$(mktemp -d)"
MBTILES="$TMPDIR/basemap.mbtiles"

echo "==> Building MBTiles (zoom $MINZ..$MAXZ, layer $LAYER)"
tippecanoe \
    -o "$MBTILES" \
    --layer "$LAYER" \
    --minimum-zoom="$MINZ" \
    --maximum-zoom="$MAXZ" \
    --name "$NAME" \
    --attribution "$ATTRIBUTION" \
    --drop-densest-as-needed \
    --extend-zooms-if-still-dropping \
    --force \
    "$SOURCE"

echo "==> Converting to PMTiles: $OUT"
pmtiles convert "$MBTILES" "$OUT"

echo "==> Done."
echo "Inspect with: pmtiles show \"$OUT\""
echo "Serve locally for a smoke test: pmtiles serve --port 8081 \"$OUT\""

rm -rf "$TMPDIR"
