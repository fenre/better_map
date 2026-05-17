#!/usr/bin/env bash
# SPLUNK-MSG-1 — Runbook: confirm the Splunk Web banner warning is
# unrelated to better_map.
#
# Background
# ----------
# After installing better_map v1.6.x on the `rev` instance, a yellow
# banner appears in Splunk Web with a message dispatched by splunkd
# under /services/messages. Visual inspection of the banner text in
# the browser is ambiguous because Splunk re-renders the message via
# the web tier; the only authoritative source is the splunkd REST
# endpoint that produced it.
#
# This script issues an authenticated GET against:
#
#   https://${SPLUNK_HOST}:8089/services/messages?output_mode=json
#
# and prints, for every message stanza:
#
#   * name          (the stanza key, e.g. `auth_warning`)
#   * severity      (info / warn / error)
#   * messageType   (when present)
#   * who emitted   (any `eai:acl` app/owner)
#   * the full message body
#
# Then it greps the JSON for any mention of `better_map`, `mapbox`,
# `maplibre`, or `appserver/static/visualizations/better_map`. If any
# stanza matches one of those, SPLUNK-MSG-1 turns into a real bug
# against this app; if none match, the warning is owned by another
# app or by core splunkd and SPLUNK-MSG-1 is closed.
#
# Why a runbook and not a CI gate?
# --------------------------------
# /services/messages is per-instance, per-account, transient state.
# A CI gate against a fresh container would always be empty. The
# investigation only makes sense against a long-lived environment
# (rev, prod) where the banner has actually been observed. Hence:
# operator-driven, runbook-shaped, fail-loud.
#
# Inputs (read from `secrets.env` at the repo root — gitignored)
# --------------------------------------------------------------
#   SPLUNK_HOST   Hostname or IP of the Splunk Enterprise instance
#                 (no scheme, no port). e.g. `rev.example.com`.
#   SPLUNK_TOKEN  REST bearer token with at least `messages_read`
#                 capability. Generated under Settings -> Tokens
#                 in Splunk Web, or via splunk btool/CLI.
#
# Optional environment overrides
# ------------------------------
#   SPLUNK_PORT   Defaults to 8089 (splunkd management port).
#   SPLUNK_INSECURE  If set to 1, curl skips TLS verification (use
#                    only against lab/rev instances with self-signed
#                    certificates).
#
# Exit codes
# ----------
#   0  Investigation completed. Stdout contains the full message
#      dump and a SPATIAL-1-style verdict line:
#        "VERDICT: SPLUNK-MSG-1 unrelated to better_map (close)"   OR
#        "VERDICT: SPLUNK-MSG-1 caused by better_map (file bug)"
#   1  Network / auth error reaching splunkd. Re-check secrets.env.
#   2  splunkd responded but with a non-2xx status. Body printed.
#
# Usage
# -----
#   # 1. Populate secrets.env in the repo root:
#   #       SPLUNK_HOST=rev.example.com
#   #       SPLUNK_TOKEN=eyJ...
#   # 2. Run:
#   bash scripts/check-splunk-messages.sh
#
#   # Optional: pipe through jq for prettier output
#   bash scripts/check-splunk-messages.sh | tee msg-dump.txt
#
# See also
# --------
#   * ROADMAP §7c-widget (Host Configuration Drift R11)
#   * scripts/run-appinspect-local.sh (G2-2)

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
SECRETS_FILE="${REPO_ROOT}/secrets.env"

if [ ! -f "$SECRETS_FILE" ]; then
    echo "[splunk-msg] FATAL: ${SECRETS_FILE} not found." >&2
    echo "[splunk-msg]   Create it with SPLUNK_HOST=... and SPLUNK_TOKEN=..." >&2
    echo "[splunk-msg]   (file is gitignored; see .gitignore)" >&2
    exit 1
fi

# shellcheck disable=SC1090
set -a
. "$SECRETS_FILE"
set +a

: "${SPLUNK_HOST:?SPLUNK_HOST not set in secrets.env}"
: "${SPLUNK_TOKEN:?SPLUNK_TOKEN not set in secrets.env}"
SPLUNK_PORT="${SPLUNK_PORT:-8089}"

CURL_FLAGS=(--fail-with-body --silent --show-error)
if [ "${SPLUNK_INSECURE:-0}" = "1" ]; then
    CURL_FLAGS+=(--insecure)
fi

URL="https://${SPLUNK_HOST}:${SPLUNK_PORT}/services/messages?output_mode=json&count=0"

echo "[splunk-msg] GET ${URL}"
TMP="$(mktemp -t splunk-msg.XXXXXX.json)"
trap 'rm -f "$TMP"' EXIT

set +e
curl "${CURL_FLAGS[@]}" \
    -H "Authorization: Bearer ${SPLUNK_TOKEN}" \
    -o "$TMP" \
    "$URL"
RC=$?
set -e

if [ "$RC" -ne 0 ]; then
    echo "[splunk-msg] FAIL: curl returned exit code ${RC}." >&2
    echo "[splunk-msg]   Body (if any) follows:" >&2
    cat "$TMP" >&2 || true
    # Map curl's transport errors to exit 1; HTTP non-2xx to exit 2.
    # --fail-with-body sets exit 22 on HTTP >= 400.
    if [ "$RC" -eq 22 ]; then
        exit 2
    fi
    exit 1
fi

if ! command -v jq >/dev/null 2>&1; then
    echo "[splunk-msg] NOTE: jq not installed; printing raw JSON."
    cat "$TMP"
    echo
    if grep -qE 'better_map|mapbox|maplibre' "$TMP"; then
        echo "VERDICT: SPLUNK-MSG-1 caused by better_map (file bug)"
    else
        echo "VERDICT: SPLUNK-MSG-1 unrelated to better_map (close)"
    fi
    exit 0
fi

echo
echo "[splunk-msg] === Active messages on ${SPLUNK_HOST} ==="
jq -r '
  .entry // [] |
  if length == 0 then
    "  (no active messages — banner has already been dismissed or was emitted by a different account)"
  else
    .[] |
    "  - name:       \(.name)\n" +
    "    severity:   \(.content.severity // "unknown")\n" +
    "    type:       \(.content.message_type // .content.type // "")\n" +
    "    app:        \(.acl.app // "system")\n" +
    "    owner:      \(.acl.owner // "system")\n" +
    "    message:    \(.content.message // .content.value // "")\n"
  end
' "$TMP"

echo "[splunk-msg] === better_map / map-library mention scan ==="
MATCHES="$(jq -r '
    .entry // [] |
    map(select(
        (.name | test("better_map|mapbox|maplibre"; "i")) or
        ((.content.message // "") | test("better_map|mapbox|maplibre|appserver/static/visualizations/better_map"; "i")) or
        ((.acl.app // "") | test("^better_map$"; "i"))
    )) |
    length
' "$TMP")"

echo "  matches: ${MATCHES}"
echo

if [ "${MATCHES}" -gt 0 ]; then
    echo "VERDICT: SPLUNK-MSG-1 caused by better_map (file bug)"
    echo "  next step: open issue with the matching stanza name(s) and message bodies."
    exit 0
fi

echo "VERDICT: SPLUNK-MSG-1 unrelated to better_map (close)"
echo "  next step: tick the SPLUNK-MSG-1 box in ROADMAP and close the investigation."
exit 0
