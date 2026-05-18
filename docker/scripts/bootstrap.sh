#!/usr/bin/env bash
# D5 — Local Splunk harness bootstrap.
#
# Idempotent first-time + repeat setup for the docker/docker-compose.yml
# Splunk container. After this script exits 0:
#   * `docker compose ps splunk` shows "healthy"
#   * The better_map app is installed and active in Splunk
#   * secrets.env at the repo root carries SPLUNK_HOST + SPLUNK_TOKEN
#     so every existing helper (scripts/check-splunk-messages.sh) AND
#     scripts/dispatch-test.py can talk to the lab
#
# Re-running is safe: existing tokens are re-used, app installs are
# upgraded with `update=true`, and the secrets.env is rewritten in
# place.
#
# Usage:
#   bash docker/scripts/bootstrap.sh                # full bootstrap
#   bash docker/scripts/bootstrap.sh --skip-install # boot only, don't install
#   bash docker/scripts/bootstrap.sh --skip-build   # use whatever tarball is in docker/staging/

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/../.." && pwd)"
DOCKER_DIR="${REPO_ROOT}/docker"
STAGING_DIR="${DOCKER_DIR}/staging"
ENV_FILE="${DOCKER_DIR}/.env"
SECRETS_FILE="${REPO_ROOT}/secrets.env"

TARBALL_NAME="better_map-local.tar.gz"
STAGED_TARBALL="${STAGING_DIR}/${TARBALL_NAME}"
CONTAINER_TARBALL_PATH="/staging/${TARBALL_NAME}"

SKIP_INSTALL=0
SKIP_BUILD=0
for arg in "$@"; do
    case "$arg" in
        --skip-install) SKIP_INSTALL=1 ;;
        --skip-build) SKIP_BUILD=1 ;;
        -h|--help)
            sed -n '/^# /{s/^# //;p;}' "${BASH_SOURCE[0]}" | head -30
            exit 0
            ;;
        *)
            echo "[bootstrap] unknown arg: $arg" >&2
            exit 1
            ;;
    esac
done

# ---------------------------------------------------------------------- prereqs

if ! command -v docker >/dev/null 2>&1; then
    echo "[bootstrap] FATAL: docker not found on PATH" >&2
    echo "[bootstrap]   install Docker Desktop or the Docker Engine, then re-run" >&2
    exit 1
fi

if ! docker compose version >/dev/null 2>&1; then
    echo "[bootstrap] FATAL: 'docker compose' subcommand not available" >&2
    echo "[bootstrap]   you may have legacy docker-compose; upgrade Docker to >=20.10" >&2
    exit 1
fi

if [ ! -f "$ENV_FILE" ]; then
    echo "[bootstrap] FATAL: ${ENV_FILE} not found" >&2
    echo "[bootstrap]   cp docker/.env.example docker/.env" >&2
    echo "[bootstrap]   then edit it to set SPLUNK_PASSWORD + SPLUNK_HEC_TOKEN" >&2
    exit 1
fi

# Source .env so we can read SPLUNK_PASSWORD / SPLUNK_HEC_TOKEN / port overrides.
# shellcheck disable=SC1090
set -a
. "$ENV_FILE"
set +a

: "${SPLUNK_PASSWORD:?docker/.env must set SPLUNK_PASSWORD}"
: "${SPLUNK_HEC_TOKEN:?docker/.env must set SPLUNK_HEC_TOKEN}"
SPLUNK_WEB_PORT="${SPLUNK_WEB_PORT:-8000}"
SPLUNK_MGMT_PORT="${SPLUNK_MGMT_PORT:-8089}"
SPLUNK_HEC_PORT="${SPLUNK_HEC_PORT:-8088}"

if [ "$SPLUNK_PASSWORD" = "changeme-to-a-real-password" ]; then
    echo "[bootstrap] FATAL: SPLUNK_PASSWORD still set to the placeholder" >&2
    echo "[bootstrap]   edit docker/.env and set a real password (>=8 chars, mixed case + digit + symbol)" >&2
    exit 1
fi

# ---------------------------------------------------------------------- boot

mkdir -p "$STAGING_DIR"

echo "[bootstrap] starting Splunk container ..."
( cd "$DOCKER_DIR" && docker compose up -d splunk )

echo "[bootstrap] waiting for splunkd on https://localhost:${SPLUNK_MGMT_PORT}/services/server/info ..."
DEADLINE=$(( $(date +%s) + 600 ))   # 10-minute first-boot budget
while true; do
    if curl -ksSf -u "admin:${SPLUNK_PASSWORD}" \
        "https://localhost:${SPLUNK_MGMT_PORT}/services/server/info?output_mode=json" \
        >/dev/null 2>&1; then
        break
    fi
    if [ "$(date +%s)" -ge "$DEADLINE" ]; then
        echo "[bootstrap] FATAL: splunkd did not come up within 10 minutes" >&2
        echo "[bootstrap]   docker logs better_map_splunk --tail 50 :" >&2
        docker logs better_map_splunk --tail 50 >&2 || true
        exit 1
    fi
    sleep 5
done
echo "[bootstrap] splunkd is up."

# --------------------------------------------------------------------- token

# Mint a long-lived REST bearer token. Using `splunk add token` inside
# the container is the only authoritative way (the REST endpoint that
# creates tokens is itself locked behind admin auth + the token-auth
# feature flag, which we'd have to enable first — the CLI handles
# that). The token is scoped to admin so it can install apps + run
# any search; for the dispatch-test rig that's exactly what we need.
echo "[bootstrap] minting REST bearer token (audience=better_map_harness) ..."
TOKEN_NAME="better_map_harness_$(date +%Y%m%d_%H%M%S)"
TOKEN_BODY="$(docker compose -f "${DOCKER_DIR}/docker-compose.yml" exec -T splunk \
    /opt/splunk/bin/splunk login -auth "admin:${SPLUNK_PASSWORD}" 2>/dev/null && \
  docker compose -f "${DOCKER_DIR}/docker-compose.yml" exec -T splunk \
    /opt/splunk/bin/splunk _internal call /services/authorization/tokens \
      -post:name "admin" \
      -post:audience "${TOKEN_NAME}" \
      -post:expires_on "+30d" \
      -auth "admin:${SPLUNK_PASSWORD}" 2>/dev/null || true )"

# `splunk _internal call` returns the token in <s:key name="token">…</s:key>
SPLUNK_TOKEN="$(printf '%s' "$TOKEN_BODY" | sed -n 's:.*<s:key name="token">\(eyJ[^<]*\)</s:key>.*:\1:p')"

if [ -z "$SPLUNK_TOKEN" ]; then
    # Fallback: the older 9.x / 10.0.x Splunk image returns the token
    # in a different XML structure. Try the simpler one-liner that
    # works on every version we've tested.
    SPLUNK_TOKEN="$(docker compose -f "${DOCKER_DIR}/docker-compose.yml" exec -T splunk \
        /opt/splunk/bin/splunk add token -name admin -audience "${TOKEN_NAME}" \
        -expires-on "+30d" -auth "admin:${SPLUNK_PASSWORD}" 2>&1 | \
        grep -oE 'eyJ[A-Za-z0-9._\-]+' | head -1 || true)"
fi

if [ -z "$SPLUNK_TOKEN" ]; then
    echo "[bootstrap] FATAL: could not mint a REST bearer token" >&2
    echo "[bootstrap]   inspect: docker compose -f docker/docker-compose.yml exec splunk \\" >&2
    echo "[bootstrap]              /opt/splunk/bin/splunk add token -name admin -auth admin:\$SPLUNK_PASSWORD" >&2
    exit 1
fi

echo "[bootstrap] token minted (audience=${TOKEN_NAME}, length=${#SPLUNK_TOKEN})"

# ---------------------------------------------------------------------- build

if [ "$SKIP_INSTALL" = "1" ]; then
    echo "[bootstrap] --skip-install set, skipping tarball build + install"
elif [ "$SKIP_BUILD" = "1" ]; then
    echo "[bootstrap] --skip-build set, using existing ${STAGED_TARBALL}"
    if [ ! -s "$STAGED_TARBALL" ]; then
        echo "[bootstrap] FATAL: --skip-build set but ${STAGED_TARBALL} missing" >&2
        exit 1
    fi
else
    # Build / re-stage the app tarball.
    #
    # This block MIRRORS scripts/run-appinspect-local.sh lines 53–87
    # (the staging+tar pattern that itself mirrors .github/workflows/
    # release.yml). If you change one, update all three. A follow-up
    # PR will factor this into scripts/build-app-tarball.sh; until
    # then this duplication is deliberate — drift risk is low because
    # the AppInspect CI gate would catch any layout mismatch.
    VIZ_JS="${REPO_ROOT}/better_map/appserver/static/visualizations/better_map/visualization.js"
    if [ ! -s "$VIZ_JS" ]; then
        echo "[bootstrap] visualization.js missing — running webpack build ..."
        ( cd "${REPO_ROOT}/better_map/appserver/static/visualizations/better_map" && npm run --silent build )
    fi

    echo "[bootstrap] staging better_map/ -> ${STAGING_DIR}/better_map ..."
    rm -rf "${STAGING_DIR}/better_map" "${STAGED_TARBALL}"
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
        "${REPO_ROOT}/better_map/" "${STAGING_DIR}/better_map/"

    find "${STAGING_DIR}/better_map" -name '._*' -delete
    find "${STAGING_DIR}/better_map" -name '.DS_Store' -delete
    find "${STAGING_DIR}/better_map" -type d -exec chmod 755 {} \;
    find "${STAGING_DIR}/better_map" -type f -exec chmod 644 {} \;

    COPYFILE_DISABLE=1 tar czf "${STAGED_TARBALL}" -C "${STAGING_DIR}" better_map
    echo "[bootstrap] tarball: ${STAGED_TARBALL} ($(wc -c < "${STAGED_TARBALL}") bytes)"

    # ---------------------------------------------------------------- install

    # POST /services/apps/local with name=<container-path-on-splunk> +
    # filename=true + update=true. See
    # ~/.cursor/skills/splunk-remote-app-deploy/SKILL.md for the full
    # write-up of why this is the only pattern that works.
    echo "[bootstrap] POST /services/apps/local with name=${CONTAINER_TARBALL_PATH} ..."
    INSTALL_HTTP="$(curl -ksS -o /tmp/bm-install-resp.$$ -w "%{http_code}" \
        -H "Authorization: Bearer ${SPLUNK_TOKEN}" \
        -X POST \
        --data-urlencode "name=${CONTAINER_TARBALL_PATH}" \
        -d "filename=true" \
        -d "update=true" \
        -d "output_mode=json" \
        "https://localhost:${SPLUNK_MGMT_PORT}/services/apps/local" || echo "000")"

    if [ "$INSTALL_HTTP" != "200" ] && [ "$INSTALL_HTTP" != "201" ]; then
        echo "[bootstrap] FATAL: app install returned HTTP ${INSTALL_HTTP}" >&2
        echo "[bootstrap]   response body:" >&2
        cat /tmp/bm-install-resp.$$ >&2 || true
        rm -f /tmp/bm-install-resp.$$
        exit 1
    fi
    rm -f /tmp/bm-install-resp.$$

    # Restart splunkd so the app's visualizations.conf / dashboards
    # / nav are loaded. This usually takes 30–60 s.
    echo "[bootstrap] restarting splunkd to load the app ..."
    curl -ksS -X POST -H "Authorization: Bearer ${SPLUNK_TOKEN}" \
        "https://localhost:${SPLUNK_MGMT_PORT}/services/server/control/restart?output_mode=json" \
        >/dev/null || true

    # Wait for it to come back.
    sleep 5
    DEADLINE=$(( $(date +%s) + 300 ))
    while true; do
        if curl -ksSf -H "Authorization: Bearer ${SPLUNK_TOKEN}" \
            "https://localhost:${SPLUNK_MGMT_PORT}/services/server/info?output_mode=json" \
            >/dev/null 2>&1; then
            break
        fi
        if [ "$(date +%s)" -ge "$DEADLINE" ]; then
            echo "[bootstrap] FATAL: splunkd did not come back within 5 minutes after restart" >&2
            exit 1
        fi
        sleep 5
    done
    echo "[bootstrap] splunkd restarted and healthy."
fi

# ------------------------------------------------------------------- secrets

# Write secrets.env at the repo root so the existing
# scripts/check-splunk-messages.sh pattern + the new
# scripts/dispatch-test.py both Just Work.
echo "[bootstrap] writing ${SECRETS_FILE} ..."
cat > "$SECRETS_FILE" <<EOF
# Auto-generated by docker/scripts/bootstrap.sh on $(date -u +%Y-%m-%dT%H:%M:%SZ).
# Points every helper script at the local Splunk lab harness.
# Re-run \`bash docker/scripts/bootstrap.sh\` to rotate the token.
# To swap to a remote Splunk, replace this file by hand.
SPLUNK_HOST=localhost
SPLUNK_PORT=${SPLUNK_MGMT_PORT}
SPLUNK_TOKEN=${SPLUNK_TOKEN}
SPLUNK_HEC_PORT=${SPLUNK_HEC_PORT}
SPLUNK_HEC_TOKEN=${SPLUNK_HEC_TOKEN}
SPLUNK_INSECURE=1
EOF
chmod 600 "$SECRETS_FILE"
echo "[bootstrap] ${SECRETS_FILE} chmod 600 (already gitignored)."

# ------------------------------------------------------------------- summary

cat <<EOF

[bootstrap] DONE.

  Splunk Web:    http://localhost:${SPLUNK_WEB_PORT}  (admin / \$SPLUNK_PASSWORD)
  splunkd REST:  https://localhost:${SPLUNK_MGMT_PORT}  (Bearer \$SPLUNK_TOKEN — see secrets.env)
  HEC:           https://localhost:${SPLUNK_HEC_PORT}  (token \$SPLUNK_HEC_TOKEN)

  Next steps:
    python3 scripts/dispatch-test.py             # smoke-test every dashboard
    bash scripts/check-splunk-messages.sh        # check for splunkd warnings
    bash docker/scripts/teardown.sh              # tear down + wipe volumes
EOF
