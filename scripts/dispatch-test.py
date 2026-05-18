#!/usr/bin/env python3
"""
D5 — Dashboard SPL dispatch-test rig.

For every `default/data/ui/views/*.xml` Dashboard Studio dashboard,
extract every `ds.search` data-source query and dispatch it against
a running Splunk via the REST API. Classifies messages from the
returned job results into info / warn / error / fatal buckets and
fails non-zero if any query produced an error or fatal.

Inputs (read from secrets.env at the repo root — gitignored)
------------------------------------------------------------
  SPLUNK_HOST       Hostname or IP of the Splunk instance (no scheme,
                    no port). The local harness writes "localhost"
                    here when `docker/scripts/bootstrap.sh` runs.
  SPLUNK_TOKEN      REST bearer token. The harness mints one with
                    admin scope at boot time.

Optional environment overrides
------------------------------
  SPLUNK_PORT       Defaults to 8089 (splunkd management port).
  SPLUNK_INSECURE   If "1", skip TLS verification — required against
                    self-signed lab certs (incl. the harness).
  SPLUNK_NAMESPACE  Defaults to "nobody:better_map" so dispatched
                    searches resolve macros / lookups / saved
                    searches from the app's namespace. Override if
                    you ship a fork under a different app id.

Why this exists
---------------
The 2026-05-16 hand-driven deploy of v1.6.x to the `rev` instance
caught two regressions that none of the static gates (XML/JSON
parse, schema, manifest) would have:
  * A `| timechart` that referenced a field absent from the SPL
    pipeline above it — splunkd returned a 200 with the search
    completed but the messages array carried a "WARN" that the
    dashboard rendered as an empty panel.
  * A typo in `visualizations.conf` (label mis-cased) that
    /services/apps/local accepted without error but caused the viz
    type to fail to register, so the panel rendered the bar-chart
    placeholder. This test catches the first; D5 Phase 2 Playwright
    catches the second.

Static gates assert SHAPE; this asserts BEHAVIOUR. Run after every
dashboard edit and before every release branch cut.

Exit codes
----------
  0  All dispatched queries returned with zero error/fatal messages.
  1  At least one query returned an error / fatal — per-dashboard
     report printed.
  2  Internal error (missing secrets.env, view dir missing, splunkd
     unreachable, token rejected).

Usage
-----
  bash docker/scripts/bootstrap.sh               # creates secrets.env
  python3 scripts/dispatch-test.py               # smoke-test all
  python3 scripts/dispatch-test.py --filter overview
  python3 scripts/dispatch-test.py --verbose
"""

from __future__ import annotations

import argparse
import json
import re
import ssl
import sys
import time
import urllib.error
import urllib.parse
import urllib.request
import xml.etree.ElementTree as ET
from dataclasses import dataclass, field
from pathlib import Path
from typing import Iterable

REPO_ROOT = Path(__file__).resolve().parent.parent
VIEWS_DIR = REPO_ROOT / "better_map" / "default" / "data" / "ui" / "views"
SECRETS_FILE = REPO_ROOT / "secrets.env"

STUDIO_VERSION_RE = re.compile(r'version\s*=\s*["\']2["\']')
DEFAULT_TIMEOUT_S = 60
POLL_INTERVAL_S = 1.0


@dataclass
class QueryResult:
    dashboard: str
    ds_id: str
    query: str
    http_status: int = 0
    is_done: bool = False
    event_count: int = 0
    result_count: int = 0
    duration_s: float = 0.0
    messages: list[dict] = field(default_factory=list)
    error: str | None = None

    @property
    def has_error(self) -> bool:
        if self.error:
            return True
        for m in self.messages:
            t = str(m.get("type", "")).lower()
            if t in ("error", "fatal"):
                return True
        return False

    @property
    def has_warn(self) -> bool:
        for m in self.messages:
            if str(m.get("type", "")).lower() == "warn":
                return True
        return False


def _load_secrets() -> dict[str, str]:
    if not SECRETS_FILE.is_file():
        sys.stderr.write(
            f"[dispatch-test] FATAL: {SECRETS_FILE} not found.\n"
            "[dispatch-test]   Run `bash docker/scripts/bootstrap.sh` to set up a\n"
            "[dispatch-test]   local Splunk harness, or hand-create secrets.env to\n"
            "[dispatch-test]   point at a remote Splunk (see\n"
            "[dispatch-test]   docs/development/local-splunk-harness.md).\n"
        )
        sys.exit(2)
    out: dict[str, str] = {}
    for raw in SECRETS_FILE.read_text().splitlines():
        line = raw.strip()
        if not line or line.startswith("#"):
            continue
        if "=" not in line:
            continue
        k, _, v = line.partition("=")
        out[k.strip()] = v.strip().strip('"').strip("'")
    for required in ("SPLUNK_HOST", "SPLUNK_TOKEN"):
        if not out.get(required):
            sys.stderr.write(
                f"[dispatch-test] FATAL: secrets.env missing {required}\n"
            )
            sys.exit(2)
    return out


def _ssl_ctx(insecure: bool) -> ssl.SSLContext | None:
    if not insecure:
        return None
    ctx = ssl.create_default_context()
    ctx.check_hostname = False
    ctx.verify_mode = ssl.CERT_NONE
    return ctx


def _http(
    method: str,
    url: str,
    *,
    token: str,
    data: bytes | None = None,
    ssl_ctx: ssl.SSLContext | None = None,
    timeout: float = 30.0,
) -> tuple[int, bytes]:
    req = urllib.request.Request(url, data=data, method=method)
    req.add_header("Authorization", f"Bearer {token}")
    if data is not None:
        req.add_header("Content-Type", "application/x-www-form-urlencoded")
    try:
        with urllib.request.urlopen(req, context=ssl_ctx, timeout=timeout) as resp:
            return resp.status, resp.read()
    except urllib.error.HTTPError as e:
        return e.code, e.read() or b""


def _extract_queries(view_path: Path) -> list[tuple[str, str]]:
    """Walk one dashboard XML and return [(ds_id, query), ...].

    Mirrors the parse logic from scripts/check-dashboard-xml-json.py
    so the two stay in semantic sync — both treat only
    Dashboard Studio (version=2) dashboards as having SPL to dispatch.
    """
    raw = view_path.read_text(encoding="utf-8")
    if not STUDIO_VERSION_RE.search(raw[:512]):
        return []
    try:
        tree = ET.fromstring(raw)
    except ET.ParseError:
        return []
    defn = tree.find("definition")
    if defn is None:
        return []
    body = (defn.text or "").strip()
    if not body:
        return []
    try:
        data = json.loads(body)
    except json.JSONDecodeError:
        return []
    out: list[tuple[str, str]] = []
    for ds_id, ds in (data.get("dataSources") or {}).items():
        if not isinstance(ds, dict):
            continue
        if ds.get("type") != "ds.search":
            continue
        q = ((ds.get("options") or {}).get("query") or "").strip()
        if q:
            out.append((str(ds_id), q))
    return out


def _dispatch(
    *,
    host: str,
    port: int,
    token: str,
    namespace: str,
    query: str,
    ssl_ctx: ssl.SSLContext | None,
    timeout: float,
) -> QueryResult:
    """Dispatch one SPL via POST /services/search/jobs, poll, fetch."""
    qr = QueryResult(dashboard="", ds_id="", query=query)
    start = time.monotonic()

    # 1) Create the job. exec_mode=normal returns a sid immediately.
    namespace_path = f"/servicesNS/{namespace}".replace("better_map", "search/apps/better_map")
    # `nobody:<app>` is the canonical "shared, not user-owned" form
    # for an app context; Splunk's actual REST path is
    # /servicesNS/<owner>/<app>/. Format conservatively here.
    if ":" in namespace:
        owner, _, app = namespace.partition(":")
        ns_path = f"/servicesNS/{owner}/{app}"
    else:
        ns_path = "/services"

    # SPL that starts with a leading `|` is a "generating" command
    # (e.g. `| makeresults`, `| tstats`). The /services/search/jobs
    # endpoint requires queries to begin with `search` OR a leading
    # `|`. The dashboards in this app already use the leading `|`
    # form so we don't have to add one, but we do strip any literal
    # leading newline + whitespace that the JSON definition's
    # multi-line string left behind.
    spl = query.lstrip()

    create_url = f"https://{host}:{port}{ns_path}/search/jobs?output_mode=json"
    create_body = urllib.parse.urlencode(
        {
            "search": spl,
            "exec_mode": "normal",
            "earliest_time": "-24h@h",
            "latest_time": "now",
            "max_count": 0,
        }
    ).encode("utf-8")
    status, body = _http(
        "POST", create_url, token=token, data=create_body, ssl_ctx=ssl_ctx, timeout=30
    )
    qr.http_status = status
    if status not in (200, 201):
        qr.error = (
            f"POST /search/jobs returned HTTP {status}: "
            f"{body[:200].decode('utf-8', errors='replace')}"
        )
        return qr

    try:
        sid = (json.loads(body) or {}).get("sid")
    except json.JSONDecodeError:
        qr.error = "POST /search/jobs returned a non-JSON body"
        return qr
    if not sid:
        qr.error = "POST /search/jobs returned 200 but no sid"
        return qr

    # 2) Poll until isDone or timeout.
    poll_url = f"https://{host}:{port}{ns_path}/search/jobs/{sid}?output_mode=json"
    deadline = start + timeout
    while True:
        status, body = _http(
            "GET", poll_url, token=token, ssl_ctx=ssl_ctx, timeout=15
        )
        if status != 200:
            qr.error = (
                f"GET /search/jobs/{sid} returned HTTP {status}: "
                f"{body[:200].decode('utf-8', errors='replace')}"
            )
            return qr
        try:
            entry = (json.loads(body) or {}).get("entry") or []
        except json.JSONDecodeError:
            qr.error = f"GET /search/jobs/{sid} returned a non-JSON body"
            return qr
        if not entry:
            qr.error = f"GET /search/jobs/{sid} returned no entry"
            return qr
        content = (entry[0] or {}).get("content") or {}
        qr.is_done = bool(content.get("isDone"))
        qr.event_count = int(content.get("eventCount", 0) or 0)
        qr.result_count = int(content.get("resultCount", 0) or 0)
        messages = content.get("messages") or []
        if isinstance(messages, list):
            qr.messages = [
                m for m in messages if isinstance(m, dict)
            ]
        if qr.is_done:
            break
        if time.monotonic() > deadline:
            qr.error = (
                f"timeout: job {sid} did not complete within {timeout:.0f}s "
                f"(eventCount={qr.event_count})"
            )
            return qr
        time.sleep(POLL_INTERVAL_S)

    qr.duration_s = time.monotonic() - start
    return qr


def _collect_queries(filter_re: re.Pattern | None) -> list[QueryResult]:
    if not VIEWS_DIR.is_dir():
        sys.stderr.write(
            f"[dispatch-test] FATAL: views dir not found at {VIEWS_DIR}\n"
        )
        sys.exit(2)
    out: list[QueryResult] = []
    for path in sorted(VIEWS_DIR.glob("*.xml")):
        name = path.stem
        if filter_re and not filter_re.search(name):
            continue
        for ds_id, query in _extract_queries(path):
            out.append(QueryResult(dashboard=name, ds_id=ds_id, query=query))
    return out


def _print_report(results: list[QueryResult], verbose: bool) -> tuple[int, int, int]:
    """Print per-dashboard PASS/FAIL summary, return (pass, warn, fail) counts."""
    by_dash: dict[str, list[QueryResult]] = {}
    for r in results:
        by_dash.setdefault(r.dashboard, []).append(r)

    passed = warned = failed = 0
    print("D5 — dashboard SPL dispatch-test report")
    print(f"  Dashboards probed:   {len(by_dash)}")
    print(f"  Queries dispatched:  {len(results)}")

    for dash in sorted(by_dash.keys()):
        dash_qrs = by_dash[dash]
        dash_failed = [r for r in dash_qrs if r.has_error]
        dash_warned = [r for r in dash_qrs if not r.has_error and r.has_warn]
        if dash_failed:
            failed += 1
            verdict = "FAIL"
        elif dash_warned:
            warned += 1
            verdict = "WARN"
        else:
            passed += 1
            verdict = "PASS"
        print(
            f"\n  [{verdict}] {dash}  ({len(dash_qrs)} query/queries, "
            f"{sum(r.event_count for r in dash_qrs)} total events)"
        )
        if verdict == "PASS" and not verbose:
            continue
        for r in dash_qrs:
            tag = "ok" if not r.has_error and not r.has_warn else ("warn" if r.has_warn and not r.has_error else "ERR")
            print(
                f"    - {tag:>4}  ds={r.ds_id}  "
                f"results={r.result_count}  events={r.event_count}  "
                f"dur={r.duration_s:.2f}s"
            )
            if r.error:
                print(f"        error: {r.error}")
            for m in r.messages:
                mt = str(m.get("type", "")).lower()
                if mt in ("error", "fatal") or (verbose and mt in ("warn", "info")):
                    print(f"        [{mt}] {m.get('text', '')[:240]}")

    print("")
    print(f"  Summary: PASS={passed}  WARN={warned}  FAIL={failed}")
    return passed, warned, failed


def main() -> int:
    parser = argparse.ArgumentParser(description=__doc__.split("\n\n")[0])
    parser.add_argument(
        "--filter",
        help="regex to match dashboard names (without .xml). Only matching "
        "dashboards are dispatched.",
        default=None,
    )
    parser.add_argument(
        "--timeout",
        type=float,
        default=DEFAULT_TIMEOUT_S,
        help=f"per-query timeout in seconds (default {DEFAULT_TIMEOUT_S})",
    )
    parser.add_argument(
        "--verbose",
        action="store_true",
        help="print every query (not just failures) and all messages",
    )
    args = parser.parse_args()

    secrets = _load_secrets()
    host = secrets["SPLUNK_HOST"]
    token = secrets["SPLUNK_TOKEN"]
    port = int(secrets.get("SPLUNK_PORT", "8089"))
    insecure = secrets.get("SPLUNK_INSECURE", "0") == "1"
    namespace = secrets.get("SPLUNK_NAMESPACE", "nobody:better_map")
    ssl_ctx = _ssl_ctx(insecure)

    filter_re = re.compile(args.filter) if args.filter else None
    queue = _collect_queries(filter_re)
    if not queue:
        if filter_re:
            print(f"[dispatch-test] no dashboards matched --filter '{args.filter}'")
        else:
            print(f"[dispatch-test] no Dashboard Studio dashboards under {VIEWS_DIR}")
        return 2

    print(
        f"[dispatch-test] connecting to https://{host}:{port}  "
        f"(insecure={insecure}, ns={namespace}, {len(queue)} queries)"
    )

    # Pre-flight: a single GET /services/server/info confirms the
    # token is valid and the host is reachable. This converts a
    # 401-on-first-dispatch into a single clear failure message.
    pre_status, pre_body = _http(
        "GET",
        f"https://{host}:{port}/services/server/info?output_mode=json",
        token=token, ssl_ctx=ssl_ctx, timeout=10,
    )
    if pre_status != 200:
        sys.stderr.write(
            f"[dispatch-test] FATAL: pre-flight GET /services/server/info "
            f"returned HTTP {pre_status}\n"
            f"[dispatch-test]   body: {pre_body[:300].decode('utf-8', errors='replace')}\n"
            "[dispatch-test]   check SPLUNK_HOST/SPLUNK_PORT/SPLUNK_TOKEN in secrets.env\n"
        )
        return 2

    # Dispatch each query.
    for qr in queue:
        result = _dispatch(
            host=host, port=port, token=token, namespace=namespace,
            query=qr.query, ssl_ctx=ssl_ctx, timeout=args.timeout,
        )
        qr.http_status = result.http_status
        qr.is_done = result.is_done
        qr.event_count = result.event_count
        qr.result_count = result.result_count
        qr.duration_s = result.duration_s
        qr.messages = result.messages
        qr.error = result.error

    _, _, failed = _print_report(queue, verbose=args.verbose)

    if failed > 0:
        print("\n  FAIL — at least one dashboard had a query with an error/fatal "
              "message. Re-run with --verbose to see all messages, or filter to "
              "a single dashboard with --filter <name>.")
        return 1

    print("\n  PASS — every dispatched query returned without error/fatal.")
    return 0


if __name__ == "__main__":
    try:
        sys.exit(main())
    except KeyboardInterrupt:
        sys.stderr.write("\n[dispatch-test] interrupted\n")
        sys.exit(130)
    except Exception as e:  # noqa: BLE001 — top-level catch for CLI clarity
        sys.stderr.write(f"[dispatch-test] internal error: {e}\n")
        sys.exit(2)
