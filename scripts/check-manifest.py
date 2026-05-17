#!/usr/bin/env python3
"""
G3 — Verify default/_better_map_manifest.json matches the source tree.

The release manifest (`better_map/default/_better_map_manifest.json`) is the
single source of truth for what files ship in the better_map release tarball.
The operator runbook `scripts/find-orphans.sh` consumes it to detect orphan
files on a deployed Splunk instance — the bug class documented in
ROADMAP \u00a73 G3 ("Splunk's `update=true` REST install extracts on top but
doesn't delete files absent from the new tarball").

This CI gate regenerates the manifest from the source tree (via
`scripts/build-manifest.py --stdout`) and compares it byte-for-byte against
the checked-in `better_map/default/_better_map_manifest.json`. Any drift
FAILs the build with a unified diff pointing at the affected file(s).

Why this exists
---------------
Without this check, the checked-in manifest can silently drift from what
the release workflow would actually package, defeating the runbook. The
gate makes drift a PR-blocking failure with a one-line fix: regenerate.

How to fix a FAIL
-----------------
Run `python3 scripts/build-manifest.py` to regenerate the manifest, review
the diff, then commit the new manifest alongside your code change. The
manifest MUST be updated in the same PR as any addition / removal /
content change to a shippable file (anything not in the
`release.yml` rsync exclude list).

Exit codes:
  0 \u2014 manifest matches source tree (PASS)
  1 \u2014 drift detected (FAIL) or manifest missing
  2 \u2014 internal error
"""

from __future__ import annotations

import difflib
import json
import subprocess
import sys
from pathlib import Path

REPO_ROOT = Path(__file__).resolve().parent.parent
MANIFEST_PATH = REPO_ROOT / "better_map" / "default" / "_better_map_manifest.json"
BUILDER = REPO_ROOT / "scripts" / "build-manifest.py"


def main() -> int:
    if not BUILDER.exists():
        print(
            f"[FAIL] generator script missing: {BUILDER.relative_to(REPO_ROOT)}",
            file=sys.stderr,
        )
        return 2

    if not MANIFEST_PATH.exists():
        print(
            f"[FAIL] manifest is missing: {MANIFEST_PATH.relative_to(REPO_ROOT)}",
            file=sys.stderr,
        )
        print(
            "  run `python3 scripts/build-manifest.py` and commit the result.",
            file=sys.stderr,
        )
        return 1

    # Regenerate fresh manifest from source tree.
    try:
        result = subprocess.run(
            [sys.executable, str(BUILDER), "--stdout"],
            check=True,
            capture_output=True,
            text=True,
        )
    except subprocess.CalledProcessError as exc:
        print(f"[ERROR] generator failed (rc={exc.returncode}):", file=sys.stderr)
        print(exc.stderr, file=sys.stderr)
        return 2

    expected = result.stdout
    actual = MANIFEST_PATH.read_text(encoding="utf-8")

    if expected == actual:
        try:
            manifest = json.loads(actual)
        except json.JSONDecodeError as exc:
            # Bytes matched, but the file is somehow invalid JSON \u2014 that
            # would be a bug in build-manifest.py itself, not drift.
            print(f"[ERROR] manifest matches generator but is invalid JSON: {exc}", file=sys.stderr)
            return 2

        print(
            f"[PASS] manifest matches source tree "
            f"({manifest['file_count']} files, "
            f"{manifest['total_size_bytes']:,} bytes, "
            f"app v{manifest['app_version']})"
        )
        return 0

    # Drift detected. Produce a copy-pasteable diff so the operator can
    # see exactly which file(s) changed without re-running the generator.
    print("[FAIL] manifest drift detected vs source tree:", file=sys.stderr)
    print(f"  checked-in: {MANIFEST_PATH.relative_to(REPO_ROOT)}", file=sys.stderr)
    print(
        f"  expected:   regenerated from source via {BUILDER.relative_to(REPO_ROOT)}",
        file=sys.stderr,
    )
    print("", file=sys.stderr)
    print("Unified diff (- on-disk, + expected):", file=sys.stderr)
    diff = difflib.unified_diff(
        actual.splitlines(keepends=True),
        expected.splitlines(keepends=True),
        fromfile=f"on-disk:{MANIFEST_PATH.relative_to(REPO_ROOT)}",
        tofile="expected (regenerated)",
        n=3,
    )
    sys.stderr.writelines(diff)
    print("", file=sys.stderr)
    print(
        "To fix: run `python3 scripts/build-manifest.py` and commit the new manifest.",
        file=sys.stderr,
    )
    return 1


if __name__ == "__main__":
    sys.exit(main())
