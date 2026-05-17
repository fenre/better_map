#!/usr/bin/env bash
# G3 — Operator runbook: find orphan files on a deployed better_map install.
#
# Background
# ----------
# Splunk's `update=true` REST install (`POST /services/apps/local`) extracts
# the new tarball on top of the previous install but does NOT delete files
# absent from the new tarball. Over multiple releases this silently
# accumulates orphans — retired dashboards, removed lookups, dropped
# visualizations.conf stanzas. ROADMAP §3 G3 documents the 2026-05-16
# v1.6.2 deploy that left two orphan dashboards (`better_map_test_install`,
# `bm_react_test`) from prior v1.5 installs on disk.
#
# This runbook compares the file tree of a deployed `better_map` Splunk
# app against the canonical manifest at
# `better_map/default/_better_map_manifest.json` (built by
# `scripts/build-manifest.py`, validated in CI by
# `scripts/check-manifest.py`) and lists every file present on the deployed
# instance that is NOT in the manifest. With `--delete`, it also removes
# them via the SSH connection (with per-file or one-shot confirmation).
#
# Why a runbook and not a CI gate?
# --------------------------------
# Orphan detection requires the deployed file tree, which lives on a
# customer / lab Splunk instance and not in CI. A CI gate against a
# fresh container would always be empty. Hence: operator-driven, runbook-
# shaped, fail-loud. The CI part of G3 is `check-manifest.py`, which
# guarantees the manifest is a correct picture of what the release tarball
# would actually ship.
#
# Inputs (precedence: CLI flag > env var > secrets.env > built-in default)
# -----------------------------------------------------------------------
#   --ssh-host HOST     SSH host or ~/.ssh/config alias (e.g. `rev`).
#                       Required unless BETTER_MAP_SSH_HOST is set.
#   --app-path PATH     Absolute path to the installed app dir on the
#                       remote host. Default:
#                         /opt/splunk/etc/apps/better_map
#                       Override for SHC member nodes, custom $SPLUNK_HOME,
#                       or non-default deployer paths.
#   --manifest FILE     Path to the manifest JSON. Default:
#                         better_map/default/_better_map_manifest.json
#                       (resolved relative to the repo root).
#   --delete            After reporting, delete each orphan via the SSH
#                       connection. Default: report only (dry-run).
#   --yes               With --delete: skip per-file confirmation prompts
#                       (one-shot accept-all). USE WITH CAUTION.
#   --verbose           Print every orphan path (not just the per-directory
#                       summary). The full list is always saved to a tempfile;
#                       --verbose just promotes it to stdout.
#   --group-threshold N Directories with ≥ N orphan files are collapsed into
#                       a one-line summary instead of listed individually.
#                       Default: 10. Use --group-threshold 1 for "always
#                       summarize" or --verbose for "always list".
#
# Output
# ------
# Always prints a verdict line and a tab-separated table of orphans
# (relative path, size in bytes). Verdict format:
#
#   VERDICT: G3 zero orphans (clean install)
#   VERDICT: G3 N orphan(s) found (review list below; --delete to remove)
#   VERDICT: G3 N orphan(s) deleted on <host>
#
# Exit codes
# ----------
#   0  Investigation completed successfully (orphans may have been found
#      and listed; --delete may have removed them; either way the run
#      itself succeeded).
#   1  Configuration error: missing flag, manifest, ssh host, etc.
#   2  Remote error: SSH failure, permission denied on remote path.
#   3  Deletion was attempted (--delete) and at least one rm failed.
#
# Usage
# -----
#   # Dry run against rev (uses ~/.ssh/config alias 'rev'):
#   bash scripts/find-orphans.sh --ssh-host rev
#
#   # Same, but actually delete the orphans (with per-file y/N prompts):
#   bash scripts/find-orphans.sh --ssh-host rev --delete
#
#   # Same, but no confirmation (CI / scripted ops cleanup):
#   bash scripts/find-orphans.sh --ssh-host rev --delete --yes
#
#   # Against a search-head cluster member with a non-default $SPLUNK_HOME:
#   bash scripts/find-orphans.sh \
#       --ssh-host shc-member-01 \
#       --app-path /apps/splunk/etc/apps/better_map
#
# See also
# --------
#   * scripts/build-manifest.py  — generates the manifest
#   * scripts/check-manifest.py  — CI gate that validates the manifest
#   * docs/runbooks/upgrade-hygiene.md — end-to-end procedure
#   * ROADMAP §3 G3

set -euo pipefail

REPO_ROOT="$(cd "$(dirname "${BASH_SOURCE[0]}")/.." && pwd)"
MANIFEST_DEFAULT="${REPO_ROOT}/better_map/default/_better_map_manifest.json"
APP_PATH_DEFAULT="/opt/splunk/etc/apps/better_map"

SSH_HOST="${BETTER_MAP_SSH_HOST:-}"
APP_PATH=""
MANIFEST=""
DELETE=0
YES=0
VERBOSE=0
GROUP_THRESHOLD=10

while [ "$#" -gt 0 ]; do
    case "$1" in
        --ssh-host)
            SSH_HOST="$2"
            shift 2
            ;;
        --app-path)
            APP_PATH="$2"
            shift 2
            ;;
        --manifest)
            MANIFEST="$2"
            shift 2
            ;;
        --delete)
            DELETE=1
            shift
            ;;
        --yes)
            YES=1
            shift
            ;;
        --verbose)
            VERBOSE=1
            shift
            ;;
        --group-threshold)
            GROUP_THRESHOLD="$2"
            shift 2
            ;;
        -h|--help)
            sed -n '2,90p' "$0"
            exit 0
            ;;
        *)
            echo "[find-orphans] FATAL: unknown flag: $1" >&2
            echo "  run with --help for usage." >&2
            exit 1
            ;;
    esac
done

APP_PATH="${APP_PATH:-${APP_PATH_DEFAULT}}"
MANIFEST="${MANIFEST:-${MANIFEST_DEFAULT}}"

if [ -z "${SSH_HOST}" ]; then
    # Try secrets.env at repo root as a last resort (matches the convention
    # used by scripts/check-splunk-messages.sh).
    if [ -f "${REPO_ROOT}/secrets.env" ]; then
        # shellcheck disable=SC1090
        set -a
        . "${REPO_ROOT}/secrets.env"
        set +a
        SSH_HOST="${BETTER_MAP_SSH_HOST:-}"
    fi
fi

if [ -z "${SSH_HOST}" ]; then
    echo "[find-orphans] FATAL: no SSH host provided." >&2
    echo "  Set via --ssh-host HOST, BETTER_MAP_SSH_HOST env, or" >&2
    echo "  add BETTER_MAP_SSH_HOST=... to secrets.env at the repo root." >&2
    exit 1
fi

if [ ! -f "${MANIFEST}" ]; then
    echo "[find-orphans] FATAL: manifest not found: ${MANIFEST}" >&2
    echo "  run 'python3 scripts/build-manifest.py' first." >&2
    exit 1
fi

if ! command -v python3 >/dev/null 2>&1; then
    echo "[find-orphans] FATAL: python3 not on PATH (used for JSON parsing)." >&2
    exit 1
fi

# Extract the canonical list of shippable file paths from the manifest.
TMP_MANIFEST_PATHS="$(mktemp -t bm-manifest.XXXXXX)"
trap 'rm -f "${TMP_MANIFEST_PATHS}" "${TMP_INSTALLED:-}" "${TMP_ORPHANS:-}"' EXIT

python3 -c "
import json, sys
with open('${MANIFEST}') as f:
    m = json.load(f)
for entry in m['files']:
    print(entry['path'])
" | sort > "${TMP_MANIFEST_PATHS}"

MANIFEST_COUNT="$(wc -l < "${TMP_MANIFEST_PATHS}" | tr -d ' ')"

echo "[find-orphans] manifest: ${MANIFEST}"
echo "[find-orphans]   files in manifest: ${MANIFEST_COUNT}"
echo "[find-orphans] ssh host: ${SSH_HOST}"
echo "[find-orphans] remote app path: ${APP_PATH}"
echo

# List the installed file tree on the remote host. The remote `find`
# already prunes Splunk runtime / admin paths that are NEVER part of a
# shipped tarball and would always show up as false-positive orphans:
#
#   local/                  Splunk runtime user state — modified .conf
#                           files, KV store seeds, etc. Per
#                           splunk-app-packaging.mdc, `local/` is REQUIRED
#                           to be absent from a release artifact, so by
#                           construction it's never in our manifest.
#   metadata/local.meta     Per-instance permissions delta written by
#                           Splunk Web. Same reasoning as local/.
#   default.old*            Splunk's automatic pre-upgrade backup of the
#                           previous default/. Created when an `update=true`
#                           REST install replaces a major version. Not
#                           something a release ships.
#
# We also drop macOS resource forks (`._*`) and `.DS_Store` to match
# what build-manifest.py excludes (SCP-from-macOS scenario).
#
# `ssh -T` disables the local PTY. Some remote shells STILL emit OSC
# escapes from .zshrc on non-interactive login (e.g. iTerm2's
# `]50;SetProfile=...`), so we also (a) launch the remote command via
# `bash -c` to use a plain bash with no profile init, AND (b)
# post-filter any line that doesn't start with a regular path character
# so OSC/ANSI debris cannot pollute the orphan set.
#
# The emitted file list also includes a per-file size in bytes (tab-
# separated), so the grouping step can compute total bytes per
# orphan directory without an extra round-trip. Format per line:
#   <relative-path>\t<size_bytes>
TMP_INSTALLED="$(mktemp -t bm-installed.XXXXXX)"
set +e
# shellcheck disable=SC2029  # we WANT the SSH_HOST-side $APP_PATH expansion to be done locally
ssh -T -o BatchMode=yes -o StrictHostKeyChecking=accept-new "${SSH_HOST}" \
    "bash --noprofile --norc -c \"find '${APP_PATH}' \
        \\\\( -type d \\\\( -name local -o -name 'default.old*' \\\\) -prune \\\\) \
        -o \\\\( -type f \
            ! -name '.DS_Store' \
            ! -name '._*' \
            ! -path '*/metadata/local.meta' \
            -printf '%P\\\\t%s\\\\n' \\\\) \
        2>/dev/null \"" \
    | grep -E '^[A-Za-z0-9_./@-]' \
    | sort \
    > "${TMP_INSTALLED}"
RC=$?
set -e

if [ "${RC}" -ne 0 ]; then
    echo "[find-orphans] FAIL: ssh '${SSH_HOST}' returned exit code ${RC}." >&2
    echo "  Check ~/.ssh/config has a Host stanza for '${SSH_HOST}'," >&2
    echo "  and that '${APP_PATH}' is readable by the SSH user." >&2
    exit 2
fi

INSTALLED_COUNT="$(wc -l < "${TMP_INSTALLED}" | tr -d ' ')"
echo "[find-orphans]   files on ${SSH_HOST}: ${INSTALLED_COUNT}"

if [ "${INSTALLED_COUNT}" -eq 0 ]; then
    echo "[find-orphans] WARN: zero files found at ${APP_PATH} on ${SSH_HOST}." >&2
    echo "  Is better_map installed there? (--app-path may be wrong.)" >&2
    echo
    echo "VERDICT: G3 unable to verify (remote tree empty)"
    exit 2
fi

# Extract just the paths from the size-tagged installed list, then diff
# against the manifest (which has paths only).
TMP_INSTALLED_PATHS="$(mktemp -t bm-installed-paths.XXXXXX)"
awk -F'\t' '{print $1}' "${TMP_INSTALLED}" | sort > "${TMP_INSTALLED_PATHS}"

# Orphans = files on installed tree that are NOT in the manifest.
TMP_ORPHANS="$(mktemp -t bm-orphans.XXXXXX)"
comm -23 "${TMP_INSTALLED_PATHS}" "${TMP_MANIFEST_PATHS}" > "${TMP_ORPHANS}"
ORPHAN_COUNT="$(wc -l < "${TMP_ORPHANS}" | tr -d ' ')"

# Pull sizes back in for the orphan set so we can report bytes per group.
TMP_ORPHANS_SIZED="$(mktemp -t bm-orphans-sized.XXXXXX)"
awk -F'\t' 'NR==FNR { orph[$1] = 1; next } orph[$1] { print $0 }' \
    "${TMP_ORPHANS}" "${TMP_INSTALLED}" > "${TMP_ORPHANS_SIZED}"

# Persist the full orphan list to a stable tempfile so the operator can
# inspect it after the script exits (the per-run mktemp -t handles are
# cleaned up by the EXIT trap).
ORPHAN_DUMP="${TMPDIR:-/tmp}/better-map-orphans-${SSH_HOST}-$(date -u +%Y%m%dT%H%M%SZ).txt"
cp "${TMP_ORPHANS_SIZED}" "${ORPHAN_DUMP}"

# Missing = files in manifest that are NOT on installed tree. Reported
# for symmetry; usually means the install was cancelled or a previous
# version is on disk.
MISSING_COUNT="$(comm -13 "${TMP_INSTALLED_PATHS}" "${TMP_MANIFEST_PATHS}" | wc -l | tr -d ' ')"

echo
if [ "${ORPHAN_COUNT}" -eq 0 ] && [ "${MISSING_COUNT}" -eq 0 ]; then
    rm -f "${ORPHAN_DUMP}" "${TMP_INSTALLED_PATHS}" "${TMP_ORPHANS_SIZED}"
    echo "VERDICT: G3 zero orphans (clean install on ${SSH_HOST})"
    exit 0
fi

# ----- Group + summarize orphans for human consumption. -----
#
# Grouping rule (MAXIMAL ORPHAN DIRECTORY):
#   A directory D is a "wholly orphan directory" iff every file beneath
#   D is in the orphan set AND no file in the manifest lives under D.
#   We collapse each maximal (shallowest) wholly-orphan directory into
#   a single summary line. Orphan files that share a parent with a
#   manifest file (so the parent CAN'T be wholly orphan) are shown
#   individually.
#
# This is the right heuristic for the v1.5 → v1.6 orphan-class bug:
#   - appserver/static/react/    is wholly orphan ⇒ one line
#   - appserver/static/pages/    is wholly orphan ⇒ one line
#   - appserver/static/bm_react.bundle.js  has manifest siblings
#                                            (network_diagnostic.html
#                                             etc) ⇒ shown individually
#
# GROUP_THRESHOLD bounds the OUTPUT size: groups smaller than the
# threshold are flattened to individual leaf entries (no point
# collapsing a 2-file directory).
TMP_GROUPS="$(mktemp -t bm-groups.XXXXXX)"

awk -F'\t' -v threshold="${GROUP_THRESHOLD}" '
function parent_of(p,    n, parts, i, out) {
    n = split(p, parts, "/");
    if (n <= 1) return "";
    out = "";
    for (i = 1; i < n; i++) {
        out = (out == "" ? parts[i] : out "/" parts[i]);
    }
    return out;
}
NR == FNR {
    # First file = manifest paths; mark every ancestor as "touched by manifest".
    mpaths[$1] = 1;
    p = parent_of($1);
    while (p != "") {
        manifest_under[p] = 1;
        p = parent_of(p);
    }
    next;
}
{
    # Second file = orphan paths + sizes.
    orph[$1] = $2;
    orph_count++;
    orph_bytes_total += $2;
    p = parent_of($1);
    while (p != "") {
        orph_under_count[p]++;
        orph_under_bytes[p] += $2;
        p = parent_of(p);
    }
}
END {
    # For each orphan path, find the SHALLOWEST ancestor directory
    # that is "wholly orphan" (no manifest file under it). That is the
    # maximal orphan-dir grouping prefix.
    for (path in orph) {
        chosen = "";  # empty = no wholly-orphan ancestor; emit as leaf
        n = split(path, parts, "/");
        prefix = "";
        for (i = 1; i < n; i++) {
            prefix = (prefix == "" ? parts[i] : prefix "/" parts[i]);
            if (!manifest_under[prefix]) {
                chosen = prefix;  # SHALLOWEST wholly-orphan ancestor
                break;
            }
        }
        if (chosen == "") {
            # Path has a manifest sibling somewhere above; show as leaf.
            print "LEAF\t" path "\t" orph[path];
        } else {
            # Defer emit: we will roll up by chosen prefix.
            covered_by[chosen] = 1;
            cov_count[chosen]++;
            cov_bytes[chosen] += orph[path];
        }
    }
    # Emit groups (or downgrade to leaves if below threshold).
    for (g in covered_by) {
        if (cov_count[g] < threshold) {
            # Tiny group: flatten its members to LEAF lines.
            for (path in orph) {
                # Re-derive chosen for this path; emit if matches g.
                n = split(path, parts, "/");
                prefix = "";
                for (i = 1; i < n; i++) {
                    prefix = (prefix == "" ? parts[i] : prefix "/" parts[i]);
                    if (!manifest_under[prefix]) {
                        if (prefix == g) {
                            print "LEAF\t" path "\t" orph[path];
                        }
                        break;
                    }
                }
            }
        } else {
            printf "GROUP\t%s/\t%d\t%d\n", g, cov_count[g], cov_bytes[g];
        }
    }
}' "${TMP_MANIFEST_PATHS}" "${TMP_ORPHANS_SIZED}" \
    | sort > "${TMP_GROUPS}"

GROUP_LINES=$(grep -c '^GROUP' "${TMP_GROUPS}" 2>/dev/null || true)
GROUP_LINES="${GROUP_LINES:-0}"
LEAF_LINES=$(grep -c '^LEAF' "${TMP_GROUPS}" 2>/dev/null || true)
LEAF_LINES="${LEAF_LINES:-0}"

# Human-readable size formatter (KiB/MiB/GiB).
_fmt_bytes() {
    awk -v b="$1" 'BEGIN {
        u[1]="B"; u[2]="KiB"; u[3]="MiB"; u[4]="GiB"; u[5]="TiB";
        i = 1;
        while (b >= 1024 && i < 5) { b /= 1024; i++ }
        printf "%.1f %s", b, u[i];
    }'
}

TOTAL_BYTES="$(awk -F'\t' '{ s += $2 } END { print s+0 }' "${TMP_ORPHANS_SIZED}")"

echo "=== Orphan summary on ${SSH_HOST} (present on disk, NOT in manifest) ==="
if [ "${GROUP_LINES}" -gt 0 ]; then
    echo "  Grouped (≥${GROUP_THRESHOLD} files per directory):"
    grep '^GROUP' "${TMP_GROUPS}" | sort -k3,3 -t$'\t' -nr | while IFS=$'\t' read -r _ prefix cnt bytes; do
        size_h="$(_fmt_bytes "${bytes}")"
        printf "    %-60s %6d files  %10s\n" "${prefix}" "${cnt}" "${size_h}"
    done
fi
if [ "${LEAF_LINES}" -gt 0 ]; then
    echo "  Individual orphan files:"
    grep '^LEAF' "${TMP_GROUPS}" | sort -k2,2 -t$'\t' | while IFS=$'\t' read -r _ path bytes; do
        size_h="$(_fmt_bytes "${bytes}")"
        printf "    %-60s %10s\n" "${path}" "${size_h}"
    done
fi
TOTAL_H="$(_fmt_bytes "${TOTAL_BYTES}")"
echo "  -----"
printf "  TOTAL: %d orphan files, %s\n" "${ORPHAN_COUNT}" "${TOTAL_H}"
echo
echo "  Full orphan list (path\\tsize_bytes): ${ORPHAN_DUMP}"

if [ "${VERBOSE}" -eq 1 ]; then
    echo
    echo "=== Full orphan list (--verbose) ==="
    awk -F'\t' '{ printf "  %s  (%s bytes)\n", $1, $2 }' "${TMP_ORPHANS_SIZED}"
fi

if [ "${MISSING_COUNT}" -gt 0 ]; then
    echo
    echo "=== Missing files on ${SSH_HOST} (in manifest, NOT on disk) ==="
    comm -13 "${TMP_INSTALLED_PATHS}" "${TMP_MANIFEST_PATHS}" | sed 's|^|  |'
    echo
    echo "  (this usually means the install was interrupted or the deployed"
    echo "   version is older than the manifest's app_version)"
fi

if [ "${DELETE}" -ne 1 ]; then
    echo
    echo "VERDICT: G3 ${ORPHAN_COUNT} orphan(s) found on ${SSH_HOST} (${TOTAL_H})"
    if [ "${ORPHAN_COUNT}" -gt 0 ]; then
        echo "  next step: re-run with --delete to remove (per-file y/N), or"
        echo "             --delete --yes for one-shot removal."
        echo "             Add --verbose to see the full file list inline."
        if [ "${ORPHAN_COUNT}" -gt 1000 ]; then
            echo
            echo "  NOTE: ${ORPHAN_COUNT} orphan files is a lot. --delete does"
            echo "        one SSH 'rm -f' per file, which can take a long time."
            echo "        For wholly-orphan directories listed in the summary"
            echo "        above (e.g. node_modules/), it is faster to SSH in and"
            echo "        'rm -rf' the directory manually after reviewing the"
            echo "        full list in ${ORPHAN_DUMP}."
            echo "        See docs/runbooks/upgrade-hygiene.md for the procedure."
        fi
    fi
    exit 0
fi

# --delete path: prompt or proceed, remove via SSH.
if [ "${ORPHAN_COUNT}" -eq 0 ]; then
    echo
    echo "VERDICT: G3 nothing to delete (zero orphans on ${SSH_HOST})"
    exit 0
fi

echo
echo "=== Deleting ${ORPHAN_COUNT} orphan(s) on ${SSH_HOST} ==="

DELETED=0
FAILED=0

while IFS= read -r rel; do
    [ -z "${rel}" ] && continue
    full="${APP_PATH}/${rel}"

    if [ "${YES}" -ne 1 ]; then
        printf "  delete %s ? [y/N] " "${full}"
        read -r answer < /dev/tty
        case "${answer}" in
            y|Y|yes|YES) ;;
            *)
                echo "    skipped."
                continue
                ;;
        esac
    fi

    # Use BatchMode and a tight timeout so a hung ssh per-file doesn't
    # block the loop. -- in front of "${full}" prevents path-starting-with-
    # dash from being parsed as an rm flag (defence-in-depth, the manifest
    # generator already excludes those, but the runbook talks to a tree
    # that the operator does not control).
    set +e
    ssh -o BatchMode=yes -o ConnectTimeout=10 "${SSH_HOST}" \
        "rm -f -- '${full}'" 2>/dev/null
    SSH_RC=$?
    set -e

    if [ "${SSH_RC}" -eq 0 ]; then
        echo "    deleted: ${rel}"
        DELETED=$((DELETED + 1))
    else
        echo "    FAILED:  ${rel}  (ssh exit ${SSH_RC})" >&2
        FAILED=$((FAILED + 1))
    fi
done < "${TMP_ORPHANS}"

echo
if [ "${FAILED}" -gt 0 ]; then
    echo "VERDICT: G3 ${DELETED} deleted / ${FAILED} FAILED on ${SSH_HOST}"
    echo "  next step: review the FAILED entries above (likely permission denied)"
    echo "  and either fix the SSH user's perms or run the rm manually as splunk."
    exit 3
fi

echo "VERDICT: G3 ${DELETED} orphan(s) deleted on ${SSH_HOST}"
exit 0
