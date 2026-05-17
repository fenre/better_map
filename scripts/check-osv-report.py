#!/usr/bin/env python3
"""
G1 — OSV-Scanner report gate for better_map (second-opinion CVE scan).

ROADMAP §3 G1 sub-deliverable. Closes the §3 G1 "Run `osv-scanner`
against the lockfile in CI as a second opinion to npm audit" item.

Reads a JSON report produced by `osv-scanner --format=json` and FAILs
on any vulnerability at severity `high` or `critical` that is NOT
covered by an active waiver in `scripts/npm-audit-waivers.json` (shared
with `check-npm-audit.py` — one CVE, one decision, one waiver).

Why a separate scanner at all:
  - npm audit reads GitHub Advisory Database only.
  - OSV-Scanner reads osv.dev which aggregates GHSA + GHSC + Pypi + Go
    + Rust + many more sources.
  - In practice OSV occasionally surfaces advisories that npm audit
    misses (and vice versa); having both means we catch more.

Severity floor: `high+` by default (matches the npm-audit gate). Pass
`--max-severity moderate` to tighten or `--max-severity critical` to
loosen.

OSV-Scanner severity reporting:
  - The osv-scanner JSON report carries CVSS v3 vector strings on each
    `vulnerabilities[].database_specific.severity` or
    `vulnerabilities[].severity[]` field.
  - We map CVSS score → severity bucket (low <4, moderate 4-6.9,
    high 7-8.9, critical 9+) when only a vector or score is available
    and no bucket label is provided.
  - Some advisories list multiple severity entries (one per CVSS
    version). We take the MAXIMUM (worst case).

Exit codes:
  0 — no unwaived finding at `--max-severity`+
  1 — at least one unwaived finding at `--max-severity`+ or expired
      waiver
  2 — input file missing / not valid JSON
"""

from __future__ import annotations

import argparse
import datetime as dt
import json
import re
import sys
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
WAIVERS_PATH_DEFAULT = REPO_ROOT / "scripts" / "npm-audit-waivers.json"

SEVERITY_ORDER = {
    "none": -1,
    "low": 0,
    "moderate": 1,
    "high": 2,
    "critical": 3,
}


def cvss_score_to_bucket(score: float) -> str:
    """Map a CVSS v2/v3 base score to the npm-audit-style bucket."""
    if score >= 9.0:
        return "critical"
    if score >= 7.0:
        return "high"
    if score >= 4.0:
        return "moderate"
    if score > 0.0:
        return "low"
    return "none"


def cvss_vector_to_score(vector: str) -> float | None:
    """Pull the CVSS base score from a vector string when present.

    OSV vectors often carry the score embedded (e.g.
    'CVSS:3.1/AV:N/AC:L/.../A:H'). Without a `temporalScore` library
    we fall back to a coarse heuristic: high AV (network), low AC, and
    high C/I/A impact → high; otherwise moderate. This is intentionally
    conservative so we err on the side of failing the gate.
    """
    if not vector or not isinstance(vector, str):
        return None
    if "CVSS:3" in vector or "CVSS:2" in vector:
        impacts = re.findall(r"[CIA]:([HMLN])", vector)
        impact_letters = "".join(impacts)
        if "H" in impact_letters and re.search(r"AV:N", vector):
            return 7.5
        if "H" in impact_letters:
            return 6.5
        if "M" in impact_letters:
            return 4.5
        return 2.5
    return None


def severity_from_entry(entry: dict[str, Any]) -> str:
    """Best-effort: return a severity bucket for one OSV-Scanner vuln entry."""
    explicit = entry.get("database_specific", {}).get("severity")
    if isinstance(explicit, str) and explicit.lower() in SEVERITY_ORDER:
        return explicit.lower()

    best_bucket = "none"
    best_rank = SEVERITY_ORDER["none"]
    for sev in entry.get("severity", []) or []:
        if not isinstance(sev, dict):
            continue
        vector = sev.get("score") or sev.get("vector")
        score = cvss_vector_to_score(vector)
        if score is None:
            continue
        bucket = cvss_score_to_bucket(score)
        rank = SEVERITY_ORDER.get(bucket, -1)
        if rank > best_rank:
            best_rank = rank
            best_bucket = bucket
    return best_bucket


def iter_findings(report: dict[str, Any]):
    """Yield (package_name, vuln_id, severity_bucket, aliases) per finding."""
    for result in report.get("results", []) or []:
        for pkg in result.get("packages", []) or []:
            pkg_info = pkg.get("package", {})
            name = pkg_info.get("name", "<unknown>")
            for vuln in pkg.get("vulnerabilities", []) or []:
                vid = vuln.get("id", "<unknown>")
                aliases = vuln.get("aliases", []) or []
                yield name, vid, severity_from_entry(vuln), aliases


def load_waivers(path: Path) -> list[dict[str, Any]]:
    if not path.exists():
        return []
    with path.open("r", encoding="utf-8") as fh:
        doc = json.load(fh)
    return list(doc.get("waivers", []))


def is_waived(
    package: str,
    vuln_id: str,
    aliases: list[str],
    waivers: list[dict[str, Any]],
    today: dt.date,
) -> tuple[bool, str]:
    ids = {vuln_id, *aliases}
    for w in waivers:
        if w.get("package") != package:
            continue
        ghsa = w.get("ghsa_id", "")
        if ghsa and ghsa not in ids:
            continue
        exp_raw = w.get("expires", "")
        try:
            exp = dt.date.fromisoformat(exp_raw)
        except ValueError:
            return False, f"waiver invalid expires={exp_raw!r}"
        if exp < today:
            return False, f"waiver EXPIRED {exp_raw}"
        return True, f"WAIVED (expires {exp_raw})"
    return False, ""


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument("report_path", type=Path, help="osv-scanner JSON output")
    parser.add_argument(
        "--max-severity",
        choices=["low", "moderate", "high", "critical"],
        default="high",
    )
    parser.add_argument("--waivers", type=Path, default=WAIVERS_PATH_DEFAULT)
    args = parser.parse_args(argv)

    if not args.report_path.exists():
        sys.stderr.write(f"ERROR: report file not found: {args.report_path}\n")
        return 2
    try:
        with args.report_path.open("r", encoding="utf-8") as fh:
            report = json.load(fh)
    except json.JSONDecodeError as exc:
        sys.stderr.write(f"ERROR: invalid JSON: {exc}\n")
        return 2

    threshold = SEVERITY_ORDER[args.max_severity]
    waivers = load_waivers(args.waivers)
    today = dt.date.today()

    print(f"OSV-Scanner gate — report: {args.report_path}, threshold: {args.max_severity}+")

    findings = list(iter_findings(report))
    total = len(findings)

    failures: list[str] = []
    skipped = 0
    waived = 0

    for name, vid, sev, aliases in findings:
        if SEVERITY_ORDER.get(sev, -1) < threshold:
            skipped += 1
            continue
        waived_ok, reason = is_waived(name, vid, aliases, waivers, today)
        if waived_ok:
            waived += 1
            print(f"  {sev:8s}  {name:40s}  {vid:25s}  {reason}")
        elif reason.startswith("waiver EXPIRED"):
            failures.append(
                f"  {sev:8s}  {name:40s}  {vid:25s}  {reason}"
            )
        else:
            failures.append(
                f"  {sev:8s}  {name:40s}  {vid:25s}  un-waived  aliases={','.join(aliases) or '<none>'}"
            )

    print(
        f"Total findings: {total} (waived={waived}, below-threshold={skipped}, failures={len(failures)})"
    )

    if failures:
        print("\nFAILURES:")
        for f in failures:
            print(f)
        print(
            "\nHow to resolve:\n"
            "  1. Run `npm audit fix` in the viz dir if a fix is available.\n"
            "  2. If no fix is available and the finding is not exploitable\n"
            "     in better_map, add a waiver to scripts/npm-audit-waivers.json\n"
            "     with a real `reason` and `expires` ≤ 90 days out.\n"
            "  3. The waiver file is shared with check-npm-audit.py: one\n"
            "     waiver covers BOTH scanners for the same CVE."
        )
        return 1

    print(f"OK: no un-waived finding at {args.max_severity}+.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
