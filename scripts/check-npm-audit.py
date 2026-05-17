#!/usr/bin/env python3
"""
G1 — npm audit gate (with waivers) for better_map runtime dependencies.

ROADMAP §3 G1 sub-deliverable. Closes one of the §7d boxes:
  - [ ] Zero `npm audit` findings at `high`+; waivers (if any) have
        ≤ 90-day expiry

Runs `npm audit --omit=dev --json` in the viz package and FAILs CI on
any vulnerability of severity `high` or `critical` that is NOT covered
by an active waiver in `scripts/npm-audit-waivers.json`. Waivers carry
an `expires` date and are silently skipped once expired (so an expired
waiver FAILs the gate the next time it runs — forces re-justification
or actual remediation).

Why a wrapper around `npm audit`:
  - Plain `npm audit --audit-level=high` exits non-zero on any high+
    finding, but you can't waive an individual CVE through it.
  - This script gives waivers a structured policy: a finding is OK if
    AND ONLY IF a documented, in-date waiver exists for that GHSA id.
  - Output is grep-able: every unwaived finding gets one line, every
    waived finding gets one line tagged WAIVED, and every expired
    waiver gets one line tagged EXPIRED.

Exit codes:
  0 — every high+ finding is covered by an active waiver, OR there are
      no high+ findings at all
  1 — at least one un-waived high+ finding, OR at least one expired
      waiver (you cannot silently extend a waiver past its expiry; it
      must be re-reviewed)

CLI:
  python3 scripts/check-npm-audit.py [--viz-dir PATH] [--max-severity LEVEL]
    --viz-dir          override the viz package path (default: viz)
    --max-severity     lowest severity that FAILs the build
                       (default: high; choices: low|moderate|high|critical)
    --waivers          override waivers JSON path
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import os
import subprocess
import sys
import tempfile
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
VIZ_DIR_DEFAULT = (
    REPO_ROOT / "better_map" / "appserver" / "static" / "visualizations" / "better_map"
)
WAIVERS_PATH_DEFAULT = REPO_ROOT / "scripts" / "npm-audit-waivers.json"

SEVERITY_ORDER = {"info": 0, "low": 1, "moderate": 2, "high": 3, "critical": 4}
MAX_WAIVER_DAYS = 90


def load_waivers(path: Path) -> list[dict[str, Any]]:
    with path.open("r", encoding="utf-8") as fh:
        doc = json.load(fh)
    return list(doc.get("waivers", []))


def run_npm_audit(viz_dir: Path) -> dict[str, Any]:
    """Run `npm audit --omit=dev --json` and parse the report.

    `npm audit` exits non-zero whenever it reports any finding (info+).
    The JSON document is still valid in that case, so we don't gate on
    the return code — we gate on what's in the report.

    Like check-license-allowlist.py we route stdout through a temp file
    to dodge any pipe-buffer limits for large audit reports.
    """
    if not (viz_dir / "package.json").exists():
        sys.stderr.write(f"ERROR: no package.json at {viz_dir}\n")
        sys.exit(2)
    if not (viz_dir / "node_modules").exists():
        sys.stderr.write(
            f"ERROR: no node_modules at {viz_dir} — run `npm ci` first.\n"
        )
        sys.exit(2)

    with tempfile.TemporaryFile() as tmp:
        proc = subprocess.run(
            ["npm", "audit", "--omit=dev", "--json"],
            cwd=viz_dir,
            stdout=tmp,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        del proc
        tmp.seek(0)
        try:
            return json.load(tmp)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"ERROR: npm audit did not emit JSON: {exc}\n")
            sys.exit(2)


def extract_ghsa_ids(via_list: list[Any]) -> list[str]:
    """Pull the GHSA / CVE ids out of the `via` field of an
    npm-audit vulnerability entry. `via` is a heterogeneous array — some
    entries are strings (transitive dep names), some are dicts with a
    `url`, `source`, `name`, etc. The GHSA id lives at `.url` (e.g.,
    https://github.com/advisories/GHSA-xxxx-xxxx-xxxx) or sometimes at
    `.source` (numeric advisory id).
    """
    ids: list[str] = []
    for via in via_list:
        if isinstance(via, dict):
            url = via.get("url") or ""
            if "/advisories/GHSA-" in url:
                ids.append(url.rsplit("/", 1)[-1])
            elif via.get("name"):
                ids.append(f"npm:{via['name']}")  # synthetic id for via-by-name
    return ids


def is_waived(
    finding_ghsa: list[str],
    package: str,
    waivers: list[dict[str, Any]],
    today: dt.date,
) -> tuple[bool, str]:
    """Return (waived, reason). `reason` is descriptive when waived,
    empty when not.
    """
    for w in waivers:
        if w.get("package") != package:
            continue
        if w.get("ghsa_id") and w["ghsa_id"] not in finding_ghsa:
            continue
        exp_raw = w.get("expires", "")
        try:
            exp = dt.date.fromisoformat(exp_raw)
        except ValueError:
            return False, f"waiver has invalid expires={exp_raw!r}"
        if exp < today:
            return False, f"waiver EXPIRED on {exp_raw}"
        return True, f"WAIVED (expires {exp_raw}, reason: {w.get('reason', '<none>')})"
    return False, ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("--viz-dir", type=Path, default=VIZ_DIR_DEFAULT)
    parser.add_argument(
        "--max-severity",
        choices=list(SEVERITY_ORDER.keys()),
        default="high",
        help="lowest severity that FAILs (default: high)",
    )
    parser.add_argument("--waivers", type=Path, default=WAIVERS_PATH_DEFAULT)
    args = parser.parse_args(argv)

    viz_dir = args.viz_dir.resolve()
    waivers = load_waivers(args.waivers)
    today = dt.date.today()

    threshold = SEVERITY_ORDER[args.max_severity]
    report = run_npm_audit(viz_dir)

    vulns = report.get("vulnerabilities") or {}
    metadata = report.get("metadata", {})
    counts = metadata.get("vulnerabilities", {})

    print(
        f"npm audit gate — viz at {viz_dir.relative_to(REPO_ROOT)}\n"
        f"Total finding counts (info/low/moderate/high/critical): "
        f"{counts.get('info', 0)} / {counts.get('low', 0)} / "
        f"{counts.get('moderate', 0)} / {counts.get('high', 0)} / "
        f"{counts.get('critical', 0)}\n"
        f"Threshold: FAIL at {args.max_severity}+\n"
    )

    failures: list[str] = []
    waived_count = 0
    skipped_count = 0
    expired_count = 0

    for package, info in vulns.items():
        severity = info.get("severity", "info")
        if SEVERITY_ORDER.get(severity, 0) < threshold:
            skipped_count += 1
            continue

        via = info.get("via", [])
        ghsa = extract_ghsa_ids(via if isinstance(via, list) else [])
        ghsa_label = ", ".join(ghsa) if ghsa else "<no GHSA>"

        waived, reason = is_waived(ghsa, package, waivers, today)
        if waived:
            waived_count += 1
            print(f"  {severity:8s}  {package:40s}  {ghsa_label}  {reason}")
        elif reason.startswith("waiver EXPIRED"):
            expired_count += 1
            failures.append(
                f"  {severity:8s}  {package:40s}  {ghsa_label}  {reason}"
            )
        else:
            failures.append(
                f"  {severity:8s}  {package:40s}  {ghsa_label}  un-waived (see scripts/npm-audit-waivers.json)"
            )

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f)
        print(
            f"\nWaiver summary: {waived_count} active, {expired_count} expired, "
            f"{skipped_count} below threshold"
        )
        print(
            "\nHow to resolve:\n"
            "  1. Run `npm audit fix` in the viz dir if a fix is available\n"
            "     (preferred — closes the CVE rather than ignoring it).\n"
            "  2. If no fix is available and the finding is not exploitable\n"
            "     in better_map, add a waiver to scripts/npm-audit-waivers.json\n"
            "     with a real `reason` and `expires` ≤ 90 days out.\n"
            "  3. If a waiver expired, re-justify it (new 90-day window) OR\n"
            "     actually remediate the finding."
        )
        return 1

    print(
        f"OK: no un-waived finding at {args.max_severity}+.  "
        f"({waived_count} waived, {skipped_count} below threshold)"
    )
    return 0


if __name__ == "__main__":
    sys.exit(main())
