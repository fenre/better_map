#!/usr/bin/env bash
# G2-2 — Local AppInspect helper (ROADMAP §3 G2 + Theme D D1).
#
# Stages the better_map/ tree with the same exclude-list as
# .github/workflows/release.yml, tars it, runs `splunk-appinspect inspect`
# with the cloud+future tag set used by CI, and asserts the result with
# scripts/check-appinspect-results.py.
#
# Why a local helper:
#   * AppInspect issues are cheapest to fix on the developer's laptop,
#     not after CI. This script mirrors the exact CI gate so a green run
#     here means a green run on a PR.
#   * Devs already have `npm run lint:*` muscle memory; this script
#     plugs into that contract via `npm run lint:appinspect` in
#     package.json.
#
# Requirements:
#   * Python 3.9+ (3.11 in CI; any 3.x with venv works locally).
#   * Write access to the repo workspace (creates `dist-appinspect/`).
#   * A first-time run will create `.venv-appinspect/` and install
#     splunk-appinspect (~50 MB, takes ~45s on a warm laptop). Subsequent
#     runs reuse the venv and complete in ~5s.
#
# Behaviour:
#   * Exits 0 if AppInspect reports 0 hard-fail items.
#   * Exits non-zero (and prints offender breakdown) otherwise.
#   * Pass `--fail-on-warnings` to mirror the release.yml strict bar.
#
# Usage:
#   scripts/run-appinspect-local.sh                # PR-gate parity
#   scripts/run-appinspect-local.sh --fail-on-warnings  # release-gate parity

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
cd "$REPO_ROOT"

VENV_DIR=".venv-appinspect"
STAGE_DIR="dist-appinspect"
TARBALL="${STAGE_DIR}/better_map-local.tar.gz"
REPORT="${STAGE_DIR}/report.json"

# ---------------- venv + appinspect ----------------
if [ ! -x "${VENV_DIR}/bin/splunk-appinspect" ]; then
    echo "[appinspect-local] creating venv at ${VENV_DIR} ..."
    python3 -m venv "${VENV_DIR}"
    "${VENV_DIR}/bin/pip" install --quiet --upgrade pip
    echo "[appinspect-local] installing splunk-appinspect (~50 MB, one-time) ..."
    "${VENV_DIR}/bin/pip" install --quiet "splunk-appinspect>=4,<5"
fi

# ---------------- ensure visualization.js is built ----------------
VIZ_JS="better_map/appserver/static/visualizations/better_map/visualization.js"
if [ ! -s "${VIZ_JS}" ]; then
    echo "[appinspect-local] visualization.js missing — running webpack build ..."
    (
        cd better_map/appserver/static/visualizations/better_map
        npm run --silent build
    )
fi

# ---------------- stage + tar (mirror of release.yml) ----------------
mkdir -p "${STAGE_DIR}"
rm -rf "${STAGE_DIR}/better_map" "${TARBALL}" "${REPORT}"

rsync -a \
    --exclude='node_modules' \
    --exclude='src' \
    --exclude='scripts' \
    --exclude='docs' \
    --exclude='package.json' \
    --exclude='package-lock.json' \
    --exclude='webpack.config.js' \
    --exclude='.eslintrc.cjs' \
    --exclude='.eslintignore' \
    --exclude='harness.json' \
    --exclude='AIR-GAPPED-PMTILES.md' \
    --exclude='build-pmtiles.sh' \
    better_map/ "${STAGE_DIR}/better_map/"

find "${STAGE_DIR}/better_map" -name '._*' -delete
find "${STAGE_DIR}/better_map" -name '.DS_Store' -delete
find "${STAGE_DIR}/better_map" -type d -exec chmod 755 {} \;
find "${STAGE_DIR}/better_map" -type f -exec chmod 644 {} \;

COPYFILE_DISABLE=1 tar czf "${TARBALL}" -C "${STAGE_DIR}" better_map
echo "[appinspect-local] tarball: ${TARBALL} ($(wc -c < "${TARBALL}") bytes)"

# ---------------- inspect ----------------
"${VENV_DIR}/bin/splunk-appinspect" inspect \
    "${TARBALL}" \
    --output-file "${REPORT}" \
    --data-format json \
    --max-messages 100 \
    --included-tags cloud \
    --included-tags future \
    > /dev/null  # human summary printed by the parser below

# ---------------- assert ----------------
python3 scripts/check-appinspect-results.py --report "${REPORT}" "$@"
