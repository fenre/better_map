#!/usr/bin/env python3
"""
G1 — License allowlist gate for better_map runtime dependencies.

ROADMAP §3 G1 sub-deliverable. Closes one of the §7d boxes:
  - [ ] Licence-allowlist clean: every direct + transitive dep on
        MIT / BSD / Apache-2.0 / CC0 / ISC

Runs `npm ls --omit=dev --json --all` in the viz package, walks the
returned dependency tree, normalizes each declared `license` (handles
strings, SPDX expressions like `(MIT OR CC0-1.0)`, typos, and the small
set of packages whose package.json omits the field), and asserts every
package resolves to an SPDX id on the allowlist in
`scripts/license-allowlist.json`.

Why Python and not Node:
  - Node's child_process.execSync defaults to a 1 MB stdout buffer;
    `npm ls --json --all` produces ~1.3 MB for this project, so the
    Node implementation hits ENOBUFS. Python's subprocess captures the
    full stream into a temp file with no size cap.
  - Every other CI gate in this repo that walks package data is Python
    (`check-manifest.py`, `check-dashboard-tokens.py`); we stay
    consistent so a future contributor only needs to learn one toolchain.

Exit codes:
  0 — every runtime dependency resolves to an allowed SPDX id
  1 — at least one violation; a table of (package, version, license,
      resolution-hint) is printed to stdout

CLI:
  python3 scripts/check-license-allowlist.py [--viz-dir PATH] [--strict-unknown]
    --viz-dir          override the viz package path (default: the
                       repo-relative path to the better_map viz)
    --strict-unknown   treat UNKNOWN (empty/missing license field) as a
                       hard FAIL even when the package matches a
                       known_good entry; useful for upstream-pressure
                       reviews
"""

from __future__ import annotations

import argparse
import json
import os
import subprocess
import sys
import tempfile
from collections.abc import Iterable
from pathlib import Path
from typing import Any


REPO_ROOT = Path(__file__).resolve().parent.parent
VIZ_DIR_DEFAULT = (
    REPO_ROOT / "better_map" / "appserver" / "static" / "visualizations" / "better_map"
)
ALLOWLIST_PATH = REPO_ROOT / "scripts" / "license-allowlist.json"


def load_allowlist() -> dict[str, Any]:
    with ALLOWLIST_PATH.open("r", encoding="utf-8") as fh:
        return json.load(fh)


def normalize_license_value(raw: Any) -> str:
    """Coerce a package.json `license` field to a single string for matching.

    The field can be:
      - a string (most common): "MIT"
      - an object {type, url}: {"type": "MIT", "url": "..."}
      - an array of objects (legacy): [{"type": "MIT"}, {"type": "ISC"}]
      - missing or null: "UNKNOWN"
    """
    if raw is None:
        return "UNKNOWN"
    if isinstance(raw, str):
        return raw.strip() or "UNKNOWN"
    if isinstance(raw, dict):
        t = raw.get("type")
        return t.strip() if isinstance(t, str) and t.strip() else "UNKNOWN"
    if isinstance(raw, list):
        parts: list[str] = []
        for item in raw:
            if isinstance(item, dict):
                t = item.get("type")
                if isinstance(t, str) and t.strip():
                    parts.append(t.strip())
            elif isinstance(item, str) and item.strip():
                parts.append(item.strip())
        return " OR ".join(parts) if parts else "UNKNOWN"
    return "UNKNOWN"


def resolve_license(
    package_name: str, declared: str, allowlist: dict[str, Any]
) -> tuple[bool, str, str]:
    """Return (is_allowed, effective_spdx, reason).

    Resolution order:
      1. UNKNOWN/empty → check `known_good[package_name]`; if present,
         use that license.
      2. Match against `typo_normalization` (literal-string typos
         observed in real packages).
      3. Match against `dual_license_pick` for SPDX disjunctions.
      4. Direct match against `allowed_spdx`.

    `reason` is a short human-friendly string for the violation table.
    """
    allowed_set = set(allowlist["allowed_spdx"])
    known_good: dict[str, dict[str, str]] = allowlist.get("known_good", {})
    typos: dict[str, str] = allowlist.get("typo_normalization", {})
    dual: dict[str, str] = allowlist.get("dual_license_pick", {})

    effective = declared

    if effective.upper() == "UNKNOWN" or effective == "":
        if package_name in known_good:
            kg_license = known_good[package_name]["license"]
            if kg_license in allowed_set:
                return (
                    True,
                    kg_license,
                    f"UNKNOWN → known_good[{package_name}] = {kg_license}",
                )
            return (
                False,
                kg_license,
                f"known_good[{package_name}] = {kg_license} (not on allowlist)",
            )
        return (False, "UNKNOWN", "license field missing — add to known_good with evidence")

    if effective in typos:
        normalized = typos[effective]
        if normalized in allowed_set:
            return (True, normalized, f"typo normalization: {effective} → {normalized}")

    if effective in dual:
        pick = dual[effective]
        if pick in allowed_set:
            return (True, pick, f"dual-license pick: {effective} → {pick}")
        return (
            False,
            pick,
            f"dual-license pick {effective} → {pick} (not on allowlist)",
        )

    if effective in allowed_set:
        return (True, effective, "direct match")

    return (
        False,
        effective,
        f"'{effective}' not on allowlist (add to allowed_spdx, dual_license_pick, or known_good)",
    )


def run_npm_ls(viz_dir: Path) -> dict[str, Any]:
    """Run `npm ls --omit=dev --json --all --long` and return parsed JSON.

    --long is required because the short tree only lists names+versions;
    we need the per-package `license` field, which is only present in
    the long form.

    `npm ls` exits non-zero whenever it finds peer-dep warnings, missing
    optional deps, etc. — that's normal and does not invalidate the
    JSON tree, so we deliberately ignore the return code and rely on
    stdout being valid JSON.
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
            [
                "npm",
                "ls",
                "--omit=dev",
                "--json",
                "--all",
                "--long",
            ],
            cwd=viz_dir,
            stdout=tmp,
            stderr=subprocess.DEVNULL,
            check=False,
        )
        del proc
        tmp.seek(0)
        try:
            tree = json.load(tmp)
        except json.JSONDecodeError as exc:
            sys.stderr.write(f"ERROR: npm ls did not emit JSON: {exc}\n")
            sys.exit(2)

    return tree


def walk_dependencies(node: dict[str, Any]) -> Iterable[tuple[str, str, str]]:
    """Yield (name, version, declared_license) tuples for every package
    in the dependency tree, recursively. The root node itself (the viz
    package) is excluded because the project owns it directly.
    """
    deps = node.get("dependencies") or {}
    for name, pkg in deps.items():
        version = pkg.get("version", "?")
        declared = normalize_license_value(pkg.get("license"))
        yield (name, version, declared)
        yield from walk_dependencies(pkg)


def main(argv: list[str] | None = None) -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--viz-dir",
        type=Path,
        default=VIZ_DIR_DEFAULT,
        help="path to the viz package containing package.json + node_modules",
    )
    parser.add_argument(
        "--strict-unknown",
        action="store_true",
        help="treat UNKNOWN as FAIL even when the package matches a known_good entry",
    )
    args = parser.parse_args(argv)

    viz_dir = args.viz_dir.resolve()
    allowlist = load_allowlist()
    tree = run_npm_ls(viz_dir)

    seen: dict[str, tuple[str, str]] = {}
    for name, version, declared in walk_dependencies(tree):
        key = f"{name}@{version}"
        if key not in seen:
            seen[key] = (name, declared)

    violations: list[tuple[str, str, str, str]] = []
    resolved_via: dict[str, int] = {}

    for key, (name, declared) in seen.items():
        if args.strict_unknown and declared.upper() == "UNKNOWN":
            violations.append((key, declared, "UNKNOWN", "strict-unknown mode"))
            continue

        ok, effective, reason = resolve_license(name, declared, allowlist)
        if not ok:
            violations.append((key, declared, effective, reason))
        else:
            bucket = (
                "direct"
                if reason == "direct match"
                else "dual-license"
                if reason.startswith("dual-license")
                else "typo"
                if reason.startswith("typo")
                else "known_good"
            )
            resolved_via[bucket] = resolved_via.get(bucket, 0) + 1

    total = len(seen)
    print(f"License gate — scanned {total} runtime dependencies under {viz_dir.relative_to(REPO_ROOT)}/node_modules\n")
    print("Resolution breakdown:")
    for bucket in ("direct", "dual-license", "typo", "known_good"):
        print(f"  {bucket:13s} {resolved_via.get(bucket, 0):>4d}")
    print(f"  violations    {len(violations):>4d}")
    print()

    if violations:
        print("VIOLATIONS:")
        print(f"  {'package@version':50s}  {'declared':30s}  {'reason'}")
        print(f"  {'-' * 50}  {'-' * 30}  {'-' * 50}")
        for key, declared, _effective, reason in violations:
            print(f"  {key:50s}  {declared:30s}  {reason}")
        print()
        print("How to resolve:")
        print("  1. If the SPDX id is correct: add it to `allowed_spdx` in")
        print("     scripts/license-allowlist.json after legal review.")
        print("  2. If the package declares (A OR B): add an entry to")
        print("     `dual_license_pick` mapping the disjunction to the")
        print("     permissive side.")
        print("  3. If the SPDX id is a typo in upstream package.json: add")
        print("     it to `typo_normalization`.")
        print("  4. If the license field is empty/missing: read the upstream")
        print("     LICENSE file, then add to `known_good` with `evidence` URL.")
        return 1

    print("OK: every runtime dependency resolves to an allowed SPDX id.")
    return 0


if __name__ == "__main__":
    sys.exit(main())
