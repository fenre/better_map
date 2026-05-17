#!/usr/bin/env python3
# -*- coding: utf-8 -*-
"""
G2-2 — AppInspect result-parser and CI gate (ROADMAP §3 G2 + Theme D D1).

Reads a JSON report produced by `splunk-appinspect inspect --data-format json`
and decides whether to PASS or FAIL the CI gate.

Policy (deliberate, documented, change-via-PR):
  * HARD FAIL on any check with result == "error"          (any count > 0)
  * HARD FAIL on any check with result == "failure"        (any count > 0)
  * HARD FAIL on any check with result == "future_failure" (any count > 0)
        future_failure means "this rule will graduate to a hard failure in
        an upcoming AppInspect release". Failing now gives us advance
        warning so we can fix BEFORE Splunkbase rejects the submission.
  * INFORM (do not fail) on warnings.
        Rationale: AppInspect bumps occasionally add new warning rules
        that have nothing to do with our code (e.g., a CIM update). We
        do not want a hosted-rule change to silently break green PRs.
        Warnings are still printed so a human reviewer can see them.

Inputs:
  --report <path>         path to the AppInspect JSON report
                          (default: dist-appinspect/report.json)
  --fail-on-warnings      bonus stricter mode — fail on warnings too.
                          Off by default; intended for release.yml or a
                          future strict-cert pipeline.

Outputs:
  * One-screen summary of the run (errors / failures / future_failures
    / warnings / success / skipped / not_applicable).
  * If non-zero exit: a per-check breakdown of every offender, including
    the check name, the AppInspect group, the relevant tags, the first
    message (`description` field), and the file/line if available.
  * Exit code 0 (pass) or 1 (fail).

Used by:
  * `.github/workflows/ci.yml`        — appinspect job (PR gate)
  * `.github/workflows/release.yml`   — release gate (defense in depth)
  * Local developer workflow          — `npm run lint:appinspect` calls
    the Splunk CLI + this script via the helper in package.json.

ROADMAP: §3 G2 (PR pipeline includes AppInspect) + Theme D D1 (re-cert).
"""

from __future__ import annotations

import argparse
import json
import sys
from pathlib import Path
from typing import Any, Dict, List, Tuple


# Result keys that, when count > 0, fail the gate by default.
# Keep this list explicit (not "everything except warning") so a future
# AppInspect change that adds a new result kind can't silently degrade
# the gate.
HARD_FAIL_RESULTS = ("error", "failure", "future_failure")

# Result keys that print but do not fail by default.
SOFT_FAIL_RESULTS = ("warning",)

# Result keys that are informational only.
INFO_RESULTS = ("success", "skipped", "not_applicable", "manual_check")


def _parse_args() -> argparse.Namespace:
    p = argparse.ArgumentParser(
        description="G2-2: AppInspect result parser and CI gate.",
    )
    p.add_argument(
        "--report",
        type=Path,
        default=Path("dist-appinspect/report.json"),
        help="Path to AppInspect JSON report. Default: dist-appinspect/report.json",
    )
    p.add_argument(
        "--fail-on-warnings",
        action="store_true",
        help="Also fail the gate on warnings. Off by default.",
    )
    return p.parse_args()


def _load_report(path: Path) -> Dict[str, Any]:
    if not path.is_file():
        sys.stderr.write(
            f"ERROR: AppInspect report not found at {path}\n"
            "       Did the `splunk-appinspect inspect ...` step run first?\n"
        )
        sys.exit(2)
    try:
        with path.open(encoding="utf-8") as f:
            return json.load(f)
    except (OSError, json.JSONDecodeError) as exc:
        sys.stderr.write(f"ERROR: failed to parse {path}: {exc}\n")
        sys.exit(2)


def _extract_summary(report: Dict[str, Any]) -> Tuple[Dict[str, int], str]:
    """
    Return (summary_dict, app_label).
    The JSON shape is:
      {
        "reports": [{"app_name":..., "app_version":..., "summary":{...}, "groups":[...]}],
        "summary": {...},  # top-level aggregate (only one app in our case)
        ...
      }
    """
    if not report.get("reports"):
        sys.stderr.write("ERROR: AppInspect report has no `reports[]` array.\n")
        sys.exit(2)
    first = report["reports"][0]
    summary = first.get("summary") or report.get("summary") or {}
    label = "{name} {version}".format(
        name=first.get("app_name", "<unknown>"),
        version=first.get("app_version", "<unknown>"),
    )
    return summary, label


def _collect_offenders(
    report: Dict[str, Any], result_kinds: Tuple[str, ...]
) -> List[Dict[str, Any]]:
    """
    Return a list of {group, check, tags, description, messages} dicts for every
    check whose top-level `result` is in `result_kinds`.
    """
    offenders: List[Dict[str, Any]] = []
    for r in report.get("reports", []):
        for g in r.get("groups", []):
            for c in g.get("checks", []):
                if c.get("result") in result_kinds:
                    offenders.append(
                        {
                            "group": g.get("name", "<unknown_group>"),
                            "check": c.get("name", "<unknown_check>"),
                            "result": c.get("result"),
                            "tags": c.get("tags", []),
                            "description": (c.get("description") or "").strip(),
                            "messages": c.get("messages", []),
                        }
                    )
    return offenders


def _print_offender(o: Dict[str, Any]) -> None:
    print()
    print(f"[{o['result'].upper()}] {o['check']}")
    print(f"  group: {o['group']}")
    if o["tags"]:
        print(f"  tags:  {', '.join(o['tags'])}")
    if o["description"]:
        # One-line truncation so the CI log stays readable.
        desc = " ".join(o["description"].split())
        if len(desc) > 240:
            desc = desc[:237] + "..."
        print(f"  desc:  {desc}")
    for m in o["messages"][:3]:
        msg = (m.get("message") or "").strip().replace("\n", " ")
        if len(msg) > 280:
            msg = msg[:277] + "..."
        loc = ""
        if m.get("filename"):
            loc = f" ({m['filename']}"
            if m.get("line"):
                loc += f":{m['line']}"
            loc += ")"
        print(f"  - {m.get('result', '?')}: {msg}{loc}")
    extra = len(o["messages"]) - 3
    if extra > 0:
        print(f"  ... and {extra} more message(s) (see report JSON)")


def main() -> int:
    args = _parse_args()
    report = _load_report(args.report)
    summary, label = _extract_summary(report)

    # Normalise the summary so missing keys read as 0 — defensive against
    # AppInspect adding/removing result kinds in a future version.
    safe = {k: int(summary.get(k, 0)) for k in (
        HARD_FAIL_RESULTS + SOFT_FAIL_RESULTS + INFO_RESULTS
    )}

    # ---------------- summary block ----------------
    print(f"AppInspect summary for {label}")
    print("-" * 60)
    width = max(len(k) for k in safe.keys())
    # Group output: failures first (high-signal), then warnings, then info.
    for k in HARD_FAIL_RESULTS + SOFT_FAIL_RESULTS + INFO_RESULTS:
        print(f"  {k.rjust(width)}: {safe[k]}")
    print("-" * 60)

    # ---------------- decision logic ----------------
    hard_count = sum(safe[k] for k in HARD_FAIL_RESULTS)
    warn_count = sum(safe[k] for k in SOFT_FAIL_RESULTS)

    failed = False
    if hard_count > 0:
        failed = True
    if args.fail_on_warnings and warn_count > 0:
        failed = True

    # Always show details for hard-fail kinds, even when total is 0
    # (means: nothing to show, prints nothing).
    hard_offenders = _collect_offenders(report, HARD_FAIL_RESULTS)
    for o in hard_offenders:
        _print_offender(o)

    # Show warnings whenever there are any, regardless of policy — keeps
    # the signal visible for human review.
    warn_offenders = _collect_offenders(report, SOFT_FAIL_RESULTS)
    if warn_offenders:
        print()
        print("Warnings (informational unless --fail-on-warnings):")
        for o in warn_offenders:
            _print_offender(o)

    # ---------------- final status ----------------
    print()
    if failed:
        if hard_count > 0:
            print(
                f"FAIL: AppInspect reports {hard_count} hard-fail item(s) "
                f"({', '.join(HARD_FAIL_RESULTS)})."
            )
        if args.fail_on_warnings and warn_count > 0:
            print(
                f"FAIL: --fail-on-warnings is set and there are "
                f"{warn_count} warning(s)."
            )
        return 1

    msg = "PASS: AppInspect gate."
    if warn_count > 0:
        msg += f" Note: {warn_count} warning(s) printed above (informational)."
    print(msg)
    return 0


if __name__ == "__main__":
    sys.exit(main())
