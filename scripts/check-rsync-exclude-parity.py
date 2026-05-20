#!/usr/bin/env python3
"""
G2-3 — Verify all three rsync --exclude lists stay in lockstep.

The release tarball (production) is staged by `.github/workflows/release.yml`
with a fixed `rsync --exclude=...` list. The PR-gate AppInspect job in
`.github/workflows/ci.yml` and the dev-loop helper
`scripts/run-appinspect-local.sh` BOTH have copy-pasted clones of that
same list, and all three MUST match byte-for-byte — otherwise local
AppInspect runs and PR-gate runs can produce signals that don't match
what release.yml will actually package.

This gate parses all three files, extracts every `--exclude='X'`
token (skipping comments), and fails with a per-file diff if any
two sets disagree.

Why this exists
---------------
v1.7.1 shipped after the local helper's exclude list silently lagged
release.yml by one entry (`.npmrc`), which made local AppInspect runs
fail with two cryptic packaging errors. The local-vs-CI drift was the
single root cause, but it cost ~30 minutes of investigation to spot.
We later found ci.yml had also drifted from release.yml (missing
`vitest.config.js`). This gate makes any future drift a one-line PR
failure across all three callers.

How to fix a FAIL
-----------------
Edit whichever file is missing an entry so all three lists agree.
A future refactor will consolidate them into a shared
`scripts/package-app.sh` (G2-2 follow-up), at which point this gate
becomes a defense-in-depth sanity check rather than the primary guard.

Run
---
    python3 scripts/check-rsync-exclude-parity.py
        # exit 0 -> sets agree; exit 1 -> drift, with diff printed.

Wired into `npm run lint:appinspect-parity` (dev loop),
`scripts/run-appinspect-local.sh` (front of the local helper), and
the PR-gate `appinspect` matrix in ci.yml.
"""
from __future__ import annotations

import re
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent

SOURCES = {
    "release.yml": REPO_ROOT / ".github" / "workflows" / "release.yml",
    "ci.yml": REPO_ROOT / ".github" / "workflows" / "ci.yml",
    "run-appinspect-local.sh": REPO_ROOT / "scripts" / "run-appinspect-local.sh",
}

_EXCLUDE_RE = re.compile(r"--exclude='([^']+)'")


def extract_excludes(path: Path) -> list[str]:
    """Pull every --exclude='X' from a file, in source order.

    Both target files have exactly one rsync invocation, so scoping is
    unnecessary — we just collect every --exclude='...' token in
    source order, skipping comment lines (lines whose first non-space
    character is `#`). This avoids matching --exclude tokens that
    appear in docstrings or YAML comments (e.g. release.yml line 48
    documents `rsync --exclude='docs'` inside a comment block).

    If either file grows a second rsync block later, update this
    script to scope appropriately at that time.
    """
    if not path.exists():
        print(f"FAIL: file not found: {path}", file=sys.stderr)
        sys.exit(2)
    found: list[str] = []
    for raw in path.read_text(encoding="utf-8").splitlines():
        stripped = raw.lstrip()
        if stripped.startswith("#"):
            continue
        m = _EXCLUDE_RE.search(raw)
        if m:
            found.append(m.group(1))
    return found


def main() -> int:
    lists = {name: extract_excludes(p) for name, p in SOURCES.items()}

    # All three must agree. Compare each against the canonical one
    # (release.yml — production is the source of truth).
    canonical_name = "release.yml"
    canonical = lists[canonical_name]
    all_agree = all(v == canonical for v in lists.values())

    if all_agree:
        print(
            f"PASS: rsync --exclude parity ({len(canonical)} entries, "
            + " == ".join(lists.keys())
            + ")"
        )
        return 0

    print(f"FAIL: rsync --exclude lists DRIFTED from {canonical_name}.")
    print("")
    for name, entries in lists.items():
        print(f"{name}:")
        for x in entries:
            marker = "  " if x in canonical else " +"
            print(f"  {marker} --exclude='{x}'")
        missing = [x for x in canonical if x not in entries]
        if missing:
            print(f"  Missing entries (vs {canonical_name}): {missing}")
        print("")
    print(
        f"Fix: edit each non-canonical file to mirror {canonical_name} "
        "byte-for-byte."
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
