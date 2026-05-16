<!--
PR template — better_map Splunk custom visualization
Mirrors ROADMAP §7b (Quality boxes). Tick every box that applies before
requesting review. Items still in the v1.7 pipeline are marked with [v1.7]
and will become CI gates as their underlying lint lands.
-->

## Summary

<!-- 1–3 sentences. What does this PR change and why? Reference the
ROADMAP work-item id (e.g. G2, BM-FIX-03) if applicable. -->

## Acceptance criteria

<!-- Copy the AC bullets from the linked ROADMAP item. Tick each as you
verify it. PRs with no linked work-item should explain "what done looks
like" in 3–5 bullets here. -->

- [ ] AC 1
- [ ] AC 2

## Quality checklist (ROADMAP §7b)

### Code quality

- [ ] ESLint passes (`npm run lint` in viz dir)
- [ ] Prettier formatting applied (`npm run format`)
- [ ] No `console.error` / `console.warn` in production paths (allowlist-only) [v1.7]
- [ ] Dashboard `.xml` and embedded JSON definitions still parse cleanly [v1.7]
- [ ] No new `better_map-*` JS class without a matching CSS rule or G8 allowlist entry [v1.7]
- [ ] Webpack production build succeeds (`npm run build`)
- [ ] Bundle size is within the §7c budget (no significant regression)

### User-facing impact

- [ ] Tested on a Splunk Cloud or Splunk Enterprise instance (state which: ____)
- [ ] Dark / light / high-contrast themes all render correctly (if visual change)
- [ ] `prefers-reduced-motion` respected (if motion change)
- [ ] Keyboard navigation works for any new widget (Tab / Enter / Esc)
- [ ] Per-widget interactivity budgets met (ROADMAP §7c-widget) [v1.7]

### Documentation

- [ ] `CHANGELOG.md` updated under `## [Unreleased]`
- [ ] `README.md` updated if a user-visible feature, default, or contract changed
- [ ] `ROADMAP.md` updated if scope, gap, or acceptance criteria shifted
- [ ] Inline JSDoc updated for any new public API in `src/lib/**/*.js`

### Versioning (release PRs only)

- [ ] `better_map/default/app.conf` `version` and `build` both bumped
- [ ] `better_map/appserver/static/visualizations/better_map/package.json` `version` bumped
- [ ] `src/lib/debugHud.js` `HUD_VERSION` matches
- [ ] All four version strings agree

## How was this tested?

<!-- Concrete steps: commands run, dashboards exercised, browser /
Splunk versions tested. Attach screenshots / GIFs for any visual change. -->

## Risk & rollback

<!-- What is the worst case if this PR is merged and turns out wrong?
Can a previous .spl be re-deployed cleanly? Any data-plane impact? -->

## Linked items

<!-- Closes #issue / Refs ROADMAP §<section>. -->
