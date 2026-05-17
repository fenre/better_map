---
title: Runbooks
description: >-
  Operational runbooks for shipped quality gates (supply chain,
  upgrade hygiene) and planned ones (accessibility, browser
  matrix).
---

# Runbooks

Runbooks are short, opinionated, executable playbooks for the
operational tasks that fall to the maintainer between releases.

| Runbook | Theme | Status |
|---|---|---|
| [Supply chain](supply-chain.md) | G1 | shipped |
| [Upgrade hygiene](upgrade-hygiene.md) | G3 | shipped |
| Accessibility (manual VoiceOver + NVDA) | D3 Phase 3 | pre-E1 manual checklist, pending |
| Browser compatibility matrix | D2 | pending |
| End-to-end suite | D5 | blocked on Splunk Docker compose |

Each runbook is a single-file Markdown document with:

- The **trigger** that opens it (CVE published, npm release,
  Splunk minor release, a11y regression).
- The **decision tree** (waiver vs upgrade, rollback vs hotfix).
- The **exact commands** to run (against `rev`, GitHub, npm, or
  local).
- The **artefacts** the run produces (e.g. waiver JSON entry,
  release tarball, CHANGELOG entry).

## See also

- [Performance](../performance.md) — the budget gates that the
  runbooks defend.
- [Roadmap](../roadmap.md) — the wider quality-gate plan.
- [`docs/_machine/agents.md`](https://github.com/fenre/better_map/blob/main/docs/_machine/agents.md)
  — the operating manual that points at these runbooks.
